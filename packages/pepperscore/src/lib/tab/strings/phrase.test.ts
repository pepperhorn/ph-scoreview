import { describe, expect, it } from 'vitest';
import { CELLO, VIOLIN } from './charts';
import { solveFingerPhrase, type FingerNote } from './phrase';
import { fingeringCandidates, fingeringPitch } from './solver';

const passage = (pitches: number[]): FingerNote[] => pitches.map((midi, i) => ({ id: String(i), onset: i, duration: 1, midi }));
const positions = (notes: FingerNote[], chart = VIOLIN) => [...solveFingerPhrase(chart, notes).values()].map(f => f.position).filter(Boolean);
const shifts = (ps: number[]) => ps.slice(1).filter((p, i) => p !== ps[i]).length;

describe('phrase position continuity', () => {
  it('keeps a first-position cello scale in I instead of visiting half and II', () => {
    expect(positions(passage([38, 40, 41, 42, 41, 40, 38]), CELLO)).toEqual(Array(7).fill(1));
  });
  it('makes one necessary shift and stays there through ambiguous notes', () => {
    const ps = positions(passage([57, 59, 60, 62, 89, 85, 89, 85, 89]));
    expect(ps[0]).toBe(1);
    expect(ps.at(-1)).toBe(4);
    expect(shifts(ps)).toBe(1);
  });
  it('carries the hand through open strings without shifting', () => {
    const notes = passage([89, 76, 85, 76, 89]);
    const solved = solveFingerPhrase(VIOLIN, notes);
    expect([...solved.values()].map(f => f.position)).toEqual([4, 0, 4, 0, 4]);
    notes.forEach(n => expect(fingeringPitch(VIOLIN, solved.get(n.id)!)).toBe(n.midi));
  });
  it('preserves fixed choices, ties, held strings and common chord positions', () => {
    const fixed = { string: 2, position: 3, finger: 1, modifier: '' as const };
    const notes: FingerNote[] = [
      { id: 'a', midi: 74, onset: 0, duration: 2, fixed },
      { id: 'b', midi: 81, onset: 1, duration: 1 },
      { id: 'c', midi: 74, onset: 2, duration: 1, tieStop: true },
      { id: 'd', midi: 81, onset: 2, duration: 1 },
    ];
    const solved = solveFingerPhrase(VIOLIN, notes);
    expect(solved.size).toBe(4);
    expect(solved.get('a')).toEqual(fixed);
    expect(solved.get('c')).toEqual(fixed);
    for (const id of ['b', 'd']) {
      expect(solved.get(id)?.position).toBe(3);
      expect(solved.get(id)?.string).not.toBe(2);
    }
    notes.forEach(n => expect(fingeringPitch(VIOLIN, solved.get(n.id)!)).toBe(n.midi));
  });
  it('keeps an earlier alternative that permits a later fixed note on a held chord', () => {
    const notes: FingerNote[] = [
      { id: 'held', midi: 74, onset: 0, duration: 2 },
      { id: 'fixed', midi: 81, onset: 1, duration: 1,
        fixed: { string: 2, position: 4, finger: 4, modifier: '' } },
    ];
    const solved = solveFingerPhrase(VIOLIN, notes);
    expect(solved.size).toBe(2);
    expect(solved.get('held')?.string).not.toBe(2);
    expect(solved.get('held')?.position).toBe(4);
    expect(solved.get('fixed')).toEqual(notes[1].fixed);
  });
  it('leaves unsupported notes and oversized chords unlabelled', () => {
    expect(solveFingerPhrase(VIOLIN, passage([0, 127, 90])).size).toBe(0);
    const chord = passage([55, 62, 69, 76, 81]).map(n => ({ ...n, onset: 0 }));
    expect(solveFingerPhrase(VIOLIN, chord).size).toBe(0);
  });
  it.each([VIOLIN, CELLO])('round-trips all supported pitches for $id in a long passage', chart => {
    const notes = passage(Array.from({ length: 4096 }, (_, i) => chart.openMidi[3] + i % 35));
    const solved = solveFingerPhrase(chart, notes);
    for (const note of notes) {
      const f = solved.get(note.id);
      expect(Boolean(f)).toBe(fingeringCandidates(chart, note.midi!).length > 0);
      if (f) expect(fingeringPitch(chart, f)).toBe(note.midi);
    }
  });
  it.each([
    [VIOLIN, [57,59,60,62], [58,61,62,65]],
    [CELLO, [36,38,40,41], [37,38,41,69]],
  ] as const)('reduces changes in the dense validation/tab.mjs $id fixture', (chart, naturals, chromatic) => {
    const notes = passage(Array.from({ length: 128 }, (_, i) => (i < 16 ? naturals : chromatic)[i % 4]));
    const solved = solveFingerPhrase(chart, notes);
    expect(solved.size).toBe(128);
    const changes = shifts([...solved.values()].map(f => f.position).filter(Boolean));
    expect(changes).toBe(chart.id === 'violin' ? 0 : 55);
    notes.forEach(n => expect(fingeringPitch(chart, solved.get(n.id)!)).toBe(n.midi));
  });
});
