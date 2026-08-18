/**
 * Fetch a spellcheck artifact through the Cache Storage API, so the dictionary
 * arrives once per device rather than once per visit.
 *
 * A cache miss is not an error and neither is a missing cache: some browsers
 * refuse `caches` in private mode, and the plain network copy works fine. Lives
 * in its own module so this path is testable without spawning a Worker.
 */

async function readThrough<T>(
  url: string,
  cacheName: string,
  read: (response: Response) => Promise<T>,
): Promise<{ value: T; fromCache: boolean }> {
  try {
    const cache = await caches.open(cacheName);
    const hit = await cache.match(url);
    if (hit) return { value: await read(hit), fromCache: true };

    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: ${response.status}`);
    // Store a clone: the body can only be read once.
    await cache.put(url, response.clone());
    return { value: await read(response), fromCache: false };
  } catch (error) {
    // A failed network fetch must still surface; only cache trouble falls back.
    if (error instanceof Error && error.message.startsWith(url)) throw error;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: ${response.status}`);
    return { value: await read(response), fromCache: false };
  }
}

export async function fetchCached(
  url: string,
  cacheName: string,
): Promise<{ text: string; fromCache: boolean }> {
  const { value, fromCache } = await readThrough(url, cacheName, (response) => response.text());
  return { text: value, fromCache };
}

/**
 * The same, for the dictionary itself.
 *
 * The artifact is binary — one byte per Uyghur letter — so reading it as text
 * would decode it as UTF-8 and destroy it. Kept as an ArrayBuffer all the way
 * into `unpackDictionary`, which never builds a JavaScript string at all.
 */
export async function fetchCachedBytes(
  url: string,
  cacheName: string,
): Promise<{ bytes: ArrayBuffer; fromCache: boolean }> {
  const { value, fromCache } = await readThrough(url, cacheName, (response) => response.arrayBuffer());
  return { bytes: value, fromCache };
}
