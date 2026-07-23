import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect, useRef, useCallback } from "react";
import featLink from "@/assets/feat-link.jpg";
import featScore from "@/assets/feat-score.jpg";
import featLaunch from "@/assets/feat-launch.jpg";
import adPulse from "@/assets/ad-pulse.jpg";
import adVolt from "@/assets/ad-volt.jpg";
import adEmber from "@/assets/ad-ember.jpg";
import adLumiere from "@/assets/ad-lumiere.jpg";
import heroVisual from "@/assets/hero-visual.jpg";
import { ThemeToggle } from "@/components/theme-toggle";
import { LoginModal } from "@/components/login-modal";
import { useAuth } from "@/hooks/use-auth";
import { Link2, ShieldCheck, Rocket, Play, ChevronLeft, ChevronRight, X, type LucideIcon } from "lucide-react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Dialog, DialogOverlay, DialogPortal } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/index_old")({
  component: Index,
});

const VIMEO_ID = "1118789146";
const vimeoEmbed = (autoplay = false) =>
  `https://player.vimeo.com/video/${VIMEO_ID}?badge=0&autopause=0&player_id=0&app_id=58479${autoplay ? "&autoplay=1" : ""}`;

const platforms = [
  { tag: "Instagram", title: "Pulse One Smartwatch", copy: "Your health, one glance away. 7-day battery.", img: adPulse },
  { tag: "TikTok", title: "Volt Runners", copy: "Engineered for the streets. Featherlight. -20% launch.", img: adVolt },
  { tag: "Facebook", title: "Ember Cold Brew", copy: "Slow-steeped 18 hours. Zero bitterness. Free shipping.", img: adEmber },
  { tag: "LinkedIn", title: "Lumière Serum", copy: "Clinically proven glow in 14 days. Dermatologist approved.", img: adLumiere },
];

// One card per app navigation section — swap vimeoId per card when you have real videos
const videoCards = [
  {
    id: "v1",
    title: "Create an ad",
    tag: "Ad Studio",
    desc: "Go from a product URL or brief to platform-ready copy, images and video in under 60 seconds.",
    vimeoId: VIMEO_ID,
    thumb: featLink,
  },
  {
    id: "v2",
    title: "AI scoring & compliance",
    tag: "Scoring",
    desc: "Every ad gets an engagement score and a platform policy check before it leaves NivaAd.",
    vimeoId: VIMEO_ID,
    thumb: featScore,
  },
  {
    id: "v3",
    title: "Campaign scheduler",
    tag: "Campaigns",
    desc: "Build teaser → launch → follow-up sequences and let NivaAd post at each platform's best time.",
    vimeoId: VIMEO_ID,
    thumb: featLaunch,
  },
  {
    id: "v4",
    title: "Brand Kit",
    tag: "Brand Kit",
    desc: "Store your logo, colours and tone of voice so every ad is on-brand, automatically.",
    vimeoId: VIMEO_ID,
    thumb: featLink,
  },
  {
    id: "v5",
    title: "Agent Niva",
    tag: "Agent Niva",
    desc: "Your AI marketing agent — scrapes your site, suggests ad ideas, and handles recurring events.",
    vimeoId: VIMEO_ID,
    thumb: featScore,
  },
  {
    id: "v6",
    title: "Analytics",
    tag: "Analytics",
    desc: "Track spend, reach and conversions across every connected platform in one dashboard.",
    vimeoId: VIMEO_ID,
    thumb: featLaunch,
  },
];

// ── Animated section divider (reuses the glow-border conic animation) ──────
function GlowDivider() {
  return (
    <div className="relative h-px w-full overflow-hidden" aria-hidden>
      {/* Static subtle base line */}
      <div className="absolute inset-0 bg-border/40" />
      {/* Travelling light sweep */}
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

// ── Mouse-parallax video hero ────────────────────────────────────────────────
function HeroVideoParallax() {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const tiltRef = useRef({ x: 0, y: 0 });
  const rafRef = useRef<number | null>(null);
  const scrollYRef = useRef(0);

  // Smooth mouse tracking with RAF
  const handleMouseMove = useCallback((e: MouseEvent) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    // Normalise to -1 … 1
    tiltRef.current = {
      x: (e.clientX - cx) / (rect.width / 2),
      y: (e.clientY - cy) / (rect.height / 2),
    };
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let currentX = 0;
    let currentY = 0;
    let currentScale = 1;

    function tick() {
      // Lerp toward target for smooth motion
      const tx = tiltRef.current.x;
      const ty = tiltRef.current.y;
      currentX += (tx - currentX) * 0.06;
      currentY += (ty - currentY) * 0.06;

      // Scroll drives scale: slightly zooms in as user scrolls down
      const targetScale = 1 + scrollYRef.current * 0.0003;
      currentScale += (targetScale - currentScale) * 0.08;

      const maxTilt = 6; // degrees
      const maxShift = 18; // px

      if (videoRef.current) {
        videoRef.current.style.transform = `
          perspective(900px)
          rotateY(${currentX * maxTilt}deg)
          rotateX(${-currentY * maxTilt}deg)
          translateX(${currentX * -maxShift}px)
          translateY(${currentY * -maxShift}px)
          scale(${currentScale})
        `;
      }

      rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);
    window.addEventListener("mousemove", handleMouseMove);

    const onScroll = () => {
      scrollYRef.current = window.scrollY;
    };
    window.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("scroll", onScroll);
    };
  }, [handleMouseMove]);

  return (
    <div ref={containerRef} className="pointer-events-none absolute inset-0 overflow-hidden" style={{ perspective: "900px" }}>
      {/* Fallback image — always visible; video layered on top if supported */}
      <img
        src={heroVisual}
        alt=""
        aria-hidden
        className="absolute inset-0 h-full w-full object-cover opacity-60"
      />
      {/* Video — autoplay muted loop; parallax transform applied via ref */}
      <video
        ref={videoRef}
        autoPlay
        muted
        loop
        playsInline
        poster={heroVisual}
        className="absolute inset-0 h-full w-full object-cover opacity-70 will-change-transform transition-none"
        style={{ transformOrigin: "center center" }}
      >
        {/* Drop your hero video file into /public/hero.mp4 */}
        <source src="/hero.mp4" type="video/mp4" />
      </video>
      {/* Depth vignette */}
      <div className="absolute inset-0 bg-gradient-to-b from-background/55 via-background/20 to-background/90" />
      <div className="absolute inset-0 bg-gradient-to-r from-background/40 via-transparent to-background/40" />
    </div>
  );
}

// ── Vimeo lightbox modal ─────────────────────────────────────────────────────
function VimeoModal({ vimeoId, open, onClose }: { vimeoId: string; open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogPortal>
        <DialogOverlay className="backdrop-blur-md bg-black/80" />
        <DialogPrimitive.Content
          className={cn(
            "fixed left-[50%] top-[50%] z-50 w-full max-w-5xl -translate-x-1/2 -translate-y-1/2 p-0 bg-transparent border-none shadow-none",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
            "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
          )}
        >
          <div className="relative aspect-video w-[92vw] max-w-5xl overflow-hidden rounded-2xl bg-background shadow-[var(--shadow-glass-full)]">
            <iframe
              src={`https://player.vimeo.com/video/${vimeoId}?badge=0&autopause=0&player_id=0&app_id=58479&autoplay=1`}
              width="100%"
              height="100%"
              frameBorder="0"
              allow="autoplay; fullscreen; picture-in-picture; clipboard-write"
              title="NivaAd explainer"
              className="absolute inset-0 h-full w-full"
            />
          </div>
          <DialogPrimitive.Close className="absolute -right-3 -top-3 z-50 grid h-9 w-9 place-items-center rounded-full border border-border bg-card/90 text-foreground backdrop-blur transition hover:text-primary">
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}

// ── Featured main video (large, Vimeo embed visible + click-to-fullscreen) ──
function FeaturedVideo() {
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <>
      <div className="glow-border group relative overflow-hidden rounded-2xl border border-border bg-card/40 backdrop-blur-sm">
        {/* Aurora on hover */}
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden opacity-0 transition-opacity duration-500 group-hover:opacity-100 animate-aurora-hue">
          <div className="absolute -inset-[30%] animate-aurora-a mix-blend-screen"
               style={{ background: "radial-gradient(40% 55% at 25% 40%, oklch(0.85 0.2 200 / 0.6), transparent 70%)" }} />
          <div className="absolute -inset-[30%] animate-aurora-b mix-blend-screen"
               style={{ background: "radial-gradient(38% 55% at 70% 55%, oklch(0.7 0.24 300 / 0.6), transparent 70%)" }} />
        </div>

        <div className="flex flex-col md:flex-row">
          {/* Vimeo embed — pointer-events-none so hover overlay works; click opens modal */}
          <div
            className="relative aspect-video cursor-pointer overflow-hidden md:w-3/5"
            onClick={() => setModalOpen(true)}
          >
            <iframe
              src={vimeoEmbed()}
              width="100%"
              height="100%"
              frameBorder="0"
              allow="autoplay; fullscreen; picture-in-picture; clipboard-write"
              title="NivaAd overview"
              className="pointer-events-none absolute inset-0 h-full w-full"
            />
            {/* Hover overlay with expand-to-fullscreen hint */}
            <div className="absolute inset-0 flex items-center justify-center bg-background/0 transition duration-300 group-hover:bg-background/30">
              <span className="grid h-16 w-16 place-items-center rounded-full border border-primary/50 bg-background/60 text-primary opacity-0 shadow-[var(--shadow-neon)] backdrop-blur-md transition duration-300 group-hover:opacity-100 group-hover:scale-110">
                <Play className="h-6 w-6 translate-x-0.5" strokeWidth={2} />
              </span>
            </div>
          </div>

          {/* Text */}
          <div className="flex flex-col justify-center p-6 md:w-2/5 md:p-10">
            <span className="inline-flex w-fit rounded-full border border-primary/40 bg-background/50 px-2.5 py-1 text-[10px] font-medium uppercase tracking-widest text-primary">
              Overview
            </span>
            <h3 className="mt-4 font-display text-2xl font-semibold text-glow md:text-3xl">
              NivaAd in 3 minutes — the complete walkthrough
            </h3>
            <p className="mt-3 text-sm text-muted-foreground md:text-base">
              See how NivaAd takes a single product brief and generates copy, images, and video ads tailored to each platform's best practices — then schedules and posts them automatically.
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

      <VimeoModal vimeoId={VIMEO_ID} open={modalOpen} onClose={() => setModalOpen(false)} />
    </>
  );
}

// ── Carousel card ────────────────────────────────────────────────────────────
function VideoCarouselCard({
  card,
  active,
  onClick,
}: {
  card: (typeof videoCards)[0];
  active: boolean;
  onClick: () => void;
}) {
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <>
      <div
        onClick={onClick}
        className={cn(
          "group glow-border relative cursor-pointer overflow-hidden rounded-2xl border bg-card/40 backdrop-blur-sm transition-all duration-300",
          active
            ? "border-primary/70 shadow-[var(--shadow-neon)] scale-[1.02]"
            : "border-border hover:border-primary/40",
        )}
      >
        {/* Thumbnail */}
        <div className="relative aspect-video overflow-hidden">
          <img
            src={card.thumb}
            alt={card.title}
            className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-105"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-background/80 via-background/20 to-transparent" />
          {/* Play button */}
          <button
            onClick={(e) => { e.stopPropagation(); setModalOpen(true); }}
            aria-label={`Play ${card.title}`}
            className="absolute inset-0 flex items-center justify-center"
          >
            <span className={cn(
              "grid h-11 w-11 place-items-center rounded-full border border-primary/50 bg-background/60 text-primary shadow-[var(--shadow-neon)] backdrop-blur-md transition duration-300",
              active ? "opacity-100" : "opacity-0 group-hover:opacity-100",
            )}>
              <Play className="h-4 w-4 translate-x-0.5" strokeWidth={2} />
            </span>
          </button>
          {/* Active indicator */}
          {active && (
            <div className="absolute bottom-0 inset-x-0 h-0.5 bg-gold-gradient" />
          )}
        </div>
        {/* Text */}
        <div className="p-4">
          <span className="inline-flex rounded-full border border-primary/40 bg-background/50 px-2 py-0.5 text-[9px] font-medium uppercase tracking-widest text-primary">
            {card.tag}
          </span>
          <p className="mt-2 font-display text-sm font-semibold leading-snug text-foreground line-clamp-2">
            {card.title}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground line-clamp-2">{card.desc}</p>
        </div>
      </div>

      <VimeoModal vimeoId={card.vimeoId} open={modalOpen} onClose={() => setModalOpen(false)} />
    </>
  );
}

// ── Video carousel (3-visible sliding window) ────────────────────────────────
function VideoCarousel() {
  const [active, setActive] = useState(0);
  const VISIBLE = 3;
  const total = videoCards.length;

  const prev = () => setActive((a) => (a - 1 + total) % total);
  const next = () => setActive((a) => (a + 1) % total);

  // Build the visible slice (wraps around)
  const visibleIndices = Array.from({ length: VISIBLE }, (_, i) => (active + i) % total);

  return (
    <div className="relative">
      {/* Cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        {visibleIndices.map((idx, pos) => (
          <VideoCarouselCard
            key={videoCards[idx].id}
            card={videoCards[idx]}
            active={pos === 0}
            onClick={() => setActive(idx)}
          />
        ))}
      </div>

      {/* Nav row */}
      <div className="mt-6 flex items-center justify-center gap-4">
        <button
          onClick={prev}
          aria-label="Previous"
          className="grid h-9 w-9 place-items-center rounded-full border border-border bg-card/60 text-foreground backdrop-blur transition hover:border-primary/60 hover:text-primary"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>

        {/* Dots */}
        <div className="flex gap-1.5">
          {videoCards.map((_, i) => (
            <button
              key={i}
              onClick={() => setActive(i)}
              aria-label={`Go to video ${i + 1}`}
              className={cn(
                "h-1.5 rounded-full transition-all duration-300",
                i === active ? "w-6 bg-primary" : "w-1.5 bg-border hover:bg-primary/50",
              )}
            />
          ))}
        </div>

        <button
          onClick={next}
          aria-label="Next"
          className="grid h-9 w-9 place-items-center rounded-full border border-border bg-card/60 text-foreground backdrop-blur transition hover:border-primary/60 hover:text-primary"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────
function Index() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const { isAuthed, me } = useAuth();

  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-hidden">

      {/* ── Floating header — unchanged pill behaviour ── */}
      <div className="sticky top-4 z-50">
        <div className="mx-auto max-w-7xl px-4">
          <header className="glow-border relative flex items-center justify-between gap-4 overflow-hidden rounded-2xl border border-border bg-card/70 px-4 py-3 shadow-[0_10px_40px_-20px_oklch(0.58_0.19_240/0.35)] backdrop-blur-xl md:px-6">
            {/* Aurora curtains */}
            <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden animate-aurora-hue">
              <div className="absolute -inset-[40%] animate-aurora-a opacity-80 mix-blend-screen"
                   style={{ background: "radial-gradient(40% 60% at 30% 50%, oklch(0.85 0.2 200 / 0.85), transparent 70%)" }} />
              <div className="absolute -inset-[40%] animate-aurora-b opacity-75 mix-blend-screen"
                   style={{ background: "radial-gradient(35% 55% at 65% 50%, oklch(0.7 0.24 300 / 0.8), transparent 70%)" }} />
              <div className="absolute -inset-[40%] animate-aurora-c opacity-70 mix-blend-screen"
                   style={{ background: "radial-gradient(45% 50% at 50% 60%, oklch(0.78 0.22 160 / 0.75), transparent 70%)" }} />
            </div>
            <Link to="/" className="flex min-w-0 items-center gap-2.5">
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-gold-gradient font-display font-bold text-background">N</div>
              <div className="min-w-0 leading-tight">
                <div className="truncate font-display font-bold tracking-tight">NivaAd</div>
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
                  <button onClick={() => setShowLogin(true)} className="rounded-full px-4 py-2 text-muted-foreground hover:text-foreground">Log in</button>
                  <Link to="/signup" className="rounded-full bg-gold-gradient px-4 py-2 font-medium text-background shadow-[var(--shadow-gold)]">Start free</Link>
                </>
              )}
              <ThemeToggle className="ml-1" />
            </nav>
            {/* Mobile controls */}
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
          {/* Mobile dropdown */}
          <div className={`md:hidden overflow-hidden transition-[max-height,opacity] duration-300 ${menuOpen ? "mt-2 max-h-72 opacity-100" : "max-h-0 opacity-0"}`}>
            <div className="rounded-2xl border border-border bg-card/80 p-3 shadow-[0_10px_40px_-20px_oklch(0.58_0.19_240/0.35)] backdrop-blur-xl">
              <Link to="/pricing" onClick={() => setMenuOpen(false)} className="block rounded-xl px-4 py-3 text-sm text-foreground hover:bg-muted">Pricing</Link>
              {isAuthed ? (
                <Link to="/app" onClick={() => setMenuOpen(false)} className="mt-1 block rounded-xl bg-gold-gradient px-4 py-3 text-center text-sm font-medium text-background shadow-[var(--shadow-gold)]">Go to app →</Link>
              ) : (
                <>
                  <button onClick={() => { setMenuOpen(false); setShowLogin(true); }} className="block w-full rounded-xl px-4 py-3 text-left text-sm text-foreground hover:bg-muted">Log in</button>
                  <Link to="/signup" onClick={() => setMenuOpen(false)} className="mt-1 block rounded-xl bg-gold-gradient px-4 py-3 text-center text-sm font-medium text-background shadow-[var(--shadow-gold)]">Start free</Link>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Full-bleed immersive hero ─────────────────────────────────── */}
      <section className="grain relative -mt-[68px] flex min-h-screen w-full flex-col items-center justify-center overflow-hidden border-b border-border text-center">
        {/* Parallax video background */}
        <HeroVideoParallax />

        {/* Glow blobs */}
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="absolute left-1/2 top-1/4 h-72 w-[560px] -translate-x-1/2 rounded-full bg-primary/20 blur-3xl animate-pulse-glow" />
          <div className="absolute right-1/4 top-1/3 h-56 w-56 rounded-full bg-secondary/20 blur-3xl animate-drift" />
          <div className="absolute left-1/4 bottom-1/4 h-52 w-52 rounded-full bg-accent/25 blur-3xl animate-drift" style={{ animationDelay: "-6s" }} />
          {/* Rotating conic ring */}
          <div className="absolute left-1/2 top-1/2 h-[620px] w-[620px] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-30 animate-spin-slow"
               style={{ background: "conic-gradient(from 0deg, transparent 0deg, oklch(0.66 0.26 305 / 0.5) 60deg, transparent 120deg, transparent 200deg, oklch(0.85 0.18 210 / 0.55) 220deg, transparent 300deg)", mask: "radial-gradient(circle, transparent 46%, #000 47%, #000 49%, transparent 50%)", WebkitMask: "radial-gradient(circle, transparent 46%, #000 47%, #000 49%, transparent 50%)" }} />
          {/* Faint perspective grid at bottom */}
          <div className="absolute inset-x-0 bottom-0 h-64 opacity-[0.07]"
               style={{ backgroundImage: "linear-gradient(oklch(0.85 0.18 210) 1px, transparent 1px), linear-gradient(90deg, oklch(0.66 0.26 305) 1px, transparent 1px)", backgroundSize: "48px 48px", maskImage: "linear-gradient(to top, #000 0%, transparent 100%)", WebkitMaskImage: "linear-gradient(to top, #000 0%, transparent 100%)" }} />
        </div>

        {/* Orbiting platform chips */}
        {[
          { label: "Instagram", cls: "left-[6%] top-[38%] animate-float", d: "0s" },
          { label: "TikTok",    cls: "right-[8%] top-[30%] animate-float-slow", d: "-2s" },
          { label: "LinkedIn",  cls: "left-[10%] bottom-[22%] animate-float-slow", d: "-4s" },
          { label: "Facebook",  cls: "right-[6%] bottom-[28%] animate-float", d: "-1s" },
          { label: "X",         cls: "left-[22%] top-[20%] animate-float", d: "-3s" },
          { label: "TikTok",    cls: "right-[20%] bottom-[18%] animate-float-slow", d: "-5s" },
        ].map((c, i) => (
          <div key={`${c.label}-${i}`}
               style={{ animationDelay: c.d }}
               aria-hidden
               className={`absolute hidden md:block rounded-full border border-primary/40 bg-card/60 px-3 py-1.5 text-[11px] font-medium text-primary backdrop-blur shadow-[var(--shadow-neon)] ${c.cls}`}>
            <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-secondary align-middle" />{c.label}
          </div>
        ))}

        {/* Hero copy — centred, relative so it floats above the video */}
        <div className="relative z-10 flex flex-col items-center px-4">
          <span className="inline-flex items-center gap-2 rounded-full border border-primary/40 bg-background/40 px-4 py-1.5 text-[11px] font-medium uppercase tracking-[0.18em] text-primary backdrop-blur">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" /> AI ad studio for product launches
          </span>
          <h1 className="mt-8 font-display text-5xl font-bold leading-[1.02] tracking-tight text-glow md:text-7xl lg:text-8xl">
            Describe your product.<br />
            <span className="text-gold-gradient">Post everywhere.</span>
          </h1>
          <p className="mt-6 max-w-2xl text-base text-muted-foreground md:text-lg lg:text-xl">
            NivaAd turns one brief — or just a product link — into ready-to-post ads with copy, image, video and carousels, scored and compliance-checked for every platform you tick.
          </p>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <Link to={isAuthed ? "/app" : "/signup"}
                  className="group relative overflow-hidden rounded-full bg-gold-gradient px-7 py-3.5 font-medium text-background shadow-[var(--shadow-gold)] text-base">
              <span className="relative z-10">{isAuthed ? "Go to your dashboard →" : "Create your first ad — free"}</span>
              <span className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 bg-white/30 blur-md animate-sheen" />
            </Link>
            <Link to="/pricing" className="rounded-full border border-border px-7 py-3.5 font-medium hover:border-primary/60 text-base">See pricing</Link>
          </div>
          <p className="mt-5 text-xs text-muted-foreground">Free plan · no card required · transparent credits</p>
        </div>

        {/* Scroll hint */}
        <div aria-hidden className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 opacity-50">
          <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Scroll</span>
          <div className="h-8 w-px overflow-hidden rounded-full bg-border">
            <div className="h-1/2 w-full bg-primary animate-bounce" />
          </div>
        </div>
      </section>

      {/* ── Animated divider ─────────────────────────────────────────────── */}
      <GlowDivider />

      {/* ── Feature cards (full width with inner max-w container) ───────── */}
      <section className="relative w-full px-4 py-16 md:py-20">
        <div className="mx-auto max-w-7xl">
          <div className="mb-10 text-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-primary/40 bg-background/40 px-4 py-1.5 text-[11px] font-medium uppercase tracking-[0.18em] text-primary backdrop-blur">
              How it works
            </span>
            <h2 className="mt-4 font-display text-3xl font-bold text-glow md:text-4xl lg:text-5xl">
              From brief to posted.<br />
              <span className="text-gold-gradient">In minutes.</span>
            </h2>
            <p className="mt-3 mx-auto max-w-xl text-muted-foreground md:text-lg">
              No design skills, no ad expertise needed — NivaAd handles the creative and the compliance, you stay focused on your product.
            </p>
          </div>
          <div className="grid gap-4 text-left md:grid-cols-3">
            {([
              { t: "Start from a link", d: "Paste a product URL and NivaAd extracts the details — or fill a 60-second guided brief.", bg: featLink, Icon: Link2 },
              { t: "Scored & compliant", d: "Every ad gets an AI engagement score, an improvement tip, and platform policy checks before you post.", bg: featScore, Icon: ShieldCheck },
              { t: "Launch campaigns", d: "Generate teaser → launch → follow-up sets and schedule them at each platform's best time.", bg: featLaunch, Icon: Rocket },
            ] as { t: string; d: string; bg: string; Icon: LucideIcon }[]).map((f) => (
              <div key={f.t}
                   className="group glow-border relative overflow-hidden rounded-2xl border border-border transition hover:border-primary/60 min-h-[280px]">
                <img src={f.bg} alt="" aria-hidden loading="lazy" width={1024} height={768}
                     className="absolute inset-0 h-full w-full object-cover opacity-95 transition duration-500 group-hover:opacity-45 group-hover:scale-105" />
                <div className="absolute inset-0 bg-gradient-to-t from-background/90 via-background/40 to-transparent transition-opacity duration-500 group-hover:opacity-0" />
                <div className="absolute inset-0 bg-gradient-to-br from-background/85 via-background/70 to-background/85 opacity-0 backdrop-blur-xl transition-opacity duration-500 group-hover:opacity-100" />
                <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden opacity-0 transition-opacity duration-500 group-hover:opacity-100 animate-aurora-hue">
                  <div className="absolute -inset-[30%] animate-aurora-a mix-blend-screen" style={{ background: "radial-gradient(40% 55% at 25% 40%, oklch(0.85 0.2 200 / 0.75), transparent 70%)" }} />
                  <div className="absolute -inset-[30%] animate-aurora-b mix-blend-screen" style={{ background: "radial-gradient(38% 55% at 70% 55%, oklch(0.7 0.24 300 / 0.75), transparent 70%)" }} />
                  <div className="absolute -inset-[30%] animate-aurora-c mix-blend-screen" style={{ background: "radial-gradient(45% 55% at 50% 75%, oklch(0.78 0.22 160 / 0.7), transparent 70%)" }} />
                </div>
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 transition-all duration-500 group-hover:opacity-100">
                  <f.Icon className="h-40 w-40 text-primary drop-shadow-[0_0_28px_oklch(0.66_0.26_305/0.55)] transition-transform duration-500 group-hover:scale-110" strokeWidth={1.25} aria-hidden />
                </div>
                <div className="relative flex h-full min-h-[280px] flex-col justify-end p-6">
                  <div className="mb-3 grid h-9 w-9 place-items-center rounded-md border border-primary/40 bg-background/50 text-primary shadow-[var(--shadow-neon)] backdrop-blur">
                    <f.Icon className="h-4 w-4" strokeWidth={2} aria-hidden />
                  </div>
                  <div className="font-display text-lg font-semibold text-glow">{f.t}</div>
                  <p className="mt-2 text-sm text-foreground/85 transition-colors group-hover:text-muted-foreground">{f.d}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Animated divider ─────────────────────────────────────────────── */}
      <GlowDivider />

      {/* ── Video explainer section ──────────────────────────────────────── */}
      <section className="relative w-full px-4 py-16 md:py-24">
        <div className="mx-auto max-w-7xl">
          {/* Section heading */}
          <div className="mb-10 text-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-primary/40 bg-background/40 px-4 py-1.5 text-[11px] font-medium uppercase tracking-[0.18em] text-primary backdrop-blur">
              <Play className="h-3 w-3" /> See it in action
            </span>
            <h2 className="mt-4 font-display text-3xl font-bold text-glow md:text-4xl lg:text-5xl">Watch how it works</h2>
            <p className="mt-3 text-muted-foreground md:text-lg">Everything you need to go from idea to posted ad in minutes.</p>
          </div>

          {/* Featured main video — Vimeo embed */}
          <FeaturedVideo />

          {/* ── Animated divider ─────────────────────────────────────────── */}
          <div className="my-10">
            <GlowDivider />
          </div>

          {/* Carousel label */}
          <div className="mb-6 flex items-center justify-between">
            <p className="font-display text-sm font-semibold text-muted-foreground uppercase tracking-widest">Explore by feature</p>
            <p className="text-xs text-muted-foreground">{videoCards.length} videos</p>
          </div>

          {/* Rotating video carousel */}
          <VideoCarousel />
        </div>
      </section>

      {/* ── Animated divider ─────────────────────────────────────────────── */}
      <GlowDivider />

      {/* ── Studio sample ads — full-bleed aurora background ────────────── */}
      <section className="relative w-full overflow-hidden py-20 md:py-28">
        {/* Aurora fills the entire section background */}
        <div aria-hidden className="pointer-events-none absolute inset-0 animate-aurora-hue">
          <div className="absolute -inset-[40%] animate-aurora-a opacity-90 mix-blend-screen"
               style={{ background: "radial-gradient(40% 55% at 25% 40%, oklch(0.85 0.2 200 / 0.9), transparent 70%)" }} />
          <div className="absolute -inset-[40%] animate-aurora-b opacity-85 mix-blend-screen"
               style={{ background: "radial-gradient(38% 55% at 70% 55%, oklch(0.7 0.24 300 / 0.85), transparent 70%)" }} />
          <div className="absolute -inset-[40%] animate-aurora-c opacity-80 mix-blend-screen"
               style={{ background: "radial-gradient(45% 55% at 50% 75%, oklch(0.78 0.22 160 / 0.8), transparent 70%)" }} />
        </div>
        {/* Legibility scrim — fades in from edges so text stays readable */}
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-b from-background/60 via-background/20 to-background/60" />
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-r from-background/40 via-transparent to-background/40" />

        <div className="relative mx-auto max-w-7xl px-4">
          <div className="text-center">
            <h2 className="font-display text-3xl font-bold text-glow md:text-4xl lg:text-5xl">Fresh from the studio</h2>
            <p className="mt-2 text-sm text-muted-foreground">Sample ads generated by NivaAd — one brief each, zero designers.</p>
          </div>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {platforms.map((p) => (
              <article key={p.title}
                       className="group glow-border relative overflow-hidden rounded-2xl border border-border/70 bg-card/40 p-5 backdrop-blur-xl transition hover:border-primary/60 hover:shadow-[var(--shadow-neon)]">
                <span className="inline-flex rounded-full border border-primary/40 bg-background/50 px-2.5 py-1 text-[10px] font-medium uppercase tracking-widest text-primary">{p.tag}</span>
                <div className="relative mt-5 mb-4 aspect-square overflow-hidden rounded-xl border border-border/60">
                  <img src={p.img} alt={p.title} loading="lazy" width={1024} height={1024}
                       className="h-full w-full object-cover transition duration-500 group-hover:scale-105" />
                  <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-background/60 via-transparent to-transparent" />
                  <div className="pointer-events-none absolute inset-0 opacity-0 shadow-[inset_0_0_40px_oklch(0.66_0.26_305/0.55)] transition-opacity duration-500 group-hover:opacity-100" />
                </div>
                <div className="flex items-center justify-between">
                  <div className="font-display text-sm font-semibold">{p.title}</div>
                  <span className="rounded-full border border-border px-2 py-0.5 text-[9px] uppercase tracking-widest text-muted-foreground">AI generated</span>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">{p.copy}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ── Animated divider ─────────────────────────────────────────────── */}
      <GlowDivider />

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-8 text-xs text-muted-foreground">
          <div>© 2026 NivaAd · Powered by <span className="text-primary">Nivatier</span></div>
          <div className="flex gap-5">
            <a href="#" className="hover:text-foreground">Terms</a>
            <a href="#" className="hover:text-foreground">Privacy</a>
            <a href="#" className="hover:text-foreground">Acceptable Use</a>
          </div>
        </div>
      </footer>

      <LoginModal open={showLogin} onClose={() => setShowLogin(false)} />
    </div>
  );
}
