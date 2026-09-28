import { isGmSoundfont, type InstrumentId, type Score } from './score';

export type FileSource = { name: string; size: number; sha256: string; format: string };
export type FileSettings = {
  mode: 'portrait' | 'landscape'; notationFont: 'Bravura' | 'Petaluma'; barsPerLine: 'auto' | number;
  overlap: number; names: boolean; chordSymbols: boolean; inferChordSymbols: boolean;
  counts: boolean; subdivisions: boolean; annotationFont: 'Sans' | 'Serif' | 'Mono'; bpm: number; zoom: number; semitones: number; scorePitch: 'written' | 'concert';
};
export type FileState = {
  version: 1;
  source: FileSource;
  settings: FileSettings;
  parts: Record<string, { visible: boolean; instrument: InstrumentId; gmSoundfont?: string; volume?: number }>;
};

const storageKey = (hash: string) => `scoreflow-file-v1:${hash}`;
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

// Works on plain HTTP LAN origins, where Web Crypto's subtle API is absent.
export function sha256Hex(bytes: Uint8Array): string {
  const padded = new Uint8Array(Math.ceil((bytes.length + 9) / 64) * 64);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const data = new DataView(padded.buffer);
  data.setBigUint64(padded.length - 8, BigInt(bytes.length) * 8n);
  const hash = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const words = new Uint32Array(64);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) words[i] = data.getUint32(offset + i * 4);
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
  return Array.from(hash, value => value.toString(16).padStart(8, '0')).join('');
}

export async function fileSource(file: File): Promise<FileSource> {
  const sha256 = sha256Hex(new Uint8Array(await file.arrayBuffer()));
  return { name: file.name, size: file.size, sha256, format: file.name.split('.').pop()?.toLowerCase() || '' };
}

export function readFileState(source: FileSource): FileState | null {
  try {
    const raw = localStorage.getItem(storageKey(source.sha256));
    if (!raw) return null;
    const state = JSON.parse(raw) as FileState;
    if (state.version !== 1 || state.source?.sha256 !== source.sha256 || !state.settings || !state.parts) return null;
    if (!['portrait', 'landscape'].includes(state.settings.mode) || !['Bravura', 'Petaluma'].includes(state.settings.notationFont)) return null;
    if (!Number.isFinite(state.settings.zoom) || state.settings.zoom < .5 || state.settings.zoom > 4) return null;
    if (state.settings.barsPerLine !== 'auto' && (!Number.isInteger(state.settings.barsPerLine) || state.settings.barsPerLine < 1 || state.settings.barsPerLine > 4)) return null;
    if (!Number.isInteger(state.settings.overlap) || state.settings.overlap < 0 || state.settings.overlap > 3) return null;
    if (!Number.isFinite(state.settings.bpm) || state.settings.bpm < 30 || state.settings.bpm > 240) return null;
    if (state.settings.semitones !== undefined && (!Number.isInteger(state.settings.semitones) || Math.abs(state.settings.semitones) > 12)) return null;
    if (state.settings.scorePitch !== undefined && !['written', 'concert'].includes(state.settings.scorePitch)) return null;
    if (state.settings.annotationFont !== undefined && !['Sans', 'Serif', 'Mono'].includes(state.settings.annotationFont)) return null;
    if (['names', 'chordSymbols', 'inferChordSymbols', 'counts', 'subdivisions'].some(key => typeof state.settings[key as keyof FileSettings] !== 'boolean')) return null;
    Object.values(state.parts).forEach(part => { part.instrument = legacyInstruments[part.instrument] || part.instrument; });
    if (Object.values(state.parts).some(part => typeof part.visible !== 'boolean' || !instruments.has(part.instrument) || (part.gmSoundfont !== undefined && !isGmSoundfont(part.gmSoundfont)) || (part.volume !== undefined && (!Number.isInteger(part.volume) || part.volume < 0 || part.volume > 100)))) return null;
    return { ...state, settings: { ...state.settings, annotationFont: state.settings.annotationFont ?? 'Sans', semitones: state.settings.semitones ?? 0, scorePitch: state.settings.scorePitch ?? 'written' } };
  } catch { return null; }
}

export function writeFileState(source: FileSource, settings: FileSettings, score: Score, hiddenIds: string[], volumes: Record<string, number> = {}): void {
  const hidden = new Set(hiddenIds);
  const parts: FileState['parts'] = {};
  for (const part of score.parts) parts[part.id] = { visible: !hidden.has(part.id), instrument: part.instrument, ...(part.gmSoundfont ? { gmSoundfont: part.gmSoundfont } : {}), volume: volumes[part.id] ?? 100 };
  const state: FileState = { version: 1, source, settings, parts };
  try { localStorage.setItem(storageKey(source.sha256), JSON.stringify(state)); }
  catch { /* Storage may be unavailable; the current session still works. */ }
}
