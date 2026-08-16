/**
 * FacebookPagesModal
 *
 * Shown after the Facebook OAuth callback redirects back to
 * /app/connections?pick_facebook_pages=1.
 *
 * Fetches the list of Facebook Pages the connected token can manage,
 * shows linked Instagram Business account and Threads profile as
 * optional checkboxes, then saves the selection via
 * POST /connections/facebook/select.
 *
 * Uses Radix Dialog — same pattern as LinkedInCompanyPagesModal.
 */
import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

type InstagramAccount = {
  ig_user_id: string;
  username: string;
  name: string;
};

type ThreadsProfile = {
  threads_user_id: string;
  username: string;
  name: string;
};

type Page = {
  page_id: string;
  name: string;
  access_token: string;
  category: string;
  instagram: InstagramAccount | null;
};

type Props = {
  onClose: () => void;
  onConnected: (platforms: string[]) => void;
};

export function FacebookPagesModal({ onClose, onConnected }: Props) {
  const [pages, setPages] = useState<Page[] | null>(null);
  const [threads, setThreads] = useState<ThreadsProfile | null>(null);
  const [selected, setSelected] = useState<string>(""); // page_id
  const [connectInstagram, setConnectInstagram] = useState(true);
  const [connectThreads, setConnectThreads] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    api("/connections/facebook/pages")
      .then((res: { pages: Page[]; threads: ThreadsProfile | null }) => {
        setPages(res.pages);
        setThreads(res.threads);
        if (res.pages.length === 1) {
          setSelected(res.pages[0].page_id);
        }
      })
      .catch((e: any) => setErr(e.message || "Could not load your Facebook Pages"))
      .finally(() => setLoading(false));
  }, []);

  const selectedPage = pages?.find((p) => p.page_id === selected) ?? null;

  async function confirm() {
    if (!selected || !selectedPage) return;
    setSaving(true);
    setErr("");
    try {
      const body: Record<string, unknown> = {
        page_id: selectedPage.page_id,
        page_name: selectedPage.name,
        page_token: selectedPage.access_token,
        connect_instagram: connectInstagram,
        connect_threads: connectThreads,
      };
      if (selectedPage.instagram) {
        body.ig_user_id = selectedPage.instagram.ig_user_id;
        body.ig_username = selectedPage.instagram.username;
      }
      if (threads) {
        body.threads_user_id = threads.threads_user_id;
        body.threads_username = threads.username;
      }
      const res = await api("/connections/facebook/select", {
        method: "POST",
        body,
      });
      onConnected(res.connected ?? ["facebook"]);
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
            <div className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-blue-500 to-blue-700 text-xs font-bold text-white">
              FB
            </div>
            <Dialog.Title className="text-sm font-semibold text-foreground">
              Select a Facebook Page
            </Dialog.Title>
          </div>
          <Dialog.Description className="mb-4 text-xs text-muted-foreground">
            Choose which Facebook Page NivaSpark should post to. If a linked Instagram Business account or Threads profile is detected, you can connect those at the same time.
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
              No Facebook Pages found for this account. Make sure you are an admin of at least one Facebook Page, then try connecting again.
            </div>
          ) : (
            <div className="space-y-2">
              {/* Page list */}
              {pages?.map((page) => {
                const isSelected = selected === page.page_id;
                return (
                  <button
                    key={page.page_id}
                    onClick={() => setSelected(page.page_id)}
                    className="w-full rounded-xl border px-4 py-3 text-left transition-all"
                    style={{
                      background: isSelected
                        ? "oklch(0.55 0.22 250 / 0.10)"
                        : "oklch(1 0 0 / 0.03)",
                      borderColor: isSelected
                        ? "oklch(0.55 0.22 250 / 0.50)"
                        : "var(--border)",
                      boxShadow: isSelected
                        ? "inset 0 1px 0 oklch(1 0 0 / 0.10)"
                        : "inset 0 1px 0 oklch(1 0 0 / 0.05)",
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm font-medium text-foreground">{page.name}</div>
                        {page.category && (
                          <div className="text-[11px] text-muted-foreground">{page.category}</div>
                        )}
                      </div>
                      {isSelected && (
                        <span className="text-xs font-semibold text-primary">✓</span>
                      )}
                    </div>
                  </button>
                );
              })}

              {/* Instagram + Threads checkboxes — only show when a page is selected */}
              {selectedPage && (
                <div className="mt-3 space-y-2 rounded-xl border border-border bg-background/30 p-3">
                  <div className="mb-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                    Also connect
                  </div>

                  {/* Instagram */}
                  {selectedPage.instagram ? (
                    <label className="flex cursor-pointer items-center gap-3">
                      <input
                        type="checkbox"
                        checked={connectInstagram}
                        onChange={(e) => setConnectInstagram(e.target.checked)}
                        className="h-3.5 w-3.5 accent-primary"
                      />
                      <div className="flex items-center gap-2">
                        <div className="grid h-6 w-6 place-items-center rounded-full bg-gradient-to-br from-pink-500 to-orange-400 text-[9px] font-bold text-white">
                          IG
                        </div>
                        <div>
                          <div className="text-xs font-medium text-foreground">
                            Instagram Business
                          </div>
                          {selectedPage.instagram.username && (
                            <div className="text-[11px] text-muted-foreground">
                              @{selectedPage.instagram.username}
                            </div>
                          )}
                        </div>
                      </div>
                    </label>
                  ) : (
                    <div className="flex items-center gap-2 opacity-40">
                      <div className="grid h-6 w-6 place-items-center rounded-full bg-gradient-to-br from-pink-500 to-orange-400 text-[9px] font-bold text-white">
                        IG
                      </div>
                      <div className="text-xs text-muted-foreground">
                        No Instagram Business account linked to this Page
                      </div>
                    </div>
                  )}

                  {/* Threads */}
                  {threads ? (
                    <label className="flex cursor-pointer items-center gap-3">
                      <input
                        type="checkbox"
                        checked={connectThreads}
                        onChange={(e) => setConnectThreads(e.target.checked)}
                        className="h-3.5 w-3.5 accent-primary"
                      />
                      <div className="flex items-center gap-2">
                        <div className="grid h-6 w-6 place-items-center rounded-full bg-gradient-to-br from-neutral-800 to-black text-[9px] font-bold text-white">
                          TH
                        </div>
                        <div>
                          <div className="text-xs font-medium text-foreground">Threads</div>
                          {threads.username && (
                            <div className="text-[11px] text-muted-foreground">
                              @{threads.username}
                            </div>
                          )}
                        </div>
                      </div>
                    </label>
                  ) : (
                    <div className="flex items-center gap-2 opacity-40">
                      <div className="grid h-6 w-6 place-items-center rounded-full bg-gradient-to-br from-neutral-800 to-black text-[9px] font-bold text-white">
                        TH
                      </div>
                      <div className="text-xs text-muted-foreground">
                        No Threads profile found for this account
                      </div>
                    </div>
                  )}
                </div>
              )}
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
                {saving ? "Connecting…" : "Connect"}
              </button>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
