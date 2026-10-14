import { keyAlter } from '../model/instruments';
import type { Pitch } from '../model/schema';

const SEMITONES: Record<Pitch['step'], number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const DEFAULT_LAST: Pitch = { step: 'C', octave: 4, alter: 0 };

export const midiOf = (p: Pitch): number => (p.octave + 1) * 12 + SEMITONES[p.step] + p.alter;

/**
 * The pitch a letter key enters: `step` with the key signature's (`fifths`) alteration, in the
 * octave whose MIDI distance to `lastPitch` (default C4) is smallest; a tie takes the higher.
 */
export function pitchForLetter(step: Pitch['step'], lastPitch: Pitch | undefined, fifths: number): Pitch {
  const alter = keyAlter(step, fifths);
  const target = midiOf(lastPitch ?? DEFAULT_LAST);
  let best: Pitch | undefined;
  for (let octave = 0; octave <= 9; octave++) {
    const candidate = { step, octave, alter };
    const distance = Math.abs(midiOf(candidate) - target);
    if (!best || distance <= Math.abs(midiOf(best) - target)) best = candidate;
  }
  return best!;
}
