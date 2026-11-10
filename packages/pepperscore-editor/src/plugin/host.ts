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
      .find(element => element.offsetParent !== null && !element.closest('[inert], [data-ps-plugin]')) ?? null,
    revealTarget: deps.revealTarget,
    openPopover: deps.openPopover,
  };
}
