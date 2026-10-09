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
