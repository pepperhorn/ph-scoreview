const MUSIC_FONTS = [['Bravura', 'fonts/Bravura.woff2'], ['Petaluma', 'fonts/Petaluma.woff2'], ['Petaluma Script', 'fonts/PetalumaScript.woff2']] as const;

/**
 * SMuFL fonts for Verovio's text glyphs (tempo marks, dynamics) and Petaluma Script stave text, loaded from the asset
 * base instead of hardcoded CSS. Font family names are page-global, so the first instance's base wins.
 */
export function ensureMusicFonts(base: string): void {
  if (typeof document === 'undefined' || document.head.querySelector('style[data-pepperscore-fonts]')) return;
  const style = document.createElement('style');
  style.dataset.pepperscoreFonts = base;
  style.textContent = MUSIC_FONTS.map(([family, path]) => `@font-face{font-family:'${family}';src:url('${new URL(path, base).href}') format('woff2');font-display:block}`).join('\n');
  document.head.appendChild(style);
}
