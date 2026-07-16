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

# Base sizes per ratio, matching common social export standards — long
# edge is 1080px for anything not already covered by a well-known
# preset. Keyed by the exact ratio strings used in the platform
# settings (see services/platform_ratios.py).
_RATIO_DIMENSIONS = {
    "1:1": (1080, 1080),
    "9:16": (1080, 1920),
    "16:9": (1920, 1080),
    "1.91:1": (1080, 565),
    "4:5": (1080, 1350),
}


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


def target_dimensions_for_ratio(ratio: str) -> tuple[int, int] | None:
    return _RATIO_DIMENSIONS.get(ratio)


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
    target_dims = target_dimensions_for_ratio(target_ratio)
    if target_dims is None:
        raise ReframeError(f"Unknown target ratio: {target_ratio}")
    tw, th = target_dims

    with tempfile.TemporaryDirectory(prefix="reframe-") as tmp:
        tmp_path = Path(tmp)
        source_path = tmp_path / "source.mp4"
        source_bytes, _ = storage.fetch_bytes(source_video_url)
        source_path.write_bytes(source_bytes)

        sw, sh = _probe_dimensions(source_path)
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
