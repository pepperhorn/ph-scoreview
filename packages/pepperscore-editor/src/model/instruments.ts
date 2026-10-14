import type { Clef, Pitch } from './schema';

/** The viewer's instrument ids (`pepperscore` `InstrumentId`). */
export const INSTRUMENT_IDS = [
  'piano', 'guitar', 'bassguitar', 'double-bass', 'drum-kit', 'alto-saxophone', 'tenor-saxophone', 'bari-saxophone',
  'flute', 'clarinet', 'trumpet', 'trombone', 'violin', 'viola', 'cello', 'microphone',
] as const;
export const LEVELS = ['beginner', 'intermediate', 'advanced'] as const;

export type InstrumentId = typeof INSTRUMENT_IDS[number];
export type Level = typeof LEVELS[number];
export type Transposition = { semitones: number; diatonic: number };
export type Instrument = {
  id: InstrumentId;
  label: string;
  /** 1-based GM program (the viewer's voice program); the drum kit plays on channel 10, not a program. */
  gmProgram: number;
  clef: Clef;
  /** Written minus sounding. */
  transposition: Transposition;
  /** Playable range per level in sounding MIDI, inclusive; absent for unpitched instruments. */
  ranges?: Record<Level, { low: number; high: number }>;
};

type Span = [number, number];
const ranges = (beginner: Span, intermediate: Span, advanced: Span): Instrument['ranges'] => ({
  beginner: { low: beginner[0], high: beginner[1] },
  intermediate: { low: intermediate[0], high: intermediate[1] },
  advanced: { low: advanced[0], high: advanced[1] },
});
const CONCERT: Transposition = { semitones: 0, diatonic: 0 };
const OCTAVE: Transposition = { semitones: 12, diatonic: 7 };
const B_FLAT: Transposition = { semitones: 2, diatonic: 1 };

export const INSTRUMENTS: Record<InstrumentId, Instrument> = {
  piano: { id: 'piano', label: 'Piano', gmProgram: 1, clef: 'treble', transposition: CONCERT, ranges: ranges([21, 108], [21, 108], [21, 108]) },
  guitar: { id: 'guitar', label: 'Guitar', gmProgram: 25, clef: 'treble', transposition: OCTAVE, ranges: ranges([40, 64], [40, 76], [40, 88]) },
  bassguitar: { id: 'bassguitar', label: 'Bass Guitar', gmProgram: 34, clef: 'bass', transposition: OCTAVE, ranges: ranges([28, 48], [28, 55], [28, 60]) },
  'double-bass': { id: 'double-bass', label: 'Double Bass', gmProgram: 33, clef: 'bass', transposition: OCTAVE, ranges: ranges([28, 48], [28, 55], [28, 64]) },
  'drum-kit': { id: 'drum-kit', label: 'Drum Kit', gmProgram: 1, clef: 'percussion', transposition: CONCERT },
  'alto-saxophone': { id: 'alto-saxophone', label: 'Alto Saxophone', gmProgram: 66, clef: 'treble', transposition: { semitones: 9, diatonic: 5 }, ranges: ranges([49, 69], [49, 77], [49, 81]) },
  'tenor-saxophone': { id: 'tenor-saxophone', label: 'Tenor Saxophone', gmProgram: 67, clef: 'treble', transposition: { semitones: 14, diatonic: 8 }, ranges: ranges([44, 64], [44, 72], [44, 76]) },
  'bari-saxophone': { id: 'bari-saxophone', label: 'Baritone Saxophone', gmProgram: 68, clef: 'treble', transposition: { semitones: 21, diatonic: 12 }, ranges: ranges([37, 57], [37, 65], [36, 69]) },
  flute: { id: 'flute', label: 'Flute', gmProgram: 74, clef: 'treble', transposition: CONCERT, ranges: ranges([60, 84], [60, 91], [59, 96]) },
  clarinet: { id: 'clarinet', label: 'Clarinet', gmProgram: 72, clef: 'treble', transposition: B_FLAT, ranges: ranges([50, 74], [50, 82], [50, 91]) },
  trumpet: { id: 'trumpet', label: 'Trumpet', gmProgram: 57, clef: 'treble', transposition: B_FLAT, ranges: ranges([55, 72], [54, 79], [52, 86]) },
  trombone: { id: 'trombone', label: 'Trombone', gmProgram: 58, clef: 'bass', transposition: CONCERT, ranges: ranges([46, 65], [40, 70], [34, 77]) },
  violin: { id: 'violin', label: 'Violin', gmProgram: 41, clef: 'treble', transposition: CONCERT, ranges: ranges([55, 81], [55, 91], [55, 105]) },
  viola: { id: 'viola', label: 'Viola', gmProgram: 42, clef: 'alto', transposition: CONCERT, ranges: ranges([48, 76], [48, 84], [48, 96]) },
  cello: { id: 'cello', label: 'Cello', gmProgram: 43, clef: 'bass', transposition: CONCERT, ranges: ranges([36, 64], [36, 76], [36, 88]) },
  microphone: { id: 'microphone', label: 'Voice', gmProgram: 54, clef: 'treble', transposition: CONCERT, ranges: ranges([48, 72], [45, 76], [40, 81]) },
};

/**
 * GM program blocks (1-based, inclusive) and the instrument nearest each, after the viewer's
 * GM manifest; programs outside every block (synths, ethnic, effects) fall back to piano.
 */
const GM_BLOCKS: [number, number, InstrumentId][] = [
  [1, 24, 'piano'], [25, 32, 'guitar'], [33, 33, 'double-bass'], [34, 40, 'bassguitar'],
  [41, 41, 'violin'], [42, 42, 'viola'], [43, 43, 'cello'], [44, 44, 'double-bass'], [45, 52, 'violin'],
  [53, 55, 'microphone'], [57, 57, 'trumpet'], [58, 59, 'trombone'], [60, 60, 'trumpet'], [61, 61, 'trombone'], [62, 64, 'trumpet'],
  [65, 66, 'alto-saxophone'], [67, 67, 'tenor-saxophone'], [68, 68, 'bari-saxophone'], [69, 72, 'clarinet'], [73, 80, 'flute'],
];

/** The instrument nearest a 1-based GM program; piano when none is near. */
export function instrumentFor(gmProgram: number): Instrument {
  const block = GM_BLOCKS.find(([low, high]) => gmProgram >= low && gmProgram <= high);
  return INSTRUMENTS[block?.[2] ?? 'piano'];
}

const STEPS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const;
const SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const SEMITONES: Record<Pitch['step'], number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** The MIDI number of a pitch (C4 = 60). */
export const pitchMidi = (p: Pitch): number => (p.octave + 1) * 12 + SEMITONES[p.step] + p.alter;

/** The alteration the key signature (`fifths`) gives `step`. */
export function keyAlter(step: Pitch['step'], fifths: number): number {
  if (fifths > 0) return SHARP_ORDER.indexOf(step) < fifths ? 1 : 0;
  if (fifths < 0) return SHARP_ORDER.length - 1 - SHARP_ORDER.indexOf(step) < -fifths ? -1 : 0;
  return 0;
}

/**
 * The spelling of MIDI note `target`: the key signature's (`fifths`) spelling if it has one, else the
 * natural, else a sharp going up (`direction` >= 0) or a flat going down, else the other single
 * accidental, else a double.
 */
export function spellMidi(target: number, fifths: number, direction: number): Pitch | undefined {
  const candidates: Pitch[] = [];
  for (const step of STEPS) {
    for (let octave = Math.floor(target / 12) - 2; octave <= Math.floor(target / 12); octave++) {
      const alter = target - pitchMidi({ step, octave, alter: 0 });
      if (alter >= -2 && alter <= 2) candidates.push({ step, octave, alter });
    }
  }
  const single = direction >= 0 ? 1 : -1;
  const rank = (p: Pitch) => (p.alter === keyAlter(p.step, fifths) ? 0 : p.alter === 0 ? 1 : p.alter === single ? 2 : p.alter === -single ? 3 : 4);
  return candidates.sort((a, b) => rank(a) - rank(b))[0];
}

/** The sounding MIDI number of a written pitch on an instrument with `transposition` (written minus sounding). */
export function soundingMidi(pitch: Pitch, transposition: { semitones: number }): number {
  return pitchMidi(pitch) - transposition.semitones;
}

/**
 * The written pitch of sounding MIDI `soundingMidi` for an instrument with `transposition`, spelled for the
 * written key `keyFifths`: the key's own accidentals first, then naturals, then sharps for chromatic notes in
 * sharp keys and C major, flats in flat keys. Only `semitones` is used: a MIDI number carries no spelling to
 * move by the diatonic interval.
 */
export function writtenPitch(soundingMidi: number, transposition: Transposition, keyFifths: number): Pitch {
  const target = soundingMidi + transposition.semitones;
  // Every MIDI number has a natural or single-accidental spelling, so spellMidi always finds one.
  return spellMidi(target, keyFifths, keyFifths < 0 ? -1 : 1)!;
}

/**
 * `pitch` moved by `t`, keeping its spelling: the step moves by `diatonic` (carrying the octave) and the alter
 * is whatever makes the MIDI number move by `semitones`. When that alter would pass a double accidental the
 * note is respelled with `writtenPitch` for the key `keyFifths` and `respelled` is true.
 */
export function transposePitchSpelled(pitch: Pitch, t: Transposition, keyFifths: number): { pitch: Pitch; respelled: boolean } {
  const index = pitch.octave * 7 + STEPS.indexOf(pitch.step) + t.diatonic;
  const octave = Math.floor(index / 7);
  const step = STEPS[index - octave * 7];
  const target = pitchMidi(pitch) + t.semitones;
  const alter = target - pitchMidi({ step, octave, alter: 0 });
  if (Math.abs(alter) <= 2) return { pitch: { step, octave, alter }, respelled: false };
  return { pitch: writtenPitch(target, { semitones: 0, diatonic: 0 }, keyFifths), respelled: true };
}

/** `pitch` moved by `t`, keeping its spelling (see `transposePitchSpelled`; the fallback spells for C major). */
export const transposePitch = (pitch: Pitch, t: Transposition): Pitch => transposePitchSpelled(pitch, t, 0).pitch;
