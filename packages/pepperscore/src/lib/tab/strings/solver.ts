import type { StringChart } from './charts';

export type FingerModifier = '' | 'L' | 'H';
/** Written pitch class; a mismatched hint is ignored, never changes MIDI. */
export interface PitchSpelling {
  step: 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G';
  alter: -2 | -1 | 0 | 1 | 2;
}
const STEP_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
export interface StringFingering {
  /** 1 = highest string; position 0 denotes an open string, no hand position. */
  string: number;
  position: number;
  finger: number;
  modifier: FingerModifier;
}
const SHIFTS: Record<FingerModifier, number> = { '': 0, L: -1, H: 1 };

/** Reverse lookup, useful for fixtures and future fixed-fingering constraints.
 * Open strings require canonical position 0 and no modifier.
 */
export function fingeringPitch(chart: StringChart, note: StringFingering): number | null {
  if (!Number.isInteger(note.string) || !Number.isInteger(note.finger)) return null;
  const open = chart.openMidi[note.string - 1];
  if (open === undefined || !Object.hasOwn(SHIFTS, note.modifier)) return null;
  if (note.finger === 0) return note.position === 0 && note.modifier === '' ? open : null;
  if (note.finger < 1 || note.finger > 4) return null;
  const base = chart.fingers[note.string - 1]?.[note.position]?.[note.finger - 1];
  if (base === undefined) return null;
  const pitch = base + SHIFTS[note.modifier];
  return pitch > open && pitch <= 127 ? pitch : null;
}

/** Exact-pitch choices, opens first. Cello/bass prefer plain fingers anywhere
 * over extensions, then I before half position, then higher positions.
 * Violin/viola prefer lower positions, then plain fingers. Modified ties use
 * the matching spelling: raised (including double sharps) → H, otherwise L.
 * Without a valid hint, C#/D#/G# prefer H (high 3 rather than low 4);
 * other pitch classes prefer L, preserving low 2 and the flat-note default.
 * No octave fold, phrase continuity, double-stop or ringing-string solve.
 */
export function fingeringCandidates(chart: StringChart, midi: number, spelling?: PitchSpelling): StringFingering[] {
  if (!Number.isInteger(midi) || midi < 0 || midi > 127) return [];
  const candidates: StringFingering[] = [];
  chart.openMidi.forEach((open, index) => {
    const string = index + 1;
    if (midi === open) candidates.push({ string, position: 0, finger: 0, modifier: '' });
    for (const [key, row] of Object.entries(chart.fingers[index] ?? {})) {
      row.forEach((base, fingerIndex) => {
        const delta = midi - base;
        if (midi > open && Math.abs(delta) <= 1) {
          candidates.push({ string, position: Number(key), finger: fingerIndex + 1,
            modifier: delta === -1 ? 'L' : delta === 1 ? 'H' : '' });
        }
      });
    }
  });
  const chromatic = chart.id === 'cello' || chart.id === 'double-bass';
  const matching = spelling && ((STEP_PC[spelling.step] + spelling.alter + 12) % 12 === midi % 12);
  const preferred = (matching ? spelling.alter > 0 : [1, 3, 8].includes(midi % 12)) ? 'H' : 'L';
  const modified = (note: StringFingering) => Number(note.modifier !== '');
  const positionRank = (note: StringFingering) => chromatic && note.position === 0.5 ? 1.25 : note.position;
  return candidates.sort((a, b) => Number(b.finger === 0) - Number(a.finger === 0)
    || (chromatic ? modified(a) - modified(b) : 0)
    || positionRank(a) - positionRank(b) || modified(a) - modified(b)
    || a.string - b.string
    || Number(a.modifier !== preferred) - Number(b.modifier !== preferred)
    || a.finger - b.finger);

}

/** Null means outside the supported chart range, never silently transposed. */
export function solveStringPitch(chart: StringChart, midi: number, spelling?: PitchSpelling): StringFingering | null {
  return fingeringCandidates(chart, midi, spelling)[0] ?? null;
}
