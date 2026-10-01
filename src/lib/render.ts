import type { Part, Score, ScoreNote } from './score';
import { inferChordSymbol } from './chords';
import { spellChordSymbol } from './spelling';
import { measureKey, scoreForView, spellingSpecFor } from './transpose';
import { isSuperseded, nextRenderTicket, probeVerovio, renderVerovioPages, VerovioError, verovioBaseline } from './verovio-runtime';
import { staffDefXmlId, type SourceDocument } from './notation/document';
import type { BaselineInfo, ViewSpec } from './notation/mei-view';
import { musicFontOptions } from './music-fonts';
import { DEFAULT_VERTICAL_BARS, HEIGHT_FIT_STAVES, STAVE_SCALE_FLOOR, STAVE_SCALE_MAX } from './stave-scale';

const SVG = 'http://www.w3.org/2000/svg';

export type NotePoint = { id: string; measure: number; part: number; start: number; duration: number; rest?: boolean; x: number; y: number; element?: Element; sourceId?: string; system: number };
export type MeasureGeometry = { index: number; system: number; x: number; width: number; y: number; height: number; element?: Element };
export type SystemGeometry = { index: number; firstMeasure: number; measureCount: number; width: number; height: number; staffCenters: number[];
  /** The system's engraving is in the DOM; otherwise its block is a placeholder sized from layout data (estimated until first drawn). */
  rendered: boolean };
export type RenderResult = { systemSize: number; staffCenters: number[]; scale: number; barWidth: number; systemHeight: number; systems: SystemGeometry[]; visiblePartIds: string[];
  /** Note and measure geometry of the systems currently drawn (see `rendered`); positions are relative to their system block (y: canvas offset at draw time). */
  readonly points: NotePoint[];
  readonly measures: MeasureGeometry[];
  /** Rendered five-line staff height (px) of the first system, the unit staff controls are sized from. */
  stavePx: number;
  /** Smallest distance between adjacent staff centres in the first system (px); Infinity for one staff. */
  staffPitchPx: number;
  /** Left gutter reserved for staff controls before the first system (px). */
  gutter: number;
  /** Stave scale the score was laid out at (px per Verovio unit); the resolved value when 'fit' was requested. */
  zoom: number;
  /** A drawn note by Score note ID. */
  point(id: string): NotePoint | undefined;
  /** A drawn measure by Score measure index. */
  measure(index: number): MeasureGeometry | undefined;
  /** The system (block index) that engraves a Score measure. */
  systemOfMeasure(index: number): number;
  /** Draw a system now (it is otherwise drawn when it scrolls near the viewport). */
  ensureSystem(index: number): Promise<void>;
  /** Called after systems are drawn, released or resized. */
  onChange(listener: () => void): () => void;
  /** Stop drawing systems on demand (a newer render replaced this one). */
  dispose(): void };
export type RenderOptions = { font?: 'Bravura' | 'Petaluma'; textFont?: 'Sans' | 'Serif' | 'Mono'; transpose?: number; semitones?: number; scorePitch?: 'written' | 'concert';
  /** Spell in the enharmonic key (with `transpose`, applied when `score` is not already a `scoreForView` result). */
  flip?: boolean; generation?: number; hiddenPartIds?: string[];
  /**
   * Control gutter for a rendered staff height and staff pitch (px). The layout reserves the gutter for a
   * staff of `STAFF_UNITS * zoom` px before rendering; the final gutter uses the measured staves.
   */
  gutterFor?: (stavePx: number, staffPitchPx: number) => number;
  /** Endless 'fit' zoom (the device's Endless default); a many-staff stack is height-fitted below it. Vertical 'fit' ignores it. */
  fitCap?: number;
  /** Vertical 'fit' is never below this stave scale (compact readability floor); the stack then scrolls. */
  fitFloor?: number;
  /** Draw the system holding this Score measure before resolving (a zoom anchor), besides those in view. */
  focusMeasure?: number };

const latestGeneration = new WeakMap<HTMLElement, number>();
const liveResults = new WeakMap<HTMLElement, RenderResult>();
/** Endless view keeps one unbroken system up to this many bars, then uses bounded chunks. */
const ENDLESS_SINGLE_SYSTEM_LIMIT = 160;
const ENDLESS_CHUNK = 120;
/**
 * A score engraved in chunks (Phase 3) keeps Endless blocks to about this many staff-measures, so each block is a
 * small document (16 to 120 bars).
 */
const ENDLESS_CHUNK_STAFF_MEASURES = 480;
const endlessChunkBars = (staves: number) => Math.max(16, Math.min(ENDLESS_CHUNK, Math.round(ENDLESS_CHUNK_STAFF_MEASURES / Math.max(1, staves) / 8) * 8));
const LANE_GAP = 6;
const LANE_ROW = 17;
/**
 * Scores up to this many staff-measures (visible staves x measures) draw every system before the first paint, as
 * before virtualization; larger ones draw the systems near the viewport and release far ones (see the spec).
 */
export const EAGER_STAFF_MEASURES = 1600;
/** Systems drawn ahead of and behind the viewport, as a multiple of its size (IntersectionObserver root margin). */
const NEAR_SCREENS = 2;
/** Drawn systems beyond this many viewport sizes away are released back to placeholders. */
const KEEP_SCREENS = 4;
/** Pages requested from the worker at once while scrolling. */
const PAGE_BATCH = 2;

export function portraitMinimumBarWidth(score: Score): number {
  let busiest = 4; let lyrics = 0;
  for (const part of score.parts) for (const measure of part.measures) {
    busiest = Math.max(busiest, measure.notes.length);
    let syllables = 0;
    for (const note of measure.notes) if (note.lyric) syllables++;
    lyrics = Math.max(lyrics, syllables);
  }
  return Math.max(190, 50 + busiest * 34, 190 + Math.max(0, busiest - 4) * 44, lyricBarWidth(lyrics));
}
// Lyric syllables need roughly a word's width each; without this, Verovio compresses them into collisions.
const lyricBarWidth = (syllables: number) => syllables ? 110 + syllables * 62 : 0;
/** Auto bars per line never exceeds this; explicit choices stay 1-4. */
export const AUTO_BAR_CAP = 8;
/** Five-line staff height in Verovio layout units at `scale: 100` (72px at stave scale 1). */
export const STAFF_UNITS = 72;
/** Most bars that fit a line of `width` Verovio units (the layout width, not px). */
export function portraitBarLimit(width: number, score: Score, minimumBar = portraitMinimumBarWidth(score)): number {
  return Math.max(1, Math.min(AUTO_BAR_CAP, score.parts[0]?.measures.length || 1, Math.floor((Math.max(240, width) - 56) / minimumBar)));
}
/** Auto bars per line: the width limit, balanced so the last line is not left short. */
export function autoBarsPerLine(width: number, score: Score, minimumBar = portraitMinimumBarWidth(score)): number {
  const limit = portraitBarLimit(width, score, minimumBar);
  const count = Math.max(1, score.parts[0]?.measures.length || 1);
  return Math.ceil(count / Math.ceil(count / limit));
}
/** Narrowest layout width (Verovio units) that engraves `bars` bars at their minimum width with no width fit (matches `layoutAt`). */
export const systemMinimumWidth = (bars: number, barFloor: number) => bars * Math.max(190, barFloor) + 120;
/** Slack (px) for the measured staff and gutter being a pixel or two larger than the layout model. */
const BAR_FIT_SLACK = 4;
/**
 * Largest stave scale at which `bars` bars fit on the first system (beside the zoom-dependent control gutter) at their
 * minimum width, so Auto yields that many bars per line. Usable width `(viewport - gutter(z)) / z` falls as z grows
 * (the gutter never shrinks with the staff), so a bisection finds it. Deterministic, render-free, rounded down to 0.001.
 */
export function barFitZoom(viewportWidth: number, bars: number, barFloor: number, gutterAt: (zoom: number) => number = () => 0): number {
  const need = systemMinimumWidth(bars, barFloor);
  const fits = (zoom: number) => Math.max(180, viewportWidth - gutterAt(zoom) - BAR_FIT_SLACK) / zoom >= need;
  if (fits(STAVE_SCALE_MAX)) return STAVE_SCALE_MAX;
  if (!fits(STAVE_SCALE_FLOOR)) return STAVE_SCALE_FLOOR;
  let low = STAVE_SCALE_FLOOR, high = STAVE_SCALE_MAX;
  for (let step = 0; step < 40; step++) { const mid = (low + high) / 2; if (fits(mid)) low = mid; else high = mid; }
  return Math.floor(low * 1000) / 1000;
}

function parseXml(text: string): XMLDocument {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const error = doc.querySelector('parsererror');
  if (error) throw new Error(`Could not parse Verovio output: ${error.textContent?.slice(0, 180)}`);
  return doc;
}

/**
 * Bounding box of an element in the outer SVG's user (viewBox) coordinates. `rootInverse` is the outer SVG's inverted
 * screen matrix, when the caller measures many elements of one SVG without layout changes in between.
 */
function box(element: Element, svg: SVGSVGElement, rootInverse?: DOMMatrix | null): DOMRect {
  try {
    const graphics = element as SVGGraphicsElement;
    const rect = graphics.getBBox();
    const root = rootInverse !== undefined ? rootInverse : svg.getScreenCTM()?.inverse() ?? null; const own = graphics.getScreenCTM();
    const transform = root && own ? root.multiply(own) : new DOMMatrix();
    const points = [[rect.x, rect.y], [rect.x + rect.width, rect.y], [rect.x, rect.y + rect.height], [rect.x + rect.width, rect.y + rect.height]]
      .map(([x, y]) => new DOMPoint(x, y).matrixTransform(transform));
    const left = Math.min(...points.map(p => p.x)); const top = Math.min(...points.map(p => p.y));
    return new DOMRect(left, top, Math.max(...points.map(p => p.x)) - left, Math.max(...points.map(p => p.y)) - top);
  } catch { return new DOMRect(0, 0, 0, 0); }
}

/**
 * Map Score parts to Verovio staff numbers. Verovio gives a single-staff
 * MusicXML part's staffDef the part ID, while a multi-staff part's staffGrp
 * carries the part ID; semantic MEI from scoreToMei has deterministic staffDef
 * IDs; original MEI keeps its staff numbers.
 */
export function staffNumbers(info: BaselineInfo, score: Score): { byPart: Map<string, string>; engraved: string[] } {
  const defs = info.staffDefs;
  const engraved = [...new Set(defs.map(def => def.n).filter(Boolean))];
  const identity = score.document?.identity?.staffIdToSource || {};
  const byPart = new Map<string, string>();
  const claimed = new Set<string>();
  const claim = (part: Part, def?: { n: string }) => {
    const n = def?.n;
    if (!n || claimed.has(n)) return false;
    byPart.set(part.id, n); claimed.add(n); return true;
  };
  for (const part of score.parts) {
    const legacy = /^(.*)-(\d+)$/.exec(part.id);
    const source = identity[part.id] || (legacy ? { partId: legacy[1], staff: Number(legacy[2]) } : { partId: part.id, staff: 1 });
    if (claim(part, defs.find(def => [part.id, staffDefXmlId(part.id)].includes(def.id)))) continue;
    const group = info.groups.find(item => item.id === source.partId);
    if (group && claim(part, group.staves[source.staff - 1])) continue;
    if (source.staff === 1 && claim(part, defs.find(def => def.id === source.partId))) continue;
    if (score.document?.format === 'mei' || score.document?.engravingFormat === 'mei') claim(part, defs.find(def => def.n === part.id));
  }
  // Positional fallback only when the remaining parts and staves correspond one to one.
  const unmappedParts = score.parts.filter(part => !byPart.has(part.id));
  const unclaimed = engraved.filter(n => !claimed.has(n));
  if (unmappedParts.length && unmappedParts.length === unclaimed.length) unmappedParts.forEach((part, index) => { byPart.set(part.id, unclaimed[index]); claimed.add(unclaimed[index]); });
  return { byPart, engraved };
}

function beatLabel(start: number, subdivisions: boolean): string {
  const beat = Math.floor(start) + 1;
  if (!subdivisions) return String(beat);
  const fraction = ((start % 1) + 1) % 1;
  return fraction < .01 ? String(beat) : fraction < .3 ? `${beat}e` : fraction < .55 ? `${beat}&` : `${beat}a`;
}
function annotation(layer: Element, className: string, x: number, y: number, label: string): void {
  const text = document.createElementNS(SVG, 'text');
  text.setAttribute('x', x.toFixed(1)); text.setAttribute('y', y.toFixed(1)); text.setAttribute('text-anchor', 'middle');
  text.setAttribute('class', `annotation ${className}`); text.textContent = label; layer.appendChild(text);
}
function sourceIds(score: Score, event: ScoreNote): string[] {
  const mapped = score.document?.identity?.noteIdToSourceId?.[event.id];
  return [event.sourceId, mapped, event.id, ...event.pitches.map(p => p.sourceId)].filter((id): id is string => !!id);
}
/** Resolve the rendered event for a model note; a chord wins over any one of its noteheads. */
function findNote(byId: Map<string, Element>, score: Score, event: ScoreNote): Element | undefined {
  for (const id of sourceIds(score, event)) {
    const target = byId.get(id);
    if (!target) continue;
    const related = target.closest('.chord') || target.closest('.note, .rest, .mRest, .multiRest');
    if (related) return related;
  }
  return undefined;
}

const SVG_ELEMENTS = new Set(['svg', 'g', 'defs', 'symbol', 'use', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'desc', 'title', 'style', 'clippath', 'mask', 'lineargradient', 'radialgradient', 'stop', 'pattern', 'marker', 'metadata']);
const SAFE_URL = /url\(\s*['"]?(?!#)/i;
/** Allowlist sanitizer: only static SVG drawing elements, local references and inert styles survive. */
function sanitizeSvg(doc: XMLDocument): SVGSVGElement {
  if (doc.documentElement.namespaceURI !== SVG || doc.documentElement.localName !== 'svg') throw new Error('Verovio returned invalid SVG.');
  for (const element of Array.from(doc.querySelectorAll('*'))) {
    if (!element.isConnected && !doc.contains(element)) continue;
    if (element.namespaceURI !== SVG || !SVG_ELEMENTS.has(element.localName.toLowerCase())) { element.remove(); continue; }
    if (element.localName === 'style' && (/@import|javascript:|expression\(/i.test(element.textContent || '') || SAFE_URL.test(element.textContent || ''))) { element.remove(); continue; }
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value;
      if (name.startsWith('on')
        || ((name === 'href' || name.endsWith(':href')) && !value.startsWith('#'))
        || SAFE_URL.test(value) || /javascript:/i.test(value)) element.removeAttributeNode(attribute);
    }
  }
  return document.importNode(doc.documentElement, true) as unknown as SVGSVGElement;
}

const naturalWidthOf = (svg: string) => Number(/viewBox="\S+\s+\S+\s+([\d.]+)/.exec(svg)?.[1]) || Infinity;
const naturalHeightOf = (svg: string) => Number(/viewBox="[^"]*?\s([\d.]+)"/.exec(svg)?.[1]) || 1;
/** Auto bars are an estimate: Verovio may still wrap a line inside a page. */
const wraps = (svg: string) => (svg.match(/class="system"/g) || []).length > 1;
const yieldTask = () => new Promise<void>(resolve => setTimeout(resolve, 0));

type StaffBand = { top: number; bottom: number; center: number; laneTop: number; lines: boolean };
/** One system block: drawn (`svg`) or a placeholder holding the size from layout data. */
type Slot = {
  index: number;
  block: HTMLElement;
  svg?: SVGSVGElement;
  /** Size in Verovio units: measured once drawn, estimated before. */
  naturalWidth: number; naturalHeight: number; estimated: boolean;
  scale: number;
  firstMeasure: number; measureCount: number;
  bands: Map<string, StaffBand>;
  points: NotePoint[]; measures: MeasureGeometry[];
  loading?: Promise<void>;
  /** Drawing failed; scrolling does not retry it (playback and zoom anchors ask again through ensureSystem). */
  failed?: boolean;
};

/**
 * Render from the original engraving document through the locally bundled WASM worker.
 *
 * Systems near the viewport are drawn; on a large score the rest are placeholders sized from layout data and are drawn
 * (and far ones released) as the reader scrolls, so DOM size and SVG work stay bounded. The first system comes from a
 * small first-measures document, so the first paint does not wait for the whole score's layout.
 */
export async function renderScore(
  container: HTMLElement, score: Score, mode: 'portrait' | 'landscape',
  showNames: boolean, showCounts: boolean, subdivisions: boolean,
  barsPerLine: 'auto' | number, showChordSymbols: boolean, inferChordSymbols: boolean,
  availableHeight = 0, zoom: number | 'fit' = 1, firstSystemGutter = 0, options: RenderOptions = {},
): Promise<RenderResult> {
  // A caller passing the source Score with pitch options gets its view here (Reader passes `scoreForView`'s result).
  if (!score.pitchView) score = scoreForView(score, score.parts.some(part => part.pitchBasis === 'concert') ? 'concert' : options.scorePitch ?? 'written', options.transpose ?? options.semitones ?? 0, !!options.flip);
  const generation = options.generation ?? (latestGeneration.get(container) || 0) + 1;
  latestGeneration.set(container, generation);
  const isCurrent = () => latestGeneration.get(container) === generation;
  const superseded = () => new VerovioError('Superseded score render.', 'superseded');
  const document_ = score.document;
  if (!document_?.engravingBytes().length) throw new Error('This score has no engraving document.');
  const source: SourceDocument = document_;
  const info = await verovioBaseline(source);
  if (!isCurrent()) throw superseded();
  const ticket = nextRenderTicket();
  const viewportWidth = Math.max(240, container.clientWidth);
  const count = Math.max(1, score.parts[0]?.measures.length || 1);
  const measureTotal = info.measureIds.length || count;
  // A chunked score is long or wide: Endless keeps one system only when that is still a small document.
  const endlessSingle = mode === 'landscape' && count <= ENDLESS_SINGLE_SYSTEM_LIMIT && !(info.chunked && score.parts.length * count > EAGER_STAFF_MEASURES);
  const minimumBar = Math.max(portraitMinimumBarWidth(score), lyricBarWidth(info.lyricDensity));
  const barFloor = Math.max(190, minimumBar);
  const hiddenIds = new Set(options.hiddenPartIds || []);
  // The gutter for a staff drawn at this zoom (staff pitch is unknown before layout, so this is an upper bound).
  const layoutGutter = (scale: number) => options.gutterFor ? Math.round(options.gutterFor(STAFF_UNITS * scale, Infinity)) : firstSystemGutter;

  const { byPart: staffOf, engraved } = staffNumbers(info, score);
  let visibleParts = score.parts.filter(part => !hiddenIds.has(part.id) && staffOf.has(part.id));
  if (!visibleParts.length) visibleParts = score.parts.filter(part => staffOf.has(part.id)).slice(0, 1);
  const shown = new Set(visibleParts.map(part => staffOf.get(part.id)!));
  // Staves without a Score part (for example rest-only template parts that import dropped) are hidden reversibly here.
  const hiddenStaves = shown.size ? engraved.filter(n => !shown.has(n)) : [];
  if (!shown.size) visibleParts = score.parts;
  const visibleIndex = new Map(visibleParts.map((part, index) => [part.id, index]));

  // Annotation lanes sit under each staff (below lyrics); reserve room for them in the engraving.
  const annotated = visibleParts.filter(part => part.clef !== 'percussion' || showCounts);
  let nameRows = 0;
  if (showNames) { nameRows = 1; for (const part of annotated) for (const measure of part.measures) for (const note of measure.notes) nameRows = Math.max(nameRows, note.pitches.length); }
  const laneRows = nameRows + (showCounts ? 1 : 0);
  const laneHeight = laneRows ? LANE_GAP + laneRows * LANE_ROW + 4 : 0;
  const spacingStaff = Math.min(48, 12 + Math.ceil(laneHeight / 9) + (showChordSymbols && inferChordSymbols ? 2 : 0));

  // Transposition and spelling: the worker moves and respells the baseline (notation/mei-spelling.ts) with the plan
  // `scoreForView` used for this Score view, so the view is loaded untransposed.
  const spelling = spellingSpecFor(score, staffOf);
  // `natural`: one unbroken system at its natural width (Endless, and a Vertical score shorter than a full line).
  const verovioOptions = (pageWidth: number, natural = false): Record<string, unknown> => ({
    breaks: endlessSingle || natural ? 'none' : 'encoded', font: options.font || 'Bravura', fontFallback: 'Bravura',
    pageWidth: Math.min(100000, Math.max(100, Math.round(pageWidth))), pageHeight: 60000,
    pageMarginLeft: 25, pageMarginRight: 25, pageMarginTop: 20, pageMarginBottom: 20,
    adjustPageHeight: true, adjustPageWidth: mode === 'landscape' || natural, svgViewBox: true, scale: 100, xmlIdChecksum: true,
    spacingStaff, smuflTextFont: 'none', header: 'none', footer: 'none', svgAdditionalAttribute: ['staff@n', 'note@pname', 'note@oct'],
    ...musicFontOptions(options.font),
  });

  // Layout at a stave scale: Verovio lays out (viewport - gutter) / zoom units, so systems fill the viewport.
  type Layout = { zoom: number; bars: number; centred: boolean; natural: boolean; view: ViewSpec; pageCount: number; firstWidth: number; restWidth: number };
  const layoutAt = (scale: number, maxBars = Infinity): Layout => {
    const usableUnits = Math.max(180, viewportWidth - layoutGutter(scale)) / scale;
    const restUnits = viewportWidth / scale;
    const explicit = mode === 'portrait' && barsPerLine !== 'auto';
    const bars = mode === 'landscape' ? (endlessSingle ? count : info.chunked ? endlessChunkBars(visibleParts.length) : ENDLESS_CHUNK) : barsPerLine === 'auto' ? Math.min(maxBars, autoBarsPerLine(usableUnits, score, minimumBar)) : Math.min(4, Math.max(1, barsPerLine));
    // A score shorter than a full Auto line is not stretched to fill it: one system at Verovio's natural width, centred.
    const fullLine = Math.max(1, Math.min(AUTO_BAR_CAP, Math.floor((Math.max(240, usableUnits) - 56) / minimumBar)));
    const short = mode === 'portrait' && !explicit && count < fullLine;
    const view: ViewSpec = { breakEvery: endlessSingle ? 0 : bars, hiddenStaves, chordSymbols: showChordSymbols, spelling };
    // A bar never gets narrower than its minimum (the system is width-fitted instead); explicit counts are not stretched
    // past a comfortable width, so their systems stay narrower than the viewport and are centred.
    const least = systemMinimumWidth(bars, barFloor);
    const most = explicit ? bars * barFloor * 2 + 120 : Infinity;
    return { zoom: scale, bars, centred: explicit || short, natural: short, view, pageCount: endlessSingle ? 1 : Math.ceil(measureTotal / bars),
      firstWidth: Math.max(least, Math.min(most, usableUnits)), restWidth: Math.max(least, Math.min(most, restUnits)) };
  };
  const probe = async (layout: Layout, natural = false) => {
    const result = await probeVerovio(source, ticket, layout.view, natural ? verovioOptions(layout.firstWidth, true) : verovioOptions(layout.firstWidth), layout.bars);
    if (!isCurrent()) throw superseded();
    return result.svg;
  };
  const restOptions = (layout: Layout) => verovioOptions(mode === 'landscape' ? 100000 : layout.restWidth);
  /** Serialize pages of the whole layout; `pages` are one-based. */
  const fetchPages = async (layout: Layout, pages: number[]) => {
    if (!pages.length) return new Map<number, string>();
    const result = await renderVerovioPages(source, ticket, layout.view, restOptions(layout), pages);
    return new Map(result.pages.map(item => [item.page, item.svg]));
  };

  // 'fit' (the default zoom): Endless uses the device cap; Vertical fits DEFAULT_VERTICAL_BARS bars across the first
  // system, so Auto yields that many per line. The stave size depends on the viewport, not the score length: a shorter
  // score gets a shorter, centred system at the same size. Many staves are height-fitted below either.
  const fitCap = mode === 'landscape' ? options.fitCap ?? 1 : barFitZoom(viewportWidth, DEFAULT_VERTICAL_BARS, barFloor, layoutGutter);
  const heightFit = (naturalHeight: number) => visibleParts.length > HEIGHT_FIT_STAVES && availableHeight > 0 ? Math.min(fitCap, availableHeight / naturalHeight) : fitCap;
  const eager = mode === 'landscape' ? endlessSingle || visibleParts.length * count <= EAGER_STAFF_MEASURES : visibleParts.length * count <= EAGER_STAFF_MEASURES;

  // Choose the layout. Vertical draws its first system from a probe of the first measures (cheap at any score length):
  // a short score as one natural-width system, a many-staff stack measured for the height fit, and Auto bars reduced
  // while the first line still wraps. Endless lays out the whole score.
  let layout: Layout;
  /** Page SVG by system index (a Vertical system 0 comes from the probe; system k >= 1 is page k + 1 of the whole layout). */
  let fetched = new Map<number, string>();
  let single = false;
  const scroller = container.closest<HTMLElement>('.score-viewport');
  const countOf = (candidate: Layout) => single ? 1 : candidate.pageCount;
  const pageOf = (system: number) => system + 1;
  const systemFor = (candidate: Layout, index: number) => single || endlessSingle ? 0 : Math.max(0, Math.min(countOf(candidate) - 1, Math.floor(index / candidate.bars)));
  // Which systems to draw before the first paint: all of them for a small score; otherwise those in view (from the
  // first system's size) and the zoom anchor's.
  const initialSystems = (candidate: Layout): number[] => {
    const total = countOf(candidate);
    if (eager) return Array.from({ length: total }, (_, index) => index);
    const wanted = new Set<number>([0]);
    if (options.focusMeasure !== undefined) { const focus = systemFor(candidate, options.focusMeasure); for (const index of [focus - 1, focus, focus + 1]) if (index >= 0 && index < total) wanted.add(index); }
    const sample = fetched.get(0);
    if (scroller && sample) {
      const zoomGuess = mode === 'landscape' ? candidate.zoom : Math.min(candidate.zoom, viewportWidth / Math.max(1, candidate.restWidth));
      const step = (mode === 'landscape' ? naturalWidthOf(sample) : naturalHeightOf(sample)) * zoomGuess || 1;
      const view = scroller.getBoundingClientRect(), own = container.getBoundingClientRect();
      const from = mode === 'landscape' ? view.left - own.left : view.top - own.top;
      const size = mode === 'landscape' ? scroller.clientWidth : scroller.clientHeight;
      const firstIndex = Math.max(0, Math.floor(from / step));
      const lastIndex = Math.min(total - 1, Math.ceil((from + size) / step));
      // At the top the first system (from the probe) is enough for the first paint; the rest of the view needs the
      // whole score's layout and is drawn right after. Scrolled further down, the systems in view are drawn first.
      if (firstIndex > 0) for (let index = firstIndex; index <= lastIndex; index++) wanted.add(index);
    }
    return [...wanted].sort((a, b) => a - b);
  };

  if (mode === 'landscape') {
    layout = layoutAt(zoom === 'fit' ? fitCap : zoom);
    // Endless: the first pages fix the zoom ('fit' fits the tallest drawn stack), then the rest follow the same scale.
    // A zoom anchor's chunk is drawn too, so the reader's place can be restored from its measure.
    const focus = options.focusMeasure !== undefined ? systemFor(layout, options.focusMeasure) : -1;
    const wanted = eager ? Array.from({ length: layout.pageCount }, (_, index) => index) : [...new Set([0, 1, focus])].filter(index => index >= 0 && index < layout.pageCount);
    const pages = await fetchPages(layout, wanted.map(pageOf));
    if (!isCurrent()) throw superseded();
    fetched = new Map([...pages].map(([page, svg]) => [page - 1, svg]));
    if (zoom === 'fit') layout.zoom = Math.round(heightFit(Math.max(...[...fetched.values()].map(naturalHeightOf))) * 1000) / 1000;
  } else {
    layout = layoutAt(zoom === 'fit' ? Math.max(options.fitFloor ?? 0, fitCap) : zoom);
    let firstSvg = '';
    if (layout.natural) {
      firstSvg = await probe(layout, true);
      single = !wraps(firstSvg) && naturalWidthOf(firstSvg) <= layout.firstWidth + .5;
    }
    if (!single) {
      firstSvg = await probe(layout);
      // Vertical: the bar fit; many staves then measure the first system there and lay out again at the height fit.
      // The readability floor wins over both, so a compact default never draws an unreadably small staff.
      if (zoom === 'fit' && visibleParts.length > HEIGHT_FIT_STAVES) {
        const fitted = Math.max(options.fitFloor ?? 0, Math.round(heightFit(naturalHeightOf(firstSvg)) * 1000) / 1000);
        if (fitted < layout.zoom - .001) { layout = layoutAt(fitted); firstSvg = await probe(layout); }
      }
    }
    for (let attempt = 0; ; attempt++) {
      // The bar-width model is an estimate: while Verovio still wraps an Auto line inside a page, lay out with one bar fewer.
      while (!single && barsPerLine === 'auto' && layout.bars > 1 && wraps(firstSvg)) { layout = layoutAt(layout.zoom, layout.bars - 1); firstSvg = await probe(layout); }
      fetched = new Map([[0, firstSvg]]);
      if (single) break;
      const pages = await fetchPages(layout, initialSystems(layout).filter(index => index > 0).map(pageOf));
      if (!isCurrent()) throw superseded();
      for (const [page, svg] of pages) fetched.set(page - 1, svg);
      if (barsPerLine !== 'auto' || layout.bars <= 1 || ![...pages.values()].some(wraps) || attempt >= 8) break;
      layout = layoutAt(layout.zoom, layout.bars - 1);
      firstSvg = await probe(layout);
    }
  }
  const systemCount = countOf(layout);
  const systemOfMeasure = (index: number) => systemFor(layout, index);
  if (!isCurrent()) throw superseded();
  if (!fetched.size) throw new Error('Verovio did not produce a score page.');

  const textFont = options.textFont || 'Sans';
  const parseSvg = (text: string): SVGSVGElement => {
    const svg = sanitizeSvg(parseXml(text));
    const viewBox = (svg.getAttribute('viewBox') || '0 0 1000 200').split(/\s+/).map(Number);
    // Pin the inner drawing so extending the outer viewBox for annotation lanes never rescales it.
    const inner = svg.querySelector(':scope > svg.definition-scale');
    if (inner) { inner.setAttribute('width', String(viewBox[2] || 1000)); inner.setAttribute('height', String(viewBox[3] || 200)); }
    svg.classList.add('score-svg');
    svg.dataset.textFont = textFont;
    svg.dataset.musicFont = options.font || 'Bravura';
    return svg;
  };
  /**
   * A large score's first paint draws the first system (and a zoom anchor's); other systems fetched with it are kept as
   * text and drawn by the pump one per task, so no main-thread task parses and measures several large systems at once.
   */
  const focusSystem = options.focusMeasure !== undefined ? systemFor(layout, options.focusMeasure) : -1;
  const stash = new Map<number, string>();
  if (!eager) for (const [index, text] of fetched) if (index !== 0 && index !== focusSystem) { stash.set(index, text); fetched.delete(index); }
  // Parse (and sanitize) the systems drawn now, then yield before inserting and measuring them.
  const parsed = new Map([...fetched].map(([index, text]) => [index, parseSvg(text)]));
  fetched.clear();
  if (!eager) {
    await yieldTask();
    if (!isCurrent()) throw superseded();
  }
  liveResults.get(container)?.dispose();

  // Build every block; drawn systems get their SVG, the rest stay placeholders until they scroll near.
  const slots: Slot[] = Array.from({ length: systemCount }, (_, index) => {
    const block = document.createElement('div');
    block.className = 'score-system is-pending';
    block.dataset.system = String(index);
    const firstMeasure = single || endlessSingle ? 0 : index * layout.bars;
    block.dataset.firstMeasure = String(firstMeasure + 1);
    const slot: Slot = { index, block, naturalWidth: 0, naturalHeight: 0, estimated: true, scale: 1, firstMeasure, measureCount: single || endlessSingle ? count : Math.min(layout.bars, measureTotal - firstMeasure), bands: new Map(), points: [], measures: [] };
    // A fetched system not drawn yet is sized from its laid-out SVG rather than estimated.
    const text = stash.get(index);
    const width = text ? naturalWidthOf(text) : Infinity;
    if (text && Number.isFinite(width)) { slot.naturalWidth = width; slot.naturalHeight = naturalHeightOf(text); slot.estimated = false; }
    return slot;
  });
  const attach = (slot: Slot, source: string | SVGSVGElement) => {
    const svg = typeof source === 'string' ? parseSvg(source) : source;
    const viewBox = (svg.getAttribute('viewBox') || '0 0 1000 200').split(/\s+/).map(Number);
    slot.svg = svg; slot.naturalWidth = viewBox[2] || 1000; slot.naturalHeight = viewBox[3] || 200; slot.estimated = false;
    slot.block.classList.remove('is-pending');
    slot.block.replaceChildren(svg);
  };
  const fragment = document.createDocumentFragment();
  for (const slot of slots) {
    const svg = parsed.get(slot.index);
    if (svg) attach(slot, svg);
    fragment.appendChild(slot.block);
  }
  parsed.clear();
  container.replaceChildren(fragment);

  const measureIndexById = new Map(info.measureIds.map((id, index) => [id, index]));
  const pointsById = new Map<string, NotePoint>();
  const measuresByIndex = new Map<number, MeasureGeometry>();
  /** Staff bands, lanes, note and measure boxes of a drawn system, in its natural (Verovio) units. */
  const measureGeometry = (slot: Slot) => {
    const svg = slot.svg!;
    slot.bands = new Map();
    // Nothing below changes layout until the annotation layer is appended, so the root matrix is read once.
    let inverse: DOMMatrix | null = null;
    try { inverse = svg.getScreenCTM()?.inverse() ?? null; } catch { /* not rendered */ }
    const boxOf = (element: Element) => box(element, svg, inverse);
    // Staff bands from the first measure of the system, keyed by staff number.
    const measureElements = Array.from(svg.querySelectorAll('g.measure'));
    for (const staff of Array.from(measureElements[0]?.querySelectorAll(':scope > g.staff') || [])) {
      const n = staff.getAttribute('data-n'); if (!n) continue;
      const lines = Array.from(staff.querySelectorAll(':scope > path')).slice(0, 5).map(line => boxOf(line));
      const rect = lines.length ? null : boxOf(staff);
      const top = lines.length ? Math.min(...lines.map(line => line.y)) : rect!.y;
      const bottom = lines.length ? Math.max(...lines.map(line => line.y + line.height)) : rect!.y + rect!.height;
      slot.bands.set(n, { top, bottom, center: (top + bottom) / 2, laneTop: bottom, lines: lines.length > 1 });
    }
    // The lane goes below the staff and anything hanging under it: low notes, lyrics and below-staff directions.
    if (laneRows) {
      const ordered = [...slot.bands.entries()].sort((a, b) => a[1].top - b[1].top);
      const controls = Array.from(svg.querySelectorAll('g.measure > g.dynam, g.measure > g.hairpin, g.measure > g.dir, g.measure > g.pedal')).map(control => boxOf(control));
      ordered.forEach(([n, band], index) => {
        const nextTop = ordered[index + 1]?.[1].top ?? Infinity;
        let lowest = band.bottom;
        // Staff content includes ledger-line notes, stems, articulations and lyrics.
        for (const staff of Array.from(svg.querySelectorAll(`g.staff[data-n="${CSS.escape(n)}"]`))) lowest = Math.max(lowest, boxOf(staff).bottom);
        for (const rect of controls) if (rect.height && rect.top >= band.bottom - 2 && rect.top < band.bottom + (nextTop - band.bottom) / 2) lowest = Math.max(lowest, rect.bottom);
        band.laneTop = lowest + LANE_GAP;
      });
    }
    const byId = new Map<string, Element>();
    for (const element of Array.from(svg.querySelectorAll('[id]'))) byId.set(element.id, element);
    const svgMeasureByIndex = new Map<number, Element>();
    const measureRects: { index: number; element: Element; rect: DOMRect }[] = [];
    measureElements.forEach((element, local) => {
      const index = measureIndexById.get(element.getAttribute('id') || '') ?? -1;
      if (index < 0) return;
      svgMeasureByIndex.set(index, element);
      measureRects.push({ index, element, rect: boxOf(element) });
      if (!local) slot.firstMeasure = index;
    });
    slot.measureCount = svgMeasureByIndex.size || slot.measureCount;
    slot.block.dataset.firstMeasure = String(slot.firstMeasure + 1);
    const layer = document.createElementNS(SVG, 'g');
    layer.setAttribute('class', 'reader-annotations');
    let laneBottom = 0;
    const notes: { element: Element; event: ScoreNote; partIndex: number; measure: number; x: number; y: number }[] = [];
    for (const part of visibleParts) {
      const partIndex = visibleIndex.get(part.id)!;
      const band = slot.bands.get(staffOf.get(part.id) || '');
      for (const [measureIndex, svgMeasure] of svgMeasureByIndex) {
        const measure = part.measures[measureIndex]?.index === measureIndex ? part.measures[measureIndex] : part.measures.find(item => item.index === measureIndex);
        if (!measure) continue;
        for (const event of measure.notes) {
          const element = findNote(byId, score, event);
          if (!element || !svgMeasure.contains(element)) continue;
          const anchor = element.querySelector('.notehead') || element;
          const rect = boxOf(anchor); const x = rect.x + rect.width / 2; const y = rect.y + rect.height / 2;
          element.classList.add('reader-note'); element.setAttribute('data-note-id', event.id);
          notes.push({ element, event, partIndex, measure: measure.index, x, y });
          if (!band) continue;
          const labelled = part.clef !== 'percussion';
          if (showNames && labelled) [...event.pitches].sort((a, b) => b.midi - a.midi).forEach((pitch, row) => annotation(layer, 'note-label', x, band.laneTop + LANE_ROW * (row + 1) - 4, pitch.step));
          if (showCounts) annotation(layer, 'count-label', x, band.laneTop + LANE_ROW * (nameRows + 1) - 4, beatLabel(event.start, subdivisions));
          if (laneRows) laneBottom = Math.max(laneBottom, band.laneTop + laneRows * LANE_ROW + 2);
          if (showChordSymbols && inferChordSymbols && !event.chordSymbol && labelled) {
            // Inferred names follow the view's key like the engraved chord symbols.
            const chord = inferChordSymbol(event.pitches); if (chord) annotation(layer, 'chord-symbol', x, band.top - 20, score.pitchView ? spellChordSymbol(chord, measureKey(part, measure, score)) : chord);
          }
        }
      }
    }
    svg.appendChild(layer);
    if (laneBottom > slot.naturalHeight) {
      slot.naturalHeight = Math.ceil(laneBottom + 4);
      const viewBox = (svg.getAttribute('viewBox') || '').split(/\s+/).map(Number);
      svg.setAttribute('viewBox', `${viewBox[0] || 0} ${viewBox[1] || 0} ${slot.naturalWidth} ${slot.naturalHeight}`);
    }
    return { notes, measureRects };
  };

  // Staff controls scale with the first system's staves, and the first system fits beside the controls' gutter.
  const first = slots[0];
  const firstGeometry = measureGeometry(first);
  const firstBands = visibleParts.map(part => first.bands.get(staffOf.get(part.id) || '')).filter((band): band is StaffBand => !!band);
  const lined = firstBands.find(band => band.lines);
  const staffNatural = lined ? lined.bottom - lined.top : 72;
  const centers = firstBands.map(band => band.center).sort((a, b) => a - b);
  const pitchNatural = centers.slice(1).reduce((least, center, index) => Math.min(least, center - centers[index]), Infinity);
  // Systems draw at the stave scale; a portrait system is only width-fitted when its bars cannot fit at their minimum width.
  const widthLimitFor = (index: number, gutter: number) => index === 0 ? Math.max(180, viewportWidth - gutter) : viewportWidth;
  const scaleFor = (slot: Slot, gutter: number) => mode === 'portrait' ? Math.min(layout.zoom, widthLimitFor(slot.index, gutter) / slot.naturalWidth) : layout.zoom;
  let gutter = layoutGutter(layout.zoom);
  if (options.gutterFor) {
    // Gutter grows with the staff while a wider gutter shrinks a width-fitted staff; damped iteration settles in a few steps.
    for (let step = 0; step < 12; step++) {
      const scale = scaleFor(first, gutter);
      const next = options.gutterFor(staffNatural * scale, pitchNatural * scale);
      if (Math.abs(next - gutter) < .5) { gutter = next; break; }
      gutter = step < 2 ? next : (gutter + next) / 2;
    }
    gutter = Math.round(gutter);
  }

  /** Size estimate for a placeholder: Vertical systems span the layout width; heights follow the latest drawn system. */
  let reference = first;
  const estimate = (slot: Slot) => {
    if (mode === 'portrait') { slot.naturalWidth = Math.round(layout.restWidth); slot.naturalHeight = reference.naturalHeight; }
    else { slot.naturalWidth = first.naturalWidth * slot.measureCount / Math.max(1, first.measureCount); slot.naturalHeight = first.naturalHeight; }
  };
  /** Size and place a block; a size change above the viewport keeps the reader's place. */
  const place = (slot: Slot, keepPlace: boolean) => {
    if (slot.estimated) estimate(slot);
    const scale = slot.scale = scaleFor(slot, gutter);
    const { block } = slot;
    const width = slot.naturalWidth * scale, height = slot.naturalHeight * scale;
    const before = keepPlace && scroller ? block.getBoundingClientRect() : null;
    const view = before ? scroller!.getBoundingClientRect() : null;
    const oldSize = before ? (mode === 'landscape' ? before.width : before.height) : 0;
    block.style.width = `${width}px`;
    block.style.height = `${height}px`;
    const minLeft = slot.index === 0 ? gutter : 0;
    // Portrait systems end flush with the viewport; explicit bar counts and short scores narrower than it are centred.
    const left = mode === 'landscape' ? minLeft : layout.centred ? Math.max(minLeft, (viewportWidth - width) / 2) : Math.max(minLeft, viewportWidth - width);
    block.style.marginLeft = left ? `${Math.floor(left)}px` : '';
    if (slot.svg) { slot.svg.style.width = `${width}px`; slot.svg.style.height = `${height}px`; }
    if (before && view) {
      const delta = (mode === 'landscape' ? width : height) - oldSize;
      const above = mode === 'landscape' ? before.right <= view.left + 1 : before.bottom <= view.top + 1;
      if (delta && above) { if (mode === 'landscape') scroller!.scrollLeft += delta; else scroller!.scrollTop += delta; }
    }
  };
  /** Scaled note and measure geometry of a drawn system, indexed for lookups. */
  const record = (slot: Slot, geometry: ReturnType<typeof measureGeometry>) => {
    const { scale, block } = slot;
    const blockTop = block.offsetTop;
    slot.measures = geometry.measureRects.map(({ index, element, rect }) => ({ index, system: slot.index, x: rect.x * scale, width: rect.width * scale, y: blockTop + rect.y * scale, height: rect.height * scale, element }));
    slot.points = geometry.notes.map(note => ({ id: note.event.id, measure: note.measure, part: note.partIndex, start: note.event.start, duration: note.event.duration, rest: note.event.rest, x: note.x * scale, y: blockTop + note.y * scale, element: note.element, sourceId: note.event.sourceId, system: slot.index }));
    for (const measure of slot.measures) measuresByIndex.set(measure.index, measure);
    for (const point of slot.points) pointsById.set(point.id, point);
  };
  const release = (slot: Slot) => {
    if (!slot.svg) return;
    for (const measure of slot.measures) if (measuresByIndex.get(measure.index) === measure) measuresByIndex.delete(measure.index);
    for (const point of slot.points) if (pointsById.get(point.id) === point) pointsById.delete(point.id);
    slot.points = []; slot.measures = []; slot.svg = undefined;
    slot.block.replaceChildren();
    slot.block.classList.add('is-pending');
  };

  // Geometry of the systems drawn now (each needs the gutter, which needs the first), then sizes for all blocks.
  const drawn = slots.filter(slot => slot.svg);
  const geometries = new Map(drawn.map(slot => [slot, slot === first ? firstGeometry : measureGeometry(slot)]));
  const rest = drawn.find(slot => slot.index > 0);
  if (rest) reference = rest;
  for (const slot of slots) place(slot, false);
  for (const [slot, geometry] of geometries) record(slot, geometry);

  let disposed = false;
  const listeners = new Set<() => void>();
  let notifyQueued = false;
  const notify = () => {
    if (notifyQueued) return;
    notifyQueued = true;
    queueMicrotask(() => { notifyQueued = false; if (!disposed) for (const listener of listeners) listener(); });
  };
  const alive = () => !disposed && isCurrent();

  // On-demand drawing: an observer marks systems near the viewport, a pump draws them nearest first (a couple of pages
  // per worker request, one system per task), and systems far away are released back to placeholders.
  const near = new Set<number>();
  let pumping = false;
  const distance = (slot: Slot) => {
    if (!scroller) return slot.index;
    const view = scroller.getBoundingClientRect(), rect = slot.block.getBoundingClientRect();
    return mode === 'landscape' ? Math.abs((rect.left + rect.right) / 2 - (view.left + view.right) / 2) : Math.abs((rect.top + rect.bottom) / 2 - (view.top + view.bottom) / 2);
  };
  const draw = async (wanted: Slot[]) => {
    // A Vertical first system is laid out beside the staff controls, so it comes from the first-measures probe again.
    const reprobe = mode === 'portrait' && wanted.some(slot => slot.index === 0);
    // Systems fetched for the first paint but not drawn then are drawn from their kept SVG.
    const kept = new Map<number, string>();
    for (const slot of wanted) { const text = stash.get(slot.index); if (text) { kept.set(pageOf(slot.index), text); stash.delete(slot.index); } }
    const pages = await fetchPages(layout, wanted.filter(slot => !(reprobe && slot.index === 0) && !kept.has(pageOf(slot.index))).map(slot => pageOf(slot.index)));
    for (const [page, text] of kept) pages.set(page, text);
    if (reprobe) pages.set(pageOf(0), await probe(layout, single));
    for (const slot of wanted) {
      const text = pages.get(pageOf(slot.index));
      if (!alive()) return;
      if (!text || slot.svg) continue;
      attach(slot, text);
      const geometry = measureGeometry(slot);
      if (slot.index > 0 && mode === 'portrait') reference = slot;
      place(slot, true);
      record(slot, geometry);
      notify();
      await yieldTask();
    }
  };
  /**
   * A superseded draw means another render or another score's import owns the worker now. Drawing pauses rather than
   * retrying at once (the rejection can come back in the same microtask turn, which would starve the event loop) and
   * tries again later a bounded number of times, in case this score stays on screen (for example a failed import).
   */
  let supersededDraws = 0;
  let stalled = false;
  let retryTimer = 0;
  const SUPERSEDED_RETRIES = 4;
  const load = (wanted: Slot[]) => {
    const promise = draw(wanted).then(() => { supersededDraws = 0; }, error => {
      if (isSuperseded(error)) { stalled = true; return; }
      if (!alive()) return;
      for (const slot of wanted) if (!slot.svg) slot.failed = true;
      console.warn('Could not draw a score system:', error);
    });
    for (const slot of wanted) slot.loading = promise.finally(() => { slot.loading = undefined; });
    return promise;
  };
  const pump = async () => {
    if (pumping || !alive()) return;
    pumping = true;
    try {
      while (alive()) {
        const pendingSlots = [...near].map(index => slots[index]).filter(slot => !slot.svg && !slot.loading && !slot.failed);
        if (!pendingSlots.length) break;
        pendingSlots.sort((a, b) => distance(a) - distance(b));
        await load(pendingSlots.slice(0, PAGE_BATCH));
        if (stalled) {
          stalled = false;
          if (++supersededDraws <= SUPERSEDED_RETRIES) retryTimer = window.setTimeout(() => void pump(), 1000 * supersededDraws);
          break;
        }
      }
    } finally { pumping = false; }
  };
  const observers: IntersectionObserver[] = [];
  let observeTimer = 0;
  if (!eager && systemCount > 1 && typeof IntersectionObserver !== 'undefined') {
    const margin = (screens: number) => mode === 'landscape' ? `0px ${screens * 100}%` : `${screens * 100}% 0px`;
    const nearObserver = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const index = Number((entry.target as HTMLElement).dataset.system);
        if (entry.isIntersecting) near.add(index); else near.delete(index);
      }
      void pump();
    }, { root: scroller, rootMargin: margin(NEAR_SCREENS) });
    const keepObserver = new IntersectionObserver(entries => {
      let released = false;
      for (const entry of entries) {
        if (entry.isIntersecting) continue;
        const slot = slots[Number((entry.target as HTMLElement).dataset.system)];
        if (slot?.svg && !slot.loading) { release(slot); released = true; }
      }
      if (released) notify();
    }, { root: scroller, rootMargin: margin(KEEP_SCREENS) });
    observers.push(nearObserver, keepObserver);
    // Observing thousands of blocks (and their first callbacks) is real work: it starts after the first paint's task,
    // a batch per task, nearest the start first.
    const OBSERVE_BATCH = 1500;
    const observeFrom = (start: number) => {
      observeTimer = 0;
      if (disposed) return;
      for (const slot of slots.slice(start, start + OBSERVE_BATCH)) { nearObserver.observe(slot.block); keepObserver.observe(slot.block); }
      if (start + OBSERVE_BATCH < slots.length) observeTimer = window.setTimeout(() => observeFrom(start + OBSERVE_BATCH), 0);
    };
    observeTimer = window.setTimeout(() => observeFrom(0), 0);
  }

  const firstSystem = (): SystemGeometry => geometryOf(first);
  const geometryOf = (slot: Slot): SystemGeometry => ({ index: slot.index, firstMeasure: slot.firstMeasure, measureCount: slot.measureCount, width: slot.naturalWidth * slot.scale, height: slot.naturalHeight * slot.scale, rendered: !!slot.svg,
    staffCenters: visibleParts.map(part => (slot.bands.get(staffOf.get(part.id) || '')?.center ?? (slot.svg ? NaN : first.bands.get(staffOf.get(part.id) || '')?.center ?? NaN)) * slot.scale) });
  const head = firstSystem();
  const firstCenters = head.staffCenters.map((center, index) => Number.isFinite(center) ? center : (head.staffCenters[index - 1] ?? 0) + 80 * first.scale);
  const result: RenderResult = {
    systemSize: layout.bars, staffCenters: firstCenters, scale: first.scale, visiblePartIds: visibleParts.map(part => part.id),
    barWidth: Math.max(1, head.width) / Math.max(1, head.measureCount || layout.bars), systemHeight: head.height,
    stavePx: staffNatural * first.scale, staffPitchPx: pitchNatural * first.scale, gutter, zoom: layout.zoom,
    get systems() { return slots.map(geometryOf); },
    get points() { return slots.flatMap(slot => slot.points); },
    get measures() { return slots.flatMap(slot => slot.measures); },
    point: id => pointsById.get(id),
    measure: index => measuresByIndex.get(index),
    systemOfMeasure,
    ensureSystem: async index => {
      const slot = slots[index];
      if (!slot || slot.svg || !alive()) return;
      slot.failed = false;
      await (slot.loading || load([slot]));
    },
    onChange: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      window.clearTimeout(retryTimer);
      window.clearTimeout(observeTimer);
      for (const observer of observers) observer.disconnect();
      listeners.clear();
      if (liveResults.get(container) === result) liveResults.delete(container);
    },
  };
  liveResults.set(container, result);
  return result;
}
