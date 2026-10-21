import { applyPatches, enablePatches, produceWithPatches, type Patch } from 'immer';
import { createStore } from 'zustand/vanilla';
import { checkInvariants } from '../model/invariants';
import type { Document } from '../model/schema';
import { clampCursor } from './cursor-clamp';
import { applyLayout, type ViewResult } from './layout/apply-layout';
import { visibleStaves } from './layout/visible-staves';
import { record, takeRedo, takeUndo } from './history';
import { liveSelection } from './prune';
import type { Command, Cursor, Editable, EditorState, HistoryEntry, Selection } from './types';

enablePatches();

function initialCursor(document: Document): Cursor {
  return {
    partId: document.parts[0]?.id ?? '',
    staff: 1,
    voice: 1,
    measureId: document.global.measures[0]?.id ?? '',
    tick: 0,
    duration: { base: 'quarter', dots: 0 },
    mode: 'select',
  };
}

const editableOf = (s: EditorState): Editable => ({ document: s.document, cursor: s.cursor, selection: s.selection, activeLayoutId: s.activeLayoutId });

/**
 * A cursor on a staff layout `layoutId` does not draw (after a layout switch, a custom layout or a stave toggle)
 * moves to the first drawn staff at the same bar and tick (voice 1), and the selection clears; otherwise both are
 * returned as they are. A layout drawing nothing leaves them alone.
 */
function onDrawnStaff(doc: Document, layoutId: string, cursor: Cursor, selection: Selection): { cursor: Cursor; selection: Selection } {
  const drawn = visibleStaves(doc, doc.layouts.find((l) => l.id === layoutId));
  if (!drawn.length || drawn.some((s) => s.partId === cursor.partId && s.staff === cursor.staff)) return { cursor, selection };
  const { entered: _entered, ...rest } = cursor;
  return { cursor: clampCursor(doc, { ...rest, ...drawn[0], voice: 1 }), selection: selection.ids.length ? { ids: [] } : selection };
}

/**
 * `maxStaves` is the staff cap the invariant report checks (default 4); `cursor` and `activeLayoutId`
 * restore a saved editor position (a stale cursor is clamped, an unknown layout ignored).
 */
export type EditorStoreOptions = { maxStaves?: number; cursor?: Cursor; activeLayoutId?: string };

export function createEditorStore(document: Document, options: EditorStoreOptions = {}) {
  const check = (doc: Document) => checkInvariants(doc, { maxStaves: options.maxStaves });
  /** The layout `id` if `doc` has it, else the first; and its view, memoised on the document and layout id. */
  let memo: { document: Document; layoutId: string; view: ViewResult } | undefined;
  const layoutView = (doc: Document, id: string | undefined): { activeLayoutId: string; view: ViewResult } => {
    const layoutId = doc.layouts.some((l) => l.id === id) ? id! : (doc.layouts[0]?.id ?? '');
    if (memo?.document !== doc || memo.layoutId !== layoutId) memo = { document: doc, layoutId, view: applyLayout(doc, layoutId) };
    return { activeLayoutId: layoutId, view: memo.view };
  };
  const store = createStore<EditorState>()(() => {
    const layout = layoutView(document, options.activeLayoutId);
    const cursor = options.cursor ? clampCursor(document, options.cursor) : initialCursor(document);
    return {
      document,
      ...onDrawnStaff(document, layout.activeLayoutId, cursor, { ids: [] }),
      history: { past: [], future: [] },
      dirty: false,
      ...layout,
      invariantErrors: check(document),
    };
  });

  /** The history position last saved (or opened): the past stack's length and its top entry. */
  let saved: { length: number; top: HistoryEntry | undefined } = { length: 0, top: undefined };
  const dirtyAt = (history: EditorState['history']): boolean => history.past.length !== saved.length || history.past.at(-1) !== saved.top;

  /**
   * Applies history patches to the editable state and refreshes the invariant report. Cursor and
   * selection moves are not recorded, so after the patches they may point at bars, ticks or ids
   * the patches removed; they are repaired here, outside history.
   */
  const applyEntry = (patches: Patch[], history: EditorState['history']) => {
    const previous = store.getState().document;
    const next = applyPatches(editableOf(store.getState()), patches);
    const layout = layoutView(next.document, next.activeLayoutId);
    store.setState({
      document: next.document,
      ...onDrawnStaff(next.document, layout.activeLayoutId, clampCursor(next.document, next.cursor, previous), liveSelection(next.document, next.selection)),
      ...layout,
      history,
      dirty: dirtyAt(history),
      invariantErrors: check(next.document),
    });
  };

  return Object.assign(store, {
    /** Runs `command` on a draft; recorded in history (record defaults true) unless it changed nothing or the command is never recorded. */
    dispatch<A>(command: Command<A>, args: A, options?: { record?: boolean }): void {
      const state = store.getState();
      const [next, patches, inverse] = produceWithPatches(editableOf(state), (draft) => command.run(draft, args));
      if (patches.length === 0) return;
      const layout = layoutView(next.document, next.activeLayoutId);
      // A layout change can leave the cursor on a staff it does not draw: repaired here, outside history.
      const update: Partial<EditorState> = { ...next, ...layout, ...onDrawnStaff(next.document, layout.activeLayoutId, next.cursor, next.selection), invariantErrors: check(next.document) };
      if (command.record !== false && (options?.record ?? true)) {
        const entry: HistoryEntry = { label: command.label, patches, inverse, coalesceKey: command.coalesceKey?.(args), at: Date.now() };
        update.history = record(state.history, entry);
        update.dirty = dirtyAt(update.history);
      }
      store.setState(update);
    },
    undo(): void {
      const taken = takeUndo(store.getState().history);
      if (taken) applyEntry(taken.entry.inverse, taken.history);
    },
    redo(): void {
      const taken = takeRedo(store.getState().history);
      if (taken) applyEntry(taken.entry.patches, taken.history);
    },
    /** Marks the current history position as saved: `dirty` is false until the score moves away from it. */
    markSaved(): void {
      const { past } = store.getState().history;
      saved = { length: past.length, top: past.at(-1) };
      if (store.getState().dirty) store.setState({ dirty: false });
    },
    /** True when the score differs from the last save (or the opened score); undo back to it is clean. */
    isDirty: (): boolean => store.getState().dirty,
    canUndo: (): boolean => store.getState().history.past.length > 0,
    canRedo: (): boolean => store.getState().history.future.length > 0,
  });
}

export type EditorStore = ReturnType<typeof createEditorStore>;
