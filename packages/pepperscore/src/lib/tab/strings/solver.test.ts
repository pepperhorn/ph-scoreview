import { describe, expect, it } from 'vitest';
import { CELLO, CELLO_POSITIONS, DOUBLE_BASS, STRING_CHARTS, VIOLA, VIOLIN } from './charts';
import { fingeringCandidates, fingeringPitch, solveStringPitch } from './solver';

describe('ported charts', () => {
  it('preserves every literal violin row, including string-dependent patterns', () => {
    const expected = [
      [[78,80,81,83],[79,81,83,85],[81,83,85,86],[83,85,86,88]],
      [[71,73,74,76],[72,74,76,77],[74,76,77,79],[76,77,79,81]],
      [[64,66,67,69],[65,67,69,71],[67,69,71,72],[69,71,72,74]],
      [[57,59,60,62],[58,60,62,64],[60,62,64,65],[62,64,66,67]],
    ];
    VIOLIN.fingers.forEach((positions, string) => {
      [1,2,3,4].forEach((position, p) => expect(positions[position]).toEqual(expected[string][p]));
    });
  });
  it('corrects Davidoff keys on all cello strings without changing pitches', () => {
    expect(CELLO_POSITIONS).toEqual([0.5, 1, 1.5, 2, 3, 3.5, 4, 4.5]);
    CELLO.fingers.forEach((positions, s) => {
      expect(positions[2.5]).toBeUndefined();
      CELLO_POSITIONS.forEach((position, index) => {
        const first = CELLO.openMidi[s] + [1,2,3,4,5,6,7,8][index];
        expect(positions[position]).toEqual([first, first+1, first+2, first+3]);
      });
    });
    expect(CELLO.fingers[3][4.5]).toEqual([44,45,46,47]);
  });
  it('marks analogies and preserves spec tunings at sounding pitch', () => {
    expect(VIOLA.provenance).toBe('derived');
    expect(DOUBLE_BASS.provenance).toBe('derived');
    expect(VIOLA.openMidi).toEqual([69,62,55,48]);
    expect(DOUBLE_BASS.openMidi).toEqual([43,38,33,28]);
    expect(VIOLA.fingers[3][1]).toEqual([50,52,53,55]);
    expect(DOUBLE_BASS.fingers[3][1]).toEqual([30,31,32,33]);
  });
});

describe.each(Object.values(STRING_CHARTS))('$id pitch solver', chart => {
  it('prefers every open string, even over a stopped lower-position choice', () => {
    chart.openMidi.forEach((midi, index) => expect(solveStringPitch(chart, midi)).toEqual({
      string: index + 1, finger: 0, position: 0, modifier: '',
    }));
  });
  it('round-trips every chart finger and L/H alternative on every string/position', () => {
    chart.fingers.forEach((positions, index) => {
      for (const [position, row] of Object.entries(positions)) {
        row.forEach((base, finger) => {
          for (const modifier of ['', 'L', 'H'] as const) {
            const midi = base + (modifier === 'L' ? -1 : modifier === 'H' ? 1 : 0);
            if (midi <= chart.openMidi[index]) continue;
            const candidate = { string: index+1, position: Number(position), finger: finger+1, modifier };
            expect(fingeringPitch(chart, candidate)).toBe(midi);
            expect(fingeringCandidates(chart, midi)).toContainEqual(candidate);
          }
        });
      }
    });
  });
  it('returns exact pitches across MIDI range and rejects out-of-range inputs', () => {
    for (let midi = 0; midi <= 127; midi++) {
      const result = solveStringPitch(chart, midi);
      if (result) expect(fingeringPitch(chart, result)).toBe(midi);
    }
    for (const midi of [-1, 128, NaN, Infinity, 60.5, 0, 127]) expect(solveStringPitch(chart, midi)).toBeNull();
  });
});

it('prefers lower position before modifier, natural before modified within position', () => {
  expect(solveStringPitch(VIOLIN, 77)).toEqual({ string: 1, position: 1, finger: 1, modifier: 'L' });
  expect(solveStringPitch(VIOLIN, 81)).toEqual({ string: 1, position: 1, finger: 3, modifier: '' });
  expect(solveStringPitch(VIOLIN, 89)).toEqual({ string: 1, position: 4, finger: 4, modifier: 'H' });
  expect(solveStringPitch(VIOLIN, 90)).toBeNull();
});
it('rejects invalid or noncanonical fixed fingerings', () => {
  const good = { string: 1, position: 1, finger: 1, modifier: '' as const };
  for (const delta of [{ string: 0 }, { string: 1.5 }, { finger: 5 }, { finger: -1 }, { finger: 1.5 }, { position: 2.5 }, { finger: 0 }]) {
    expect(fingeringPitch(CELLO, { ...good, ...delta })).toBeNull();
  }
});
