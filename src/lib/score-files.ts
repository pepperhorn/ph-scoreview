/**
 * Score file discovery for the Open dialog: which files the reader can open, and
 * how dropped files and folders are enumerated (bounded, so a huge folder can't hang the page).
 */
export type ScoreFormat = 'MusicXML' | 'MIDI' | 'MEI' | 'ABC';
export type ScoreFileCandidate = { file: File; path: string; format: ScoreFormat };
export type CollectedScoreFiles = { candidates: ScoreFileCandidate[]; unsupported: string[]; truncated: boolean };

/** The accept list for file inputs; importFile() dispatches on the same extensions. */
export const SCORE_FILE_ACCEPT = '.xml,.musicxml,.mxl,.mid,.midi,.mei,.abc,.txt';
export const FOLDER_MAX_DEPTH = 4;
export const FOLDER_MAX_ENTRIES = 500;
/** Plain .txt files found in folders are only offered when they look like ABC; only this much is read to check. */
const TXT_SNIFF_BYTES = 65_536;

const EXTENSION_FORMATS: Array<[RegExp, ScoreFormat]> = [
  [/\.(musicxml|xml|mxl)$/i, 'MusicXML'],
  [/\.(mid|midi)$/i, 'MIDI'],
  [/\.mei$/i, 'MEI'],
  [/\.(abc|txt)$/i, 'ABC'],
];

export const scoreFormatOf = (name: string): ScoreFormat | null => EXTENSION_FORMATS.find(([pattern]) => pattern.test(name))?.[1] ?? null;

/** ABC tunes need a key field (K:), which ends the header; that is enough to tell ABC from prose. */
export const looksLikeAbc = (text: string) => /^\s*K:/m.test(text);

// Minimal structural types for the File and Directory Entries API; entries are duck-typed so tests can mock them.
type FsEntry = { isFile: boolean; isDirectory: boolean; name: string; fullPath?: string };
type FsFileEntry = FsEntry & { file(success: (file: File) => void, failure?: (error: unknown) => void): void };
type FsDirectoryEntry = FsEntry & { createReader(): { readEntries(success: (entries: FsEntry[]) => void, failure?: (error: unknown) => void): void } };

const entryFile = (entry: FsFileEntry) => new Promise<File>((resolve, reject) => entry.file(resolve, reject));
const readBatch = (reader: ReturnType<FsDirectoryEntry['createReader']>) => new Promise<FsEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
const trimPath = (path: string) => path.replace(/^\/+/, '');

async function keepTxt(file: File) {
  try { return looksLikeAbc(await file.slice(0, TXT_SNIFF_BYTES).text()); }
  catch { return false; }
}

class Collector {
  candidates: ScoreFileCandidate[] = [];
  unsupported: string[] = [];
  truncated = false;
  seen = 0;
  constructor(private readonly fromFolder: (path: string) => boolean) {}
  full() {
    if (this.seen >= FOLDER_MAX_ENTRIES) { this.truncated = true; return true; }
    return false;
  }
  async add(file: File, path: string) {
    this.seen++;
    const format = scoreFormatOf(file.name);
    // Inside a folder, unsupported files and prose .txt files are skipped silently; a directly dropped one is reported.
    const inFolder = this.fromFolder(path);
    if (!format) { if (!inFolder) this.unsupported.push(file.name); return; }
    if (inFolder && /\.txt$/i.test(file.name) && !await keepTxt(file)) return;
    this.candidates.push({ file, path, format });
  }
  async walk(entry: FsEntry, depth: number): Promise<void> {
    if (this.full()) return;
    const path = trimPath(entry.fullPath || entry.name);
    if (entry.isFile) {
      try { await this.add(await entryFile(entry as FsFileEntry), path); }
      catch { /* unreadable file: skip it */ }
      return;
    }
    if (!entry.isDirectory) return;
    this.seen++;
    if (depth >= FOLDER_MAX_DEPTH) { this.truncated = true; return; }
    const reader = (entry as FsDirectoryEntry).createReader();
    // readEntries returns results in batches (100 in Chromium) until an empty batch.
    for (;;) {
      let batch: FsEntry[];
      try { batch = await readBatch(reader); } catch { return; }
      if (!batch.length) return;
      for (const child of batch) {
        if (this.full()) return;
        await this.walk(child, depth + 1);
      }
    }
  }
  result(): CollectedScoreFiles {
    const candidates = [...this.candidates].sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: 'base' }));
    return { candidates, unsupported: this.unsupported, truncated: this.truncated };
  }
}

/**
 * Collects score files from a drop. Directory entries must be taken synchronously inside the drop
 * handler (the DataTransfer is emptied afterwards), so callers pass the DataTransfer straight in
 * and this snapshots it before awaiting anything.
 */
export function collectDroppedScoreFiles(data: DataTransfer): Promise<CollectedScoreFiles> {
  const items = Array.from(data.items || []).filter(item => item.kind === 'file');
  const entries = items.map(item => (item as DataTransferItem & { webkitGetAsEntry?: () => FsEntry | null }).webkitGetAsEntry?.() ?? null);
  const files = Array.from(data.files || []);
  const collector = new Collector(path => path.includes('/'));
  return (async () => {
    if (entries.length && entries.every(Boolean)) {
      for (const entry of entries as FsEntry[]) await collector.walk(entry, 0);
    } else {
      // No entry API: plain files only (a dropped folder then shows up as an unreadable "file" and is skipped).
      for (const file of files.slice(0, FOLDER_MAX_ENTRIES)) await collector.add(file, file.name);
      if (files.length > FOLDER_MAX_ENTRIES) collector.truncated = true;
    }
    return collector.result();
  })();
}

/** Collects score files chosen through an `<input webkitdirectory>`; relative paths come from webkitRelativePath. */
export async function collectFolderInputFiles(list: FileList | File[]): Promise<CollectedScoreFiles> {
  const collector = new Collector(() => true);
  for (const file of Array.from(list)) {
    if (collector.full()) break;
    const path = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    if (path.split('/').length - 1 > FOLDER_MAX_DEPTH) { collector.truncated = true; continue; }
    await collector.add(file, path);
  }
  return collector.result();
}
