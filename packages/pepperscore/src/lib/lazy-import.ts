/**
 * The address of a lazy chunk the page has already asked for, found by file name. Vite adds a
 * `<link rel="modulepreload">` for it; browsers also list it in resource timing. Hashed names keep their stem.
 */
export function requestedChunkUrl(stem: string): string | undefined {
  const pattern = new RegExp(`/${stem}[^/?#]*\\.m?js(?:[?#]|$)`);
  const names = [
    ...Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="modulepreload"]'), link => link.href),
    ...performance.getEntriesByType('resource').map(entry => entry.name),
  ];
  return names.find(name => pattern.test(name) && !name.includes('recovery='));
}

/**
 * `load()`, and if it fails once more through a cache-busted address. WebKit keeps a failed module preload
 * in its per-process memory cache, so after a network failure a plain `import()` (and a reload) is answered
 * from that failure without any request. A different query string is a different resource, so one retry
 * reaches the server (each attempt gets its own, because browsers cache a failed module per address). Where no address can be found, or the retry fails too, the original error is thrown.
 */
let attempts = 0;
export async function importWithRecovery<T>(load: () => Promise<T>, stem: string): Promise<T> {
  try { return await load(); }
  catch (error) {
    const url = requestedChunkUrl(stem);
    if (!url) throw error;
    try { return await import(/* @vite-ignore */ `${url}${url.includes('?') ? '&' : '?'}recovery=${Date.now().toString(36)}-${++attempts}`) as T; }
    catch { throw error; }
  }
}
