/** Public role names. Each CSS use keeps its original colour as its fallback. */
export const THEME_TOKENS = ['accent', 'accentHover', 'accentWash', 'accentWashStrong', 'backdrop', 'border', 'borderMuted', 'danger', 'focusRing', 'onAccent', 'playback', 'shadow', 'surface', 'surfaceRaised', 'text', 'textFaint', 'textMuted', 'textSecondary', 'warning'] as const;
export type ThemeToken = typeof THEME_TOKENS[number];
export const BAR_ITEM_IDS = ['play', 'stop', 'tempo', 'transpose', 'keyFlip', 'bars', 'viewToggle', 'tab', 'zoom', 'mixer', 'openFile', 'instrumentSwitch', 'octaveTool', 'options', 'noteNames', 'counts', 'chordSymbols', 'pitchColours', 'pdf'] as const;
export type BarItemId = typeof BAR_ITEM_IDS[number];
export type PitchClass = 'C' | 'C#' | 'D' | 'D#' | 'E' | 'F' | 'F#' | 'G' | 'G#' | 'A' | 'A#' | 'B';
export type PitchPalette = Record<PitchClass, string>;
export const CRF_PITCH_COLOURS: PitchPalette = {
  C: '#f86e6e', 'C#': '#f58841', D: '#ffbc57', 'D#': '#b8a334', E: '#fff56d', F: '#b3f888',
  'F#': '#93d154', G: '#6bc6a0', 'G#': '#7ee8df', A: '#88a7f8', 'A#': '#cc97e8', B: '#e277b1',
};
export type PepperScoreSkin = {
  theme?: Partial<Record<ThemeToken, string>>;
  pitchColours?: PitchPalette;
  bar?: BarItemId[];
};
/** Overrides may replace individual palette entries; a skin itself has a complete palette. */
type SkinOverride = Omit<PepperScoreSkin, 'pitchColours'> & { pitchColours?: Partial<PitchPalette> };
export function mergeSkins(base: PepperScoreSkin, ...overrides: SkinOverride[]): PepperScoreSkin {
  const result: PepperScoreSkin = {};
  let palette: Partial<PitchPalette> | undefined;
  for (const skin of [base, ...overrides]) {
    if (skin.theme) result.theme = { ...result.theme, ...skin.theme };
    if (skin.pitchColours) palette = { ...palette, ...skin.pitchColours };
    if (skin.bar) result.bar = [...skin.bar];
  }
  if (palette) {
    if (!completePalette(palette)) throw new TypeError('mergeSkins requires a complete 12-pitch palette; partial overrides need a complete base.');
    result.pitchColours = palette;
  }
  return result;
}
function completePalette(palette: Partial<PitchPalette>): palette is PitchPalette {
  const pitches: PitchClass[] = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  return pitches.every(pitch => typeof palette[pitch] === 'string');
}
export function tokenVariable(token: ThemeToken): string {
  return `--ps-${token.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`;
}
export function skinStyle(skin?: PepperScoreSkin): Record<string, string> {
  const style: Record<string, string> = {};
  for (const token of THEME_TOKENS) {
    const value = skin?.theme?.[token];
    if (typeof value === 'string') style[tokenVariable(token)] = value;
  }
  return style;
}
/** Sort maps, preserve array order. Inline object literals are safe memo inputs. */
export function skinKey(skin?: PepperScoreSkin): string {
  const entries = (map?: object) => map ? Object.entries(map).filter(([, value]) => value !== undefined).sort(([a], [b]) => a.localeCompare(b)) : [];
  return JSON.stringify([entries(skin?.theme), entries(skin?.pitchColours), skin?.bar ?? null]);
}
/** Called after mounting, only in development: resolve host var() values in their real scope. */
export function warnInvalidTheme(root: HTMLElement, skin?: PepperScoreSkin): void {
  const computed = getComputedStyle(root);
  for (const token of THEME_TOKENS) {
    if (skin?.theme?.[token] === undefined) continue;
    const resolved = computed.getPropertyValue(tokenVariable(token)).trim();
    if (!resolved || !CSS.supports('color', resolved)) console.warn(`[pepperscore] Invalid theme colour for ${token}: ${skin.theme[token]}`);
  }
}
