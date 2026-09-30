/**
 * Per-score memory: a small IndexedDB store of FileState v2 records keyed by source hash.
 *
 * Database `scoreflow`, object store `scores` (key path `source.sha256`, index `lastOpened`).
 * The first read of a hash falls back to the localStorage v1 record and imports it; the
 * v1 copy is removed after the next successful IndexedDB write. When IndexedDB is
 * unavailable (private mode, blocked) records go to localStorage instead. All access is
 * wrapped in try/catch, writes are debounced and never block rendering, and only the most
 * recently opened MAX_SCORE_RECORDS scores are kept. Only settings and hashes are stored.
 */
import type { Score } from './score';
import { legacyStorageKey, migrateFileState, parseFileState, parseLegacyFileState, textSource, type FileSource, type FileState } from './file-state';
import { deviceClass, type DeviceClass } from './stave-scale';

export const SCORE_DB_NAME = 'scoreflow';
export const SCORE_STORE = 'scores';
export const MAX_SCORE_RECORDS = 200;
export const SCORE_WRITE_DEBOUNCE_MS = 400;
const fallbackKey = (hash: string) => `scoreflow-file-v2:${hash}`;
const FALLBACK_PREFIX = 'scoreflow-file-v2:';

export type ScoreDbOptions = {
  /** IndexedDB factory; `null` forces the localStorage fallback. Defaults to `globalThis.indexedDB`. */
  indexedDB?: Pick<IDBFactory, 'open'> | null;
  /** Fallback and legacy storage; `null` disables it. Defaults to `globalThis.localStorage`. */
  storage?: Storage | null;
  dbName?: string;
  maxRecords?: number;
  debounceMs?: number;
  /** Device class a migrated v1 zoom is attributed to. */
  device?: () => DeviceClass;
};
export type ScoreDb = {
  read(source: FileSource): Promise<FileState | null>;
  /** Queue a record; writes for the same hash within the debounce window coalesce. */
  write(state: FileState): void;
  /** Write every queued record now. */
  flush(): Promise<void>;
  keys(): Promise<string[]>;
  backend(): Promise<'indexeddb' | 'localstorage' | 'none'>;
};

const settle = <T>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
const done = (transaction: IDBTransaction) => new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction failed.')); });

export function createScoreDb(options: ScoreDbOptions = {}): ScoreDb {
  const dbName = options.dbName ?? SCORE_DB_NAME;
  const maxRecords = options.maxRecords ?? MAX_SCORE_RECORDS;
  const debounceMs = options.debounceMs ?? SCORE_WRITE_DEBOUNCE_MS;
  const device = options.device ?? deviceClass;
  const storage = (): Storage | null => {
    if (options.storage !== undefined) return options.storage;
    try { return globalThis.localStorage ?? null; } catch { return null; }
  };
  let opening: Promise<IDBDatabase | null> | undefined;
  const open = () => opening ??= new Promise<IDBDatabase | null>(resolve => {
    try {
      const factory = options.indexedDB !== undefined ? options.indexedDB : globalThis.indexedDB;
      if (!factory) { resolve(null); return; }
      const request = factory.open(dbName, 1);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore(SCORE_STORE, { keyPath: 'source.sha256' });
        store.createIndex('lastOpened', 'lastOpened');
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); opening = undefined; };
        resolve(db);
      };
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });

  const readLocal = (hash: string): FileState | null => {
    try { return parseFileState(storage()?.getItem(fallbackKey(hash)), hash); } catch { return null; }
  };
  const readLegacy = (hash: string): FileState | null => {
    try {
      const legacy = parseLegacyFileState(storage()?.getItem(legacyStorageKey(hash)), hash);
      return legacy && migrateFileState(legacy, device());
    } catch { return null; }
  };
  const writeLocal = (state: FileState) => {
    const store = storage();
    if (!store) return;
    try {
      store.setItem(fallbackKey(state.source.sha256), JSON.stringify(state));
      const records = localKeys(store).map(hash => ({ hash, lastOpened: readLocal(hash)?.lastOpened ?? 0 })).sort((a, b) => a.lastOpened - b.lastOpened);
      for (const { hash } of records.slice(0, Math.max(0, records.length - maxRecords))) store.removeItem(fallbackKey(hash));
    } catch { /* Storage may be full or unavailable; the session still works. */ }
  };
  const localKeys = (store: Storage) => {
    const hashes: string[] = [];
    for (let index = 0; index < store.length; index++) { const key = store.key(index); if (key?.startsWith(FALLBACK_PREFIX)) hashes.push(key.slice(FALLBACK_PREFIX.length)); }
    return hashes;
  };

  const writeDb = async (db: IDBDatabase, state: FileState) => {
    const transaction = db.transaction(SCORE_STORE, 'readwrite');
    const store = transaction.objectStore(SCORE_STORE);
    store.put(state);
    const count = await settle(store.count());
    if (count > maxRecords) {
      let excess = count - maxRecords;
      const cursor = store.index('lastOpened').openCursor();
      await new Promise<void>((resolve, reject) => {
        cursor.onsuccess = () => {
          const current = cursor.result;
          if (!current || excess <= 0) { resolve(); return; }
          if (current.primaryKey !== state.source.sha256) { current.delete(); excess--; }
          current.continue();
        };
        cursor.onerror = () => reject(cursor.error);
      });
    }
    await done(transaction);
  };

  const pending = new Map<string, FileState>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let flushing: Promise<void> = Promise.resolve();
  const flushNow = async () => {
    clearTimeout(timer); timer = undefined;
    const batch = [...pending.values()];
    pending.clear();
    if (!batch.length) return;
    const db = await open();
    for (const state of batch) {
      if (db) {
        try {
          await writeDb(db, state);
          // The legacy copy (and any fallback copy) is dropped once IndexedDB holds the record.
          try { storage()?.removeItem(legacyStorageKey(state.source.sha256)); storage()?.removeItem(fallbackKey(state.source.sha256)); } catch { /* ignore */ }
          continue;
        } catch { /* fall back below */ }
      }
      writeLocal(state);
    }
  };
  const flush = () => (flushing = flushing.then(flushNow, flushNow));

  return {
    async read(source) {
      const hash = source.sha256;
      const queued = pending.get(hash);
      if (queued) return structuredClone(queued);
      const db = await open();
      if (db) {
        try {
          const stored = await settle(db.transaction(SCORE_STORE, 'readonly').objectStore(SCORE_STORE).get(hash));
          const state = stored === undefined ? null : parseFileState(stored, hash);
          if (state) return state;
        } catch { /* fall back to localStorage */ }
      }
      return readLocal(hash) ?? readLegacy(hash);
    },
    write(state) {
      pending.set(state.source.sha256, structuredClone(state));
      clearTimeout(timer);
      if (debounceMs <= 0) void flush();
      else timer = setTimeout(() => void flush(), debounceMs);
    },
    flush,
    async keys() {
      const db = await open();
      if (db) {
        try { return (await settle(db.transaction(SCORE_STORE, 'readonly').objectStore(SCORE_STORE).getAllKeys())).map(String); }
        catch { /* fall through */ }
      }
      const store = storage();
      return store ? localKeys(store) : [];
    },
    async backend() { return (await open()) ? 'indexeddb' : storage() ? 'localstorage' : 'none'; },
  };
}

/** The app-wide store; IndexedDB opens lazily on first use. */
export const scoreDb = createScoreDb();

/** Stable identity of the built-in sample: its engraving text with its format prefix. */
export const sampleSource = (score: Score): FileSource => textSource(score.document?.format || 'sample', score.document?.originalText || '', score.title || 'Sample score');
