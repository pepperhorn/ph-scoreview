import { keyAlter, spellMidi } from '../model/instruments';
import type { Pitch } from '../model/schema';

const SEMITONES: Record<Pitch['step'], number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const DEFAULT_LAST: Pitch = { step: 'C', octave: 4, alter: 0 };

export const midiOf = (p: Pitch): number => (p.octave + 1) * 12 + SEMITONES[p.step] + p.alter;

/**
 * The pitch a letter key enters: `step` with the key signature's (`fifths`) alteration (or `alter` when
 * given), in the octave whose MIDI distance to `lastPitch` (default C4) is smallest; a tie takes the higher.
 */
export function pitchForLetter(step: Pitch['step'], lastPitch: Pitch | undefined, fifths: number, alter = keyAlter(step, fifths)): Pitch {
  const target = midiOf(lastPitch ?? DEFAULT_LAST);
  let best: Pitch | undefined;
  for (let octave = 0; octave <= 9; octave++) {
    const candidate = { step, octave, alter };
    const distance = Math.abs(midiOf(candidate) - target);
    if (!best || distance <= Math.abs(midiOf(best) - target)) best = candidate;
  }
  return best!;
}

/**
 * The spelling of piano key `pitchClass` (0 = C .. 11 = B) in a key of `fifths`: the key signature's spelling
 * if it has one, else the natural, else a sharp in sharp keys (and C major) or a flat in flat keys.
 */
export function pianoSpelling(pitchClass: number, fifths: number): { step: Pitch['step']; alter: number } {
  const { step, alter } = spellMidi(60 + pitchClass, fifths, fifths >= 0 ? 1 : -1)!;
  return { step, alter };
}
