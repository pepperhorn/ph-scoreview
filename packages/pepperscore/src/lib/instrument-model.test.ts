import { EMBED_INSTRUMENTS, INSTRUMENTS, writtenKeyFifths, instrumentFor, spelledSoundingMidi as soundingMidi, transposePitch, transposePitchSpelled, writtenPitch, type InstrumentId } from './instrument-model';

const alto = INSTRUMENTS['alto-saxophone'];
const clarinet = INSTRUMENTS.clarinet;

test('the sixteen viewer instruments, keyed by id', () => {
  const ids: InstrumentId[] = ['piano', 'guitar', 'bassguitar', 'double-bass', 'drum-kit', 'alto-saxophone', 'tenor-saxophone', 'bari-saxophone', 'flute', 'clarinet', 'trumpet', 'trombone', 'violin', 'viola', 'cello', 'microphone'];
  expect(Object.keys(INSTRUMENTS).sort()).toEqual([...ids].sort());
  for (const id of ids) expect(INSTRUMENTS[id].id).toBe(id);
});

test('transpositions are written minus sounding', () => {
  expect(alto.transposition).toEqual({ semitones: 9, diatonic: 5 });
  expect(clarinet.transposition).toEqual({ semitones: 2, diatonic: 1 });
  expect(INSTRUMENTS.trumpet.transposition).toEqual({ semitones: 2, diatonic: 1 });
  expect(INSTRUMENTS['tenor-saxophone'].transposition).toEqual({ semitones: 14, diatonic: 8 });
  expect(INSTRUMENTS['bari-saxophone'].transposition).toEqual({ semitones: 21, diatonic: 12 });
  for (const id of ['guitar', 'bassguitar', 'double-bass'] as const) expect(INSTRUMENTS[id].transposition).toEqual({ semitones: 12, diatonic: 7 });
  for (const id of ['piano', 'flute', 'trombone', 'violin', 'viola', 'cello', 'microphone', 'drum-kit'] as const) expect(INSTRUMENTS[id].transposition).toEqual({ semitones: 0, diatonic: 0 });
});

test('ranges per level in sounding MIDI; none for the drum kit', () => {
  expect(INSTRUMENTS.flute.ranges).toEqual({ beginner: { low: 60, high: 84 }, intermediate: { low: 60, high: 91 }, advanced: { low: 59, high: 96 } });
  expect(INSTRUMENTS.trombone.ranges?.advanced).toEqual({ low: 34, high: 77 });
  expect(INSTRUMENTS.piano.ranges).toEqual({ beginner: { low: 21, high: 108 }, intermediate: { low: 21, high: 108 }, advanced: { low: 21, high: 108 } });
  expect(INSTRUMENTS['drum-kit'].ranges).toBeUndefined();
  for (const inst of Object.values(INSTRUMENTS)) {
    if (!inst.ranges) continue;
    const { beginner, intermediate, advanced } = inst.ranges;
    expect(advanced.low).toBeLessThanOrEqual(intermediate.low);
    expect(intermediate.low).toBeLessThanOrEqual(beginner.low);
    expect(beginner.high).toBeLessThanOrEqual(intermediate.high);
    expect(intermediate.high).toBeLessThanOrEqual(advanced.high);
  }
});

test('instrumentFor maps a GM program to the nearest instrument, defaulting to piano', () => {
  expect(instrumentFor(74).id).toBe('flute');
  expect(instrumentFor(66).id).toBe('alto-saxophone');
  expect(instrumentFor(65).id).toBe('alto-saxophone');
  expect(instrumentFor(57).id).toBe('trumpet');
  expect(instrumentFor(43).id).toBe('cello');
  expect(instrumentFor(30).id).toBe('guitar');
  expect(instrumentFor(5).id).toBe('piano');
  expect(instrumentFor(120).id).toBe('piano');
  expect(instrumentFor(0).id).toBe('piano');
});

test('soundingMidi takes the transposition off the written pitch', () => {
  expect(soundingMidi({ step: 'C', octave: 5, alter: 0 }, alto.transposition)).toBe(63);
  expect(soundingMidi({ step: 'C', octave: 4, alter: 0 }, INSTRUMENTS.flute.transposition)).toBe(60);
});

test('writtenPitch spells the transposed note for the key', () => {
  expect(writtenPitch(63, alto.transposition, 0)).toEqual({ step: 'C', octave: 5, alter: 0 });
  expect(writtenPitch(61, clarinet.transposition, 2)).toEqual({ step: 'D', octave: 4, alter: 1 });
  // flat keys take flats, sharp keys and C major take sharps for chromatic notes
  expect(writtenPitch(61, INSTRUMENTS.flute.transposition, -3)).toEqual({ step: 'D', octave: 4, alter: -1 });
  expect(writtenPitch(61, INSTRUMENTS.flute.transposition, 0)).toEqual({ step: 'C', octave: 4, alter: 1 });
  // the key's own accidentals win: Bb in F major, F# in G major
  expect(writtenPitch(70, INSTRUMENTS.flute.transposition, -1)).toEqual({ step: 'B', octave: 4, alter: -1 });
  expect(writtenPitch(66, INSTRUMENTS.flute.transposition, 1)).toEqual({ step: 'F', octave: 4, alter: 1 });
  // across the octave boundary: C# major's B# and Cb major's Cb win over the naturals
  expect(writtenPitch(60, INSTRUMENTS.flute.transposition, 7)).toEqual({ step: 'B', octave: 3, alter: 1 });
  expect(writtenPitch(71, INSTRUMENTS.flute.transposition, -7)).toEqual({ step: 'C', octave: 5, alter: -1 });
  expect(writtenPitch(60, INSTRUMENTS.flute.transposition, 2)).toEqual({ step: 'C', octave: 4, alter: 0 });
});

const P = (step: 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G', octave: number, alter = 0) => ({ step, octave, alter });
const toConcert = (t: { semitones: number; diatonic: number }) => ({ semitones: -t.semitones, diatonic: -t.diatonic });

test('transposePitch keeps the spelling: it moves the step by the diatonic interval and fits the alter', () => {
  // A clarinet written C5 (D major written key) is concert Bb4, not A#4.
  expect(transposePitch(P('C', 5), toConcert(clarinet.transposition))).toEqual(P('B', 4, -1));
  // Written Bb4 on the clarinet is concert Ab4.
  expect(transposePitch(P('B', 4, -1), toConcert(clarinet.transposition))).toEqual(P('A', 4, -1));
  // Cb + 1 semitone, 0 steps is C natural.
  expect(transposePitch(P('C', 4, -1), { semitones: 1, diatonic: 0 })).toEqual(P('C', 4));
  // Octave carry both ways.
  expect(transposePitch(P('B', 3, -1), { semitones: 9, diatonic: 5 })).toEqual(P('G', 4));
  expect(transposePitch(P('C', 5), { semitones: -14, diatonic: -8 })).toEqual(P('B', 3, -1));
  expect(transposePitch(P('F', 4, 1), { semitones: 0, diatonic: 0 })).toEqual(P('F', 4, 1));
});

test('transposePitch falls back to writtenPitch spelling when the alter would pass a double accidental', () => {
  // F## up an augmented-fifth-ish 8 semitones over 4 steps would need C###.
  const spelled = transposePitchSpelled(P('F', 4, 2), { semitones: 8, diatonic: 4 }, 0);
  expect(spelled.respelled).toBe(true);
  expect(spelled.pitch).toEqual(writtenPitch(67 + 8, { semitones: 0, diatonic: 0 }, 0));
  expect(transposePitchSpelled(P('C', 5), { semitones: -2, diatonic: -1 }, 0)).toEqual({ pitch: P('B', 4, -1), respelled: false });
});

test('embed list is the eleven embed instruments in order', () => {
  expect(EMBED_INSTRUMENTS).toEqual(['alto-saxophone', 'tenor-saxophone', 'bari-saxophone', 'trumpet', 'trombone', 'flute', 'clarinet', 'violin', 'viola', 'cello', 'double-bass']);
  for (const id of EMBED_INSTRUMENTS) expect(INSTRUMENTS[id].ranges).toBeDefined();
});

test('writtenKeyFifths adds the transposition as fifths, normalised to -6..6 and wrapped into -7..7', () => {
  expect(writtenKeyFifths(0, alto.transposition)).toBe(3);
  expect(writtenKeyFifths(0, INSTRUMENTS.clarinet.transposition)).toBe(2);
  expect(writtenKeyFifths(0, INSTRUMENTS['tenor-saxophone'].transposition)).toBe(2);
  expect(writtenKeyFifths(-2, INSTRUMENTS.guitar.transposition)).toBe(-2);
  expect(writtenKeyFifths(0, { semitones: -2, diatonic: -1 })).toBe(-2);
  expect(writtenKeyFifths(6, alto.transposition)).toBe(-3);
});
