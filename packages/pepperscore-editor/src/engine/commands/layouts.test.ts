import { createDocument } from '../../model/create';
import { checkInvariants } from '../../model/invariants';
import { eventStarts } from '../../model/query';
import type { Document, Event, Part, Pitch, Swap } from '../../model/schema';
import { fixedIds } from '../../test-helpers';
import { createEditorStore } from '../store';
import {
  createCustomLayout, createPartLayouts, makeCopy, setActiveLayout, setCursor, setLayoutParts, setLayoutTransposing, setPitch,
  setRangeOverride, setSelection, setSwap,
} from './index';

const P = (step: Pitch['step'], octave: number, alter = 0): Pitch => ({ step, octave, alter });
const q = (id: string, p: Pitch): Event => ({ id, type: 'event', duration: { base: 'quarter', dots: 0 }, notes: [{ id: `${id}n`, pitch: p }] });
const pitches = (part: Part): Record<string, Pitch> => {
  const out: Record<string, Pitch> = {};
  for (const pm of part.measures) for (const seq of pm.sequences) for (const { event } of eventStarts(seq)) if (event.notes) out[event.id] = event.notes[0].pitch;
  return out;
};
const altoBeginner: Swap = { instrument: 'alto-saxophone', level: 'beginner', autoRange: true, rangeOverrides: {} };

/** Flute p1 (concert C5 E5 G5 and a rest: events a b c r) and Violin p2; full score `layout1`. */
function duo(): Document {
  const doc = fixedIds(createDocument({ parts: [{ name: 'Flute', clef: 'treble', gmProgram: 74 }, { name: 'Violin', clef: 'treble', gmProgram: 41 }], measures: 1 }));
  doc.parts[0].measures[0].sequences[0].content = [q('a', P('C', 5)), q('b', P('E', 5)), q('c', P('G', 5)), { id: 'r', type: 'event', duration: { base: 'quarter', dots: 0 }, rest: true }];
  return doc;
}

/** A store on `duo()` with a custom layout `alto` showing the flute as alto sax (beginner), active. */
function swapped() {
  const store = createEditorStore(duo());
  store.dispatch(createCustomLayout, { name: 'Alto', parts: [{ partId: 'p1' }] });
  const layoutId = store.getState().activeLayoutId;
  store.dispatch(setSwap, { layoutId, partId: 'p1', swap: altoBeginner });
  return { store, layoutId };
}

test('the store derives the view of the active layout and memoises it', () => {
  const store = createEditorStore(duo());
  const s = store.getState();
  expect(s.view.document).toBe(s.document);
  store.dispatch(setCursor, { tick: 960 }, { record: false });
  expect(store.getState().view).toBe(s.view);
});

test('createCustomLayout adds a custom layout and makes it active; undo removes it and goes back', () => {
  const store = createEditorStore(duo());
  const first = store.getState().activeLayoutId;
  store.dispatch(createCustomLayout, { name: 'Strings', parts: [{ partId: 'p2' }, { partId: 'gone' }] });
  const s = store.getState();
  const created = s.document.layouts[1];
  expect(created).toMatchObject({ name: 'Strings', kind: 'custom', transposing: true, parts: [{ partId: 'p2' }], overrides: {} });
  expect(s.activeLayoutId).toBe(created.id);
  expect(s.view.document.parts.map((p) => p.id)).toEqual(['p2']);
  store.undo();
  expect(store.getState().document.layouts).toHaveLength(1);
  expect(store.getState().activeLayoutId).toBe(first);
  expect(store.getState().view.document).toBe(store.getState().document);
});

test('setActiveLayout switches the view; unknown ids and the current id are no-ops', () => {
  const store = createEditorStore(duo());
  store.dispatch(createCustomLayout, { name: 'Strings', parts: [{ partId: 'p2' }] });
  const custom = store.getState().activeLayoutId;
  const past = store.getState().history.past.length;
  store.dispatch(setActiveLayout, { layoutId: 'layout1' }, { record: false });
  expect(store.getState().activeLayoutId).toBe('layout1');
  expect(store.getState().view.document.parts).toHaveLength(2);
  const before = store.getState();
  store.dispatch(setActiveLayout, { layoutId: 'nope' }, { record: false });
  store.dispatch(setActiveLayout, { layoutId: 'layout1' }, { record: false });
  expect(store.getState()).toBe(before);
  store.dispatch(setActiveLayout, { layoutId: custom }, { record: false });
  expect(store.getState().history.past).toHaveLength(past);
});

test('an active layout that disappears falls back to the first', () => {
  const store = createEditorStore(duo());
  store.dispatch(createCustomLayout, { name: 'Strings', parts: [{ partId: 'p2' }] });
  store.dispatch(setActiveLayout, { layoutId: 'layout1' }, { record: false });
  store.dispatch(setActiveLayout, { layoutId: store.getState().document.layouts[1].id }, { record: false });
  store.undo();  // removes the custom layout; the restored id is still the custom one
  expect(store.getState().activeLayoutId).toBe('layout1');
});

test('createPartLayouts adds one part layout per part, once', () => {
  const store = createEditorStore(duo());
  store.dispatch(createPartLayouts, {});
  const layouts = store.getState().document.layouts;
  expect(layouts.slice(1).map((l) => [l.kind, l.name, l.parts])).toEqual([['part', 'Flute', [{ partId: 'p1' }]], ['part', 'Violin', [{ partId: 'p2' }]]]);
  const past = store.getState().history.past.length;
  store.dispatch(createPartLayouts, {});
  expect(store.getState().document.layouts).toHaveLength(3);
  expect(store.getState().history.past).toHaveLength(past);
});

test('setLayoutParts and setLayoutTransposing edit a layout and skip no-ops', () => {
  const store = createEditorStore(duo());
  store.dispatch(setLayoutParts, { layoutId: 'layout1', parts: [{ partId: 'p2' }, { partId: 'p1' }] });
  expect(store.getState().view.document.parts.map((p) => p.id)).toEqual(['p2', 'p1']);
  const past = store.getState().history.past.length;
  store.dispatch(setLayoutParts, { layoutId: 'layout1', parts: [{ partId: 'p2' }, { partId: 'p1' }] });
  store.dispatch(setLayoutTransposing, { layoutId: 'layout1', transposing: true });
  expect(store.getState().history.past).toHaveLength(past);
  store.dispatch(setLayoutTransposing, { layoutId: 'layout1', transposing: false });
  expect(store.getState().document.layouts[0].transposing).toBe(false);
});

test('setSwap shows the part for the target with range fitting; null removes it', () => {
  const { store, layoutId } = swapped();
  const { view } = store.getState();
  expect(view.document.parts[0].name).toBe('Alto Saxophone');
  expect(view.moved).toEqual({ a: -12, b: -12, c: -12 });
  expect(pitches(view.document.parts[0])).toEqual({ a: P('A', 4), b: P('C', 5, 1), c: P('E', 5) });
  store.dispatch(setSwap, { layoutId, partId: 'p1', swap: null });
  expect(store.getState().view.document.parts[0].name).toBe('Flute');
  expect(store.getState().view.moved).toEqual({});
});

test('edit through the view keeps overrides', () => {
  const { store, layoutId } = swapped();
  store.dispatch(setRangeOverride, { layoutId, partId: 'p1', eventId: 'a', shift: 0 });
  expect(store.getState().view.moved).toEqual({ b: -12, c: -12 });
  store.dispatch(setPitch, { noteId: 'bn', pitch: P('F', 5) });
  const { view } = store.getState();
  expect(view.moved).toEqual({ b: -12, c: -12 });
  // a stays at sounding C5: written A5 for alto; b is now F5 moved to F4, written D5.
  expect(pitches(view.document.parts[0])).toMatchObject({ a: P('A', 5), b: P('D', 5) });
  store.dispatch(setRangeOverride, { layoutId, partId: 'p1', eventId: 'a', shift: null });
  expect(store.getState().view.moved).toEqual({ a: -12, b: -12, c: -12 });
});

test('makeCopy bakes the swap into a new unlinked part, adds it to the full score and undoes cleanly', () => {
  const { store, layoutId } = swapped();
  const before = store.getState().document;
  store.dispatch(makeCopy, { layoutId, partId: 'p1' });
  const { document, view, invariantErrors } = store.getState();
  expect(document.parts).toHaveLength(3);
  const copy = document.parts[2];
  expect(copy.id).not.toBe('p1');
  expect(copy).toMatchObject({ name: 'Alto Saxophone (from Flute)', instrument: { gmProgram: 66 }, transposition: { semitones: 9, diatonic: 5 }, clefs: ['treble'] });
  const layout = document.layouts.find((l) => l.id === layoutId)!;
  expect(layout.parts).toEqual([{ partId: copy.id }]);
  expect(document.layouts[0].parts.map((p) => p.partId)).toEqual(['p1', 'p2', copy.id]);
  expect(Object.values(pitches(copy))).toEqual([P('A', 4), P('C', 5, 1), P('E', 5)]);
  // Every id is new.
  const ids = (part: Part) => part.measures.flatMap((pm) => [pm.id, ...pm.sequences.flatMap((s) => [s.id, ...eventStarts(s).flatMap(({ event }) => [event.id, ...(event.notes ?? []).map((n) => n.id)])])]);
  expect(ids(copy).filter((id) => ids(document.parts[0]).includes(id))).toEqual([]);
  expect(view.moved).toEqual({});
  expect(view.document.parts[0].id).toBe(copy.id);
  expect(invariantErrors).toEqual([]);
  store.undo();
  expect(store.getState().document).toEqual(before);
  // A part without a swap has nothing to copy.
  const past = store.getState().history.past.length;
  store.dispatch(makeCopy, { layoutId: 'layout1', partId: 'p1' });
  expect(store.getState().history.past).toHaveLength(past);
});

test('a custom layout is transposing or concert pitch as the active layout was', () => {
  const store = createEditorStore(duo());
  store.dispatch(createCustomLayout, { name: 'A', parts: [{ partId: 'p1' }] });
  expect(store.getState().document.layouts[1].transposing).toBe(true);
  store.dispatch(setLayoutTransposing, { layoutId: 'layout1', transposing: false });
  store.dispatch(setActiveLayout, { layoutId: 'layout1' });
  store.dispatch(createCustomLayout, { name: 'B', parts: [{ partId: 'p1' }] });
  const { document, activeLayoutId } = store.getState();
  expect(document.layouts[2]).toMatchObject({ name: 'B', transposing: false });
  expect(activeLayoutId).toBe(document.layouts[2].id);
});

test('makeCopy in the full score keeps the source (unswapped) and puts the copy on its own stave after it', () => {
  const store = createEditorStore(duo());
  store.dispatch(setSwap, { layoutId: 'layout1', partId: 'p1', swap: altoBeginner });
  const before = store.getState().document;
  store.dispatch(makeCopy, { layoutId: 'layout1', partId: 'p1' });
  const { document, view, invariantErrors } = store.getState();
  const copy = document.parts[2];
  expect(document.layouts[0].parts).toEqual([{ partId: 'p1' }, { partId: copy.id }, { partId: 'p2' }]);
  expect(view.moved).toEqual({});
  expect(view.document.parts.map((p) => p.id)).toEqual(['p1', copy.id, 'p2']);
  expect(invariantErrors).toEqual([]);
  store.undo();
  expect(store.getState().document).toEqual(before);
});

test('makeCopy keeps references inside the copy consistent', () => {
  const doc = duo();
  const [a, b] = doc.parts[0].measures[0].sequences[0].content as Event[];
  a.slurs = [{ id: 'sl', target: 'b' }];
  a.notes = [{ id: 'an', pitch: P('E', 5), tie: { target: 'bn' } }];
  b.notes = [{ id: 'bn', pitch: P('E', 5) }];
  a.duration = b.duration = { base: 'eighth', dots: 0 };
  doc.parts[0].measures[0].sequences[0].content.splice(2, 0, { id: 'r8', type: 'event', duration: { base: 'quarter', dots: 0 }, rest: true });
  doc.parts[0].measures[0].beams = [{ id: 'bm', events: ['a', 'b'] }];
  doc.parts[0].measures[0].directions = [{ kind: 'dynamic', id: 'dy', anchor: { measureId: 'm1', tick: 0, staff: 1, eventId: 'a' }, value: 'p' }];
  const store = createEditorStore(doc);
  store.dispatch(createCustomLayout, { name: 'Alto', parts: [{ partId: 'p1', swap: altoBeginner }] });
  store.dispatch(makeCopy, { layoutId: store.getState().activeLayoutId, partId: 'p1' });
  const { document, invariantErrors } = store.getState();
  expect(invariantErrors).toEqual([]);
  const pm = document.parts[2].measures[0];
  const [ca, cb] = pm.sequences[0].content as Event[];
  expect(ca.slurs?.[0].target).toBe(cb.id);
  expect(ca.notes?.[0].tie?.target).toBe(cb.notes?.[0].id);
  expect(pm.beams[0].events).toEqual([ca.id, cb.id]);
  expect(pm.directions[0].anchor.eventId).toBe(ca.id);
  expect(pm.directions[0].id).not.toBe('dy');
});

test('an override on the first note of a tie keeps the tie in the view and in the copy', () => {
  const doc = duo();
  const content = doc.parts[0].measures[0].sequences[0].content as Event[];
  content[1].notes = [{ id: 'bn', pitch: P('E', 5), tie: { target: 'cn' } }];
  content[2].notes = [{ id: 'cn', pitch: P('E', 5) }];
  const store = createEditorStore(doc);
  store.dispatch(createCustomLayout, { name: 'Alto', parts: [{ partId: 'p1', swap: altoBeginner }] });
  const layoutId = store.getState().activeLayoutId;
  store.dispatch(setRangeOverride, { layoutId, partId: 'p1', eventId: 'b', shift: 0 });
  const { view } = store.getState();
  expect(view.moved).toEqual({ a: -12 });
  expect(checkInvariants(view.document)).toEqual([]);
  store.dispatch(makeCopy, { layoutId, partId: 'p1' });
  expect(store.getState().invariantErrors).toEqual([]);
});

test('view-only commands are never recorded, whatever the caller asks', () => {
  const store = createEditorStore(duo());
  store.dispatch(createCustomLayout, { name: 'Strings', parts: [{ partId: 'p2' }] });
  const past = store.getState().history.past.length;
  store.dispatch(setActiveLayout, { layoutId: 'layout1' });
  store.dispatch(setCursor, { tick: 960 });
  expect(store.getState().activeLayoutId).toBe('layout1');
  expect(store.getState().history.past).toHaveLength(past);
});

test('a layout change that hides the cursor staff moves the cursor to the first drawn staff, same bar and tick, outside history', () => {
  const store = createEditorStore(duo());
  const measureId = store.getState().cursor.measureId;
  store.dispatch(setCursor, { partId: 'p1', staff: 1, tick: 960 });
  store.dispatch(setSelection, { ids: ['b'] });
  // Hiding the flute in the full score makes a custom layout of the violin only.
  store.dispatch(createCustomLayout, { name: 'Custom', parts: [{ partId: 'p2' }] });
  const custom = store.getState().activeLayoutId;
  expect(store.getState().cursor).toMatchObject({ partId: 'p2', staff: 1, measureId, tick: 960 });
  expect(store.getState().selection.ids).toEqual([]);
  expect(store.getState().history.past).toHaveLength(1);

  // Switching layouts and setting a layout's parts repair it the same way.
  store.dispatch(setActiveLayout, { layoutId: 'layout1' });
  store.dispatch(setCursor, { partId: 'p1', staff: 1, tick: 960 });
  store.dispatch(setActiveLayout, { layoutId: custom });
  expect(store.getState().cursor).toMatchObject({ partId: 'p2', staff: 1, measureId, tick: 960 });
  store.dispatch(setLayoutParts, { layoutId: custom, parts: [{ partId: 'p1' }] });
  expect(store.getState().cursor).toMatchObject({ partId: 'p1', staff: 1, measureId, tick: 960 });
  // A cursor already on a drawn staff stays put.
  store.dispatch(setSelection, { ids: ['a'] });
  store.dispatch(setLayoutTransposing, { layoutId: custom, transposing: false });
  expect(store.getState().cursor.partId).toBe('p1');
  expect(store.getState().selection.ids).toEqual(['a']);
});
