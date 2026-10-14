import { createDocument } from '../../model/create';
import { INSTRUMENTS } from '../../model/instruments';
import { checkInvariants } from '../../model/invariants';
import { effectiveKey, eventStarts } from '../../model/query';
import type { Document, Event, Note, Part, Pitch } from '../../model/schema';
import { fixedIds } from '../../test-helpers';
import { fitToRange, phrases, writtenKeyFifths, type FitOptions } from './range-fit';

const P = (step: Pitch['step'], octave: number, alter = 0): Pitch => ({ step, octave, alter });
const note = (id: string, pitch: Pitch, extra: Partial<Note> = {}): Note => ({ id, pitch, ...extra });
const q = (id: string, pitches: Pitch[], extra: Partial<Event> = {}): Event => ({
  id, type: 'event', duration: { base: 'quarter', dots: 0 }, notes: pitches.map((p, i) => note(`${id}n${i}`, p)), ...extra,
});
const e8 = (id: string, p: Pitch): Event => ({ id, type: 'event', duration: { base: 'eighth', dots: 0 }, notes: [note(`${id}n0`, p)] });
const rest8 = (id: string): Event => ({ id, type: 'event', duration: { base: 'eighth', dots: 0 }, rest: true });

/** A one-staff part (gmProgram, optional transposition) of `bars` 4/4 bars whose bar contents are given. */
function doc(gmProgram: number, bars: Event[][], transposition?: { semitones: number; diatonic: number }): Document {
  const d = fixedIds(createDocument({ parts: [{ name: 'Source', clef: 'treble', gmProgram }], measures: bars.length }));
  bars.forEach((content, i) => { d.parts[0].measures[i].sequences[0].content = content; });
  if (transposition) d.parts[0].transposition = transposition;
  return d;
}

const pitches = (part: Part): Record<string, Pitch[]> => {
  const out: Record<string, Pitch[]> = {};
  for (const pm of part.measures) for (const seq of pm.sequences) for (const { event } of eventStarts(seq)) if (event.notes) out[event.id] = event.notes.map((n) => n.pitch);
  return out;
};

const fit = (d: Document, options: Partial<FitOptions> & Pick<FitOptions, 'target' | 'level'>) => {
  const result = fitToRange(d.parts[0], { keyByMeasure: (i) => effectiveKey(d, i), overrides: {}, autoRange: true, transposing: true, ...options });
  expect(checkInvariants({ ...d, parts: [result.part] })).toEqual([]);
  return result;
};

const alto = INSTRUMENTS['alto-saxophone'];

test('writtenKeyFifths adds the transposition as fifths, normalised to -6..6 and wrapped into -7..7', () => {
  expect(writtenKeyFifths(0, alto.transposition)).toBe(3);
  expect(writtenKeyFifths(0, INSTRUMENTS.clarinet.transposition)).toBe(2);
  expect(writtenKeyFifths(0, INSTRUMENTS['tenor-saxophone'].transposition)).toBe(2);
  expect(writtenKeyFifths(-2, INSTRUMENTS.guitar.transposition)).toBe(-2);
  expect(writtenKeyFifths(0, { semitones: -2, diatonic: -1 })).toBe(-2);
  expect(writtenKeyFifths(6, alto.transposition)).toBe(-3);
});

test('phrases break at rests, after a slur end and at the bar line', () => {
  const d = doc(74, [
    [q('a', [P('C', 5)], { slurs: [{ id: 's', target: 'b' }] }), q('b', [P('D', 5)]), q('c', [P('E', 5)]), rest8('r'), e8('d', P('F', 5))],
    [{ ...q('e', [P('G', 5)]), duration: { base: 'whole', dots: 0 } }],
  ]);
  expect(phrases(d.parts[0]).map((p) => p.eventIds)).toEqual([['a', 'b'], ['c'], ['d'], ['e']]);
});

test('a tie across the bar line joins the two phrases', () => {
  const d = doc(74, [
    [q('a', [P('D', 4)]), q('b', [P('D', 4)]), { id: 'c', type: 'event', duration: { base: 'half', dots: 0 }, notes: [note('cn0', P('G', 5), { tie: { target: 'dn0' } })] }],
    [{ id: 'd', type: 'event', duration: { base: 'half', dots: 0 }, notes: [note('dn0', P('G', 5))] }, { id: 'r', type: 'event', duration: { base: 'half', dots: 0 }, rest: true }],
  ]);
  expect(phrases(d.parts[0]).map((p) => p.eventIds)).toEqual([['a', 'b', 'c', 'd']]);
  const { moved } = fit(d, { target: alto, level: 'beginner' });
  expect(moved).toEqual({ a: -12, b: -12, c: -12, d: -12 });
});

test('tenor sax written C5 (sounding Bb3) as alto sax is written G4; a major third up it is B4; nothing moves in range', () => {
  const tenor = INSTRUMENTS['tenor-saxophone'];
  const d = doc(67, [[{ ...q('a', [P('C', 5)]), duration: { base: 'whole', dots: 0 } }]], tenor.transposition);
  const plain = fit(d, { target: alto, level: 'intermediate' });
  expect(pitches(plain.part).a).toEqual([P('G', 4)]);
  expect(plain.moved).toEqual({});
  const third = fit(d, { target: alto, level: 'intermediate', interval: { semitones: 4, diatonic: 2 } });
  expect(pitches(third.part).a).toEqual([P('B', 4)]);
  expect(third.moved).toEqual({});
});

test('a phrase above the alto beginner range moves 8vb as one, up to the following rest', () => {
  // Concert C5 E5 G5 (72-79) are above 49-69; the D4 after the rest is in range and stays.
  const d = doc(74, [[q('a', [P('C', 5)]), q('b', [P('E', 5)]), q('c', [P('G', 5)]), rest8('r'), e8('d', P('D', 4))]]);
  const { part, moved, diagnostics } = fit(d, { target: alto, level: 'beginner' });
  expect(moved).toEqual({ a: -12, b: -12, c: -12 });
  expect(diagnostics).toEqual([]);
  // Sounding C4 E4 G4, written for alto (+M6): A4 C#5 E5; D4 sounding is written B4.
  expect(pitches(part)).toEqual({ a: [P('A', 4)], b: [P('C', 5, 1)], c: [P('E', 5)], d: [P('B', 4)] });
});

test('an in-range note inside an out-of-range phrase moves with it', () => {
  const d = doc(74, [[q('a', [P('C', 5)]), q('b', [P('A', 4)]), q('c', [P('G', 5)]), { id: 'r', type: 'event', duration: { base: 'quarter', dots: 0 }, rest: true }]]);
  const { part, moved } = fit(d, { target: alto, level: 'beginner' });
  expect(moved).toEqual({ a: -12, b: -12, c: -12 });
  // A4 (69, in range) becomes sounding A3, written F#4 for alto.
  expect(pitches(part).b).toEqual([P('F', 4, 1)]);
});

test('a phrase out of range both ways is not shifted and reports a diagnostic', () => {
  const d = doc(1, [[q('a', [P('C', 2)]), q('b', [P('C', 6)]), { id: 'r', type: 'event', duration: { base: 'half', dots: 0 }, rest: true }]]);
  const { moved, diagnostics } = fit(d, { target: alto, level: 'beginner' });
  expect(moved).toEqual({});
  expect(diagnostics).toHaveLength(1);
  expect(diagnostics[0]).toMatch(/both/);
});

test('below the range moves 8va; overrides beat the computed shift for their event only', () => {
  // Concert C3 D3 (48, 50): C3 is below 49, so the phrase moves up.
  const d = doc(1, [[q('a', [P('C', 3)]), q('b', [P('D', 3)]), { id: 'r', type: 'event', duration: { base: 'quarter', dots: 0 }, rest: true }, q('c', [P('D', 4)])]]);
  expect(fit(d, { target: alto, level: 'beginner' }).moved).toEqual({ a: 12, b: 12 });
  const overridden = fit(d, { target: alto, level: 'beginner', overrides: { a: 0, c: -12 } });
  expect(overridden.moved).toEqual({ b: 12, c: -12 });
  // Overrides apply even with autoRange off.
  expect(fit(d, { target: alto, level: 'beginner', autoRange: false, overrides: { c: 12 } }).moved).toEqual({ c: 12 });
});

test('a non-transposing fit writes concert pitch; an unpitched target skips fitting', () => {
  const d = doc(74, [[q('a', [P('C', 5)]), q('b', [P('E', 5)]), { id: 'r', type: 'event', duration: { base: 'half', dots: 0 }, rest: true }]]);
  expect(pitches(fit(d, { target: alto, level: 'beginner', transposing: false }).part)).toEqual({ a: [P('C', 4)], b: [P('E', 4)] });
  const drums = fit(d, { target: INSTRUMENTS['drum-kit'], level: 'beginner' });
  expect(drums.moved).toEqual({});
  expect(pitches(drums.part)).toEqual({ a: [P('C', 5)], b: [P('E', 5)] });
});

test('chords: one out-of-range note shifts the whole event', () => {
  const d = doc(74, [[q('a', [P('C', 4), P('C', 5)]), { id: 'r', type: 'event', duration: { base: 'half', dots: 0 }, rest: true }, q('b', [P('D', 4)])]]);
  const { part, moved } = fit(d, { target: alto, level: 'beginner', transposing: false });
  expect(moved).toEqual({ a: -12 });
  expect(pitches(part).a).toEqual([P('C', 3), P('C', 4)]);
});

test('an override on one note of a tie moves its whole tie chain, so the tie holds', () => {
  const d = doc(74, [
    [q('a', [P('D', 4)]), q('b', [P('D', 4)]), { id: 'c', type: 'event', duration: { base: 'half', dots: 0 }, notes: [note('cn0', P('G', 5), { tie: { target: 'dn0' } })] }],
    [{ id: 'd', type: 'event', duration: { base: 'half', dots: 0 }, notes: [note('dn0', P('G', 5))] }, { id: 'r', type: 'event', duration: { base: 'half', dots: 0 }, rest: true }],
  ]);
  expect(fit(d, { target: alto, level: 'beginner', overrides: { c: 0 } }).moved).toEqual({ a: -12, b: -12 });
  expect(fit(d, { target: alto, level: 'beginner', autoRange: false, overrides: { d: 12 } }).moved).toEqual({ c: 12, d: 12 });
});

test('a phrase still out of range after its octave keeps the move and reports it', () => {
  // Concert C6 (84) moves to C5 (72), still above the alto beginner top (69).
  const d = doc(74, [[q('a', [P('C', 6)]), { id: 'r', type: 'event', duration: { base: 'half', dots: 1 }, rest: true }]]);
  const { moved, diagnostics } = fit(d, { target: alto, level: 'beginner' });
  expect(moved).toEqual({ a: -12 });
  expect(diagnostics).toHaveLength(1);
  expect(diagnostics[0]).toMatch(/still out of/);
});

test('a shift past octave 9 is skipped with a diagnostic', () => {
  const d = doc(1, [[q('a', [P('C', 9)]), { id: 'r', type: 'event', duration: { base: 'half', dots: 1 }, rest: true }]]);
  const { part, moved, diagnostics } = fit(d, { target: INSTRUMENTS.flute, level: 'advanced', autoRange: false, overrides: { a: 12 } });
  expect(moved).toEqual({});
  expect(pitches(part).a).toEqual([P('C', 9)]);
  expect(diagnostics[0]).toMatch(/octave 9/);
});
