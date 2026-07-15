import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
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
import { Link2, ShieldCheck, Rocket, type LucideIcon } from "lucide-react";

export const Route = createFileRoute("/")({
  component: Index,
});

const platforms = [
  { tag: "Instagram", title: "Pulse One Smartwatch", copy: "Your health, one glance away. 7-day battery.", img: adPulse },
  { tag: "TikTok", title: "Volt Runners", copy: "Engineered for the streets. Featherlight. -20% launch.", img: adVolt },
  { tag: "Facebook", title: "Ember Cold Brew", copy: "Slow-steeped 18 hours. Zero bitterness. Free shipping.", img: adEmber },
  { tag: "LinkedIn", title: "Lumière Serum", copy: "Clinically proven glow in 14 days. Dermatologist approved.", img: adLumiere },
];

function Index() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const { isAuthed, me } = useAuth();
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="sticky top-4 z-50">
        <div className="mx-auto max-w-7xl px-4">
        <header className="glow-border relative flex items-center justify-between gap-4 overflow-hidden rounded-2xl border border-border bg-card/70 px-4 py-3 shadow-[0_10px_40px_-20px_oklch(0.58_0.19_240/0.35)] backdrop-blur-xl md:px-6">
          {/* Aurora curtains inside the pill */}
          <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden animate-aurora-hue">
            <div
              className="absolute -inset-[40%] animate-aurora-a opacity-80 mix-blend-screen"
              style={{
                background:
                  "radial-gradient(40% 60% at 30% 50%, oklch(0.85 0.2 200 / 0.85), transparent 70%)",
              }}
            />
            <div
              className="absolute -inset-[40%] animate-aurora-b opacity-75 mix-blend-screen"
              style={{
                background:
                  "radial-gradient(35% 55% at 65% 50%, oklch(0.7 0.24 300 / 0.8), transparent 70%)",
              }}
            />
            <div
              className="absolute -inset-[40%] animate-aurora-c opacity-70 mix-blend-screen"
              style={{
                background:
                  "radial-gradient(45% 50% at 50% 60%, oklch(0.78 0.22 160 / 0.75), transparent 70%)",
              }}
            />
          </div>
          <Link to="/" className="flex min-w-0 items-center gap-2.5">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-gold-gradient font-display font-bold text-background">N</div>
            <div className="min-w-0 leading-tight">
              <div className="truncate font-display font-bold tracking-tight">NivaAd</div>
              <div className="hidden truncate text-[10px] uppercase tracking-[0.2em] text-muted-foreground sm:block">Powered by Nivatier</div>
            </div>
          </Link>
          {/* Desktop nav */}
          <nav className="hidden items-center gap-2 text-sm md:flex">
            <Link to="/pricing" className="rounded-full px-4 py-2 text-muted-foreground hover:text-foreground">Pricing</Link>
            {isAuthed ? (
              <Link to="/app" className="flex items-center gap-2 rounded-full bg-gold-gradient px-4 py-2 font-medium text-background shadow-[var(--shadow-gold)]">
                <span className="grid h-5 w-5 place-items-center rounded-full bg-background/25 text-[10px] font-bold">{(me?.company_name || "?").charAt(0).toUpperCase()}</span>
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
            <button
              type="button"
              aria-label="Open menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((v) => !v)}
              className="grid h-9 w-9 place-items-center rounded-full border border-border bg-card/60 text-foreground"
            >
              <span className="relative block h-3 w-4">
                <span className={`absolute left-0 top-0 h-0.5 w-full bg-current transition ${menuOpen ? "translate-y-1.5 rotate-45" : ""}`} />
                <span className={`absolute left-0 top-1.5 h-0.5 w-full bg-current transition ${menuOpen ? "opacity-0" : ""}`} />
                <span className={`absolute left-0 top-3 h-0.5 w-full bg-current transition ${menuOpen ? "-translate-y-1.5 -rotate-45" : ""}`} />
              </span>
            </button>
          </div>
        </header>
        {/* Mobile dropdown menu */}
        <div
          className={`md:hidden overflow-hidden transition-[max-height,opacity] duration-300 ${
            menuOpen ? "mt-2 max-h-72 opacity-100" : "max-h-0 opacity-0"
          }`}
        >
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

      <section className="mx-auto max-w-7xl px-4 pt-6 md:pt-8">
        <div className="grain glow-border relative overflow-hidden rounded-2xl border border-border bg-card/40 px-6 py-20 text-center shadow-[0_20px_80px_-40px_oklch(0.58_0.19_240/0.45)] backdrop-blur-sm md:py-24">
        {/* Motion graphics — constrained to the hero copy area only */}
        <div aria-hidden className="pointer-events-none absolute inset-0">
          {/* Cinematic hero visual behind everything */}
          <img
            src={heroVisual}
            alt=""
            width={1600}
            height={1104}
            className="absolute left-1/2 top-1/2 w-[120%] max-w-none -translate-x-1/2 -translate-y-1/2 opacity-70 animate-float-slow select-none [mask-image:radial-gradient(ellipse_at_center,_#000_35%,_transparent_75%)] [-webkit-mask-image:radial-gradient(ellipse_at_center,_#000_35%,_transparent_75%)]"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-background/60 via-background/30 to-background/90" />
          {/* Glow blobs */}
          <div className="absolute left-1/2 top-16 h-72 w-[560px] -translate-x-1/2 rounded-full bg-primary/25 blur-3xl animate-pulse-glow" />
          <div className="absolute right-4 top-40 h-56 w-56 rounded-full bg-secondary/25 blur-3xl animate-drift" />
          <div className="absolute left-6 bottom-10 h-52 w-52 rounded-full bg-accent/30 blur-3xl animate-drift" style={{ animationDelay: "-6s" }} />
          {/* Rotating conic ring */}
          <div className="absolute left-1/2 top-32 h-[520px] w-[520px] -translate-x-1/2 rounded-full opacity-40 animate-spin-slow"
               style={{ background: "conic-gradient(from 0deg, transparent 0deg, oklch(0.66 0.26 305 / 0.5) 60deg, transparent 120deg, oklch(0.85 0.18 210 / 0.55) 220deg, transparent 300deg)", mask: "radial-gradient(circle, transparent 46%, #000 47%, #000 49%, transparent 50%)", WebkitMask: "radial-gradient(circle, transparent 46%, #000 47%, #000 49%, transparent 50%)" }} />
          {/* Faint grid */}
          <div className="absolute inset-x-0 bottom-0 h-56 opacity-[0.08]"
               style={{ backgroundImage: "linear-gradient(oklch(0.85 0.18 210) 1px, transparent 1px), linear-gradient(90deg, oklch(0.66 0.26 305) 1px, transparent 1px)", backgroundSize: "40px 40px", maskImage: "linear-gradient(to top, #000, transparent)", WebkitMaskImage: "linear-gradient(to top, #000, transparent)" }} />
          {/* Orbiting platform chips */}
          {[
            { label: "Instagram", cls: "left-[8%] top-[32%] animate-float", d: "0s" },
            { label: "TikTok", cls: "right-[10%] top-[26%] animate-float-slow", d: "-2s" },
            { label: "LinkedIn", cls: "left-[14%] bottom-[18%] animate-float-slow", d: "-4s" },
            { label: "Facebook", cls: "right-[8%] bottom-[24%] animate-float", d: "-1s" },
          ].map((c) => (
            <div key={c.label} style={{ animationDelay: c.d }}
                 className={`absolute hidden md:block rounded-full border border-primary/40 bg-card/60 px-3 py-1.5 text-[11px] font-medium text-primary backdrop-blur shadow-[var(--shadow-neon)] ${c.cls}`}>
              <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-secondary align-middle" />{c.label}
            </div>
          ))}
        </div>

        <span className="relative inline-flex items-center gap-2 rounded-full border border-primary/40 bg-background/40 px-4 py-1.5 text-[11px] font-medium uppercase tracking-[0.18em] text-primary backdrop-blur">
          <span className="h-1.5 w-1.5 rounded-full bg-primary" /> AI ad studio for product launches
        </span>
        <h1 className="relative mt-8 font-display text-5xl font-bold leading-[1.02] tracking-tight text-glow md:text-7xl">
          Describe your product.<br />
          <span className="text-gold-gradient">Post everywhere.</span>
        </h1>
        <p className="relative mx-auto mt-6 max-w-2xl text-base text-muted-foreground md:text-lg">
          NivaAd turns one brief — or just a product link — into ready-to-post ads with copy, image, video and carousels, scored and compliance-checked for every platform you tick.
        </p>
        <div className="relative mt-9 flex flex-wrap items-center justify-center gap-3">
          <Link to={isAuthed ? "/app" : "/signup"} className="group relative overflow-hidden rounded-full bg-gold-gradient px-6 py-3 font-medium text-background shadow-[var(--shadow-gold)]">
            <span className="relative z-10">{isAuthed ? "Go to your dashboard →" : "Create your first ad — free"}</span>
            <span className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 bg-white/30 blur-md animate-sheen" />
          </Link>
          <Link to="/pricing" className="rounded-full border border-border px-6 py-3 font-medium hover:border-primary/60">See pricing</Link>
        </div>
        <p className="relative mt-4 text-xs text-muted-foreground">Free plan · no card required · transparent credits</p>
        </div>
      </section>

      <section className="relative mx-auto max-w-7xl px-4 py-12 md:py-16">
        <div className="grid gap-4 text-left md:grid-cols-3">
          {([
            { t: "Start from a link", d: "Paste a product URL and NivaAd extracts the details — or fill a 60-second guided brief.", bg: featLink, Icon: Link2 },
            { t: "Scored & compliant", d: "Every ad gets an AI engagement score, an improvement tip, and platform policy checks before you post.", bg: featScore, Icon: ShieldCheck },
            { t: "Launch campaigns", d: "Generate teaser → launch → follow-up sets and schedule them at each platform's best time.", bg: featLaunch, Icon: Rocket },
          ] as { t: string; d: string; bg: string; Icon: LucideIcon }[]).map((f) => (
            <div
              key={f.t}
              className="group glow-border relative overflow-hidden rounded-2xl border border-border transition hover:border-primary/60 min-h-[260px]"
            >
              <img
                src={f.bg}
                alt=""
                aria-hidden="true"
                loading="lazy"
                width={1024}
                height={768}
                className="absolute inset-0 h-full w-full object-cover opacity-95 transition duration-500 group-hover:opacity-45 group-hover:scale-105"
              />
              {/* Default: subtle darken for legibility. Hover: heavy frost = current view. */}
              <div className="absolute inset-0 bg-gradient-to-t from-background/90 via-background/40 to-transparent transition-opacity duration-500 group-hover:opacity-0" />
              <div className="absolute inset-0 bg-gradient-to-br from-background/85 via-background/70 to-background/85 opacity-0 backdrop-blur-xl transition-opacity duration-500 group-hover:opacity-100" />
              {/* Aurora curtains on hover */}
              <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden opacity-0 transition-opacity duration-500 group-hover:opacity-100 animate-aurora-hue">
                <div
                  className="absolute -inset-[30%] animate-aurora-a mix-blend-screen"
                  style={{ background: "radial-gradient(40% 55% at 25% 40%, oklch(0.85 0.2 200 / 0.75), transparent 70%)" }}
                />
                <div
                  className="absolute -inset-[30%] animate-aurora-b mix-blend-screen"
                  style={{ background: "radial-gradient(38% 55% at 70% 55%, oklch(0.7 0.24 300 / 0.75), transparent 70%)" }}
                />
                <div
                  className="absolute -inset-[30%] animate-aurora-c mix-blend-screen"
                  style={{ background: "radial-gradient(45% 55% at 50% 75%, oklch(0.78 0.22 160 / 0.7), transparent 70%)" }}
                />
              </div>
              {/* Big contextual icon revealed on hover */}
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 transition-all duration-500 group-hover:opacity-100">
                <f.Icon
                  className="h-40 w-40 text-primary drop-shadow-[0_0_28px_oklch(0.66_0.26_305/0.55)] transition-transform duration-500 group-hover:scale-110"
                  strokeWidth={1.25}
                  aria-hidden
                />
              </div>
              <div className="relative flex h-full min-h-[260px] flex-col justify-end p-6">
                <div className="mb-3 grid h-9 w-9 place-items-center rounded-md border border-primary/40 bg-background/50 text-primary shadow-[var(--shadow-neon)] backdrop-blur">
                  <f.Icon className="h-4 w-4" strokeWidth={2} aria-hidden />
                </div>
                <div className="font-display text-lg font-semibold text-glow">{f.t}</div>
                <p className="mt-2 text-sm text-foreground/85 transition-colors group-hover:text-muted-foreground">{f.d}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="relative mx-auto max-w-7xl px-4 py-12 md:py-16">
        <div className="glow-border relative overflow-hidden rounded-3xl border border-border bg-card/40">
          {/* Aurora curtains behind the studio panel */}
          <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden animate-aurora-hue">
            <div
              className="absolute -inset-[40%] animate-aurora-a opacity-90 mix-blend-screen"
              style={{ background: "radial-gradient(40% 55% at 25% 40%, oklch(0.85 0.2 200 / 0.9), transparent 70%)" }}
            />
            <div
              className="absolute -inset-[40%] animate-aurora-b opacity-85 mix-blend-screen"
              style={{ background: "radial-gradient(38% 55% at 70% 55%, oklch(0.7 0.24 300 / 0.85), transparent 70%)" }}
            />
            <div
              className="absolute -inset-[40%] animate-aurora-c opacity-80 mix-blend-screen"
              style={{ background: "radial-gradient(45% 55% at 50% 75%, oklch(0.78 0.22 160 / 0.8), transparent 70%)" }}
            />
          </div>
          {/* Legibility scrim so text stays readable over the aurora */}
          <div className="absolute inset-0 bg-gradient-to-b from-background/40 via-background/25 to-background/55" />
          <div className="relative px-6 py-16 md:px-10">
            <div className="text-center">
              <h2 className="font-display text-3xl font-bold text-glow md:text-4xl">Fresh from the studio</h2>
              <p className="mt-2 text-sm text-muted-foreground">Sample ads generated by NivaAd — one brief each, zero designers.</p>
            </div>
            <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {platforms.map((p) => (
                <article
                  key={p.title}
                  className="group relative overflow-hidden rounded-2xl border border-border/70 bg-card/40 p-5 backdrop-blur-xl transition hover:border-primary/60 hover:shadow-[var(--shadow-neon)]"
                >
                  <span className="inline-flex rounded-full border border-primary/40 bg-background/50 px-2.5 py-1 text-[10px] font-medium uppercase tracking-widest text-primary">{p.tag}</span>
                  <div className="relative mt-5 mb-4 aspect-square overflow-hidden rounded-xl border border-border/60">
                    <img
                      src={p.img}
                      alt={p.title}
                      loading="lazy"
                      width={1024}
                      height={1024}
                      className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
                    />
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
        </div>
      </section>

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