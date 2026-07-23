/** RequirementChecklist — Option B
 * Shows a compact live checklist of required fields above a primary
 * action button. Each item turns green with a checkmark as the user
 * fills it in. When all items are met the list disappears cleanly.
 */

type CheckItem = {
  label: string;
  met: boolean;
};

export function RequirementChecklist({ items }: { items: CheckItem[] }) {
  const unmet = items.filter((i) => !i.met);
  if (unmet.length === 0) return null; // all met — hide the list

  return (
    <div className="mb-3 rounded-xl border border-amber-500/20 bg-amber-500/5 px-3.5 py-3">
      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.15em] text-amber-400/80">
        Required before continuing
      </div>
      <ul className="space-y-1">
        {items.map((item) => (
          <li key={item.label} className="flex items-center gap-2 text-[11px]">
            <span className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border text-[8px] font-bold transition-all duration-200 ${
              item.met
                ? "border-emerald-500 bg-emerald-500/20 text-emerald-400"
                : "border-amber-500/50 bg-amber-500/10 text-amber-400"
            }`}>
              {item.met ? "✓" : "!"}
            </span>
            <span className={item.met ? "text-emerald-400 line-through opacity-60" : "text-amber-300/90"}>
              {item.label}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
