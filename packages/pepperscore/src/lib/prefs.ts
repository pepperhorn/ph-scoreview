import type { FileSettings } from './file-state';
import type { TabView } from './tab/tab-parts';

// No runtime imports: validation/api.mjs loads this module in Node.
export const MIN_BPM = 30, MAX_BPM = 240;
/** The reader's BPM control range; saved and source tempos outside it are clamped. */
export const clampBpm = (bpm: number) => Math.max(MIN_BPM, Math.min(MAX_BPM, bpm));
export const TAB_VIEW_NAMES: readonly TabView[] = ['notation', 'tab', 'both'];
/** Standard guitar tuning EADGBE as open-string MIDI, low to high (tab/fret-assign.ts STANDARD_TUNING). */
export const STANDARD_TAB_TUNING: readonly number[] = [40, 45, 50, 55, 59, 64];
export const MAX_CAPO = 12;
export const validTabView = (view: unknown): view is TabView => TAB_VIEW_NAMES.includes(view as TabView);
export const MIN_TAB_STRINGS = 4, MAX_TAB_STRINGS = 8;
/** A usable TAB tuning: 4 to 8 open strings (bass to extended-range guitar), MIDI 0-127. */
export const validTabTuning = (tuning: unknown): tuning is number[] => Array.isArray(tuning) && tuning.length >= MIN_TAB_STRINGS && tuning.length <= MAX_TAB_STRINGS && tuning.every(pitch => Number.isInteger(pitch) && pitch >= 0 && pitch <= 127);
export const validCapo = (capo: unknown): capo is number => Number.isInteger(capo) && (capo as number) >= 0 && (capo as number) <= MAX_CAPO;
/** A capo as a whole fret 0-12 (fractions round; anything not a number is no capo). */
export const clampCapo = (capo: unknown): number => typeof capo === 'number' && Number.isFinite(capo) ? Math.max(0, Math.min(MAX_CAPO, Math.round(capo))) : 0;

/** Explicit bars per line (`barsPerLine`) range; Auto is capped separately (render.ts AUTO_BAR_CAP). */
export const BARS_PER_LINE_MIN = 1;
export const BARS_PER_LINE_MAX = 8;
/** Round and clamp an explicit bar count into range. */
export const clampBarsPerLine = (value: number) => Math.max(BARS_PER_LINE_MIN, Math.min(BARS_PER_LINE_MAX, Math.round(value)));

/** Reader settings; `zoom` is the score's explicit stave scale, or null for the device default (see stave-scale.ts). */
export type Prefs = FileSettings & { zoom: number | null };
export const defaults: Prefs = { mode: 'portrait', notationFont: 'Bravura', barsPerLine: 'auto', overlap: 1, names: false, chordSymbols: false, inferChordSymbols: false, counts: false, subdivisions: false, annotationFont: 'Sans', bpm: 96, zoom: null, semitones: 0, scorePitch: 'written', keyFlip: false, tabView: 'notation', tabTuning: [...STANDARD_TAB_TUNING], capo: 0 };

/** Saved global prefs, repaired. Zoom is per score (score-db), so a legacy global zoom is ignored. */
export function sanitizeSavedPrefs(raw: unknown): Prefs {
  const { zoom: _legacyZoom, ...saved } = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const next = { ...defaults, ...saved, zoom: null } as Prefs;
  if (typeof next.barsPerLine === 'number') next.barsPerLine = Number.isFinite(next.barsPerLine) ? clampBarsPerLine(next.barsPerLine) : 'auto';
  else if (next.barsPerLine !== 'auto') next.barsPerLine = 'auto';
  if (!Number.isInteger(next.semitones)) next.semitones = 0;
  next.semitones = Math.max(-12, Math.min(12, next.semitones));
  if (!['written', 'concert'].includes(next.scorePitch)) next.scorePitch = 'written';
  if (typeof next.keyFlip !== 'boolean') next.keyFlip = false;
  if (!['Sans', 'Serif', 'Mono'].includes(next.annotationFont)) next.annotationFont = 'Sans';
  if (!validTabView(next.tabView)) next.tabView = 'notation';
  next.tabTuning = validTabTuning(next.tabTuning) ? [...next.tabTuning] : [...STANDARD_TAB_TUNING];
  next.capo = clampCapo(next.capo);
  if (!Number.isFinite(next.bpm)) next.bpm = defaults.bpm;
  next.bpm = clampBpm(next.bpm);
  return next;
}

/** Initial reader settings a host passes as `settings` (spec names). Changing a key in the prop re-applies that key. */
export type PepperScoreSettings = Partial<{
  noteNames: boolean; chordSymbols: boolean; inferChords: boolean; beatCounts: boolean; subdivisions: boolean;
  musicFont: 'Bravura' | 'Petaluma'; staveFont: 'Sans' | 'Serif' | 'Mono';
  /** 'auto', or 1-8 bars per line in Vertical view. Without a zoom, an explicit count also sets the stave size: that many bars fill the width. */
  barsPerLine: 'auto' | number;
  /** Explicit stave scale (clamped to the slider range when applied), or null for the device default. */
  zoom: number | null;
  semitones: number; concert: boolean; overlap: number;
  /** Which staves guitar parts show: `'notation'` (default), `'tab'` or `'both'`. */
  tabView: TabView;
  /** Open-string MIDI pitches of generated TAB, low to high (default EADGBE, [40, 45, 50, 55, 59, 64]). */
  tabTuning: number[];
  /** Capo fret 0-12 of generated TAB; frets are relative to it. */
  capo: number;
  /** Initial tempo, 30-240 BPM (a score's own tempo otherwise). */
  bpm: number;
  /** Spell a transposed view in the enharmonic key (F# major shown as Gb major). */
  keyFlip: boolean;
}>;
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, Math.round(value)));

export function settingsToPrefs(settings: PepperScoreSettings = {}): Partial<Prefs> {
  const out: Partial<Prefs> = {};
  if (settings.noteNames !== undefined) out.names = settings.noteNames;
  if (settings.chordSymbols !== undefined) out.chordSymbols = settings.chordSymbols;
  if (settings.inferChords !== undefined) out.inferChordSymbols = settings.inferChords;
  if (settings.beatCounts !== undefined) out.counts = settings.beatCounts;
  if (settings.subdivisions !== undefined) out.subdivisions = settings.subdivisions;
  if (settings.musicFont !== undefined) out.notationFont = settings.musicFont;
  if (settings.staveFont !== undefined) out.annotationFont = settings.staveFont;
  if (settings.barsPerLine !== undefined) out.barsPerLine = settings.barsPerLine === 'auto' ? 'auto' : clampBarsPerLine(settings.barsPerLine);
  if (settings.zoom !== undefined) out.zoom = settings.zoom;
  if (settings.semitones !== undefined) out.semitones = clamp(settings.semitones, -12, 12);
  if (settings.concert !== undefined) out.scorePitch = settings.concert ? 'concert' : 'written';
  if (settings.overlap !== undefined) out.overlap = clamp(settings.overlap, 0, 3);
  if (settings.tabView !== undefined && validTabView(settings.tabView)) out.tabView = settings.tabView;
  if (settings.tabTuning !== undefined && validTabTuning(settings.tabTuning)) out.tabTuning = [...settings.tabTuning];
  if (settings.capo !== undefined && Number.isFinite(settings.capo)) out.capo = clampCapo(settings.capo);
  if (settings.bpm !== undefined && Number.isFinite(settings.bpm)) out.bpm = clampBpm(Math.round(settings.bpm));
  if (settings.keyFlip !== undefined) out.keyFlip = !!settings.keyFlip;
  return out;
}
export const viewToMode = (view: 'vertical' | 'endless'): Prefs['mode'] => view === 'endless' ? 'landscape' : 'portrait';
