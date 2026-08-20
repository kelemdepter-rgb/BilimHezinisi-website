import { SITE_CACHE_PREFIX } from "@/lib/pwa/constants";
import { forgetOfflineBooks } from "@/lib/pwa/offline-books";

/**
 * Measuring and clearing what the site has stored on the device.
 *
 * A reader on a 32 GB phone with a full camera roll needs to be able to see
 * the number and get the space back, which is why this is a plain page
 * control and not something buried in browser settings.
 *
 * The total is summed from the caches themselves rather than taken from
 * navigator.storage.estimate(): the estimate covers the whole origin, is
 * padded by the browser on purpose, and would report a number the button
 * cannot actually free.
 */

/** Every cache this site created — the spellcheck dictionary included. */
async function ownCacheNames(): Promise<string[]> {
  if (typeof caches === "undefined") return [];
  try {
    return (await caches.keys()).filter((name) => name.startsWith(SITE_CACHE_PREFIX));
  } catch {
    return [];
  }
}

/** Bytes of one stored response, without decoding a body we do not need. */
async function entrySize(response: Response): Promise<number> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > 0) return declared;
  try {
    return (await response.blob()).size;
  } catch {
    return 0;
  }
}

export type StorageUsage = { bytes: number; entries: number };

export async function measureStorage(): Promise<StorageUsage> {
  let bytes = 0;
  let entries = 0;
  for (const name of await ownCacheNames()) {
    try {
      const cache = await caches.open(name);
      const keys = await cache.keys();
      entries += keys.length;
      const sizes = await Promise.all(
        keys.map(async (key) => {
          const hit = await cache.match(key);
          return hit ? entrySize(hit) : 0;
        }),
      );
      for (const size of sizes) bytes += size;
    } catch {
      // A cache that vanished mid-count contributes nothing, which is right.
    }
  }
  return { bytes, entries };
}

/**
 * Empty everything, then ask the worker to precache the offline page again —
 * without it the site would quietly lose its only offline fallback until the
 * next time the worker happens to reinstall.
 */
export async function clearStorage(): Promise<void> {
  for (const name of await ownCacheNames()) {
    try {
      await caches.delete(name);
    } catch {
      // Already gone.
    }
  }
  forgetOfflineBooks();
  try {
    navigator.serviceWorker?.controller?.postMessage({ type: "PRECACHE" });
  } catch {
    // No worker in charge: nothing to precache into, and nothing to fix.
  }
}

/** «2.4 MB» — Latin digits, because that is how the rest of the site shows sizes. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}
