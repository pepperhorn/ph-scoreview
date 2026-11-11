import { isGmSoundfont, type InstrumentId, type Score } from './score';
import { STAVE_SCALE_FLOOR, STAVE_SCALE_MAX, type DeviceClass } from './stave-scale';
import { ANNOTATION_SIZE_PREF_KEYS, BARS_PER_LINE_MAX, BARS_PER_LINE_MIN, clampBpm, clampCapo, isAnnotationSize, MAX_BPM, MIN_BPM, STANDARD_TAB_TUNING, validTabTuning, validTabView, type AnnotationSize } from './prefs';
import type { TabView } from './tab/tab-parts';
import type { PartSound, PartSwitch } from './instrument-view';
import type { Shift } from './range-fit-core';
import { INSTRUMENTS, INSTRUMENT_IDS, LEVELS, type RangeLevel } from './instrument-model';

export type FileSource = { name: string; size: number; sha256: string; format: string };
export type FileSettings = {
  mode: 'portrait' | 'landscape'; notationFont: 'Bravura' | 'Petaluma'; barsPerLine: 'auto' | number;
  pitchColours?: boolean;
  overlap: number; names: boolean; chordSymbols: boolean; inferChordSymbols: boolean;
  counts: boolean; subdivisions: boolean; annotationFont: 'Sans' | 'Serif' | 'Mono'; bpm: number; semitones: number; scorePitch: 'written' | 'concert';
  /** Spell the transposed view in the enharmonic key (F# major shown as Gb major); optional on read, default false. */
  keyFlip: boolean;
  /** Text add-on sizes (prefs.ts ANNOTATION_SIZES); optional on read, default 'rg' (the size every earlier record showed). */
  namesSize: AnnotationSize; chordSymbolsSize: AnnotationSize; countsSize: AnnotationSize; subdivisionsSize: AnnotationSize;
  /** TAB view, tuning (open-string MIDI, low to high) and capo; always written (see `SavedSettings` for reading). */
  tabView: TabView; tabTuning: number[]; capo: number;
};
/** Settings added after version 2 shipped: a record without them (or with unusable ones) leaves the reader's own. */
export type LateSettingKey = 'tabView' | 'tabTuning' | 'capo';
/** Settings as read from a saved record. */
export type SavedSettings = Omit<FileSettings, LateSettingKey> & Partial<Pick<FileSettings, LateSettingKey>>;
/** Saved view: an absolute stave scale and the device class it was chosen on (see stave-scale.ts). */
export type ScoreView = { zoom: number; zoomDevice: DeviceClass };
/**
 * `switch`: the reader's instrument switch of this staff part (instrument-view.ts `PartSwitch`; `octaves` by
 * `ScoreNote.id`). Added after version 2 shipped: optional, and an unusable one is dropped (the part opens as written).
 */
export type PartState = { visible: boolean; instrument: InstrumentId; gmSoundfont?: string; volume?: number; switch?: SavedSwitch };
/** Per-score record (schema: file-state.schema.json). Only settings and hashes, never score content. */
export type FileState = {
  version: 2;
  source: FileSource;
  /** Epoch ms of the last time the score was opened; the store keeps the most recent records. */
  lastOpened: number;
  settings: SavedSettings;
  parts: Record<string, PartState>;
  view?: ScoreView;
  /**
   * The host's instrument settings when the record was saved (instrument-switch-state.ts `hostInstrumentKey`); a host
   * whose settings differ on the next load applies them again over the saved switches. Added after version 2 shipped:
   * optional, absent when the host gave none, dropped when unusable.
   */
  hostInstruments?: string;
};
/** The localStorage v1 record: zoom was a multiplier of the width fit and lived in settings. */
export type FileStateV1 = { version: 1; source: FileSource; settings: FileSettings & { zoom: number }; parts: Record<string, PartState> };

export { clampBpm, MAX_BPM, MIN_BPM };
/** The localStorage key of a v1 record; `prefix` is the reader's persist namespace (score-db keyPrefix). */
export const legacyStorageKey = (hash: string, prefix = 'scoreflow') => `${prefix}-file-v1:${hash}`;
const instruments = new Set<InstrumentId>(['piano', 'guitar', 'bassguitar', 'double-bass', 'drum-kit', 'alto-saxophone', 'tenor-saxophone', 'bari-saxophone', 'flute', 'clarinet', 'trumpet', 'trombone', 'violin', 'viola', 'cello', 'microphone']);
const legacyInstruments: Record<string, InstrumentId> = { bass: 'double-bass', drums: 'drum-kit', saxophone: 'alto-saxophone' };
const roundConstants = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];
const rotate = (value: number, shift: number) => (value >>> shift) | (value << (32 - shift));

/**
 * Incremental SHA-256 in plain JavaScript: it works on plain HTTP LAN origins, where Web Crypto's subtle API is
 * absent. Bytes are hashed as they are given (no padded copy of the whole input).
 */
export class Sha256 {
  private readonly hash = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  private readonly words = new Uint32Array(64);
  private readonly block = new Uint8Array(64);
  private buffered = 0;
  private length = 0;
  update(bytes: Uint8Array): this {
    let offset = 0;
    this.length += bytes.length;
    if (this.buffered) {
      const take = Math.min(64 - this.buffered, bytes.length);
      this.block.set(bytes.subarray(0, take), this.buffered);
      this.buffered += take; offset = take;
      if (this.buffered < 64) return this;
      this.compress(this.block, 0);
      this.buffered = 0;
    }
    for (; offset + 64 <= bytes.length; offset += 64) this.compress(bytes, offset);
    if (offset < bytes.length) { this.block.set(bytes.subarray(offset)); this.buffered = bytes.length - offset; }
    return this;
  }
  hex(): string {
    const tail = new Uint8Array(this.buffered < 56 ? 64 : 128);
    tail.set(this.block.subarray(0, this.buffered));
    tail[this.buffered] = 0x80;
    new DataView(tail.buffer).setBigUint64(tail.length - 8, BigInt(this.length) * 8n);
    for (let offset = 0; offset < tail.length; offset += 64) this.compress(tail, offset);
    return Array.from(this.hash, value => value.toString(16).padStart(8, '0')).join('');
  }
  private compress(bytes: Uint8Array, offset: number): void {
    const { words, hash } = this;
    for (let i = 0; i < 16; i++) { const at = offset + i * 4; words[i] = ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0; }
    for (let i = 16; i < 64; i++) {
      const x = words[i - 15], y = words[i - 2];
      const sigma0 = rotate(x, 7) ^ rotate(x, 18) ^ (x >>> 3);
      const sigma1 = rotate(y, 17) ^ rotate(y, 19) ^ (y >>> 10);
      words[i] = (words[i - 16] + sigma0 + words[i - 7] + sigma1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = hash;
    for (let i = 0; i < 64; i++) {
      const sum1 = rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25);
      const choose = (e & f) ^ (~e & g);
      const t1 = (h + sum1 + choose + roundConstants[i] + words[i]) >>> 0;
      const sum0 = rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (sum0 + majority) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    hash[0] = (hash[0] + a) >>> 0; hash[1] = (hash[1] + b) >>> 0;
    hash[2] = (hash[2] + c) >>> 0; hash[3] = (hash[3] + d) >>> 0;
    hash[4] = (hash[4] + e) >>> 0; hash[5] = (hash[5] + f) >>> 0;
    hash[6] = (hash[6] + g) >>> 0; hash[7] = (hash[7] + h) >>> 0;
  }
}

export function sha256Hex(bytes: Uint8Array): string {
  return new Sha256().update(bytes).hex();
}

/** SHA-256 of `bytes`: Web Crypto when the context has it (secure origins; it runs off the calling thread), else JavaScript. */
export async function sha256Digest(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    try {
      const digest = await subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
      return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
    } catch { /* fall back to JavaScript */ }
  }
  return sha256Hex(bytes);
}

/** Source identity of a file's bytes (the import worker hashes files once, in the worker). */
export async function fileSource(file: Pick<File, 'name' | 'size'>, bytes: Uint8Array): Promise<FileSource> {
  return fileSourceFor(file.name, file.size, await sha256Digest(bytes));
}
export const fileSourceFor = (name: string, size: number, sha256: string): FileSource => ({ name, size, sha256, format: name.split('.').pop()?.toLowerCase() || '' });
/** Source identity for text without a file (the sample, pasted ABC, the musicXml prop): a hash of the text with a format prefix. */
export function textSource(format: string, text: string, name: string): FileSource {
  const bytes = new TextEncoder().encode(`${format}:${text}`);
  return { name, size: bytes.length - format.length - 1, sha256: sha256Hex(bytes), format };
}

/** A part's switch as saved in its record (`PartState.switch`); `sound` only with an `instrument`. */
export type SavedSwitch = { instrument?: InstrumentId; level: RangeLevel; autoRange: boolean; octaves?: Record<string, Shift>; sound?: PartSound };
export const isLevel = (value: unknown): value is RangeLevel => LEVELS.includes(value as RangeLevel);
/** A switch target: any model instrument but the drum kit (unpitched). */
export const isSwitchTarget = (value: unknown): value is InstrumentId => INSTRUMENT_IDS.includes(value as InstrumentId) && INSTRUMENTS[value as InstrumentId].clef !== 'percussion';
/** A part's switch as saved, or undefined for no entry. */
export function savedSwitch(entry: PartSwitch | undefined): SavedSwitch | undefined {
  if (!entry) return undefined;
  return { ...(entry.instrument ? { instrument: entry.instrument } : {}), level: entry.level, autoRange: entry.autoRange, ...(Object.keys(entry.octaves).length ? { octaves: { ...entry.octaves } } : {}),
    ...(entry.instrument && entry.sound ? { sound: { instrument: entry.sound.instrument, ...(entry.sound.gmSoundfont ? { gmSoundfont: entry.sound.gmSoundfont } : {}) } } : {}) };
}
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
/** A saved sound pick: a known icon id and, when given, a known GM sound; undefined when unusable. */
function validSound(value: unknown): PartSound | undefined {
  if (!isRecord(value) || !instruments.has(value.instrument as InstrumentId)) return undefined;
  if (value.gmSoundfont !== undefined && (typeof value.gmSoundfont !== 'string' || !isGmSoundfont(value.gmSoundfont))) return undefined;
  return { instrument: value.instrument as InstrumentId, ...(value.gmSoundfont ? { gmSoundfont: value.gmSoundfont as string } : {}) };
}
/** A saved switch, or undefined when it is unusable. */
function validSwitch(value: unknown): SavedSwitch | undefined {
  if (!isRecord(value)) return undefined;
  const { instrument, level, autoRange, octaves, sound } = value;
  if ((instrument !== undefined && !isSwitchTarget(instrument)) || !isLevel(level) || typeof autoRange !== 'boolean') return undefined;
  if (octaves !== undefined && (!isRecord(octaves) || Object.values(octaves).some(shift => shift !== 0 && shift !== 12 && shift !== -12))) return undefined;
  // An unusable sound (or one without an instrument) only loses the sound: the instrument's main sound plays.
  const picked = instrument !== undefined ? validSound(sound) : undefined;
  return { ...(instrument !== undefined ? { instrument } : {}), level, autoRange, ...(octaves && Object.keys(octaves).length ? { octaves: { ...(octaves as Record<string, Shift>) } } : {}), ...(picked ? { sound: picked } : {}) };
}
const validZoom = (zoom: unknown): zoom is number => typeof zoom === 'number' && Number.isFinite(zoom) && zoom >= STAVE_SCALE_FLOOR && zoom <= STAVE_SCALE_MAX;
/** Validate and normalise shared v1/v2 fields in place; false when the record is unusable. */
function validSettingsAndParts(state: { settings: SavedSettings; parts: Record<string, PartState> }): boolean {
  const settings = state.settings;
  if (!settings || !state.parts || typeof state.parts !== 'object') return false;
  if (!['portrait', 'landscape'].includes(settings.mode) || !['Bravura', 'Petaluma'].includes(settings.notationFont)) return false;
  if (settings.barsPerLine !== 'auto' && (!Number.isInteger(settings.barsPerLine) || settings.barsPerLine < BARS_PER_LINE_MIN || settings.barsPerLine > BARS_PER_LINE_MAX)) return false;
  if (!Number.isInteger(settings.overlap) || settings.overlap < 0 || settings.overlap > 3) return false;
  // Out-of-range tempos (e.g. cut-time 160 → 320 quarter BPM) are clamped, not a reason to drop the state.
  if (!Number.isFinite(settings.bpm)) return false;
  settings.bpm = clampBpm(settings.bpm);
  if (settings.semitones !== undefined && (!Number.isInteger(settings.semitones) || Math.abs(settings.semitones) > 12)) return false;
  if (settings.scorePitch !== undefined && !['written', 'concert'].includes(settings.scorePitch)) return false;
  if (settings.pitchColours !== undefined && typeof settings.pitchColours !== 'boolean') return false;
  if (settings.keyFlip !== undefined && typeof settings.keyFlip !== 'boolean') return false;
  if (settings.annotationFont !== undefined && !['Sans', 'Serif', 'Mono'].includes(settings.annotationFont)) return false;
  // TAB settings came after version 2 shipped: a missing or unusable one is left out, so applying the record keeps the
  // reader's current value (a host's initial view, or the drawer's tuning) instead of resetting it.
  const late: Partial<Pick<FileSettings, LateSettingKey>> = {};
  if (validTabView(settings.tabView)) late.tabView = settings.tabView;
  if (validTabTuning(settings.tabTuning)) late.tabTuning = [...settings.tabTuning];
  if (typeof settings.capo === 'number' && Number.isFinite(settings.capo)) late.capo = clampCapo(settings.capo);
  if (['names', 'chordSymbols', 'inferChordSymbols', 'counts', 'subdivisions'].some(key => typeof settings[key as keyof FileSettings] !== 'boolean')) return false;
  // A null (or non-object) part entry is dropped, not a reason to drop the record.
  for (const [id, part] of Object.entries(state.parts)) if (!isRecord(part)) delete state.parts[id];
  Object.values(state.parts).forEach(part => {
    part.instrument = legacyInstruments[part.instrument] || part.instrument;
    if ('switch' in part) { const valid = validSwitch(part.switch); if (valid) part.switch = valid; else delete part.switch; }
  });
  if (Object.values(state.parts).some(part => typeof part.visible !== 'boolean' || !instruments.has(part.instrument) || (part.gmSoundfont !== undefined && !isGmSoundfont(part.gmSoundfont)) || (part.volume !== undefined && (!Number.isInteger(part.volume) || part.volume < 0 || part.volume > 100)))) return false;
  const { tabView: _view, tabTuning: _tuning, capo: _capo, ...rest } = settings;
  state.settings = { ...rest, annotationFont: settings.annotationFont ?? 'Sans', semitones: settings.semitones ?? 0, scorePitch: settings.scorePitch ?? 'written', keyFlip: settings.keyFlip ?? false, ...late } as SavedSettings;
  // A missing or unknown add-on size only loses that size (regular), not the record.
  for (const key of ANNOTATION_SIZE_PREF_KEYS) if (!isAnnotationSize(state.settings[key])) state.settings[key] = 'rg';
  return true;
}

/** Validate a stored v1 (legacy localStorage) record for `sha256`. */
export function parseLegacyFileState(raw: unknown, sha256: string): FileStateV1 | null {
  try {
    const state = (typeof raw === 'string' ? JSON.parse(raw) : raw) as FileStateV1;
    if (!state || state.version !== 1 || state.source?.sha256 !== sha256) return null;
    if (!validZoom(state.settings?.zoom)) return null;
    const zoom = state.settings.zoom;
    if (!validSettingsAndParts(state)) return null;
    state.settings.zoom = zoom;
    return state;
  } catch { return null; }
}

/**
 * v1 → v2. A v1 zoom multiplied the width fit; for the default single-stave layouts
 * that fit was the baseline scale 1, so a changed v1 zoom carries over as an absolute
 * scale for the current device. The v1 default (1) becomes "no saved view".
 */
export function migrateFileState(legacy: FileStateV1, device: DeviceClass, lastOpened = Date.now()): FileState {
  const { zoom, ...settings } = legacy.settings;
  return { version: 2, source: legacy.source, lastOpened, settings, parts: legacy.parts, ...(zoom !== 1 ? { view: { zoom, zoomDevice: device } } : {}) };
}

/** Validate a stored v2 record for `sha256`. */
export function parseFileState(raw: unknown, sha256: string): FileState | null {
  try {
    const state = (typeof raw === 'string' ? JSON.parse(raw) : structuredClone(raw)) as FileState;
    if (!state || state.version !== 2 || state.source?.sha256 !== sha256 || !Number.isFinite(state.lastOpened)) return null;
    // An unusable view only loses the saved zoom, not the score's other settings.
    if (state.view !== undefined && (!validZoom(state.view?.zoom) || !['desktop', 'compact'].includes(state.view.zoomDevice))) delete state.view;
    if (state.hostInstruments !== undefined && (typeof state.hostInstruments !== 'string' || !state.hostInstruments)) delete state.hostInstruments;
    if ('zoom' in (state.settings || {})) delete (state.settings as Partial<FileSettings> & { zoom?: number }).zoom;
    return validSettingsAndParts(state) ? state : null;
  } catch { return null; }
}

/** Read the legacy localStorage v1 record for a source. */
export function readFileState(source: FileSource): FileStateV1 | null {
  try { return parseLegacyFileState(localStorage.getItem(legacyStorageKey(source.sha256)), source.sha256); }
  catch { return null; }
}

export function buildFileState(source: FileSource, settings: FileSettings, score: Score, hiddenIds: string[], volumes: Record<string, number> = {}, view?: ScoreView, lastOpened = Date.now(), switches: Record<string, PartSwitch> = {}, hostInstruments?: string): FileState {
  const hidden = new Set(hiddenIds);
  const parts: FileState['parts'] = {};
  // A TAB part that doubles a guitar is saved with the guitar's visibility (the reader lists and hides the guitar).
  for (const part of score.parts) parts[part.id] = { visible: !hidden.has(part.tabOf ?? part.id), instrument: part.instrument, ...(part.gmSoundfont ? { gmSoundfont: part.gmSoundfont } : {}), volume: volumes[part.id] ?? 100 };
  for (const part of score.parts) { const saved = savedSwitch(switches[part.id]); if (saved) parts[part.id].switch = saved; }
  const { mode, notationFont, barsPerLine, overlap, names, chordSymbols, inferChordSymbols, counts, subdivisions, annotationFont, bpm, semitones, scorePitch, keyFlip, tabView, tabTuning, capo } = settings;
  const sizes = Object.fromEntries(ANNOTATION_SIZE_PREF_KEYS.map(key => [key, isAnnotationSize(settings[key]) ? settings[key] : 'rg'])) as Pick<FileSettings, typeof ANNOTATION_SIZE_PREF_KEYS[number]>;
  return { version: 2, source, lastOpened, settings: { ...(settings.pitchColours ? { pitchColours: true } : {}), mode, notationFont, barsPerLine, overlap, names, chordSymbols, inferChordSymbols, counts, subdivisions, annotationFont, ...sizes, bpm: clampBpm(bpm), semitones, scorePitch, keyFlip: !!keyFlip,
    tabView: validTabView(tabView) ? tabView : 'notation', tabTuning: validTabTuning(tabTuning) ? [...tabTuning] : [...STANDARD_TAB_TUNING], capo: clampCapo(capo) }, parts, ...(view ? { view } : {}), ...(hostInstruments ? { hostInstruments } : {}) };
}
