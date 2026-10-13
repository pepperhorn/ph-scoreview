import { createEditorStore } from '../store';
import { addDynamic, addText, addWedge, nudge, removeDirection } from './index';
import { compileToMusicXml } from '../../compile/to-musicxml';
import { checkInvariants } from '../../model/invariants';
import { helloDoc } from '../../test-helpers';

const anchorAt = (store: ReturnType<typeof createEditorStore>, tick: number) => ({ measureId: store.getState().document.global.measures[0].id, tick, staff: 1 });
const directions = (store: ReturnType<typeof createEditorStore>) => store.getState().document.parts[0].measures[0].directions;

test('addDynamic compiles with offset', () => {
  const store = createEditorStore(helloDoc());
  store.dispatch(addDynamic, { anchor: anchorAt(store, 480), value: 'mf' });
  expect(directions(store)).toMatchObject([{ kind: 'dynamic', value: 'mf', anchor: { tick: 480 } }]);
  const xml = compileToMusicXml(store.getState().document);
  expect(xml).toMatch(/<dynamics>\s*<mf\/>\s*<\/dynamics>/);
  expect(xml).toMatch(/<offset>-480<\/offset>/);
  expect(checkInvariants(store.getState().document)).toEqual([]);
});

test('addWedge, addText, removeDirection', () => {
  const store = createEditorStore(helloDoc());
  store.dispatch(addWedge, { anchor: anchorAt(store, 0), shape: 'cresc', endTick: 1920 });
  store.dispatch(addText, { anchor: anchorAt(store, 960), text: 'dolce', style: 'expression' });
  expect(directions(store)).toMatchObject([{ kind: 'wedge', shape: 'cresc', endTick: 1920 }, { kind: 'text', text: 'dolce', style: 'expression' }]);
  expect(new Set(directions(store).map((d) => d.id)).size).toBe(2);
  store.dispatch(removeDirection, { id: directions(store)[0].id });
  expect(directions(store).map((d) => d.kind)).toEqual(['text']);
  expect(store.getState().invariantErrors).toEqual([]);
});

test('nudge accumulates the offset and coalesces into one undo step', () => {
  const store = createEditorStore(helloDoc());
  store.dispatch(addDynamic, { anchor: anchorAt(store, 0), value: 'p' });
  const id = directions(store)[0].id;
  store.dispatch(nudge, { id, dx: 1, dy: 0 });
  store.dispatch(nudge, { id, dx: 1, dy: -2 });
  expect(directions(store)[0].offset).toEqual({ x: 2, y: -2 });
  expect(store.getState().history.past).toHaveLength(2);
  store.undo();
  expect(directions(store)[0].offset).toBeUndefined();
});
