import { compileToMusicXml } from '../compile/to-musicxml';
import { importMusicXml, type Dropped } from '../import/from-musicxml';
import { PEPPERSCORE_EXTENSION, PEPPERSCORE_MIME, readPepperScoreFile, writePepperScoreFile, type PepperScoreFile } from '../format/pepperscore-file';
import { DEFAULT_MAX_STAVES } from '../licence';
import { createDocument } from '../model/create';
import { staffCount } from '../model/query';
import type { Document } from '../model/schema';

export const OPEN_ACCEPT = `${PEPPERSCORE_EXTENSION},.musicxml,.xml`;

/** An opened score; a `.pepperscore` file also brings its import source, editor state and creation time. */
export type Opened = { document: Document; dropped: Dropped[]; source?: PepperScoreFile['source']; editor?: PepperScoreFile['editor']; created?: string };

export const newScore = (): Document => createDocument({ parts: [{ name: 'Treble', clef: 'treble', gmProgram: 1 }], measures: 8 });

export const staffLimitMessage = (maxStaves: number): string => `Editing is limited to ${maxStaves} staves.`;

/** Refuses documents over the staff cap (the licence's, default 4) with the message the editor shows. */
export function checkStaffCap(document: Document, maxStaves = DEFAULT_MAX_STAVES): Document {
  if (staffCount(document) > maxStaves) throw new Error(staffLimitMessage(maxStaves));
  return document;
}

/** Reads a `.pepperscore` file or MusicXML text. The staff cap is left to the editor, which knows the licence. */
export function readScoreText(text: string, filename: string): Opened {
  if (filename.toLowerCase().endsWith(PEPPERSCORE_EXTENSION)) {
    const { document, source, editor, meta } = readPepperScoreFile(text);
    return { document, dropped: [], source, editor, created: meta.created };
  }
  return importMusicXml(text, { maxStaves: Infinity });
}

/** Lowercase hex SHA-256 of the UTF-8 text. */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The `source` record of imported MusicXML: its SHA-256, file name and what the import dropped. Undefined
 * where Web Crypto is unavailable (pages served over plain HTTP from a non-localhost address).
 */
export async function importSource(text: string, dropped: Dropped[], filename?: string): Promise<PepperScoreFile['source']> {
  try {
    return { format: 'musicxml', sha256: await sha256Hex(text), ...(filename !== undefined ? { filename } : {}), dropped };
  } catch {
    return undefined;
  }
}

/** Opens a file; imported MusicXML gets a `source` record. */
export async function readScoreFile(file: File): Promise<Opened> {
  const text = await file.text();
  const opened = readScoreText(text, file.name);
  if (file.name.toLowerCase().endsWith(PEPPERSCORE_EXTENSION)) return opened;
  return { ...opened, source: await importSource(text, opened.dropped, file.name) };
}

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

/** Downloads `<title or score>.pepperscore`. */
export function savePepperScore(args: Parameters<typeof writePepperScoreFile>[0]): void {
  download(writePepperScoreFile(args), `${baseName(args.document)}${PEPPERSCORE_EXTENSION}`, PEPPERSCORE_MIME);
}

/** A one-line summary of what an import left out, e.g. `lyric ×3, harmony ×1`. */
export function describeDropped(dropped: Dropped[]): string {
  const totals = new Map<string, number>();
  for (const d of dropped) totals.set(d.feature, (totals.get(d.feature) ?? 0) + d.count);
  return [...totals].map(([feature, count]) => `${feature} ×${count}`).join(', ');
}
