/**
 * The last opened score file, kept on this device so the reader can offer to reopen it after a reload or crash
 * (docs/specs/large-score-performance.md, Phase 3 "Guardrails"). It is never opened automatically.
 *
 * Database `<namespace>-last-file` (`scoreflow-last-file` for the Scoreflow names, see storage.ts), object store
 * `last-file` with two out-of-line keys: `info` (name, type, size, lastModified, savedAt) and `bytes` (the original file bytes, stored as the Blob itself so a large file is not read
 * and cloned on the main thread; an ArrayBuffer is also accepted), written in one transaction, so the
 * offer can be shown without loading the bytes. Only files up to MAX_SCORE_FILE_BYTES are kept. Every access is
 * wrapped in try/catch: without IndexedDB (private mode, blocked) nothing is remembered and nothing throws.
 */
import { MAX_SCORE_FILE_BYTES } from './mxl';

export const LAST_FILE_DB_NAME = 'scoreflow-last-file';
export const LAST_FILE_STORE = 'last-file';
const INFO_KEY = 'info';
const BYTES_KEY = 'bytes';

export type LastFileInfo = { name: string; type: string; size: number; lastModified: number; savedAt: number };
export type LastFileRecord = LastFileInfo & { bytes: Blob | ArrayBuffer };

const settle = <T>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
const done = (transaction: IDBTransaction) => new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction failed.')); });

const isInfo = (value: unknown): value is LastFileInfo => {
  const info = value as LastFileInfo | null;
  return !!info && typeof info.name === 'string' && typeof info.type === 'string' && Number.isFinite(info.size) && Number.isFinite(info.lastModified) && Number.isFinite(info.savedAt);
};
const infoOf = (info: LastFileInfo): LastFileInfo => ({ name: info.name, type: info.type, size: info.size, lastModified: info.lastModified, savedAt: info.savedAt });
/** Whether `file` is the remembered one (same name, type, size and modification time). */
export const isSameFile = (info: LastFileInfo | null, file: Pick<File, 'name' | 'type' | 'size' | 'lastModified'>) =>
  !!info && info.name === file.name && info.type === file.type && info.size === file.size && info.lastModified === file.lastModified;

/** A File for the normal open path, rebuilt from a remembered record. */
export const lastFileToFile = (record: LastFileRecord) => new File([record.bytes], record.name, { type: record.type, lastModified: record.lastModified });

/** The last-file store of one persist namespace (see storage.ts). Every method resolves and never rejects. */
export type LastFileStore = {
  /** The remembered file's details, without its bytes; null when there is none or storage is unavailable. */
  readInfo(): Promise<LastFileInfo | null>;
  /** The remembered file with its bytes; null when there is none, it is incomplete, or storage is unavailable. */
  read(): Promise<LastFileRecord | null>;
  /**
   * Remember `file` (its original bytes) as the last opened file, replacing any previous one. Files above
   * MAX_SCORE_FILE_BYTES are not kept. Resolves to the stored details, or null when nothing was stored.
   */
  remember(file: File): Promise<LastFileInfo | null>;
  /** Delete the remembered file. */
  forget(): Promise<void>;
};
const disabled: LastFileStore = { readInfo: async () => null, read: async () => null, remember: async () => null, forget: async () => {} };

/** The store in database `dbName` (LAST_FILE_DB_NAME for the Scoreflow names); `null` remembers nothing. */
export function createLastFileStore(dbName: string | null): LastFileStore {
  if (!dbName) return disabled;
  let opening: Promise<IDBDatabase | null> | undefined;
  const open = (): Promise<IDBDatabase | null> => opening ??= new Promise<IDBDatabase | null>(resolve => {
    try {
      const factory = globalThis.indexedDB;
      if (!factory) { resolve(null); return; }
      const request = factory.open(dbName, 1);
      request.onupgradeneeded = () => { request.result.createObjectStore(LAST_FILE_STORE); };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); opening = undefined; };
        resolve(db);
      };
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch { resolve(null); }
  }).then(db => { if (!db) opening = undefined; return db; });

  return {
    async readInfo() {
      try {
        const db = await open();
        if (!db) return null;
        const value = await settle(db.transaction(LAST_FILE_STORE, 'readonly').objectStore(LAST_FILE_STORE).get(INFO_KEY));
        return isInfo(value) ? infoOf(value) : null;
      } catch { return null; }
    },
    async read() {
      try {
        const db = await open();
        if (!db) return null;
        const store = db.transaction(LAST_FILE_STORE, 'readonly').objectStore(LAST_FILE_STORE);
        const [info, bytes] = await Promise.all([settle(store.get(INFO_KEY)), settle(store.get(BYTES_KEY))]);
        if (!isInfo(info) || !(bytes instanceof Blob || bytes instanceof ArrayBuffer)) return null;
        return { ...infoOf(info), bytes };
      } catch { return null; }
    },
    async remember(file) {
      try {
        if (file.size > MAX_SCORE_FILE_BYTES) return null;
        const db = await open();
        if (!db) return null;
        // The File itself is stored: IndexedDB keeps a Blob without the page reading or cloning its bytes.
        const bytes: Blob = file;
        const info: LastFileInfo = { name: file.name, type: file.type, size: file.size, lastModified: file.lastModified, savedAt: Date.now() };
        const transaction = db.transaction(LAST_FILE_STORE, 'readwrite');
        const store = transaction.objectStore(LAST_FILE_STORE);
        store.put(bytes, BYTES_KEY);
        store.put(info, INFO_KEY);
        await done(transaction);
        return info;
      } catch { return null; }
    },
    async forget() {
      try {
        const db = await open();
        if (!db) return;
        const transaction = db.transaction(LAST_FILE_STORE, 'readwrite');
        transaction.objectStore(LAST_FILE_STORE).clear();
        await done(transaction);
      } catch { /* nothing to forget */ }
    },
  };
}
