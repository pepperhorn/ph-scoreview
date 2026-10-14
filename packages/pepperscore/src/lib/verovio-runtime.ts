import type { SourceDocument } from './notation/document';
import { bundledVerovioFiles } from '../runtime-files';
import type { BaselineInfo, PagesResult, ProbeResult, VerovioConfigure, VerovioFiles, VerovioReply, VerovioRequest, ViewSpec } from './verovio-protocol';

/** A worker failure; `code` says why (see VerovioReply). */
export class VerovioError extends Error {
  constructor(message: string, readonly code?: VerovioReply['code']) { super(message); }
}
export const isSuperseded = (error: unknown) => error instanceof VerovioError && error.code === 'superseded';
/** Verovio ran out of WASM memory (its heap is capped at 2 GiB); `reduceChunkSize` then a retry may succeed. */
export const isOutOfMemory = (error: unknown) => error instanceof VerovioError && error.code === 'oom';
/** The worker was recycled under a request (another reader's out-of-memory failure, a heap recycle); retried once. */
export const isRestarted = (error: unknown) => error instanceof VerovioError && error.code === 'restarted';
const restarted = () => new VerovioError('Verovio restarted.', 'restarted');

/**
 * Engraving chunk budget, in staff-measures per chunk (see docs/specs/large-score-performance.md, Phase 3). Long
 * scores are engraved chunk by chunk; an out-of-memory retry halves the budget and engraves every score in chunks.
 */
export const DEFAULT_CHUNK_STAFF_MEASURES = 640;
const MIN_CHUNK_STAFF_MEASURES = 40;
let chunkBudget = DEFAULT_CHUNK_STAFF_MEASURES;
let forceChunks = false;
/** A heap above this (the cap is 2 GiB) is returned when the worker is idle and the score re-imports cheaply. */
let recycleHeapBytes = 1024 * 2 ** 20;
// Diagnostics and tests: localStorage `scoreflow-chunking` = {"force": true, "budget": 16} engraves every MusicXML
// score in chunks of that size (validation/chunks.mjs compares chunked and whole engravings); `recycleHeapBytes`
// lowers the idle-recycle threshold. A diagnostic hook: un-namespaced and exempt from `persist` (storage.ts).
// Browser only: Node 25 has a global localStorage whose access prints a warning on an SSR server.
if (typeof window !== 'undefined') try {
  const setting = JSON.parse(window.localStorage?.getItem('scoreflow-chunking') || 'null') as { force?: boolean; budget?: number; recycleHeapBytes?: number } | null;
  if (setting?.force) forceChunks = true;
  if (Number(setting?.budget) > 0) chunkBudget = Number(setting!.budget);
  if (Number(setting?.recycleHeapBytes) > 0) recycleHeapBytes = Number(setting!.recycleHeapBytes);
} catch { /* no storage */ }
export const chunkSettings = () => ({ budget: chunkBudget, force: forceChunks });
/**
 * After an out-of-memory failure: engrave in chunks half the size (every score, even one below the chunking
 * threshold) on a fresh worker. The caller then opens or draws the score again. Returns the new budget.
 */
export function reduceChunkSize(): number {
  chunkBudget = Math.max(MIN_CHUNK_STAFF_MEASURES, Math.floor(chunkBudget / 2));
  forceChunks = true;
  stopWorker(restarted());
  return chunkBudget;
}
/**
 * Test hook: `localStorage['scoreflow-simulate-oom']` = N (a positive integer; any other value counts as 1) makes the
 * next probe or render fail as out of memory, and the next N - 1 probes or renders of the same channel too, the way a
 * score too large for the device keeps failing in its own reader (other readers are unaffected). A diagnostic hook:
 * un-namespaced and exempt from `persist` (storage.ts).
 */
let simulatedOom: { channel: number; left: number } | undefined;
function takeSimulatedOom(channel: number): boolean {
  try {
    const armed = globalThis.localStorage?.getItem('scoreflow-simulate-oom');
    if (armed) {
      globalThis.localStorage.removeItem('scoreflow-simulate-oom');
      const count = Number(armed);
      simulatedOom = { channel, left: Number.isInteger(count) && count > 0 ? count : 1 };
    }
  } catch { /* no storage */ }
  if (!simulatedOom || simulatedOom.channel !== channel || simulatedOom.left <= 0) return false;
  simulatedOom.left--;
  return true;
}

/** `channel`: the reader a probe or render belongs to (imports are shared by every reader showing the score). */
type Pending = { kind: VerovioRequest['kind']; channel?: number; resolve: (value: any) => void; reject: (reason: Error) => void };
let worker: Worker | undefined;
let nextId = 0;
const pending = new Map<number, Pending>();

/** The host's Verovio (`verovioBaseUrl`); unset, the worker loads the copy shipped with pepperscore. */
let hostVerovio: VerovioFiles | undefined;

/** The Verovio files under a directory laid out like the verovio npm package's dist/; a relative URL resolves against the page. */
export function verovioFilesAt(base: string, page: string = (typeof document !== 'undefined' && document.baseURI) || 'http://localhost/'): VerovioFiles {
  const dir = new URL(base.endsWith('/') ? base : `${base}/`, page);
  return { module: new URL('verovio-module.mjs', dir).href, toolkit: new URL('verovio.mjs', dir).href };
}

/**
 * Load Verovio from `base` (see PepperScoreProps.verovioBaseUrl) instead of the shipped copy. Every reader on the page
 * shares one worker, so this applies to all of them, from the next time the worker starts (the first engraving, or
 * a restart); a blank `base` changes nothing.
 */
export function setVerovioBaseUrl(base: string | undefined): void {
  if (base?.trim()) hostVerovio = verovioFilesAt(base.trim());
}

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./verovio.worker.ts', import.meta.url), { type: 'module' });
  worker.postMessage({ kind: 'configure', files: hostVerovio ?? bundledVerovioFiles() } satisfies VerovioConfigure);
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
    // Out of memory leaves a heap near the 2 GiB cap that the worker cannot give back: start a fresh worker. A large
    // heap is returned once the worker is idle, but only for a chunked score, which re-imports in one index pass, and
    // never right after an import (the render that needs it follows): a whole-document score would be imported again
    // and recycled again, over and over. Its heap is returned before the next score's import instead.
    // Other readers' requests still in flight fail as `restarted` and are sent again to the fresh worker; the failing
    // reader's own requests fail as out of memory (the same layout would only run out of memory again).
    const idle = !pending.size && item.kind !== 'import' && importsInFlight === 0 && currentChunked;
    if (data.code === 'oom') stopWorker(restarted(), item.channel);
    else if (heap > recycleHeapBytes && idle) stopWorker(restarted());
  };
  worker.onerror = event => {
    event.preventDefault();
    stopWorker(new VerovioError(event.message || 'Verovio worker failed.'));
  };
  return worker;
}

/**
 * Terminate the worker (it holds the WASM heap, which never shrinks) and fail whatever it still owed with `reason`,
 * except the probes and renders of `outOfMemory` (the channel that ran out of memory), which fail as out of memory.
 */
function stopWorker(reason: Error, outOfMemory?: number): void {
  worker?.terminate();
  worker = undefined;
  heap = 0;
  baselines.clear();
  for (const item of pending.values()) {
    item.reject(outOfMemory !== undefined && item.channel === outOfMemory ? new VerovioError('This score is too large for the notation renderer on this device (it ran out of memory).', 'oom') : reason);
  }
  pending.clear();
}

type Body = VerovioRequest extends infer R ? R extends unknown ? Omit<R, 'id'> : never : never;
function request<T>(body: Body, transfer: Transferable[] = []): Promise<T> {
  const id = ++nextId;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { kind: body.kind, channel: 'channel' in body ? body.channel : undefined, resolve, reject });
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

/** Baselines the worker holds (the runtime releases those no channel uses, see releaseUnused). */
const baselines = new Map<number, Promise<BaselineInfo>>();
/** Baselines kept even when no channel uses them (a reader switching back to its previous score reuses one). */
const BASELINE_LIMIT = 2;
/** Whether the most recent import is engraved in chunks (cheap to re-import after the worker is recycled). */
let currentChunked = false;
/** The worker's WASM heap after its latest reply (bytes). */
let heap = 0;
/** A heap above this is not reused well by a different score: the worker is recycled before the next import. */
const RECYCLE_BEFORE_IMPORT_BYTES = 384 * 2 ** 20;
/** Imports in flight on any channel (a worker is never recycled as idle while one runs). */
let importsInFlight = 0;

/** One channel per reader instance: its own render tickets, current/previous revisions and import in flight. */
type Channel = { current: number; previous: number; importing?: number };
const channels = new Map<number, Channel>();
let nextChannel = 0;
/**
 * Opened channels only exist from openVerovioChannel until closeVerovioChannel; a closed (or never opened) channel is
 * never brought back by a late request: its requests fail as `superseded`. Channel 0 always exists.
 */
const channelState = (id: number): Channel | undefined => {
  let state = channels.get(id);
  if (!state && id === 0) { state = { current: 0, previous: 0 }; channels.set(id, state); }
  return state;
};
const closed = () => new VerovioError('Superseded score render (the reader closed).', 'superseded');
const publishChannels = () => { (globalThis as { __pepperscoreVerovioChannels?: number }).__pepperscoreVerovioChannels = [...channels.keys()].filter(id => id !== 0).length; };
/** A reader mounted: a channel of its own, so its imports and renders never supersede another reader's. */
export function openVerovioChannel(): number {
  const id = ++nextChannel;
  channels.set(id, { current: 0, previous: 0 });
  // Exposed for diagnostics and validation/embed.mjs: the number of open reader channels.
  publishChannels();
  return id;
}
/**
 * A reader unmounted: forget what only it used; the worker (and its WASM heap) goes when the last opened channel
 * closes. Channel 0, the default for direct callers of render.ts, is never opened and does not keep the worker.
 */
export function closeVerovioChannel(id: number): void {
  channels.delete(id);
  publishChannels();
  if (![...channels.keys()].some(open => open !== 0)) { stopWorker(new VerovioError('Verovio renderer disposed.')); return; }
  releaseUnused();
}
const inUse = (revision: number) => [...channels.values()].some(state => state.current === revision || state.previous === revision || state.importing === revision);
/** Keep at least BASELINE_LIMIT baselines; beyond that drop (and release in the worker) the oldest no channel uses. */
function releaseUnused(): void {
  for (const revision of [...baselines.keys()]) {
    if (baselines.size <= BASELINE_LIMIT) return;
    if (inUse(revision)) continue;
    baselines.delete(revision);
    if (worker) request({ kind: 'release', revision }).catch(() => {});
  }
}
/** A channel shows `revision` now; the one it showed before stays its previous (still on screen while a new score imports). */
const adopt = (state: Channel, revision: number) => { if (state.current !== revision) { state.previous = state.current; state.current = revision; } };

/**
 * Import a source once per revision and return its structure. The worker keeps Verovio's MEI baseline; the main
 * thread never receives it. A rejected import is forgotten so a retry imports again. Readers showing the same
 * document share its baseline.
 */
export function prepareVerovio(document: SourceDocument, channel = 0): Promise<BaselineInfo> {
  const revision = verovioRevision(document);
  const state = channelState(channel);
  if (!state) return Promise.reject(closed());
  let cached = baselines.get(revision);
  if (cached) {
    baselines.delete(revision); baselines.set(revision, cached);
    return cached.then(info => { adopt(state, revision); return info; });
  }
  // A large previous heap is not reused well by a different score; start from a fresh module instead.
  if (heap > RECYCLE_BEFORE_IMPORT_BYTES && worker) stopWorker(restarted());
  // The engraving goes as a copy of its UTF-8 bytes (transferred), never as a string decoded on the main thread; the
  // document keeps its own bytes, so a restart under the import (another reader's failure) sends them again.
  const send = () => {
    const bytes = document.engravingBytes().slice();
    return request<BaselineInfo>({ kind: 'import', revision, bytes: bytes.buffer, chunking: { force: forceChunks } }, [bytes.buffer]);
  };
  const attempt: Promise<BaselineInfo> = send().catch(error => {
    if (!isRestarted(error)) throw error;
    // The restart cleared the cache: this import is still the one other renders of the revision wait for.
    if (!baselines.has(revision)) baselines.set(revision, attempt);
    return send();
  });
  cached = attempt;
  baselines.set(revision, cached);
  state.importing = revision;
  importsInFlight++;
  const settled = () => { importsInFlight--; if (state.importing === revision) state.importing = undefined; };
  cached.then(info => { adopt(state, revision); currentChunked = !!info.chunked; settled(); releaseUnused(); },
    () => { settled(); if (baselines.get(revision) === cached) baselines.delete(revision); });
  return cached;
}

/**
 * The baseline for a render. A render never starts importing while its own reader imports another score: that render
 * belongs to the score being replaced (and importing it again could recycle the worker under the new import).
 */
export function verovioBaseline(document: SourceDocument, channel = 0): Promise<BaselineInfo> {
  const revision = verovioRevision(document);
  const state = channelState(channel);
  if (!state) return Promise.reject(closed());
  const { importing } = state;
  if (!baselines.has(revision) && importing !== undefined && importing !== revision) return Promise.reject(new VerovioError('Superseded score render.', 'superseded'));
  return prepareVerovio(document, channel);
}

let ticket = 0;
/** A new render generation: the worker answers older queued probes and renders on the same channel `superseded`. */
export const nextRenderTicket = () => ++ticket;

async function withBaseline<T>(document: SourceDocument, channel: number, run: (revision: number) => Promise<T>): Promise<T> {
  const revision = verovioRevision(document);
  await verovioBaseline(document, channel);
  try { return await run(revision); }
  catch (error) {
    // The worker restarted under the request, or dropped this revision while it is still the channel's score:
    // import it again, once.
    const missing = error instanceof VerovioError && error.code === 'missing' && revision === channelState(channel)?.current;
    if (!isRestarted(error) && !missing) throw error;
    // After a restart the cache is already empty (and may hold another reader's fresh re-import of this revision).
    if (missing) baselines.delete(revision);
    await verovioBaseline(document, channel);
    return run(revision);
  }
}

/** Lay out the first `measures` measures as a small document and return page 1 (the first system). */
export function probeVerovio(document: SourceDocument, channel: number, renderTicket: number, view: ViewSpec, options: Record<string, unknown>, measures: number): Promise<ProbeResult> {
  return withBaseline(document, channel, revision => request<ProbeResult>({ kind: 'probe', channel, ticket: renderTicket, revision, view, options, measures, chunkBudget, simulateOom: takeSimulatedOom(channel) || undefined }));
}

/** Serialize one-based pages of the whole view laid out with `options`; the worker reuses its loaded document when it can. */
export function renderVerovioPages(document: SourceDocument, channel: number, renderTicket: number, view: ViewSpec, options: Record<string, unknown>, pages: number[]): Promise<PagesResult> {
  return withBaseline(document, channel, revision => request<PagesResult>({ kind: 'render', channel, ticket: renderTicket, revision, view, options, pages, chunkBudget, simulateOom: takeSimulatedOom(channel) || undefined }));
}
