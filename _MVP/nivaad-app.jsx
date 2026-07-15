import React, { useState, useEffect } from "react";

/* ============ NivaAd — AI Social Ad Studio · Powered by Nivatier ============ */

const PLATFORMS = [
  { id: "instagram", name: "Instagram", color: "#E1306C", tag: "IG", ratio: "Square 1:1", best: "Wed–Fri 6–9 PM" },
  { id: "facebook", name: "Facebook", color: "#1877F2", tag: "FB", ratio: "Landscape 1.91:1", best: "Tue–Thu 1–4 PM" },
  { id: "linkedin", name: "LinkedIn", color: "#0A66C2", tag: "IN", ratio: "Landscape 1.91:1", best: "Tue–Thu 9–11 AM" },
  { id: "x", name: "X (Twitter)", color: "#e7e9ea", tag: "𝕏", ratio: "Landscape 16:9", best: "Mon–Fri 9 AM–12 PM" },
  { id: "tiktok", name: "TikTok", color: "#25F4EE", tag: "TT", ratio: "Vertical 9:16", best: "Thu–Sat 7–10 PM" },
];

const BLOCKLIST = ["weapon", "gun", "firearm", "drug", "cocaine", "hate", "nude", "nsfw", "tobacco", "vape", "casino", "escort"];
const RISKY_CLAIMS = ["guaranteed", "miracle", "cure", "risk-free", "100% results", "no side effects", "get rich"];

const TIER_DATA = [
  { name: "Free", monthly: 0, quota: "3 ads / month · watermark", credits: 3, feats: ["Text + image ads", "1 platform", "NivaAd watermark", "Community support"] },
  { name: "Starter", monthly: 29, quota: "10 ads / month", credits: 10, feats: ["Text + image ads", "2 connected platforms", "No watermark", "Basic analytics"] },
  { name: "Growth", monthly: 79, quota: "1 ad / day (30 / mo)", credits: 30, hot: true, feats: ["Image + video + carousels", "5 platforms · variations", "Brand kit + scheduling", "Creative score + compliance"] },
  { name: "Pro", monthly: 199, quota: "120 ads / month", credits: 120, feats: ["Everything in Growth", "Campaign launch sets", "Team seats + approvals", "Priority support"] },
];

const TERMS = [
  { m: 1, label: "1 month", disc: 0 },
  { m: 3, label: "3 months", disc: 0.1 },
  { m: 6, label: "6 months", disc: 0.18 },
  { m: 12, label: "12 months", disc: 0.3 },
];

const FALLBACK_COPY = {
  instagram: { caption: "Say hello to what's next. ✨ Crafted for people who expect more — now available. Tap the link in bio to be first.", hashtags: ["#NewLaunch", "#MustHave"], score: 82, tip: "Add a question to boost comments." },
  facebook: { caption: "It's here. Our newest product just launched — built on everything you told us you wanted. Limited launch pricing this week only.", hashtags: ["#NewProduct"], score: 78, tip: "Lead with the offer for stronger CTR." },
  linkedin: { caption: "Today we're announcing our latest product — the result of months of listening to our customers. Here's why it matters for your team.", hashtags: ["#ProductLaunch"], score: 80, tip: "Mention a concrete metric or outcome." },
  x: { caption: "New drop. Zero compromises. Available now — first 100 orders get launch pricing. 🚀", hashtags: ["#launch"], score: 84, tip: "Great length. Consider a thread for detail." },
  tiktok: { caption: "POV: the product you didn't know you needed just dropped 👀 #fyp", hashtags: ["#fyp", "#newdrop"], score: 79, tip: "Hook works — pair with fast cuts in video." },
};

const SAMPLES = [
  { emoji: "⌚", name: "Pulse One Smartwatch", cap: "Your health, one glance away. 7-day battery. ⚡ Launch offer live now.", bg: "linear-gradient(135deg,#312e81,#7c3aed)", chip: "Instagram" },
  { emoji: "👟", name: "Volt Runners", cap: "Engineered for the streets. Featherlight. Launch week −20% 🏃", bg: "linear-gradient(135deg,#0c4a6e,#06b6d4)", chip: "TikTok" },
  { emoji: "☕", name: "Ember Cold Brew", cap: "Slow-steeped for 18 hours. Zero bitterness. Free shipping this week.", bg: "linear-gradient(135deg,#7c2d12,#f59e0b)", chip: "Facebook" },
  { emoji: "🧴", name: "Lumière Serum", cap: "Clinically proven glow in 14 days. Dermatologist approved.", bg: "linear-gradient(135deg,#134e4a,#34d399)", chip: "LinkedIn" },
];

const gradText = { backgroundImage: "linear-gradient(100deg,#a78bfa,#22d3ee)", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" };
const aurora = { backgroundImage: "linear-gradient(120deg,#7c3aed,#2563eb 55%,#06b6d4)" };

function Logo() {
  return (
    <div className="font-bold tracking-tight text-xl flex items-center gap-2">
      <span className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-sm" style={aurora}>◭</span>
      <span>
        <span className="text-white block leading-none">NivaAd</span>
        <span className="text-[9px] font-normal tracking-wide text-slate-500 block leading-none mt-0.5">Powered by Nivatier</span>
      </span>
    </div>
  );
}
function Pill({ children }) {
  return <span className="text-xs uppercase tracking-widest text-cyan-300/90 border border-cyan-400/20 bg-cyan-400/5 rounded-full px-3 py-1">{children}</span>;
}
function Collapse({ title, hint, open, onToggle, children, filled }) {
  return (
    <div className="mt-4 bg-slate-950/60 border border-slate-800 rounded-xl">
      <button onClick={onToggle} className="w-full flex items-center justify-between p-4 text-left">
        <div>
          <span className="text-xs font-semibold text-white">{title}</span>
          {filled && <span className="ml-2 text-[10px] text-emerald-400">● set</span>}
          <div className="text-[11px] text-slate-500 mt-0.5">{hint}</div>
        </div>
        <span className="text-slate-500 text-sm">{open ? "▾" : "▸"}</span>
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}
function pickEmoji(text) {
  const t = (text || "").toLowerCase();
  const map = [["bottle|drink|water", "🥤"], ["watch|wearable", "⌚"], ["shoe|sneaker|run", "👟"], ["coffee|brew|tea", "☕"], ["skin|serum|beauty|cream", "🧴"], ["phone|app|software|tech", "📱"], ["bag|fashion|wear|cloth", "👜"], ["food|snack|meal", "🍽️"], ["car|auto", "🚗"], ["home|furniture|decor", "🛋️"]];
  for (const [k, e] of map) if (new RegExp(k).test(t)) return e;
  return "🛍️";
}

function AdVisual({ brief, platform, small, image, env, brand, wm, video, carousel }) {
  const vertical = platform === "tiktok";
  const words = (brief || "Your product").split(" ").slice(0, 4).join(" ");
  const emoji = pickEmoji(brief);
  const cta = { background: brand?.color || "#67e8f9" };
  const h = vertical ? (small ? "h-64" : "h-80") : small ? "h-40" : "h-52";
  const overlays = (
    <>
      {brand && (
        <div className="absolute top-3 left-3 flex flex-col gap-1 items-start">
          {brand.logo ? <img src={brand.logo} alt="logo" className="w-8 h-8 rounded-lg object-cover border border-white/30" /> :
            brand.showInitial ? <span className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-xs font-bold" style={aurora}>{brand.initial}</span> : null}
          {env && <span className="text-[9px] text-white/80 bg-black/40 rounded px-1.5 py-0.5">Scene: {env}</span>}
        </div>
      )}
      {!brand && env && <div className="absolute top-3 left-3 text-[9px] text-white/80 bg-black/40 rounded px-1.5 py-0.5">Scene: {env}</div>}
      {video && (
        <>
          <div className="absolute inset-0 flex items-center justify-center"><span className="w-10 h-10 rounded-full bg-black/50 border border-white/40 flex items-center justify-center text-white text-sm">▶</span></div>
          <span className="absolute bottom-3 right-3 text-[9px] text-white/80 bg-black/50 rounded px-1.5 py-0.5">🎬 0:15</span>
        </>
      )}
      {carousel && (
        <div className="absolute bottom-2 left-0 right-0 flex flex-col items-center gap-1">
          <span className="text-[9px] text-white/80 bg-black/50 rounded px-1.5 py-0.5">1 / 3</span>
          <div className="flex gap-1"><span className="w-1.5 h-1.5 rounded-full bg-white" /><span className="w-1.5 h-1.5 rounded-full bg-white/40" /><span className="w-1.5 h-1.5 rounded-full bg-white/40" /></div>
        </div>
      )}
      {wm && <span className="absolute bottom-3 left-3 text-[9px] text-white/70 bg-black/40 rounded px-1.5 py-0.5">made with NivaAd</span>}
    </>
  );
  if (image)
    return (
      <div className={`relative overflow-hidden rounded-xl ${h} w-full bg-slate-950`}>
        <img src={image} alt="ad" className="absolute inset-0 w-full h-full object-cover" />
        <div className="absolute inset-0" style={{ backgroundImage: "linear-gradient(to top, rgba(2,6,23,0.85) 0%, rgba(2,6,23,0.05) 55%)" }} />
        <div className="absolute inset-0 flex flex-col justify-end p-4 pb-6">
          <div className="text-[10px] uppercase tracking-widest text-cyan-200/80 mb-1">New launch</div>
          <div className="text-white font-bold leading-tight text-lg drop-shadow">{words}</div>
          {brand?.tagline && <div className="text-[10px] italic text-white/80 mt-0.5">{brand.tagline}</div>}
          <div className="mt-2 inline-flex"><span className="text-[11px] text-slate-900 rounded-full px-3 py-1 font-semibold" style={cta}>Shop now →</span></div>
        </div>
        {overlays}
        <div className="absolute top-3 right-3 text-[9px] text-white/50 border border-white/20 rounded px-1.5 py-0.5">Your product · AI scene</div>
      </div>
    );
  return (
    <div className={`relative overflow-hidden rounded-xl ${h} w-full`} style={{ backgroundImage: "radial-gradient(120% 120% at 20% 10%,#7c3aed 0%,#1e1b4b 45%,#0b1024 100%)" }}>
      <div className="absolute inset-0 opacity-40" style={{ backgroundImage: "radial-gradient(60% 60% at 80% 90%,#06b6d4 0%,transparent 60%)" }} />
      <div className="absolute inset-0 flex items-center justify-center"><span className="text-5xl opacity-90 drop-shadow-lg -translate-y-3">{emoji}</span></div>
      <div className="absolute inset-0 flex flex-col justify-end p-4 pb-6">
        <div className="text-[10px] uppercase tracking-widest text-cyan-200/80 mb-1">New launch</div>
        <div className="text-white font-bold leading-tight text-lg">{words}</div>
        {brand?.tagline && <div className="text-[10px] italic text-white/80 mt-0.5">{brand.tagline}</div>}
        <div className="mt-2 inline-flex"><span className="text-[11px] text-slate-900 rounded-full px-3 py-1 font-semibold" style={cta}>Shop now →</span></div>
      </div>
      {overlays}
      <div className="absolute top-3 right-3 text-[9px] text-white/50 border border-white/20 rounded px-1.5 py-0.5">AI image</div>
    </div>
  );
}

function compIssues(pid, caption) {
  const issues = [];
  const c = caption || "";
  if (pid === "x" && c.length > 280) issues.push(`Over X's 280-char limit (${c.length}).`);
  if (pid === "tiktok" && c.length > 2200) issues.push("Over TikTok's 2,200-char caption limit.");
  RISKY_CLAIMS.forEach((w) => { if (c.toLowerCase().includes(w)) issues.push(`"${w}" may violate ad claim policies.`); });
  return issues;
}

function PlatformPreview({ p, result, brief, company, onEdit, isPosted, onPost, image, env, brand, wm, video, carousel }) {
  const issues = compIssues(p.id, result?.caption);
  return (
    <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex flex-col gap-3 w-full">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-slate-950" style={{ background: p.color }}>{p.tag}</span>
          <span className="text-sm font-semibold text-white">{p.name}</span>
        </div>
        {result?.score != null && (
          <span className={`text-[10px] font-bold rounded-full px-2 py-0.5 border ${result.score >= 80 ? "text-emerald-400 border-emerald-500/40" : result.score >= 65 ? "text-amber-400 border-amber-500/40" : "text-rose-400 border-rose-500/40"}`}>◎ {result.score}/100</span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <span className="w-7 h-7 rounded-full text-xs flex items-center justify-center text-white font-bold" style={aurora}>{(company || "A")[0].toUpperCase()}</span>
        <div>
          <div className="text-xs font-semibold text-white">{company || "Your Company"}</div>
          <div className="text-[10px] text-slate-500">Sponsored · {p.ratio}</div>
        </div>
      </div>
      <AdVisual brief={brief} platform={p.id} small image={image} env={env} brand={brand} wm={wm} video={video} carousel={carousel} />
      <textarea value={result?.caption || ""} onChange={(e) => onEdit(p.id, e.target.value)}
        className="text-xs text-slate-300 bg-slate-950/60 border border-slate-800 rounded-lg p-2 resize-none h-20 focus:outline-none focus:border-violet-500" />
      <div className="flex flex-wrap gap-1">{(result?.hashtags || []).map((h) => <span key={h} className="text-[10px] text-cyan-300">{h}</span>)}</div>
      {result?.tip && <div className="text-[10px] text-slate-400 bg-slate-950/60 border border-slate-800 rounded-lg px-2 py-1.5">💡 {result.tip}</div>}
      {issues.map((i) => <div key={i} className="text-[10px] text-amber-400 bg-amber-500/5 border border-amber-500/30 rounded-lg px-2 py-1.5">⚠ {i}</div>)}
      {isPosted ? (
        <div className="text-center text-xs text-emerald-400 border border-emerald-500/40 bg-emerald-500/5 rounded-full py-2">✓ Posted to {p.name}</div>
      ) : (
        <button onClick={onPost} className="text-xs text-white font-semibold rounded-full py-2" style={aurora}>Post to {p.name}</button>
      )}
    </div>
  );
}

export default function App() {
  const [page, setPage] = useState("landing");
  const [view, setView] = useState("dashboard");
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [aup, setAup] = useState(false);
  const [tier, setTier] = useState(2);
  const [term, setTerm] = useState(1);
  const [credits, setCredits] = useState(TIER_DATA[2].credits);
  const [connections, setConnections] = useState({});
  const [connecting, setConnecting] = useState(null);
  const [ads, setAds] = useState([]);
  const [strikes, setStrikes] = useState(0);
  const [flagged, setFlagged] = useState([]);
  const [products, setProducts] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [scheduled, setScheduled] = useState([]);
  const [requireApproval, setRequireApproval] = useState(false);
  const [adSearch, setAdSearch] = useState("");

  /* admin */
  const [adminTab, setAdminTab] = useState("overview");
  const [teamUsers, setTeamUsers] = useState([]);
  const [nuName, setNuName] = useState("");
  const [nuEmail, setNuEmail] = useState("");
  const [nuRole, setNuRole] = useState("Editor");
  const [customRules, setCustomRules] = useState([]);
  const [newRule, setNewRule] = useState("");

  /* brand kit */
  const [brandLogo, setBrandLogo] = useState(null);
  const [brandColor, setBrandColor] = useState("#7c3aed");
  const [brandTagline, setBrandTagline] = useState("");

  /* model config */
  const [modelCfg, setModelCfg] = useState({
    image: { active: "medium", tiers: { low: { model: "openai/gpt-image-1-mini", credits: 1 }, medium: { model: "google/gemini-2.5-flash-image", credits: 2 }, best: { model: "black-forest-labs/flux-1.1-pro", credits: 3 } } },
    video: { active: "medium", tiers: { low: { model: "minimax/video-01", credits: 3 }, medium: { model: "kling/kling-v1.6-standard", credits: 5 }, best: { model: "google/veo-3", credits: 8 } } },
  });

  /* wizard */
  const [step, setStep] = useState(1);
  const [productName, setProductName] = useState("");
  const [brief, setBrief] = useState("");
  const [audience, setAudience] = useState("");
  const [offer, setOffer] = useState("");
  const [goal, setGoal] = useState("Drive sales");
  const [tone, setTone] = useState("Professional");
  const [productImage, setProductImage] = useState(null);
  const [envStyle, setEnvStyle] = useState("Studio");
  const [envDesc, setEnvDesc] = useState("");
  const [useBrand, setUseBrand] = useState({ logo: false, color: false, tagline: false });
  const [openPhoto, setOpenPhoto] = useState(false);
  const [openBrand, setOpenBrand] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [importing, setImporting] = useState(false);
  const [outputs, setOutputs] = useState({ text: true, image: true, video: false });
  const [format, setFormat] = useState("single");
  const [variations, setVariations] = useState(1);
  const [sel, setSel] = useState({ instagram: true, facebook: true, linkedin: false, x: false, tiktok: false });
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [resultSets, setResultSets] = useState(null);
  const [activeVar, setActiveVar] = useState(0);
  const [refine, setRefine] = useState("");
  const [postedMap, setPostedMap] = useState({});
  const [posted, setPosted] = useState(false);
  const [showSched, setShowSched] = useState(false);
  const [schedAt, setSchedAt] = useState("");
  const [campBusy, setCampBusy] = useState(false);
  const [campName, setCampName] = useState("");
  const [campBrief, setCampBrief] = useState("");

  const chosen = PLATFORMS.filter((p) => sel[p.id]);
  const planCredits = TIER_DATA[tier].credits;
  const results = resultSets ? resultSets[activeVar] : null;
  const isFree = tier === 0;

  const connect = (id) => { setConnecting(id); setTimeout(() => { setConnections((c) => ({ ...c, [id]: true })); setConnecting(null); }, 900); };
  const moderate = (text) => [...BLOCKLIST, ...customRules].find((w) => text.toLowerCase().includes(w.toLowerCase()));
  const genCost = () => {
    let c = (outputs.image ? modelCfg.image.tiers[modelCfg.image.active].credits : 0) + (outputs.video ? modelCfg.video.tiers[modelCfg.video.active].credits : 0);
    if (format === "carousel") c += 1;
    c = Math.max(1, c);
    if (variations === 3) c *= 2;
    return c;
  };

  const fullBrief = () =>
    `Product: ${productName}. Description: ${brief}. Target audience: ${audience || "general consumers"}. Offer: ${offer || "none"}. Goal: ${goal}.${productImage ? ` Ad image shows the real product in this environment: ${envDesc || envStyle}.` : ""}${useBrand.tagline && brandTagline ? ` Weave in the brand tagline naturally: "${brandTagline}".` : ""}${format === "carousel" ? " Format: 3-slide carousel — caption should tease a swipe." : ""}`;

  async function callClaude(prompt) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 2000, messages: [{ role: "user", content: prompt }] }),
    });
    const data = await res.json();
    const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
    return JSON.parse(text.replace(/```json|```/g, "").trim());
  }

  async function generate(feedback) {
    const hit = moderate([productName, brief, audience, offer, envDesc, feedback || ""].join(" "));
    if (hit) {
      setBlocked(true); setStrikes((s) => s + 1);
      setFlagged((f) => [{ company: company || "Demo Co", text: brief, term: hit, at: new Date().toLocaleTimeString() }, ...f]);
      return;
    }
    setBusy(true); setBlocked(false); setPosted(false);
    const plats = chosen.map((p) => p.id);
    const shape = `{${plats.map((p) => `"${p}":{"caption":"...","hashtags":["#.."],"score":85,"tip":"one short improvement tip"}`).join(",")}}`;
    const prompt = `You are an expert social ad copywriter and creative reviewer. Brief: "${fullBrief()}". Tone: ${tone}. ${feedback ? `Customer requested changes: "${feedback}". Apply them.` : ""} Platforms: ${plats.join(", ")}. Adapt per platform (LinkedIn longer/professional, X short, TikTok trendy, Instagram engaging, Facebook conversational). For each, also rate the copy 0-100 for predicted engagement (score) and give one improvement tip. ${variations === 3 && !feedback ? `Produce 3 distinct creative angles. Respond ONLY with raw JSON: {"variants":[${shape},${shape},${shape}]}` : `Respond ONLY with raw JSON: ${shape}`}`;
    try {
      const parsed = await callClaude(prompt);
      if (variations === 3 && !feedback) { setResultSets(parsed.variants); setActiveVar(0); }
      else if (feedback && resultSets) { const c = [...resultSets]; c[activeVar] = parsed; setResultSets(c); }
      else { setResultSets([parsed]); setActiveVar(0); }
    } catch {
      const fb = {}; plats.forEach((p) => (fb[p] = { ...FALLBACK_COPY[p] }));
      setResultSets(variations === 3 && !feedback ? [fb, fb, fb] : [fb]); setActiveVar(0);
    }
    if (!feedback) setCredits((c) => Math.max(0, c - genCost()));
    setBusy(false); setStep(5); setRefine("");
  }

  function recordAd(status, extra) {
    setAds((a) => [{ id: Date.now(), brief: (productName ? productName + " — " : "") + brief, platforms: chosen.map((p) => p.name), at: new Date().toLocaleString(), status, fav: false, ...extra }, ...a]);
  }
  function postOne(id) {
    setPostedMap((m) => {
      const next = { ...m, [id]: true };
      if (chosen.every((p) => next[p.id])) { setPosted(true); recordAd("Posted"); }
      return next;
    });
  }
  function postAll() { chosen.forEach((p) => postOne(p.id)); }
  function scheduleAll() {
    if (!schedAt) return;
    setScheduled((s) => [...chosen.filter((p) => !postedMap[p.id]).map((p) => ({ id: Date.now() + Math.random(), platform: p.name, tag: p.tag, color: p.color, at: schedAt, brief: productName || brief })), ...s]);
    recordAd("Scheduled", { schedAt }); setPosted(true); setShowSched(false);
  }
  function submitApproval() { recordAd("Pending approval"); setPosted(true); }
  function downloadPackage() {
    const txt = chosen.map((p) => `=== ${p.name} (${p.ratio}) ===\n${results?.[p.id]?.caption || ""}\n${(results?.[p.id]?.hashtags || []).join(" ")}\n`).join("\n");
    const blob = new Blob([`NivaAd export — ${productName}\n\n${txt}`], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "nivaad-ad-package.txt"; a.click(); URL.revokeObjectURL(a.href);
  }
  function saveToLibrary() {
    if (!productName.trim()) return;
    setProducts((ps) => [{ id: Date.now(), name: productName, brief, audience, offer, image: productImage }, ...ps.filter((x) => x.name !== productName)]);
  }
  function loadProduct(pr) {
    setProductName(pr.name); setBrief(pr.brief); setAudience(pr.audience); setOffer(pr.offer); setProductImage(pr.image || null);
    setView("create"); setStep(1); setResultSets(null); setPosted(false); setPostedMap({});
  }
  function importFromUrl() {
    if (!urlInput.trim()) return;
    setImporting(true);
    setTimeout(() => {
      try {
        const u = urlInput.replace(/https?:\/\//, "").split(/[/?#]/).filter(Boolean);
        const slug = (u[u.length - 1] || u[0] || "product").replace(/[-_]/g, " ").replace(/\.\w+$/, "");
        const name = slug.split(" ").map((w) => w[0] ? w[0].toUpperCase() + w.slice(1) : "").join(" ").trim() || "Imported Product";
        setProductName(name);
        setBrief(`${name} — imported from ${u[0]}. (Simulated extraction: the backend will scrape the real page for description, features and price. Review and edit before generating.)`);
      } catch { }
      setImporting(false);
    }, 1100);
  }
  async function generateCampaign() {
    if (!campName.trim() || !campBrief.trim() || credits < 2) return;
    const hit = moderate(campName + " " + campBrief);
    if (hit) { setFlagged((f) => [{ company: company || "Demo Co", text: campBrief, term: hit, at: new Date().toLocaleTimeString() }, ...f]); setStrikes((s) => s + 1); return; }
    setCampBusy(true);
    const d = (n) => { const x = new Date(); x.setDate(x.getDate() + n); return x.toLocaleDateString(); };
    let phases;
    try {
      phases = await callClaude(`Write a 3-phase product launch campaign for: "${campName} — ${campBrief}". Respond ONLY raw JSON: {"teaser":{"caption":"..."},"launch":{"caption":"..."},"followup":{"caption":"..."}}. Teaser builds curiosity without revealing all, launch announces with CTA, followup adds social proof/urgency.`);
    } catch {
      phases = { teaser: { caption: `Something new is coming from ${company || "us"}… 👀 Stay tuned.` }, launch: { caption: `It's here — ${campName} is live! Be among the first.` }, followup: { caption: `The response to ${campName} has been incredible. Don't miss out.` } };
    }
    setCampaigns((c) => [{ id: Date.now(), name: campName, phases: [{ label: "Teaser", date: d(2), cap: phases.teaser.caption }, { label: "Launch", date: d(5), cap: phases.launch.caption }, { label: "Follow-up", date: d(8), cap: phases.followup.caption }] }, ...c]);
    setCredits((c) => Math.max(0, c - 2)); setCampName(""); setCampBrief(""); setCampBusy(false);
  }
  function resetWizard() {
    setStep(1); setProductName(""); setBrief(""); setAudience(""); setOffer(""); setGoal("Drive sales");
    setResultSets(null); setPosted(false); setBlocked(false); setRefine(""); setPostedMap({});
    setProductImage(null); setEnvStyle("Studio"); setEnvDesc(""); setUseBrand({ logo: false, color: false, tagline: false });
    setUrlInput(""); setFormat("single"); setVariations(1); setShowSched(false); setSchedAt("");
  }

  /* persistence */
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    (async () => {
      try {
        if (window.storage) {
          const r = await window.storage.get("nivaad-state");
          if (r && r.value) {
            const s = JSON.parse(r.value);
            const map = { page: setPage, view: setView, company: setCompany, email: setEmail, aup: setAup, connections: setConnections, ads: setAds, strikes: setStrikes, flagged: setFlagged, products: setProducts, campaigns: setCampaigns, scheduled: setScheduled, requireApproval: setRequireApproval, teamUsers: setTeamUsers, customRules: setCustomRules, brandLogo: setBrandLogo, brandColor: setBrandColor, brandTagline: setBrandTagline, modelCfg: setModelCfg, step: setStep, productName: setProductName, brief: setBrief, audience: setAudience, offer: setOffer, goal: setGoal, tone: setTone, productImage: setProductImage, envStyle: setEnvStyle, envDesc: setEnvDesc, useBrand: setUseBrand, outputs: setOutputs, format: setFormat, sel: setSel, resultSets: setResultSets, postedMap: setPostedMap, posted: setPosted };
            Object.entries(map).forEach(([k, fn]) => { if (s[k] !== undefined && s[k] !== null) fn(s[k]); });
            if (s.tier != null) setTier(s.tier); if (s.term != null) setTerm(s.term);
            if (s.credits != null) setCredits(s.credits); if (s.variations) setVariations(s.variations);
          }
        }
      } catch (e) { }
      setRestored(true);
    })();
  }, []);
  useEffect(() => {
    if (!restored) return;
    try {
      if (window.storage) {
        window.storage.set("nivaad-state", JSON.stringify({
          page, view, company, email, aup, tier, term, credits, connections, ads, strikes, flagged, products, campaigns, scheduled, requireApproval,
          teamUsers, customRules, brandColor, brandTagline, modelCfg,
          step, productName, brief, audience, offer, goal, tone, envStyle, envDesc, useBrand, outputs, format, variations, sel, resultSets, postedMap, posted,
          brandLogo: brandLogo && brandLogo.length < 1500000 ? brandLogo : null,
          productImage: productImage && productImage.length < 2000000 ? productImage : null,
        })).catch(() => { });
      }
    } catch (e) { }
  }, [restored, page, view, company, email, aup, tier, term, credits, connections, ads, strikes, flagged, products, campaigns, scheduled, requireApproval, teamUsers, customRules, brandLogo, brandColor, brandTagline, modelCfg, step, productName, brief, audience, offer, goal, tone, productImage, envStyle, envDesc, useBrand, outputs, format, variations, sel, resultSets, postedMap, posted]);

  /* ============ PUBLIC PAGES ============ */
  const Nav = ({ cta }) => (
    <div className="flex items-center justify-between px-6 md:px-12 py-5">
      <button onClick={() => setPage("landing")}><Logo /></button>
      <div className="flex items-center gap-6 text-sm text-slate-300">
        <button onClick={() => setPage("pricing")} className="hover:text-white">Pricing</button>
        {cta && <button onClick={() => setPage("signup")} className="text-white text-sm font-semibold rounded-full px-5 py-2" style={aurora}>Start free</button>}
      </div>
    </div>
  );

  if (page === "landing")
    return (
      <div className="min-h-screen bg-slate-950 text-slate-200" style={{ fontFamily: "ui-sans-serif,system-ui" }}>
        <Nav cta />
        <div className="max-w-5xl mx-auto px-6 pt-16 pb-10 text-center">
          <div className="flex justify-center mb-5"><Pill>AI ad studio for product launches</Pill></div>
          <h1 className="text-5xl md:text-6xl font-bold tracking-tight text-white leading-[1.05]">Describe your product.<br /><span style={gradText}>Post everywhere.</span></h1>
          <p className="mt-6 text-lg text-slate-400 max-w-2xl mx-auto">NivaAd turns one brief — or just a product link — into ready-to-post ads with copy, image, video and carousels, scored and compliance-checked for every platform you tick.</p>
          <div className="mt-8 flex justify-center gap-3">
            <button onClick={() => setPage("signup")} className="text-white font-semibold rounded-full px-7 py-3" style={aurora}>Create your first ad — free</button>
            <button onClick={() => setPage("pricing")} className="rounded-full px-7 py-3 border border-slate-700 hover:border-slate-500 text-slate-200">See pricing</button>
          </div>
          <div className="mt-3 text-xs text-slate-600">Free plan · no card required · transparent credits — the cost of every action is shown before you click it.</div>
        </div>
        <div className="max-w-5xl mx-auto px-6 pb-14 grid md:grid-cols-3 gap-4">
          {[["🔗 Start from a link", "Paste a product URL and NivaAd extracts the details — or fill a 60-second guided brief."],
            ["◎ Scored & compliant", "Every ad gets an AI engagement score, an improvement tip, and platform policy checks before you post."],
            ["🚀 Launch campaigns", "Generate teaser → launch → follow-up sets and schedule them at each platform's best time."]].map(([t, d]) => (
            <div key={t} className="bg-slate-900/70 border border-slate-800 rounded-2xl p-6">
              <div className="text-white font-semibold mb-2">{t}</div>
              <div className="text-sm text-slate-400">{d}</div>
            </div>
          ))}
        </div>
        <div className="max-w-5xl mx-auto px-6 pb-16">
          <div className="text-center mb-8">
            <h2 className="text-3xl font-bold text-white tracking-tight">Fresh from the studio</h2>
            <p className="text-sm text-slate-500 mt-2">Sample ads generated by NivaAd — one brief each, zero designers.</p>
          </div>
          <div className="grid md:grid-cols-4 gap-4">
            {SAMPLES.map((s) => (
              <div key={s.name} className="rounded-2xl overflow-hidden border border-slate-800 bg-slate-900/70">
                <div className="relative h-44 flex items-center justify-center" style={{ backgroundImage: s.bg }}>
                  <span className="text-6xl drop-shadow-lg">{s.emoji}</span>
                  <span className="absolute top-3 left-3 text-[10px] text-white/90 bg-black/30 rounded-full px-2 py-0.5">{s.chip}</span>
                  <span className="absolute bottom-3 right-3 text-[9px] text-white/60 border border-white/20 rounded px-1.5 py-0.5">AI generated</span>
                </div>
                <div className="p-4">
                  <div className="text-sm font-semibold text-white">{s.name}</div>
                  <div className="text-xs text-slate-400 mt-1">{s.cap}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="text-center text-xs text-slate-600 pb-8">© 2026 NivaAd · Powered by <span className="text-slate-400">Nivatier</span> · Terms · Privacy · Acceptable Use Policy</div>
      </div>
    );

  if (page === "pricing")
    return (
      <div className="min-h-screen bg-slate-950 text-slate-200">
        <Nav cta />
        <div className="max-w-6xl mx-auto px-6 py-12">
          <h2 className="text-4xl font-bold text-white text-center tracking-tight">Simple plans, <span style={gradText}>no surprise charges</span></h2>
          <p className="text-center text-sm text-slate-500 mt-2">Every generation shows its credit cost before you click. Cancel anytime.</p>
          <div className="flex justify-center gap-2 mt-8">
            {TERMS.map((t, i) => (
              <button key={t.m} onClick={() => setTerm(i)} className={`text-sm rounded-full px-4 py-2 border ${term === i ? "border-violet-500 text-white bg-violet-500/10" : "border-slate-800 text-slate-400"}`}>
                {t.label}{t.disc > 0 && <span className="text-cyan-300 ml-1">−{t.disc * 100}%</span>}
              </button>
            ))}
          </div>
          <div className="grid md:grid-cols-4 gap-4 mt-10">
            {TIER_DATA.map((td, i) => {
              const price = Math.round(td.monthly * (1 - TERMS[term].disc));
              return (
                <div key={td.name} className={`rounded-2xl p-6 border ${td.hot ? "border-violet-500 bg-violet-500/5" : "border-slate-800 bg-slate-900/60"}`}>
                  {td.hot && <div className="text-[10px] uppercase tracking-widest text-violet-300 mb-2">Most popular</div>}
                  <div className="text-white font-bold text-xl">{td.name}</div>
                  <div className="mt-3 text-4xl font-bold text-white">${price}<span className="text-sm text-slate-500 font-normal">/mo</span></div>
                  <div className="text-cyan-300 text-sm mt-1">{td.quota}</div>
                  <ul className="mt-4 space-y-2 text-sm text-slate-400">{td.feats.map((f) => <li key={f}>✓ {f}</li>)}</ul>
                  <button onClick={() => { setTier(i); setCredits(td.credits); setPage("signup"); }}
                    className={`mt-6 w-full rounded-full py-2.5 text-sm font-semibold ${td.hot ? "text-white" : "border border-slate-700 text-slate-200"}`} style={td.hot ? aurora : {}}>
                    {td.monthly === 0 ? "Start free" : `Choose ${td.name}`}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );

  if (page === "signup")
    return (
      <div className="min-h-screen bg-slate-950 text-slate-200 flex flex-col">
        <Nav />
        <div className="flex-1 flex items-center justify-center px-6">
          <div className="w-full max-w-md bg-slate-900/70 border border-slate-800 rounded-2xl p-8">
            <h2 className="text-2xl font-bold text-white tracking-tight">Create your company account</h2>
            <p className="text-sm text-slate-500 mt-1">Plan: <span className="text-cyan-300">{TIER_DATA[tier].name}</span> · {TERMS[term].label}</p>
            <div className="mt-6 space-y-4">
              <input placeholder="Company name" value={company} onChange={(e) => setCompany(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-violet-500" />
              <input placeholder="Work email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-violet-500" />
              <input placeholder="Password" type="password" className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-violet-500" />
              <label className="flex items-start gap-2 text-xs text-slate-400 cursor-pointer">
                <input type="checkbox" checked={aup} onChange={(e) => setAup(e.target.checked)} className="mt-0.5" />
                <span>I accept the <span className="text-cyan-300">Terms of Service</span> and <span className="text-cyan-300">Acceptable Use Policy</span>. My company is responsible for content it posts; prohibited content is blocked and logged.</span>
              </label>
              <button disabled={!aup || !company} onClick={() => setPage("onboarding")} className="w-full rounded-full py-3 text-sm font-semibold text-white disabled:opacity-40" style={aurora}>Continue → Connect platforms</button>
              <div className="text-[11px] text-slate-600 text-center">Payment checkout simulated in this build — Stripe plugs in here.</div>
            </div>
          </div>
        </div>
      </div>
    );

  if (page === "onboarding")
    return (
      <div className="min-h-screen bg-slate-950 text-slate-200 flex flex-col">
        <Nav />
        <div className="flex-1 flex items-center justify-center px-6">
          <div className="w-full max-w-lg">
            <h2 className="text-3xl font-bold text-white tracking-tight text-center">Connect your platforms</h2>
            <p className="text-sm text-slate-500 text-center mt-2 max-w-md mx-auto">You'll log in on each platform's own page — NivaAd never sees or stores your passwords, only a secure posting token you can revoke anytime.</p>
            <div className="mt-8 space-y-3">
              {PLATFORMS.map((p) => (
                <div key={p.id} className="flex items-center justify-between bg-slate-900/70 border border-slate-800 rounded-xl px-4 py-3">
                  <div className="flex items-center gap-3">
                    <span className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-slate-950" style={{ background: p.color }}>{p.tag}</span>
                    <span className="text-sm text-white">{p.name}</span>
                  </div>
                  {connections[p.id] ? <span className="text-xs text-emerald-400">● Connected</span> :
                    <button onClick={() => connect(p.id)} className="text-xs border border-slate-700 rounded-full px-4 py-1.5 hover:border-violet-500">{connecting === p.id ? "Authorizing…" : "Connect"}</button>}
                </div>
              ))}
            </div>
            <button onClick={() => setPage("app")} className="mt-8 w-full rounded-full py-3 text-sm font-semibold text-white" style={aurora}>Enter NivaAd →</button>
            <div className="text-[11px] text-slate-600 text-center mt-3">OAuth simulated — live connections activate after platform app review approval. You can skip and connect later in Settings.</div>
          </div>
        </div>
      </div>
    );

  /* ============ MAIN APP ============ */
  const NAV_GROUPS = [
    { label: "Create", items: [["create", "✦ Create Ad"], ["campaigns", "🚀 Campaigns"]] },
    { label: "Library", items: [["ads", "My Ads"], ["products", "Products"], ["schedule", "Schedule"]] },
    { label: "Setup", items: [["brand", "Brand Kit"], ["settings", "Settings"]] },
    { label: "Insights", items: [["analytics", "Analytics"], ["admin", "Admin"]] },
  ];
  const input = "bg-slate-950 border border-slate-800 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-violet-500";

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 flex">
      <div className="w-56 border-r border-slate-800/70 p-5 flex flex-col shrink-0">
        <button onClick={() => setView("dashboard")} className="mb-5 text-left"><Logo /></button>
        {NAV_GROUPS.map((g) => (
          <div key={g.label} className="mb-3">
            <div className="text-[9px] uppercase tracking-widest text-slate-600 px-3 mb-1">{g.label}</div>
            {g.items.map(([id, label]) => (
              <button key={id} onClick={() => setView(id)}
                className={`w-full text-left text-sm rounded-lg px-3 py-1.5 mb-0.5 ${view === id ? "bg-violet-500/15 text-white border border-violet-500/30" : "text-slate-400 hover:text-white"}`}>{label}</button>
            ))}
          </div>
        ))}
        <div className="mt-auto bg-slate-900/70 border border-slate-800 rounded-xl p-3">
          <div className="text-[10px] uppercase tracking-widest text-slate-500">Credits left</div>
          <div className="text-2xl font-bold text-white">{credits}<span className="text-xs text-slate-500 font-normal"> / {planCredits}</span></div>
          <div className="h-1.5 bg-slate-800 rounded-full mt-2"><div className="h-1.5 rounded-full" style={{ ...aurora, width: `${Math.min(100, (credits / planCredits) * 100)}%` }} /></div>
          <div className="text-[10px] text-slate-500 mt-1">{TIER_DATA[tier].name} · resets monthly</div>
          <button onClick={() => setView("settings")} className="mt-2 w-full text-[10px] border border-slate-700 rounded-full py-1 text-slate-300 hover:border-violet-500">＋ Buy credits</button>
        </div>
      </div>

      <div className="flex-1 p-8 overflow-auto">
        {view === "dashboard" && (
          <div className="max-w-4xl">
            <h2 className="text-3xl font-bold text-white tracking-tight">Welcome, {company || "Demo Co"} 👋</h2>
            <div className="grid md:grid-cols-4 gap-4 mt-6">
              {[["Ads created", ads.length], ["Scheduled", scheduled.length], ["Credits left", credits], ["Platforms", Object.values(connections).filter(Boolean).length]].map(([k, v]) => (
                <div key={k} className="bg-slate-900/70 border border-slate-800 rounded-2xl p-5"><div className="text-xs text-slate-500">{k}</div><div className="text-3xl font-bold text-white mt-1">{v}</div></div>
              ))}
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => { setView("create"); resetWizard(); }} className="text-white font-semibold rounded-full px-6 py-3 text-sm" style={aurora}>✦ Create a new ad</button>
              <button onClick={() => setView("campaigns")} className="text-sm border border-slate-700 rounded-full px-6 py-3">🚀 Plan a launch campaign</button>
            </div>
            {ads.filter((a) => a.status === "Pending approval").length > 0 && (
              <div className="mt-4 text-xs text-amber-400 border border-amber-500/30 bg-amber-500/5 rounded-lg p-3">⏳ {ads.filter((a) => a.status === "Pending approval").length} ad(s) awaiting approval — review in My Ads.</div>
            )}
            {strikes > 0 && <div className="mt-4 text-xs text-amber-400 border border-amber-500/30 bg-amber-500/5 rounded-lg p-3">⚠ {strikes} policy strike{strikes > 1 ? "s" : ""} on this account.</div>}
          </div>
        )}

        {view === "create" && (
          <div className="max-w-5xl">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-2">
                {["Brief", "Outputs", "Platforms", "Generate", "Preview & Post"].map((s, i) => (
                  <div key={s} className={`text-xs rounded-full px-3 py-1 border ${step === i + 1 ? "border-violet-500 text-white bg-violet-500/10" : step > i + 1 ? "border-emerald-500/40 text-emerald-400" : "border-slate-800 text-slate-600"}`}>{i + 1}. {s}</div>
                ))}
              </div>
              <button onClick={resetWizard} className="text-xs border border-slate-700 text-slate-300 rounded-full px-4 py-1.5 hover:border-violet-500">＋ New ad</button>
            </div>

            {blocked && (
              <div className="border border-rose-500/40 bg-rose-500/5 rounded-2xl p-6 mb-6">
                <div className="text-rose-400 font-semibold">🛡️ Request blocked by content guardrails</div>
                <p className="text-sm text-slate-400 mt-2">Your brief matched a prohibited category under the Acceptable Use Policy. The attempt has been logged and a strike recorded. Edit the brief and try again.</p>
                <button onClick={() => setBlocked(false)} className="mt-3 text-xs border border-slate-700 rounded-full px-4 py-1.5">Edit brief</button>
              </div>
            )}

            {step === 1 && !blocked && (
              <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-6">
                <h3 className="text-xl font-bold text-white">What is this ad for?</h3>
                <div className="mt-4 bg-slate-950/60 border border-cyan-400/20 rounded-xl p-4">
                  <div className="text-xs font-semibold text-cyan-300">⚡ Quick start</div>
                  <div className="flex gap-2 mt-2">
                    <input value={urlInput} onChange={(e) => setUrlInput(e.target.value)} placeholder="Paste a product page URL — we'll extract the details" className={`flex-1 ${input}`} />
                    <button disabled={!urlInput.trim() || importing} onClick={importFromUrl} className="text-xs text-white font-semibold rounded-full px-5 disabled:opacity-40" style={aurora}>{importing ? "Extracting…" : "🔗 Import"}</button>
                    {products.length > 0 && (
                      <select onChange={(e) => { const pr = products.find((x) => String(x.id) === e.target.value); if (pr) loadProduct(pr); }} className={`${input} text-slate-400 max-w-[170px]`} defaultValue="">
                        <option value="" disabled>📦 From library…</option>
                        {products.map((pr) => <option key={pr.id} value={pr.id}>{pr.name}</option>)}
                      </select>
                    )}
                  </div>
                </div>

                <div className="mt-5 grid md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-semibold text-white">Product / service name <span className="text-cyan-300">*</span></label>
                    <input value={productName} onChange={(e) => setProductName(e.target.value)} placeholder="e.g. AquaGlow Smart Bottle" className={`mt-1.5 w-full ${input}`} />
                    <div className="text-[11px] text-slate-500 mt-1">💡 The exact name as it should appear in the ad.</div>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-white">Target audience <span className="text-cyan-300">*</span></label>
                    <input value={audience} onChange={(e) => setAudience(e.target.value)} placeholder="e.g. fitness-focused professionals, 25–40, urban" className={`mt-1.5 w-full ${input}`} />
                    <div className="text-[11px] text-slate-500 mt-1">💡 Who should this ad speak to? Age, interests, lifestyle.</div>
                  </div>
                </div>
                <div className="mt-4">
                  <label className="text-xs font-semibold text-white">Describe the product & what makes it special <span className="text-cyan-300">*</span></label>
                  <textarea value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="e.g. Stainless-steel smart water bottle that tracks hydration and glows to remind you to drink. Keeps drinks cold 24h. App-connected."
                    className={`mt-1.5 w-full h-24 ${input} resize-none`} />
                  <div className="text-[11px] text-slate-500 mt-1">💡 Mention 2–3 concrete features or benefits — specifics make ads convert. Avoid vague words like "great quality".</div>
                </div>
                <div className="mt-4 grid md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-semibold text-white">Offer / promotion <span className="text-slate-600">(optional)</span></label>
                    <input value={offer} onChange={(e) => setOffer(e.target.value)} placeholder="e.g. 20% off launch week, free shipping" className={`mt-1.5 w-full ${input}`} />
                    <div className="text-[11px] text-slate-500 mt-1">💡 Discounts and deadlines create urgency.</div>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-white">Campaign goal & tone</label>
                    <div className="mt-1.5 flex flex-wrap gap-2">
                      {["Drive sales", "Product launch", "Brand awareness", "Get signups"].map((g) => (
                        <button key={g} onClick={() => setGoal(g)} className={`text-xs rounded-full px-3 py-1.5 border ${goal === g ? "border-cyan-400 text-cyan-300 bg-cyan-400/5" : "border-slate-800 text-slate-500"}`}>{g}</button>
                      ))}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {["Professional", "Fun", "Luxury", "Minimal"].map((t) => (
                        <button key={t} onClick={() => setTone(t)} className={`text-xs rounded-full px-3 py-1 border ${tone === t ? "border-cyan-400 text-cyan-300" : "border-slate-800 text-slate-500"}`}>{t}</button>
                      ))}
                    </div>
                  </div>
                </div>

                <Collapse title="📷 Product photo & scene" hint="Upload your real product photo and describe the environment for the AI image." open={openPhoto} onToggle={() => setOpenPhoto(!openPhoto)} filled={!!productImage}>
                  {productImage ? (
                    <div className="flex items-center gap-3">
                      <img src={productImage} alt="product" className="w-16 h-16 rounded-lg object-cover border border-slate-700" />
                      <button onClick={() => setProductImage(null)} className="text-xs text-rose-400 border border-rose-500/40 rounded-full px-3 py-1">Remove</button>
                    </div>
                  ) : (
                    <label className="inline-block text-xs text-white font-semibold rounded-full px-4 py-2 cursor-pointer" style={aurora}>
                      ⬆ Upload photo
                      <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files && e.target.files[0]; if (!f) return; const r = new FileReader(); r.onload = () => setProductImage(r.result); r.readAsDataURL(f); }} />
                    </label>
                  )}
                  {productImage && (
                    <div className="mt-4">
                      <div className="flex flex-wrap gap-2">
                        {["Studio", "Lifestyle / in use", "Outdoor / nature", "Home setting", "Luxury / premium", "Festive / seasonal"].map((s) => (
                          <button key={s} onClick={() => setEnvStyle(s)} className={`text-xs rounded-full px-3 py-1.5 border ${envStyle === s ? "border-cyan-400 text-cyan-300 bg-cyan-400/5" : "border-slate-800 text-slate-500"}`}>{s}</button>
                        ))}
                      </div>
                      <input value={envDesc} onChange={(e) => setEnvDesc(e.target.value)} placeholder='e.g. "on a wooden gym bench with morning sunlight"' className={`mt-3 w-full ${input}`} />
                      <div className="text-[11px] text-slate-500 mt-1">💡 Surface, lighting, props, mood — specifics make it realistic.</div>
                    </div>
                  )}
                </Collapse>

                <Collapse title="🎨 Brand kit" hint="Tick brand elements to insert into this ad. Manage them in Brand Kit." open={openBrand} onToggle={() => setOpenBrand(!openBrand)} filled={useBrand.logo || useBrand.color || useBrand.tagline}>
                  <div className="grid md:grid-cols-3 gap-2">
                    <button onClick={() => setUseBrand((b) => ({ ...b, logo: !b.logo }))} className={`flex items-center gap-2 rounded-lg p-2.5 border text-left ${useBrand.logo ? "border-violet-500 bg-violet-500/10" : "border-slate-800"}`}>
                      {brandLogo ? <img src={brandLogo} alt="logo" className="w-8 h-8 rounded object-cover" /> : <span className="w-8 h-8 rounded flex items-center justify-center text-white text-xs font-bold" style={aurora}>{(company || "A")[0].toUpperCase()}</span>}
                      <div><div className="text-xs text-white">{useBrand.logo ? "☑" : "☐"} Logo</div><div className="text-[10px] text-slate-500">On the ad image</div></div>
                    </button>
                    <button onClick={() => setUseBrand((b) => ({ ...b, color: !b.color }))} className={`flex items-center gap-2 rounded-lg p-2.5 border text-left ${useBrand.color ? "border-violet-500 bg-violet-500/10" : "border-slate-800"}`}>
                      <span className="w-8 h-8 rounded" style={{ background: brandColor }} />
                      <div><div className="text-xs text-white">{useBrand.color ? "☑" : "☐"} Brand color</div><div className="text-[10px] text-slate-500">Buttons & accents</div></div>
                    </button>
                    <button onClick={() => setUseBrand((b) => ({ ...b, tagline: !b.tagline }))} className={`flex items-center gap-2 rounded-lg p-2.5 border text-left ${useBrand.tagline ? "border-violet-500 bg-violet-500/10" : "border-slate-800"}`}>
                      <span className="w-8 h-8 rounded flex items-center justify-center text-slate-400 border border-slate-700 text-[10px]">“ ”</span>
                      <div><div className="text-xs text-white">{useBrand.tagline ? "☑" : "☐"} Tagline</div><div className="text-[10px] text-slate-500">{brandTagline ? `"${brandTagline.slice(0, 20)}…"` : "Not set yet"}</div></div>
                    </button>
                  </div>
                </Collapse>

                <div className="flex items-center gap-3 mt-5">
                  <button disabled={!productName.trim() || brief.trim().length < 10 || !audience.trim()} onClick={() => setStep(2)}
                    className="text-white text-sm font-semibold rounded-full px-6 py-2.5 disabled:opacity-40" style={aurora}>Next: choose outputs →</button>
                  <button disabled={!productName.trim()} onClick={saveToLibrary} className="text-xs border border-slate-700 rounded-full px-4 py-2 text-slate-300 disabled:opacity-40">📦 Save to product library</button>
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-6">
                <h3 className="text-xl font-bold text-white">Tick what you need generated</h3>
                <div className="grid md:grid-cols-3 gap-3 mt-4">
                  {[["text", "✍️ Ad copy", "Captions, hashtags & CTAs · included"],
                    ["image", "🖼️ AI image", `${modelCfg.image.tiers[modelCfg.image.active].credits} credit${modelCfg.image.tiers[modelCfg.image.active].credits > 1 ? "s" : ""} · ${modelCfg.image.active} quality`],
                    ["video", "🎬 AI video", `${modelCfg.video.tiers[modelCfg.video.active].credits} credits · ${modelCfg.video.active} quality`]].map(([k, t, d]) => (
                    <button key={k} onClick={() => setOutputs((o) => ({ ...o, [k]: !o[k] }))} className={`text-left rounded-xl p-4 border ${outputs[k] ? "border-violet-500 bg-violet-500/10" : "border-slate-800"}`}>
                      <div className="text-white font-semibold text-sm">{outputs[k] ? "☑" : "☐"} {t}</div>
                      <div className="text-xs text-slate-500 mt-1">{d}</div>
                    </button>
                  ))}
                </div>
                <div className="grid md:grid-cols-2 gap-4 mt-5">
                  <div>
                    <div className="text-xs font-semibold text-white mb-2">Image format</div>
                    <div className="flex gap-2">
                      {[["single", "🖼 Single image"], ["carousel", "🎠 Carousel (3 slides) +1cr"]].map(([f, l]) => (
                        <button key={f} onClick={() => setFormat(f)} disabled={!outputs.image} className={`text-xs rounded-full px-4 py-2 border disabled:opacity-40 ${format === f ? "border-cyan-400 text-cyan-300 bg-cyan-400/5" : "border-slate-800 text-slate-500"}`}>{l}</button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-white mb-2">Variations <span className="text-slate-500 font-normal">(A/B test different angles)</span></div>
                    <div className="flex gap-2">
                      {[[1, "1 version"], [3, "3 variations ×2cr"]].map(([v, l]) => (
                        <button key={v} onClick={() => setVariations(v)} className={`text-xs rounded-full px-4 py-2 border ${variations === v ? "border-cyan-400 text-cyan-300 bg-cyan-400/5" : "border-slate-800 text-slate-500"}`}>{l}</button>
                      ))}
                    </div>
                  </div>
                </div>
                <button disabled={!outputs.text && !outputs.image && !outputs.video} onClick={() => setStep(3)} className="mt-5 text-white text-sm font-semibold rounded-full px-6 py-2.5 disabled:opacity-40" style={aurora}>Next: platforms →</button>
              </div>
            )}

            {step === 3 && (
              <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-6">
                <h3 className="text-xl font-bold text-white">Tick your target platforms</h3>
                <p className="text-sm text-slate-500 mt-1">Copy length, format and style adapt per platform automatically.</p>
                <div className="grid md:grid-cols-3 gap-3 mt-4">
                  {PLATFORMS.map((p) => (
                    <button key={p.id} onClick={() => setSel((s) => ({ ...s, [p.id]: !s[p.id] }))} className={`flex items-center gap-3 rounded-xl p-4 border ${sel[p.id] ? "border-cyan-400 bg-cyan-400/5" : "border-slate-800"}`}>
                      <span className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-slate-950" style={{ background: p.color }}>{p.tag}</span>
                      <div className="text-left">
                        <div className="text-sm text-white">{sel[p.id] ? "☑" : "☐"} {p.name}</div>
                        <div className="text-[10px] text-slate-500">{connections[p.id] ? "Connected ●" : "Not connected"}</div>
                      </div>
                    </button>
                  ))}
                </div>
                <button disabled={chosen.length === 0 || credits < genCost()} onClick={() => { setStep(4); generate(); }}
                  className="mt-5 text-white text-sm font-semibold rounded-full px-6 py-2.5 disabled:opacity-40" style={aurora}>
                  {credits < genCost() ? `Needs ${genCost()} credits — ${credits} left. Upgrade or top up` : `Generate for ${chosen.length} platform${chosen.length > 1 ? "s" : ""} (${genCost()} credit${genCost() > 1 ? "s" : ""}) →`}
                </button>
              </div>
            )}

            {step === 4 && busy && (
              <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-10 text-center">
                <div className="text-3xl animate-pulse">✦</div>
                <div className="text-white font-semibold mt-3">Generating your ads…</div>
                <div className="text-xs text-slate-500 mt-1">Writing platform-specific copy · scoring creatives · running safety & compliance checks</div>
              </div>
            )}

            {step === 5 && results && (
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <h3 className="text-xl font-bold text-white">Preview on every platform</h3>
                    {resultSets.length > 1 && (
                      <div className="flex gap-1">
                        {resultSets.map((_, i) => (
                          <button key={i} onClick={() => setActiveVar(i)} className={`text-xs rounded-full px-3 py-1 border ${activeVar === i ? "border-violet-500 text-white bg-violet-500/10" : "border-slate-800 text-slate-500"}`}>Variant {String.fromCharCode(65 + i)}</button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="text-xs text-emerald-400">✓ Passed output moderation</div>
                </div>
                <div className="grid md:grid-cols-3 gap-4">
                  {chosen.map((p) => (
                    <PlatformPreview key={p.id} p={p} result={results[p.id]} brief={productName || brief} company={company}
                      image={productImage} env={productImage ? (envDesc || envStyle) : null} wm={isFree}
                      video={outputs.video && p.id === "tiktok"} carousel={format === "carousel" && outputs.image}
                      brand={(useBrand.logo || useBrand.color || useBrand.tagline) ? { logo: useBrand.logo ? brandLogo : null, showInitial: useBrand.logo, initial: (company || "A")[0].toUpperCase(), color: useBrand.color ? brandColor : undefined, tagline: useBrand.tagline ? brandTagline : undefined } : null}
                      isPosted={!!postedMap[p.id]} onPost={() => (requireApproval ? submitApproval() : postOne(p.id))}
                      onEdit={(id, v) => setResultSets((rs) => { const c = [...rs]; c[activeVar] = { ...c[activeVar], [id]: { ...c[activeVar][id], caption: v } }; return c; })} />
                  ))}
                </div>

                {!posted ? (
                  <div className="mt-6 bg-slate-900/70 border border-slate-800 rounded-2xl p-5">
                    <div className="text-sm text-white font-semibold">Not quite right? Request changes</div>
                    <div className="flex gap-2 mt-3">
                      <input value={refine} onChange={(e) => setRefine(e.target.value)} placeholder='e.g. "make it shorter and add urgency"' className={`flex-1 ${input}`} />
                      <button disabled={!refine || busy} onClick={() => generate(refine)} className="text-sm border border-violet-500/50 text-violet-300 rounded-full px-5 disabled:opacity-40">{busy ? "Applying…" : "Regenerate"}</button>
                    </div>
                    <div className="flex flex-wrap gap-3 mt-5 items-center">
                      {requireApproval ? (
                        <button onClick={submitApproval} className="text-white text-sm font-semibold rounded-full px-6 py-2.5" style={aurora}>📋 Submit for approval</button>
                      ) : (
                        <button onClick={postAll} className="text-white text-sm font-semibold rounded-full px-6 py-2.5" style={aurora}>🚀 Post all ({chosen.filter((p) => !postedMap[p.id]).length})</button>
                      )}
                      <button onClick={() => setShowSched(!showSched)} className="text-sm border border-cyan-400/40 text-cyan-300 rounded-full px-6 py-2.5">🗓 Schedule</button>
                      <button onClick={downloadPackage} className="text-sm border border-slate-700 rounded-full px-6 py-2.5">⬇ Download package</button>
                    </div>
                    {showSched && (
                      <div className="mt-4 bg-slate-950/60 border border-slate-800 rounded-xl p-4">
                        <div className="text-xs font-semibold text-white mb-2">Schedule all remaining platforms</div>
                        <div className="flex gap-2 items-center">
                          <input type="datetime-local" value={schedAt} onChange={(e) => setSchedAt(e.target.value)} className={input} />
                          <button disabled={!schedAt} onClick={scheduleAll} className="text-xs text-white font-semibold rounded-full px-5 py-2.5 disabled:opacity-40" style={aurora}>Confirm schedule</button>
                        </div>
                        <div className="text-[11px] text-slate-500 mt-2">💡 Best times: {chosen.map((p) => `${p.name} ${p.best}`).join(" · ")}</div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="mt-6 border border-emerald-500/40 bg-emerald-500/5 rounded-2xl p-6 text-center">
                    <div className="text-2xl">🎉</div>
                    <div className="text-emerald-400 font-semibold mt-1">{ads[0]?.status === "Scheduled" ? "Scheduled!" : ads[0]?.status === "Pending approval" ? "Submitted for approval" : `Posted to ${chosen.map((p) => p.name).join(", ")}`}</div>
                    <div className="text-xs text-slate-500 mt-1">(Simulated — live posting activates once platform app reviews are approved)</div>
                    <button onClick={resetWizard} className="mt-4 text-sm border border-slate-700 rounded-full px-5 py-2">Create another ad</button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {view === "campaigns" && (
          <div className="max-w-4xl">
            <h2 className="text-2xl font-bold text-white tracking-tight mb-2">🚀 Launch Campaigns</h2>
            <p className="text-sm text-slate-500 mb-5">Generate a coordinated teaser → launch → follow-up set for a product launch. Costs 2 credits.</p>
            <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-5 mb-6">
              <div className="grid md:grid-cols-3 gap-3">
                <input value={campName} onChange={(e) => setCampName(e.target.value)} placeholder="Product / launch name" className={input} />
                <input value={campBrief} onChange={(e) => setCampBrief(e.target.value)} placeholder="One line: what is it & who's it for" className={`md:col-span-2 ${input}`} />
              </div>
              <button disabled={!campName.trim() || !campBrief.trim() || campBusy || credits < 2} onClick={generateCampaign}
                className="mt-4 text-white text-sm font-semibold rounded-full px-6 py-2.5 disabled:opacity-40" style={aurora}>
                {campBusy ? "Building campaign…" : credits < 2 ? "Needs 2 credits" : "Generate 3-phase campaign (2 credits)"}
              </button>
            </div>
            {campaigns.length === 0 ? <div className="text-sm text-slate-500 border border-dashed border-slate-800 rounded-2xl p-10 text-center">No campaigns yet.</div> :
              campaigns.map((c) => (
                <div key={c.id} className="bg-slate-900/70 border border-slate-800 rounded-2xl p-5 mb-4">
                  <div className="text-white font-semibold mb-3">{c.name}</div>
                  <div className="grid md:grid-cols-3 gap-3">
                    {c.phases.map((ph) => (
                      <div key={ph.label} className="bg-slate-950/60 border border-slate-800 rounded-xl p-3">
                        <div className="flex justify-between items-center"><span className="text-xs font-semibold text-cyan-300">{ph.label}</span><span className="text-[10px] text-slate-500">📅 {ph.date}</span></div>
                        <div className="text-xs text-slate-300 mt-2">{ph.cap}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
          </div>
        )}

        {view === "ads" && (
          <div className="max-w-4xl">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-2xl font-bold text-white tracking-tight">My Ads</h2>
              <input value={adSearch} onChange={(e) => setAdSearch(e.target.value)} placeholder="🔍 Search ads…" className={`${input} w-56`} />
            </div>
            {ads.length === 0 ? <div className="text-sm text-slate-500 border border-dashed border-slate-800 rounded-2xl p-10 text-center">No ads yet — create your first one. ✦</div> :
              ads.filter((a) => a.brief.toLowerCase().includes(adSearch.toLowerCase())).map((a) => (
                <div key={a.id} className="bg-slate-900/70 border border-slate-800 rounded-xl p-4 mb-3 flex justify-between items-center">
                  <div className="flex items-center gap-3">
                    <button onClick={() => setAds((l) => l.map((x) => x.id === a.id ? { ...x, fav: !x.fav } : x))} className={`text-lg ${a.fav ? "text-amber-400" : "text-slate-700"}`}>★</button>
                    <div>
                      <div className="text-sm text-white">{a.brief.slice(0, 70)}{a.brief.length > 70 ? "…" : ""}</div>
                      <div className="text-[11px] text-slate-500 mt-1">{a.platforms.join(" · ")} · {a.at}{a.schedAt ? ` · 🗓 ${new Date(a.schedAt).toLocaleString()}` : ""}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs ${a.status === "Posted" ? "text-emerald-400" : a.status === "Scheduled" ? "text-cyan-300" : a.status === "Pending approval" ? "text-amber-400" : "text-slate-400"}`}>{a.status}</span>
                    {a.status === "Pending approval" && (
                      <button onClick={() => setAds((l) => l.map((x) => x.id === a.id ? { ...x, status: "Posted" } : x))} className="text-xs border border-emerald-500/40 text-emerald-400 rounded-full px-3 py-1">✓ Approve & post</button>
                    )}
                    <button onClick={() => setAds((l) => l.filter((x) => x.id !== a.id))} className="text-xs text-slate-600 hover:text-rose-400">✕</button>
                  </div>
                </div>
              ))}
          </div>
        )}

        {view === "products" && (
          <div className="max-w-4xl">
            <h2 className="text-2xl font-bold text-white tracking-tight mb-2">📦 Product Library</h2>
            <p className="text-sm text-slate-500 mb-5">Saved products — regenerate ads anytime without re-typing details. Save products from the Create Ad brief.</p>
            {products.length === 0 ? <div className="text-sm text-slate-500 border border-dashed border-slate-800 rounded-2xl p-10 text-center">No products saved yet.</div> :
              <div className="grid md:grid-cols-2 gap-4">
                {products.map((pr) => (
                  <div key={pr.id} className="bg-slate-900/70 border border-slate-800 rounded-2xl p-4 flex gap-3">
                    {pr.image ? <img src={pr.image} alt={pr.name} className="w-16 h-16 rounded-lg object-cover border border-slate-700" /> :
                      <div className="w-16 h-16 rounded-lg flex items-center justify-center text-2xl bg-slate-950 border border-slate-800">{pickEmoji(pr.brief)}</div>}
                    <div className="flex-1">
                      <div className="text-sm font-semibold text-white">{pr.name}</div>
                      <div className="text-[11px] text-slate-500 mt-0.5">{(pr.brief || "").slice(0, 60)}…</div>
                      <div className="flex gap-2 mt-2">
                        <button onClick={() => loadProduct(pr)} className="text-[11px] text-white font-semibold rounded-full px-3 py-1" style={aurora}>✦ New ad</button>
                        <button onClick={() => setProducts((l) => l.filter((x) => x.id !== pr.id))} className="text-[11px] border border-slate-700 rounded-full px-3 py-1 text-slate-400">Delete</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>}
          </div>
        )}

        {view === "schedule" && (
          <div className="max-w-4xl">
            <h2 className="text-2xl font-bold text-white tracking-tight mb-2">🗓 Schedule</h2>
            <p className="text-sm text-slate-500 mb-5">Upcoming scheduled posts. Best posting times: {PLATFORMS.map((p) => `${p.tag} ${p.best}`).join(" · ")}</p>
            {scheduled.length === 0 ? <div className="text-sm text-slate-500 border border-dashed border-slate-800 rounded-2xl p-10 text-center">Nothing scheduled — use 🗓 Schedule on a generated ad.</div> :
              [...scheduled].sort((a, b) => new Date(a.at) - new Date(b.at)).map((s) => (
                <div key={s.id} className="bg-slate-900/70 border border-slate-800 rounded-xl p-4 mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-slate-950" style={{ background: s.color }}>{s.tag}</span>
                    <div>
                      <div className="text-sm text-white">{s.brief.slice(0, 50)}</div>
                      <div className="text-[11px] text-cyan-300 mt-0.5">📅 {new Date(s.at).toLocaleString()} · {s.platform}</div>
                    </div>
                  </div>
                  <button onClick={() => setScheduled((l) => l.filter((x) => x.id !== s.id))} className="text-xs text-slate-600 hover:text-rose-400">Cancel</button>
                </div>
              ))}
          </div>
        )}

        {view === "brand" && (
          <div className="max-w-2xl">
            <h2 className="text-2xl font-bold text-white tracking-tight mb-5">Brand Kit</h2>
            <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-6 space-y-6">
              <div>
                <div className="text-sm text-white mb-2">Logo</div>
                <div className="flex items-center gap-4">
                  {brandLogo ? <img src={brandLogo} alt="logo" className="w-20 h-20 rounded-xl object-cover border border-slate-700" /> :
                    <div className="w-20 h-20 rounded-xl flex items-center justify-center text-2xl font-bold text-white" style={aurora}>{(company || "A")[0].toUpperCase()}</div>}
                  <div className="flex flex-col gap-2">
                    <label className="text-xs text-white font-semibold rounded-full px-4 py-2 cursor-pointer text-center" style={aurora}>
                      ⬆ Upload logo
                      <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files && e.target.files[0]; if (!f) return; const r = new FileReader(); r.onload = () => setBrandLogo(r.result); r.readAsDataURL(f); }} />
                    </label>
                    {brandLogo && <button onClick={() => setBrandLogo(null)} className="text-xs text-rose-400 border border-rose-500/40 rounded-full px-4 py-1.5">Remove</button>}
                  </div>
                </div>
              </div>
              <div>
                <div className="text-sm text-white mb-2">Primary brand color <span className="text-xs text-slate-500">(buttons & accents)</span></div>
                <div className="flex gap-2 items-center">
                  {["#7c3aed", "#06b6d4", "#f43f5e", "#f59e0b", "#10b981", "#3b82f6", "#e2e8f0"].map((c) => (
                    <button key={c} onClick={() => setBrandColor(c)} className={`w-10 h-10 rounded-lg border-2 ${brandColor === c ? "border-white" : "border-slate-700"}`} style={{ background: c }} />
                  ))}
                  <input type="color" value={brandColor} onChange={(e) => setBrandColor(e.target.value)} className="w-10 h-10 rounded-lg bg-transparent border border-slate-700 cursor-pointer" />
                </div>
              </div>
              <div>
                <div className="text-sm text-white mb-2">Tagline</div>
                <input value={brandTagline} onChange={(e) => setBrandTagline(e.target.value)} placeholder='e.g. "Hydration, reinvented."' className={`w-full ${input}`} />
                <div className="text-[11px] text-slate-500 mt-1">💡 Short and memorable — woven into copy and shown on the ad image.</div>
              </div>
              <div className="text-xs text-slate-500 border-t border-slate-800 pt-4">These items appear as optional tick-boxes in every new ad.</div>
            </div>
          </div>
        )}

        {view === "analytics" && (
          <div className="max-w-4xl">
            <h2 className="text-2xl font-bold text-white tracking-tight mb-5">Analytics</h2>
            <div className="grid md:grid-cols-4 gap-4">
              {[["Ads created", ads.length], ["Credits used", planCredits - credits], ["Scheduled", scheduled.length], ["Campaigns", campaigns.length]].map(([k, v]) => (
                <div key={k} className="bg-slate-900/70 border border-slate-800 rounded-2xl p-5"><div className="text-xs text-slate-500">{k}</div><div className="text-3xl font-bold text-white mt-1">{v}</div></div>
              ))}
            </div>
            <div className="text-xs text-slate-500 mt-4">Post-performance metrics (reach, clicks) appear here once direct posting is live.</div>
          </div>
        )}

        {view === "settings" && (
          <div className="max-w-2xl">
            <h2 className="text-2xl font-bold text-white tracking-tight mb-5">Settings</h2>
            <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-6 mb-4">
              <div className="text-sm font-semibold text-white mb-3">🔗 Platform connections</div>
              {PLATFORMS.map((p) => (
                <div key={p.id} className="flex items-center justify-between py-2 border-b border-slate-800/60 last:border-0">
                  <div className="flex items-center gap-2">
                    <span className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-slate-950" style={{ background: p.color }}>{p.tag}</span>
                    <span className="text-sm text-white">{p.name}</span>
                  </div>
                  {connections[p.id] ? (
                    <div className="flex gap-2 items-center">
                      <span className="text-xs text-emerald-400">● Connected</span>
                      <button onClick={() => setConnections((c) => ({ ...c, [p.id]: false }))} className="text-[11px] border border-slate-700 rounded-full px-3 py-1 text-slate-400">Disconnect</button>
                    </div>
                  ) : (
                    <button onClick={() => connect(p.id)} className="text-xs border border-slate-700 rounded-full px-4 py-1.5 hover:border-violet-500">{connecting === p.id ? "Authorizing…" : "Connect"}</button>
                  )}
                </div>
              ))}
            </div>
            <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-6 mb-4">
              <div className="text-sm font-semibold text-white mb-2">💳 Plan & billing</div>
              <div className="text-xs text-slate-400">Current plan: <span className="text-cyan-300">{TIER_DATA[tier].name}</span> · {TERMS[term].label} · {TIER_DATA[tier].quota}</div>
              <div className="flex gap-2 mt-3">
                <button onClick={() => setPage("pricing")} className="text-xs border border-slate-700 rounded-full px-4 py-1.5">Change plan</button>
                <button onClick={() => setCredits((c) => c + 10)} className="text-xs text-white font-semibold rounded-full px-4 py-1.5" style={aurora}>＋ Buy 10 credits — $9</button>
              </div>
              <div className="text-[11px] text-slate-500 mt-3">Invoices: <span className="text-slate-400">Jun 2026 · May 2026 · Apr 2026</span> (simulated — Stripe billing portal plugs in here)</div>
            </div>
            <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-6">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold text-white">📋 Require approval before posting</div>
                  <div className="text-[11px] text-slate-500 mt-1">Editors submit ads for review; an Admin approves in My Ads before anything is posted.</div>
                </div>
                <button onClick={() => setRequireApproval(!requireApproval)} className={`w-12 h-6 rounded-full relative transition ${requireApproval ? "" : "bg-slate-700"}`} style={requireApproval ? aurora : {}}>
                  <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${requireApproval ? "left-6" : "left-0.5"}`} />
                </button>
              </div>
            </div>
          </div>
        )}

        {view === "admin" && (
          <div className="max-w-4xl">
            <div className="flex items-center gap-3 mb-4"><h2 className="text-2xl font-bold text-white tracking-tight">Admin</h2><Pill>Admin view</Pill></div>
            <div className="flex gap-2 mb-6 border-b border-slate-800 pb-3">
              {[["overview", "📊 Overview"], ["users", "👥 Users"], ["models", "🧠 Models"], ["moderation", "🛡️ Moderation"]].map(([id, label]) => (
                <button key={id} onClick={() => setAdminTab(id)} className={`text-sm rounded-full px-4 py-1.5 border ${adminTab === id ? "border-violet-500 text-white bg-violet-500/10" : "border-slate-800 text-slate-400 hover:text-white"}`}>{label}</button>
              ))}
            </div>

            {adminTab === "overview" && (
              <div>
                <div className="grid md:grid-cols-4 gap-4 mb-6">
                  {[["Companies", 128], ["Active subs", 97], ["MRR", "$9,430"], ["Flagged today", flagged.length]].map(([k, v]) => (
                    <div key={k} className="bg-slate-900/70 border border-slate-800 rounded-2xl p-4"><div className="text-xs text-slate-500">{k}</div><div className="text-2xl font-bold text-white mt-1">{v}</div></div>
                  ))}
                </div>
                <div className="grid md:grid-cols-3 gap-4">
                  {[["Team members", teamUsers.filter((u) => u.status === "Active").length], ["Active image model", `${modelCfg.image.active} · ${modelCfg.image.tiers[modelCfg.image.active].credits}cr`], ["Active video model", `${modelCfg.video.active} · ${modelCfg.video.tiers[modelCfg.video.active].credits}cr`]].map(([k, v]) => (
                    <div key={k} className="bg-slate-900/70 border border-slate-800 rounded-2xl p-4"><div className="text-xs text-slate-500">{k}</div><div className="text-lg font-bold text-white mt-1 capitalize">{v}</div></div>
                  ))}
                </div>
              </div>
            )}

            {adminTab === "users" && (
              <div>
                <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-5 mb-5">
                  <div className="text-sm font-semibold text-white">Add a team member</div>
                  <div className="text-[11px] text-slate-500 mt-1">💡 Allocate people who can create and post ads. They'll receive an email invite to set their password.</div>
                  <div className="grid md:grid-cols-4 gap-3 mt-4">
                    <input value={nuName} onChange={(e) => setNuName(e.target.value)} placeholder="Full name" className={input} />
                    <input value={nuEmail} onChange={(e) => setNuEmail(e.target.value)} placeholder="Work email" className={input} />
                    <select value={nuRole} onChange={(e) => setNuRole(e.target.value)} className={`${input} text-slate-300`}>
                      <option>Admin</option><option>Editor</option><option>Poster</option>
                    </select>
                    <button disabled={!nuName.trim() || !/.+@.+\..+/.test(nuEmail) || teamUsers.some((u) => u.email === nuEmail.trim())}
                      onClick={() => { setTeamUsers((u) => [...u, { id: Date.now(), name: nuName.trim(), email: nuEmail.trim(), role: nuRole, status: "Invited", at: new Date().toLocaleDateString() }]); setNuName(""); setNuEmail(""); setNuRole("Editor"); }}
                      className="text-white text-sm font-semibold rounded-full py-2.5 disabled:opacity-40" style={aurora}>＋ Create user</button>
                  </div>
                  <div className="flex gap-4 mt-3 text-[11px] text-slate-500">
                    <span><b className="text-slate-300">Admin</b> — everything incl. billing & users</span>
                    <span><b className="text-slate-300">Editor</b> — create, refine & submit ads</span>
                    <span><b className="text-slate-300">Poster</b> — post approved ads only</span>
                  </div>
                </div>
                {teamUsers.length === 0 ? <div className="text-sm text-slate-500 border border-dashed border-slate-800 rounded-xl p-8 text-center">No team members yet — add the first one above.</div> :
                  teamUsers.map((u) => (
                    <div key={u.id} className="bg-slate-900/70 border border-slate-800 rounded-xl p-4 mb-2 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold text-white" style={aurora}>{u.name.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase()}</span>
                        <div>
                          <div className="text-sm text-white">{u.name} <span className="text-[10px] text-violet-300 border border-violet-500/40 rounded-full px-2 py-0.5 ml-1">{u.role}</span></div>
                          <div className="text-[11px] text-slate-500">{u.email} · added {u.at}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`text-xs ${u.status === "Active" ? "text-emerald-400" : u.status === "Invited" ? "text-amber-400" : "text-slate-500"}`}>● {u.status}</span>
                        {u.status === "Invited" && <button onClick={() => setTeamUsers((l) => l.map((x) => x.id === u.id ? { ...x, status: "Active" } : x))} className="text-xs border border-emerald-500/40 text-emerald-400 rounded-full px-3 py-1">Mark active</button>}
                        {u.status !== "Suspended" ? (
                          <button onClick={() => setTeamUsers((l) => l.map((x) => x.id === u.id ? { ...x, status: "Suspended" } : x))} className="text-xs border border-amber-500/40 text-amber-400 rounded-full px-3 py-1">Suspend</button>
                        ) : (
                          <button onClick={() => setTeamUsers((l) => l.map((x) => x.id === u.id ? { ...x, status: "Active" } : x))} className="text-xs border border-emerald-500/40 text-emerald-400 rounded-full px-3 py-1">Reactivate</button>
                        )}
                        <button onClick={() => setTeamUsers((l) => l.filter((x) => x.id !== u.id))} className="text-xs border border-rose-500/40 text-rose-400 rounded-full px-3 py-1">Remove</button>
                      </div>
                    </div>
                  ))}
              </div>
            )}

            {adminTab === "models" && (
              <div>
                <h3 className="text-white font-semibold mb-3">🧠 Generation models <span className="text-xs text-slate-500 font-normal">(via OpenRouter — model IDs plug into the backend)</span></h3>
                <div className="grid md:grid-cols-2 gap-4">
                  {[["image", "🖼️ Image models"], ["video", "🎬 Video models"]].map(([kind, title]) => (
                    <div key={kind} className="bg-slate-900/70 border border-slate-800 rounded-2xl p-5">
                      <div className="text-sm font-semibold text-white mb-3">{title}</div>
                      {["low", "medium", "best"].map((t) => (
                        <div key={t} className={`rounded-xl border p-3 mb-2 ${modelCfg[kind].active === t ? "border-violet-500 bg-violet-500/10" : "border-slate-800"}`}>
                          <div className="flex items-center justify-between">
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input type="radio" name={`${kind}-tier`} checked={modelCfg[kind].active === t} onChange={() => setModelCfg((m) => ({ ...m, [kind]: { ...m[kind], active: t } }))} />
                              <span className="text-sm text-white capitalize font-semibold">{t}</span>
                              {modelCfg[kind].active === t && <span className="text-[10px] text-violet-300 border border-violet-500/40 rounded-full px-2 py-0.5">Active</span>}
                            </label>
                            <div className="flex items-center gap-1">
                              <input type="number" min="1" value={modelCfg[kind].tiers[t].credits}
                                onChange={(e) => setModelCfg((m) => ({ ...m, [kind]: { ...m[kind], tiers: { ...m[kind].tiers, [t]: { ...m[kind].tiers[t], credits: Math.max(1, parseInt(e.target.value) || 1) } } } }))}
                                className="w-14 bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-sm text-center focus:outline-none focus:border-violet-500" />
                              <span className="text-[10px] text-slate-500">credits</span>
                            </div>
                          </div>
                          <input value={modelCfg[kind].tiers[t].model}
                            onChange={(e) => setModelCfg((m) => ({ ...m, [kind]: { ...m[kind], tiers: { ...m[kind].tiers, [t]: { ...m[kind].tiers[t], model: e.target.value } } } }))}
                            className="mt-2 w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-violet-500" placeholder="openrouter/model-id" />
                        </div>
                      ))}
                      <div className="text-[11px] text-slate-500 mt-1">Active tier sets what customers get — and what each generation costs them.</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {adminTab === "moderation" && (
              <div>
                <h3 className="text-white font-semibold mb-3">⚙️ Guardrails</h3>
                <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-5 mb-4">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-white">Product defaults</span>
                    <span className="text-[10px] text-slate-400 border border-slate-700 rounded-full px-2 py-0.5">🔒 Locked — always active</span>
                  </div>
                  <div className="text-[11px] text-slate-500 mt-1">Built into every input and output: hate & harassment, violence, sexual content, illegal goods, deepfakes / real people, third-party IP, plus AI moderation on all generated content and platform-policy compliance checks on captions.</div>
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {BLOCKLIST.map((w) => <span key={w} className="text-[11px] text-slate-400 bg-slate-950 border border-slate-800 rounded-full px-2.5 py-1">🔒 {w}</span>)}
                  </div>
                </div>
                <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-5 mb-6">
                  <div className="text-sm font-semibold text-white">Your custom guardrails</div>
                  <div className="text-[11px] text-slate-500 mt-1">💡 Add words or phrases to block on top of the defaults — competitor names, restricted categories in your market, or banned claims.</div>
                  <div className="flex gap-2 mt-3">
                    <input value={newRule} onChange={(e) => setNewRule(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter" && newRule.trim()) { setCustomRules((r) => [...r, newRule.trim().toLowerCase()]); setNewRule(""); } }}
                      placeholder='e.g. "miracle cure" or a competitor name' className={`flex-1 ${input}`} />
                    <button disabled={!newRule.trim() || customRules.includes(newRule.trim().toLowerCase())}
                      onClick={() => { setCustomRules((r) => [...r, newRule.trim().toLowerCase()]); setNewRule(""); }}
                      className="text-white text-sm font-semibold rounded-full px-5 disabled:opacity-40" style={aurora}>＋ Add rule</button>
                  </div>
                  {customRules.length === 0 ? <div className="text-[11px] text-slate-600 mt-3">No custom rules yet.</div> :
                    <div className="flex flex-wrap gap-1.5 mt-3">
                      {customRules.map((w) => (
                        <span key={w} className="text-[11px] text-cyan-300 bg-cyan-400/5 border border-cyan-400/30 rounded-full px-2.5 py-1 flex items-center gap-1.5">
                          {w}<button onClick={() => setCustomRules((r) => r.filter((x) => x !== w))} className="text-slate-500 hover:text-rose-400">✕</button>
                        </span>
                      ))}
                    </div>}
                </div>
                <h3 className="text-white font-semibold mb-3">🛡️ Flagged content queue</h3>
                {flagged.length === 0 ? <div className="text-sm text-slate-500 border border-dashed border-slate-800 rounded-xl p-6 text-center">No flagged content. Try a prohibited word (e.g. "weapon") in an ad brief to see the guardrails fire.</div> :
                  flagged.map((f, i) => (
                    <div key={i} className="border border-rose-500/30 bg-rose-500/5 rounded-xl p-4 mb-2 flex justify-between items-center">
                      <div><div className="text-sm text-white">{f.company} · <span className="text-rose-400">matched "{f.term}"</span></div><div className="text-xs text-slate-500 mt-1">"{f.text.slice(0, 80)}" · {f.at}</div></div>
                      <div className="flex gap-2"><button className="text-xs border border-slate-700 rounded-full px-3 py-1">Dismiss</button><button className="text-xs border border-rose-500/50 text-rose-400 rounded-full px-3 py-1">Suspend company</button></div>
                    </div>
                  ))}
              </div>
            )}
          </div>
        )}

        {view !== "create" && busy && (
          <button onClick={() => setView("create")} className="fixed bottom-5 right-5 flex items-center gap-2 text-xs text-white rounded-full px-4 py-2.5 shadow-lg" style={aurora}>
            <span className="animate-pulse">✦</span> Generating your ad… <span className="underline">view</span>
          </button>
        )}
        {view !== "create" && !busy && results && !posted && (
          <button onClick={() => setView("create")} className="fixed bottom-5 right-5 flex items-center gap-2 text-xs text-white border border-violet-500/60 bg-slate-900 rounded-full px-4 py-2.5 shadow-lg">
            ✅ Ad ready to review → resume
          </button>
        )}
      </div>
    </div>
  );
}
