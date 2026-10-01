/// <reference lib="webworker" />
import { sha256Digest } from './file-state';
import type { ImportReply, ImportRequest } from './import-protocol';
import { extractMxlScore, formatMb, MAX_SCORE_FILE_BYTES } from './mxl';
import { IdentityBuilder, type SourceDocument } from './notation/document';
import { readMusicXml } from './notation/musicxml-source';
import { buildBaseTimeline } from './playback/timeline';

/**
 * The import worker (docs/specs/large-score-performance.md, Phase 2): it reads a score file, hashes it once, reads
 * MusicXML/MXL in one streaming pass (Score, engraving text, inventory, navigation, playback marks), posts the Score
 * in bounded chunks so no single message costs the main thread a long task to deserialize, then builds the playback
 * timeline (in beats) and posts it the same way. Bytes travel as transferred ArrayBuffers. The main thread terminates
 * the worker when it is done, which releases everything the parse allocated.
 *
 * A separate worker from Verovio's: the Verovio worker holds a WASM heap that never shrinks and is recycled between
 * large scores, while this one is short-lived; and while the main thread starts Verovio's import with the engraving
 * bytes, this worker is still building the timeline.
 */

declare const self: DedicatedWorkerGlobalScope;
const post = (reply: ImportReply, transfer: Transferable[] = []) => self.postMessage(reply, transfer);
/** Notes per Score chunk, and events per timeline chunk: each message deserializes in a few milliseconds. */
const NOTES_PER_CHUNK = 4000;
const EVENTS_PER_CHUNK = 8000;

self.onmessage = async ({ data }: MessageEvent<ImportRequest>) => {
  try { await run(data); }
  catch (error) { post({ kind: 'error', message: error instanceof Error ? error.message : String(error) }); }
};

async function run(request: ImportRequest): Promise<void> {
  let text: string;
  let format: 'musicxml' | 'mxl' = 'musicxml';
  let original: Uint8Array | undefined;
  if (request.kind === 'file') {
    const { file } = request;
    if (file.size > MAX_SCORE_FILE_BYTES) throw new Error(`This file is ${formatMb(file.size)}; scores up to ${formatMb(MAX_SCORE_FILE_BYTES)} can be opened.`);
    original = new Uint8Array(await file.arrayBuffer());
    post({ kind: 'source', sha256: await sha256Digest(original) });
    const name = file.name.toLowerCase();
    if (/\.mxl$/.test(name)) { format = 'mxl'; text = extractMxlScore(original); }
    else if (/\.(xml|musicxml)$/.test(name)) text = new TextDecoder().decode(original);
    else { post({ kind: 'bytes', bytes: original.buffer as ArrayBuffer }, [original.buffer]); return; }
  } else {
    // Text the page holds is identified like file-state.ts textSource: a hash of the text with a format prefix.
    text = request.text;
    const prefixed = new TextEncoder().encode(`musicxml:${text}`);
    post({ kind: 'source', sha256: await sha256Digest(prefixed), size: prefixed.length - 'musicxml:'.length });
  }

  const read = readMusicXml(text);
  const { score } = read;
  post({ kind: 'head', score: { ...score, parts: score.parts.map(part => ({ ...part, measures: [] })) } });
  score.parts.forEach((part, index) => {
    let from = 0, notes = 0;
    part.measures.forEach((measure, at) => {
      notes += measure.notes.length + 1;
      if (notes >= NOTES_PER_CHUNK) { post({ kind: 'measures', part: index, measures: part.measures.slice(from, at + 1) }); from = at + 1; notes = 0; }
    });
    if (from < part.measures.length) post({ kind: 'measures', part: index, measures: part.measures.slice(from) });
  });
  // The engraving text is sent as bytes; when it is the source unchanged, the main thread reuses the source bytes.
  const unchanged = read.engravingText === text && format === 'musicxml';
  const engraving = unchanged ? null : new TextEncoder().encode(read.engravingText);
  const transfer: Transferable[] = [];
  if (original) transfer.push(original.buffer);
  if (engraving) transfer.push(engraving.buffer);
  post({ kind: 'done', format, original: original ? original.buffer as ArrayBuffer : null, engraving: engraving ? engraving.buffer as ArrayBuffer : null, inventory: read.inventory, diagnostics: read.diagnostics }, transfer);

  // The timeline groups staves by source part (pedal and dynamics scope), which the identity records.
  const identity = new IdentityBuilder();
  score.parts.forEach(part => identity.part(part));
  const timeline = buildBaseTimeline({ ...score, document: { identity: identity.identity } as SourceDocument }, { marks: read.playback });
  post({ kind: 'timeline', timeline: { ...timeline, events: [], eventSources: [] } });
  for (let from = 0; from < timeline.events.length; from += EVENTS_PER_CHUNK) {
    post({ kind: 'timeline-events', events: timeline.events.slice(from, from + EVENTS_PER_CHUNK), eventSources: timeline.eventSources.slice(from, from + EVENTS_PER_CHUNK) });
  }
  post({ kind: 'timeline-end' });
}
