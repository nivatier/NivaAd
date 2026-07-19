/**
 * NovaHint — a small inline clickable Nova face that triggers the mascot
 * to visit and explain the field it's placed next to.
 *
 * Usage:
 *   <label>Text Model <NovaHint hintKey="field:text-model" /></label>
 *
 * The `hintKey` must match an entry in the developer's assistant hints list.
 * When clicked, the mascot walks over to this element and explains it.
 */
export function NovaHint({ hintKey }: { hintKey: string }) {
  return (
    <span
      data-robot-hint-key={hintKey}
      role="button"
      tabIndex={0}
      title="Ask Nova about this"
      aria-label="Ask Nova about this field"
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") e.currentTarget.click(); }}
      className="inline-flex items-center justify-center w-4 h-4 ml-1.5 rounded-full cursor-pointer select-none align-middle relative top-[-1px] transition-transform hover:scale-110 active:scale-95"
      style={{ verticalAlign: "middle" }}
    >
      <svg viewBox="0 0 20 20" className="w-full h-full" style={{ display: "block" }}>
        <defs>
          <radialGradient id={`nova-face-${hintKey}`} cx="0.38" cy="0.3" r="1">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="60%" stopColor="#e8e8f0" />
            <stop offset="100%" stopColor="#c8c8d4" />
          </radialGradient>
        </defs>
        {/* head */}
        <circle cx="10" cy="10" r="9" fill={`url(#nova-face-${hintKey})`} />
        {/* antenna */}
        <line x1="10" y1="1.5" x2="10" y2="4" stroke="#9a9aaa" strokeWidth="1.2" strokeLinecap="round" />
        <circle cx="10" cy="1.2" r="1" fill="#60a5fa" />
        {/* screen face */}
        <rect x="5" y="6" width="10" height="7" rx="3" fill="#16181d" />
        {/* eyes */}
        <ellipse cx="8" cy="9.4" rx="1.1" ry="1.4" fill="#7dd3fc" />
        <ellipse cx="12" cy="9.4" rx="1.1" ry="1.4" fill="#7dd3fc" />
        {/* smile */}
        <path d="M7.8 11.5 Q10 13 12.2 11.5" stroke="#7dd3fc" strokeWidth="0.8" fill="none" strokeLinecap="round" />
      </svg>
    </span>
  );
}
