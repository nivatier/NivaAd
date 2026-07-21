"""Reframes a generated video to a different aspect ratio via padding —
never cropping, per the agreed design: scale the source to fit entirely
within the target dimensions, then fill whatever space is left over
(top/bottom OR left/right, never both — one direction always matches
exactly once the fit-scale is applied) using the company's own Brand
Kit preference for that direction.

Uses the ffmpeg/ffprobe binaries directly via subprocess — no Python
wrapper library needed for what's actually a handful of well-defined
filter graphs, and subprocess keeps the actual command fully visible
and debuggable (the exact command run is always logged).
"""
import logging
import subprocess
import tempfile
import uuid
from pathlib import Path

from app.services import storage

logger = logging.getLogger("nivaad.reframe")

# Ratios are now developer-managed (see services/video_ratios.py) — just
# the ratio strings themselves ("1:1", "9:16", etc.), not fixed pixel
# sizes. Target dimensions are computed FROM the source video's own
# resolution instead, so a 720p source stays roughly 720p-scale after
# reframing rather than always being forced up to a fixed 1080p target
# regardless of its real quality.


class ReframeError(Exception):
    pass


def _run(cmd: list[str], timeout: int = 120) -> None:
    logger.info("[reframe] running: %s", " ".join(cmd))
    result = subprocess.run(cmd, capture_output=True, timeout=timeout)
    if result.returncode != 0:
        stderr = result.stderr.decode("utf-8", errors="replace")[-2000:]  # ffmpeg errors are verbose — keep only the tail, usually where the real reason is
        raise ReframeError(f"ffmpeg exited {result.returncode}: {stderr}")


def _probe_dimensions(path: Path) -> tuple[int, int]:
    cmd = [
        "ffprobe", "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=width,height", "-of", "csv=s=x:p=0", str(path),
    ]
    result = subprocess.run(cmd, capture_output=True, timeout=30)
    if result.returncode != 0:
        raise ReframeError(f"ffprobe failed: {result.stderr.decode('utf-8', errors='replace')}")
    width_str, height_str = result.stdout.decode().strip().split("x")
    return int(width_str), int(height_str)


def parse_ratio(ratio: str) -> tuple[float, float]:
    """"9:16" -> (9.0, 16.0). Raises ReframeError on anything malformed
    rather than a bare ValueError, so callers get a consistent
    exception type to handle."""
    try:
        w_str, h_str = ratio.split(":")
        return float(w_str), float(h_str)
    except (ValueError, AttributeError) as exc:
        raise ReframeError(f"Malformed ratio string: {ratio!r}") from exc


def target_dimensions_for_ratio(ratio: str, source_dims: tuple[int, int]) -> tuple[int, int] | None:
    """Computes real target pixel dimensions for the given ratio,
    scaled to match the SOURCE's own resolution — preserves the
    source's long-edge pixel count rather than forcing a fixed size.
    Both dimensions are rounded to even numbers, since H.264 (and most
    codecs) require it."""
    try:
        ratio_w, ratio_h = parse_ratio(ratio)
    except ReframeError:
        return None
    sw, sh = source_dims
    long_edge = max(sw, sh)
    if ratio_h > ratio_w:
        # Target is portrait-leaning (or square) — height is the long edge.
        target_h = long_edge
        target_w = long_edge * (ratio_w / ratio_h)
    else:
        target_w = long_edge
        target_h = long_edge * (ratio_h / ratio_w)
    # Round to even — odd dimensions break yuv420p encoding.
    tw = int(round(target_w / 2) * 2)
    th = int(round(target_h / 2) * 2)
    return max(tw, 2), max(th, 2)


def needs_reframe(source_dims: tuple[int, int], target_dims: tuple[int, int], tolerance: float = 0.03) -> bool:
    """Skips reframing when the source is already close enough to the
    target ratio that padding would be negligible (a couple percent
    off, e.g. 1.91:1 vs a model's native 1.9:1) — avoids a pointless
    extra encode for what would be an imperceptible sliver of padding."""
    sw, sh = source_dims
    tw, th = target_dims
    source_ratio = sw / sh
    target_ratio = tw / th
    return abs(source_ratio - target_ratio) / target_ratio > tolerance


def reframe_video(source_video_url: str, target_ratio: str, brand_kit) -> bytes:
    """Downloads the source video, scales it to fit entirely within the
    target dimensions (no cropping — the whole frame is always
    preserved), and pads the leftover space using the company's Brand
    Kit preference for whichever direction actually needs padding.
    Returns the reframed video's raw bytes, ready to upload.

    brand_kit is the ORM object (or anything with the same attribute
    names) — vertical_pad_mode/horizontal_pad_mode plus the four image
    URLs and two colors. Only the direction actually needed is ever
    read; a company that's only configured, say, vertical padding never
    has horizontal_pad_mode consulted if this specific conversion only
    needs vertical padding.
    """
    with tempfile.TemporaryDirectory(prefix="reframe-") as tmp:
        tmp_path = Path(tmp)
        source_path = tmp_path / "source.mp4"
        source_bytes, _ = storage.fetch_bytes(source_video_url)
        source_path.write_bytes(source_bytes)

        sw, sh = _probe_dimensions(source_path)
        target_dims = target_dimensions_for_ratio(target_ratio, (sw, sh))
        if target_dims is None:
            raise ReframeError(f"Unknown or malformed target ratio: {target_ratio}")
        tw, th = target_dims

        if not needs_reframe((sw, sh), target_dims):
            logger.info("[reframe] source %dx%d already close enough to target %s — skipping, using source as-is", sw, sh, target_ratio)
            return source_bytes

        # Which direction needs padding: comparing the source's own
        # aspect ratio against the target's tells us whether fitting the
        # source inside the target leaves space on the sides (source is
        # relatively taller/narrower than target -> horizontal padding)
        # or top/bottom (source is relatively wider than target ->
        # vertical padding). Never both — a fit-scale by definition
        # matches exactly on one axis.
        source_ratio = sw / sh
        target_ratio_value = tw / th
        vertical_padding_needed = source_ratio > target_ratio_value  # source is proportionally WIDER than target -> extra height must be filled

        output_path = tmp_path / f"{uuid.uuid4()}.mp4"

        if vertical_padding_needed:
            mode = brand_kit.vertical_pad_mode
            fill_image_urls = (brand_kit.pad_top_image_url, brand_kit.pad_bottom_image_url)
            fill_color = brand_kit.vertical_pad_color
        else:
            mode = brand_kit.horizontal_pad_mode
            fill_image_urls = (brand_kit.pad_left_image_url, brand_kit.pad_right_image_url)
            fill_color = brand_kit.horizontal_pad_color

        # An "image" mode with nothing actually uploaded for this
        # direction has nothing to composite — fall back to blurred
        # video rather than erroring or silently ignoring the choice.
        if mode == "image" and not any(fill_image_urls):
            mode = "blurred_video"
        if mode == "color" and not fill_color:
            mode = "blurred_video"

        if mode == "color":
            _reframe_with_color(source_path, output_path, tw, th, fill_color)
        elif mode == "image":
            _reframe_with_images(source_path, output_path, tw, th, fill_image_urls, vertical_padding_needed, tmp_path)
        else:
            _reframe_with_blurred_video(source_path, output_path, tw, th)

        return output_path.read_bytes()


def _reframe_with_color(source_path: Path, output_path: Path, tw: int, th: int, color: str) -> None:
    color_ffmpeg = color.lstrip("#") if color else "000000"
    vf = f"scale={tw}:{th}:force_original_aspect_ratio=decrease,pad={tw}:{th}:(ow-iw)/2:(oh-ih)/2:color=0x{color_ffmpeg}"
    _run(["ffmpeg", "-y", "-i", str(source_path), "-vf", vf, "-c:a", "copy", str(output_path)])


def _reframe_with_blurred_video(source_path: Path, output_path: Path, tw: int, th: int) -> None:
    # split the source into two copies in the filter graph: one becomes
    # a blurred, cropped-to-fill background; the other is the real,
    # untouched foreground, fit-scaled and centered on top.
    filter_complex = (
        f"[0:v]split=2[main][bgsrc];"
        f"[bgsrc]scale={tw}:{th}:force_original_aspect_ratio=increase,crop={tw}:{th},gblur=sigma=20[bg];"
        f"[main]scale={tw}:{th}:force_original_aspect_ratio=decrease[fg];"
        f"[bg][fg]overlay=(W-w)/2:(H-h)/2[outv]"
    )
    _run(["ffmpeg", "-y", "-i", str(source_path), "-filter_complex", filter_complex, "-map", "[outv]", "-map", "0:a?", "-c:a", "copy", str(output_path)])


def _reframe_with_images(source_path: Path, output_path: Path, tw: int, th: int, fill_image_urls: tuple, vertical: bool, tmp_path: Path) -> None:
    """vertical=True means fill_image_urls is (top, bottom) and the fill
    images stack above/below the video; vertical=False means (left,
    right) stacked beside it. Either image can be missing (falls back
    to a plain black fill for that specific slot only, not the whole
    direction — a company might have uploaded just a bottom bar with
    contact info and nothing for the top)."""
    img_a_url, img_b_url = fill_image_urls
    img_paths = []
    for i, url in enumerate((img_a_url, img_b_url)):
        if url:
            data, _ = storage.fetch_bytes(url)
            p = tmp_path / f"pad_{i}.png"
            p.write_bytes(data)
            img_paths.append(p)
        else:
            img_paths.append(None)

    # Scale the source to fit within the target on the constrained
    # dimension, then compute how much padding space exists so the fill
    # images can be scaled to exactly fill their slot.
    if vertical:
        fg_w = tw
        fg_h = round(tw * (_probe_dimensions(source_path)[1] / _probe_dimensions(source_path)[0]))
        fg_h = min(fg_h, th)
        pad_each = max(0, (th - fg_h) // 2)
        inputs = ["-i", str(source_path)]
        filter_parts = [f"[0:v]scale={tw}:{fg_h}[fg]"]
        overlay_chain = "[fg]"
        next_idx = 1
        base = f"color=c=black:s={tw}x{th}[base]"
        filter_parts.insert(0, base)
        chain = "[base]"
        if img_paths[0] and pad_each > 0:
            inputs += ["-i", str(img_paths[0])]
            filter_parts.append(f"[{next_idx}:v]scale={tw}:{pad_each}[topimg]")
            chain_next = f"[topovl{next_idx}]"
            filter_parts.append(f"{chain}[topimg]overlay=0:0{chain_next}")
            chain = chain_next
            next_idx += 1
        if img_paths[1] and pad_each > 0:
            inputs += ["-i", str(img_paths[1])]
            filter_parts.append(f"[{next_idx}:v]scale={tw}:{pad_each}[botimg]")
            chain_next = f"[botovl{next_idx}]"
            filter_parts.append(f"{chain}[botimg]overlay=0:{th - pad_each}{chain_next}")
            chain = chain_next
            next_idx += 1
        filter_parts.append(f"{chain}[fg]overlay=0:{pad_each}[outv]")
    else:
        source_dims = _probe_dimensions(source_path)
        fg_h = th
        fg_w = min(round(th * (source_dims[0] / source_dims[1])), tw)
        pad_each = max(0, (tw - fg_w) // 2)
        inputs = ["-i", str(source_path)]
        filter_parts = [f"color=c=black:s={tw}x{th}[base]", f"[0:v]scale={fg_w}:{th}[fg]"]
        chain = "[base]"
        next_idx = 1
        if img_paths[0] and pad_each > 0:
            inputs += ["-i", str(img_paths[0])]
            filter_parts.append(f"[{next_idx}:v]scale={pad_each}:{th}[leftimg]")
            chain_next = f"[leftovl{next_idx}]"
            filter_parts.append(f"{chain}[leftimg]overlay=0:0{chain_next}")
            chain = chain_next
            next_idx += 1
        if img_paths[1] and pad_each > 0:
            inputs += ["-i", str(img_paths[1])]
            filter_parts.append(f"[{next_idx}:v]scale={pad_each}:{th}[rightimg]")
            chain_next = f"[rightovl{next_idx}]"
            filter_parts.append(f"{chain}[rightimg]overlay={tw - pad_each}:0{chain_next}")
            chain = chain_next
            next_idx += 1
        filter_parts.append(f"{chain}[fg]overlay={pad_each}:0[outv]")

    filter_complex = ";".join(filter_parts)
    _run(["ffmpeg", "-y", *inputs, "-filter_complex", filter_complex, "-map", "[outv]", "-map", "0:a?", "-c:a", "copy", "-shortest", str(output_path)])


# ---------------------------------------------------------------------------
# Image reframing — same design as video (scale-to-fit, pad, never crop),
# but with its OWN independent Brand Kit settings (image_vertical_pad_mode/
# image_horizontal_pad_mode, the four image_pad_*_image_url bars, the two
# image_*_pad_color colors) — split out from video's settings so a company
# can, say, use a blurred background for video but branded color bars for
# static image posts. Uses Pillow instead of ffmpeg, since a single frame
# doesn't need a video-processing tool.
# ---------------------------------------------------------------------------
from io import BytesIO

from PIL import Image, ImageFilter


FONT_PATHS = {
    "sans": "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "sans_bold": "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "serif": "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf",
}


def strip_audio(video_bytes: bytes) -> bytes:
    """Removes any audio track — the video stream is copied as-is
    (`-c:v copy`, no re-encode), so this is fast and lossless. Used by
    the Brand Kit shot pipeline when the customer asked for a silent
    clip: sending audio=False to the model is the first line of
    defense, but not every model/provider honors it, so the returned
    file is stripped here regardless — the flag is a request, this is
    the guarantee."""
    with tempfile.TemporaryDirectory(prefix="strip-audio-") as tmp:
        tmp_path = Path(tmp)
        source_path = tmp_path / "source.mp4"
        source_path.write_bytes(video_bytes)
        output_path = tmp_path / "silent.mp4"
        _run(["ffmpeg", "-y", "-i", str(source_path), "-an", "-c:v", "copy", str(output_path)])
        return output_path.read_bytes()


def extract_last_frame(video_bytes: bytes) -> bytes:
    """Grabs the video's last frame as a JPEG — used as a static gallery
    thumbnail (see routers/brand_kit.py, tasks.generate_brand_video_shot)
    instead of autoplaying the clip inline in a small card. `-sseof -0.1`
    seeks to 0.1s before end-of-file rather than trying to compute an
    exact duration first — simpler and avoids an extra ffprobe call."""
    with tempfile.TemporaryDirectory(prefix="lastframe-") as tmp:
        tmp_path = Path(tmp)
        source_path = tmp_path / "source.mp4"
        source_path.write_bytes(video_bytes)
        output_path = tmp_path / "frame.jpg"
        _run(["ffmpeg", "-y", "-sseof", "-0.1", "-i", str(source_path), "-vframes", "1", "-q:v", "3", str(output_path)])
        return output_path.read_bytes()


# x/y ffmpeg drawtext expressions per axis — combined below per anchor.
# Margins (0.06w / 0.08h) keep text off the very edge; anchors never
# include a "middle_center" x "middle" y combination (see
# ANCHOR_EXPRESSIONS) since that's roughly where a referenced logo tends
# to land, and there's no way to know its exact AI-generated position.
_X_EXPR = {"left": "w*0.06", "center": "(w-text_w)/2", "right": "w-text_w-w*0.06"}
_Y_EXPR = {"top": "h*0.08", "middle": "(h-text_h)/2", "bottom": "h-text_h-h*0.08"}

ANCHOR_EXPRESSIONS = {
    "top_left": ("left", "top"), "top_center": ("center", "top"), "top_right": ("right", "top"),
    "middle_left": ("left", "middle"), "middle_center": ("center", "middle"), "middle_right": ("right", "middle"),
    "bottom_left": ("left", "bottom"), "bottom_center": ("center", "bottom"), "bottom_right": ("right", "bottom"),
}


FONT_SIZE_FACTORS = {"small": 0.032, "medium": 0.042, "large": 0.055}  # fontsize as a fraction of video height — the old fixed 0.05 read too large in practice


def add_text_overlay(video_bytes: bytes, text: str, font: str = "sans", color: str = "#ffffff", anchor: str = "bottom_center", size: str = "medium") -> bytes:
    """Burns text onto a video via ffmpeg's drawtext filter — used for a
    Brand Kit shot's contact-info/website line (see routers/brand_kit.py
    and tasks.generate_brand_video_shot). Deliberately NOT asked of the
    AI video model itself: video models are unreliable at rendering
    exact, legible text, so this gets the "AI does the visuals, code
    renders the exact text" split the app already uses for logo
    compositing on images (see branding.py's composite_logo) — same
    principle, applied to video.

    `anchor` is one of the 9 keys in ANCHOR_EXPRESSIONS (top/middle/
    bottom × left/center/right); `size` is one of FONT_SIZE_FACTORS.

    Each line is rendered as its OWN drawtext filter rather than one
    multi-line drawtext: with a single drawtext, x=(w-text_w)/2 centers
    the whole text BLOCK, but the lines inside that block stay
    left-aligned against each other (drawtext has no per-line alignment
    on the ffmpeg version shipped in this image) — so "Contact us" over
    "www.example.com" looked centered as a block but ragged-left within
    it. One drawtext per line means each line's own text_w drives its
    own centering, which is what a centered caption is actually
    supposed to look like. Left/right anchors get the same treatment:
    every line aligns to the same margin. Line positions are computed
    as fractions of video height (line height = fontsize × 1.35), and
    blank lines are skipped for drawing but still advance the y
    position, preserving intentional spacing.

    Text is written to a temp file per line and referenced via
    drawtext's `textfile=` option rather than passed inline, which
    sidesteps needing to escape colons/quotes for ffmpeg's
    filter-string syntax.
    """
    font_path = FONT_PATHS.get(font, FONT_PATHS["sans"])
    factor = FONT_SIZE_FACTORS.get(size, FONT_SIZE_FACTORS["medium"])

    lines = text.splitlines() or [text]
    while lines and not lines[0].strip():
        lines.pop(0)
    while lines and not lines[-1].strip():
        lines.pop()
    if not lines:
        return video_bytes
    n = len(lines)

    x_key, y_key = ANCHOR_EXPRESSIONS.get(anchor, ANCHOR_EXPRESSIONS["bottom_center"])
    color_ffmpeg = color.lstrip("#") if color else "ffffff"

    with tempfile.TemporaryDirectory(prefix="overlay-") as tmp:
        tmp_path = Path(tmp)
        source_path = tmp_path / "source.mp4"
        source_path.write_bytes(video_bytes)

        # Everything below is computed in ABSOLUTE pixels from the
        # video's probed height rather than h-relative expressions:
        # boxborderw only accepts a constant, so it can't scale via an
        # expression — and a constant border that isn't derived from the
        # actual fontsize made adjacent lines' boxes overlap at small
        # sizes. Deriving all three (fontsize, border, line step) from
        # the same probed height keeps them proportioned to each other
        # at any resolution.
        _, vh = _probe_dimensions(source_path)
        font_px = max(8, round(vh * factor))
        border_px = max(3, round(font_px * 0.3))
        line_step = font_px + border_px * 2 + max(2, round(font_px * 0.15))  # each line's box clears the previous one with a small gap
        margin = round(vh * 0.08)
        block_h = line_step * n

        if y_key == "top":
            block_top = margin
        elif y_key == "middle":
            block_top = round((vh - block_h) / 2)
        else:  # bottom
            block_top = vh - margin - block_h

        filters = []
        for i, line in enumerate(lines):
            if not line.strip():
                continue  # blank line: no box drawn, but i still advances the block's spacing
            text_path = tmp_path / f"line{i}.txt"
            text_path.write_text(line)
            y_px = block_top + i * line_step + border_px  # drawtext's y is the TEXT top; leave room for the box border above it
            filters.append(
                f"drawtext=fontfile={font_path}:textfile={text_path}:fontcolor=0x{color_ffmpeg}:"
                f"fontsize={font_px}:x={_X_EXPR[x_key]}:y={y_px}:"
                f"box=1:boxcolor=black@0.45:boxborderw={border_px}"
            )
        output_path = tmp_path / "overlaid.mp4"
        _run(["ffmpeg", "-y", "-i", str(source_path), "-vf", ",".join(filters), "-c:a", "copy", str(output_path)])
        return output_path.read_bytes()


def probe_video_url_dimensions(video_url: str) -> tuple[int, int]:
    """Downloads just enough to read a video's pixel dimensions — used by
    the intro/outro stitching pipeline (tasks.py) to learn the MAIN
    video's own resolution, so intro/outro clips can be forced to those
    exact same pixel dimensions (not just the same ratio) before concat.
    """
    with tempfile.TemporaryDirectory(prefix="probe-") as tmp:
        tmp_path = Path(tmp) / "source.mp4"
        source_bytes, _ = storage.fetch_bytes(video_url)
        tmp_path.write_bytes(source_bytes)
        return _probe_dimensions(tmp_path)


def reframe_video_to_dims(source_video_url: str, tw: int, th: int, brand_kit) -> bytes:
    """Like reframe_video, but forces the source to EXACT pixel
    dimensions (tw, th) — no deriving target size from the source's own
    resolution, and no "close enough, skip" shortcut. Used only by the
    intro/outro stitching pipeline (tasks.py): every clip being
    concatenated together (intro/main/outro) must match pixel-for-pixel,
    not just share a ratio — two clips generated at different native
    resolutions can both be "9:16" while landing on different absolute
    sizes if each computed its own target independently, which is
    exactly what plain reframe_video does (by design, for the normal
    single-video case where that doesn't matter)."""
    with tempfile.TemporaryDirectory(prefix="reframe-exact-") as tmp:
        tmp_path = Path(tmp)
        source_path = tmp_path / "source.mp4"
        source_bytes, _ = storage.fetch_bytes(source_video_url)
        source_path.write_bytes(source_bytes)

        sw, sh = _probe_dimensions(source_path)
        source_ratio = sw / sh
        target_ratio_value = tw / th
        vertical_padding_needed = source_ratio > target_ratio_value

        if vertical_padding_needed:
            mode = brand_kit.vertical_pad_mode
            fill_image_urls = (brand_kit.pad_top_image_url, brand_kit.pad_bottom_image_url)
            fill_color = brand_kit.vertical_pad_color
        else:
            mode = brand_kit.horizontal_pad_mode
            fill_image_urls = (brand_kit.pad_left_image_url, brand_kit.pad_right_image_url)
            fill_color = brand_kit.horizontal_pad_color
        if mode == "image" and not any(fill_image_urls):
            mode = "blurred_video"
        if mode == "color" and not fill_color:
            mode = "blurred_video"

        output_path = tmp_path / f"{uuid.uuid4()}.mp4"
        if mode == "color":
            _reframe_with_color(source_path, output_path, tw, th, fill_color)
        elif mode == "image":
            _reframe_with_images(source_path, output_path, tw, th, fill_image_urls, vertical_padding_needed, tmp_path)
        else:
            _reframe_with_blurred_video(source_path, output_path, tw, th)
        return output_path.read_bytes()


def _probe_has_audio(path: Path) -> bool:
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=codec_type", "-of", "csv=p=0", str(path)],
        capture_output=True, timeout=30,
    )
    return result.returncode == 0 and b"audio" in result.stdout


def _probe_duration(path: Path) -> float:
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
        capture_output=True, timeout=30,
    )
    if result.returncode != 0:
        raise ReframeError(f"ffprobe duration failed: {result.stderr.decode('utf-8', errors='replace')}")
    return float(result.stdout.decode().strip())


def concat_video_clips(clip_bytes_list: list[bytes]) -> bytes:
    """Concatenates 2+ video clips end-to-end via ffmpeg's concat filter
    — e.g. [intro, main, outro] into one final video. Every clip MUST
    already be the exact same pixel dimensions (see
    reframe_video_to_dims above) — this does no scaling of its own,
    only an fps normalization pass (AI video models don't all generate
    at the same frame rate, and concat assumes a consistent one).

    AUDIO IS PRESERVED. ffmpeg's concat filter requires every input to
    share the same stream layout — a mix of with-audio and audio-less
    clips fails outright, which is why the first version of this
    function stripped audio entirely. Instead of stripping, the layout
    is now NORMALIZED: any clip without an audio stream gets a
    generated silence track of exactly its own duration (anullsrc,
    stereo/48kHz), and real audio is resampled to the same format and
    trimmed/padded to its clip's length. So a with-audio main video
    between two silent brand shots comes out as silence → ad audio →
    silence, all in one continuous track. Only if NO clip has audio at
    all does the output stay video-only (nothing to preserve, no point
    encoding a silent track).
    """
    if len(clip_bytes_list) < 2:
        raise ReframeError("concat_video_clips needs at least 2 clips")
    with tempfile.TemporaryDirectory(prefix="concat-") as tmp:
        tmp_path = Path(tmp)
        n = len(clip_bytes_list)
        paths: list[Path] = []
        for i, clip_bytes in enumerate(clip_bytes_list):
            p = tmp_path / f"clip{i}.mp4"
            p.write_bytes(clip_bytes)
            paths.append(p)

        has_audio = [_probe_has_audio(p) for p in paths]
        any_audio = any(has_audio)

        input_args: list[str] = []
        for p in paths:
            input_args += ["-i", str(p)]

        filter_stages: list[str] = []
        for i in range(n):
            filter_stages.append(f"[{i}:v:0]fps=30[v{i}]")

        if not any_audio:
            concat_inputs = "".join(f"[v{i}]" for i in range(n))
            filter_complex = ";".join(filter_stages) + f";{concat_inputs}concat=n={n}:v=1:a=0[outv]"
            output_path = tmp_path / "stitched.mp4"
            _run(["ffmpeg", "-y", *input_args, "-filter_complex", filter_complex, "-map", "[outv]", "-an", str(output_path)], timeout=180)
            return output_path.read_bytes()

        # At least one clip has real audio — build a consistent a/v
        # layout. Audio-less clips reference extra anullsrc inputs
        # (appended after the real inputs), trimmed to that clip's own
        # probed duration so the silence occupies exactly its slot.
        durations = [_probe_duration(p) for p in paths]
        silent_input_index: dict[int, int] = {}
        next_input = n
        for i in range(n):
            if not has_audio[i]:
                input_args += ["-f", "lavfi", "-t", f"{durations[i]:.3f}", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000"]
                silent_input_index[i] = next_input
                next_input += 1

        for i in range(n):
            if has_audio[i]:
                # Normalize real audio to one format, and pin it to its
                # clip's video length (trim if longer, pad with silence
                # if shorter) so audio/video never drift across the seam.
                filter_stages.append(
                    f"[{i}:a:0]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,"
                    f"atrim=0:{durations[i]:.3f},asetpts=PTS-STARTPTS,apad=whole_dur={durations[i]:.3f}[a{i}]"
                )
            else:
                filter_stages.append(f"[{silent_input_index[i]}:a:0]asetpts=PTS-STARTPTS[a{i}]")

        concat_inputs = "".join(f"[v{i}][a{i}]" for i in range(n))
        filter_complex = ";".join(filter_stages) + f";{concat_inputs}concat=n={n}:v=1:a=1[outv][outa]"
        output_path = tmp_path / "stitched.mp4"
        _run([
            "ffmpeg", "-y", *input_args, "-filter_complex", filter_complex,
            "-map", "[outv]", "-map", "[outa]", "-c:a", "aac", "-b:a", "128k", str(output_path),
        ], timeout=180)
        return output_path.read_bytes()


def _fit_and_pad_image(img: "Image.Image", target_ratio: str, mode: str, fill_image_urls: tuple, fill_color: str | None) -> bytes:
    """Shared core for reframe_image and prepare_video_reference_frame:
    scales `img` to fit entirely within the target ratio (never
    cropping the subject) and fills the leftover space per the already-
    resolved mode/fill. If `img` already has real alpha transparency
    (a proper logo export, not a flat rectangle), this naturally "just
    isolates" the subject onto the padded background — Pillow's alpha-
    aware paste only draws the non-transparent pixels. A logo exported
    WITHOUT transparency (an opaque rectangle) can't be isolated this
    way — there's no reliable way to detect/remove an arbitrary flat
    background without real image segmentation, which is out of scope
    here; the whole rectangle just gets fit-and-padded as one image in
    that case, background and all."""
    sw, sh = img.size
    target_dims = target_dimensions_for_ratio(target_ratio, (sw, sh))
    if target_dims is None:
        raise ReframeError(f"Unknown or malformed target ratio: {target_ratio}")
    tw, th = target_dims

    if not needs_reframe((sw, sh), target_dims):
        buf = BytesIO()
        img.save(buf, format="PNG")
        return buf.getvalue()

    source_ratio = sw / sh
    target_ratio_value = tw / th
    vertical_padding_needed = source_ratio > target_ratio_value

    if mode == "image" and not any(fill_image_urls):
        mode = "blurred_video"
    if mode == "color" and not fill_color:
        mode = "blurred_video"

    scale = min(tw / sw, th / sh)
    fg_w, fg_h = max(1, round(sw * scale)), max(1, round(sh * scale))
    fg = img.resize((fg_w, fg_h), Image.LANCZOS)
    paste_x = (tw - fg_w) // 2
    paste_y = (th - fg_h) // 2

    if mode == "color":
        color_hex = (fill_color or "#000000").lstrip("#")
        rgb = tuple(int(color_hex[i:i + 2], 16) for i in (0, 2, 4)) if len(color_hex) == 6 else (0, 0, 0)
        canvas = Image.new("RGBA", (tw, th), rgb + (255,))
    elif mode == "image":
        canvas = Image.new("RGBA", (tw, th), (0, 0, 0, 255))
        img_a_url, img_b_url = fill_image_urls
        if vertical_padding_needed:
            if img_a_url and paste_y > 0:
                data, _ = storage.fetch_bytes(img_a_url)
                bar = Image.open(BytesIO(data)).convert("RGBA").resize((tw, paste_y), Image.LANCZOS)
                canvas.paste(bar, (0, 0))
            if img_b_url and (th - (paste_y + fg_h)) > 0:
                bottom_h = th - (paste_y + fg_h)
                data, _ = storage.fetch_bytes(img_b_url)
                bar = Image.open(BytesIO(data)).convert("RGBA").resize((tw, bottom_h), Image.LANCZOS)
                canvas.paste(bar, (0, paste_y + fg_h))
        else:
            if img_a_url and paste_x > 0:
                data, _ = storage.fetch_bytes(img_a_url)
                bar = Image.open(BytesIO(data)).convert("RGBA").resize((paste_x, th), Image.LANCZOS)
                canvas.paste(bar, (0, 0))
            if img_b_url and (tw - (paste_x + fg_w)) > 0:
                right_w = tw - (paste_x + fg_w)
                data, _ = storage.fetch_bytes(img_b_url)
                bar = Image.open(BytesIO(data)).convert("RGBA").resize((right_w, th), Image.LANCZOS)
                canvas.paste(bar, (paste_x + fg_w, 0))
    else:
        # Blurred background — the source itself, scaled to fill and
        # cropped to the target's shape, then blurred.
        bg_scale = max(tw / sw, th / sh)
        bg_w, bg_h = max(1, round(sw * bg_scale)), max(1, round(sh * bg_scale))
        bg = img.resize((bg_w, bg_h), Image.LANCZOS)
        crop_x = (bg_w - tw) // 2
        crop_y = (bg_h - th) // 2
        bg = bg.crop((crop_x, crop_y, crop_x + tw, crop_y + th))
        canvas = bg.filter(ImageFilter.GaussianBlur(radius=30)).convert("RGBA")

    canvas.paste(fg, (paste_x, paste_y), fg)
    buf = BytesIO()
    canvas.convert("RGB").save(buf, format="PNG")
    return buf.getvalue()


def prepare_video_reference_frame(source_image_url: str, target_ratio: str, brand_kit) -> bytes:
    """Prepares a Brand Logo as a video generation starting frame —
    fit-and-padded into the shot's TARGET ratio using the company's
    VIDEO padding settings (not image padding), BEFORE the AI ever
    sees it. This is the fix for a specific failure mode: a 16:9 logo
    reference sent as-is to a video model, then the resulting video
    reframed to (say) 1:1 afterward, produces two visibly different
    padding styles stacked on top of each other — the logo's own
    original background/framing plus a second, differently-styled pad
    added later. Preparing the reference frame in the right shape and
    style FIRST means the AI's whole generation starts from something
    that already matches how the final video will look, so there's
    nothing left to mismatch.

    Uses the VIDEO (not image) padding fields specifically, since the
    goal is matching how THIS video will eventually be padded, not how
    a static image post would be."""
    source_bytes, _ = storage.fetch_bytes(source_image_url)
    img = Image.open(BytesIO(source_bytes)).convert("RGBA")
    sw, sh = img.size
    target_dims = target_dimensions_for_ratio(target_ratio, (sw, sh))
    if target_dims is None:
        raise ReframeError(f"Unknown or malformed target ratio: {target_ratio}")
    tw, th = target_dims
    source_ratio = sw / sh
    target_ratio_value = tw / th
    vertical_padding_needed = source_ratio > target_ratio_value

    if vertical_padding_needed:
        mode = brand_kit.vertical_pad_mode
        fill_image_urls = (brand_kit.pad_top_image_url, brand_kit.pad_bottom_image_url)
        fill_color = brand_kit.vertical_pad_color
    else:
        mode = brand_kit.horizontal_pad_mode
        fill_image_urls = (brand_kit.pad_left_image_url, brand_kit.pad_right_image_url)
        fill_color = brand_kit.horizontal_pad_color

    return _fit_and_pad_image(img, target_ratio, mode, fill_image_urls, fill_color)


def reframe_image(source_image_url: str, target_ratio: str, brand_kit) -> bytes:
    """Downloads the source image, scales it to fit entirely within the
    target dimensions (no cropping), and pads the leftover space using
    the company's Brand Kit preference for whichever direction actually
    needs padding. Returns the reframed image's raw bytes (PNG)."""
    source_bytes, _ = storage.fetch_bytes(source_image_url)
    img = Image.open(BytesIO(source_bytes)).convert("RGBA")
    sw, sh = img.size

    target_dims = target_dimensions_for_ratio(target_ratio, (sw, sh))
    if target_dims is None:
        raise ReframeError(f"Unknown or malformed target ratio: {target_ratio}")
    tw, th = target_dims
    source_ratio = sw / sh
    target_ratio_value = tw / th
    vertical_padding_needed = source_ratio > target_ratio_value

    if vertical_padding_needed:
        mode = brand_kit.image_vertical_pad_mode
        fill_image_urls = (brand_kit.image_pad_top_image_url, brand_kit.image_pad_bottom_image_url)
        fill_color = brand_kit.image_vertical_pad_color
    else:
        mode = brand_kit.image_horizontal_pad_mode
        fill_image_urls = (brand_kit.image_pad_left_image_url, brand_kit.image_pad_right_image_url)
        fill_color = brand_kit.image_horizontal_pad_color

    return _fit_and_pad_image(img, target_ratio, mode, fill_image_urls, fill_color)
