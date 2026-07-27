import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell, EmptyState, Field, Input } from "@/components/app-shell";
import { RequirementChecklist } from "@/components/requirement-checklist";
import { api, type ProductOut } from "@/lib/api";

export const Route = createFileRoute("/app/products")({
  component: Products,
  head: () => ({ meta: [{ title: "Product Library — NivaSpark" }] }),
});

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

type EditState = {
  id: string;
  name: string;
  description: string;
  audience: string;
  offer: string;
  image: string | null;       // new base64 image to upload
  currentImageUrl: string | null;  // existing image URL
  clearImage: boolean;
};

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

  // Edit state
  const [editing, setEditing] = useState<EditState | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editErr, setEditErr] = useState("");

  async function load() {
    try {
      setProducts(await api("/products"));
    } catch (e: any) {
      setErr(e.message || "Could not load products");
    }
  }
  useEffect(() => { load(); }, []);

  async function remove(id: string) {
    if (!confirm("Delete this product? This cannot be undone.")) return;
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
    e.target.value = "";
  }

  async function handleEditPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    if (!editing) return;
    const f = e.target.files?.[0];
    if (!f) return;
    const dataUrl = await fileToDataUrl(f);
    setEditing({ ...editing, image: dataUrl, clearImage: false });
    e.target.value = "";
  }

  function resetForm() {
    setName(""); setDescription(""); setAudience(""); setOffer(""); setImage(null); setErr("");
  }

  function startEdit(p: ProductOut) {
    setEditing({
      id: p.id,
      name: p.name,
      description: p.description,
      audience: p.audience,
      offer: p.offer,
      image: null,
      currentImageUrl: p.image_url,
      clearImage: false,
    });
    setEditErr("");
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

  async function submitEdit() {
    if (!editing || !editing.name.trim()) { setEditErr("Product name is required"); return; }
    setEditSaving(true); setEditErr("");
    try {
      const updated: ProductOut = await api(`/products/${editing.id}`, {
        method: "PUT",
        body: {
          name: editing.name.trim(),
          description: editing.description,
          audience: editing.audience,
          offer: editing.offer,
          image: editing.image ?? undefined,
          clear_image: editing.clearImage,
        },
      });
      setProducts((cur) => cur?.map((p) => p.id === updated.id ? updated : p) ?? cur);
      setEditing(null);
    } catch (e: any) {
      setEditErr(e.message || "Could not update product");
    }
    setEditSaving(false);
  }

  // Preview image for edit form — new upload takes priority, then existing url, then null
  const editPreview = editing
    ? (editing.clearImage ? null : (editing.image ?? editing.currentImageUrl))
    : null;

  return (
    <AppShell eyebrow="Library" title="Product Library">
      <div className="mb-6 flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">Saved products — regenerate ads anytime without re-typing details.</p>
        <button
          onClick={() => { setShowForm((v) => !v); setEditing(null); }}
          className="shrink-0 rounded-full bg-gold-gradient px-4 py-2 text-xs font-semibold text-background shadow-[var(--shadow-gold)]"
        >
          {showForm ? "✕ Cancel" : "＋ Add product"}
        </button>
      </div>

      {/* ── Add product form ── */}
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
              <textarea
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full rounded-lg border border-input bg-input/40 p-2.5 text-sm text-foreground placeholder:text-muted-foreground/70 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                placeholder="What makes this product special?"
              />
            </Field>
          </div>
          <Field label="Offer / promotion">
            <Input placeholder="e.g. 20% off launch week" value={offer} onChange={(e) => setOffer(e.target.value)} />
          </Field>
          <Field label="Photo (optional)">
            <input type="file" accept="image/*" onChange={handlePhoto} className="text-xs text-muted-foreground" />
          </Field>
          {err && <div className="md:col-span-2 text-xs text-destructive">{err}</div>}
          <div className="md:col-span-2">
            <RequirementChecklist items={[
              { label: "Product name", met: !!name.trim() },
            ]} />
          </div>
          <div className="md:col-span-2 flex gap-2">
            <button type="submit" disabled={!name.trim() || saving} className="rounded-full bg-gold-gradient px-5 py-2 text-xs font-semibold text-background disabled:opacity-50">
              {saving ? "Saving…" : "Save product"}
            </button>
          </div>
        </form>
      )}

      {!showForm && err && <div className="mb-4 text-xs text-destructive">{err}</div>}

      {/* ── Product list ── */}
      {products === null ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : products.length === 0 ? (
        <EmptyState>No products saved yet — click "＋ Add product" above, or save one from the Create Ad brief.</EmptyState>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {products.map((p) => (
            <div key={p.id} className="rounded-2xl border border-border bg-card/60 overflow-hidden">
              {/* ── Card row ── */}
              <div className="flex items-stretch">
                {/* Thumbnail */}
                <div className="w-[125px] shrink-0 relative bg-muted/20 flex items-center justify-center">
                  {p.image_url ? (
                    <img src={p.image_url} alt={p.name} className="absolute inset-0 w-full h-full object-cover" />
                  ) : (
                    <span className="text-2xl opacity-30">🛍️</span>
                  )}
                </div>
                {/* Content */}
                <div className="min-w-0 flex-1 px-4 py-3">
                  <div className="truncate text-sm font-semibold text-foreground">{p.name}</div>
                  <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{p.description}</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      onClick={() => newAdFrom(p)}
                      className="rounded-full bg-gold-gradient px-3 py-1 text-[11px] font-semibold text-background"
                    >
                      ✦ New ad
                    </button>
                    <button
                      onClick={() => editing?.id === p.id ? setEditing(null) : startEdit(p)}
                      className="rounded-full border border-border px-3 py-1 text-[11px] text-muted-foreground hover:border-primary/40 hover:text-foreground transition-colors"
                    >
                      {editing?.id === p.id ? "Cancel" : "Edit"}
                    </button>
                    <button
                      onClick={() => remove(p.id)}
                      className="rounded-full border border-border px-3 py-1 text-[11px] text-muted-foreground hover:border-destructive/40 hover:text-destructive transition-colors"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>

              {/* ── Inline edit form ── */}
              {editing?.id === p.id && (
                <div className="border-t border-border/50 bg-muted/10 px-4 py-4">
                  <div className="grid gap-3 md:grid-cols-2">
                    <Field label="Product name *">
                      <Input
                        value={editing.name}
                        onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                        placeholder="Product name"
                      />
                    </Field>
                    <Field label="Target audience">
                      <Input
                        value={editing.audience}
                        onChange={(e) => setEditing({ ...editing, audience: e.target.value })}
                        placeholder="e.g. fitness-focused professionals"
                      />
                    </Field>
                    <div className="md:col-span-2">
                      <Field label="Description">
                        <textarea
                          rows={3}
                          value={editing.description}
                          onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                          className="w-full rounded-lg border border-input bg-input/40 p-2.5 text-sm text-foreground placeholder:text-muted-foreground/70 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                          placeholder="What makes this product special?"
                        />
                      </Field>
                    </div>
                    <Field label="Offer / promotion">
                      <Input
                        value={editing.offer}
                        onChange={(e) => setEditing({ ...editing, offer: e.target.value })}
                        placeholder="e.g. 20% off launch week"
                      />
                    </Field>
                    <Field label="Photo">
                      <div className="flex items-center gap-3">
                        {editPreview ? (
                          <img src={editPreview} alt="preview" className="h-12 w-12 rounded-lg object-cover border border-border shrink-0" />
                        ) : (
                          <div className="h-12 w-12 rounded-lg border border-dashed border-border bg-muted/20 flex items-center justify-center shrink-0">
                            <span className="text-lg opacity-30">🛍️</span>
                          </div>
                        )}
                        <div className="flex flex-col gap-1">
                          <label className="cursor-pointer rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground">
                            {editPreview ? "Replace photo" : "Upload photo"}
                            <input type="file" accept="image/*" onChange={handleEditPhoto} className="hidden" />
                          </label>
                          {editPreview && (
                            <button
                              type="button"
                              onClick={() => setEditing({ ...editing, image: null, clearImage: true })}
                              className="rounded-full border border-destructive/30 px-2.5 py-1 text-[11px] text-destructive/70 hover:text-destructive hover:border-destructive transition-colors text-left"
                            >
                              Remove photo
                            </button>
                          )}
                        </div>
                      </div>
                    </Field>
                  </div>
                  {editErr && <div className="mt-2 text-xs text-destructive">{editErr}</div>}
                  <div className="mt-3 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={submitEdit}
                      disabled={editSaving || !editing.name.trim()}
                      className="rounded-full bg-gold-gradient px-4 py-1.5 text-xs font-semibold text-background disabled:opacity-50"
                    >
                      {editSaving ? "Saving…" : "Save changes"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditing(null)}
                      className="rounded-full border border-border px-4 py-1.5 text-xs text-muted-foreground hover:text-foreground"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </AppShell>
  );
}
