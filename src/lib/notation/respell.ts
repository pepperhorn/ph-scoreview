/**
 * Key choice and note respelling for a transposed or key-flipped view (docs/specs/transpose-and-spelling.md), shared
 * by the Verovio worker's view MEI pass (`mei-spelling.ts`) and the Score view (`transpose.ts` `scoreForView`), so
 * note-name labels spell exactly like the engraved noteheads.
 *
 * Pure: no DOM, no Verovio.
 */
import { chooseKey, enharmonicFlip, keyFromFifths, spellPitch, type KeyMode, type Spelled, type SpelledPitch, type SpellingKey, type SpellingProfile } from '../spelling';

export type Interval = { diatonic: number; chromatic: number };

const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const NATURAL_PC = [0, 2, 4, 5, 7, 9, 11];
const mod = (value: number, base: number) => ((value % base) + base) % base;

/** A Verovio interval string ('+A4', '-d5', '+P8', '') as letter steps and semitones. */
export function parseInterval(text: string): Interval {
  const match = /^([+-]?)(dd|d|m|M|P|A|AA)(\d+)$/.exec(text.trim());
  if (!match) return { diatonic: 0, chromatic: 0 };
  const steps = Number(match[3]) - 1;
  const simple = steps % 7;
  const reference = NATURAL_PC[simple] + 12 * Math.floor(steps / 7);
  const perfect = simple === 0 || simple === 3 || simple === 4;
  const offset = (perfect ? { dd: -2, d: -1, P: 0, A: 1, AA: 2 } : { dd: -3, d: -2, m: -1, M: 0, A: 1, AA: 2 } as Record<string, number>)[match[2] as 'd'] ?? 0;
  const sign = match[1] === '-' ? -1 : 1;
  return { diatonic: sign * steps, chromatic: sign * (reference + offset) };
}

/** How many fifths an interval moves a key signature (M2 = +2, A4 = +6, d5 = -6, P8 = 0). */
export const intervalFifths = ({ diatonic, chromatic }: Interval) => 7 * chromatic - 12 * diatonic;

/** A spelled pitch moved by an interval, keeping its letter relationship (Verovio's interval transposition). */
export function transposeSpelled(pitch: SpelledPitch, interval: Interval): SpelledPitch {
  if (!interval.diatonic && !interval.chromatic) return pitch;
  const index = LETTERS.indexOf(pitch.step) + interval.diatonic;
  const step = LETTERS[mod(index, 7)];
  const octave = pitch.octave + Math.floor(index / 7);
  const midi = midiOf(pitch) + interval.chromatic;
  return { step, octave, alter: midi - midiOf({ step, octave, alter: 0 }) };
}

export const midiOf = (pitch: SpelledPitch) => (pitch.octave + 1) * 12 + NATURAL_PC[LETTERS.indexOf(pitch.step)] + pitch.alter;

/** MEI key signature value ('3s', '2f', '0') as fifths; null when absent or not a plain count. */
export function fifthsOf(sig: string | null | undefined): number | null {
  if (sig === null || sig === undefined) return null;
  const match = /^\s*(\d+)\s*([sf]?)\s*$/.exec(sig);
  if (!match) return null;
  const count = Number(match[1]);
  return match[2] === 'f' ? -count : count;
}
export const sigOf = (fifths: number) => fifths > 0 ? `${fifths}s` : fifths < 0 ? `${-fifths}f` : '0';

/** Fifths folded into -7..7 (a key past 7 accidentals has an enharmonic within it). */
export const foldFifths = (fifths: number) => {
  let value = fifths;
  while (value > 7) value -= 12;
  while (value < -7) value += 12;
  return value;
};

export type StaffSpelling = {
  /** Spelling profile of the staff's part ('neutral' in the concert view, where one global key applies). */
  profile: SpellingProfile;
  /** The staff's pitch moves in this view (a transposition, or a transposing part shown at concert pitch). */
  moved: boolean;
};

/**
 * The key a staff shows. `fifths` is the staff's key in this view before the global transposition and flip (the
 * source key, or its sounding key for a transposing part in the concert view). A moved staff takes the key table's
 * choice for its pitch class (with the part's profile and the flip); an unmoved one keeps its own key, or its
 * enharmonic equivalent when flipped.
 */
export function viewKey(fifths: number, semitones: number, mode: KeyMode, staff: StaffSpelling, flip: boolean): SpellingKey {
  const moved = staff.moved || semitones !== 0;
  if (!moved && Math.abs(fifths) <= 7) {
    const source = keyFromFifths(fifths, mode);
    return flip ? enharmonicFlip(source) ?? source : source;
  }
  const majorPc = mod(7 * (fifths + 7 * semitones), 12);
  return chooseKey(mod(majorPc - (mode === 'minor' ? 3 : 0), 12), mode, { family: staff.profile, flip });
}

export type LineNote = {
  /** Sounding (view) MIDI pitch. */
  midi: number;
  /** The spelling the source gives it after the view's interval transposition. */
  source: SpelledPitch;
  key: SpellingKey;
  /** Part of a chord: chord tones are neither passing notes nor resolutions, so they get no neighbours. */
  chord: boolean;
  /** Index (into the same line) of the note this one is tied from; it takes that note's spelling. */
  tiedFrom?: number;
};

/** Key-relative spelling of one voice's notes in order, with neighbours for passing notes and upward resolutions. */
export function respellLine(notes: LineNote[]): SpelledPitch[] {
  const out: SpelledPitch[] = [];
  notes.forEach((note, index) => {
    if (note.tiedFrom !== undefined && out[note.tiedFrom] && midiOf(out[note.tiedFrom]) === note.midi) { out.push(out[note.tiedFrom]); return; }
    const single = (other?: LineNote) => other && !other.chord && !note.chord ? other.midi : undefined;
    out.push(spellPitch(note.midi, note.key, { source: note.source, prev: single(notes[index - 1]), next: single(notes[index + 1]), transposed: true }));
  });
  return out;
}

/** The key signature's alteration of a letter. */
export const signatureAlter = (key: SpellingKey, step: string) => key.scale[LETTERS.indexOf(step)]?.alter ?? 0;

export type DisplayNote = { pitch: SpelledPitch; onset: number; key: SpellingKey;
  /** Continuation of a tie: never shows an accidental and does not change the measure's accidentals. */
  tieEnd?: boolean;
  /** A cautionary or editorial accidental the source asked for: always shown. */
  cautionary?: boolean };

/**
 * Which notes of one staff-measure show their accidental: a note shows one when its alteration differs from the
 * accidental in force on its line and octave (the key signature, or an earlier accidental in the measure). Notes
 * at the same onset are judged against what was in force before that onset.
 */
export function accidentalDisplay(notes: DisplayNote[]): boolean[] {
  const shown: boolean[] = new Array(notes.length).fill(false);
  const order = notes.map((_, index) => index).sort((a, b) => notes[a].onset - notes[b].onset || a - b);
  const state = new Map<string, number>();
  for (let start = 0; start < order.length;) {
    let end = start;
    while (end < order.length && Math.abs(notes[order[end]].onset - notes[order[start]].onset) < 1e-6) end++;
    const updates: [string, number][] = [];
    for (const index of order.slice(start, end)) {
      const { pitch, key, tieEnd, cautionary } = notes[index];
      const line = `${pitch.step}${pitch.octave}`;
      const inForce = state.get(line) ?? signatureAlter(key, pitch.step);
      if (tieEnd) continue;
      if (pitch.alter !== inForce || cautionary) { shown[index] = true; updates.push([line, pitch.alter]); }
    }
    for (const [line, alter] of updates) state.set(line, alter);
    start = end;
  }
  return shown;
}

export type { Spelled, SpelledPitch, SpellingKey };
