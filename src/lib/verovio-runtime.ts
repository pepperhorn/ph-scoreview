import type { SourceDocument } from './notation/document';
import type { BaselineInfo, PagesResult, ProbeResult, VerovioReply, VerovioRequest, ViewSpec } from './verovio-protocol';

/** A worker failure; `code` says why (see VerovioReply). */
export class VerovioError extends Error {
  constructor(message: string, readonly code?: VerovioReply['code']) { super(message); }
}
export const isSuperseded = (error: unknown) => error instanceof VerovioError && error.code === 'superseded';

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
    if (data.error !== undefined) item.reject(new VerovioError(data.error, data.code));
    else item.resolve(data.value);
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
  baselines.clear();
  for (const item of pending.values()) item.reject(reason);
  pending.clear();
}

type Body = VerovioRequest extends infer R ? R extends unknown ? Omit<R, 'id'> : never : never;
function request<T>(body: Body): Promise<T> {
  const id = ++nextId;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ ...body, id });
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
/** Sources above this many characters leave a large WASM heap behind; the worker is recycled before the next import. */
const RECYCLE_AFTER_CHARS = 4_000_000;
let heavy = false;

/**
 * Import a source once per revision and return its structure. The worker keeps Verovio's MEI baseline; the main
 * thread never receives it. A rejected import is forgotten so a retry imports again.
 */
export function prepareVerovio(document: SourceDocument): Promise<BaselineInfo> {
  const revision = verovioRevision(document);
  let cached = baselines.get(revision);
  if (cached) { baselines.delete(revision); baselines.set(revision, cached); return cached; }
  // The previous score's heap is not reused well by a different one; start from a fresh module instead.
  if (heavy && worker) stopWorker(new VerovioError('Superseded score render.', 'superseded'));
  heavy = document.engravingText.length > RECYCLE_AFTER_CHARS;
  cached = request<BaselineInfo>({ kind: 'import', revision, text: document.engravingText });
  baselines.set(revision, cached);
  while (baselines.size > BASELINE_LIMIT) baselines.delete(baselines.keys().next().value!);
  cached.then(() => { current = revision; }, () => { if (baselines.get(revision) === cached) baselines.delete(revision); });
  return cached;
}

let ticket = 0;
/** A new render generation: the worker answers older queued probes and renders `superseded`. */
export const nextRenderTicket = () => ++ticket;

async function withBaseline<T>(document: SourceDocument, run: (revision: number) => Promise<T>): Promise<T> {
  const revision = verovioRevision(document);
  await prepareVerovio(document);
  try { return await run(revision); }
  catch (error) {
    // The worker restarted or dropped this revision: import it again, once, if it is still the current score.
    if (!(error instanceof VerovioError) || error.code !== 'missing' || revision !== current) throw error;
    baselines.delete(revision);
    await prepareVerovio(document);
    return run(revision);
  }
}

/** Lay out the first `measures` measures as a small document and return page 1 (the first system). */
export function probeVerovio(document: SourceDocument, renderTicket: number, view: ViewSpec, options: Record<string, unknown>, measures: number): Promise<ProbeResult> {
  return withBaseline(document, revision => request<ProbeResult>({ kind: 'probe', ticket: renderTicket, revision, view, options, measures }));
}

/** Serialize one-based pages of the whole view laid out with `options`; the worker reuses its loaded document when it can. */
export function renderVerovioPages(document: SourceDocument, renderTicket: number, view: ViewSpec, options: Record<string, unknown>, pages: number[]): Promise<PagesResult> {
  return withBaseline(document, revision => request<PagesResult>({ kind: 'render', ticket: renderTicket, revision, view, options, pages }));
}

export function disposeVerovio(): void {
  stopWorker(new VerovioError('Verovio renderer disposed.'));
  heavy = false;
}
