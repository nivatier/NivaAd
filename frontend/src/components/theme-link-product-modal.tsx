import { useEffect, useState } from "react";
import { api, type ProductOut } from "@/lib/api";

/** Opens after picking a theme in the Themes Gallery: step 1 asks
 * whether to link a product to the ad this theme will seed, step 2 (if
 * yes) shows the product library to pick from. Either path ends by
 * calling onContinue with the chosen product (or null), which the
 * gallery page uses to build the Create Ad handoff payload. */
export function ThemeLinkProductModal({
  themeName, onCancel, onContinue,
}: {
  themeName: string;
  onCancel: () => void;
  onContinue: (product: ProductOut | null) => void;
}) {
  const [step, setStep] = useState<"ask" | "pick">("ask");
  const [products, setProducts] = useState<ProductOut[] | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (step !== "pick" || products !== null) return;
    api("/products").then(setProducts).catch((e) => setErr(e.message || "Could not load products"));
  }, [step, products]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onCancel}>
      <div className="w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-2xl border border-border bg-background p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div className="text-sm font-semibold text-foreground truncate pr-4">{themeName}</div>
          <button type="button" onClick={onCancel} className="text-muted-foreground hover:text-foreground text-lg leading-none shrink-0">✕</button>
        </div>

        {step === "ask" ? (
          <div>
            <p className="text-xs text-muted-foreground mb-4">Link one of your saved products to this ad? It'll pre-fill the product's name, description, and photo in Create Ad.</p>
            <div className="flex items-center gap-2">
              <button onClick={() => setStep("pick")} className="rounded-full bg-gold-gradient px-4 py-2 text-xs font-semibold text-background">Yes, link a product</button>
              <button onClick={() => onContinue(null)} className="rounded-full border border-border px-4 py-2 text-xs text-foreground hover:border-primary/40">No, skip</button>
            </div>
          </div>
        ) : (
          <div>
            {err && <div className="mb-3 text-xs text-destructive">{err}</div>}
            {products === null && !err && <div className="text-xs text-muted-foreground py-8 text-center">Loading products…</div>}
            {products && products.length === 0 && (
              <div className="text-xs text-muted-foreground py-8 text-center">No saved products yet — add one from the Products page, or skip for now.</div>
            )}
            {products && products.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {products.map((p) => (
                  <button key={p.id} type="button" onClick={() => onContinue(p)}
                    className="rounded-xl border border-border hover:border-primary/50 overflow-hidden text-left transition">
                    {p.image_url ? (
                      <img src={p.image_url} alt={p.name} className="h-28 w-full object-cover" />
                    ) : (
                      <div className="h-28 w-full bg-muted/40 flex items-center justify-center text-2xl">📦</div>
                    )}
                    <div className="p-2">
                      <div className="text-xs font-semibold text-foreground truncate">{p.name}</div>
                      {p.description && <div className="text-[11px] text-muted-foreground line-clamp-2">{p.description}</div>}
                    </div>
                  </button>
                ))}
              </div>
            )}
            <div className="mt-4 flex items-center gap-2">
              <button onClick={() => setStep("ask")} className="rounded-full border border-border px-4 py-2 text-xs text-foreground hover:border-primary/40">Back</button>
              <button onClick={() => onContinue(null)} className="rounded-full border border-border px-4 py-2 text-xs text-muted-foreground hover:border-primary/40">Skip — no product</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
