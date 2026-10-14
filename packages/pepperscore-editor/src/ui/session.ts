import { useEffect, useState } from 'react';
import { createEditorStore, type EditorStore } from '../engine/store';
import type { PepperScoreFile } from '../format/pepperscore-file';
import type { Dropped } from '../import/from-musicxml';
import { verifyLicence, type Licence } from '../licence';
import { importSource, type Opened } from './files';

type Source = PepperScoreFile['source'];
/** `source` and `created` are written back when the score is saved as `.pepperscore`. */
export type Session = { kind: 'ok'; id: number; store: EditorStore; dropped: Dropped[]; source: Promise<Source>; created: string } | { kind: 'error'; message: string };
let sessionIds = 0;

export function openSession(load: () => Opened, musicXml?: string): Session {
  try {
    const { document, dropped, source, editor, created } = load();
    // The staff cap comes from the licence and is checked by the editor (no command changes the staff count).
    const store = createEditorStore(document, { maxStaves: Infinity, cursor: editor?.cursor, activeLayoutId: editor?.activeLayoutId });
    const imported = source ? Promise.resolve(source) : musicXml ? importSource(musicXml, dropped) : Promise.resolve(undefined);
    return { kind: 'ok', id: ++sessionIds, store, dropped, source: imported, created: created ?? new Date().toISOString() };
  } catch (error) {
    return { kind: 'error', message: error instanceof Error ? error.message : String(error) };
  }
}

/** The verified licence for `key`: `undefined` while it is checked, `null` when absent, invalid or expired. */
export function useLicence(key: string | undefined): Licence | null | undefined {
  const [checked, setChecked] = useState<{ key: string | undefined; licence: Licence | null }>();
  useEffect(() => {
    let live = true;
    void verifyLicence(key ?? '').then((licence) => {
      if (live) setChecked({ key, licence });
    });
    return () => {
      live = false;
    };
  }, [key]);
  return checked && checked.key === key ? checked.licence : undefined;
}
