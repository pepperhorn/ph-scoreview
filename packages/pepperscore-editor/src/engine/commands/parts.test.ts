import { INSTRUMENTS, instrumentName } from 'pepperscore/instruments';
import { createDocument } from '../../model/create';
import { measureTicks } from '../../model/durations';
import { checkInvariants } from '../../model/invariants';
import { effectiveTime, sequenceTicks } from '../../model/query';
import type { Document } from '../../model/schema';
import { createEditorStore } from '../store';
import { addPart, canAddPart, canEditPart, removePart, setPartInstrument } from './parts';
import { setTime } from './score';

const fourBars = () => createDocument({ parts: [{ name: 'Violin', clef: 'treble', gmProgram: 41 }], measures: 4, time: { count: 3, unit: 4 } });
const clean = (doc: Document) => expect(checkInvariants(doc)).toEqual([]);

test('add flute fills all four bars, adds only to Full score, and undoes/redoes', () => {
  const doc = fourBars();
  doc.layouts.push({ ...structuredClone(doc.layouts[0]), id: 'custom', kind: 'custom' });
  const store = createEditorStore(doc);
  store.dispatch(addPart, { instrument: 'flute' });
  const after = store.getState().document;
  const flute = after.parts[1];
  expect(flute).toMatchObject({ name: 'Flute', instrument: { gmProgram: 74 }, staves: 1, clefs: ['treble'] });
  expect(flute.transposition).toBeUndefined();
  expect(flute.measures).toHaveLength(4);
  expect(after.layouts[0].parts.at(-1)).toEqual({ partId: flute.id });
  expect(after.layouts[1]).toEqual(doc.layouts[1]);
  clean(after);
  store.undo(); expect(store.getState().document).toEqual(doc); clean(store.getState().document);
  store.redo(); expect(store.getState().document).toEqual(after); clean(store.getState().document);
});

test('piano is one two-stave part with treble and bass rests', () => {
  const store = createEditorStore(fourBars());
  store.dispatch(addPart, { instrument: 'piano' });
  const piano = store.getState().document.parts[1];
  expect(piano).toMatchObject({ name: 'Piano', staves: 2, clefs: ['treble', 'bass'], instrument: { gmProgram: 1 } });
  for (const pm of piano.measures) expect(pm.sequences.map(s => s.staff)).toEqual([1, 2]);
  clean(store.getState().document);
});

test('added parts follow inherited and changed time signatures and refill with setTime', () => {
  const doc = fourBars();
  doc.global.measures[2].time = { count: 5, unit: 8 };
  const store = createEditorStore(doc);
  store.dispatch(addPart, { instrument: 'piano' });
  clean(store.getState().document);
  const beforeTime = store.getState().document;
  store.dispatch(setTime, { measureId: doc.global.measures[1].id, time: { count: 6, unit: 8 } });
  const after = store.getState().document;
  after.parts[1].measures.forEach((pm, i) => {
    for (const seq of pm.sequences) expect(sequenceTicks(seq, measureTicks(effectiveTime(after, i)))).toBe(measureTicks(effectiveTime(after, i)));
  });
  clean(after);
  store.undo(); expect(store.getState().document).toEqual(beforeTime); clean(store.getState().document);
  store.undo(); expect(store.getState().document).toEqual(doc); clean(store.getState().document);
});

test('instrument change updates name, program, clefs, staves and transposition, and undoes', () => {
  const store = createEditorStore(fourBars());
  const original = store.getState().document;
  const partId = original.parts[0].id;
  for (const instrument of ['piano', 'clarinet', 'cello', 'alto-saxophone'] as const) {
    const before = store.getState().document;
    store.dispatch(setPartInstrument, { partId, instrument });
    const part = store.getState().document.parts[0];
    expect(part).toMatchObject({ name: instrumentName(instrument), instrument: { gmProgram: INSTRUMENTS[instrument].gmProgram }, staves: instrument === 'piano' ? 2 : 1, clefs: instrument === 'piano' ? ['treble', 'bass'] : [INSTRUMENTS[instrument].clef] });
    expect(part.transposition).toEqual(INSTRUMENTS[instrument].transposition.semitones ? INSTRUMENTS[instrument].transposition : undefined);
    expect(part.measures).toHaveLength(4);
    for (const pm of part.measures) expect(pm.sequences.map(s => s.staff)).toEqual(instrument === 'piano' ? [1, 2] : [1]);
    clean(store.getState().document);
    store.undo(); expect(store.getState().document).toEqual(before); clean(store.getState().document);
    store.redo(); clean(store.getState().document);
  }
});

test('parts with notes cannot change or be removed; missing ids are no-ops', () => {
  const doc = fourBars();
  const event = doc.parts[0].measures[3].sequences[0].content[0];
  if (event.type !== 'event') throw new Error('fixture');
  delete event.rest; delete event.fullMeasure;
  event.duration = { base: 'half', dots: 1 };
  event.notes = [{ id: 'note', pitch: { step: 'C', octave: 4, alter: 0 } }];
  const store = createEditorStore(doc);
  store.dispatch(addPart, { instrument: 'flute' });
  const before = store.getState();
  expect(canEditPart(before.document, doc.parts[0].id)).toBe(false);
  expect(canEditPart(before.document, 'missing')).toBe(false);
  for (const partId of [doc.parts[0].id, 'missing']) {
    store.dispatch(setPartInstrument, { partId, instrument: 'piano' });
    store.dispatch(removePart, { partId });
    expect(store.getState()).toBe(before); clean(store.getState().document);
  }
});

test('notes in nested tuplets or grace events also prevent editing', () => {
  const doc = fourBars();
  doc.parts[0].measures[0].sequences[0].content.unshift({ id: 'tuplet', type: 'tuplet', outer: { multiple: 2, base: 'eighth' }, inner: { multiple: 3, base: 'eighth' }, content: [{ id: 'grace', type: 'event', grace: { slash: true }, duration: { base: 'eighth', dots: 0 }, notes: [{ id: 'n', pitch: { step: 'C', octave: 5, alter: 0 } }] }] });
  expect(canEditPart(doc, doc.parts[0].id)).toBe(false);
});

test('last part is never removed, even if empty', () => {
  const doc = fourBars(); const store = createEditorStore(doc);
  expect(canEditPart(doc, doc.parts[0].id)).toBe(true);
  store.dispatch(removePart, { partId: doc.parts[0].id });
  expect(store.getState().document).toBe(doc); expect(store.canUndo()).toBe(false); clean(doc);
});

test('removal drops every layout reference, repairs cursor/selection and undoes', () => {
  const store = createEditorStore(fourBars());
  store.dispatch(addPart, { instrument: 'piano' });
  const doc = structuredClone(store.getState().document);
  const part = doc.parts[1];
  doc.layouts.push({ ...structuredClone(doc.layouts[0]), id: 'custom', kind: 'custom', parts: [{ partId: part.id, staves: [2] }] });
  const s = createEditorStore(doc, { cursor: { ...store.getState().cursor, partId: part.id, staff: 2 } });
  s.setState({ selection: { ids: [part.measures[0].sequences[0].content[0].id] } });
  s.dispatch(removePart, { partId: part.id });
  const after = s.getState();
  expect(after.document.parts).toHaveLength(1);
  for (const layout of after.document.layouts) expect(layout.parts.some(p => p.partId === part.id)).toBe(false);
  expect(after.cursor).toMatchObject({ partId: doc.parts[0].id, staff: 1 });
  expect(after.selection.ids).toEqual([]); clean(after.document);
  s.undo(); expect(s.getState().document).toEqual(doc); clean(s.getState().document);
});

test('canAddPart counts staves, including two-stave piano, against the caller licence', () => {
  const doc = fourBars();
  expect(canAddPart(doc, 1)).toBe(false);
  expect(canAddPart(doc, 2)).toBe(true);
  expect(canAddPart(doc, 2, 'piano')).toBe(false);
  expect(canAddPart(doc, 3, 'piano')).toBe(true);
  doc.parts[0].staves = 2;
  expect(canAddPart(doc, 2)).toBe(false);
  expect(canAddPart(doc, 3, 'piano')).toBe(false);
  expect(canAddPart(doc, 4, 'piano')).toBe(true);
  expect(canAddPart(doc, 8, 'piano')).toBe(true);
});

test('shrinking a piano prunes cross-staff rest slurs and repairs selected staff references; undo restores them', () => {
  const doc = createDocument({ parts: [{ name: 'Piano', clef: 'treble', gmProgram: 1, staves: 2 }], measures: 1 });
  const part = doc.parts[0];
  const pm = part.measures[0];
  const upper = pm.sequences[0].content[0];
  const lower = pm.sequences[1].content[0];
  if (upper.type !== 'event') throw new Error('fixture');
  upper.slurs = [{ id: 'slur', target: lower.id }];
  doc.layouts.push({ ...structuredClone(doc.layouts[0]), id: 'lower', kind: 'custom', parts: [{ partId: part.id, staves: [2] }] });
  clean(doc);
  const store = createEditorStore(doc);
  store.setState({ cursor: { ...store.getState().cursor, staff: 2 }, selection: { ids: [lower.id] } });
  store.dispatch(setPartInstrument, { partId: part.id, instrument: 'flute' });
  const after = store.getState();
  clean(after.document);
  expect(after.cursor.staff).toBe(1);
  expect(after.selection.ids).toEqual([]);
  expect(after.document.layouts[1].parts[0].staves).toBeUndefined();
  store.undo(); expect(store.getState().document).toEqual(doc); clean(store.getState().document);
});
