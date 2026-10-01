import createVerovioModule from 'verovio/wasm';
import { VerovioToolkit, enableLogToBuffer } from 'verovio/esm';
import { buildViewMei, scanBaseline, type BaselineInfo, type ViewSpec } from './notation/mei-view';
import type { VerovioReply, VerovioRequest } from './verovio-protocol';

/**
 * One persistent Verovio document per score view (see docs/specs/large-score-performance.md).
 *
 * - `import` converts a source once and keeps Verovio's MEI baseline here; the main thread only receives its
 *   structure (`BaselineInfo`), never the MEI.
 * - `render` builds the view MEI from the baseline (breaks, hidden staves, chord symbols), loads it only when the
 *   view or a load-time option (transposition) changed, re-lays it out with `redoLayout` when only layout options
 *   changed, and serializes just the requested pages.
 * - `probe` lays out a small document of the first measures in a second toolkit: the first system, its height for
 *   the many-staff height fit, and the Auto-bars wrap check, without laying out the whole score.
 *
 * Requests are serialized. Between requests the loop yields, so a newer render ticket arrives before older
 * queued renders run, and those are answered `superseded` instead of laying out a stale view.
 */

/** Options Verovio applies while loading data, so a change needs a reload rather than `redoLayout`. */
const LOAD_OPTIONS = ['breaks', 'transpose', 'transposeToSoundingPitch', 'xmlIdChecksum'];
/** Baselines kept for re-rendering: the current score and the previous one (still on screen while a new one imports). */
const BASELINE_LIMIT = 2;

type Toolkit = InstanceType<typeof VerovioToolkit>;
let modulePromise: Promise<unknown> | undefined;
// Verovio logs every import and layout warning to the console; a large score logs tens of thousands, which costs
// real time in the worker. Logs are buffered instead and summarized once per request (see drainLog).
const moduleReady = () => modulePromise ??= createVerovioModule().then(module => { enableLogToBuffer(1, module); return module; });
let main: Toolkit | undefined;
let probe: Toolkit | undefined;
/** What the main toolkit holds: the loaded view and the options it was last laid out with. */
let loaded: { loadKey: string; optionsKey: string } | undefined;
const baselines = new Map<number, { mei: string; info: BaselineInfo }>();

class RequestError extends Error {
  constructor(message: string, readonly code: VerovioReply['code']) { super(message); }
}

function discardToolkits(resetModule: boolean): void {
  for (const toolkit of [main, probe]) { try { toolkit?.destroy(); } catch { /* already unusable */ } }
  main = probe = undefined;
  loaded = undefined;
  if (resetModule) modulePromise = undefined;
}

async function toolkit(which: 'main' | 'probe'): Promise<Toolkit> {
  const module = await moduleReady();
  if (which === 'main') return main ??= new VerovioToolkit(module);
  return probe ??= new VerovioToolkit(module);
}

function baseline(revision: number): { mei: string; info: BaselineInfo } {
  const entry = baselines.get(revision);
  if (!entry) throw new RequestError('The score is no longer loaded in the renderer.', 'missing');
  baselines.delete(revision); baselines.set(revision, entry);
  return entry;
}

function load(target: Toolkit, data: string, options: Record<string, unknown>): void {
  target.resetOptions();
  // Stable generated IDs come from xmlIdChecksum; resetXmlIdSeed(0) would mean a random seed.
  target.setOptions(options);
  if (!target.loadData(data)) throw new Error('Verovio could not import this score.');
}

const pick = (options: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.map(key => [key, options[key] ?? null]));

/** Make the main toolkit hold `view` of `revision` laid out with `options`, reloading only when it must. */
async function ensureLayout(revision: number, view: ViewSpec, options: Record<string, unknown>): Promise<Toolkit> {
  const loadKey = JSON.stringify([revision, view, pick(options, LOAD_OPTIONS)]);
  const optionsKey = JSON.stringify(options);
  const target = await toolkit('main');
  if (loaded?.loadKey !== loadKey) {
    const { mei } = baseline(revision);
    loaded = undefined;
    load(target, buildViewMei(mei, view), options);
    loaded = { loadKey, optionsKey };
  } else if (loaded.optionsKey !== optionsKey) {
    // Same document, new layout options (width, scale, font, staff spacing): re-lay out without re-importing.
    loaded = undefined;
    target.resetOptions();
    target.setOptions(options);
    target.redoLayout();
    loaded = { loadKey, optionsKey };
  }
  return target;
}

/**
 * Measures in the first-system document: two systems' worth, extended (up to `cap` systems) so spans starting in the
 * first system (slurs, ties, hairpins, beam spans) end inside it and are drawn as they are in the whole score.
 */
function probeLimit(mei: string, measures: number, total: number): number {
  return Math.min(total, Math.max(measures * 2, spanEnd(mei, measures, measures * 4) + 1));
}
const SPAN = /\s(?:endid|tstamp2)\s*=\s*"([^"]*)"/g;
const ID = /\sxml:id\s*=\s*"([^"]*)"/;
const MEASURE = /<measure\b/g;
/** Last measure index (0-based, at most `cap - 1`) a span from the first `measures` measures reaches. */
function spanEnd(mei: string, measures: number, cap: number): number {
  // Start offsets of the first cap + 1 measures; measure k's text runs to the next measure's start.
  const starts: number[] = [];
  MEASURE.lastIndex = 0;
  for (let match = MEASURE.exec(mei); match && starts.length <= cap; match = MEASURE.exec(mei)) starts.push(match.index);
  const pending = new Set<string>();
  let farthest = 0;
  for (let index = 0; index + 1 < starts.length; index++) {
    const text = mei.slice(starts[index], starts[index + 1]);
    if (index < measures) {
      for (const [, value] of text.matchAll(SPAN)) {
        const offset = /^(\d+)m\+/.exec(value);
        if (offset) farthest = Math.max(farthest, index + Number(offset[1]));
        else pending.add(value.replace(/^#/, ''));
      }
    } else if (pending.size) {
      for (const tag of text.match(/<[^>]*\sxml:id\s*=\s*"[^"]*"[^>]*>/g) || []) {
        const id = ID.exec(tag)?.[1];
        if (id && pending.delete(id)) farthest = Math.max(farthest, index);
      }
    }
    if (index >= measures && !pending.size) break;
  }
  return Math.min(cap - 1, farthest);
}

async function handle(request: VerovioRequest): Promise<unknown> {
  if (request.kind === 'import') {
    const target = await toolkit('main');
    loaded = undefined;
    load(target, new TextDecoder().decode(request.bytes), { breaks: 'none', inputFrom: 'auto', xmlIdChecksum: true });
    const mei = target.getMEI();
    const info = scanBaseline(mei);
    baselines.delete(request.revision);
    baselines.set(request.revision, { mei, info });
    while (baselines.size > BASELINE_LIMIT) baselines.delete(baselines.keys().next().value!);
    return info;
  }
  if (request.kind === 'release') { baselines.delete(request.revision); return null; }
  if (request.kind === 'probe') {
    const { mei, info } = baseline(request.revision);
    const limit = request.measures >= info.measureIds.length ? info.measureIds.length : probeLimit(mei, request.measures, info.measureIds.length);
    const target = await toolkit('probe');
    load(target, buildViewMei(mei, request.view, limit), request.options);
    const svg = target.renderToSVG(1);
    return { svg, pageCount: target.getPageCount(), measures: limit };
  }
  const target = await ensureLayout(request.revision, request.view, request.options);
  const count = target.getPageCount();
  const pages = request.pages.filter(page => page >= 1 && page <= count).map(page => ({ page, svg: target.renderToSVG(page) }));
  return { pageCount: count, pages };
}

/** WASM out-of-memory surfaces as an abort, a RangeError or a WebAssembly.Exception; name it so the reader can say so. */
function failure(error: unknown): { message: string; code?: VerovioReply['code'] } {
  if (error instanceof RequestError) return { message: error.message, code: error.code };
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const exception = (globalThis as { WebAssembly?: { Exception?: new (...args: never[]) => unknown } }).WebAssembly?.Exception;
  if ((exception && error instanceof exception) || /out of memory|OOM|Cannot enlarge memory|allocation failed|RangeError/i.test(text)) {
    return { message: 'This score is too large for the notation renderer on this device (it ran out of memory).', code: 'oom' };
  }
  return { message: error instanceof Error ? error.message : String(error) };
}

/** Report a request's buffered Verovio log as one console message: the count and the first lines. */
function drainLog(kind: VerovioRequest['kind']): void {
  let text = '';
  try { text = (main ?? probe)?.getLog() || ''; } catch { return; }
  if (!text) return;
  const lines = text.split('\n').filter(Boolean);
  const errors = lines.filter(line => line.startsWith('[Error]')).length;
  console.warn(`Verovio ${kind}: ${lines.length} log message${lines.length === 1 ? '' : 's'} (${errors} error${errors === 1 ? '' : 's'})${lines.length > 12 ? ', first 12' : ''}:\n${lines.slice(0, 12).join('\n')}`);
}

const queue: VerovioRequest[] = [];
let latestTicket = 0;
let running = false;
const reply = (message: VerovioReply) => self.postMessage(message);

async function step(): Promise<void> {
  const request = queue.shift();
  if (!request) { running = false; return; }
  if (request.kind !== 'import' && request.kind !== 'release' && request.ticket < latestTicket) {
    reply({ id: request.id, error: 'Superseded score render.', code: 'superseded' });
  } else {
    try { const value = await handle(request); drainLog(request.kind); reply({ id: request.id, value }); }
    catch (error) {
      drainLog(request.kind);
      const { message, code } = failure(error);
      // A failed Verovio call can leave the toolkit (or, after an abort, the module) unusable: start clean next time.
      if (code !== 'missing') discardToolkits(code === 'oom' || !(error instanceof Error && error.message === 'Verovio could not import this score.'));
      reply({ id: request.id, error: message, code });
    }
  }
  // Yield so newer requests (and their tickets) arrive before the next queued one runs.
  setTimeout(() => void step(), 0);
}

self.onmessage = (event: MessageEvent<VerovioRequest>) => {
  const request = event.data;
  if (request.kind === 'probe' || request.kind === 'render') latestTicket = Math.max(latestTicket, request.ticket);
  queue.push(request);
  if (!running) { running = true; setTimeout(() => void step(), 0); }
};
