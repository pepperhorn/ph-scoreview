import type { FileSettings } from './file-state';
import type { TabView } from './tab/tab-parts';
import type { InstrumentId, Level } from './instrument-model';

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

/** Text add-on size steps, smallest first. `rg` (regular) is the default and draws today's size. */
export const ANNOTATION_SIZES = ['xs', 'sm', 'md', 'rg', 'lg', 'xl'] as const;
export type AnnotationSize = typeof ANNOTATION_SIZES[number];
/** Font scale of each step relative to `rg`; lanes, offsets and bar widths scale with it (render.ts). */
export const ANNOTATION_SCALE: Record<AnnotationSize, number> = { xs: .7, sm: .8, md: .9, rg: 1, lg: 1.2, xl: 1.45 };
export const isAnnotationSize = (value: unknown): value is AnnotationSize => ANNOTATION_SIZES.includes(value as AnnotationSize);
/** The text add-ons that take a size (`settings.annotationSizes` keys); inferred chord symbols use `chordSymbols`. */
export type AnnotationKey = 'noteNames' | 'chordSymbols' | 'beatCounts' | 'subdivisions';
/** The `Prefs` / `FileSettings` key holding each add-on's size. */
export const ANNOTATION_SIZE_PREFS = { noteNames: 'namesSize', chordSymbols: 'chordSymbolsSize', beatCounts: 'countsSize', subdivisions: 'subdivisionsSize' } as const satisfies Record<AnnotationKey, keyof FileSettings>;
export type AnnotationSizePref = typeof ANNOTATION_SIZE_PREFS[AnnotationKey];
export const ANNOTATION_SIZE_PREF_KEYS = Object.values(ANNOTATION_SIZE_PREFS) as AnnotationSizePref[];
/** Host sizes per add-on (`settings.annotationSizes`); omitted add-ons keep their current size. */
export type PepperScoreAnnotationSizes = Partial<Record<AnnotationKey, AnnotationSize>>;

/** Reader settings; `zoom` is the score's explicit stave scale, or null for the device default (see stave-scale.ts). */
export type Prefs = FileSettings & { zoom: number | null };
export const defaults: Prefs = { mode: 'portrait', notationFont: 'Bravura', barsPerLine: 'auto', overlap: 1, names: false, chordSymbols: false, inferChordSymbols: false, counts: false, subdivisions: false, annotationFont: 'Sans', namesSize: 'rg', chordSymbolsSize: 'rg', countsSize: 'rg', subdivisionsSize: 'rg', bpm: 96, zoom: null, semitones: 0, scorePitch: 'written', keyFlip: false, tabView: 'notation', tabTuning: [...STANDARD_TAB_TUNING], capo: 0 };

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
  for (const key of ANNOTATION_SIZE_PREF_KEYS) if (!isAnnotationSize(next[key])) next[key] = 'rg';
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
  /**
   * Text size of each add-on: `'xs' | 'sm' | 'md' | 'rg' | 'lg' | 'xl'` (`'rg'`, regular, is the default). Keys:
   * `noteNames`, `chordSymbols` (source and inferred), `beatCounts` (on-beat counts) and `subdivisions` (the e/&/a
   * counts between beats). Only the add-ons given are applied; unknown sizes are ignored.
   */
  annotationSizes: PepperScoreAnnotationSizes;
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
  /**
   * Show the first switchable part (every staff of a grand staff) as this instrument: its sound, clef, written pitch
   * and range. Applied when the score has no saved record, like the other settings.
   */
  instrument: InstrumentId;
  /** Instruments per part, keyed by the 1-based part number as a string (`{ '2': 'trumpet' }`); wins over `instrument`. */
  instruments: Record<string, InstrumentId>;
  /** Range level the switched parts are fitted to: `'beginner'`, `'intermediate'` (default) or `'advanced'`. */
  rangeLevel: Level;
  /** Move phrases outside the instrument's range by an octave (default `true`). */
  autoRange: boolean;
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
  // Flattened to one pref per add-on, so a host changing one size re-applies only that size.
  for (const [key, pref] of Object.entries(ANNOTATION_SIZE_PREFS) as [AnnotationKey, AnnotationSizePref][]) {
    const size = settings.annotationSizes?.[key];
    if (isAnnotationSize(size)) out[pref] = size;
  }
  if (settings.tabView !== undefined && validTabView(settings.tabView)) out.tabView = settings.tabView;
  if (settings.tabTuning !== undefined && validTabTuning(settings.tabTuning)) out.tabTuning = [...settings.tabTuning];
  if (settings.capo !== undefined && Number.isFinite(settings.capo)) out.capo = clampCapo(settings.capo);
  if (settings.bpm !== undefined && Number.isFinite(settings.bpm)) out.bpm = clampBpm(Math.round(settings.bpm));
  if (settings.keyFlip !== undefined) out.keyFlip = !!settings.keyFlip;
  return out;
}
export const viewToMode = (view: 'vertical' | 'endless'): Prefs['mode'] => view === 'endless' ? 'landscape' : 'portrait';
