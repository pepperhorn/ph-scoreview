import { createDocument } from '../../model/create';
import { INSTRUMENTS } from '../../model/instruments';
import { checkInvariants } from '../../model/invariants';
import { eventStarts } from '../../model/query';
import type { Document, Event, Layout, Part, Pitch } from '../../model/schema';
import { fixedIds, twoVoicePianoDoc } from '../../test-helpers';
import { applyLayout } from './apply-layout';

const P = (step: Pitch['step'], octave: number, alter = 0): Pitch => ({ step, octave, alter });
const q = (id: string, p: Pitch): Event => ({ id, type: 'event', duration: { base: 'quarter', dots: 0 }, notes: [{ id: `${id}n`, pitch: p }] });
const restQ = (id: string): Event => ({ id, type: 'event', duration: { base: 'quarter', dots: 0 }, rest: true });
const pitchOf = (part: Part, eventId: string): Pitch | undefined => {
  for (const pm of part.measures) for (const seq of pm.sequences) for (const { event } of eventStarts(seq)) if (event.id === eventId) return event.notes?.[0].pitch;
  return undefined;
};

/** Flute, Piano (2 staves), Violin, Cello; one bar of rests; parts p1-p4, layout `layout1`. */
const quartet = (): Document => fixedIds(createDocument({
  parts: [
    { name: 'Flute', clef: 'treble', gmProgram: 74 }, { name: 'Piano', clef: 'treble', gmProgram: 1, staves: 2 },
    { name: 'Violin', clef: 'treble', gmProgram: 41 }, { name: 'Cello', clef: 'bass', gmProgram: 43 },
  ],
  measures: 1,
}));

/** One part (gmProgram, transposition) with one bar `content`, and a second layout `view` built by `layout`. */
function oneBar(gmProgram: number, content: Event[], layout: Omit<Layout, 'id' | 'name' | 'kind' | 'overrides'> & Partial<Layout>, transposition?: Part['transposition']): Document {
  const doc = fixedIds(createDocument({ parts: [{ name: 'Source', clef: 'treble', gmProgram }], measures: 1 }));
  doc.parts[0].measures[0].sequences[0].content = content;
  if (transposition) doc.parts[0].transposition = transposition;
  doc.layouts.push({ id: 'view', name: 'View', kind: 'custom', overrides: {}, ...layout });
  return doc;
}

const clean = (doc: Document) => expect(checkInvariants(doc)).toEqual([]);

test('the full score layout returns the document itself and moves nothing', () => {
  const doc = quartet();
  const view = applyLayout(doc, 'layout1');
  expect(view.document).toBe(doc);
  expect(view.document.parts).toBe(doc.parts);
  expect(view.moved).toEqual({});
  expect(view.counts).toEqual({ moved: 0 });
  expect(view.diagnostics).toEqual([]);
  // An unknown layout, or none at all, shows the document as it is.
  const empty = { document: doc, moved: {}, counts: { moved: 0 }, diagnostics: [] };
  expect(applyLayout(doc, 'gone')).toEqual(empty);
  expect(applyLayout(doc, 'gone').document).toBe(doc);
  const bare = { ...doc, layouts: [] };
  expect(applyLayout(bare, 'layout1').document).toBe(bare);
});

test('a custom layout keeps its parts in order and only the chosen staves', () => {
  const doc = quartet();
  doc.layouts.push({ id: 'duo', name: 'Duo', kind: 'custom', transposing: true, overrides: {}, parts: [{ partId: 'p3' }, { partId: 'p2', staves: [1] }] });
  const view = applyLayout(doc, 'duo');
  expect(view.document.parts.map((p) => p.id)).toEqual(['p3', 'p2']);
  expect(view.document.parts[0]).toBe(doc.parts[2]);
  const piano = view.document.parts[1];
  expect(piano.staves).toBe(1);
  expect(piano.clefs).toEqual(['treble']);
  expect(piano.measures[0].sequences.every((s) => s.staff === 1)).toBe(true);
  expect(view.document.layouts).toHaveLength(1);
  expect(view.document.layouts[0].parts).toEqual([{ partId: 'p3' }, { partId: 'p2' }]);
  clean(view.document);
});

test('showing only the lower staff renumbers it, dropping staff-1 directions and cross-staff references', () => {
  const doc = twoVoicePianoDoc();
  (doc.parts[0].measures[0].sequences[2].content[0] as Event).slurs = [{ id: 'x', target: 'e1' }];  // C3 slurred to the upper staff
  doc.layouts.push({ id: 'lh', name: 'LH', kind: 'custom', transposing: true, overrides: {}, parts: [{ partId: 'p1', staves: [2] }] });
  const piano = applyLayout(doc, 'lh').document.parts[0];
  expect(piano.staves).toBe(1);
  expect(piano.clefs).toEqual(['bass']);
  expect(piano.measures[0].sequences.map((s) => [s.id, s.staff])).toEqual([['s3', 1]]);
  expect(piano.measures[0].directions).toEqual([]);
  expect(piano.measures[0].beams).toEqual([]);
  const first = piano.measures[0].sequences[0].content[0];
  expect(first.type === 'event' && first.slurs).toBeFalsy();
  clean({ ...doc, parts: [piano] });
  // The store's document is untouched.
  expect(doc.parts[0].staves).toBe(2);
});

test('a swap shows the part for the target: tenor written C5 is alto G4, a major third up B4, nothing moved', () => {
  const tenor = INSTRUMENTS['tenor-saxophone'];
  const content = [{ id: 'a', type: 'event' as const, duration: { base: 'whole' as const, dots: 0 as const }, notes: [{ id: 'an', pitch: P('C', 5) }] }];
  const swap = { instrument: 'alto-saxophone' as const, level: 'intermediate' as const, autoRange: true, rangeOverrides: {} };
  const doc = oneBar(67, content, { transposing: true, parts: [{ partId: 'p1', swap }] }, tenor.transposition);
  const view = applyLayout(doc, 'view');
  const part = view.document.parts[0];
  expect(part).toMatchObject({ id: 'p1', name: 'Alto Saxophone', instrument: { gmProgram: 66 }, transposition: { semitones: 9, diatonic: 5 }, clefs: ['treble'] });
  expect(pitchOf(part, 'a')).toEqual(P('G', 4));
  expect(view.moved).toEqual({});
  doc.layouts[1].parts[0].swap = { ...swap, interval: { semitones: 4, diatonic: 2 } };
  const third = applyLayout(doc, 'view');
  expect(pitchOf(third.document.parts[0], 'a')).toEqual(P('B', 4));
  expect(third.moved).toEqual({});
  clean(third.document);
});

test('range fitting reports the moved events, the part and the direction', () => {
  const swap = { instrument: 'alto-saxophone' as const, level: 'beginner' as const, autoRange: true, rangeOverrides: {} };
  const doc = oneBar(74, [q('a', P('C', 5)), q('b', P('E', 5)), q('c', P('G', 5)), restQ('r')], { transposing: true, parts: [{ partId: 'p1', swap }] });
  const view = applyLayout(doc, 'view');
  expect(view.moved).toEqual({ a: -12, b: -12, c: -12 });
  expect(view.counts).toEqual({ moved: 3, partId: 'p1', direction: 'down' });
  expect([pitchOf(view.document.parts[0], 'a'), pitchOf(view.document.parts[0], 'b'), pitchOf(view.document.parts[0], 'c')]).toEqual([P('A', 4), P('C', 5, 1), P('E', 5)]);
  clean(view.document);
});

test('a phrase out of range both ways surfaces a diagnostic', () => {
  const swap = { instrument: 'alto-saxophone' as const, level: 'beginner' as const, autoRange: true, rangeOverrides: {} };
  const doc = oneBar(1, [q('a', P('C', 2)), q('b', P('C', 6)), restQ('r1'), restQ('r2')], { transposing: true, parts: [{ partId: 'p1', swap }] });
  const view = applyLayout(doc, 'view');
  expect(view.moved).toEqual({});
  expect(view.diagnostics).toHaveLength(1);
});

test('a concert-pitch layout writes a clarinet part at concert pitch, keeping the spelling', () => {
  const clarinet = INSTRUMENTS.clarinet;
  const doc = oneBar(72, [q('a', P('D', 5)), q('b', P('C', 5)), restQ('r1'), restQ('r2')], { transposing: false, parts: [{ partId: 'p1' }] }, clarinet.transposition);
  const view = applyLayout(doc, 'view');
  const part = view.document.parts[0];
  expect(pitchOf(part, 'a')).toEqual(P('C', 5));
  expect(pitchOf(part, 'b')).toEqual(P('B', 4, -1));
  expect(part.transposition).toBeUndefined();
  expect(view.moved).toEqual({});
  // The transposing full score leaves it written.
  expect(applyLayout(doc, 'layout1').document).toBe(doc);
});

test('layout overrides hide, reword and offset directions in the view only', () => {
  const doc = twoVoicePianoDoc();
  doc.parts[0].measures[1].directions = [
    { kind: 'text', id: 't1', anchor: { measureId: 'm2', tick: 0, staff: 1 }, text: 'dolce' },
    { kind: 'dynamic', id: 'd1', anchor: { measureId: 'm2', tick: 0, staff: 1 }, value: 'p' },
  ];
  doc.layouts.push({ id: 'part', name: 'Piano', kind: 'part', transposing: true, parts: [{ partId: 'p1' }], overrides: { w1: { hidden: true }, t1: { text: 'sweetly' }, d1: { offset: { x: 2, y: 3 } } } });
  const part = applyLayout(doc, 'part').document.parts[0];
  expect(part.measures[0].directions).toEqual([]);
  expect(part.measures[1].directions).toEqual([
    { kind: 'text', id: 't1', anchor: { measureId: 'm2', tick: 0, staff: 1 }, text: 'sweetly' },
    { kind: 'dynamic', id: 'd1', anchor: { measureId: 'm2', tick: 0, staff: 1 }, value: 'p', offset: { x: 2, y: 3 } },
  ]);
  expect(doc.parts[0].measures[0].directions).toHaveLength(1);
});
