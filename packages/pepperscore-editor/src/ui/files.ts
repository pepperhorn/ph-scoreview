import { compileToMusicXml } from '../compile/to-musicxml';
import { importMusicXml, type Dropped } from '../import/from-musicxml';
import { createDocument } from '../model/create';
import { staffCount } from '../model/query';
import { parseDocument, type Document } from '../model/schema';

/** The MVP staff cap (Task 9 takes it from the licence). */
export const MAX_STAVES = 4;
export const STAFF_LIMIT_MESSAGE = 'Editing is limited to 4 staves.';
export const OPEN_ACCEPT = '.pepperscore,.musicxml,.xml';

export type Opened = { document: Document; dropped: Dropped[] };

/** Licence stub (Task 9 replaces it with the Ed25519 check): `'dev'`, or JSON whose `exp` (seconds) is in the future. */
export function isLicensed(key: string | undefined): boolean {
  if (!key) return false;
  if (key === 'dev') return true;
  try {
    const exp = (JSON.parse(key) as { exp?: unknown }).exp;
    return typeof exp === 'number' && exp > Date.now() / 1000;
  } catch {
    return false;
  }
}

export const newScore = (): Document => createDocument({ parts: [{ name: 'Treble', clef: 'treble', gmProgram: 1 }], measures: 8 });

/** Refuses documents over the staff cap with the message the editor shows. */
export function checkStaffCap(document: Document): Document {
  if (staffCount(document) > MAX_STAVES) throw new Error(STAFF_LIMIT_MESSAGE);
  return document;
}

/** Reads a `.pepperscore` (JSON with a `document`) or MusicXML text. */
export function readScoreText(text: string, filename: string): Opened {
  if (/\.pepperscore$/i.test(filename)) {
    let parsed: { document?: unknown };
    try {
      parsed = JSON.parse(text) as { document?: unknown };
    } catch {
      throw new Error('Not a .pepperscore file');
    }
    return { document: checkStaffCap(parseDocument(parsed.document)), dropped: [] };
  }
  const opened = importMusicXml(text);
  return { document: checkStaffCap(opened.document), dropped: opened.dropped };
}

export const readScoreFile = async (file: File): Promise<Opened> => readScoreText(await file.text(), file.name);

const baseName = (doc: Document): string => (doc.meta.title?.trim() || 'score').replace(/[\\/:*?"<>|]+/g, '-');

export function download(text: string, filename: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = window.document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export const exportMusicXml = (doc: Document): void =>
  download(compileToMusicXml(doc), `${baseName(doc)}.musicxml`, 'application/vnd.recordare.musicxml+xml');

/** Placeholder writer until Task 9's `writePepperScoreFile`. */
export function savePepperScore(doc: Document): void {
  const now = new Date().toISOString();
  const file = { pepperscore: { version: 1 }, meta: { ...doc.meta, created: now, modified: now }, document: doc };
  download(JSON.stringify(file, null, 2), `${baseName(doc)}.pepperscore`, 'application/json');
}

/** A one-line summary of what an import left out, e.g. `lyric ×3, harmony ×1`. */
export function describeDropped(dropped: Dropped[]): string {
  const totals = new Map<string, number>();
  for (const d of dropped) totals.set(d.feature, (totals.get(d.feature) ?? 0) + d.count);
  return [...totals].map(([feature, count]) => `${feature} ×${count}`).join(', ');
}
