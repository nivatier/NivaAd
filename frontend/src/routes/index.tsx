import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useRef, useCallback, useEffect } from "react";
import adPulse from "@/assets/ad-pulse.jpg";
import adVolt from "@/assets/ad-volt.jpg";
import adEmber from "@/assets/ad-ember.jpg";
import adLumiere from "@/assets/ad-lumiere.jpg";
import adShades from "@/assets/shades.webp";
import adEarbuds from "@/assets/earbud.webp";
import { ThemeToggle } from "@/components/theme-toggle";
import { LoginModal } from "@/components/login-modal";
import { useAuth } from "@/hooks/use-auth";
import { Play, X, Layers, Package, Megaphone, Zap, Bot } from "lucide-react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Dialog, DialogOverlay, DialogPortal } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  component: Index,
});

// VIMEO_ID is now loaded at runtime from /public/platform-config
const FALLBACK_VIMEO_ID = "1213550777";

const platforms = [
  { tag: "Instagram", title: "Pulse One Smartwatch", copy: "Your health, one glance away. 7-day battery.", img: adPulse },
  { tag: "TikTok", title: "Volt Runners", copy: "Engineered for the streets. Featherlight. -20% launch.", img: adVolt },
  { tag: "Facebook", title: "Ember Cold Brew", copy: "Slow-steeped 18 hours. Zero bitterness. Free shipping.", img: adEmber },
  { tag: "LinkedIn", title: "Lumière Serum", copy: "Clinically proven glow in 14 days. Dermatologist approved.", img: adLumiere },
];

// ── Animated section divider ─────────────────────────────────────────────────
// Uses a CSS-only sweep — no JS, no RAF, GPU-composited translateX only
function GlowDivider() {
  return (
    <div className="relative h-px w-full overflow-hidden" aria-hidden>
      <div className="absolute inset-0 bg-border/40" />
      <div
        className="absolute inset-0 animate-wave"
        style={{
          background:
            "linear-gradient(90deg, transparent 0%, oklch(0.85 0.18 210 / 0.0) 20%, oklch(0.85 0.18 210 / 0.95) 48%, oklch(0.66 0.26 305 / 0.95) 52%, oklch(0.66 0.26 305 / 0.0) 80%, transparent 100%)",
          width: "200%",
        }}
      />
    </div>
  );
}

// ── Scene definitions ────────────────────────────────────────────────────────
const SCENES = [
  {
    id: "products",
    icon: Package,
    label: "Products",
    headline: "Save once.\nUse forever.",
    body: "Store your product name, description, images and brand voice — NivaSpark pulls from this every time you create an ad.",
    stat: "3 products saved",
    cardTitle: "What gets stored",
    cardPoints: ["Product name & description", "Images & brand colours", "Brand voice & tone", "Target audience"],
  },
  {
    id: "themes",
    icon: Layers,
    label: "Themes Gallery",
    headline: "Your ad,\nyour aesthetic.",
    body: "Choose from image and video templates built for every platform ratio — Instagram square, LinkedIn banner, TikTok vertical and more.",
    stat: "40+ templates",
    cardTitle: "Template formats",
    cardPoints: ["Instagram 1:1 & 4:5", "TikTok 9:16 vertical", "LinkedIn 1.91:1 banner", "Facebook & Threads feed"],
  },
  {
    id: "campaigns",
    icon: Megaphone,
    label: "Campaigns",
    headline: "One brief.\nThree-phase launch.",
    body: "Name your campaign and describe what it's for — NivaSpark writes teaser, launch and follow-up copy for every platform automatically.",
    stat: "Teaser → Launch → Follow-up",
    cardTitle: "What each phase does",
    cardPoints: ["Teaser — build anticipation before launch", "Launch — announce with full ad set", "Follow-up — re-engage and convert"],
  },
  {
    id: "posting",
    icon: Zap,
    label: "Post Everywhere",
    headline: "One click.\nSix platforms.",
    body: "Your ad goes live on every connected platform simultaneously — format, ratio and copy adapted for each automatically.",
    stat: "✓ Instagram  ✓ LinkedIn  ✓ TikTok  ✓ Facebook  ✓ X  ✓ Threads",
    cardTitle: "Auto-adapted per platform",
    cardPoints: ["Copy length trimmed to platform limits", "Hashtags added where relevant", "Ratio cropped per platform spec", "Best-time scheduling per channel"],
  },
  {
    id: "agent",
    icon: Bot,
    label: "Agent Niva",
    headline: "Your always-on\nad engine.",
    body: "Turn an idea into a full ad set. Scrape any website for product details. Auto-post on seasonal occasions. NivaSpark runs while you sleep.",
    stat: "Idea → Ad · Scrape · Schedule",
    cardTitle: "What Niva can do",
    cardPoints: ["Generate ads from a single idea", "Scrape any product URL automatically", "Schedule posts for key occasions", "Run campaigns without manual input"],
  },
] as const;

// Total scroll height = 100vh (sticky) + 5 scenes × 90vh each
const SCENE_HEIGHT = 90; // vh per scene
const TOTAL_SCROLL_VH = SCENE_HEIGHT * SCENES.length;

// ── Scroll-scrubber hero ─────────────────────────────────────────────────────
function ScrollHero({ onRegister }: { onRegister: () => void }) {
  const sectionRef = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState(0); // 0–1 across all scenes
  const [isDark, setIsDark] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);

  // Detect theme
  useEffect(() => {
    const check = () => setIsDark(document.documentElement.classList.contains("dark"));
    check();
    const obs = new MutationObserver(check);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);

  // Detect desktop breakpoint (lg = 1024px)
  useEffect(() => {
    const check = () => setIsDesktop(window.innerWidth >= 1024);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Scroll handler — uses absolute offsetTop so it works regardless of
  // whether the scroll event fires on window or a parent container.
  useEffect(() => {
    let ticking = false;
    const calc = () => {
      const el = sectionRef.current;
      if (!el) return;
      // offsetTop gives position relative to document, independent of scroll container
      const top = el.getBoundingClientRect().top + window.scrollY;
      const scrollable = el.offsetHeight - window.innerHeight;
      const scrolled = Math.max(0, window.scrollY - top);
      const p = scrollable > 0 ? Math.min(1, scrolled / scrollable) : 0;
      setProgress(p);
      ticking = false;
    };
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(calc);
    };
    // Also fire immediately so initial state is correct
    calc();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", calc);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", calc);
    };
  }, []);

  // Which scene is active + fractional position within it
  const sceneCount = SCENES.length;
  const rawScene = progress * sceneCount;           // 0 → sceneCount
  const activeIdx = Math.min(Math.floor(rawScene), sceneCount - 1);
  const sceneProgress = rawScene - Math.floor(rawScene); // 0–1 within scene

  // ── Mobile swipe-to-snap ──────────────────────────────────────────────────
  // Any intentional swipe (>=30 px) snaps exactly one scene forward/back.
  // Snaps to the CENTRE of the target scene so native momentum after touchend
  // cannot carry the page past into the next scene.
  const touchStartY = useRef<number | null>(null);
  const isSnapping = useRef(false);
  const activeIdxRef = useRef(activeIdx);
  activeIdxRef.current = activeIdx;

  const snapToScene = useCallback((targetIdx: number) => {
    const el = sectionRef.current;
    if (!el) return;
    const sectionTop = el.getBoundingClientRect().top + window.scrollY;
    const scrollable = el.offsetHeight - window.innerHeight;
    // Centre of target scene — momentum cannot overshoot into the next one.
    const fraction = (targetIdx + 0.5) / SCENES.length;
    const targetScroll = sectionTop + scrollable * fraction;
    isSnapping.current = true;
    window.scrollTo({ top: targetScroll, behavior: "smooth" });
    setTimeout(() => { isSnapping.current = false; }, 700);
  }, []);

  // Non-passive touchmove registered via useEffect — lets us call
  // preventDefault() to kill native scroll momentum during a snap.
  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const sticky = el.querySelector<HTMLElement>(".sticky");
    if (!sticky) return;
    const onMove = (e: TouchEvent) => {
      if (isSnapping.current) e.preventDefault();
    };
    sticky.addEventListener("touchmove", onMove, { passive: false });
    return () => sticky.removeEventListener("touchmove", onMove);
  }, []);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (isSnapping.current) return;
    touchStartY.current = e.touches[0].clientY;
  }, []);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (touchStartY.current === null || isSnapping.current) return;
    const delta = touchStartY.current - e.changedTouches[0].clientY;
    touchStartY.current = null;
    if (Math.abs(delta) < 30) return;
    const direction = delta > 0 ? 1 : -1;
    const current = activeIdxRef.current;
    const nextIdx = Math.min(SCENES.length - 1, Math.max(0, current + direction));
    if (nextIdx !== current) snapToScene(nextIdx);
  }, [snapToScene]);

  // Image set — 5 dark + 5 light
  const darkImages = [
    "/hero/Dark-01.webp",
    "/hero/Dark-02.webp",
    "/hero/Dark-03.webp",
    "/hero/Dark-04.webp",
    "/hero/Dark-05.webp",
  ];
  const lightImages = [
    "/hero/Light-01.webp",
    "/hero/Light-02.webp",
    "/hero/Light-03.webp",
    "/hero/Light-04.webp",
    "/hero/Light-05.webp",
  ];
  const images = isDark ? darkImages : lightImages;

  // Card visibility — fade in at 15% of scene, fade out at 85%
  const cardVisible = sceneProgress > 0.08 || activeIdx === 0;

  return (
    <div
      ref={sectionRef}
      className="relative"
      style={{ height: `calc(100vh + ${TOTAL_SCROLL_VH}vh)` }}
    >
      {/* ── Sticky viewport ── */}
      <div
        className="sticky top-0 h-screen w-full overflow-hidden"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >

        {/* ── Background images — crossfade ── */}
        <div className="absolute inset-0">
          {images.map((src, i) => {
            // Compute opacity for each image
            let opacity = 0;

            if (i === activeIdx) {
              // Active image: fully visible, fades out in last 20% of its scene
              if (sceneProgress > 0.8 && activeIdx < SCENES.length - 1) {
                opacity = 1 - (sceneProgress - 0.8) / 0.2;
              } else {
                opacity = 1;
              }
            } else if (i === activeIdx + 1) {
              // Next image: fades in during last 20% of current scene
              if (sceneProgress > 0.8) {
                opacity = (sceneProgress - 0.8) / 0.2;
              }
            }

            return (
              <img
                key={src}
                src={src}
                alt=""
                aria-hidden
                loading={i === 0 ? "eager" : "lazy"}
                className="absolute inset-0 h-full w-full object-cover"
                style={{
                  opacity,
                  transition: opacity > 0 ? "opacity 0.5s ease" : "none",
                  transform: i === activeIdx ? `scale(${1 + sceneProgress * 0.025})` : "scale(1)",
                  transition: "opacity 0.5s ease, transform 0.1s linear",
                  willChange: "opacity, transform",
                  zIndex: i === activeIdx ? 1 : i === activeIdx + 1 ? 2 : 0,
                }}
              />
            );
          })}
          {/* Gradient vignette — darkens edges so cards always read */}
          <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-transparent to-black/50" />
          <div className="absolute inset-0 bg-gradient-to-r from-black/20 via-transparent to-black/20" />
        </div>

        {/* ── Scene indicator dots — bottom centre ── */}
        <div className="absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 md:bottom-8">
          {SCENES.map((s, i) => (
            <div
              key={s.id}
              className="rounded-full transition-all duration-500"
              style={{
                width: i === activeIdx ? "24px" : "6px",
                height: "6px",
                background: i === activeIdx
                  ? "oklch(0.85 0.18 52)"
                  : "oklch(1 0 0 / 0.35)",
              }}
            />
          ))}
        </div>

        {/* ── Scroll hint — only at very top ── */}
        {progress < 0.04 && (
          <div
            aria-hidden
            className="absolute bottom-20 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 opacity-60 transition-opacity duration-500"
          >
            <span className="text-[10px] uppercase tracking-[0.2em] text-white">Scroll</span>
            <div className="h-8 w-px overflow-hidden rounded-full bg-white/30">
              <div className="h-1/2 w-full animate-bounce bg-white/80" />
            </div>
          </div>
        )}

        {/* ── Glass card ── */}
        <div className="absolute inset-x-0 bottom-0 z-10 flex items-end justify-center px-4 pb-16 lg:inset-0 lg:items-center lg:justify-end lg:px-0 lg:pb-0 lg:pr-16 xl:pr-24">
          <div
            className="w-full max-w-lg lg:max-w-md"
            style={{
              opacity: cardVisible ? 1 : 0,
              transform: cardVisible ? "translateY(0)" : "translateY(24px)",
              transition: "opacity 0.5s ease, transform 0.5s ease",
            }}
          >
            {SCENES.map((scene, i) => {
              const Icon = scene.icon;
              const isActive = i === activeIdx;
              return (
                <div
                  key={scene.id}
                  className="absolute inset-0"
                  style={{
                    opacity: isActive ? 1 : 0,
                    transition: "opacity 0.4s ease",
                    pointerEvents: isActive ? "auto" : "none",
                  }}
                >
                  {/* Glass card — adapts to light/dark via CSS */}
                  <div
                    className={cn(
                      "relative overflow-hidden rounded-2xl border p-5 lg:rounded-3xl lg:p-9",
                      // Dark mode glass — brighter, more visible
                      "dark:border-white/20 dark:bg-white/10",
                      // Light mode glass
                      "border-white/60 bg-white/55",
                    )}
                    style={{
                      backdropFilter: "blur(24px) saturate(1.4)",
                      WebkitBackdropFilter: "blur(24px) saturate(1.4)",
                      boxShadow: isDark
                        ? "0 8px 40px oklch(0 0 0 / 0.45), inset 0 1px 0 oklch(1 0 0 / 0.22), inset 0 -1px 0 oklch(0 0 0 / 0.10), 0 0 0 1px oklch(1 0 0 / 0.06)"
                        : "0 8px 40px oklch(0 0 0 / 0.12), inset 0 1px 0 oklch(1 0 0 / 0.9)",
                    }}
                  >
                    {/* Scene number */}
                    <div className="mb-2.5 flex items-center justify-between lg:mb-4">
                      <div className="flex items-center gap-2">
                        <div
                          className="grid h-9 w-9 place-items-center rounded-lg lg:h-12 lg:w-12 lg:rounded-xl"
                          style={{
                            background: "linear-gradient(135deg, oklch(0.85 0.18 52), oklch(0.72 0.22 45))",
                            boxShadow: "0 2px 8px oklch(0.72 0.22 45 / 0.4)",
                          }}
                        >
                          <Icon className="h-4 w-4 lg:h-5 lg:w-5 text-black" strokeWidth={2} />
                        </div>
                        <span
                          className="text-xs font-semibold uppercase tracking-[0.14em] lg:text-sm"
                          style={{ color: isDark ? "oklch(0.85 0.18 52)" : "oklch(0.45 0.18 52)" }}
                        >
                          {scene.label}
                        </span>
                      </div>
                      <span className={cn(
                        "text-xs font-medium",
                        isDark ? "text-white/30" : "text-black/30"
                      )}>
                        0{i + 1} / 0{SCENES.length}
                      </span>
                    </div>

                    {/* Card title */}
                    <p
                      className="text-xs font-bold uppercase tracking-[0.12em] mb-2.5 lg:text-sm lg:mb-4"
                      style={{ color: isDark ? "oklch(0.85 0.18 52)" : "oklch(0.45 0.18 52)" }}
                    >
                      {scene.cardTitle}
                    </p>

                    {/* Bullet points */}
                    <ul className="flex flex-col gap-2 lg:gap-3">
                      {scene.cardPoints.map((point) => (
                        <li
                          key={point}
                          className="flex items-start gap-2 text-sm leading-snug lg:gap-3 lg:text-base"
                          style={{
                            color: isDark ? "oklch(0.82 0.015 280)" : "oklch(0.25 0.02 270)",
                          }}
                        >
                          <span
                            className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full lg:mt-2 lg:h-2 lg:w-2"
                            style={{ background: isDark ? "oklch(0.85 0.18 52)" : "oklch(0.45 0.18 52)" }}
                          />
                          {point}
                        </li>
                      ))}
                    </ul>

                    {/* Progress bar — fills across the scene */}
                    <div className="mt-4 h-0.5 w-full overflow-hidden rounded-full bg-white/10 lg:mt-7">
                      <div
                        className="h-full rounded-full transition-none"
                        style={{
                          width: isActive ? `${sceneProgress * 100}%` : "0%",
                          background: "linear-gradient(90deg, oklch(0.85 0.18 52), oklch(0.72 0.22 45))",
                        }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Spacer so the absolute children have a reference height */}
            <div className="pointer-events-none invisible rounded-2xl border p-5 lg:rounded-3xl lg:p-7">
              <div className="h-9 w-9" />
              <div className="mt-2.5 h-3 w-24" />
              <ul className="mt-2.5 flex flex-col gap-2">
                {SCENES[0].cardPoints.map((p) => (
                  <li key={p} className="flex items-start gap-2 text-sm">{p}</li>
                ))}
              </ul>
              <div className="mt-4 h-0.5 w-full" />
            </div>
          </div>
        </div>

        {/* ── Left side — Scene 0: big hero copy. Scenes 1-4: large scene text ── */}
        <div
          className="absolute inset-x-0 top-0 z-10 flex flex-col justify-start px-5 pt-28 lg:inset-0 lg:justify-center lg:px-0 lg:pt-0 lg:pl-16 xl:pl-24"
          style={{ maxWidth: isDesktop ? "58%" : "100%", pointerEvents: "none" }}
        >
          {/* Scene 0 — initial hero copy, fades out on first scroll */}
          <div
            style={{
              opacity: Math.max(0, 1 - progress * 10),
              transform: `translateY(${progress * -48}px)`,
              transition: "none",
              position: "absolute",
              maxWidth: "min(100%, 640px)",
              pointerEvents: progress < 0.05 ? "auto" : "none",
            }}
          >
            <span
              className="inline-flex w-fit items-center gap-2 rounded-full border px-4 py-1.5 text-[11px] font-medium uppercase tracking-[0.18em]"
              style={{
                borderColor: isDark ? "rgba(255,255,255,0.55)" : "rgba(0,0,0,0.25)",
                background: isDark ? "rgba(255,255,255,0.18)" : "rgba(0,0,0,0.45)",
                color: "white",
                backdropFilter: "blur(10px)",
              }}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-current" />
              AI ad studio for product launches
            </span>
            <h1
              className="mt-4 font-display text-2xl font-bold leading-[1.02] tracking-tight sm:text-4xl md:text-5xl lg:mt-6 lg:text-6xl xl:text-7xl"
              style={{ color: "white", textShadow: "0 2px 12px rgba(0,0,0,0.9), 0 1px 4px rgba(0,0,0,0.95), 0 0 40px rgba(0,0,0,0.6)" }}
            >
              Describe your product.<br />
              <span style={{ color: "oklch(0.92 0.18 52)", textShadow: "0 2px 12px rgba(0,0,0,0.9), 0 1px 4px rgba(0,0,0,0.95), 0 0 40px rgba(0,0,0,0.6)" }}>Post everywhere.</span>
            </h1>
            <p
              className="mt-3 max-w-lg text-xs sm:text-sm md:text-base lg:mt-5 lg:text-lg"
              style={{ color: "rgba(255,255,255,0.92)", textShadow: "0 1px 8px rgba(0,0,0,0.9), 0 0 30px rgba(0,0,0,0.7)" }}
            >
              One brief — or just a product link — becomes ready-to-post ads with copy, image, video and carousels for every platform.
            </p>
            <div className="mt-4 flex flex-wrap gap-2 md:mt-7 md:gap-3" style={{ pointerEvents: "auto" }}>
              <button
                onClick={onRegister}
                className="rounded-full px-6 py-3 font-medium text-black text-sm shadow-lg"
                style={{
                  background: "linear-gradient(135deg, oklch(0.85 0.18 52), oklch(0.72 0.22 45))",
                  boxShadow: "0 4px 20px oklch(0.72 0.22 45 / 0.5)",
                }}
              >
                Create your first ad — free →
              </button>
              <Link
                to="/pricing"
                className="rounded-full border px-6 py-3 text-sm font-medium"
                style={{
                  borderColor: "rgba(255,255,255,0.35)",
                  background: "rgba(0,0,0,0.30)",
                  color: "white",
                  backdropFilter: "blur(10px)",
                }}
              >
                See pricing
              </Link>
            </div>
            <p className="mt-4 text-xs" style={{ color: "rgba(255,255,255,0.55)", textShadow: "0 1px 4px rgba(0,0,0,0.8)" }}>Free plan · no card required · transparent credits</p>
          </div>

          {/* Scenes 1–4 — large text replaces hero copy, same size and style */}
          {SCENES.map((scene, i) => {
            const Icon = scene.icon;
            // Scene i starts showing when progress > i/sceneCount
            // Each scene text fades in and out aligned with the scene
            const sceneStart = i / SCENES.length;
            const sceneEnd = (i + 1) / SCENES.length;
            const fadeDuration = 0.03; // fraction of total progress
            let textOpacity = 0;
            if (progress >= sceneStart + fadeDuration && progress < sceneEnd - fadeDuration) {
              textOpacity = 1;
            } else if (progress >= sceneStart && progress < sceneStart + fadeDuration) {
              textOpacity = (progress - sceneStart) / fadeDuration;
            } else if (progress >= sceneEnd - fadeDuration && progress < sceneEnd) {
              textOpacity = 1 - (progress - (sceneEnd - fadeDuration)) / fadeDuration;
            }
            // Hide scene 0 text on initial load (before any scroll)
            if (i === 0 && progress < 0.01) textOpacity = 0;

            return (
              <div
                key={scene.id}
                style={{
                  opacity: textOpacity,
                  transform: `translateY(${textOpacity < 1 ? "16px" : "0px"})`,
                  transition: "opacity 0.4s ease, transform 0.4s ease",
                  position: "absolute",
                  maxWidth: "min(100%, 640px)",
                  pointerEvents: "none",
                }}
              >
                {/* Feature label */}
                <span
                  className="inline-flex w-fit items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium uppercase tracking-[0.14em]"
                  style={{
                    borderColor: isDark ? "rgba(255,255,255,0.55)" : "rgba(0,0,0,0.25)",
                    background: isDark ? "rgba(255,255,255,0.18)" : "rgba(0,0,0,0.45)",
                    color: "white",
                    backdropFilter: "blur(10px)",
                  }}
                >
                  <Icon className="h-4 w-4" strokeWidth={2} />
                  {scene.label}
                </span>
                {/* Big headline — same size as original h1 */}
                <h2
                  className="mt-3 font-display text-2xl font-bold leading-[1.05] tracking-tight sm:text-4xl md:text-5xl lg:mt-6 lg:text-6xl xl:text-7xl"
                  style={{ color: "white", textShadow: "0 2px 12px rgba(0,0,0,0.9), 0 1px 4px rgba(0,0,0,0.95), 0 0 40px rgba(0,0,0,0.6)" }}
                >
                  {scene.headline.split("\n")[0]}<br />
                  <span style={{ color: "oklch(0.92 0.18 52)", textShadow: "0 2px 12px rgba(0,0,0,0.9), 0 1px 4px rgba(0,0,0,0.95), 0 0 40px rgba(0,0,0,0.6)" }}>
                    {scene.headline.split("\n")[1]}
                  </span>
                </h2>
                {/* Body text */}
                <p
                  className="mt-2 max-w-lg text-xs sm:text-sm md:text-base lg:mt-5 lg:text-lg xl:text-xl"
                  style={{ color: "rgba(255,255,255,0.92)", textShadow: "0 1px 8px rgba(0,0,0,0.9), 0 0 30px rgba(0,0,0,0.6)" }}
                >
                  {scene.body}
                </p>
                {/* Stat */}
                <div
                  className="mt-6 inline-flex items-center rounded-full px-5 py-2.5 text-base font-medium"
                  style={{
                    background: "rgba(0,0,0,0.35)",
                    border: "1px solid oklch(0.92 0.18 52 / 0.5)",
                    color: "oklch(0.92 0.18 52)",
                    backdropFilter: "blur(10px)",
                  }}
                >
                  {scene.stat}
                </div>
              </div>
            );
          })}
        </div>

        {/* ── Left bottom — vertical dot stepper only, no labels ── */}
        {progress > 0.02 && progress < 0.99 && (
          <div
            className="absolute bottom-10 left-8 z-10 hidden lg:block lg:left-16 xl:left-24"
            style={{
              opacity: Math.min(1, (progress - 0.02) * 20),
              transition: "opacity 0.3s ease",
            }}
          >
            <div className="flex flex-col items-center gap-1.5">
              {SCENES.map((s, i) => (
                <div
                  key={s.id}
                  className="rounded-full transition-all duration-300"
                  style={{
                    width: "4px",
                    height: i === activeIdx ? "20px" : "4px",
                    background: i === activeIdx
                      ? "oklch(0.85 0.18 52)"
                      : "rgba(255,255,255,0.30)",
                  }}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


// ── Legal popup modal ────────────────────────────────────────────────────────
// Uses Radix Dialog (already imported) — SSR-safe, no direct document access,
// handles portal, scroll-lock and Escape natively.
function LegalModal({ title, content, onClose }: { title: string; content: string; onClose: () => void }) {
  return (
    <Dialog open={true} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogPortal>
        <DialogOverlay className="bg-black/70 backdrop-blur-sm" />
        <DialogPrimitive.Content
          className="fixed left-[50%] top-[50%] z-[100] w-full max-w-2xl -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-card shadow-2xl flex flex-col max-h-[80vh] focus:outline-none"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border px-6 py-4 shrink-0">
            <h2 className="font-display text-base font-semibold text-foreground">{title}</h2>
            <DialogPrimitive.Close className="grid h-8 w-8 place-items-center rounded-full border border-border text-muted-foreground hover:text-foreground transition-colors">
              <X className="h-4 w-4" />
              <span className="sr-only">Close</span>
            </DialogPrimitive.Close>
          </div>
          {/* Scrollable content */}
          <div className="overflow-y-auto px-6 py-5">
            <div className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">
              {content || "Content not yet configured. Add it in Developer → Settings → Legal."}
            </div>
          </div>
          {/* Footer */}
          <div className="border-t border-border px-6 py-4 shrink-0">
            <button
              onClick={onClose}
              className="rounded-full bg-foreground px-5 py-2 text-xs font-semibold text-background hover:bg-foreground/90 transition-colors"
            >
              Close
            </button>
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}

// ── Cookie banner ─────────────────────────────────────────────────────────────
// Rendered inline (fixed positioning handles placement) — no createPortal,
// no document.body access, no SSR issues. visible starts false so server and
// client agree on first render; localStorage check runs client-only in useEffect.
function CookieBanner({ cookieText, onLearnMore }: { cookieText: string; onLearnMore: () => void }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem("nivaspark_cookies_accepted")) setVisible(true);
    } catch {}
  }, []);

  function accept() {
    try { localStorage.setItem("nivaspark_cookies_accepted", "1"); } catch {}
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-[90] border-t border-border bg-card/95 backdrop-blur-xl px-4 py-4 shadow-2xl">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground max-w-2xl">
          🍪 {cookieText}
        </p>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={onLearnMore}
            className="rounded-full border border-border px-4 py-1.5 text-xs font-medium text-foreground hover:border-primary/60 transition-colors"
          >
            Learn more
          </button>
          <button
            onClick={accept}
            className="rounded-full bg-foreground px-4 py-1.5 text-xs font-semibold text-background hover:bg-foreground/90 transition-colors"
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Landing footer — fetches legal content, shows popups ─────────────────────
function LandingFooter() {
  const [legalContent, setLegalContent] = useState({
    terms: "",
    privacy: "",
    acceptable_use: "",
    cookies: "",
  });
  const [openModal, setOpenModal] = useState<"terms"|"privacy"|"acceptable_use"|"cookies"|null>(null);

  useEffect(() => {
    const BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";
    fetch(`${BASE}/auth/legal-content`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data) setLegalContent(data); })
      .catch(() => {});
  }, []);

  const MODALS = {
    terms:           { title: "Terms of Service",     content: legalContent.terms },
    privacy:         { title: "Privacy Policy",        content: legalContent.privacy },
    acceptable_use:  { title: "Acceptable Use Policy", content: legalContent.acceptable_use },
    cookies:         { title: "Cookie Notice",         content: legalContent.cookies },
  };

  return (
    <>
      <footer
        className="relative overflow-hidden mx-3 mb-3 rounded-2xl"
        style={{
          background: "oklch(1 0 0 / 0.04)",
          backdropFilter: "blur(20px) saturate(1.5)",
          WebkitBackdropFilter: "blur(20px) saturate(1.5)",
          border: "1px solid oklch(1 0 0 / 0.12)",
          boxShadow: "inset 0 1px 0 oklch(1 0 0 / 0.10)",
        }}
      >
        {/* Subtle aurora wash — mirrors the hero palette */}
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
          <div
            className="absolute -inset-[60%] animate-aurora-a opacity-40"
            style={{ background: "radial-gradient(50% 55% at 10% 50%, oklch(0.85 0.2 200 / 0.12), transparent 70%)" }}
          />
          <div
            className="absolute -inset-[60%] animate-aurora-b opacity-30"
            style={{ background: "radial-gradient(40% 50% at 88% 50%, oklch(0.66 0.26 305 / 0.10), transparent 70%)" }}
          />
        </div>

        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-8 text-xs"
          style={{ color: "oklch(0.68 0.01 280)" }}
        >
          <div>
            © 2026 NivaSpark · Powered by{" "}
            <a
              href="https://www.nivatier.com"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "oklch(0.85 0.18 52)" }}
              className="hover:underline"
            >
              Nivatier
            </a>
          </div>
          <div className="flex flex-wrap gap-5">
            <a
              href="/terms"
              className="transition-colors hover:underline"
              style={{ color: "oklch(0.68 0.01 280)" }}
              onMouseEnter={e => (e.currentTarget.style.color = "oklch(0.92 0.01 280)")}
              onMouseLeave={e => (e.currentTarget.style.color = "oklch(0.68 0.01 280)")}
            >
              Terms
            </a>
            <a
              href="/privacy"
              className="transition-colors hover:underline"
              style={{ color: "oklch(0.68 0.01 280)" }}
              onMouseEnter={e => (e.currentTarget.style.color = "oklch(0.92 0.01 280)")}
              onMouseLeave={e => (e.currentTarget.style.color = "oklch(0.68 0.01 280)")}
            >
              Privacy
            </a>
            <button
              onClick={() => setOpenModal("acceptable_use")}
              className="transition-colors hover:underline"
              style={{ color: "oklch(0.68 0.01 280)" }}
              onMouseEnter={e => (e.currentTarget.style.color = "oklch(0.92 0.01 280)")}
              onMouseLeave={e => (e.currentTarget.style.color = "oklch(0.68 0.01 280)")}
            >
              Acceptable Use
            </button>
          </div>
        </div>
      </footer>

      {/* Cookie banner */}
      <CookieBanner
        cookieText={legalContent.cookies || "We use cookies to improve your experience."}
        onLearnMore={() => setOpenModal("cookies")}
      />

      {/* Legal modals */}
      {openModal && (
        <LegalModal
          title={MODALS[openModal].title}
          content={MODALS[openModal].content}
          onClose={() => setOpenModal(null)}
        />
      )}
    </>
  );
}


// ── Studio Carousel — infinite auto-scroll with edge fade masks ──────────────
const STUDIO_CARDS = [
  { tag: "Instagram", title: "Pulse One Smartwatch", copy: "Your health, one glance away. 7-day battery.", img: adPulse },
  { tag: "TikTok",    title: "Volt Runners",          copy: "Engineered for the streets. Featherlight. -20% launch.", img: adVolt },
  { tag: "Facebook",  title: "Ember Cold Brew",        copy: "Slow-steeped 18 hours. Zero bitterness. Free shipping.", img: adEmber },
  { tag: "LinkedIn",  title: "Lumière Serum",          copy: "Clinically proven glow in 14 days. Dermatologist approved.", img: adLumiere },
  { tag: "Instagram", title: "Auric Frames",           copy: "Shade redefined. Thin frames, bold statement. Shop the drop.", img: adShades },
  { tag: "TikTok",    title: "Echo Buds Pro",          copy: "Zero wires. Zero compromise. 32hr battery life.", img: adEarbuds },
];

function StudioCarousel() {
  const trackRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);
  const posRef = useRef(0);
  const pausedRef = useRef(false);
  const CARD_WIDTH = 280; // px
  const GAP = 20; // px
  const SPEED = 0.6; // px per frame
  const TOTAL = STUDIO_CARDS.length;
  const UNIT = (CARD_WIDTH + GAP) * TOTAL; // width of one full set

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;

    const tick = () => {
      if (!pausedRef.current) {
        posRef.current += SPEED;
        // Reset seamlessly when one full set has scrolled past
        if (posRef.current >= UNIT) posRef.current -= UNIT;
        track.style.transform = `translateX(-${posRef.current}px)`;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [UNIT]);

  return (
    <section className="relative w-full overflow-hidden py-20 md:py-28">
      {/* Background wash */}
      <div aria-hidden className="pointer-events-none absolute inset-0"
           style={{ background: "radial-gradient(70% 60% at 20% 30%, oklch(0.85 0.2 200 / 0.10), transparent 65%), radial-gradient(60% 55% at 78% 65%, oklch(0.66 0.26 305 / 0.10), transparent 65%)" }} />
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-b from-background/50 via-transparent to-background/50" />

      {/* Heading */}
      <div className="relative text-center px-4 mb-12">
        <h2 className="font-display text-3xl font-bold text-glow md:text-4xl lg:text-5xl">Fresh from the studio</h2>
        <p className="mt-2 text-sm text-muted-foreground">Sample ads generated by NivaSpark — one brief each, zero designers.</p>
      </div>

      {/* Carousel track wrapper */}
      <div className="relative">
        {/* Left fade mask — 0% opacity at 30% from left, full opacity at left edge */}
        <div
          aria-hidden
          className="pointer-events-none absolute left-0 top-0 bottom-0 z-10"
          style={{
            width: "30%",
            background: "linear-gradient(to right, var(--background) 0%, var(--background) 5%, transparent 100%)",
          }}
        />
        {/* Right fade mask — mirror of left */}
        <div
          aria-hidden
          className="pointer-events-none absolute right-0 top-0 bottom-0 z-10"
          style={{
            width: "30%",
            background: "linear-gradient(to left, var(--background) 0%, var(--background) 5%, transparent 100%)",
          }}
        />

        {/* Scrolling track — two copies for seamless loop */}
        <div className="overflow-hidden">
          <div
            ref={trackRef}
            className="flex will-change-transform"
            style={{ gap: `${GAP}px`, paddingLeft: `${GAP}px` }}
            onMouseEnter={() => { pausedRef.current = true; }}
            onMouseLeave={() => { pausedRef.current = false; }}
          >
            {/* Render three copies so loop is always seamless at any speed */}
            {[...STUDIO_CARDS, ...STUDIO_CARDS, ...STUDIO_CARDS].map((p, idx) => (
              <article
                key={idx}
                className="group relative shrink-0 overflow-hidden rounded-2xl p-5 transition-all duration-300 hover:-translate-y-1"
                style={{
                  width: `${CARD_WIDTH}px`,
                  background: "oklch(1 0 0 / 0.05)",
                  backdropFilter: "blur(16px) saturate(1.4)",
                  WebkitBackdropFilter: "blur(16px) saturate(1.4)",
                  border: "1px solid oklch(1 0 0 / 0.11)",
                  boxShadow: [
                    "inset 0 1px 0 oklch(1 0 0 / 0.14)",
                    "inset 0 -1px 0 oklch(0 0 0 / 0.08)",
                    "0 8px 32px -8px oklch(0 0 0 / 0.35)",
                  ].join(", "),
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLElement).style.border = "1px solid oklch(0.85 0.18 52 / 0.45)";
                  (e.currentTarget as HTMLElement).style.boxShadow = [
                    "inset 0 1px 0 oklch(1 0 0 / 0.18)",
                    "inset 0 -1px 0 oklch(0 0 0 / 0.08)",
                    "0 16px 48px -8px oklch(0 0 0 / 0.45)",
                    "0 0 0 1px oklch(0.85 0.18 52 / 0.15)",
                  ].join(", ");
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLElement).style.border = "1px solid oklch(1 0 0 / 0.11)";
                  (e.currentTarget as HTMLElement).style.boxShadow = [
                    "inset 0 1px 0 oklch(1 0 0 / 0.14)",
                    "inset 0 -1px 0 oklch(0 0 0 / 0.08)",
                    "0 8px 32px -8px oklch(0 0 0 / 0.35)",
                  ].join(", ");
                }}
              >
                <span className="inline-flex rounded-full border border-primary/40 bg-background/50 px-2.5 py-1 text-[10px] font-medium uppercase tracking-widest text-primary">
                  {p.tag}
                </span>
                <div className="relative mt-4 mb-4 aspect-square overflow-hidden rounded-xl border border-border/60">
                  <img
                    src={p.img}
                    alt={p.title}
                    loading="lazy"
                    width={560}
                    height={560}
                    className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
                  />
                  <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-background/50 via-transparent to-transparent" />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <div className="font-display text-sm font-semibold truncate">{p.title}</div>
                  <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[9px] uppercase tracking-widest text-muted-foreground">
                    AI
                  </span>
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground line-clamp-2">{p.copy}</p>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// ── Vimeo lightbox modal ─────────────────────────────────────────────────────
function VimeoModal({ vimeoId, open, onClose }: { vimeoId: string; open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogPortal>
        <DialogOverlay className="bg-black/80" />
        <DialogPrimitive.Content
          className={cn(
            "fixed left-[50%] top-[50%] z-50 w-full max-w-5xl -translate-x-1/2 -translate-y-1/2 p-0 bg-transparent border-none shadow-none",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
            "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
          )}
        >
          <div className="relative aspect-video w-[92vw] max-w-5xl overflow-hidden rounded-2xl bg-background">
            <iframe
              src={`https://player.vimeo.com/video/${vimeoId}?badge=0&autopause=0&player_id=0&app_id=58479&autoplay=1`}
              width="100%"
              height="100%"
              frameBorder="0"
              allow="autoplay; fullscreen; picture-in-picture; clipboard-write"
              title="NivaSpark explainer"
              className="absolute inset-0 h-full w-full"
            />
          </div>
          <DialogPrimitive.Close className="absolute -right-3 -top-3 z-50 grid h-9 w-9 place-items-center rounded-full border border-border bg-card/90 text-foreground transition hover:text-primary">
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}

// ── Featured video — static preview, click opens modal ──────────────────────
function FeaturedVideo() {
  const [modalOpen, setModalOpen] = useState(false);
  const [vimeoId, setVimeoId] = useState(FALLBACK_VIMEO_ID);

  useEffect(() => {
    fetch(`${import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000"}/developer/public/platform-config`)
      .then((r) => r.json())
      .then((d) => { if (d.hero_vimeo_id) setVimeoId(d.hero_vimeo_id); })
      .catch(() => { /* use fallback */ });
  }, []);

  return (
    <>
      <div
        className="group relative overflow-hidden rounded-2xl"
        style={{
          background: "oklch(1 0 0 / 0.05)",
          backdropFilter: "blur(20px) saturate(1.5)",
          WebkitBackdropFilter: "blur(20px) saturate(1.5)",
          border: "1px solid oklch(1 0 0 / 0.12)",
          boxShadow: [
            "0 0 0 1px oklch(0.85 0.18 52 / 0.12)",
            "inset 0 1px 0 oklch(1 0 0 / 0.16)",
            "inset 0 -1px 0 oklch(0 0 0 / 0.08)",
            "0 24px 60px -12px oklch(0 0 0 / 0.50)",
          ].join(", "),
        }}
      >
        {/* Aurora colour wash behind glass */}
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-2xl">
          <div className="absolute -inset-[40%] animate-aurora-a opacity-60"
            style={{ background: "radial-gradient(50% 60% at 10% 40%, oklch(0.85 0.2 200 / 0.18), transparent 70%)" }} />
          <div className="absolute -inset-[40%] animate-aurora-b opacity-50"
            style={{ background: "radial-gradient(40% 50% at 85% 60%, oklch(0.66 0.26 305 / 0.15), transparent 70%)" }} />
        </div>

        <div className="flex flex-col md:flex-row">
          {/* Vimeo embed preview — pointer-events-none; click anywhere opens modal */}
          <div
            className="relative aspect-video cursor-pointer overflow-hidden md:w-3/5"
            onClick={() => setModalOpen(true)}
          >
            <iframe
              src={`https://player.vimeo.com/video/${vimeoId}?badge=0&autopause=0&player_id=0&app_id=58479`}
              width="100%"
              height="100%"
              frameBorder="0"
              allow="autoplay; fullscreen; picture-in-picture; clipboard-write"
              title="NivaSpark overview"
              className="pointer-events-none absolute inset-0 h-full w-full"
            />
            {/* Simple hover overlay — opacity transition only, no blur */}
            <div className="absolute inset-0 flex items-center justify-center bg-background/0 transition-colors duration-300 group-hover:bg-background/25">
              <span className="grid h-16 w-16 place-items-center rounded-full border border-primary/50 bg-background/60 text-primary opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                <Play className="h-6 w-6 translate-x-0.5" strokeWidth={2} />
              </span>
            </div>
          </div>

          {/* Text */}
          <div
            className="flex flex-col justify-center p-6 md:w-2/5 md:p-10"
            style={{ borderLeft: "1px solid oklch(1 0 0 / 0.08)" }}
          >
            <span className="inline-flex w-fit rounded-full border border-primary/40 bg-background/50 px-2.5 py-1 text-[10px] font-medium uppercase tracking-widest text-primary">
              Overview
            </span>
            <h3 className="mt-4 font-display text-2xl font-semibold text-glow md:text-3xl">
              NivaSpark in 3 minutes — the complete walkthrough
            </h3>
            <p className="mt-3 text-sm text-muted-foreground md:text-base">
              See how NivaSpark takes a single product brief and generates copy, images, and video ads tailored to each platform's best practices — then schedules and posts them automatically.
            </p>
            <button
              onClick={() => setModalOpen(true)}
              className="mt-7 self-start flex items-center gap-2 rounded-full bg-gold-gradient px-5 py-2.5 text-sm font-medium text-background shadow-[var(--shadow-gold)]"
            >
              <Play className="h-4 w-4" strokeWidth={2} />
              Watch fullscreen
            </button>
          </div>
        </div>
      </div>

      <VimeoModal vimeoId={vimeoId} open={modalOpen} onClose={() => setModalOpen(false)} />
    </>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────
// ── Signup popup — fires after 8s + 30% scroll, suppressed for 7 days ────────
function SignupPopup({ onSignup }: { onSignup: () => void }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // Don't show if already authed check is handled by parent (not rendered when authed)
    const STORAGE_KEY = "nivaspark_popup_dismissed";
    const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

    function isDismissed() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return false;
        return Date.now() - Number(raw) < COOLDOWN_MS;
      } catch { return false; }
    }

    if (isDismissed()) return;

    let scrolled = false;
    let timedOut = false;

    function maybeShow() {
      if (scrolled && timedOut && !isDismissed()) setOpen(true);
    }

    const onScroll = () => {
      if (scrolled) return;
      const pct = window.scrollY / (document.body.scrollHeight - window.innerHeight);
      if (pct >= 0.30) { scrolled = true; maybeShow(); }
    };

    const timer = setTimeout(() => { timedOut = true; maybeShow(); }, 8000);

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      clearTimeout(timer);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  function dismiss() {
    try { localStorage.setItem("nivaspark_popup_dismissed", String(Date.now())); } catch {}
    setOpen(false);
  }

  function handleSignup() {
    dismiss();
    onSignup();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) dismiss(); }}>
      <DialogPortal>
        {/* No overlay — popup floats over scrollable content */}
        <DialogPrimitive.Content className="fixed z-[110] focus:outline-none bottom-0 left-0 right-0 px-3 pb-4 sm:inset-0 sm:flex sm:items-center sm:justify-center sm:p-6">

          {/* ── Glass card ── */}
          <div
            className="relative overflow-hidden rounded-2xl sm:rounded-3xl w-full sm:max-w-sm"
            style={{
              /* Frosted glass layer */
              background: "oklch(1 0 0 / 0.06)",
              backdropFilter: "blur(28px) saturate(1.6)",
              WebkitBackdropFilter: "blur(28px) saturate(1.6)",
              /* Hair-line border that catches the light */
              border: "1px solid oklch(1 0 0 / 0.14)",
              /* Outer glow + depth shadow */
              boxShadow: [
                "0 0 0 1px oklch(0.85 0.18 52 / 0.18)",
                "inset 0 1px 0 oklch(1 0 0 / 0.18)",   /* inner top highlight */
                "inset 0 -1px 0 oklch(0 0 0 / 0.12)",  /* inner bottom shadow */
                "0 32px 80px -12px oklch(0 0 0 / 0.65)",
                "0 0 60px -20px oklch(0.85 0.18 52 / 0.20)",
              ].join(", "),
            }}
          >
            {/* Animated colour wash behind the glass */}
            <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-2xl sm:rounded-3xl">
              <div
                className="absolute -inset-[50%] animate-aurora-a"
                style={{ background: "radial-gradient(55% 65% at 15% 35%, oklch(0.85 0.2 200 / 0.28), transparent 70%)", opacity: 0.9 }}
              />
              <div
                className="absolute -inset-[50%] animate-aurora-b"
                style={{ background: "radial-gradient(45% 55% at 80% 65%, oklch(0.66 0.26 305 / 0.22), transparent 70%)", opacity: 0.9 }}
              />
              {/* Gold radial at bottom-right for warmth */}
              <div
                className="absolute -inset-[50%]"
                style={{ background: "radial-gradient(35% 40% at 85% 90%, oklch(0.85 0.18 52 / 0.15), transparent 65%)" }}
              />
            </div>

            {/* Gold top accent line */}
            <div
              className="h-[2px] w-full"
              style={{ background: "linear-gradient(90deg, transparent 0%, oklch(0.85 0.18 52 / 0.9) 30%, oklch(0.72 0.22 45 / 0.9) 70%, transparent 100%)" }}
            />

            <div className="px-5 py-5 sm:px-8 sm:py-8">
              {/* Close */}
              <DialogPrimitive.Close
                onClick={dismiss}
                className="absolute right-4 top-4 grid h-7 w-7 place-items-center rounded-full text-white/50 hover:text-white transition-colors"
                style={{ background: "oklch(1 0 0 / 0.08)", border: "1px solid oklch(1 0 0 / 0.12)" }}
              >
                <X className="h-3.5 w-3.5" />
                <span className="sr-only">Close</span>
              </DialogPrimitive.Close>

              {/* Logo */}
              <div className="flex items-center justify-center gap-2 mb-4 sm:gap-2.5 sm:mb-6">
                <img src="/logo-icon.png" alt="NivaSpark" className="h-7 w-7 sm:h-8 sm:w-8 object-contain" />
                <img src="/logo-wording-dark.png" alt="NivaSpark" className="hidden dark:block h-5 sm:h-6 object-contain object-left" />
                <img src="/logo-wording-light.png" alt="NivaSpark" className="block dark:hidden h-5 sm:h-6 object-contain object-left" />
              </div>

              {/* Hook headline */}
              <h2
                className="font-display text-xl sm:text-2xl font-bold leading-tight tracking-tight text-center"
                style={{ color: "oklch(0.97 0.01 280)" }}
              >
                Stop making ads<br />
                <span style={{ color: "oklch(0.88 0.18 52)" }}>manually.</span>
              </h2>

              {/* Sub-copy */}
              <p className="mt-2 sm:mt-3 text-xs sm:text-sm leading-relaxed text-center" style={{ color: "oklch(0.80 0.01 280)" }}>
                One product brief. Ready-to-post ads with copy, image and video — in seconds.
              </p>

              {/* Social proof pill */}
              <div className="mt-3 sm:mt-4 flex justify-center">
              <div
                className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium"
                style={{
                  background: "oklch(0.85 0.18 52 / 0.12)",
                  border: "1px solid oklch(0.85 0.18 52 / 0.35)",
                  color: "oklch(0.88 0.18 52)",
                }}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Free plan · no card required · 60 seconds to start
              </div>
              </div>

              {/* CTA */}
              <button
                onClick={handleSignup}
                className="mt-4 sm:mt-6 w-full rounded-full py-3 sm:py-3.5 text-sm font-semibold text-black transition-opacity hover:opacity-90"
                style={{
                  background: "linear-gradient(135deg, oklch(0.88 0.18 52), oklch(0.74 0.22 45))",
                  boxShadow: "0 4px 24px oklch(0.72 0.22 45 / 0.50), inset 0 1px 0 oklch(1 0 0 / 0.25)",
                }}
              >
                🚀 Register free — create your first ad
              </button>

              {/* Dismiss */}
              <button
                onClick={dismiss}
                className="mt-2.5 w-full text-center text-xs transition-colors"
                style={{ color: "oklch(0.60 0.01 280)" }}
                onMouseEnter={e => (e.currentTarget.style.color = "oklch(0.80 0.01 280)")}
                onMouseLeave={e => (e.currentTarget.style.color = "oklch(0.60 0.01 280)")}
              >
                Maybe later
              </button>
            </div>
          </div>

        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}


function Index() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [loginInitialMode, setLoginInitialMode] = useState<"login" | "register">("login");

  function openLogin() { setLoginInitialMode("login"); setShowLogin(true); }
  function openRegister() { setLoginInitialMode("register"); setShowLogin(true); }
  const { isAuthed, me } = useAuth();

  return (
    <div className="min-h-screen bg-background text-foreground" style={{ overflowX: "clip" }}>

      {/* ── Header — glow-border kept here only, single instance ── */}
      <div className="fixed top-0 left-0 right-0 z-50 px-3 pt-3">
        <div>
          <header className="glow-border relative flex items-center justify-between gap-4 overflow-hidden rounded-2xl border border-border bg-card/70 px-5 py-3 shadow-[0_4px_24px_-8px_oklch(0.58_0.19_240/0.25)] backdrop-blur-xl md:px-8">
            {/* Single static aurora in header — no hue-rotate filter, no mix-blend */}
            <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
              <div className="absolute -inset-[40%] animate-aurora-a opacity-50"
                   style={{ background: "radial-gradient(40% 60% at 30% 50%, oklch(0.85 0.2 200 / 0.4), transparent 70%)" }} />
              <div className="absolute -inset-[40%] animate-aurora-b opacity-40"
                   style={{ background: "radial-gradient(35% 55% at 65% 50%, oklch(0.7 0.24 300 / 0.35), transparent 70%)" }} />
            </div>
            <Link to="/" className="flex min-w-0 items-center gap-2.5">
              <img src="/logo-icon.png" alt="NivaSpark icon" className="h-9 w-9 shrink-0 object-contain" />
              <div className="min-w-0 leading-tight">
                <img src="/logo-wording-dark.png" alt="NivaSpark" className="hidden dark:block h-7 object-contain object-left" />
                <img src="/logo-wording-light.png" alt="NivaSpark" className="block dark:hidden h-7 object-contain object-left" />
                <div className="hidden truncate text-[10px] uppercase tracking-[0.2em] text-muted-foreground sm:block">Powered by Nivatier</div>
              </div>
            </Link>
            <nav className="hidden items-center gap-2 text-sm md:flex">
              <Link to="/pricing" className="rounded-full px-4 py-2 text-muted-foreground hover:text-foreground">Pricing</Link>
              {isAuthed ? (
                <Link to="/app" className="flex items-center gap-2 rounded-full bg-gold-gradient px-4 py-2 font-medium text-background shadow-[var(--shadow-gold)]">
                  <span className="grid h-5 w-5 place-items-center rounded-full bg-background/25 text-[10px] font-bold">
                    {(me?.company_name || "?").charAt(0).toUpperCase()}
                  </span>
                  Go to app →
                </Link>
              ) : (
                <>
                  <button onClick={openLogin} className="rounded-full px-4 py-2 text-muted-foreground hover:text-foreground">Log in</button>
                  <button onClick={openRegister} className="rounded-full bg-gold-gradient px-4 py-2 font-medium text-background shadow-[var(--shadow-gold)]">Register</button>
                </>
              )}
              <ThemeToggle className="ml-1" />
            </nav>
            <div className="flex shrink-0 items-center gap-2 md:hidden">
              <ThemeToggle />
              <button type="button" aria-label="Open menu" aria-expanded={menuOpen}
                      onClick={() => setMenuOpen((v) => !v)}
                      className="grid h-9 w-9 place-items-center rounded-full border border-border bg-card/60 text-foreground">
                <span className="relative block h-3 w-4">
                  <span className={`absolute left-0 top-0 h-0.5 w-full bg-current transition ${menuOpen ? "translate-y-1.5 rotate-45" : ""}`} />
                  <span className={`absolute left-0 top-1.5 h-0.5 w-full bg-current transition ${menuOpen ? "opacity-0" : ""}`} />
                  <span className={`absolute left-0 top-3 h-0.5 w-full bg-current transition ${menuOpen ? "-translate-y-1.5 -rotate-45" : ""}`} />
                </span>
              </button>
            </div>
          </header>
          <div className={`md:hidden overflow-hidden transition-[max-height,opacity] duration-300 ${menuOpen ? "mt-2 max-h-72 opacity-100" : "max-h-0 opacity-0"}`}>
            <div className="rounded-2xl border border-border bg-card/80 p-3 shadow-[0_10px_40px_-20px_oklch(0.58_0.19_240/0.35)]">
              <Link to="/pricing" onClick={() => setMenuOpen(false)} className="block rounded-xl px-4 py-3 text-sm text-foreground hover:bg-muted">Pricing</Link>
              {isAuthed ? (
                <Link to="/app" onClick={() => setMenuOpen(false)} className="mt-1 block rounded-xl bg-gold-gradient px-4 py-3 text-center text-sm font-medium text-background shadow-[var(--shadow-gold)]">Go to app →</Link>
              ) : (
                <>
                  <button onClick={() => { setMenuOpen(false); openLogin(); }} className="block w-full rounded-xl px-4 py-3 text-left text-sm text-foreground hover:bg-muted">Log in</button>
                  <button onClick={() => { setMenuOpen(false); openRegister(); }} className="mt-1 block w-full rounded-xl bg-gold-gradient px-4 py-3 text-center text-sm font-medium text-background shadow-[var(--shadow-gold)]">Register</button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Scroll-scrubber hero ─────────────────────────────────────────── */}
      <ScrollHero onRegister={openRegister} />

      <GlowDivider />

      {/* ── Video section ─────────────────────────────────────────────────── */}
      <section className="relative w-full overflow-hidden px-4 py-16 md:py-24">
        {/* Emerald + indigo wash */}
        <div aria-hidden className="pointer-events-none absolute inset-0"
             style={{ background: "radial-gradient(60% 55% at 80% 20%, oklch(0.78 0.18 160 / 0.10), transparent 65%), radial-gradient(55% 50% at 18% 75%, oklch(0.65 0.22 260 / 0.10), transparent 65%), radial-gradient(45% 40% at 50% 50%, oklch(0.82 0.14 175 / 0.07), transparent 65%)" }} />
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-b from-background/50 via-transparent to-background/50" />
        <div className="relative mx-auto max-w-7xl">
          <div className="mb-10 text-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-primary/40 bg-background/40 px-4 py-1.5 text-[11px] font-medium uppercase tracking-[0.18em] text-primary">
              <Play className="h-3 w-3" /> See it in action
            </span>
            <h2 className="mt-4 font-display text-3xl font-bold text-glow md:text-4xl lg:text-5xl">Watch how it works</h2>
            <p className="mt-3 text-muted-foreground md:text-lg">Everything you need to go from idea to posted ad in minutes.</p>
          </div>

          <FeaturedVideo />

        </div>
      </section>

      <GlowDivider />

      {/* ── Studio sample ads — static gradient background ───────────────── */}
      <StudioCarousel />

      <GlowDivider />

      <LandingFooter />

      {/* Signup popup — only for non-authed visitors */}
      {!isAuthed && <SignupPopup onSignup={openRegister} />}

      <LoginModal open={showLogin} onClose={() => setShowLogin(false)} initialMode={loginInitialMode} />
    </div>
  );
}
