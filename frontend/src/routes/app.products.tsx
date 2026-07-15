import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell, EmptyState, Field, Input } from "@/components/app-shell";
import { api, type ProductOut } from "@/lib/api";

export const Route = createFileRoute("/app/products")({
  component: Products,
  head: () => ({ meta: [{ title: "Product Library — NivaAd" }] }),
});

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function Products() {
  const navigate = useNavigate();
  const [products, setProducts] = useState<ProductOut[] | null>(null);
  const [err, setErr] = useState("");

  // Add-product form state
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [audience, setAudience] = useState("");
  const [offer, setOffer] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    try {
      setProducts(await api("/products"));
    } catch (e: any) {
      setErr(e.message || "Could not load products");
    }
  }
  useEffect(() => { load(); }, []);

  async function remove(id: string) {
    setProducts((cur) => cur?.filter((p) => p.id !== id) ?? cur);
    try { await api(`/products/${id}`, { method: "DELETE" }); } catch { load(); }
  }

  function newAdFrom(p: ProductOut) {
    sessionStorage.setItem("nivaad_prefill_product", JSON.stringify(p));
    navigate({ to: "/app" });
  }

  async function handlePhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setImage(await fileToDataUrl(f));
  }

  function resetForm() {
    setName(""); setDescription(""); setAudience(""); setOffer(""); setImage(null); setErr("");
  }

  async function submitForm(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true); setErr("");
    try {
      const created = await api("/products", { method: "POST", body: { name, description, audience, offer, image } });
      setProducts((cur) => (cur ? [created, ...cur] : [created]));
      resetForm();
      setShowForm(false);
    } catch (e: any) {
      setErr(e.message || "Could not save product");
    }
    setSaving(false);
  }

  return (
    <AppShell eyebrow="Library" title="Product Library">
      <div className="mb-6 flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">Saved products — regenerate ads anytime without re-typing details.</p>
        <button onClick={() => setShowForm((v) => !v)} className="shrink-0 rounded-full bg-gold-gradient px-4 py-2 text-xs font-semibold text-background shadow-[var(--shadow-gold)]">
          {showForm ? "✕ Cancel" : "＋ Add product"}
        </button>
      </div>

      {showForm && (
        <form onSubmit={submitForm} className="mb-6 rounded-2xl border border-border bg-card/60 p-5 grid gap-4 md:grid-cols-2">
          <Field label="Product name *">
            <Input placeholder="e.g. AquaGlow Smart Bottle" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Target audience">
            <Input placeholder="e.g. fitness-focused professionals, 25-40" value={audience} onChange={(e) => setAudience(e.target.value)} />
          </Field>
          <div className="md:col-span-2">
            <Field label="Description">
              <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)}
                className="w-full rounded-lg border border-input bg-input/40 p-2.5 text-sm text-foreground placeholder:text-muted-foreground/70 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                placeholder="What makes this product special?" />
            </Field>
          </div>
          <Field label="Offer / promotion">
            <Input placeholder="e.g. 20% off launch week" value={offer} onChange={(e) => setOffer(e.target.value)} />
          </Field>
          <Field label="Photo (optional)">
            <input type="file" accept="image/*" onChange={handlePhoto} className="text-xs text-muted-foreground" />
          </Field>
          {err && <div className="md:col-span-2 text-xs text-destructive">{err}</div>}
          <div className="md:col-span-2 flex gap-2">
            <button type="submit" disabled={!name.trim() || saving} className="rounded-full bg-gold-gradient px-5 py-2 text-xs font-semibold text-background disabled:opacity-50">
              {saving ? "Saving…" : "Save product"}
            </button>
          </div>
        </form>
      )}

      {!showForm && err && <div className="mb-4 text-xs text-destructive">{err}</div>}

      {products === null ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : products.length === 0 ? (
        <EmptyState>No products saved yet — click "＋ Add product" above, or save one from the Create Ad brief.</EmptyState>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {products.map((p) => (
            <div key={p.id} className="flex gap-3 rounded-2xl border border-border bg-card/60 p-4">
              {p.image_url ? (
                <img src={p.image_url} alt={p.name} className="h-16 w-16 shrink-0 rounded-lg object-cover border border-border" />
              ) : (
                <div className="h-16 w-16 shrink-0 rounded-lg border border-border bg-background/60 grid place-items-center text-2xl">🛍️</div>
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-foreground">{p.name}</div>
                <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{p.description}</div>
                <div className="mt-2 flex gap-2">
                  <button onClick={() => newAdFrom(p)} className="rounded-full bg-gold-gradient px-3 py-1 text-[11px] font-semibold text-background">✦ New ad</button>
                  <button onClick={() => remove(p.id)} className="rounded-full border border-border px-3 py-1 text-[11px] text-muted-foreground hover:border-destructive/40 hover:text-destructive">Delete</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </AppShell>
  );
}
