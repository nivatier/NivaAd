import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { fetchAndCacheAudio, pruneAudioCache } from "@/lib/audio-cache";

/** Docked ("asleep"/idle-awake resting) position — near the top-right of
 * the header. Expressed as px from the top-right corner of the viewport
 * so it stays put across pages without a ref into a specific DOM node. */
const DOCK = { top: 30, right: 300 };
const ROBOT_SIZE = 120;      // desktop
const ROBOT_SIZE_SM = 68;    // tablet / small desktop
const ROBOT_SIZE_XS = 52;    // mobile

/** Returns the current robot size and dock position based on viewport width.
 * Called on every render (window.innerWidth is instant, no event needed) so
 * the mascot automatically repositions when the browser is resized. */
function getResponsiveLayout() {
  if (typeof window === "undefined") return { size: ROBOT_SIZE, dockTop: DOCK.top, dockRight: DOCK.right };
  const vw = window.innerWidth;
  if (vw < 480) {
    // Mobile: tiny, bottom-right corner (clear of browser chrome at the top)
    return { size: ROBOT_SIZE_XS, dockTop: window.innerHeight - ROBOT_SIZE_XS - 72, dockRight: 12 };
  }
  if (vw < 1024) {
    // Tablet: medium, top-right but with a smaller right offset since there's no desktop sidebar
    return { size: ROBOT_SIZE_SM, dockTop: DOCK.top, dockRight: 16 };
  }
  // Desktop: full size, near the account info block
  return { size: ROBOT_SIZE, dockTop: DOCK.top, dockRight: DOCK.right };
}
const GREETING_MS = 650; // wave-hello duration before settling in to explain
const SLEEP_ANNOUNCE_MS = 1900; // how long the "going to sleep" bubble stays up
const WAKE_ANNOUNCE_MS = 1600; // how long the "I'm awake!" bubble stays up
const ROBOT_NAME = "Nova";
// Intro zoom — the face starts at ~50 % of viewport height and CSS-transitions
// down to the docked size, giving a cinematic "zooms out from you to its corner"
// read. We compute the start size dynamically from window height at mount time.
const INTRO_HOLD_MS = 3200; // how long Nova holds the big-face before zooming out
let TYPE_MS_PER_CHAR = 22; // default; overridden by /ads/assistant-settings on mount
const IDLE_FIDGET_MIN_MS = 7000;
const IDLE_FIDGET_MAX_MS = 13000;

type Phase = "idle" | "greeting" | "explaining" | "sleep-announce" | "wake-announce" | "asleep";
type Fidget = null | "spin" | "flap";

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

export function RobotMascot() {
  const [awake, setAwake] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    const stored = localStorage.getItem("robotAwake");
    return stored === null ? true : stored === "true";
  });
  const [phase, setPhase] = useState<Phase>(awake ? "idle" : "asleep");
  const introMsgRef = useRef<string | null>(null); // set while the intro is mid-play, so the fetch can trigger audio if it resolves late
  const [pos, setPos] = useState<{ top: number; left: number } | null>(() => {
    // Restore position from sessionStorage on refresh.
    // novaSessionActive being set means we've already had a session this tab.
    if (typeof window === "undefined") return null;
    if (!sessionStorage.getItem("novaSessionActive")) return null;
    const stored = sessionStorage.getItem("novaPos");
    if (!stored) return null;
    try { return JSON.parse(stored); } catch { return null; }
  }); // null = docked
  const [introSize, setIntroSize] = useState(0); // 0 = use baseSize; >0 = big intro face
  const [dialog, setDialog] = useState<{ text: string; typed: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [fidget, setFidget] = useState<Fidget>(null);
  const [hints, setHints] = useState<Record<string, string>>({});
  const [audioMap, setAudioMap] = useState<Record<string, string>>({});
  const [introAudioUrl, setIntroAudioUrl] = useState<string | null>(null);
  const introAudioUrlRef = useRef<string | null>(null); // ref so intro timer closure always reads latest URL
  const [muted, setMuted] = useState<boolean>(() => localStorage.getItem("novaMuted") === "true");

  useEffect(() => {
    localStorage.setItem("novaMuted", String(muted));
    if (muted) {
      window.speechSynthesis?.cancel();
      if (audioElRef.current) { audioElRef.current.pause(); audioElRef.current.currentTime = 0; }
    }
  }, [muted]);

  const audioElRef = useRef<HTMLAudioElement | null>(null);

  function playOrSpeak(text: string, audioUrl?: string) {
    if (muted) return;
    if (audioUrl) {
      if (audioElRef.current) { audioElRef.current.pause(); audioElRef.current.currentTime = 0; }
      // fetchAndCacheAudio: checks IndexedDB first (instant), falls back to
      // network fetch + stores result so subsequent plays need zero network.
      // When audio is regenerated the URL changes, so the new URL just misses
      // cache and fetches once — no manual invalidation needed.
      fetchAndCacheAudio(audioUrl)
        .then((blobUrl) => {
          const a = new Audio(blobUrl);
          audioElRef.current = a;
          a.play().catch(() => speak(text));
        })
        .catch(() => speak(text)); // network/IDB failure → fall back to speech synthesis
    } else {
      speak(text);
    }
  }

  function speak(text: string) {
    if (muted || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(text);
    utt.rate = 1.0;
    utt.pitch = 1.1;
    window.speechSynthesis.speak(utt);
  }
  const posRef = useRef(pos); // mirrors `pos` for the click-delegation listener below, so it always reads the latest value without re-subscribing on every visit
  posRef.current = pos;
  const draggedRef = useRef(false); // distinguishes an actual drag from a plain click-in-place, so a click-release doesn't also get treated as "clicked elsewhere -> go home"
  const introPlayedRef = useRef(false); // guards the login intro to once per MOUNT (i.e. once per login — the mascot unmounts on logout and remounts fresh on the next login), not once per browser session
  const greetTimer = useRef<number | null>(null);
  const sleepTimer = useRef<number | null>(null);
  const wakeTimer = useRef<number | null>(null);
  const introTimer = useRef<number | null>(null);
  const fidgetTimer = useRef<number | null>(null);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api("/ads/assistant-hints"),
      api("/ads/assistant-settings"),
    ]).then(([rows, s]) => {
      if (cancelled) return;
      const map: Record<string, string> = {};
      const amap: Record<string, string> = {};
      const activeUrls = new Set<string>();
      for (const r of rows as { key: string; message: string; audio_url: string | null }[]) {
        map[r.key] = r.message;
        if (r.audio_url) { amap[r.key] = r.audio_url; activeUrls.add(r.audio_url); }
      }
      setHints(map);
      setAudioMap(amap);
      if (s.intro_audio_url) {
        setIntroAudioUrl(s.intro_audio_url);
        introAudioUrlRef.current = s.intro_audio_url;
        activeUrls.add(s.intro_audio_url);
        // If the intro is already in the explaining phase (the greetTimer fired
        // before the fetch resolved), start the audio now — the timer already ran
        // with a null URL and fell back to speech synthesis or silence.
        if (introMsgRef.current) {
          playOrSpeak(introMsgRef.current, s.intro_audio_url);
          introMsgRef.current = null; // consumed — prevent any further double-play
        }
      }
      if (s.typing_ms_per_char) TYPE_MS_PER_CHAR = s.typing_ms_per_char;
      // Prune IndexedDB entries whose URL is no longer active (audio regenerated)
      pruneAudioCache(activeUrls).catch(() => {});
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    localStorage.setItem("robotAwake", String(awake));
  }, [awake]);

  useEffect(() => {
    if (pos) sessionStorage.setItem("novaPos", JSON.stringify(pos));
    else sessionStorage.removeItem("novaPos");
  }, [pos]);

  // novaSessionActive is set when the intro plays and intentionally lives
  // beyond component unmount — because AuthGatedMascot temporarily unmounts
  // RobotMascot while me=null (auth loading on page refresh), which is not
  // a real logout. Clearing on unmount caused the intro to replay on refresh.
  // Instead we clear it explicitly from __root.tsx on a detected real logout.
  useEffect(() => {
    return () => {
      sessionStorage.removeItem("novaPos");
      // Stop any playing audio immediately on unmount (logout)
      window.speechSynthesis?.cancel();
      if (audioElRef.current) {
        audioElRef.current.pause();
        audioElRef.current.currentTime = 0;
        audioElRef.current = null;
      }
      // novaSessionActive NOT cleared here — see above.
    };
  }, []);

  // Login intro: plays once per login.
  // Guard: novaSessionActive absent in sessionStorage = fresh login → play.
  //        novaSessionActive present = page refresh → skip.
  // We set it here (not in the mount effect above) so setting it is atomic
  // with the decision to play — no race between effects.
  useEffect(() => {
    if (!awake || introPlayedRef.current) return;
    if (sessionStorage.getItem("novaSessionActive")) return; // refresh — skip
    introPlayedRef.current = true;
    sessionStorage.setItem("novaSessionActive", "1"); // mark session so refresh skips

    // Start size: face covers ~50 % of screen height.
    const bigSize = Math.round(window.innerHeight * 0.5);
    const bigLeft = Math.round(window.innerWidth / 2 - bigSize / 2);
    const bigTop = Math.round(window.innerHeight * 0.05);

    const introMsg =
      `Hi there! I'm ${ROBOT_NAME} — your in-app assistant! ` +
      `I'll guide you around, just click anything you'd like to know more about and I'll come right over and explain it. ` +
      `The blue button puts me to sleep when you need some space, and the green button wakes me back up whenever you need me. ` +
      `I'm always here for you! 🤖`;

    introMsgRef.current = introMsg; // mark intro as in-progress

    setIntroSize(bigSize);
    setPos({ top: bigTop, left: bigLeft });
    setPhase("greeting");
    setDialog({
      text: introMsg,
      typed: reducedMotion ? introMsg.length : 0,
    });

    // After the greeting wave, start typing.
    // Do NOT call playOrSpeak here — if the fetch hasn't resolved yet
    // introAudioUrlRef.current is null, which would make us play speech
    // synthesis, and then the fetch arriving later would play the stored
    // audio on top (double audio). Instead, the fetch-resolve handler
    // (below in the fetch useEffect) calls playOrSpeak as soon as the URL
    // arrives. If the fetch resolved BEFORE this timer, introAudioUrlRef
    // already has the URL and we play it now.
    greetTimer.current = window.setTimeout(() => {
      setPhase("explaining");
      if (introAudioUrlRef.current) {
        // URL already loaded — play now and clear the ref so the fetch-resolve
        // handler (below) knows not to play it again.
        playOrSpeak(introMsg, introAudioUrlRef.current);
        introMsgRef.current = null;
      }
      // If no URL yet, introMsgRef.current stays set so the fetch-resolve
      // handler can trigger audio when the URL arrives.
    }, reducedMotion ? 0 : GREETING_MS);

    const typingMs = reducedMotion ? 0 : introMsg.length * TYPE_MS_PER_CHAR;
    introTimer.current = window.setTimeout(() => {
      setIntroSize(0);
      setDialog(null);
      setPos(null);
      setPhase("idle");
      introMsgRef.current = null;
    }, GREETING_MS + typingMs + INTRO_HOLD_MS);
  }, [awake, reducedMotion]);

  function clearTimers() {
    [greetTimer, sleepTimer, wakeTimer, introTimer].forEach((r) => {
      if (r.current) { window.clearTimeout(r.current); r.current = null; }
    });
  }

  function visit(el: HTMLElement) {
    const key = el.dataset.robotHintKey;
    const text = key ? hints[key] : undefined;
    if (!text) return;
    clearTimers();
    setFidget(null);
    setIntroSize(0); // collapse from big-intro size immediately if user clicks mid-intro
    introMsgRef.current = null;
    const rect = el.getBoundingClientRect();
    const left = Math.min(rect.right + 16, window.innerWidth - baseSize - 8);
    const top = Math.max(8, rect.top + rect.height / 2 - baseSize / 2);
    setPos({ top, left });
    setDialog({ text, typed: reducedMotion ? text.length : 0 });
    setPhase("greeting");
    greetTimer.current = window.setTimeout(() => {
      setPhase("explaining");
      if (key && hints[key]) playOrSpeak(hints[key], audioMap[key]);
    }, reducedMotion ? 0 : GREETING_MS);
  }

  function goHome() {
    clearTimers();
    setIntroSize(0); // collapse from big-intro size if user clicks away mid-intro
    introMsgRef.current = null;
    setDialog(null);
    setPos(null);
    setPhase("idle");
  }

  // Click-driven, not hover-driven: clicking a hinted nav item sends the
  // robot there and it stays — explaining, typing the dialog out — no
  // matter where the mouse wanders afterward. It only leaves when the
  // user clicks a DIFFERENT hinted item (redirects there) or clicks
  // anywhere else on the page (goes home).
  //
  // Registered on the CAPTURE phase (the `true` third argument), not the
  // default bubble phase — some router Link components call
  // stopPropagation() in their own click handler as part of intercepting
  // navigation, which would silently swallow a bubble-phase listener on
  // document before it ever saw the click. Capture fires on the way DOWN
  // to the target, before any of that, so this always sees the click.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      const target = e.target as HTMLElement;
      const hintEl = target.closest<HTMLElement>("[data-robot-hint-key]");
      if (hintEl) {
        if (!awake) return; // asleep — ignore all hint clicks until the green button wakes her
        visit(hintEl);
        return;
      }
      if (target.closest("[data-robot-ui]")) return; // clicking the dialog/robot/antennas themselves doesn't dismiss anything
      if (draggedRef.current) return; // that click was the tail end of a drag, not a real "click elsewhere"
      if (awake && posRef.current) goHome();
    }
    document.addEventListener("click", onDocClick, true);
    return () => document.removeEventListener("click", onDocClick, true);
  }, [awake, reducedMotion, hints]);

  useEffect(() => {
    if (!awake) {
      clearTimers();
      setDialog(null);
      setPos(null);
      setFidget(null);
      setPhase("asleep");
    } else {
      setPhase((p) => (p === "asleep" ? "idle" : p));
    }
  }, [awake]);

  // Typewriter reveal while "explaining".
  useEffect(() => {
    if (phase !== "explaining" || !dialog || reducedMotion) return;
    if (dialog.typed >= dialog.text.length) return;
    const t = window.setTimeout(() => {
      setDialog((d) => (d ? { ...d, typed: d.typed + 1 } : d));
    }, TYPE_MS_PER_CHAR);
    return () => window.clearTimeout(t);
  }, [phase, dialog, reducedMotion]);

  // Idle fidgets — if it's just been sitting docked and idle for a
  // while with nothing to do, it spins or flaps a hand/leg to feel alive
  // rather than static. Only while awake, docked (not mid-visit), not
  // dragging, and not reduced-motion.
  useEffect(() => {
    if (reducedMotion || !awake || phase !== "idle" || pos || dragging) {
      if (fidgetTimer.current) { window.clearTimeout(fidgetTimer.current); fidgetTimer.current = null; }
      return;
    }
    const delay = IDLE_FIDGET_MIN_MS + Math.random() * (IDLE_FIDGET_MAX_MS - IDLE_FIDGET_MIN_MS);
    fidgetTimer.current = window.setTimeout(() => {
      setFidget(Math.random() < 0.5 ? "spin" : "flap");
      window.setTimeout(() => setFidget(null), 1300);
    }, delay);
    return () => {
      if (fidgetTimer.current) { window.clearTimeout(fidgetTimer.current); fidgetTimer.current = null; }
    };
  }, [reducedMotion, awake, phase, pos, dragging, fidget]);

  function goToSleep() {
    clearTimers();
    setFidget(null);
    setIntroSize(0);
    introMsgRef.current = null;
    const announceAt = pos ?? { top: dockTop, left: dockLeft() };
    const msg = hints["system:sleep"] || "Going to sleep now — wake me up by pressing the green button!";
    setDialog({ text: msg, typed: msg.length });
    setPhase("sleep-announce");
    playOrSpeak(msg, audioMap["system:sleep"]);
    sleepTimer.current = window.setTimeout(() => {
      setAwake(false);
      setDialog(null);
      setPos(null);
      setPhase("asleep");
    }, SLEEP_ANNOUNCE_MS);
  }

  function wakeUp() {
    clearTimers();
    setIntroSize(0);
    introMsgRef.current = null;
    setPos(null);
    setAwake(true);
    const msg = hints["system:wake"] || "I'm awake and ready to help!";
    setDialog({ text: msg, typed: msg.length });
    setPhase("wake-announce");
    playOrSpeak(msg, audioMap["system:wake"]);
    wakeTimer.current = window.setTimeout(() => {
      setDialog(null);
      setPhase("idle");
    }, WAKE_ANNOUNCE_MS);
  }

  // Click-and-drag: pick the robot up and put it wherever. A plain click
  // (no meaningful movement) still opens/keeps whatever it's currently
  // doing; only a real drag repositions it, and a real drag also doesn't
  // count as "clicked elsewhere" for the go-home logic.
  function onRobotMouseDown(e: React.MouseEvent) {
    if (phase === "sleep-announce") return;
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const startTop = pos ? pos.top : dockTop;
    const startLeft = pos ? pos.left : dockLeft(currentSize);
    draggedRef.current = false;
    setFidget(null);
    setDragging(true);

    function onMove(ev: MouseEvent) {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) draggedRef.current = true;
      if (!draggedRef.current) return;
      const size = currentSize;
      const left = Math.min(Math.max(4, startLeft + dx), window.innerWidth - size - 4);
      const top = Math.min(Math.max(4, startTop + dy), window.innerHeight - size - 4);
      setPos({ top, left });
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      setDragging(false);
      // Reset the drag flag on the next tick — the mouseup's matching
      // "click" event fires right after this, and the document click
      // handler needs to still see draggedRef.current as true to skip
      // its own go-home logic for that one click.
      window.setTimeout(() => { draggedRef.current = false; }, 0);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  const { size: baseSize, dockTop, dockRight } = getResponsiveLayout();
  function dockLeft(size: number = baseSize) {
    return window.innerWidth - dockRight - size;
  }

  const currentSize = introSize > 0 ? introSize : baseSize; // during intro: bigSize; otherwise responsive size

  const effectiveStyle: React.CSSProperties = pos
    ? { top: pos.top, left: pos.left }
    : { top: dockTop, left: dockLeft(currentSize) };

  const antennaStyle: React.CSSProperties = pos
    ? { top: pos.top + currentSize * 0.65, left: pos.left + currentSize / 2 - 7 }
    : { top: dockTop + currentSize * 0.65, left: dockLeft(currentSize) + currentSize / 2 - 7 };

  const stillTyping = !!dialog && dialog.typed < dialog.text.length;
  const svgMode: "asleep" | "greeting" | "talking" | "idle" | "spin" | "flap" | "sad" | "excited" =
    phase === "asleep" ? "asleep"
    : phase === "sleep-announce" ? "sad"
    : phase === "wake-announce" ? "excited"
    : phase === "greeting" ? "greeting"
    : phase === "explaining" && stillTyping ? "talking"
    : fidget === "spin" ? "spin"
    : fidget === "flap" ? "flap"
    : "idle";
  const instant = reducedMotion || dragging;

  return (
    <>
      <style>{`
        @keyframes robot-bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
        @keyframes robot-blink { 0%, 92%, 100% { transform: scaleY(1); } 96% { transform: scaleY(0.1); } }
        @keyframes robot-wave { 0%, 100% { transform: rotate(0deg); } 50% { transform: rotate(-28deg); } }
        @keyframes robot-talk { 0%, 100% { transform: scaleY(1); } 50% { transform: scaleY(0.35); } }
        @keyframes robot-zzz { 0% { opacity: 0; transform: translateY(0) translateX(0) scale(0.7); } 30% { opacity: 1; } 100% { opacity: 0; transform: translateY(-24px) translateX(10px) scale(1.2); } }
        @keyframes robot-charge-pulse { 0%, 100% { opacity: 0.35; } 50% { opacity: 1; } }
        @keyframes robot-spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        @keyframes robot-flap-arm { 0%, 100% { transform: rotate(0deg); } 25% { transform: rotate(-35deg); } 75% { transform: rotate(35deg); } }
        @keyframes robot-flap-leg { 0%, 100% { transform: rotate(0deg); } 25% { transform: rotate(18deg); } 75% { transform: rotate(-18deg); } }
      `}</style>

      <div
        data-robot-ui
        onMouseDown={onRobotMouseDown}
        className={`fixed z-[200] transition-[top,left,width,height] ${instant ? "duration-0" : "duration-700"} ease-in-out`}
        style={{ ...effectiveStyle, width: currentSize, height: currentSize, cursor: dragging ? "grabbing" : "grab" }}
      >
        <RobotSvg mode={svgMode} reducedMotion={reducedMotion} />
      </div>

      <div
        data-robot-ui
        className={`fixed z-[201] flex flex-col items-center gap-1.5 transition-[top,left] ${instant ? "duration-0" : "duration-700"} ease-in-out`}
        style={antennaStyle}
      >
        {/* Sleep/wake toggle — blue = awake (click to sleep), green = asleep (click to wake) */}
        <button
          type="button"
          title={awake ? "Sleep" : "Wake up"}
          aria-label={awake ? "Put the assistant to sleep" : "Wake the assistant up"}
          onClick={awake ? goToSleep : wakeUp}
          disabled={phase === "sleep-announce"}
          className={`h-3.5 w-3.5 rounded-full transition-transform hover:scale-125 disabled:opacity-40 disabled:hover:scale-100 ${
            awake ? "bg-blue-400 shadow-[0_0_6px_2px_rgba(96,165,250,0.55)]" : "bg-green-400 shadow-[0_0_6px_2px_rgba(74,222,128,0.55)]"
          }`}
        />
      </div>

      {/* Mute button — independently positioned ABOVE the robot.
          Adjust the top/left offsets on line 519 (top) and line 520 (left)
          to fine-tune placement. Currently: 36px above the robot top, centered. */}
      <div
        data-robot-ui
        className={`fixed z-[201] transition-[top,left] ${instant ? "duration-0" : "duration-700"} ease-in-out`}
        style={{
          top:  (pos ? pos.top : dockTop) - 36,
          left: (pos ? pos.left : dockLeft(currentSize)) + currentSize / 2 - 12,
        }}
      >
        <button
          type="button"
          title={muted ? "Unmute Nova" : "Mute Nova"}
          aria-label={muted ? "Unmute assistant" : "Mute assistant"}
          onClick={() => setMuted((m) => !m)}
          className={`h-6 w-6 rounded-full flex items-center justify-center transition-all hover:scale-110 shadow-md ${
            muted
              ? "bg-slate-600/80 text-slate-300"
              : "bg-slate-700/80 text-cyan-300"
          }`}
        >
          {muted ? (
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
              <path d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM14.657 2.929a1 1 0 011.414 0A9.972 9.972 0 0119 10a9.972 9.972 0 01-2.929 7.071 1 1 0 01-1.414-1.414A7.971 7.971 0 0017 10c0-2.21-.894-4.208-2.343-5.657a1 1 0 010-1.414zm-2.829 2.828a1 1 0 011.415 0A5.983 5.983 0 0115 10a5.984 5.984 0 01-1.757 4.243 1 1 0 01-1.415-1.415A3.984 3.984 0 0013 10a3.983 3.983 0 00-1.172-2.828 1 1 0 010-1.415z" />
              <line x1="3" y1="3" x2="17" y2="17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          ) : (
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
              <path d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM14.657 2.929a1 1 0 011.414 0A9.972 9.972 0 0119 10a9.972 9.972 0 01-2.929 7.071 1 1 0 01-1.414-1.414A7.971 7.971 0 0017 10c0-2.21-.894-4.208-2.343-5.657a1 1 0 010-1.414zm-2.829 2.828a1 1 0 011.415 0A5.983 5.983 0 0115 10a5.984 5.984 0 01-1.757 4.243 1 1 0 01-1.415-1.415A3.984 3.984 0 0013 10a3.983 3.983 0 00-1.172-2.828 1 1 0 010-1.415z" />
            </svg>
          )}
        </button>
      </div>

      {dialog && (() => {
        // Compute dialog position live from the robot's CURRENT position
        // (pos state updates on every drag mousemove), so the bubble tracks
        // the robot while being dragged instead of staying at its original spot.
        const robotTop  = pos ? pos.top  : dockTop;
        const robotLeft = pos ? pos.left : dockLeft(currentSize);
        const dialogTop  = introSize > 0
          ? robotTop + currentSize + 16                                        // intro: below the big face
          : robotTop + 6;                                                      // normal: beside the robot
        const dialogLeft = introSize > 0
          ? Math.max(16, Math.min(robotLeft + currentSize / 2 - 140, window.innerWidth - 290))
          : Math.min(robotLeft + currentSize + 10, window.innerWidth - 260);
        return (
          <div
            data-robot-ui
            className={`fixed z-[200] rounded-xl border px-3 py-2 text-xs leading-relaxed shadow-lg backdrop-blur ${introSize > 0 ? "max-w-[320px]" : "max-w-[240px]"} ${
              phase === "sleep-announce" ? "border-blue-400/50 bg-card/95 text-foreground" : "border-primary/40 bg-card/95 text-foreground"
            }`}
            style={{ top: dialogTop, left: dialogLeft }}
          >
            {dialog.text.slice(0, dialog.typed)}
            {dialog.typed < dialog.text.length && <span className="animate-pulse">▍</span>}
          </div>
        );
      })()}
    </>
  );
}

function RobotSvg({ mode, reducedMotion }: { mode: "asleep" | "greeting" | "talking" | "idle" | "spin" | "flap" | "sad" | "excited"; reducedMotion: boolean }) {
  const asleep = mode === "asleep";
  const sad = mode === "sad";
  const excited = mode === "excited";
  const bob = !reducedMotion && !asleep && mode !== "spin" ? { animation: "robot-bob 2.4s ease-in-out infinite" } : {};
  const spin = !reducedMotion && mode === "spin" ? { animation: "robot-spin 1.1s ease-in-out", transformOrigin: "50px 55px" } : {};
  const blink = !reducedMotion && !asleep && !sad && !excited ? { animation: "robot-blink 4s ease-in-out infinite", transformOrigin: "center" } : {};
  const wave = !reducedMotion && mode === "greeting" ? { animation: "robot-wave 0.6s ease-in-out infinite", transformOrigin: "76px 74px" } : {};
  const mouth = !reducedMotion && mode === "talking" ? { animation: "robot-talk 0.35s ease-in-out infinite", transformOrigin: "50px 52px" } : {};
  const flapArmL = !reducedMotion && mode === "flap" ? { animation: "robot-flap-arm 0.5s ease-in-out 2", transformOrigin: "26px 70px" } : {};
  const flapArmR = !reducedMotion && mode === "flap" ? { animation: "robot-flap-arm 0.5s ease-in-out 2", transformOrigin: "76px 66px" } : {};
  const flapLegL = !reducedMotion && mode === "flap" ? { animation: "robot-flap-leg 0.5s ease-in-out 2", transformOrigin: "38px 86px" } : {};
  const flapLegR = !reducedMotion && mode === "flap" ? { animation: "robot-flap-leg 0.5s ease-in-out 2", transformOrigin: "62px 86px" } : {};

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      <svg viewBox="0 0 100 100" style={{ width: "100%", height: "100%", ...bob, ...spin }}>
        <defs>
          {/* Rounded white plastic: light from upper-left, falling to a
              cool grey shadow at lower-right — the core 3D read. */}
          <radialGradient id="rb-plastic" cx="0.35" cy="0.28" r="1.05">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="55%" stopColor="#f2f2f5" />
            <stop offset="85%" stopColor="#dcdce3" />
            <stop offset="100%" stopColor="#c6c6d0" />
          </radialGradient>
          {/* Slightly darker variant for limbs so they sit "behind" the body */}
          <radialGradient id="rb-limb" cx="0.35" cy="0.3" r="1.0">
            <stop offset="0%" stopColor="#f6f6f8" />
            <stop offset="70%" stopColor="#dfdfe6" />
            <stop offset="100%" stopColor="#c2c2cc" />
          </radialGradient>
          {/* Screen face: glassy dark with a subtle top sheen */}
          <linearGradient id="rb-screen" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2a2d36" />
            <stop offset="30%" stopColor="#16181d" />
            <stop offset="100%" stopColor="#0b0c10" />
          </linearGradient>
          <linearGradient id="rb-screen-sheen" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </linearGradient>
          {/* Charging pad metal */}
          <linearGradient id="rb-pad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#d8d8e0" />
            <stop offset="100%" stopColor="#a8a8b4" />
          </linearGradient>
          {/* Soft drop shadow for the whole figure */}
          <filter id="rb-drop" x="-30%" y="-30%" width="160%" height="170%">
            <feDropShadow dx="0" dy="2.2" stdDeviation="2.4" floodColor="#000000" floodOpacity="0.28" />
          </filter>
          {/* Inner shadow: darkens just inside the bottom-right edge of a
              shape, selling the "rounded volume" look. */}
          <filter id="rb-inner" x="-20%" y="-20%" width="140%" height="140%">
            <feOffset dx="-1.4" dy="-1.8" in="SourceAlpha" result="off" />
            <feGaussianBlur stdDeviation="1.6" in="off" result="blur" />
            <feComposite operator="out" in="SourceAlpha" in2="blur" result="inv" />
            <feFlood floodColor="#8a8a98" floodOpacity="0.55" result="col" />
            <feComposite operator="in" in="col" in2="inv" result="shadow" />
            <feComposite operator="over" in="shadow" in2="SourceGraphic" />
          </filter>
          {/* Glow for the antenna tips and eyes */}
          <filter id="rb-glow" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="1.4" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {asleep && (
          <g>
            <ellipse cx="50" cy="94" rx="27" ry="4.5" fill="#000000" opacity="0.16" />
            <ellipse cx="50" cy="91.5" rx="24" ry="4.5" fill="url(#rb-pad)" />
            <rect x="28" y="86.5" width="44" height="6" rx="3" fill="url(#rb-pad)" filter="url(#rb-inner)" />
            <circle cx="50" cy="89.5" r="2" fill="#4ade80" filter="url(#rb-glow)" style={{ animation: reducedMotion ? undefined : "robot-charge-pulse 1.6s ease-in-out infinite" }} />
          </g>
        )}

        {/* Figure group gets one shared drop shadow so parts don't each
            cast their own conflicting shadows. */}
        <g filter="url(#rb-drop)">
          {/* antennas */}
          <line x1="36" y1="18" x2="29" y2="4" stroke="#9a9aa6" strokeWidth="3" strokeLinecap="round" />
          <line x1="36.6" y1="17.2" x2="30" y2="4.6" stroke="#c9c9d2" strokeWidth="1" strokeLinecap="round" opacity="0.8" />
          <circle cx="29" cy="4" r="3.4" fill={asleep ? "#4b5563" : "#4ade80"} filter={asleep ? undefined : "url(#rb-glow)"} />
          <circle cx="28" cy="3" r="1.1" fill="#ffffff" opacity={asleep ? 0.25 : 0.75} />
          <line x1="62" y1="18" x2="69" y2="4" stroke="#9a9aa6" strokeWidth="3" strokeLinecap="round" />
          <line x1="62.6" y1="17.2" x2="68.4" y2="5" stroke="#c9c9d2" strokeWidth="1" strokeLinecap="round" opacity="0.8" />
          <circle cx="69" cy="4" r="3.4" fill={asleep ? "#4b5563" : "#60a5fa"} filter={asleep ? undefined : "url(#rb-glow)"} />
          <circle cx="68" cy="3" r="1.1" fill="#ffffff" opacity={asleep ? 0.25 : 0.75} />

          {/* head with plastic gradient + inner shadow + specular streak */}
          <rect x="22" y="18" width="54" height="42" rx="18" fill="url(#rb-plastic)" filter="url(#rb-inner)" />
          <path d="M30 22 Q40 19 54 20.5 Q44 24 33 26 Q30.5 24.5 30 22 Z" fill="#ffffff" opacity="0.55" />
          {/* ear caps */}
          <ellipse cx="21" cy="39" rx="3" ry="6" fill="url(#rb-limb)" filter="url(#rb-inner)" />
          <ellipse cx="79" cy="39" rx="3" ry="6" fill="url(#rb-limb)" filter="url(#rb-inner)" />

          {/* screen face with bezel + glass sheen */}
          <rect x="30" y="26" width="38" height="27" rx="12" fill="#d8d8e0" opacity="0.9" />
          <rect x="31" y="27" width="36" height="25" rx="11" fill="url(#rb-screen)" />
          <path d="M33 29 h32 a9 9 0 0 1 0 0 q-2 6 -16 6 q-14 0 -16 -6 Z" fill="url(#rb-screen-sheen)" />

          {asleep ? (
            <>
              <line x1="39" y1="39" x2="47" y2="39" stroke="#7dd3fc" strokeWidth="2" strokeLinecap="round" filter="url(#rb-glow)" />
              <line x1="53" y1="39" x2="61" y2="39" stroke="#7dd3fc" strokeWidth="2" strokeLinecap="round" filter="url(#rb-glow)" />
            </>
          ) : sad ? (
            <>
              {/* Sad brows: HIGH at the inner (center) end, sloping DOWN
                  outward toward the ears.
                  Left:  inner=(41,32) → outer=(36,36.5) — drops going LEFT
                  Right: inner=(59,32) → outer=(64,36.5) — drops going RIGHT
                  Mental image: like two sad rain-drop tails falling away from
                  the nose toward the ears. Opposite of angry (which is high
                  at OUTER edges, meeting in a V at the center). */}
              <line x1="41" y1="32" x2="36" y2="36.5" stroke="#7dd3fc" strokeWidth="1.8" strokeLinecap="round" filter="url(#rb-glow)" />
              <line x1="59" y1="32" x2="64" y2="36.5" stroke="#7dd3fc" strokeWidth="1.8" strokeLinecap="round" filter="url(#rb-glow)" />
              {/* slightly squinting eyes (worry) */}
              <ellipse cx="42" cy="40.5" rx="3.4" ry="3.8" fill="#7dd3fc" filter="url(#rb-glow)" />
              <ellipse cx="41" cy="39.2" rx="1.1" ry="1.3" fill="#ffffff" opacity="0.7" />
              <ellipse cx="57" cy="40.5" rx="3.4" ry="3.8" fill="#7dd3fc" filter="url(#rb-glow)" />
              <ellipse cx="56" cy="39.2" rx="1.1" ry="1.3" fill="#ffffff" opacity="0.7" />
              {/* frown: arc curving UP from each corner toward a low center */}
              <path d="M43 49.5 Q50 45 57 49.5" stroke="#7dd3fc" strokeWidth="1.8" fill="none" strokeLinecap="round" filter="url(#rb-glow)" />
            </>
          ) : excited ? (
            <>
              {/* raised happy brows arching upward */}
              <path d="M38 31 Q42 29.5 46 30.5" stroke="#7dd3fc" strokeWidth="1.6" fill="none" strokeLinecap="round" filter="url(#rb-glow)" />
              <path d="M54 30.5 Q58 29.5 62 31" stroke="#7dd3fc" strokeWidth="1.6" fill="none" strokeLinecap="round" filter="url(#rb-glow)" />
              <ellipse cx="42" cy="38.5" rx="4.4" ry="6" fill="#7dd3fc" filter="url(#rb-glow)" />
              <ellipse cx="41" cy="36.2" rx="1.5" ry="2" fill="#ffffff" opacity="0.85" />
              <ellipse cx="57" cy="38.5" rx="4.4" ry="6" fill="#7dd3fc" filter="url(#rb-glow)" />
              <ellipse cx="56" cy="36.2" rx="1.5" ry="2" fill="#ffffff" opacity="0.85" />
              {/* big open happy mouth: filled arc shape with dark inner */}
              <path d="M40 45 Q50 53 60 45" fill="#7dd3fc" stroke="#7dd3fc" strokeWidth="0.5" filter="url(#rb-glow)" />
              <ellipse cx="50" cy="48" rx="6" ry="3.2" fill="#16181d" opacity="0.55" />
            </>
          ) : (
            <>
              <g style={blink}>
                <ellipse cx="42" cy="38.5"
                  rx={mode === "greeting" || mode === "flap" ? 4.2 : 3.8}
                  ry={mode === "greeting" || mode === "flap" ? 5.6 : 5.2}
                  fill="#7dd3fc" filter="url(#rb-glow)" />
                <ellipse cx="41" cy="36.8" rx="1.3" ry="1.7" fill="#ffffff" opacity="0.85" />
              </g>
              <g style={blink}>
                <ellipse cx="57" cy="38.5"
                  rx={mode === "greeting" || mode === "flap" ? 4.2 : 3.8}
                  ry={mode === "greeting" || mode === "flap" ? 5.6 : 5.2}
                  fill="#7dd3fc" filter="url(#rb-glow)" />
                <ellipse cx="56" cy="36.8" rx="1.3" ry="1.7" fill="#ffffff" opacity="0.85" />
              </g>
              {/* Talking: open-mouth ellipse (animates open/close).
                  All other states: a proper curved smile path. */}
              {mode === "talking" ? (
                <ellipse cx="50" cy="46.5" rx="7" ry="4" fill="#7dd3fc" style={mouth} filter="url(#rb-glow)" />
              ) : (
                <path
                  d={mode === "spin" || mode === "flap"
                    ? "M41 45 Q50 52 59 45"   // wider grin for playful states
                    : "M43 46 Q50 51 57 46"}   // standard friendly smile
                  stroke="#7dd3fc" strokeWidth="2.2" fill="none" strokeLinecap="round"
                  filter="url(#rb-glow)"
                />
              )}
            </>
          )}

          {asleep ? (
            <>
              {/* sitting pose */}
              <ellipse cx="50" cy="78" rx="19" ry="14" fill="url(#rb-plastic)" filter="url(#rb-inner)" />
              <path d="M38 68 Q46 64.5 58 66 Q48 70 41 71.5 Q38.8 70 38 68 Z" fill="#ffffff" opacity="0.5" />
              <ellipse cx="38" cy="86" rx="7" ry="5" fill="url(#rb-limb)" filter="url(#rb-inner)" />
              <ellipse cx="62" cy="86" rx="7" ry="5" fill="url(#rb-limb)" filter="url(#rb-inner)" />
              <circle cx="27" cy="72" r="5.5" fill="url(#rb-limb)" filter="url(#rb-inner)" />
              <circle cx="73" cy="72" r="5.5" fill="url(#rb-limb)" filter="url(#rb-inner)" />
            </>
          ) : (
            <>
              {/* standing body */}
              <rect x="28" y="60" width="44" height="30" rx="15" fill="url(#rb-plastic)" filter="url(#rb-inner)" />
              <path d="M35 63.5 Q44 61 56 62.5 Q46 66 38 67 Q35.8 65.5 35 63.5 Z" fill="#ffffff" opacity="0.5" />
              {/* belly panel line for mechanical detail */}
              <rect x="40" y="68" width="20" height="14" rx="7" fill="none" stroke="#c3c3cd" strokeWidth="0.8" opacity="0.7" />
              <g style={flapLegL}>
                <rect x="34" y="86" width="9" height="11" rx="3.5" fill="url(#rb-limb)" filter="url(#rb-inner)" />
              </g>
              <g style={flapLegR}>
                <rect x="57" y="86" width="9" height="11" rx="3.5" fill="url(#rb-limb)" filter="url(#rb-inner)" />
              </g>
              <g style={flapArmL}>
                <circle cx="26" cy="70" r="5.5" fill="url(#rb-limb)" filter="url(#rb-inner)" />
                <circle cx="24.5" cy="68.5" r="1.6" fill="#ffffff" opacity="0.6" />
              </g>
              <g style={{ ...wave, ...flapArmR }}>
                <circle cx="76" cy="66" r="5.5" fill="url(#rb-limb)" filter="url(#rb-inner)" />
                <circle cx="74.5" cy="64.5" r="1.6" fill="#ffffff" opacity="0.6" />
              </g>
            </>
          )}
        </g>

        {/* Zzz drawn OUTSIDE the drop-shadow group so the glow reads clean */}
        {asleep && (
          <>
            <text x="68" y="16" fontSize="20" fontWeight="700" fill="#7dd3fc" filter="url(#rb-glow)" style={{ animation: reducedMotion ? undefined : "robot-zzz 2.4s ease-in-out infinite" }}>z</text>
            <text x="78" y="8" fontSize="13" fontWeight="700" fill="#7dd3fc" filter="url(#rb-glow)" style={{ animation: reducedMotion ? undefined : "robot-zzz 2.4s ease-in-out 0.5s infinite" }}>z</text>
          </>
        )}
      </svg>
    </div>
  );
}
