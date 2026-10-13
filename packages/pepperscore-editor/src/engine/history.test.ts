import { createEditorStore } from './store';
import { coalesceOrPush, COALESCE_MS } from './history';
import type { Command, HistoryEntry } from './types';
import { deleteMeasure, setCursor, setSelection, setTime } from './commands';
import { createDocument } from '../model/create';
import { helloDoc, threeQuarterNotesDoc } from '../test-helpers';

const setTitle: Command<{ v: string }> = { label: 'title', coalesceKey: () => 'title', run: (d, a) => { d.document.meta.title = a.v; } };
const setComposer: Command<{ v: string }> = { label: 'composer', run: (d, a) => { d.document.meta.composer = a.v; } };

afterEach(() => vi.restoreAllMocks());

test('coalesced entries undo as one', () => {
  const store = createEditorStore(helloDoc());
  const cmd: Command<{ v: string }> = { label: 'title', coalesceKey: () => 'title', run: (d, a) => { d.document.meta.title = a.v; } };
  store.dispatch(cmd, { v: 'a' }); store.dispatch(cmd, { v: 'ab' }); store.dispatch(cmd, { v: 'abc' });
  expect(store.getState().history.past).toHaveLength(1);
  store.undo(); expect(store.getState().document.meta.title).toBe('Hello');
  store.redo(); expect(store.getState().document.meta.title).toBe('abc');
});

test('entries older than the coalesce window are pushed separately', () => {
  let now = 1000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  const store = createEditorStore(helloDoc());
  store.dispatch(setTitle, { v: 'a' });
  now += COALESCE_MS + 1;
  store.dispatch(setTitle, { v: 'b' });
  expect(store.getState().history.past).toHaveLength(2);
  store.undo();
  expect(store.getState().document.meta.title).toBe('a');
});

test('commands without a coalesce key never merge', () => {
  const store = createEditorStore(helloDoc());
  store.dispatch(setComposer, { v: 'x' });
  store.dispatch(setComposer, { v: 'y' });
  expect(store.getState().history.past).toHaveLength(2);
});

test('coalesceOrPush concatenates patches and prepends inverse', () => {
  const a: HistoryEntry = { label: 't', patches: [{ op: 'replace', path: ['x'], value: 1 }], inverse: [{ op: 'replace', path: ['x'], value: 0 }], coalesceKey: 'k', at: 100 };
  const b: HistoryEntry = { label: 't', patches: [{ op: 'replace', path: ['x'], value: 2 }], inverse: [{ op: 'replace', path: ['x'], value: 1 }], coalesceKey: 'k', at: 200 };
  const past = coalesceOrPush([a], b);
  expect(past).toHaveLength(1);
  expect(past[0].patches.map((p) => p.value)).toEqual([1, 2]);
  expect(past[0].inverse.map((p) => p.value)).toEqual([1, 0]);
  expect(past[0].at).toBe(200);
  expect(coalesceOrPush([a], { ...b, coalesceKey: 'other' })).toHaveLength(2);
});

test('no-op dispatch does not record or clear redo', () => {
  const store = createEditorStore(helloDoc());
  store.dispatch(setComposer, { v: 'x' });
  store.undo();
  expect(store.canRedo()).toBe(true);
  store.dispatch({ label: 'noop', run: () => {} }, {});
  expect(store.getState().history.past).toHaveLength(0);
  expect(store.canRedo()).toBe(true);
});

test('a recorded dispatch clears the redo stack and marks dirty', () => {
  const store = createEditorStore(helloDoc());
  expect(store.getState().dirty).toBe(false);
  expect(store.canUndo()).toBe(false);
  store.dispatch(setComposer, { v: 'x' });
  expect(store.getState().dirty).toBe(true);
  expect(store.canUndo()).toBe(true);
  store.undo();
  expect(store.canRedo()).toBe(true);
  store.dispatch(setComposer, { v: 'y' });
  expect(store.canRedo()).toBe(false);
  expect(store.getState().history.future).toEqual([]);
});

test('record:false applies the change without a history entry', () => {
  const store = createEditorStore(helloDoc());
  store.dispatch(setCursor, { tick: 960, mode: 'enter' }, { record: false });
  store.dispatch(setSelection, { ids: ['e1'] }, { record: false });
  expect(store.getState().cursor.tick).toBe(960);
  expect(store.getState().cursor.mode).toBe('enter');
  expect(store.getState().selection.ids).toEqual(['e1']);
  expect(store.canUndo()).toBe(false);
  expect(store.getState().dirty).toBe(false);
});

test('undo restores the cursor only when the entry moved it', () => {
  const store = createEditorStore(helloDoc());
  store.dispatch(setCursor, { tick: 960 }, { record: false });
  store.dispatch(setComposer, { v: 'x' });
  store.dispatch(setCursor, { tick: 1920 }, { record: false });
  store.undo();
  expect(store.getState().cursor.tick).toBe(1920);
  const moving: Command<{ tick: number }> = { label: 'move', run: (d, a) => { d.cursor.tick = a.tick; d.document.meta.composer = 'z'; } };
  store.dispatch(moving, { tick: 2880 });
  store.undo();
  expect(store.getState().cursor.tick).toBe(1920);
  store.redo();
  expect(store.getState().cursor.tick).toBe(2880);
});

test('undo and redo do nothing on empty stacks', () => {
  const store = createEditorStore(helloDoc());
  const before = store.getState();
  store.undo(); store.redo();
  expect(store.getState()).toBe(before);
});

test('initial state', () => {
  const doc = helloDoc();
  const store = createEditorStore(doc);
  const s = store.getState();
  expect(s.cursor).toMatchObject({ partId: doc.parts[0].id, staff: 1, voice: 1, measureId: doc.global.measures[0].id, tick: 0, mode: 'select', duration: { base: 'quarter', dots: 0 } });
  expect(s.activeLayoutId).toBe(doc.layouts[0].id);
  expect(s.invariantErrors).toEqual([]);
  expect(s.selection.ids).toEqual([]);
  expect(s.history).toEqual({ past: [], future: [] });
});

test('invariant errors follow dispatch, undo and redo', () => {
  const store = createEditorStore(helloDoc());
  const breakIt: Command<object> = { label: 'break', run: (d) => { d.document.parts[0].measures[0].sequences[0].content.pop(); } };
  store.dispatch(breakIt, {});
  expect(store.getState().invariantErrors.some((m) => m.startsWith('bar-length:'))).toBe(true);
  store.undo();
  expect(store.getState().invariantErrors).toEqual([]);
  store.redo();
  expect(store.getState().invariantErrors).toHaveLength(1);
});

test('redo after a delete repairs a cursor moved into the deleted bar since', () => {
  const doc = createDocument({ parts: [{ name: 'Flute', clef: 'treble', gmProgram: 74 }], measures: 3 });
  const [m0, m1] = doc.global.measures.map((m) => m.id);
  const store = createEditorStore(doc);
  store.dispatch(deleteMeasure, { measureId: m1 });
  store.undo();
  store.dispatch(setCursor, { measureId: m1, tick: 960 }, { record: false });
  store.dispatch(setSelection, { ids: [m1] }, { record: false });
  store.redo();
  const s = store.getState();
  expect(s.document.global.measures.map((m) => m.id)).not.toContain(m1);
  expect(s.cursor).toMatchObject({ measureId: m0, tick: 0 });
  expect(s.selection.ids).toEqual([]);
});

test('undo of a longer time signature pulls the cursor and selection back inside the bar', () => {
  const store = createEditorStore(threeQuarterNotesDoc());
  const [m0] = store.getState().document.global.measures.map((m) => m.id);
  store.dispatch(setTime, { measureId: m0, time: { count: 6, unit: 4 } });
  const added = store.getState().document.parts[0].measures[0].sequences[0].content[4].id;
  store.dispatch(setCursor, { tick: 4800 }, { record: false });
  store.dispatch(setSelection, { ids: ['e1', added] }, { record: false });
  store.undo();
  expect(store.getState().cursor.tick).toBe(2880);
  expect(store.getState().selection.ids).toEqual(['e1']);
  store.redo();
  expect(store.getState().cursor.tick).toBe(2880);
});
