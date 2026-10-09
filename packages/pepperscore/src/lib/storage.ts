import { createScoreDb, type ScoreDb } from './score-db';
import { createLastFileStore, type LastFileStore } from './last-file';

/**
 * Where a reader keeps its state: `persist` names the namespace (`<ns>-prefs`, `<ns>-file-v2:<hash>`, IndexedDB `<ns>` and
 * `<ns>-last-file`, sessionStorage `<ns>-reopen-dismissed`). `persist="scoreflow"` gives exactly the original Scoreflow
 * names, so existing visitors keep their settings. `false` reads and writes nothing.
 *
 * Not namespaced: the diagnostic and test hooks `scoreflow-chunking`, `scoreflow-simulate-oom` (verovio-runtime.ts) and
 * `scoreflow-large-file-bytes` (large-file.ts). Set by tests or by hand (the reader only clears
 * `scoreflow-simulate-oom` once it fires), they are diagnostics exempt from `persist`.
 */
export type PersistNamespace = string | false;
export type ReaderStorage = {
  namespace: PersistNamespace;
  readPrefs(): unknown;
  writePrefs(prefs: object): void;
  reopenDismissed(): boolean;
  dismissReopen(): void;
  scoreDb: ScoreDb;
  lastFile: LastFileStore;
};

const stores = new Map<string, ReaderStorage>();
const none: ReaderStorage = {
  namespace: false,
  readPrefs: () => null, writePrefs: () => {}, reopenDismissed: () => false, dismissReopen: () => {},
  scoreDb: createScoreDb({ indexedDB: null, storage: null }),
  lastFile: createLastFileStore(null),
};

/** The storage of a namespace, one per namespace for the page (readers sharing a namespace share its stores). */
export function readerStorage(ns: PersistNamespace): ReaderStorage {
  if (ns === false || !ns.trim()) return none;
  let store = stores.get(ns);
  if (!store) {
    const prefsKey = `${ns}-prefs`, dismissedKey = `${ns}-reopen-dismissed`;
    store = {
      namespace: ns,
      readPrefs: () => { try { return JSON.parse(localStorage.getItem(prefsKey) || 'null'); } catch { return null; } },
      writePrefs: prefs => { try { localStorage.setItem(prefsKey, JSON.stringify(prefs)); } catch { /* storage full or blocked */ } },
      reopenDismissed: () => { try { return sessionStorage.getItem(dismissedKey) === '1'; } catch { return false; } },
      dismissReopen: () => { try { sessionStorage.setItem(dismissedKey, '1'); } catch { /* hidden for this page only */ } },
      scoreDb: createScoreDb({ dbName: ns, keyPrefix: ns }),
      lastFile: createLastFileStore(`${ns}-last-file`),
    };
    stores.set(ns, store);
  }
  return store;
}
