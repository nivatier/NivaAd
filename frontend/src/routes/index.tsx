import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useRef, useCallback, useEffect } from "react";
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
import { Link2, ShieldCheck, Rocket, Play, X, type LucideIcon } from "lucide-react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Dialog, DialogOverlay, DialogPortal } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  component: Index,
});

const VIMEO_ID = "1118789146";

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

// ── Hero background — CSS-only parallax via scroll-driven scale ──────────────
// Replaces the 60fps RAF loop. Uses a CSS transform triggered by scroll
// position via IntersectionObserver + CSS custom property — no per-frame JS.
// Falls back to a static image. The video plays but has NO JS transform loop.
function HeroBackground() {
  const videoRef = useRef<HTMLVideoElement>(null);

  // Throttled scroll → subtle scale only (no 3D perspective, no RAF loop)
  useEffect(() => {
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const s = 1 + Math.min(window.scrollY * 0.00015, 0.08);
        if (videoRef.current) {
          videoRef.current.style.transform = `scale(${s})`;
        }
        ticking = false;
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <img
        src={heroVisual}
        alt=""
        aria-hidden
        className="absolute inset-0 h-full w-full object-cover opacity-60"
      />
      <video
        ref={videoRef}
        autoPlay
        muted
        loop
        playsInline
        poster={heroVisual}
        className="absolute inset-0 h-full w-full object-cover opacity-70 will-change-transform"
        style={{ transformOrigin: "center center" }}
      >
        <source src="/hero.mp4" type="video/mp4" />
      </video>
      {/* Static gradient vignettes — no animation */}
      <div className="absolute inset-0 bg-gradient-to-b from-background/60 via-background/15 to-background/90" />
      <div className="absolute inset-0 bg-gradient-to-r from-background/35 via-transparent to-background/35" />
    </div>
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

  return (
    <>
      <div className="group relative overflow-hidden rounded-2xl border border-border bg-card/40">
        <div className="flex flex-col md:flex-row">
          {/* Vimeo embed preview — pointer-events-none; click anywhere opens modal */}
          <div
            className="relative aspect-video cursor-pointer overflow-hidden md:w-3/5"
            onClick={() => setModalOpen(true)}
          >
            <iframe
              src={`https://player.vimeo.com/video/${VIMEO_ID}?badge=0&autopause=0&player_id=0&app_id=58479`}
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
          <div className="flex flex-col justify-center p-6 md:w-2/5 md:p-10">
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

      <VimeoModal vimeoId={VIMEO_ID} open={modalOpen} onClose={() => setModalOpen(false)} />
    </>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────
function Index() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [loginInitialMode, setLoginInitialMode] = useState<"login" | "register">("login");

  function openLogin() { setLoginInitialMode("login"); setShowLogin(true); }
  function openRegister() { setLoginInitialMode("register"); setShowLogin(true); }
  const { isAuthed, me } = useAuth();

  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-hidden">

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
                  <button onClick={openRegister} className="rounded-full bg-gold-gradient px-4 py-2 font-medium text-background shadow-[var(--shadow-gold)]">Start free</button>
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
                  <button onClick={() => { setMenuOpen(false); openRegister(); }} className="mt-1 block w-full rounded-xl bg-gold-gradient px-4 py-3 text-center text-sm font-medium text-background shadow-[var(--shadow-gold)]">Start free</button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Hero — full bleed, CSS-only effects ──────────────────────────── */}
      <section className="grain relative flex min-h-screen w-full flex-col items-center justify-center overflow-hidden border-b border-border text-center pt-[76px]">
        <HeroBackground />

        {/* Two static glow blobs — no animation, GPU-composited via opacity only */}
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="absolute left-1/2 top-1/4 h-72 w-[520px] -translate-x-1/2 rounded-full bg-primary/15 blur-3xl" />
          <div className="absolute right-1/4 top-1/3 h-48 w-48 rounded-full bg-secondary/15 blur-3xl" />
          {/* Static perspective grid */}
          <div className="absolute inset-x-0 bottom-0 h-56 opacity-[0.05]"
               style={{ backgroundImage: "linear-gradient(oklch(0.85 0.18 210) 1px, transparent 1px), linear-gradient(90deg, oklch(0.66 0.26 305) 1px, transparent 1px)", backgroundSize: "48px 48px", maskImage: "linear-gradient(to top, #000 0%, transparent 100%)", WebkitMaskImage: "linear-gradient(to top, #000 0%, transparent 100%)" }} />
        </div>

        {/* Platform chips — CSS opacity/transform only, no backdrop-blur */}
        {[
          { label: "Instagram", cls: "left-[6%] top-[38%] animate-float" },
          { label: "TikTok",    cls: "right-[8%] top-[30%] animate-float-slow" },
          { label: "LinkedIn",  cls: "left-[10%] bottom-[22%] animate-float-slow" },
          { label: "Facebook",  cls: "right-[6%] bottom-[28%] animate-float" },
          { label: "X",         cls: "left-[22%] top-[20%] animate-float" },
          { label: "TikTok",    cls: "right-[20%] bottom-[18%] animate-float-slow" },
        ].map((c, i) => (
          <div key={`${c.label}-${i}`}
               aria-hidden
               className={`absolute hidden md:block rounded-full border border-primary/40 bg-card/60 px-3 py-1.5 text-[11px] font-medium text-primary ${c.cls}`}>
            <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-secondary align-middle" />{c.label}
          </div>
        ))}

        {/* Hero copy */}
        <div className="relative z-10 flex flex-col items-center px-4">
          <span className="inline-flex items-center gap-2 rounded-full border border-primary/40 bg-background/40 px-4 py-1.5 text-[11px] font-medium uppercase tracking-[0.18em] text-primary">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" /> AI ad studio for product launches
          </span>
          <h1 className="mt-8 font-display text-5xl font-bold leading-[1.02] tracking-tight text-glow md:text-7xl lg:text-8xl">
            Describe your product.<br />
            <span className="text-gold-gradient">Post everywhere.</span>
          </h1>
          <p className="mt-6 max-w-2xl text-base text-muted-foreground md:text-lg lg:text-xl">
            NivaSpark turns one brief — or just a product link — into ready-to-post ads with copy, image, video and carousels, scored and compliance-checked for every platform you tick.
          </p>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            {isAuthed ? (
              <Link to="/app" className="rounded-full bg-gold-gradient px-7 py-3.5 font-medium text-background shadow-[var(--shadow-gold)] text-base">Go to your dashboard →</Link>
            ) : (
              <button onClick={openRegister} className="rounded-full bg-gold-gradient px-7 py-3.5 font-medium text-background shadow-[var(--shadow-gold)] text-base">Create your first ad — free</button>
            )}
            <Link to="/pricing" className="rounded-full border border-border px-7 py-3.5 font-medium hover:border-primary/60 text-base">See pricing</Link>
          </div>
          <p className="mt-5 text-xs text-muted-foreground">Free plan · no card required · transparent credits</p>
        </div>

        {/* Scroll hint — CSS bounce only */}
        <div aria-hidden className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 opacity-40">
          <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Scroll</span>
          <div className="h-8 w-px overflow-hidden rounded-full bg-border">
            <div className="h-1/2 w-full bg-primary animate-bounce" />
          </div>
        </div>
      </section>

      <GlowDivider />

      {/* ── Feature cards ────────────────────────────────────────────────── */}
      <section className="relative w-full overflow-hidden px-4 py-16 md:py-20">
        {/* Amber-gold + rose wash */}
        <div aria-hidden className="pointer-events-none absolute inset-0"
             style={{ background: "radial-gradient(65% 60% at 15% 25%, oklch(0.78 0.18 52 / 0.11), transparent 65%), radial-gradient(55% 50% at 82% 70%, oklch(0.72 0.22 25 / 0.10), transparent 65%), radial-gradient(45% 45% at 50% 95%, oklch(0.80 0.16 65 / 0.07), transparent 65%)" }} />
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-b from-background/50 via-transparent to-background/50" />
        <div className="relative mx-auto max-w-7xl">
          <div className="mb-10 text-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-primary/40 bg-background/40 px-4 py-1.5 text-[11px] font-medium uppercase tracking-[0.18em] text-primary">
              How it works
            </span>
            <h2 className="mt-4 font-display text-3xl font-bold text-glow md:text-4xl lg:text-5xl">
              From brief to posted.<br />
              <span className="text-gold-gradient">In minutes.</span>
            </h2>
            <p className="mt-3 mx-auto max-w-xl text-muted-foreground md:text-lg">
              No design skills, no ad expertise needed — NivaSpark handles the creative and the compliance, you stay focused on your product.
            </p>
          </div>
          <div className="grid gap-4 text-left md:grid-cols-3">
            {([
              { t: "Start from a link", d: "Paste a product URL and NivaSpark extracts the details — or fill a 60-second guided brief.", bg: featLink, Icon: Link2 },
              { t: "Scored & compliant", d: "Every ad gets an AI engagement score, an improvement tip, and platform policy checks before you post.", bg: featScore, Icon: ShieldCheck },
              { t: "Launch campaigns", d: "Generate teaser → launch → follow-up sets and schedule them at each platform's best time.", bg: featLaunch, Icon: Rocket },
            ] as { t: string; d: string; bg: string; Icon: LucideIcon }[]).map((f) => (
              <div key={f.t}
                   className="group relative overflow-hidden rounded-2xl border border-border transition hover:border-primary/60 min-h-[280px]">
                <img src={f.bg} alt="" aria-hidden loading="lazy" width={1024} height={768}
                     className="absolute inset-0 h-full w-full object-cover opacity-95 transition duration-500 group-hover:opacity-40 group-hover:scale-105" />
                {/* Single gradient overlay — no animated aurora, no backdrop-blur on hover */}
                <div className="absolute inset-0 bg-gradient-to-t from-background/90 via-background/30 to-transparent" />
                <div className="absolute inset-0 bg-background/70 opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
                {/* Icon reveal on hover */}
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 transition-all duration-500 group-hover:opacity-100">
                  <f.Icon className="h-36 w-36 text-primary/60 transition-transform duration-500 group-hover:scale-110" strokeWidth={1.25} aria-hidden />
                </div>
                <div className="relative flex h-full min-h-[280px] flex-col justify-end p-6">
                  <div className="mb-3 grid h-9 w-9 place-items-center rounded-md border border-primary/40 bg-background/50 text-primary">
                    <f.Icon className="h-4 w-4" strokeWidth={2} aria-hidden />
                  </div>
                  <div className="font-display text-lg font-semibold text-glow">{f.t}</div>
                  <p className="mt-2 text-sm text-foreground/85">{f.d}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

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

          {/* Subscribe hook — static gradient background, no aurora */}
          <div className="mt-8 relative overflow-hidden rounded-2xl border border-border px-6 py-8 text-center md:px-12 tutorial-cta-box">
            {/* Colour wash — theme-aware via CSS */}
            <div aria-hidden className="tutorial-cta-wash pointer-events-none absolute inset-0" />
            <div className="relative">
              <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full border border-primary/40 bg-primary/10 text-primary">
                <Play className="h-5 w-5 translate-x-0.5" strokeWidth={2} />
              </div>
              <h3 className="font-display text-xl font-bold text-glow md:text-2xl">
                Want the full feature walkthrough?
              </h3>
              <p className="mt-2 mx-auto max-w-lg text-sm text-muted-foreground md:text-base">
                Subscribers get access to 11 in-depth tutorials — one for every part of NivaSpark, from creating your first ad to automating campaigns with Agent Niva.
              </p>
              <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                <button onClick={openRegister} className="rounded-full bg-gold-gradient px-6 py-3 font-medium text-background shadow-[var(--shadow-gold)]">
                  Start free — unlock all tutorials →
                </button>
                <Link to="/pricing" className="rounded-full border border-border px-6 py-3 text-sm font-medium hover:border-primary/60">
                  See plans
                </Link>
              </div>
              <p className="mt-4 text-xs text-muted-foreground">Free plan available · no credit card required</p>
            </div>
          </div>
        </div>
      </section>

      <GlowDivider />

      {/* ── Studio sample ads — static gradient background ───────────────── */}
      <section className="relative w-full overflow-hidden py-20 md:py-28">
        {/* Static two-colour wash — replaces 3 animated aurora blobs */}
        <div aria-hidden className="pointer-events-none absolute inset-0"
             style={{ background: "radial-gradient(70% 60% at 20% 30%, oklch(0.85 0.2 200 / 0.10), transparent 65%), radial-gradient(60% 55% at 78% 65%, oklch(0.66 0.26 305 / 0.10), transparent 65%), radial-gradient(50% 50% at 50% 90%, oklch(0.78 0.22 160 / 0.07), transparent 65%)" }} />
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-b from-background/50 via-transparent to-background/50" />

        <div className="relative mx-auto max-w-7xl px-4">
          <div className="text-center">
            <h2 className="font-display text-3xl font-bold text-glow md:text-4xl lg:text-5xl">Fresh from the studio</h2>
            <p className="mt-2 text-sm text-muted-foreground">Sample ads generated by NivaSpark — one brief each, zero designers.</p>
          </div>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {platforms.map((p) => (
              <article key={p.title}
                       className="group relative overflow-hidden rounded-2xl border border-border/70 bg-card/40 p-5 transition hover:border-primary/60">
                <span className="inline-flex rounded-full border border-primary/40 bg-background/50 px-2.5 py-1 text-[10px] font-medium uppercase tracking-widest text-primary">{p.tag}</span>
                <div className="relative mt-5 mb-4 aspect-square overflow-hidden rounded-xl border border-border/60">
                  <img src={p.img} alt={p.title} loading="lazy" width={1024} height={1024}
                       className="h-full w-full object-cover transition duration-500 group-hover:scale-105" />
                  <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-background/50 via-transparent to-transparent" />
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

      <GlowDivider />

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-8 text-xs text-muted-foreground">
          <div>© 2026 NivaSpark · Powered by <a href="https://www.nivatier.com" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Nivatier</a></div>
          <div className="flex gap-5">
            <a href="#" className="hover:text-foreground">Terms</a>
            <a href="#" className="hover:text-foreground">Privacy</a>
            <a href="#" className="hover:text-foreground">Acceptable Use</a>
          </div>
        </div>
      </footer>

      <LoginModal open={showLogin} onClose={() => setShowLogin(false)} initialMode={loginInitialMode} />
    </div>
  );
}
