/**
 * Persistent audio cache using IndexedDB.
 *
 * Cache key = the audio URL itself. Since MinIO generates a new UUID path
 * every time audio is regenerated, the URL changes and the old entry is
 * simply never requested again (orphaned) — no explicit invalidation needed.
 *
 * We do a cleanup pass on mount to prune any stored URLs that are no longer
 * referenced by the current hint list, preventing unbounded growth.
 */

const DB_NAME = "nova-audio-cache";
const DB_VERSION = 1;
const STORE = "audio";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getCachedAudio(url: string): Promise<ArrayBuffer | null> {
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(url);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null; // IndexedDB unavailable (private browsing, etc.) — fall through to network
  }
}

export async function setCachedAudio(url: string, data: ArrayBuffer): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(data, url);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Cache write failure is non-fatal — audio already played
  }
}

/** Prunes any cached URLs not in the provided active set. Call once on mount
 * with the union of all current hint audio_urls + intro_audio_url. */
export async function pruneAudioCache(activeUrls: Set<string>): Promise<void> {
  try {
    const db = await openDB();
    const allKeys: string[] = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).getAllKeys();
      req.onsuccess = () => resolve(req.result as string[]);
      req.onerror = () => reject(req.error);
    });
    const stale = allKeys.filter((k) => !activeUrls.has(k));
    if (stale.length === 0) return;
    const db2 = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db2.transaction(STORE, "readwrite");
      stale.forEach((k) => tx.objectStore(STORE).delete(k));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Pruning is best-effort
  }
}

/** Fetches audio from cache or network, caches the result, and returns a
 * Blob URL ready for use with new Audio(). Caller is responsible for
 * revoking the Blob URL when done (or it can live for the session — the
 * browser frees it on tab close). */
export async function fetchAndCacheAudio(url: string): Promise<string> {
  const cached = await getCachedAudio(url);
  if (cached) {
    return URL.createObjectURL(new Blob([cached], { type: "audio/wav" }));
  }
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Audio fetch failed: ${resp.status}`);
  const buf = await resp.arrayBuffer();
  await setCachedAudio(url, buf);
  return URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
}
