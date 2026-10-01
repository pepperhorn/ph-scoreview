import type { SourceDocument } from './notation/document';
import type { BaselineInfo, PagesResult, ProbeResult, VerovioReply, VerovioRequest, ViewSpec } from './verovio-protocol';

/** A worker failure; `code` says why (see VerovioReply). */
export class VerovioError extends Error {
  constructor(message: string, readonly code?: VerovioReply['code']) { super(message); }
}
export const isSuperseded = (error: unknown) => error instanceof VerovioError && error.code === 'superseded';
/** Verovio ran out of WASM memory (its heap is capped at 2 GiB); `reduceChunkSize` then a retry may succeed. */
export const isOutOfMemory = (error: unknown) => error instanceof VerovioError && error.code === 'oom';

/**
 * Engraving chunk budget, in staff-measures per chunk (see docs/specs/large-score-performance.md, Phase 3). Long
 * scores are engraved chunk by chunk; an out-of-memory retry halves the budget and engraves every score in chunks.
 */
export const DEFAULT_CHUNK_STAFF_MEASURES = 640;
const MIN_CHUNK_STAFF_MEASURES = 40;
let chunkBudget = DEFAULT_CHUNK_STAFF_MEASURES;
let forceChunks = false;
// Diagnostics and tests: localStorage `scoreflow-chunking` = {"force": true, "budget": 16} engraves every MusicXML
// score in chunks of that size (validation/chunks.mjs compares chunked and whole engravings).
try {
  const setting = JSON.parse(globalThis.localStorage?.getItem('scoreflow-chunking') || 'null') as { force?: boolean; budget?: number } | null;
  if (setting?.force) forceChunks = true;
  if (Number(setting?.budget) > 0) chunkBudget = Number(setting!.budget);
} catch { /* no storage */ }
export const chunkSettings = () => ({ budget: chunkBudget, force: forceChunks });
/**
 * After an out-of-memory failure: engrave in chunks half the size (every score, even one below the chunking
 * threshold) on a fresh worker. The caller then opens or draws the score again. Returns the new budget.
 */
export function reduceChunkSize(): number {
  chunkBudget = Math.max(MIN_CHUNK_STAFF_MEASURES, Math.floor(chunkBudget / 2));
  forceChunks = true;
  stopWorker(new VerovioError('Superseded score render.', 'superseded'));
  return chunkBudget;
}
/** Test hook: `localStorage['scoreflow-simulate-oom']` makes the next probe or render fail as out of memory, once. */
function takeSimulatedOom(): boolean {
  try {
    if (!globalThis.localStorage?.getItem('scoreflow-simulate-oom')) return false;
    globalThis.localStorage.removeItem('scoreflow-simulate-oom');
    return true;
  } catch { return false; }
}

type Pending = { resolve: (value: any) => void; reject: (reason: Error) => void };
let worker: Worker | undefined;
let nextId = 0;
const pending = new Map<number, Pending>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./verovio.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }: MessageEvent<VerovioReply>) => {
    const item = pending.get(data.id);
    if (!item) return;
    pending.delete(data.id);
    if (data.heap !== undefined) {
      heap = data.heap;
      // Exposed for diagnostics and the large-score validation (the WASM heap is not visible to the page otherwise).
      (globalThis as { __scoreflowVerovioHeapPeak?: number }).__scoreflowVerovioHeapPeak = Math.max(heap, (globalThis as { __scoreflowVerovioHeapPeak?: number }).__scoreflowVerovioHeapPeak || 0);
    }
    if (data.error !== undefined) item.reject(new VerovioError(data.error, data.code));
    else item.resolve(data.value);
    // Out of memory leaves a heap near the 2 GiB cap that the worker cannot give back; a large heap is returned once
    // the worker is idle. Either way the next request starts a fresh worker and re-imports the score it needs.
    if (data.code === 'oom' || (heap > RECYCLE_HEAP_BYTES && !pending.size)) stopWorker(new VerovioError('Superseded score render.', 'superseded'));
  };
  worker.onerror = event => {
    event.preventDefault();
    stopWorker(new VerovioError(event.message || 'Verovio worker failed.'));
  };
  return worker;
}

/** Terminate the worker (it holds the WASM heap, which never shrinks) and fail whatever it still owed. */
function stopWorker(reason: Error): void {
  worker?.terminate();
  worker = undefined;
  heap = 0;
  baselines.clear();
  for (const item of pending.values()) item.reject(reason);
  pending.clear();
}

type Body = VerovioRequest extends infer R ? R extends unknown ? Omit<R, 'id'> : never : never;
function request<T>(body: Body, transfer: Transferable[] = []): Promise<T> {
  const id = ++nextId;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ ...body, id }, transfer);
  });
}

/** Revisions identify a source document (the engraving text), shared by every Score copy made from it. */
const revisions = new WeakMap<object, number>();
let nextRevision = 0;
export function verovioRevision(document: SourceDocument): number {
  let revision = revisions.get(document);
  if (!revision) { revision = ++nextRevision; revisions.set(document, revision); }
  return revision;
}

/** Baselines the worker holds (it keeps the same two most recent). */
const baselines = new Map<number, Promise<BaselineInfo>>();
const BASELINE_LIMIT = 2;
/** The revision most recently imported successfully: the one a missing baseline is re-imported for. */
let current = 0;
/** The worker's WASM heap after its latest reply (bytes). */
let heap = 0;
/** A heap above this is not reused well by a different score: the worker is recycled before the next import. */
const RECYCLE_BEFORE_IMPORT_BYTES = 384 * 2 ** 20;
/** A heap above this (the cap is 2 GiB) is returned as soon as the worker is idle. */
const RECYCLE_HEAP_BYTES = 1024 * 2 ** 20;
/** The revision whose import is in flight, if any. */
let importing: number | undefined;

/**
 * Import a source once per revision and return its structure. The worker keeps Verovio's MEI baseline; the main
 * thread never receives it. A rejected import is forgotten so a retry imports again.
 */
export function prepareVerovio(document: SourceDocument): Promise<BaselineInfo> {
  const revision = verovioRevision(document);
  let cached = baselines.get(revision);
  if (cached) { baselines.delete(revision); baselines.set(revision, cached); return cached; }
  // A large previous heap is not reused well by a different score; start from a fresh module instead.
  if (heap > RECYCLE_BEFORE_IMPORT_BYTES && worker) stopWorker(new VerovioError('Superseded score render.', 'superseded'));
  // The engraving goes as a copy of its UTF-8 bytes (transferred), never as a string decoded on the main thread; the
  // document keeps its own bytes for a re-import after the worker is recycled.
  const bytes = document.engravingBytes().slice();
  cached = request<BaselineInfo>({ kind: 'import', revision, bytes: bytes.buffer, chunking: { force: forceChunks } }, [bytes.buffer]);
  baselines.set(revision, cached);
  while (baselines.size > BASELINE_LIMIT) baselines.delete(baselines.keys().next().value!);
  importing = revision;
  const settled = () => { if (importing === revision) importing = undefined; };
  cached.then(() => { current = revision; settled(); }, () => { settled(); if (baselines.get(revision) === cached) baselines.delete(revision); });
  return cached;
}

/**
 * The baseline for a render. A render never starts importing while another score imports: that render belongs to
 * the score being replaced (and importing it again could recycle the worker under the new import).
 */
export function verovioBaseline(document: SourceDocument): Promise<BaselineInfo> {
  const revision = verovioRevision(document);
  if (!baselines.has(revision) && importing !== undefined && importing !== revision) return Promise.reject(new VerovioError('Superseded score render.', 'superseded'));
  return prepareVerovio(document);
}

let ticket = 0;
/** A new render generation: the worker answers older queued probes and renders `superseded`. */
export const nextRenderTicket = () => ++ticket;

async function withBaseline<T>(document: SourceDocument, run: (revision: number) => Promise<T>): Promise<T> {
  const revision = verovioRevision(document);
  await verovioBaseline(document);
  try { return await run(revision); }
  catch (error) {
    // The worker restarted or dropped this revision: import it again, once, if it is still the current score.
    if (!(error instanceof VerovioError) || error.code !== 'missing' || revision !== current) throw error;
    baselines.delete(revision);
    await verovioBaseline(document);
    return run(revision);
  }
}

/** Lay out the first `measures` measures as a small document and return page 1 (the first system). */
export function probeVerovio(document: SourceDocument, renderTicket: number, view: ViewSpec, options: Record<string, unknown>, measures: number): Promise<ProbeResult> {
  return withBaseline(document, revision => request<ProbeResult>({ kind: 'probe', ticket: renderTicket, revision, view, options, measures, chunkBudget, simulateOom: takeSimulatedOom() || undefined }));
}

/** Serialize one-based pages of the whole view laid out with `options`; the worker reuses its loaded document when it can. */
export function renderVerovioPages(document: SourceDocument, renderTicket: number, view: ViewSpec, options: Record<string, unknown>, pages: number[]): Promise<PagesResult> {
  return withBaseline(document, revision => request<PagesResult>({ kind: 'render', ticket: renderTicket, revision, view, options, pages, chunkBudget, simulateOom: takeSimulatedOom() || undefined }));
}

export function disposeVerovio(): void {
  stopWorker(new VerovioError('Verovio renderer disposed.'));
}
