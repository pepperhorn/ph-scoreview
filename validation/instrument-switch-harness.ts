// In-page harness for validation/instrument-switch.mjs: imports a MusicXML file the way the reader does and reports the
// import facts the instrument switch keys on (source part ids, slur ends, note ids) plus the MEI xml:ids Verovio assigns;
// and engraves a switched view through the worker's pipeline (MEI baseline, Verovio transposition and the spelling
// pass with the switched staves, the view MEI) or through the reader's own renderScore (worker, chunks).
import '../packages/pepperscore/src/styles.css';
import createVerovioModule from 'verovio/wasm';
import { VerovioToolkit } from 'verovio/esm';
import { parseAbc, parseMusicXml } from '../packages/pepperscore/src/lib/import';
import { generatedPitchId, generatedPitchIdOf } from '../packages/pepperscore/src/lib/notation/document';
import { applyInstrumentView, sourcePartOf, type PartSwitch } from '../packages/pepperscore/src/lib/instrument-view';
import { buildViewMei, scanBaseline } from '../packages/pepperscore/src/lib/notation/mei-view';
import { respellMei, spellBaseline, type SpellingSpec, type StaffSpec } from '../packages/pepperscore/src/lib/notation/mei-spelling';
import { indexMusicXml, sliceMusicXml } from '../packages/pepperscore/src/lib/notation/musicxml-chunks';
import { planStaves, renderScore } from '../packages/pepperscore/src/lib/render';
import { scoreForView, type ScorePitchView } from '../packages/pepperscore/src/lib/transpose';
import { verovioBaseline } from '../packages/pepperscore/src/lib/verovio-runtime';
import { gmProgramForSoundfont, type Score } from '../packages/pepperscore/src/lib/score';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import PepperScore, { type PepperScoreReadyInfo } from '../packages/pepperscore/src/components/PepperScore';
import type { PepperScoreSettings } from '../packages/pepperscore/src/lib/prefs';
import type { PepperScoreControls } from '../packages/pepperscore/src/lib/chrome';
import { readerPitch, switchedSoundParts, switchedTimeline, switchedView, switchesFromSettings } from '../packages/pepperscore/src/lib/instrument-switch-state';
import { baseTimelineFor, playbackEventsFrom } from '../packages/pepperscore/src/lib/playback/timeline';
import { readerStorage } from '../packages/pepperscore/src/lib/storage';
import { SCORE_STORE } from '../packages/pepperscore/src/lib/score-db';

type Toolkit = InstanceType<typeof VerovioToolkit>;
let toolkit: Promise<Toolkit> | undefined;
const verovio = () => toolkit ??= createVerovioModule().then(module => new VerovioToolkit(module));
function load(target: Toolkit, data: string, options: Record<string, unknown>) {
  target.resetOptions(); target.setOptions(options);
  if (!target.loadData(data)) throw new Error('Verovio could not load the document');
}
async function convert(text: string): Promise<string> { const target = await verovio(); load(target, text, { breaks: 'none', inputFrom: 'auto', xmlIdChecksum: true }); return target.getMEI(); }
const transposer = async (mei: string, options: { transpose: string; transposeToSoundingPitch: boolean }) => {
  const target = await verovio(); load(target, mei, { breaks: 'none', xmlIdChecksum: true, ...options }); return target.getMEI();
};

/** The xml:ids of an MEI document, in order. */
async function meiIds(xml: string): Promise<string[]> {
  const target = await verovio();
  target.resetOptions(); target.setOptions({ breaks: 'none', inputFrom: 'auto', xmlIdChecksum: true });
  if (!target.loadData(xml)) throw new Error('Verovio could not load the document');
  return [...target.getMEI().matchAll(/xml:id="([^"]+)"/g)].map(match => match[1]);
}

export async function importFacts(xml: string) {
  const score = parseMusicXml(xml);
  return {
    parts: score.parts.map(part => ({ id: part.id, sourcePartId: part.sourcePartId, sourcePart: sourcePartOf(part) })),
    noteIds: score.parts.flatMap(part => part.measures.flatMap(measure => measure.notes.map(note => note.id))),
    slurStops: score.parts.flatMap(part => part.measures.flatMap(measure => measure.notes.map(note => (note.slurStop?.length ?? 0) > 0))),
    meiIds: await meiIds(xml),
  };
}

const ALTER: Record<string, number> = { s: 1, f: -1, n: 0, x: 2, ss: 2, ff: -2 };
type DrawnNote = { id: string; source: string; staff: string; measure: number; pname: string; oct: number; alter: number | null; written: string | null };
type DrawnClef = { staff: string; shape: string | null; line: string | null; dis: string | null; disPlace: string | null };
/** Notes (pitch name, octave, explicit alteration) and the opening clef of every staff of an MEI document. */
function readMei(text: string, measureOffset = 0) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const notes: DrawnNote[] = [];
  const measures = [...doc.getElementsByTagName('measure')];
  measures.forEach((measure, index) => {
    for (const note of measure.getElementsByTagName('note')) {
      const accid = [...note.children].find(child => child.localName === 'accid');
      const gestural = note.getAttribute('accid.ges') ?? accid?.getAttribute('accid.ges') ?? null;
      const written = note.getAttribute('accid') ?? accid?.getAttribute('accid') ?? null;
      const value = written ?? gestural;
      const id = note.getAttribute('xml:id') || '';
      notes.push({ id, source: generatedPitchIdOf(id) ?? id, staff: note.closest('staff')?.getAttribute('n') || '', measure: index + measureOffset,
        pname: (note.getAttribute('pname') || '').toUpperCase(), oct: Number(note.getAttribute('oct')), alter: value !== null ? ALTER[value] ?? 0 : null, written });
    }
  });
  const clefs: DrawnClef[] = [];
  /** Opening key signature (fifths) per staff. */
  const keys: Record<string, number | null> = {};
  const firstScoreDef = doc.getElementsByTagName('scoreDef')[0];
  for (const def of firstScoreDef ? [...firstScoreDef.getElementsByTagName('staffDef')] : []) {
    const child = [...def.children].find(item => item.localName === 'clef');
    clefs.push({ staff: def.getAttribute('n') || '', shape: child?.getAttribute('shape') ?? def.getAttribute('clef.shape'), line: child?.getAttribute('line') ?? def.getAttribute('clef.line'),
      dis: child?.getAttribute('dis') ?? def.getAttribute('clef.dis'), disPlace: child?.getAttribute('dis.place') ?? def.getAttribute('clef.dis.place') });
    const sig = [...def.children].find(item => item.localName === 'keySig')?.getAttribute('sig') ?? def.getAttribute('keysig') ?? def.getAttribute('key.sig');
    const match = /^(\d+)([sf]?)$/.exec(sig || '');
    keys[def.getAttribute('n') || ''] = match ? Number(match[1]) * (match[2] === 'f' ? -1 : 1) : null;
  }
  const inlineClefs = measures.flatMap(measure => [...measure.getElementsByTagName('clef')].map(clef => clef.closest('staff')?.getAttribute('n') || ''));
  return { notes, clefs, keys, inlineClefs };
}

/** `format: 'abc'`: the text is ABC (engraved from the MEI the Score generates), else MusicXML. */
export type SwitchCase = { switches: Record<number, PartSwitch>; view?: ScorePitchView; semitones?: number; slices?: number; format?: 'abc' };
const parse = (text: string, test?: SwitchCase): Promise<Score> => (test?.format === 'abc' ? parseAbc(text) : Promise.resolve(parseMusicXml(text)));
const scores = new Map<string, { score: Score; baseline: string }>();
async function prepare(xml: string, test?: SwitchCase) {
  let entry = scores.get(xml);
  if (!entry) {
    const score = await parse(xml, test);
    entry = { score, baseline: await convert(new TextDecoder().decode(score.document!.engravingBytes())) };
    scores.set(xml, entry);
  }
  return entry;
}
const switchesById = (score: Score, switches: Record<number, PartSwitch>) => Object.fromEntries(Object.entries(switches).map(([index, value]) => [score.parts[Number(index)].id, value]));
function displayOf(score: Score, test: SwitchCase) {
  const view = test.view ?? 'written';
  return applyInstrumentView(scoreForView(score, view, test.semitones ?? 0), switchesById(score, test.switches), view);
}
/** The display Score's pitches by MEI note id (`Pitch.sourceId`, or the id the Score's generated MEI gives it), and its parts. */
function scoreFacts(result: ReturnType<typeof applyInstrumentView>) {
  const pitches: Record<string, { step: string; octave: number; alter: number; midi: number; note: string }> = {};
  for (const part of result.score.parts) for (const measure of part.measures) for (const note of measure.notes) note.pitches.forEach((p, index) => { pitches[p.sourceId ?? generatedPitchId(note, index)] = { step: p.step, octave: p.octave, alter: p.alter, midi: p.midi, note: note.id }; });
  return { pitches, parts: result.score.parts.map(part => ({ id: part.id, clef: part.clef, instrument: part.instrument, key: part.measures[0]?.key ?? part.key })),
    moved: result.moved, outOfRange: result.outOfRange, staves: result.staves };
}

/**
 * Engrave a switched view the way the worker does (whole, or in `slices`-measure chunks with one bar of overlap, each
 * spelled with its measure offset) and read back what Verovio would draw.
 */
export async function engraveSwitch(xml: string, test: SwitchCase) {
  const { score, baseline } = await prepare(xml, test);
  const result = displayOf(score, test);
  const plan = planStaves(scanBaseline(baseline), result.score, new Set(result.hiddenTab));
  const target = await verovio();
  const viewSpec = { breakEvery: 0, hiddenStaves: plan.hiddenStaves, chordSymbols: true, spelling: plan.spelling };
  const engrave = (mei: string) => { load(target, mei, { breaks: 'none', xmlIdChecksum: true, pageWidth: 60000 }); return target.getMEI(); };
  const facts = { ...scoreFacts(result), staffOf: Object.fromEntries(plan.staffOf), spec: plan.spelling };
  if (!test.slices) return { ...facts, ...readMei(engrave(buildViewMei(await spellBaseline(baseline, plan.spelling, transposer), viewSpec))) };
  const index = indexMusicXml(new TextDecoder().decode(score.document!.engravingBytes()))!;
  const notes: DrawnNote[] = []; const chunks: { from: number; to: number; clefs: DrawnClef[]; inlineClefs: string[] }[] = [];
  for (let from = 0; from < index.measureCount; from += test.slices - 1) {
    const to = Math.min(index.measureCount, from + test.slices);
    const chunk = await spellBaseline(await convert(sliceMusicXml(index, from, to)), plan.spelling, transposer, from);
    const read = readMei(engrave(buildViewMei(chunk, viewSpec, Infinity, from)), from);
    notes.push(...read.notes); chunks.push({ from, to, clefs: read.clefs, inlineClefs: read.inlineClefs });
    if (to >= index.measureCount) break;
  }
  return { ...facts, notes, chunks, clefs: chunks[0].clefs, inlineClefs: chunks.flatMap(chunk => chunk.inlineClefs) };
}

/**
 * Draw a switched view with the reader's renderScore (the Verovio worker; `localStorage['scoreflow-chunking']` set
 * before the page loaded forces chunks) and read the drawn noteheads (`data-pname` / `data-oct`) and clef glyphs.
 */
export async function renderSwitch(xml: string, test: SwitchCase) {
  const score = await parse(xml, test);
  const result = displayOf(score, test);
  const info = await verovioBaseline(score.document!);
  const container = document.createElement('div');
  container.className = 'instrument-switch-render';
  container.style.width = '1200px';
  document.body.appendChild(container);
  try {
    await renderScore(container, result.score, 'portrait', false, false, false, 2, false, false, 0, 1, 0, { hiddenPartIds: result.hiddenTab });
    // The first system's key signature per staff: signed count of sharps (U+E262) or flats (U+E260) drawn.
    const keys: Record<string, number> = {};
    for (const staff of container.querySelector('svg')?.querySelectorAll('g.staff[data-n]') ?? []) {
      const accids = [...staff.querySelectorAll('g.keySig use')].map(use => use.getAttribute('xlink:href') || use.getAttribute('href') || '');
      keys[staff.getAttribute('data-n')!] = accids.filter(href => href.includes('E262')).length - accids.filter(href => href.includes('E260')).length;
    }
    const notes = [...container.querySelectorAll('g.note')].map(note => ({ id: note.id, staff: note.closest('g.staff')?.getAttribute('data-n') || '', pname: (note.getAttribute('data-pname') || '').toUpperCase(), oct: Number(note.getAttribute('data-oct')) }));
    const systems = container.querySelectorAll('svg').length;
    return { ...scoreFacts(result), chunked: info.chunked, systems, notes, keys };
  } finally { container.remove(); }
}

/** The spelling pass alone on a file's baseline with one staff given `clef` (the MEI clef mapping). */
export async function respellClef(xml: string, staff: string, clef: StaffSpec['clef']) {
  const { baseline } = await prepare(xml);
  const spec: SpellingSpec = { interval: '', semitones: 0, concert: false, flip: false, staves: { [staff]: { profile: 'neutral', moved: true, clef } } };
  return readMei(respellMei(baseline, spec));
}

/** The spelling pass alone on a file's baseline with octave moves (MEI note ids, found by staff and order) on one staff. */
export async function respellOctaves(xml: string, staff: string, moves: Record<number, 12 | -12>) {
  const { baseline } = await prepare(xml);
  const ids = readMei(baseline).notes.filter(note => note.staff === staff).map(note => note.id);
  const octaves = Object.fromEntries(Object.entries(moves).map(([index, value]) => [ids[Number(index)], value]));
  const spec: SpellingSpec = { interval: '', semitones: 0, concert: false, flip: false, staves: { [staff]: { profile: 'neutral', moved: false, octaves } } };
  return { before: readMei(baseline), after: readMei(respellMei(baseline, spec)) };
}

// --- The reader with instrument settings (PepperScore mounted in the page) -----------------------------------------
type MountProps = { settings?: PepperScoreSettings; highlights?: { ids?: string[]; className: string }[] };
/**
 * Mount PepperScore (minimal chrome, nothing saved, silent) on `xml` and read the first draw: noteheads per staff
 * (`data-pname` / `data-oct`), each staff's opening clef glyph, and the drawn notes carrying each highlight class.
 */
export async function mountReader(xml: string, props: MountProps = {}) {
  const host = document.createElement('div');
  host.className = 'instrument-switch-reader';
  host.style.width = '1200px';
  document.body.appendChild(host);
  const root = createRoot(host);
  let ready: PepperScoreReadyInfo | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('PepperScore did not render')), 60000);
      root.render(createElement(PepperScore, { musicXml: xml, chrome: 'minimal', persist: false, audio: false, settings: props.settings, highlights: props.highlights,
        onError: error => { clearTimeout(timer); reject(error); },
        onReady: info => { ready = info; },
        onRender: () => { clearTimeout(timer); resolve(); } }));
    });
    return { ...await readReader(host, props), ready };
  } finally { root.unmount(); host.remove(); }
}

/** What a mounted reader drew: noteheads per staff, opening clef glyphs, highlighted notes. */
async function readReader(host: HTMLElement, props: MountProps = {}) {
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const svgNotes = [...host.querySelectorAll('.score-system svg g.note')];
  const notes = svgNotes.map(note => ({ staff: note.closest('g.staff')?.getAttribute('data-n') || '', pitch: `${(note.getAttribute('data-pname') || '').toUpperCase()}${note.getAttribute('data-oct')}` }));
  const glyph = (use: Element | null) => (use?.getAttribute('xlink:href') || use?.getAttribute('href') || '').replace(/^#/, '').split('-')[0];
  const clefs: Record<string, string> = {};
  for (const staff of host.querySelectorAll('.score-system svg g.staff[data-n]')) clefs[staff.getAttribute('data-n')!] ??= ({ E050: 'G', E062: 'F', E05C: 'C' } as Record<string, string>)[glyph(staff.querySelector('g.clef use'))] ?? '?';
  /** Drawn pitches inside elements with the class (a chord's notes count for the chord). */
  const classed = (name: string) => [...host.querySelectorAll(`.score-system svg .${name}`)].flatMap(element => (element.matches('g.note') ? [element] : [...element.querySelectorAll('g.note')])
    .map(note => `${note.closest('g.staff')?.getAttribute('data-n')}:${(note.getAttribute('data-pname') || '').toUpperCase()}${note.getAttribute('data-oct')}`));
  return { notes, clefs, transposed: classed('ps-transposed'), selection: classed('ps-octave-selection'), outOfRange: classed('ps-out-of-range'), host: props.highlights?.map(item => classed(item.className)) ?? [],
    outOfRangeColor: (() => { const element = host.querySelector('.score-system svg .ps-out-of-range'); return element ? getComputedStyle(element).fill : null; })() };
}

// --- A full reader left mounted for UI tests (the page drives it; `window.__psDraws` counts finished draws) ---------
let live: { root: ReturnType<typeof createRoot>; host: HTMLElement } | undefined;
/** `__psEvents`: what a `listen` reader reported (onSeek seconds, onElementClick note ids). */
type LiveWindow = Window & { __psDraws?: number; __psEvents?: string[] };
type LiveProps = { controls?: PepperScoreControls; settings?: PepperScoreSettings; chrome?: 'full' | 'minimal'; persist?: string; listen?: boolean };
/**
 * Mount the reader (full chrome unless `chrome`; silent; nothing saved unless `persist` names a namespace) on `xml`
 * and resolve after its first draw. `listen` gives it a stopped host clock and records onSeek / onElementClick.
 */
export async function mountLive(xml: string, props: LiveProps = {}) {
  unmountLive();
  const host = document.createElement('div');
  host.className = 'instrument-switch-live';
  host.style.width = '1200px';
  host.style.height = '900px';
  document.body.appendChild(host);
  const root = createRoot(host);
  live = { root, host };
  const win = window as LiveWindow;
  win.__psDraws = 0;
  win.__psEvents = [];
  const listeners = props.listen ? {
    clock: { now: () => 0, playing: false, subscribe: () => () => {} },
    onSeek: (seconds: number) => { win.__psEvents!.push(`seek:${seconds}`); },
    onElementClick: (info: { noteId?: string }) => { win.__psEvents!.push(`click:${info.noteId ?? ''}`); },
  } : {};
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('PepperScore did not render')), 60000);
    root.render(createElement(PepperScore, { musicXml: xml, chrome: props.chrome ?? 'full', controls: props.controls, settings: props.settings, persist: props.persist ?? false, audio: false, ...listeners,
      onError: error => { clearTimeout(timer); reject(error); },
      onRender: () => { clearTimeout(timer); win.__psDraws = (win.__psDraws ?? 0) + 1; resolve(); } }));
  });
}
/**
 * The octave moves saved under a persist namespace: pending writes are flushed, then every record's parts' switches
 * are read straight from IndexedDB (`{ partId: octaves }` of each part with any).
 */
export async function savedOctaves(ns: string): Promise<Record<string, Record<string, number>>> {
  await readerStorage(ns).scoreDb.flush();
  const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open(ns); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  try {
    if (!db.objectStoreNames.contains(SCORE_STORE)) return {};
    const records = await new Promise<unknown[]>((resolve, reject) => { const request = db.transaction(SCORE_STORE).objectStore(SCORE_STORE).getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const out: Record<string, Record<string, number>> = {};
    for (const record of records as { parts?: Record<string, { switch?: { octaves?: Record<string, number> } }> }[]) {
      for (const [id, part] of Object.entries(record.parts ?? {})) if (part.switch?.octaves) out[id] = part.switch.octaves;
    }
    return out;
  } finally { db.close(); }
}
/** What the mounted full reader drew. */
export const readLive = () => readReader(live!.host);
export function unmountLive() { if (!live) return; live.root.unmount(); live.host.remove(); live = undefined; }

/**
 * The reader's playback of a switched score, through the component's own pipeline (instrument-switch-state.ts): the
 * switches from the host settings, the pitch view rule, the view (switch last), the source's base timeline retuned for
 * the switched parts, and each part's sound. Returns the scheduled events' MIDI per part and each part's GM program.
 */
export async function readerPlayback(xml: string, settings: PepperScoreSettings, options: { scorePitch?: 'written' | 'concert'; semitones?: number } = {}) {
  const score = parseMusicXml(xml);
  const switches = switchesFromSettings(score, settings);
  const pitchView = readerPitch(score, switches, options.scorePitch ?? 'written');
  const semitones = options.semitones ?? 0;
  const view = switchedView(scoreForView(score, pitchView.scorePitch, semitones, false), switches, pitchView.scorePitch);
  const timeline = switchedTimeline(await baseTimelineFor(score), view, semitones);
  const events = playbackEventsFrom(timeline, 0, timeline.initialBpm, semitones);
  const parts = switchedSoundParts(score.parts.filter(part => !part.tabOf), view, switches);
  return {
    scorePitch: pitchView.scorePitch,
    midi: Object.fromEntries(parts.map(part => [part.id, events.filter(event => event.partId === part.id).map(event => event.midi)])),
    programs: Object.fromEntries(parts.map(part => [part.id, part.gmSoundfont ? gmProgramForSoundfont(part.gmSoundfont) : part.gmProgram])),
  };
}
