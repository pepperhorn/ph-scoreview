/**
 * `font-display: block` on purpose: these faces draw SMuFL code points (Private Use Area). A fallback font has no
 * glyphs there, so `swap` would flash boxes or blanks where dynamics and tempo glyphs belong, and the reader measures
 * that text right after drawing (render.ts measureGeometry), so it should carry the music font's metrics. Verovio's
 * own layout does not depend on the page font (it lays out with its built-in glyph metrics in the worker); the
 * notation itself is SVG paths. Instead of `swap`, the faces start downloading at mount (preloadMusicFont) and a
 * draw waits briefly for them (musicFontsReady), so blocking costs nothing in practice. UI text uses Poppins/system
 * fonts, not these faces.
 */
const MUSIC_FONTS = [['Bravura', 'fonts/Bravura.woff2'], ['Petaluma', 'fonts/Petaluma.woff2'], ['Petaluma Script', 'fonts/PetalumaScript.woff2']] as const;

/**
 * SMuFL fonts for Verovio's text glyphs (tempo marks, dynamics) and Petaluma Script stave text, loaded from the asset
 * base instead of hardcoded CSS. Font family names are page-global, so the first instance's base wins.
 */
export function ensureMusicFonts(base: string, onError?: (failed: string) => void): void {
  if (typeof document === 'undefined' || document.head.querySelector('style[data-pepperscore-fonts]')) return;
  const style = document.createElement('style');
  style.dataset.pepperscoreFonts = base;
  style.textContent = MUSIC_FONTS.map(([family, path]) => `@font-face{font-family:'${family}';src:url('${new URL(path, base).href}') format('woff2');font-display:block}`).join('\n');
  document.head.appendChild(style);
  // Faces load on first use; a 404 surfaces as a FontFaceSet loadingerror listing the failed faces.
  if (!onError || !document.fonts?.addEventListener) return;
  const families = new Map<string, string>(MUSIC_FONTS.map(([family, path]) => [family, path]));
  document.fonts.addEventListener('loadingerror', event => {
    const failed = (event as FontFaceSetLoadEvent).fontfaces.map(face => families.get(face.family.replace(/^["']|["']$/g, ''))).filter(path => path !== undefined);
    if (failed.length) onError(failed.join(', '));
  });
}

/** The faces a notation font uses: Petaluma pairs with Petaluma Script stave text; Bravura is always the fallback. */
const facesFor = (font: string | undefined) => font === 'Petaluma' ? ['Petaluma', 'Petaluma Script', 'Bravura'] : ['Bravura'];

/** Start downloading a notation font's faces now (after ensureMusicFonts declared them), rather than on first use. */
export function preloadMusicFont(font: string | undefined): void {
  if (typeof document === 'undefined' || !document.fonts?.load) return;
  for (const family of facesFor(font)) document.fonts.load(`1em '${family}'`).catch(() => { /* reported by loadingerror */ });
}

/** Resolves when a notation font's faces have loaded (or failed), or after `timeoutMs`, whichever is first; never rejects. */
export function musicFontsReady(font: string | undefined, timeoutMs: number): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts?.load) return Promise.resolve();
  const families = facesFor(font);
  if (families.every(family => { try { return document.fonts.check(`1em '${family}'`); } catch { return true; } })) return Promise.resolve();
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    Promise.all(families.map(family => document.fonts.load(`1em '${family}'`).catch(() => []))).then(() => undefined),
    new Promise<void>(resolve => { timer = setTimeout(resolve, timeoutMs); }),
  ]).finally(() => clearTimeout(timer));
}
