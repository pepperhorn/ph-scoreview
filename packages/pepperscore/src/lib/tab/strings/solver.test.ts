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

// r1: distinguish conventional low fingers from their enharmonic high fingers.
describe('spelling-aware violin ranking', () => {
  it.each([
    [72, 2, 2], // C5 on A
    [65, 3, 2], // F4 on D
    [58, 4, 2], // Bb3 on G
    [82, 1, 4], // Bb5 on E
  ])('defaults MIDI %i to low finger on string %i', (midi, string, finger) => {
    expect(solveStringPitch(VIOLIN, midi)).toEqual({ string, position: 1, finger, modifier: 'L' });
  });
  it.each([
    [72, { step: 'C', alter: 0 }, 2, 2, 'L'],
    [65, { step: 'F', alter: 0 }, 3, 2, 'L'],
    [58, { step: 'B', alter: -1 }, 4, 2, 'L'],
    [58, { step: 'A', alter: 1 }, 4, 1, 'H'],
    [82, { step: 'B', alter: -1 }, 1, 4, 'L'],
    [82, { step: 'A', alter: 1 }, 1, 3, 'H'],
    [72, { step: 'B', alter: 1 }, 2, 1, 'H'],
    [65, { step: 'E', alter: 1 }, 3, 1, 'H'],
  ] as const)('uses spelling %o / %o', (midi, spelling, string, finger, modifier) => {
    const result = solveStringPitch(VIOLIN, midi, spelling);
    expect(result).toEqual({ string, position: 1, finger, modifier });
    expect(fingeringPitch(VIOLIN, result!)).toBe(midi);
    expect(fingeringCandidates(VIOLIN, midi, spelling)[0]).toEqual(result);
  });
  it('ignores a mismatched spelling and keeps opens and plain fingers first', () => {
    expect(solveStringPitch(VIOLIN, 58, { step: 'C', alter: 1 })).toEqual(solveStringPitch(VIOLIN, 58));
    expect(solveStringPitch(VIOLIN, 76, { step: 'F', alter: -1 })).toEqual({ string: 1, position: 0, finger: 0, modifier: '' });
    expect(solveStringPitch(VIOLIN, 80, { step: 'G', alter: 1 })).toEqual({ string: 1, position: 1, finger: 2, modifier: '' });
  });
});

describe('chromatic cello/bass ranking', () => {
  it.each([
    [41, 4, 1, 4], // F2
    [42, 4, 1.5, 4], // F#2
    [62, 1, 1, 4], // D4
    [65, 1, 3, 4], // F4
  ])('prefers plain cello MIDI %i over a lower extension', (midi, string, position, finger) => {
    expect(solveStringPitch(CELLO, midi)).toEqual({ string, position, finger, modifier: '' });
  });
  it('prefers a plain bass finger even with a sharp spelling; keeps open strings first', () => {
    expect(solveStringPitch(DOUBLE_BASS, 48, { step: 'B', alter: 1 })).toEqual({ string: 1, position: 1, finger: 4, modifier: '' });
    expect(solveStringPitch(DOUBLE_BASS, 33)).toEqual({ string: 3, position: 0, finger: 0, modifier: '' });
  });
  it('retains modifiers when the chart has no plain candidate', () => {
    expect(solveStringPitch(CELLO, 69)).toEqual({ string: 1, position: 4.5, finger: 4, modifier: 'H' });
    expect(solveStringPitch(CELLO, 69, { step: 'A', alter: 0 })).toEqual(solveStringPitch(CELLO, 69));
  });
});

describe('r2 conventional position and unhinted spelling defaults', () => {
  it.each([
    [38, 4, 1], [40, 4, 3], // D2, E2
    [45, 3, 1], [47, 3, 3], // A2, B2
    [52, 2, 1], [53, 2, 2], // E3, F3
    [59, 1, 1], [60, 1, 2], // B3, C4
  ])('keeps cello MIDI %i in first position', (midi, string, finger) => {
    expect(solveStringPitch(CELLO, midi)).toEqual({ string, position: 1, finger, modifier: '' });
  });
  it('keeps a two-octave C major scale in first position across open strings', () => {
    const pitches = [36,38,40,41,43,45,47,48,50,52,53,55,57,59,60];
    const notes = pitches.map(midi => solveStringPitch(CELLO, midi)!);
    expect(notes.map(n => n.position)).toEqual([0,1,1,1,0,1,1,1,0,1,1,1,0,1,1]);
    expect(notes.filter(n => n.finger !== 0).every(n => n.position === 1 && n.modifier === '')).toBe(true);
    notes.forEach((note, i) => expect(fingeringPitch(CELLO, note)).toBe(pitches[i]));
  });
  it.each([CELLO, DOUBLE_BASS])('prefers first to half on every $id string, keeping half for open+1', chart => {
    chart.openMidi.forEach((open, index) => {
      for (const [offset, position, finger] of [[1,0.5,1],[2,1,1],[3,1,2],[4,1,3]] as const) {
        // Inspect this string's candidates as another string may be open.
        const candidate = fingeringCandidates(chart, open + offset).find(n => n.string === index + 1);
        expect(candidate).toEqual({ string: index + 1, position, finger, modifier: '' });
      }
    });
    expect(solveStringPitch(chart, chart.openMidi[3] + 1)).toEqual({ string: 4, position: 0.5, finger: 1, modifier: '' });
  });
  it.each([
    [61, 4, 'D'], // C#4 / Db4
    [68, 3, 'A'], // G#4 / Ab4
    [75, 2, 'E'], // D#5 / Eb5
  ] as const)('defaults violin MIDI %i to high 3 but respects a flat hint', (midi, string, flatStep) => {
    const result = solveStringPitch(VIOLIN, midi);
    expect(result).toEqual({ string, position: 1, finger: 3, modifier: 'H' });
    expect(fingeringPitch(VIOLIN, result!)).toBe(midi);
    expect(solveStringPitch(VIOLIN, midi, { step: flatStep, alter: -1 })).toEqual({ string, position: 1, finger: 4, modifier: 'L' });
  });
});
