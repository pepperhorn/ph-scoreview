import { z } from 'zod';
import type { Cursor } from '../engine/types';
import type { Dropped } from '../import/from-musicxml';
import { DurationSchema, parseDocument, PitchSchema, type Document } from '../model/schema';

export const PEPPERSCORE_MIME = 'application/vnd.pepperscore+json';
export const PEPPERSCORE_EXTENSION = '.pepperscore';

/** The native file: a versioned wrapper around the editor document. */
export type PepperScoreFile = {
  pepperscore: { version: 1 };
  meta: { title?: string; composer?: string; created: string; modified: string };
  document: Document;
  /** The MusicXML the score was imported from, and what the import left out. */
  source?: { format: 'musicxml' | 'mxl'; sha256: string; filename?: string; dropped: Dropped[] };
  /** Where the editor was when the file was saved. */
  editor?: { cursor?: Cursor; activeLayoutId?: string };
};

const CursorSchema = z.object({
  partId: z.string(),
  staff: z.number().int().min(1),
  voice: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  measureId: z.string(),
  tick: z.number().min(0),
  duration: DurationSchema,
  mode: z.enum(['select', 'enter']),
  lastPitch: PitchSchema.optional(),
  lastPitchAt: z.object({ partId: z.string(), staff: z.number().int().min(1) }).optional(),
  entered: z.string().optional(),
  chord: z.boolean().optional(),
});

/** The wrapper; `document` is checked separately by `parseDocument`. */
export const PepperScoreFileSchema = z.object({
  pepperscore: z.object({ version: z.literal(1) }),
  meta: z.object({ title: z.string().optional(), composer: z.string().optional(), created: z.string(), modified: z.string() }),
  document: z.unknown(),
  source: z.object({
    format: z.enum(['musicxml', 'mxl']),
    sha256: z.string(),
    filename: z.string().optional(),
    dropped: z.array(z.object({ feature: z.string(), count: z.number().int().min(0), location: z.string() })),
  }).optional(),
  editor: z.object({ cursor: CursorSchema.optional(), activeLayoutId: z.string().optional() }).optional(),
});

/** Serializes a document (and optional import source and editor state) as 2-space JSON; `created` defaults to now. */
export function writePepperScoreFile(args: { document: Document; source?: PepperScoreFile['source']; editor?: PepperScoreFile['editor']; created?: string }): string {
  const modified = new Date().toISOString();
  const { title, composer } = args.document.meta;
  const file: PepperScoreFile = {
    pepperscore: { version: 1 },
    meta: { ...(title !== undefined ? { title } : {}), ...(composer !== undefined ? { composer } : {}), created: args.created ?? modified, modified },
    document: args.document,
    ...(args.source ? { source: args.source } : {}),
    ...(args.editor ? { editor: args.editor } : {}),
  };
  return JSON.stringify(file, null, 2);
}

/**
 * Parses and validates a `.pepperscore` file; throws `Not a .pepperscore file` (not JSON, or no header with a
 * numeric version) or `Unsupported .pepperscore version N`.
 */
export function readPepperScoreFile(text: string): PepperScoreFile {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('Not a .pepperscore file');
  }
  const header = typeof json === 'object' && json !== null ? (json as { pepperscore?: unknown }).pepperscore : undefined;
  if (typeof header !== 'object' || header === null) throw new Error('Not a .pepperscore file');
  const version = (header as { version?: unknown }).version;
  if (typeof version !== 'number') throw new Error('Not a .pepperscore file');
  if (version !== 1) throw new Error(`Unsupported .pepperscore version ${String(version)}`);
  const file = PepperScoreFileSchema.parse(json);
  return { ...file, document: parseDocument(file.document) } as PepperScoreFile;
}
