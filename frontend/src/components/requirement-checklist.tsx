/** RequirementChecklist — Tooltip variant
 *
 * Wraps the generate button. When all requirements are met the tooltip
 * never appears and the button behaves normally. When anything is unmet,
 * hovering (or touching on mobile) over the button shows a floating
 * checklist that lists every requirement with ✓ / ! indicators.
 *
 * The component renders its children directly so the button's own
 * disabled state, onClick, className etc. are untouched — this is purely
 * a tooltip layer, not a replacement for the disabled guard.
 */

import { useState, useRef, useEffect, useCallback } from "react";

type CheckItem = {
  label: string;
  met: boolean;
};

type Position = { top: number; left: number; transformX: string };

export function RequirementChecklist({
  items,
  children,
}: {
  items: CheckItem[];
  children: React.ReactNode;
}) {
  const allMet = items.every((i) => i.met);
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState<Position>({ top: 0, left: 0, transformX: "-50%" });
  const wrapRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const reposition = useCallback(() => {
    if (!wrapRef.current) return;
    const r = wrapRef.current.getBoundingClientRect();
    const tipW = 280;
    const midX = r.left + r.width / 2;
    // Keep tooltip within viewport horizontally
    const clampedLeft = Math.min(
      Math.max(midX, tipW / 2 + 8),
      window.innerWidth - tipW / 2 - 8,
    );
    setPos({
      top: r.top - 8, // 8px gap above the button
      left: clampedLeft,
      transformX: `calc(-50% + ${clampedLeft - midX}px)`,
    });
  }, []);

  const show = useCallback(() => {
    if (allMet) return;
    reposition();
    setVisible(true);
  }, [allMet, reposition]);

  const hide = useCallback(() => setVisible(false), []);

  // Hide on scroll / resize
  useEffect(() => {
    if (!visible) return;
    const off = () => setVisible(false);
    window.addEventListener("scroll", off, { passive: true });
    window.addEventListener("resize", off, { passive: true });
    return () => {
      window.removeEventListener("scroll", off);
      window.removeEventListener("resize", off);
    };
  }, [visible]);

  return (
    <>
      <div
        ref={wrapRef}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onTouchStart={show}
        className="relative inline-block"
      >
        {children}
      </div>

      {/* Portal-style fixed tooltip — renders above the button */}
      {visible && !allMet && (
        <div
          ref={tooltipRef}
          role="tooltip"
          style={{
            position: "fixed",
            top: pos.top,
            left: pos.left,
            transform: `translate(${pos.transformX}, -100%)`,
            width: 280,
            zIndex: 9999,
            pointerEvents: "none",
          }}
        >
          {/* Arrow */}
          <div className="flex justify-center">
            <div
              style={{
                width: 10, height: 6,
                background: "oklch(0.2 0.015 270)",
                clipPath: "polygon(50% 100%, 0 0, 100% 0)",
              }}
            />
          </div>
          <div
            className="rounded-xl border px-3.5 py-3 shadow-2xl"
            style={{
              background: "oklch(0.14 0.012 270)",
              borderColor: "oklch(1 0 0 / 0.10)",
              boxShadow: "0 8px 32px oklch(0 0 0 / 0.5), inset 0 1px 0 oklch(1 0 0 / 0.06)",
            }}
          >
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-white/50">
              Required before continuing
            </div>
            <ul className="space-y-1.5">
              {items.map((item) => (
                <li key={item.label} className="flex items-center gap-2 text-[11px]">
                  <span
                    className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border text-[8px] font-bold transition-colors duration-150 ${
                      item.met
                        ? "border-emerald-500 bg-emerald-500/20 text-emerald-400"
                        : "border-amber-500/60 bg-amber-500/10 text-amber-400"
                    }`}
                  >
                    {item.met ? "✓" : "!"}
                  </span>
                  <span className={item.met ? "text-emerald-400/70 line-through" : "text-white/80"}>
                    {item.label}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
