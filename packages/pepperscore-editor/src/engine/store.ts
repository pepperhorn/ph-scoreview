import { applyPatches, enablePatches, produceWithPatches, type Patch } from 'immer';
import { createStore } from 'zustand/vanilla';
import { checkInvariants } from '../model/invariants';
import type { Document } from '../model/schema';
import { clampCursor } from './cursor-clamp';
import { record, takeRedo, takeUndo } from './history';
import { liveSelection } from './prune';
import type { Command, Cursor, Editable, EditorState, HistoryEntry } from './types';

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

const editableOf = (s: EditorState): Editable => ({ document: s.document, cursor: s.cursor, selection: s.selection });

/**
 * `maxStaves` is the staff cap the invariant report checks (default 4); `cursor` and `activeLayoutId`
 * restore a saved editor position (a stale cursor is clamped, an unknown layout ignored).
 */
export type EditorStoreOptions = { maxStaves?: number; cursor?: Cursor; activeLayoutId?: string };

export function createEditorStore(document: Document, options: EditorStoreOptions = {}) {
  const check = (doc: Document) => checkInvariants(doc, { maxStaves: options.maxStaves });
  const layoutId = document.layouts.some((l) => l.id === options.activeLayoutId) ? options.activeLayoutId : undefined;
  const store = createStore<EditorState>()(() => ({
    document,
    cursor: options.cursor ? clampCursor(document, options.cursor) : initialCursor(document),
    selection: { ids: [] },
    history: { past: [], future: [] },
    dirty: false,
    activeLayoutId: layoutId ?? document.layouts[0]?.id ?? '',
    invariantErrors: check(document),
  }));

  /**
   * Applies history patches to the editable state and refreshes the invariant report. Cursor and
   * selection moves are not recorded, so after the patches they may point at bars, ticks or ids
   * the patches removed; they are repaired here, outside history.
   */
  const applyEntry = (patches: Patch[], history: EditorState['history']) => {
    const previous = store.getState().document;
    const next = applyPatches(editableOf(store.getState()), patches);
    store.setState({
      document: next.document,
      cursor: clampCursor(next.document, next.cursor, previous),
      selection: liveSelection(next.document, next.selection),
      history,
      dirty: true,
      invariantErrors: check(next.document),
    });
  };

  return Object.assign(store, {
    /** Runs `command` on a draft; recorded in history (record defaults true) unless it changed nothing. */
    dispatch<A>(command: Command<A>, args: A, options?: { record?: boolean }): void {
      const state = store.getState();
      const [next, patches, inverse] = produceWithPatches(editableOf(state), (draft) => command.run(draft, args));
      if (patches.length === 0) return;
      const update: Partial<EditorState> = { ...next, invariantErrors: check(next.document) };
      if (options?.record ?? true) {
        const entry: HistoryEntry = { label: command.label, patches, inverse, coalesceKey: command.coalesceKey?.(args), at: Date.now() };
        update.history = record(state.history, entry);
        update.dirty = true;
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
    canUndo: (): boolean => store.getState().history.past.length > 0,
    canRedo: (): boolean => store.getState().history.future.length > 0,
  });
}

export type EditorStore = ReturnType<typeof createEditorStore>;
