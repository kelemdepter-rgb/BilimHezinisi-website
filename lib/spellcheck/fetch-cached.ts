/**
 * Fetch a spellcheck artifact through the Cache Storage API, so the 424 KB of
 * dictionary arrives once per device rather than once per visit.
 *
 * A cache miss is not an error and neither is a missing cache: some browsers
 * refuse `caches` in private mode, and the plain network copy works fine. Lives
 * in its own module so this path is testable without spawning a Worker.
 */
export async function fetchCached(
  url: string,
  cacheName: string,
): Promise<{ text: string; fromCache: boolean }> {
  try {
    const cache = await caches.open(cacheName);
    const hit = await cache.match(url);
    if (hit) return { text: await hit.text(), fromCache: true };

    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: ${response.status}`);
    // Store a clone: the body can only be read once.
    await cache.put(url, response.clone());
    return { text: await response.text(), fromCache: false };
  } catch (error) {
    // A failed network fetch must still surface; only cache trouble falls back.
    if (error instanceof Error && error.message.startsWith(url)) throw error;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: ${response.status}`);
    return { text: await response.text(), fromCache: false };
  }
}
