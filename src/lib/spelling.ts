/**
 * Enharmonic spelling policy (docs/specs/transpose-and-spelling.md): key choice by pitch class, the enharmonic key
 * flip, Verovio transposition intervals with quality, and key-relative spelling of notes and chord symbols.
 *
 * Pure: no DOM, no Verovio, type-only imports, so it runs in the worker, the main thread and Node tests alike.
 *
 * Notes in the key signature always keep the signature's spelling (E# in F# major, Cb in Gb major). The note rules
 * (flats-only/sharps-only, E#/B#/Fb/Cb, double accidentals) apply to notes outside the signature.
 */
import type { GmFamily, InstrumentId } from './score';

export type KeyMode = 'major' | 'minor';
export type Spelled = { step: string; alter: number };
export type SpelledPitch = Spelled & { octave: number };
export type SpellingKey = {
  /** Tonic name of this mode, e.g. 'F#' (F# major) or 'D#' (D# minor). */
  tonic: string;
  mode: KeyMode;
  /** Key signature: sharps > 0, flats < 0. */
  fifths: number;
  /** The signature's spelling of each letter, C to B. */
  scale: Spelled[];
};
/** 'sharp' parts spell pitch class 1 as C# instead of Db; everything else follows the default table. */
export type SpellingProfile = 'neutral' | 'sharp';
export type KeyOptions = { family?: SpellingProfile; flip?: boolean };
export type SpellContext = {
  /** The spelling the source (or Verovio's interval transposition of it) gives this note. */
  source?: Spelled;
  /** MIDI pitch of the previous and next notes in the same voice, for passing notes and upward resolution. */
  prev?: number;
  next?: number;
  /** True when a transposition or key flip was applied; untransposed source double accidentals are kept. */
  transposed?: boolean;
};

const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const NATURAL_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SHARP_ORDER = 'FCGDAEB';
const FLAT_ORDER = 'BEADGCF';
const MAJOR_BY_FIFTHS = ['Cb', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#'];
const MINOR_BY_FIFTHS = ['Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#', 'G#', 'D#', 'A#'];
/** Major key signature for each pitch class: the default table, and the sharp-leaning profile's one difference. */
const DEFAULT_MAJOR_FIFTHS = [0, -5, 2, -3, 4, -1, 6, 1, -4, 3, -2, 5];
const SHARP_MAJOR_FIFTHS = [0, 7, 2, -3, 4, -1, 6, 1, -4, 3, -2, 5];

const mod = (value: number, base: number) => ((value % base) + base) % base;
const accidentalText = (alter: number) => alter > 0 ? '#'.repeat(alter) : 'b'.repeat(-alter);

/** Pitch class of a note name ('F#', 'Bb', 'Cb', 'E♯'). */
export function pitchClassOf(name: string): number {
  const match = /^([A-Ga-g])([#♯x𝄪b♭𝄫]*)$/.exec(name.trim());
  if (!match) throw new Error(`Not a note name: ${name}`);
  return mod(NATURAL_PC[match[1].toUpperCase()] + alterOf(match[2]), 12);
}
function alterOf(accidentals: string): number {
  let alter = 0;
  for (const char of accidentals) alter += char === '#' || char === '♯' ? 1 : char === 'x' || char === '𝄪' ? 2 : char === '𝄫' ? -2 : -1;
  return alter;
}

function signatureAlter(step: string, fifths: number): number {
  const order = fifths > 0 ? SHARP_ORDER : FLAT_ORDER;
  const index = order.indexOf(step);
  const count = index < Math.abs(fifths) ? Math.floor((Math.abs(fifths) - 1 - index) / 7) + 1 : 0;
  return fifths > 0 ? count : -count;
}

/** The key with this signature and mode (fifths within -7..7 for named tonics). */
export function keyFromFifths(fifths: number, mode: KeyMode = 'major'): SpellingKey {
  const names = mode === 'minor' ? MINOR_BY_FIFTHS : MAJOR_BY_FIFTHS;
  const tonic = names[fifths + 7];
  if (!tonic) throw new Error(`No key with ${fifths} fifths`);
  return { tonic, mode, fifths, scale: LETTERS.map(step => ({ step, alter: signatureAlter(step, fifths) })) };
}

/** The key with this tonic name and mode ('Gb' major, 'D#' minor). */
export function keyFromTonic(tonic: string, mode: KeyMode = 'major'): SpellingKey {
  const normalized = tonic.replace('♯', '#').replace('♭', 'b');
  const index = (mode === 'minor' ? MINOR_BY_FIFTHS : MAJOR_BY_FIFTHS).indexOf(normalized.charAt(0).toUpperCase() + normalized.slice(1));
  if (index < 0) throw new Error(`No ${mode} key on ${tonic}`);
  return keyFromFifths(index - 7, mode);
}

/** Pitch class of the key's relative major tonic. */
const majorPitchClass = (key: SpellingKey) => mod(pitchClassOf(key.tonic) + (key.mode === 'minor' ? 3 : 0), 12);

/**
 * The enharmonic equivalent of a key (Db <-> C#, F# <-> Gb, B <-> Cb, and their relative minors), or null when the
 * other spelling would need more than 7 accidentals. Never offers the table's parenthesized keys.
 */
export function enharmonicFlip(key: SpellingKey): SpellingKey | null {
  const other = key.fifths > 0 ? key.fifths - 12 : key.fifths < 0 ? key.fifths + 12 : null;
  return other === null || Math.abs(other) > 7 ? null : keyFromFifths(other, key.mode);
}

/**
 * The key for a tonic pitch class (0 = C). A minor key takes its relative major's choice from the table, so ties
 * (Eb minor vs D# minor) follow the major-key preference. `flip` swaps to the enharmonic equivalent when one exists.
 */
export function chooseKey(pitchClass: number, mode: KeyMode = 'major', options: KeyOptions = {}): SpellingKey {
  const majorPc = mod(pitchClass + (mode === 'minor' ? 3 : 0), 12);
  const key = keyFromFifths((options.family === 'sharp' ? SHARP_MAJOR_FIFTHS : DEFAULT_MAJOR_FIFTHS)[majorPc], mode);
  return options.flip ? enharmonicFlip(key) ?? key : key;
}

/**
 * The interval Verovio's `transpose` option takes to move `from` to `to` by `semitones` (signed, any size): a
 * direction, a quality (P, M, m, A, d, AA, dd) and a number, e.g. C->F# up '+A4', C->Gb up '+d5', C->F# down '-d5',
 * +12 '+P8', Db->C# '-d2'. Empty when nothing moves.
 */
export function transposeInterval(from: string, to: string, semitones: number): string {
  const delta = mod(LETTERS.indexOf(to.charAt(0).toUpperCase()) - LETTERS.indexOf(from.charAt(0).toUpperCase()), 7);
  // Letter steps in the direction of travel, the octave count chosen to match the semitone size.
  const up = mod(-delta, 7);
  const steps = semitones > 0 ? delta + 7 * Math.max(0, Math.round((semitones * 7 / 12 - delta) / 7))
    : semitones < 0 ? -(up + 7 * Math.max(0, Math.round((-semitones * 7 / 12 - up) / 7)))
      : delta <= 3 ? delta : delta - 7;
  if (!semitones && !steps) return '';
  const size = Math.abs(semitones);
  const number = Math.abs(steps) + 1;
  const simple = Math.abs(steps) % 7;
  const reference = [0, 2, 4, 5, 7, 9, 11][simple] + 12 * Math.floor(Math.abs(steps) / 7);
  const perfect = simple === 0 || simple === 3 || simple === 4;
  const difference = size - reference;
  const quality = perfect
    ? ({ '-2': 'dd', '-1': 'd', 0: 'P', 1: 'A', 2: 'AA' } as Record<string, string>)[difference]
    : ({ '-3': 'dd', '-2': 'd', '-1': 'm', 0: 'M', 1: 'A', 2: 'AA' } as Record<string, string>)[difference];
  if (!quality) throw new Error(`No interval from ${from} to ${to} in ${semitones} semitones`);
  return `${semitones < 0 || (!semitones && steps < 0) ? '-' : '+'}${quality}${number}`;
}

/**
 * The target key and Verovio interval for transposing a source key by `semitones`, with the key flip and the part's
 * spelling profile. With no transposition and no flip the source key is kept as written (and the interval is empty).
 */
export function planTranspose(source: SpellingKey, semitones: number, options: KeyOptions = {}): { key: SpellingKey; interval: string } {
  const base = semitones ? chooseKey(mod(pitchClassOf(source.tonic) + semitones, 12), source.mode, { family: options.family }) : source;
  const key = options.flip ? enharmonicFlip(base) ?? base : base;
  return { key, interval: transposeInterval(source.tonic, key.tonic, semitones) };
}

function withOctave(midi: number, spelled: Spelled): SpelledPitch {
  return { ...spelled, octave: Math.round((midi - NATURAL_PC[spelled.step] - spelled.alter) / 12) - 1 };
}
const spells = (midi: number, spelled: Spelled) => mod(NATURAL_PC[spelled.step] + spelled.alter, 12) === mod(midi, 12);
const letterIndex = (step: string) => LETTERS.indexOf(step);

/** The note one letter above (+1) or below (-1) `step`, in diatonic distance from `neighbour`'s spelling. */
function letterStep(from: string, neighbour: Spelled): number {
  const distance = mod(letterIndex(neighbour.step) - letterIndex(from), 7);
  return distance === 1 ? 1 : distance === 6 ? -1 : 0;
}

/**
 * Key-relative spelling of a MIDI pitch.
 *  1. A double accidental the source wrote is kept when nothing was transposed; otherwise doubles are respelled.
 *  2. Notes in the key signature keep its spelling.
 *  3. A minor key's raised 6th and 7th take the signature's letter raised (B# in C# minor, E# in F# minor), unless
 *     that would be a double sharp (F## in G# minor is G). Chromatic notes resolving upward a step keep the source
 *     spelling, except E# and B#, which become F and C.
 *  4. Otherwise flat keys use flats and naturals, sharp keys sharps and naturals, and C major / A minor the key table
 *     (Db Eb F# Ab Bb). E and B are never Fb/Cb, except a stepwise passing note in a key with 6 or more flats.
 */
export function spellPitch(midi: number, key: SpellingKey, context: SpellContext = {}): SpelledPitch {
  const pc = mod(midi, 12);
  const source = context.source && spells(pc, context.source) ? context.source : undefined;
  if (source && Math.abs(source.alter) === 2 && !context.transposed) return withOctave(midi, source);
  const diatonic = key.scale.find(note => spells(pc, note));
  if (diatonic) return withOctave(midi, diatonic);
  const allowed = (spelled: Spelled) => Math.abs(spelled.alter) <= 1 && !['E1', 'B1'].includes(spelled.step + spelled.alter);
  // Minor raised 6th and 7th: the signature's letter, one semitone higher.
  if (key.mode === 'minor') {
    const tonic = letterIndex(key.tonic.charAt(0));
    for (const degree of [5, 6]) {
      const letter = key.scale[(tonic + degree) % 7];
      const raised = { step: letter.step, alter: letter.alter + 1 };
      // Exempt from E#->F and B#->C (B# in C# minor), but never a double sharp (F## in G# minor falls through to G).
      if (spells(pc, raised) && Math.abs(raised.alter) <= 1) return withOctave(midi, raised);
    }
  }
  if (source && allowed(source) && context.next !== undefined && context.next - midi >= 1 && context.next - midi <= 2) return withOctave(midi, source);
  const white = Object.entries(NATURAL_PC).find(([, value]) => value === pc)?.[0];
  if (white) {
    // Fb (pc 4) and Cb (pc 11) as a passing note between letters on either side, in keys with 6+ flats.
    const flatSpelling = { step: LETTERS[(letterIndex(white) + 1) % 7], alter: -1 };
    if ((white === 'E' || white === 'B') && key.fifths <= -6 && context.prev !== undefined && context.next !== undefined) {
      const prev = spellPitch(context.prev, key), next = spellPitch(context.next, key);
      const sides = [letterStep(flatSpelling.step, prev), letterStep(flatSpelling.step, next)];
      if (sides.includes(1) && sides.includes(-1)) return withOctave(midi, flatSpelling);
    }
    return withOctave(midi, { step: white, alter: 0 });
  }
  const sharp = { step: LETTERS.find(step => NATURAL_PC[step] === pc - 1)!, alter: 1 };
  const flat = { step: LETTERS.find(step => NATURAL_PC[step] === pc + 1)!, alter: -1 };
  if (key.fifths > 0) return withOctave(midi, sharp);
  if (key.fifths < 0) return withOctave(midi, flat);
  return withOctave(midi, pc === 6 ? sharp : flat);
}

/** Respell a chord symbol's root and slash bass for a key ('A#m7' in F -> 'Bbm7'); suffix text is unchanged. */
export function spellChordSymbol(symbol: string, key: SpellingKey): string {
  const root = /^([A-G])([#♯b♭x𝄪𝄫]*)(.*)$/s.exec(symbol);
  if (!root) return symbol;
  const unicode = /[♯♭]/.test(symbol);
  const name = (step: string, accidentals: string) => {
    const spelled = spellPitch(60 + NATURAL_PC[step] + alterOf(accidentals), key);
    const text = accidentalText(spelled.alter);
    return spelled.step + (unicode ? text.replace(/#/g, '♯').replace(/b/g, '♭') : text);
  };
  const suffix = root[3].replace(/\/([A-G])([#♯b♭x𝄪𝄫]*)/g, (_, step: string, accidentals: string) => `/${name(step, accidentals)}`);
  return name(root[1], root[2]) + suffix;
}

/** Spelling profile per GM family (gm-soundfont-manifest.json `family`). Strings and guitars lean sharp. */
export const INSTRUMENT_SPELLING: Record<GmFamily, SpellingProfile> = {
  Keyboard: 'neutral', Guitar: 'sharp', Voice: 'neutral', Percussion: 'neutral', Drums: 'neutral',
  Woodwinds: 'neutral', Brass: 'neutral', Strings: 'sharp', 'FX / Other': 'neutral',
};
/** GM family of each instrument id, for parts without a GM program (the manifest files basses under Strings). */
export const INSTRUMENT_FAMILY: Record<InstrumentId, GmFamily> = {
  piano: 'Keyboard', guitar: 'Guitar', bassguitar: 'Strings', 'double-bass': 'Strings', 'drum-kit': 'Drums',
  'alto-saxophone': 'Woodwinds', 'tenor-saxophone': 'Woodwinds', 'bari-saxophone': 'Woodwinds', flute: 'Woodwinds', clarinet: 'Woodwinds',
  trumpet: 'Brass', trombone: 'Brass', violin: 'Strings', viola: 'Strings', cello: 'Strings', microphone: 'Voice',
};
/**
 * A part's spelling profile. Pass `family` when the part has a GM program (`GM_SOUNDS.find(s => s.program ===
 * part.gmProgram)?.family`); otherwise the instrument id decides.
 */
export function spellingProfileFor(part: { instrument: InstrumentId; family?: GmFamily }): SpellingProfile {
  return INSTRUMENT_SPELLING[part.family ?? INSTRUMENT_FAMILY[part.instrument]] ?? 'neutral';
}
