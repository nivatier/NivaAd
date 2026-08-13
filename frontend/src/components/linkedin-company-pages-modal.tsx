/**
 * LinkedInCompanyPagesModal
 *
 * Shown after the LinkedIn Company Page OAuth callback redirects back
 * to /app/connections?pick_pages=1. Fetches the list of Company Pages
 * the connected token can admin, lets the user pick one, then saves
 * the selection via POST /connections/linkedin_company/select.
 *
 * Uses Radix Dialog (SSR-safe, same pattern as every other modal in
 * the app — never raw createPortal).
 */
import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

type Page = {
  org_urn: string;
  name: string;
  vanity_name: string;
};

type Props = {
  onClose: () => void;
  onConnected: (pageName: string) => void;
};

export function LinkedInCompanyPagesModal({ onClose, onConnected }: Props) {
  const [pages, setPages] = useState<Page[] | null>(null);
  const [selected, setSelected] = useState<string>(""); // org_urn
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    api("/connections/linkedin_company/pages")
      .then((res: { pages: Page[] }) => {
        setPages(res.pages);
        if (res.pages.length === 1) {
          // Auto-select if only one page
          setSelected(res.pages[0].org_urn);
        }
      })
      .catch((e: any) => setErr(e.message || "Could not load your LinkedIn Pages"))
      .finally(() => setLoading(false));
  }, []);

  async function confirm() {
    if (!selected || !pages) return;
    const page = pages.find((p) => p.org_urn === selected);
    if (!page) return;
    setSaving(true);
    setErr("");
    try {
      await api("/connections/linkedin_company/select", {
        method: "POST",
        body: { org_urn: page.org_urn, page_name: page.name },
      });
      onConnected(page.name);
    } catch (e: any) {
      setErr(e.message || "Could not save selection");
      setSaving(false);
    }
  }

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay
          className="fixed inset-0 z-50"
          style={{ background: "oklch(0 0 0 / 0.55)", backdropFilter: "blur(4px)" }}
        />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border p-6 shadow-[var(--shadow-glass-full)]"
          style={{ background: "var(--card)" }}
        >
          {/* Header */}
          <div className="mb-1 flex items-center gap-2">
            <div className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-sky-700 to-sky-900 text-xs font-bold text-white">
              IN
            </div>
            <Dialog.Title className="text-sm font-semibold text-foreground">
              Select a LinkedIn Company Page
            </Dialog.Title>
          </div>
          <Dialog.Description className="mb-4 text-xs text-muted-foreground">
            Choose which Company Page NivaSpark should post to on your behalf.
          </Dialog.Description>

          {/* Body */}
          {loading ? (
            <div className="py-6 text-center text-xs text-muted-foreground">
              Loading your pages…
            </div>
          ) : err && !pages ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {err}
            </div>
          ) : pages && pages.length === 0 ? (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-400">
              No Company Pages found for this LinkedIn account. Make sure you are an admin of at
              least one LinkedIn Page, then try connecting again.
            </div>
          ) : (
            <div className="space-y-2">
              {pages?.map((page) => {
                const isSelected = selected === page.org_urn;
                return (
                  <button
                    key={page.org_urn}
                    onClick={() => setSelected(page.org_urn)}
                    className="w-full rounded-xl border px-4 py-3 text-left transition-all"
                    style={{
                      background: isSelected
                        ? "oklch(0.66 0.26 305 / 0.10)"
                        : "oklch(1 0 0 / 0.03)",
                      borderColor: isSelected
                        ? "oklch(0.66 0.26 305 / 0.50)"
                        : "var(--border)",
                      boxShadow: isSelected
                        ? "inset 0 1px 0 oklch(1 0 0 / 0.10)"
                        : "inset 0 1px 0 oklch(1 0 0 / 0.05)",
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm font-medium text-foreground">{page.name}</div>
                        {page.vanity_name && (
                          <div className="text-[11px] text-muted-foreground">
                            linkedin.com/company/{page.vanity_name}
                          </div>
                        )}
                      </div>
                      {isSelected && (
                        <span className="text-xs font-semibold text-primary">✓</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {err && pages && (
            <div className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {err}
            </div>
          )}

          {/* Footer */}
          <div className="mt-5 flex items-center justify-end gap-2">
            <button
              onClick={onClose}
              className="rounded-full border border-border px-4 py-2 text-xs text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
            {pages && pages.length > 0 && (
              <button
                disabled={!selected || saving}
                onClick={confirm}
                className="rounded-full bg-gold-gradient px-5 py-2 text-xs font-semibold text-background shadow-[var(--shadow-gold)] disabled:opacity-50"
              >
                {saving ? "Connecting…" : "Connect this page"}
              </button>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
