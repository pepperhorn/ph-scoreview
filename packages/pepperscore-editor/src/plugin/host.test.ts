import { createEditorHost, isVisibleTarget } from './host';
import { createEditorStore } from '../engine/store';
import { setMeta, setCursor } from '../engine/commands';
import { helloDoc } from '../test-helpers';

const setup = (editable = true) => {
  const store = createEditorStore(helloDoc());
  const host = createEditorHost(store, { root: () => null, revealTarget: () => {}, openPopover: () => {}, shell: 'desktop', editable, origin: 'opened' });
  return { store, host };
};
test('plugin dispatch is undoable and preserves invariants', () => {
  const { store, host } = setup();
  const original = host.getDocument();
  host.dispatch(setMeta, { title: 'Plugin title' });
  expect(host.getDocument().meta.title).toBe('Plugin title');
  expect(store.getState().invariantErrors).toEqual([]);
  store.undo();
  expect(host.getDocument()).toEqual(original);
  store.redo();
  expect(host.getDocument().meta.title).toBe('Plugin title');
});
test('subscribe observes document changes including undo, but not cursor moves; unsubscribe removes it', () => {
  const { store, host } = setup();
  const seen: unknown[] = [];
  const off = host.subscribe(doc => seen.push(doc));
  host.dispatch(setCursor, { ...store.getState().cursor, tick: 960 });
  expect(seen).toHaveLength(0);
  host.dispatch(setMeta, { composer: 'A' });
  store.undo();
  expect(seen).toHaveLength(2);
  off();
  host.dispatch(setMeta, { composer: 'B' });
  expect(seen).toHaveLength(2);
});
test('read-only host refuses dispatch', () => {
  const { host, store } = setup(false);
  host.dispatch(setMeta, { title: 'Denied' });
  expect(host.getDocument().meta.title).not.toBe('Denied');
  expect(store.canUndo()).toBe(false);
});

// Geometry/hit-stack contract in Node; real browser layout is covered by validation/editor.mjs.
test('target visibility skips plugin hits but stops at the first non-plugin hit', () => {
  const target = {
    offsetParent: {}, closest: () => null,
    getBoundingClientRect: () => ({ left: 10, top: 10, width: 40, height: 20 }),
    contains: (hit: unknown) => hit === target || hit === child,
    ownerDocument: {
      defaultView: { innerWidth: 1280, innerHeight: 900, getComputedStyle: () => ({ visibility: 'visible', display: 'block' }) },
      elementsFromPoint: (x: number, y: number) => { expect([x, y]).toEqual([30, 20]); return hits; },
    },
  };
  const child = { closest: () => null };
  const overlay = { closest: () => ({}) };
  const cover = { closest: () => null };
  let hits: unknown[] = [overlay, overlay, child, target];
  const visible = () => isVisibleTarget(target as unknown as HTMLElement);
  expect(visible()).toBe(true);
  hits = [overlay, cover, child, target];
  expect(visible()).toBe(false);
  hits = [child, target];
  expect(visible()).toBe(true);
  hits = [overlay];
  expect(visible()).toBe(false);
  hits = [];
  expect(visible()).toBe(false);
});
