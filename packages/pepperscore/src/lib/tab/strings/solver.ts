import type { StringChart } from './charts';

export type FingerModifier = '' | 'L' | 'H';
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
  if (open === undefined || !(note.modifier in SHIFTS)) return null;
  if (note.finger === 0) return note.position === 0 && note.modifier === '' ? open : null;
  if (note.finger < 1 || note.finger > 4) return null;
  const base = chart.fingers[note.string - 1]?.[note.position]?.[note.finger - 1];
  if (base === undefined) return null;
  const pitch = base + SHIFTS[note.modifier];
  return pitch > open && pitch <= 127 ? pitch : null;
}

/** All exact-pitch choices: opens first, then lower position, then unmodified,
 * then highest string and lower finger; L wins a final L/H tie. No octave fold.
 * Pitch-only spike: no phrase continuity, double-stop or ringing-string solve.
 */
export function fingeringCandidates(chart: StringChart, midi: number): StringFingering[] {
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
  return candidates.sort((a, b) => a.position - b.position
    || Number(a.modifier !== '') - Number(b.modifier !== '')
    || a.string - b.string || a.finger - b.finger || a.modifier.localeCompare(b.modifier));
}

/** Null means outside the supported chart range, never silently transposed. */
export function solveStringPitch(chart: StringChart, midi: number): StringFingering | null {
  return fingeringCandidates(chart, midi)[0] ?? null;
}
