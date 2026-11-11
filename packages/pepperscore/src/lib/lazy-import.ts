/**
 * The address of a lazy chunk the page has already asked for, found by file-name stem. Vite adds a
 * `<link rel="modulepreload">` for it, and browsers list it in resource timing; Vite and native-ESM hosts keep the
 * stem in the hashed name (`PdfOverlay-AbC123.js`). Returns undefined when it cannot be found (another bundler
 * may name chunks `42.js`) and never throws.
 */
export function requestedChunkUrl(stem: string): string | undefined {
  try {
    const pattern = new RegExp(`/${stem}[^/?#]*\\.m?js(?:[?#]|$)`);
    const names = [
      ...Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="modulepreload"]'), link => link.href),
      ...performance.getEntriesByType('resource').map(entry => entry.name),
    ];
    return names.find(name => pattern.test(name) && !name.includes('recovery='));
  } catch { return undefined; }
}

let attempts = 0;

/**
 * `load()`, and if it fails, once more through a cache-busted address of the same chunk. WebKit keeps a failed
 * module preload in its per-process memory cache, so after a network failure a plain `import()` (and a reload) is
 * answered from that failure without any request; a different query string is a different resource and reaches
 * the server. Each attempt gets its own query, because browsers cache a failed module per address.
 *
 * Supported: Vite and native-ESM hosts, where the chunk keeps its name and the variable `import()` stays native.
 * Best effort elsewhere: if the chunk's address cannot be found (Webpack names chunks `42.js`), or the retry fails
 * for any reason, the ORIGINAL error is thrown and the caller shows its usual error. The helper adds no exceptions of
 * its own.
 */
export async function importWithRecovery<T>(load: () => Promise<T>, stem: string): Promise<T> {
  try { return await load(); }
  catch (error) {
    const url = requestedChunkUrl(stem);
    if (!url) throw error;
    try {
      // webpackIgnore keeps the import native (no "critical dependency" warning, no empty context) in Webpack hosts.
      return await import(/* @vite-ignore */ /* webpackIgnore: true */ `${url}${url.includes('?') ? '&' : '?'}recovery=${Date.now().toString(36)}-${++attempts}`) as T;
    } catch { throw error; }
  }
}
