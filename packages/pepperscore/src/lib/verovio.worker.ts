import { substituteFingerLabels } from './tab/strings/svg';
import type createVerovioModule from 'verovio/wasm';
import type { VerovioToolkit, enableLogToBuffer } from 'verovio/esm';
import { buildViewMei, scanBaseline, type BaselineInfo, type ViewSpec } from './notation/mei-view';
import { spellBaseline, spellingNeeded, type SpellingSpec } from './notation/mei-spelling';
import { injectTab, type FretMemory } from './notation/mei-tab';
import { indexMusicXml, measureId, planChunk, sliceMusicXml, tailFor, type ChunkIndex, type ChunkPlan } from './notation/musicxml-chunks';
import type { VerovioConfigure, VerovioFiles, VerovioReply, VerovioRequest } from './verovio-protocol';

/**
 * One persistent Verovio document per score view (see docs/specs/large-score-performance.md).
 *
 * - `import` converts a source once and keeps Verovio's MEI baseline here; the main thread only receives its
 *   structure (`BaselineInfo`), never the MEI. A long MusicXML score is not converted whole (Verovio's import grows
 *   super-linearly with its length and its heap is capped at 2 GiB): the worker indexes the text and engraves it in
 *   chunks, each a small document of a few systems cut from the source (`notation/musicxml-chunks.ts`).
 * - `render` builds the view MEI (breaks, hidden staves, chord symbols) of the whole baseline, or of the chunk that
 *   holds the requested systems, loads it only when the view, chunk or a load-time option (transposition) changed,
 *   re-lays it out with `redoLayout` when only layout options changed, and serializes just the requested pages.
 * - `probe` lays out a small document of the first measures in a second toolkit: the first system, its height for
 *   the many-staff height fit, and the Auto-bars wrap check, without laying out the whole score.
 *
 * Requests are serialized. Between requests the loop yields, so a newer render ticket arrives before older
 * queued renders run, and those are answered `superseded` instead of laying out a stale view. Tickets are compared
 * per channel (one per reader instance), so one reader never supersedes another's renders.
 */

/** Options Verovio applies while loading data, so a change needs a reload rather than `redoLayout`. */
const LOAD_OPTIONS = ['breaks', 'transpose', 'transposeToSoundingPitch', 'xmlIdChecksum'];
/** Safety cap; the runtime releases baselines no channel uses (verovio-runtime.ts releaseUnused). */
const BASELINE_LIMIT = 12;
/**
 * A MusicXML score of at least this many staff-measures (parts x measures) is engraved in chunks. Below it a whole
 * import is quick (about a second) and keeps the whole-document path, unless chunking is forced (an out-of-memory retry).
 */
const CHUNK_MIN_STAFF_MEASURES = 2400;
/** Imported chunk MEI kept per score, so scrolling back or changing the view does not convert the MusicXML again. */
const CHUNK_MEI_LIMIT = 8;

type Toolkit = InstanceType<typeof VerovioToolkit>;
type Module = Awaited<ReturnType<typeof createVerovioModule>>;
/**
 * Verovio is not bundled into this worker: it imports upstream's own files at runtime from the URLs the runtime sends
 * first (`configure`; by default the copies shipped in dist/verovio/, or the host's `verovioBaseUrl`), so the
 * LGPL-licensed library stays a separate, replaceable file. See verovio-protocol.ts VerovioFiles for the interface.
 */
type Verovio = { createModule: typeof createVerovioModule; Toolkit: typeof VerovioToolkit; enableLogToBuffer: typeof enableLogToBuffer };
let files: VerovioFiles | undefined;
let verovioPromise: Promise<Verovio> | undefined;
let verovio: Verovio | undefined;
function loadVerovio(): Promise<Verovio> {
  return verovioPromise ??= (async () => {
    if (!files) throw new Error('The notation renderer was not told where to load Verovio from.');
    const { module, toolkit } = files;
    try {
      const [wasm, js] = await Promise.all([import(/* @vite-ignore */ module), import(/* @vite-ignore */ toolkit)]);
      if (typeof wasm.default !== 'function' || typeof js.VerovioToolkit !== 'function' || typeof js.enableLogToBuffer !== 'function') throw new Error('not a compatible Verovio build');
      return verovio = { createModule: wasm.default, Toolkit: js.VerovioToolkit, enableLogToBuffer: js.enableLogToBuffer };
    } catch (error) {
      verovioPromise = undefined; // a later request tries again (browsers keep a failed module fetch, so no re-download)
      // A RequestError keeps failure() from reading the URLs in the message as an out-of-memory report ("zoom", "bloom").
      throw new RequestError(`Could not load Verovio from ${module} and ${toolkit}: ${error instanceof Error ? error.message : String(error)}`, undefined);
    }
  })();
}
let modulePromise: Promise<Module> | undefined;
let currentModule: Module | undefined;
// Verovio logs every import and layout warning to the console; a large score logs tens of thousands, which costs
// real time in the worker. Logs are buffered instead and summarized once per request (see drainLog).
function moduleReady(): Promise<Module> {
  if (modulePromise) return modulePromise;
  const created: Promise<Module> = loadVerovio()
    .then(api => api.createModule())
    .then(module => { verovio!.enableLogToBuffer(1, module); currentModule = module; return module; })
    .catch(error => { if (modulePromise === created) modulePromise = undefined; throw error; }); // the next request tries again
  return modulePromise = created;
}
/** A new toolkit on the current module (the module and the toolkit class load together). */
const newToolkit = async (): Promise<Toolkit> => { const module = await moduleReady(); return new verovio!.Toolkit(module); };
let main: Toolkit | undefined;
let probe: Toolkit | undefined;
/** What the main toolkit holds: the loaded view and the options it was last laid out with. */
let loaded: { loadKey: string; optionsKey: string } | undefined;
type WholeBaseline = { kind: 'whole'; mei: string; info: BaselineInfo; spelled?: { key: string; mei: string }; tabbed?: { key: string; mei: string } };
/** `frets`: TAB fingerings by note ID per spelling and TAB spec, so a note keeps its fret in every chunk that draws it. */
type ChunkedBaseline = { kind: 'chunked'; index: ChunkIndex; info: BaselineInfo; meis: Map<string, string>; spelled: Map<string, string>; frets: Map<string, FretMemory> };
type Baseline = WholeBaseline | ChunkedBaseline;
const baselines = new Map<number, Baseline>();
/** Log text of toolkits destroyed during a request, reported with it. */
const pendingLog: string[] = [];

class RequestError extends Error {
  constructor(message: string, readonly code: VerovioReply['code']) { super(message); }
}

function discardToolkits(resetModule: boolean): void {
  for (const toolkit of [main, probe]) { try { toolkit?.destroy(); } catch { /* already unusable */ } }
  main = probe = undefined;
  loaded = undefined;
  if (resetModule) { modulePromise = undefined; currentModule = undefined; }
}

async function toolkit(which: 'main' | 'probe'): Promise<Toolkit> {
  if (which === 'main') return main ??= await newToolkit();
  return probe ??= await newToolkit();
}

/** Current size of the WASM heap in bytes (it only grows; the runtime recycles the worker when it is large). */
function heapBytes(): number | undefined {
  const module = currentModule as { HEAPU8?: Uint8Array; wasmMemory?: WebAssembly.Memory } | undefined;
  return module?.HEAPU8?.length ?? module?.wasmMemory?.buffer.byteLength;
}

function baseline(revision: number): Baseline {
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

const IMPORT_OPTIONS = { breaks: 'none', inputFrom: 'auto', xmlIdChecksum: true };

/** Convert MusicXML text to Verovio's MEI in a toolkit of its own, destroyed afterwards so its document is freed. */
async function convert(text: string): Promise<string> {
  const target = await newToolkit();
  try {
    load(target, text, IMPORT_OPTIONS);
    return target.getMEI();
  } finally {
    try { pendingLog.push(target.getLog() || ''); } catch { /* no log */ }
    try { target.destroy(); } catch { /* already unusable */ }
  }
}

/** The MEI of a chunk's measure range `[from, to)`, converted once and kept in a small per-score cache. */
async function chunkMei(entry: ChunkedBaseline, from: number, to: number): Promise<string> {
  const key = `${from}-${to}`;
  let mei = entry.meis.get(key);
  if (mei !== undefined) { entry.meis.delete(key); entry.meis.set(key, mei); return mei; }
  mei = await convert(sliceMusicXml(entry.index, from, to));
  entry.meis.set(key, mei);
  while (entry.meis.size > CHUNK_MEI_LIMIT) entry.meis.delete(entry.meis.keys().next().value!);
  return mei;
}

/** Verovio's transposition of a baseline, in a toolkit of its own (destroyed afterwards so its document is freed). */
async function transposeMei(mei: string, options: { transpose: string; transposeToSoundingPitch: boolean }): Promise<string> {
  const target = await newToolkit();
  try {
    load(target, mei, { breaks: 'none', xmlIdChecksum: true, ...options });
    return target.getMEI();
  } finally {
    try { pendingLog.push(target.getLog() || ''); } catch { /* no log */ }
    try { target.destroy(); } catch { /* already unusable */ }
  }
}
const spell = (mei: string, spec: SpellingSpec | undefined, measureOffset = 0) => spellBaseline(mei, spec, transposeMei, measureOffset);

/** The whole baseline spelled for `spec`, kept for the latest spec so layout changes do not transpose again. */
async function spelledWhole(entry: WholeBaseline, spec: SpellingSpec | undefined): Promise<string> {
  if (!spec) return entry.mei;
  const key = JSON.stringify(spec);
  if (entry.spelled?.key !== key) entry.spelled = { key, mei: await spell(entry.mei, spec) };
  return entry.spelled.mei;
}

/**
 * The whole baseline spelled and with the view's TAB staves (notation/mei-tab.ts), kept for the latest view so layout
 * changes and probes do not solve the fingerings again. TAB follows spelling, so frets match the transposed pitches.
 */
async function viewWhole(entry: WholeBaseline, view: ViewSpec): Promise<string> {
  const spelled = await spelledWhole(entry, view.spelling);
  if (!view.tab) return spelled;
  const key = JSON.stringify([view.spelling ?? null, view.tab]);
  if (entry.tabbed?.key !== key) entry.tabbed = { key, mei: injectTab(spelled, view.tab) };
  return entry.tabbed.mei;
}

/** A chunk spelled and with the view's TAB staves; fingerings are remembered by note ID across chunks. */
async function viewChunk(entry: ChunkedBaseline, from: number, to: number, view: ViewSpec): Promise<string> {
  const spelled = await spelledChunk(entry, from, to, view.spelling);
  if (!view.tab) return spelled;
  const key = JSON.stringify([view.spelling ?? null, view.tab]);
  let memory = entry.frets.get(key);
  if (!memory) {
    memory = new Map();
    entry.frets.set(key, memory);
    while (entry.frets.size > 4) entry.frets.delete(entry.frets.keys().next().value!);
  }
  return injectTab(spelled, view.tab, memory);
}

/** A chunk's MEI spelled for `spec`, in a small per-score cache like the converted chunks. */
async function spelledChunk(entry: ChunkedBaseline, from: number, to: number, spec: SpellingSpec | undefined): Promise<string> {
  const raw = await chunkMei(entry, from, to);
  if (!spec || !spellingNeeded(raw, spec)) return raw;
  const key = `${from}-${to}|${JSON.stringify(spec)}`;
  let mei = entry.spelled.get(key);
  if (mei !== undefined) { entry.spelled.delete(key); entry.spelled.set(key, mei); return mei; }
  mei = await spell(raw, spec, from);
  entry.spelled.set(key, mei);
  while (entry.spelled.size > CHUNK_MEI_LIMIT) entry.spelled.delete(entry.spelled.keys().next().value!);
  return mei;
}

const pick = (options: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.map(key => [key, options[key] ?? null]));

/**
 * Make the main toolkit hold `view` of `revision` (or of one chunk of it) laid out with `options`, reloading only
 * when it must. `document` builds the view MEI when a load is needed.
 */
async function ensureLayout(documentKey: unknown[], view: ViewSpec, options: Record<string, unknown>, document: () => Promise<string>): Promise<Toolkit> {
  const loadKey = JSON.stringify([...documentKey, view, pick(options, LOAD_OPTIONS)]);
  const optionsKey = JSON.stringify(options);
  const target = await toolkit('main');
  if (loaded?.loadKey !== loadKey) {
    loaded = undefined;
    const data = await document();
    load(target, data, options);
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

/** Import a source: a long MusicXML score is indexed for chunked engraving, anything else converted whole. */
async function importSource(revision: number, bytes: ArrayBuffer, force: boolean): Promise<BaselineInfo> {
  const text = new TextDecoder().decode(bytes);
  const index = indexMusicXml(text);
  let entry: Baseline;
  if (index && (force || index.parts.length * index.measureCount >= CHUNK_MIN_STAFF_MEASURES)) {
    // The staff structure (staffDef numbers and IDs, groups) comes from Verovio's import of the first measure.
    const { staffDefs, groups } = scanBaseline(await convert(sliceMusicXml(index, 0, 1)));
    const info: BaselineInfo = { measureIds: Array.from({ length: index.measureCount }, (_, measure) => measureId(measure)), lyricDensity: index.lyricDensity, staffDefs, groups, chunked: true };
    entry = { kind: 'chunked', index, info, meis: new Map(), spelled: new Map(), frets: new Map() };
  } else {
    const target = await toolkit('main');
    loaded = undefined;
    load(target, text, IMPORT_OPTIONS);
    const mei = target.getMEI();
    entry = { kind: 'whole', mei, info: scanBaseline(mei) };
  }
  baselines.delete(revision);
  baselines.set(revision, entry);
  while (baselines.size > BASELINE_LIMIT) baselines.delete(baselines.keys().next().value!);
  return entry.info;
}

/**
 * Verovio's SVG id comes from the score checksum, and its glyph defs (`E050-<id>`) and scoped `<style>` rules
 * (`#<id> g.dir …`) hang off it, so two readers showing the same score would repeat them: every `<use>` resolves to the
 * first reader's glyphs (in its notation font) and each reader's style rules reach the other's SVG. The channel
 * suffix keeps these ids per reader. Element ids (notes, measures) stay as they are: the reader maps them to its
 * score and only looks them up inside its own root.
 */
function svgFor(target: Toolkit, page: number, channel: number): string {
  const svg = substituteFingerLabels(target.renderToSVG(page));
  const id = /<svg\b[^>]*?\sid="([^"]+)"/.exec(svg)?.[1];
  if (!id || !/^[\w-]+$/.test(id)) return svg;
  return svg.replace(new RegExp(`(?<=[#"-])${id}(?![\\w-])`, 'g'), `${id}-c${channel}`);
}

/** How long a simulated out-of-memory request works before it fails (test hook). */
const SIMULATED_OOM_MS = 300;

/** Staves a view engraves (a chunk's size is set in staff-measures), generated TAB staves included. */
const stavesOf = (info: BaselineInfo, view: ViewSpec) => {
  const hidden = new Set(view.hiddenStaves);
  return Math.max(1, info.staffDefs.filter(def => !hidden.has(def.n)).length + (view.tab?.generate.length ?? 0));
};

async function handle(request: VerovioRequest): Promise<unknown> {
  if (request.kind === 'import') return importSource(request.revision, request.bytes, !!request.chunking?.force);
  if (request.kind === 'release') { baselines.delete(request.revision); return null; }
  // Test hook (see verovio-runtime takeSimulatedOom): fail the way emscripten reports a heap that cannot grow, after a
  // while, as a real layout does (so other requests queue up behind it meanwhile).
  if (request.simulateOom) { await new Promise(resolve => setTimeout(resolve, SIMULATED_OOM_MS)); throw new RangeError('Cannot enlarge memory arrays (simulated).'); }
  const entry = baseline(request.revision);
  if (request.kind === 'probe') {
    const target = await toolkit('probe');
    if (entry.kind === 'chunked') {
      // The first two systems and the measures their spans end in: the probe's own small chunk.
      const total = entry.index.measureCount;
      const core = Math.min(total, request.measures * 2);
      const limit = request.measures >= total ? total : core + tailFor(entry.index, core);
      load(target, buildViewMei(await viewChunk(entry, 0, limit, request.view), request.view), request.options);
      return { svg: svgFor(target, 1, request.channel), pageCount: target.getPageCount(), measures: limit };
    }
    const { info } = entry;
    const mei = await viewWhole(entry, request.view);
    const limit = request.measures >= info.measureIds.length ? info.measureIds.length : probeLimit(mei, request.measures, info.measureIds.length);
    load(target, buildViewMei(mei, request.view, limit), request.options);
    const svg = svgFor(target, 1, request.channel);
    return { svg, pageCount: target.getPageCount(), measures: limit };
  }
  if (entry.kind === 'whole') {
    const target = await ensureLayout([request.revision], request.view, request.options, async () => buildViewMei(await viewWhole(entry, request.view), request.view));
    const count = target.getPageCount();
    const pages = request.pages.filter(page => page >= 1 && page <= count).map(page => ({ page, svg: svgFor(target, page, request.channel) }));
    return { pageCount: count, pages };
  }
  // Chunked: pages are systems of `breakEvery` measures; each is drawn from the chunk document that holds it.
  const bars = request.view.breakEvery;
  const total = bars > 0 ? Math.ceil(entry.index.measureCount / bars) : 1;
  const plans = new Map<string, { plan: ChunkPlan; pages: number[] }>();
  for (const page of request.pages) {
    if (page < 1 || page > total) continue;
    const plan = planChunk(entry.index, page - 1, bars, stavesOf(entry.info, request.view), request.chunkBudget);
    const key = `${plan.from}-${plan.to}`;
    (plans.get(key) ?? plans.set(key, { plan, pages: [] }).get(key)!).pages.push(page);
  }
  const pages: { page: number; svg: string }[] = [];
  for (const { plan, pages: wanted } of plans.values()) {
    const target = await ensureLayout([request.revision, plan.from, plan.to], request.view, request.options,
      async () => buildViewMei(await viewChunk(entry, plan.from, plan.to, request.view), request.view, Infinity, plan.from));
    const count = target.getPageCount();
    for (const page of wanted) {
      const local = plan.firstPage + (page - 1 - plan.firstSystem);
      if (local > count) throw new Error(`A score chunk laid out ${count} pages where ${local} were expected.`);
      pages.push({ page, svg: svgFor(target, local, request.channel) });
    }
  }
  return { pageCount: total, pages };
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
  let text = pendingLog.splice(0).join('');
  try { text += (main ?? probe)?.getLog() || ''; } catch { /* no log */ }
  if (!text) return;
  const lines = text.split('\n').filter(Boolean);
  const errors = lines.filter(line => line.startsWith('[Error]')).length;
  console.warn(`Verovio ${kind}: ${lines.length} log message${lines.length === 1 ? '' : 's'} (${errors} error${errors === 1 ? '' : 's'})${lines.length > 12 ? ', first 12' : ''}:\n${lines.slice(0, 12).join('\n')}`);
}

const queue: VerovioRequest[] = [];
/** The newest render ticket per channel (reader instance); older queued probes and renders on it are superseded. */
const latestTickets = new Map<number, number>();
let running = false;
const reply = (message: VerovioReply) => self.postMessage(message);

async function step(): Promise<void> {
  const request = queue.shift();
  if (!request) { running = false; return; }
  if (request.kind !== 'import' && request.kind !== 'release' && request.ticket < (latestTickets.get(request.channel) ?? 0)) {
    reply({ id: request.id, error: 'Superseded score render.', code: 'superseded' });
  } else {
    try { const value = await handle(request); drainLog(request.kind); reply({ id: request.id, value, heap: heapBytes() }); }
    catch (error) {
      drainLog(request.kind);
      const { message, code } = failure(error);
      // A failed Verovio call can leave the toolkit (or, after an abort, the module) unusable: start clean next time.
      if (code !== 'missing') discardToolkits(code === 'oom' || !(error instanceof Error && error.message === 'Verovio could not import this score.'));
      reply({ id: request.id, error: message, code, heap: heapBytes() });
    }
  }
  // Yield so newer requests (and their tickets) arrive before the next queued one runs.
  setTimeout(() => void step(), 0);
}

self.onmessage = (event: MessageEvent<VerovioRequest | VerovioConfigure>) => {
  const request = event.data;
  if (request.kind === 'configure') {
    files = request.files;
    // Warm up at once: fetch, compile and instantiate Verovio while the main thread still imports the score. A
    // failure is forgotten here (moduleReady resets) and reported by the first request, which tries again.
    moduleReady().catch(() => {});
    return;
  }
  if (request.kind === 'probe' || request.kind === 'render') latestTickets.set(request.channel, Math.max(latestTickets.get(request.channel) ?? 0, request.ticket));
  queue.push(request);
  if (!running) { running = true; setTimeout(() => void step(), 0); }
};
