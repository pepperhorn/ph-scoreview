import type { ComponentType } from 'react';
import type { EditorStore } from '../engine/store';
import type { Command } from '../engine/types';
import type { Document } from '../model/schema';
import type { PopoverName } from '../ui/keymap';

export type EditorTarget = 'title' | 'composer' | 'details' | 'key' | 'time' | 'tempo' | 'clef' | 'parts';
export type EditorHost = {
  apiVersion: 1;
  getDocument(): Document;
  subscribe(listener: (document: Document) => void): () => void;
  dispatch<A>(command: Command<A>, args: A): void;
  findTarget(target: EditorTarget): HTMLElement | null;
  revealTarget(target: EditorTarget): void;
  openPopover(name: PopoverName): void;
  shell: 'desktop' | 'phone';
  editable: boolean;
  origin: 'new' | 'opened';
};
export type EditorPlugin = { id: string; apiVersion: 1; Overlay: ComponentType<{ host: EditorHost }> };
type HostDeps = Pick<EditorHost, 'revealTarget' | 'openPopover' | 'shell' | 'editable' | 'origin'> & { root(): HTMLElement | null };

/** A target must be painted on screen and reachable at its centre, including through clipping ancestors. */
export function isVisibleTarget(element: HTMLElement): boolean {
  if (element.offsetParent === null || element.closest('[inert], [data-ps-plugin]')) return false;
  const view = element.ownerDocument.defaultView;
  if (!view) return false;
  const style = view.getComputedStyle(element);
  if (style.visibility !== 'visible' || style.display === 'none') return false;
  const rect = element.getBoundingClientRect();
  const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
  if (rect.width <= 0 || rect.height <= 0 || x < 0 || y < 0 || x >= view.innerWidth || y >= view.innerHeight) return false;
  const hit = element.ownerDocument.elementFromPoint(x, y);
  return hit !== null && element.contains(hit);
}

/** One host per measured shell/session. Plugins own and must dispose their subscriptions on unmount. */
export function createEditorHost(store: EditorStore, deps: HostDeps): EditorHost {
  return {
    apiVersion: 1,
    shell: deps.shell, editable: deps.editable, origin: deps.origin,
    getDocument: () => store.getState().document,
    subscribe: listener => store.subscribe((next, previous) => {
      if (next.document !== previous.document) listener(next.document);
    }),
    dispatch: (command, args) => { if (deps.editable) store.dispatch(command, args); },
    findTarget: target => [...(deps.root()?.querySelectorAll<HTMLElement>(`[data-ps-target="${target}"]`) ?? [])]
      .find(isVisibleTarget) ?? null,
    revealTarget: deps.revealTarget,
    openPopover: deps.openPopover,
  };
}
