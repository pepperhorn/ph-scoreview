import { afterEach, describe, expect, it, vi } from 'vitest';
import { importWithRecovery, requestedChunkUrl } from './lazy-import';

const stubPage = (links: string[], resources: string[] = []) => {
  vi.stubGlobal('document', { querySelectorAll: () => links.map(href => ({ href })) });
  vi.stubGlobal('performance', { getEntriesByType: () => resources.map(name => ({ name })) });
};
afterEach(() => vi.unstubAllGlobals());

describe('lazy chunk recovery', () => {
  it('finds a Vite-named chunk by its stem, from preload links or resource timing, ignoring earlier recovery attempts', () => {
    stubPage(['https://x.test/_astro/Other-1.js'], ['https://x.test/_astro/PdfOverlay-Ab12.zz9.js?recovery=a-1', 'https://x.test/_astro/PdfOverlay-Ab12.zz9.js']);
    expect(requestedChunkUrl('PdfOverlay')).toBe('https://x.test/_astro/PdfOverlay-Ab12.zz9.js');
  });

  it('degrades to the original error when the chunk name is not discoverable (Webpack numbers chunks)', async () => {
    stubPage(['https://x.test/42.index.js'], ['https://x.test/42.index.js']);
    const failure = new TypeError('Loading chunk 42 failed');
    await expect(importWithRecovery(() => Promise.reject(failure), 'PdfOverlay')).rejects.toBe(failure);
  });

  it('degrades to the original error when the page cannot be inspected', async () => {
    vi.stubGlobal('document', { querySelectorAll: () => { throw new Error('no DOM'); } });
    const failure = new Error('primary failed');
    await expect(importWithRecovery(() => Promise.reject(failure), 'PdfOverlay')).rejects.toBe(failure);
    vi.unstubAllGlobals();
    // No document at all (server render, a worker).
    await expect(importWithRecovery(() => Promise.reject(failure), 'PdfOverlay')).rejects.toBe(failure);
  });

  it('degrades to the original error when the retry fails too', async () => {
    // A module that throws when evaluated: the address is found and requested, and the retry fails.
    stubPage(['data:text/javascript,throw new Error("still down");//PdfOverlay-gone.js']);
    const failure = new Error('primary failed');
    await expect(importWithRecovery(() => Promise.reject(failure), 'PdfOverlay')).rejects.toBe(failure);
  });

  it('returns the primary result untouched when it succeeds', async () => {
    const module = { default: 1 };
    await expect(importWithRecovery(() => Promise.resolve(module), 'PdfOverlay')).resolves.toBe(module);
  });

  it('retries once through a unique query string when the chunk is discoverable', async () => {
    // The trailing comment keeps the appended ?recovery=... query harmless; the stem is what the lookup matches.
    stubPage(['data:text/javascript,export default "recovered";//PdfOverlay-Ab12.js']);
    const loaded = await importWithRecovery(() => Promise.reject(new Error('primary failed')), 'PdfOverlay') as { default: string };
    expect(loaded.default).toBe('recovered');
  });
});
