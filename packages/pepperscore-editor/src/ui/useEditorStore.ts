import { useStore } from 'zustand';
import type { EditorStore } from '../engine/store';
import type { EditorState } from '../engine/types';

/**
 * Subscribes a component to a slice of the editor store. The selector must return a stable value
 * (a primitive or an object already in the state); a fresh object per call re-renders forever.
 */
export function useEditorStore<T>(store: EditorStore, selector: (state: EditorState) => T): T {
  return useStore(store, selector);
}
