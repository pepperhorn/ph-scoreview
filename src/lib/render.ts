import type { Part, Score, ScoreNote } from './score';
import { inferChordSymbol } from './chords';
import { importVerovio, renderVerovio } from './verovio-runtime';
import { staffDefXmlId } from './notation/document';
import { musicFontOptions } from './music-fonts';
import { DEFAULT_VERTICAL_BARS, HEIGHT_FIT_STAVES, STAVE_SCALE_FLOOR, STAVE_SCALE_MAX } from './stave-scale';

const MEI = 'http://www.music-encoding.org/ns/mei';
const XML = 'http://www.w3.org/XML/1998/namespace';
const SVG = 'http://www.w3.org/2000/svg';

export type NotePoint = { id: string; measure: number; part: number; start: number; duration: number; rest?: boolean; x: number; y: number; element?: Element; sourceId?: string };
export type MeasureGeometry = { index: number; system: number; x: number; width: number; y: number; height: number; element?: Element };
export type SystemGeometry = { index: number; firstMeasure: number; measureCount: number; width: number; height: number; staffCenters: number[] };
export type RenderResult = { points: NotePoint[]; measureStarts: number[]; systemSize: number; staffCenters: number[]; scale: number; barWidth: number; systemHeight: number; measures: MeasureGeometry[]; systems: SystemGeometry[]; visiblePartIds: string[];
  /** Rendered five-line staff height (px) of the first system, the unit staff controls are sized from. */
  stavePx: number;
  /** Smallest distance between adjacent staff centres in the first system (px); Infinity for one staff. */
  staffPitchPx: number;
  /** Left gutter reserved for staff controls before the first system (px). */
  gutter: number;
  /** Stave scale the score was laid out at (px per Verovio unit); the resolved value when 'fit' was requested. */
  zoom: number };
export type RenderOptions = { font?: 'Bravura' | 'Petaluma'; textFont?: 'Sans' | 'Serif' | 'Mono'; transpose?: number; semitones?: number; scorePitch?: 'written' | 'concert'; generation?: number; hiddenPartIds?: string[];
  /**
   * Control gutter for a rendered staff height and staff pitch (px). The layout reserves the gutter for a
   * staff of `STAFF_UNITS * zoom` px before rendering; the final gutter uses the measured staves.
   */
  gutterFor?: (stavePx: number, staffPitchPx: number) => number;
  /** Endless 'fit' zoom (the device's Endless default); a many-staff stack is height-fitted below it. Vertical 'fit' ignores it. */
  fitCap?: number;
  /** Vertical 'fit' is never below this stave scale (compact readability floor); the stack then scrolls. */
  fitFloor?: number };

const latestGeneration = new WeakMap<HTMLElement, number>();
/** Endless view keeps one unbroken system up to this many bars, then uses bounded chunks. */
const ENDLESS_SINGLE_SYSTEM_LIMIT = 160;
const ENDLESS_CHUNK = 120;
const LANE_GAP = 6;
const LANE_ROW = 17;

export function portraitMinimumBarWidth(score: Score): number {
  let busiest = 4; let lyrics = 0;
  for (const part of score.parts) for (const measure of part.measures) {
    busiest = Math.max(busiest, measure.notes.length);
    lyrics = Math.max(lyrics, measure.notes.filter(note => note.lyric).length);
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
const lyricCache = new Map<string, number>();
/** Most lyric syllables in any one staff-measure of the engraving (per verse line). */
function engravedLyricDensity(baseline: string): number {
  let density = lyricCache.get(baseline);
  if (density !== undefined) return density;
  density = 0;
  for (const staff of nodes(parseXml(baseline), 'staff')) {
    const verses = nodes(staff, 'verse');
    if (!verses.length) continue;
    const lines = new Set(verses.map(verse => verse.getAttribute('n') || '1')).size;
    density = Math.max(density, Math.ceil(verses.length / lines));
  }
  lyricCache.set(baseline, density);
  while (lyricCache.size > 2) lyricCache.delete(lyricCache.keys().next().value!);
  return density;
}

function parseXml(text: string): XMLDocument {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const error = doc.querySelector('parsererror');
  if (error) throw new Error(`Could not parse Verovio output: ${error.textContent?.slice(0, 180)}`);
  return doc;
}
function nodes(root: Document | Element, name: string): Element[] { return Array.from(root.getElementsByTagNameNS(MEI, name)); }
const xmlIdOf = (element: Element) => element.getAttributeNS(XML, 'id') || element.getAttribute('xml:id') || '';

/** Bounding box of an element in the outer SVG's user (viewBox) coordinates. */
function box(element: Element, svg: SVGSVGElement): DOMRect {
  try {
    const graphics = element as SVGGraphicsElement;
    const rect = graphics.getBBox();
    const root = svg.getScreenCTM(); const own = graphics.getScreenCTM();
    const transform = root && own ? root.inverse().multiply(own) : new DOMMatrix();
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
function staffNumbers(doc: XMLDocument, score: Score): { byPart: Map<string, string>; engraved: string[] } {
  const scoreDef = nodes(doc, 'scoreDef')[0];
  const defs = scoreDef ? nodes(scoreDef, 'staffDef') : [];
  const engraved = [...new Set(defs.map(def => def.getAttribute('n') || '').filter(Boolean))];
  const groups = scoreDef ? nodes(scoreDef, 'staffGrp') : [];
  const identity = score.document?.identity?.staffIdToSource || {};
  const byPart = new Map<string, string>();
  const claimed = new Set<string>();
  const claim = (part: Part, def?: Element) => {
    const n = def?.getAttribute('n');
    if (!n || claimed.has(n)) return false;
    byPart.set(part.id, n); claimed.add(n); return true;
  };
  for (const part of score.parts) {
    const legacy = /^(.*)-(\d+)$/.exec(part.id);
    const source = identity[part.id] || (legacy ? { partId: legacy[1], staff: Number(legacy[2]) } : { partId: part.id, staff: 1 });
    if (claim(part, defs.find(def => [part.id, staffDefXmlId(part.id)].includes(xmlIdOf(def))))) continue;
    const group = groups.find(item => xmlIdOf(item) === source.partId);
    if (group && claim(part, Array.from(group.children).filter(child => child.localName === 'staffDef')[source.staff - 1])) continue;
    if (source.staff === 1 && claim(part, defs.find(def => xmlIdOf(def) === source.partId))) continue;
    if (score.document?.format === 'mei' || score.document?.engravingFormat === 'mei') claim(part, defs.find(def => def.getAttribute('n') === part.id));
  }
  // Positional fallback only when the remaining parts and staves correspond one to one.
  const unmappedParts = score.parts.filter(part => !byPart.has(part.id));
  const unclaimed = engraved.filter(n => !claimed.has(n));
  if (unmappedParts.length && unmappedParts.length === unclaimed.length) unmappedParts.forEach((part, index) => { byPart.set(part.id, unclaimed[index]); claimed.add(unclaimed[index]); });
  return { byPart, engraved };
}

/** Remove staves by number, including later staffDefs, staff-bound control events and spans into removed content. */
function hideStaves(doc: XMLDocument, hidden: Set<string>): void {
  if (!hidden.size) return;
  const removed = new Set<string>();
  const drop = (element: Element) => {
    for (const item of [element, ...Array.from(element.getElementsByTagName('*'))]) { const id = xmlIdOf(item); if (id) removed.add(id); }
    element.remove();
  };
  for (const element of [...nodes(doc, 'staffDef'), ...nodes(doc, 'staff')]) if (hidden.has(element.getAttribute('n') || '') && doc.contains(element)) drop(element);
  const all = Array.from(doc.getElementsByTagNameNS(MEI, '*'));
  for (const element of all) {
    if (!doc.contains(element) || !element.hasAttribute('staff')) continue;
    const tokens = (element.getAttribute('staff') || '').split(/\s+/).filter(Boolean);
    const kept = tokens.filter(token => !hidden.has(token));
    if (!kept.length && tokens.length) drop(element);
    else if (kept.length !== tokens.length) element.setAttribute('staff', kept.join(' '));
  }
  const refersToRemoved = (value: string | null) => !!value && value.split(/\s+/).some(token => removed.has(token.replace(/^#/, '')));
  for (const element of all) {
    if (!doc.contains(element)) continue;
    if (refersToRemoved(element.getAttribute('startid')) || refersToRemoved(element.getAttribute('endid'))) { drop(element); continue; }
    const plist = element.getAttribute('plist');
    if (plist && refersToRemoved(plist)) {
      const kept = plist.split(/\s+/).filter(token => !removed.has(token.replace(/^#/, '')));
      if (kept.length) element.setAttribute('plist', kept.join(' ')); else drop(element);
    }
  }
  for (const group of nodes(doc, 'staffGrp').reverse()) if (doc.contains(group) && !nodes(group, 'staffDef').length) group.remove();
}

type ViewDocument = { mei: string; measureIds: string[]; staffOf: Map<string, string>; visibleParts: Part[] };
const viewCache = new Map<string, ViewDocument>();
function viewMei(baseline: string, score: Score, breakEvery: number, hiddenIds: Set<string>, showChordSymbols: boolean): ViewDocument {
  const key = [breakEvery, showChordSymbols, [...hiddenIds].sort().join('\u0001'), score.parts.map(part => part.id).join('\u0001'), baseline].join('\u0000');
  const cached = viewCache.get(key);
  // The key covers structure only; transposed/concert views reuse it, so return this score's Part objects (their pitches differ).
  if (cached) { const current = new Map(score.parts.map(part => [part.id, part])); return { ...cached, visibleParts: cached.visibleParts.map(part => current.get(part.id) || part) }; }
  const doc = parseXml(baseline);
  const measures = nodes(doc, 'measure');
  const measureIds = measures.map(xmlIdOf);
  // Reader metadata is displayed by React; keep the imported source untouched.
  for (const head of nodes(doc, 'meiHead')) head.remove();
  if (!showChordSymbols) for (const harmony of nodes(doc, 'harm')) harmony.remove();
  // Part names and icons are drawn by the reader's staff controls, so engraved staff labels would duplicate them.
  for (const label of [...nodes(doc, 'label'), ...nodes(doc, 'labelAbbr')]) label.remove();
  for (const definition of [...nodes(doc, 'staffDef'), ...nodes(doc, 'staffGrp')]) { definition.removeAttribute('label'); definition.removeAttribute('label.abbr'); }
  for (const item of [...nodes(doc, 'sb'), ...nodes(doc, 'pb'), ...nodes(doc, 'pgHead'), ...nodes(doc, 'pgFoot')]) item.remove();
  if (breakEvery > 0) for (let index = breakEvery; index < measures.length; index += breakEvery) {
    measures[index].parentNode?.insertBefore(doc.createElementNS(MEI, 'pb'), measures[index]);
  }
  const { byPart, engraved } = staffNumbers(doc, score);
  let visibleParts = score.parts.filter(part => !hiddenIds.has(part.id) && byPart.has(part.id));
  if (!visibleParts.length) visibleParts = score.parts.filter(part => byPart.has(part.id)).slice(0, 1);
  const shown = new Set(visibleParts.map(part => byPart.get(part.id)!));
  // Staves without a Score part (for example rest-only template parts that import dropped) are hidden reversibly here.
  const hidden = shown.size ? new Set(engraved.filter(n => !shown.has(n))) : new Set<string>();
  hideStaves(doc, hidden);
  const result = { mei: new XMLSerializer().serializeToString(doc), measureIds, staffOf: byPart, visibleParts: shown.size ? visibleParts : score.parts };
  viewCache.set(key, result);
  while (viewCache.size > 6) viewCache.delete(viewCache.keys().next().value!);
  return result;
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

type StaffBand = { top: number; bottom: number; center: number; laneTop: number; lines: boolean };
type PageGeometry = { svg: SVGSVGElement; block: HTMLElement; naturalWidth: number; naturalHeight: number; bands: Map<string, StaffBand>; notes: { element: Element; event: ScoreNote; partIndex: number; measure: number; x: number; y: number }[]; measureRects: { index: number; element: Element; rect: DOMRect }[]; measureCount: number; firstMeasure: number };

/** Render from the original engraving document through the locally bundled WASM worker. */
export async function renderScore(
  container: HTMLElement, score: Score, mode: 'portrait' | 'landscape',
  showNames: boolean, showCounts: boolean, subdivisions: boolean,
  barsPerLine: 'auto' | number, showChordSymbols: boolean, inferChordSymbols: boolean,
  availableHeight = 0, zoom: number | 'fit' = 1, firstSystemGutter = 0, options: RenderOptions = {},
): Promise<RenderResult> {
  const generation = options.generation ?? (latestGeneration.get(container) || 0) + 1;
  latestGeneration.set(container, generation);
  const isCurrent = () => latestGeneration.get(container) === generation;
  if (!score.document?.engravingText) throw new Error('This score has no engraving document.');
  const { mei: baseline } = await importVerovio(score.document.engravingText);
  if (!isCurrent()) throw new Error('Superseded score render.');
  const viewportWidth = Math.max(240, container.clientWidth);
  const count = Math.max(1, score.parts[0]?.measures.length || 1);
  const endlessSingle = mode === 'landscape' && count <= ENDLESS_SINGLE_SYSTEM_LIMIT;
  const minimumBar = Math.max(portraitMinimumBarWidth(score), lyricBarWidth(engravedLyricDensity(baseline)));
  const barFloor = Math.max(190, minimumBar);
  const hiddenIds = new Set(options.hiddenPartIds || []);
  // The gutter for a staff drawn at this zoom (staff pitch is unknown before layout, so this is an upper bound).
  const layoutGutter = (scale: number) => options.gutterFor ? Math.round(options.gutterFor(STAFF_UNITS * scale, Infinity)) : firstSystemGutter;

  // Annotation lanes sit under each staff (below lyrics); reserve room for them in the engraving.
  const structure = viewMei(baseline, score, 0, hiddenIds, showChordSymbols);
  const annotated = structure.visibleParts.filter(part => part.clef !== 'percussion' || showCounts);
  const nameRows = showNames ? Math.max(1, ...annotated.flatMap(part => part.measures.flatMap(measure => measure.notes.map(note => note.pitches.length)))) : 0;
  const laneRows = nameRows + (showCounts ? 1 : 0);
  const laneHeight = laneRows ? LANE_GAP + laneRows * LANE_ROW + 4 : 0;
  const spacingStaff = Math.min(48, 12 + Math.ceil(laneHeight / 9) + (showChordSymbols && inferChordSymbols ? 2 : 0));

  const concertBasis = score.parts.some(part => part.pitchBasis === 'concert');
  const semitones = options.transpose ?? options.semitones ?? 0;
  // `natural`: one unbroken system at its natural width (Endless, and a Vertical score shorter than a full line).
  const verovioOptions = (pageWidth: number, natural = false): Record<string, unknown> => ({
    breaks: endlessSingle || natural ? 'none' : 'encoded', font: options.font || 'Bravura', fontFallback: 'Bravura',
    pageWidth: Math.min(100000, Math.max(100, Math.round(pageWidth))), pageHeight: 60000,
    pageMarginLeft: 25, pageMarginRight: 25, pageMarginTop: 20, pageMarginBottom: 20,
    adjustPageHeight: true, adjustPageWidth: mode === 'landscape' || natural, svgViewBox: true, scale: 100, xmlIdChecksum: true,
    // Verovio can only move written pitch to sounding pitch, so concert-basis scores are engraved as encoded.
    transposeToSoundingPitch: options.scorePitch === 'concert' && !concertBasis, transpose: semitones ? String(semitones) : '',
    spacingStaff, smuflTextFont: 'none', header: 'none', footer: 'none', svgAdditionalAttribute: ['staff@n', 'note@pname', 'note@oct'],
    ...musicFontOptions(options.font),
  });

  // Layout at a stave scale: Verovio lays out (viewport - gutter) / zoom units, so systems fill the viewport.
  type Layout = { zoom: number; bars: number; centred: boolean; natural: boolean; view: ViewDocument; pageCount: number; firstWidth: number; restWidth: number };
  const layoutAt = (scale: number, maxBars = Infinity): Layout => {
    const usableUnits = Math.max(180, viewportWidth - layoutGutter(scale)) / scale;
    const restUnits = viewportWidth / scale;
    const explicit = mode === 'portrait' && barsPerLine !== 'auto';
    const bars = mode === 'landscape' ? (endlessSingle ? count : ENDLESS_CHUNK) : barsPerLine === 'auto' ? Math.min(maxBars, autoBarsPerLine(usableUnits, score, minimumBar)) : Math.min(4, Math.max(1, barsPerLine));
    // A score shorter than a full Auto line is not stretched to fill it: one system at Verovio's natural width, centred.
    const fullLine = Math.max(1, Math.min(AUTO_BAR_CAP, Math.floor((Math.max(240, usableUnits) - 56) / minimumBar)));
    const short = mode === 'portrait' && !explicit && count < fullLine;
    const view = viewMei(baseline, score, endlessSingle ? 0 : bars, hiddenIds, showChordSymbols);
    // A bar never gets narrower than its minimum (the system is width-fitted instead); explicit counts are not stretched
    // past a comfortable width, so their systems stay narrower than the viewport and are centred.
    const least = systemMinimumWidth(bars, barFloor);
    const most = explicit ? bars * barFloor * 2 + 120 : Infinity;
    return { zoom: scale, bars, centred: explicit || short, natural: short, view, pageCount: endlessSingle ? 1 : Math.ceil(view.measureIds.length / bars),
      firstWidth: Math.max(least, Math.min(most, usableUnits)), restWidth: Math.max(least, Math.min(most, restUnits)) };
  };
  // 'fit' (the default zoom): Endless uses the device cap; Vertical fits DEFAULT_VERTICAL_BARS bars across the first
  // system, so Auto yields that many per line. The stave size depends on the viewport, not the score length: a shorter
  // score gets a shorter, centred system at the same size. Many staves are height-fitted below either.
  const fitCap = mode === 'landscape' ? options.fitCap ?? 1 : barFitZoom(viewportWidth, DEFAULT_VERTICAL_BARS, barFloor, layoutGutter);
  const heightFit = (naturalHeight: number) => structure.visibleParts.length > HEIGHT_FIT_STAVES && availableHeight > 0 ? Math.min(fitCap, availableHeight / naturalHeight) : fitCap;
  const renderPages = async (layout: Layout): Promise<string[]> => {
    if (mode === 'landscape') return (await renderVerovio(layout.view.mei, verovioOptions(100000))).pages.map(item => item.svg);
    // A short score is one centred system at Verovio's natural width when that fits; otherwise it fills the line.
    if (layout.natural) {
      const single = (await renderVerovio(layout.view.mei, verovioOptions(layout.firstWidth, true))).pages.map(item => item.svg);
      if (single.length === 1 && naturalWidthOf(single[0]) <= layout.firstWidth + .5) return single;
    }
    // Only the first system gives up width to the staff controls; later systems use the full viewport.
    const split = layout.pageCount > 1 && layout.firstWidth !== layout.restWidth;
    const [first, rest] = await Promise.all([
      renderVerovio(layout.view.mei, verovioOptions(layout.firstWidth), split ? [1] : undefined),
      split ? renderVerovio(layout.view.mei, verovioOptions(layout.restWidth), Array.from({ length: layout.pageCount - 1 }, (_, index) => index + 2)) : undefined,
    ]);
    return [...first.pages, ...(rest?.pages || [])].sort((a, b) => a.page - b.page).map(item => item.svg);
  };
  const naturalWidthOf = (svg: string) => Number(/viewBox="\S+\s+\S+\s+([\d.]+)/.exec(svg)?.[1]) || Infinity;
  const naturalHeightOf = (svg: string) => Number(/viewBox="[^"]*?\s([\d.]+)"/.exec(svg)?.[1]) || 1;

  let layout: Layout;
  let pages: string[];
  if (zoom !== 'fit') {
    layout = layoutAt(zoom);
    pages = await renderPages(layout);
  } else if (mode === 'landscape') {
    // Endless layout does not depend on zoom: fit the one system's height.
    layout = layoutAt(fitCap);
    pages = await renderPages(layout);
    layout.zoom = Math.round(heightFit(Math.max(...pages.map(naturalHeightOf))) * 1000) / 1000;
  } else {
    // Vertical: the bar fit; many staves then measure the first system there and lay out again at the height fit.
    // The readability floor wins over both, so a compact default never draws an unreadably small staff.
    const floor = options.fitFloor ?? 0;
    layout = layoutAt(Math.max(floor, fitCap));
    if (structure.visibleParts.length > HEIGHT_FIT_STAVES) {
      const probe = await renderVerovio(layout.view.mei, verovioOptions(layout.firstWidth), layout.pageCount > 1 && layout.firstWidth !== layout.restWidth ? [1] : undefined);
      if (!isCurrent()) throw new Error('Superseded score render.');
      const fitted = Math.max(floor, Math.round(heightFit(naturalHeightOf(probe.pages[0]?.svg || '')) * 1000) / 1000);
      if (fitted < layout.zoom - .001) layout = layoutAt(fitted);
    }
    pages = await renderPages(layout);
  }
  // The bar-width model is an estimate: if Verovio still wraps an Auto line inside a page, lay out with one bar fewer.
  const wraps = (svg: string) => (svg.match(/class="system"/g) || []).length > 1;
  while (mode === 'portrait' && barsPerLine === 'auto' && layout.bars > 1 && pages.some(wraps)) {
    if (!isCurrent()) throw new Error('Superseded score render.');
    layout = layoutAt(layout.zoom, layout.bars - 1);
    pages = await renderPages(layout);
  }
  const { bars, view: { measureIds, staffOf, visibleParts } } = layout;
  const visibleIndex = new Map(visibleParts.map((part, index) => [part.id, index]));
  if (!isCurrent()) throw new Error('Superseded score render.');
  if (!pages.length) throw new Error('Verovio did not produce a score page.');

  const fragment = document.createDocumentFragment();
  const geometry: PageGeometry[] = [];
  const textFont = options.textFont || 'Sans';
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    const svg = sanitizeSvg(parseXml(pages[pageIndex]));
    const viewBox = (svg.getAttribute('viewBox') || '0 0 1000 200').split(/\s+/).map(Number);
    const naturalWidth = viewBox[2] || 1000;
    const naturalHeight = viewBox[3] || 200;
    // Pin the inner drawing so extending the outer viewBox for annotation lanes never rescales it.
    const inner = svg.querySelector(':scope > svg.definition-scale');
    if (inner) { inner.setAttribute('width', String(naturalWidth)); inner.setAttribute('height', String(naturalHeight)); }
    svg.classList.add('score-svg');
    svg.dataset.textFont = textFont;
    svg.dataset.musicFont = options.font || 'Bravura';
    const block = document.createElement('div');
    block.className = 'score-system';
    block.appendChild(svg); fragment.appendChild(block);
    geometry.push({ svg, block, naturalWidth, naturalHeight, bands: new Map(), notes: [], measureRects: [], measureCount: 0, firstMeasure: 0 });
  }
  if (!isCurrent()) throw new Error('Superseded score render.');
  container.replaceChildren(fragment);

  const measureIndexById = new Map(measureIds.map((id, index) => [id, index]));
  for (const page of geometry) {
    const { svg } = page;
    // Staff bands from the first measure of the system, keyed by staff number.
    const measureElements = Array.from(svg.querySelectorAll('g.measure'));
    for (const staff of Array.from(measureElements[0]?.querySelectorAll(':scope > g.staff') || [])) {
      const n = staff.getAttribute('data-n'); if (!n) continue;
      const lines = Array.from(staff.querySelectorAll(':scope > path')).slice(0, 5).map(line => box(line, svg));
      const rect = lines.length ? null : box(staff, svg);
      const top = lines.length ? Math.min(...lines.map(line => line.y)) : rect!.y;
      const bottom = lines.length ? Math.max(...lines.map(line => line.y + line.height)) : rect!.y + rect!.height;
      page.bands.set(n, { top, bottom, center: (top + bottom) / 2, laneTop: bottom, lines: lines.length > 1 });
    }
    // The lane goes below the staff and anything hanging under it: low notes, lyrics and below-staff directions.
    const ordered = [...page.bands.entries()].sort((a, b) => a[1].top - b[1].top);
    ordered.forEach(([n, band], index) => {
      const nextTop = ordered[index + 1]?.[1].top ?? Infinity;
      let lowest = band.bottom;
      // Staff content includes ledger-line notes, stems, articulations and lyrics.
      for (const staff of Array.from(svg.querySelectorAll(`g.staff[data-n="${CSS.escape(n)}"]`))) lowest = Math.max(lowest, box(staff, svg).bottom);
      for (const control of Array.from(svg.querySelectorAll('g.measure > g.dynam, g.measure > g.hairpin, g.measure > g.dir, g.measure > g.pedal'))) {
        const rect = box(control, svg);
        if (rect.height && rect.top >= band.bottom - 2 && rect.top < band.bottom + (nextTop - band.bottom) / 2) lowest = Math.max(lowest, rect.bottom);
      }
      band.laneTop = lowest + LANE_GAP;
    });
    const byId = new Map<string, Element>();
    for (const element of Array.from(svg.querySelectorAll('[id]'))) byId.set(element.id, element);
    const svgMeasureByIndex = new Map<number, Element>();
    measureElements.forEach((element, local) => {
      const index = measureIndexById.get(element.getAttribute('id') || '') ?? -1;
      if (index < 0) return;
      svgMeasureByIndex.set(index, element);
      page.measureRects.push({ index, element, rect: box(element, svg) });
      if (!local) page.firstMeasure = index;
    });
    page.measureCount = svgMeasureByIndex.size;
    const layer = document.createElementNS(SVG, 'g');
    layer.setAttribute('class', 'reader-annotations');
    let laneBottom = 0;
    for (const part of visibleParts) {
      const partIndex = visibleIndex.get(part.id)!;
      const band = page.bands.get(staffOf.get(part.id) || '');
      for (const measure of part.measures) {
        const svgMeasure = svgMeasureByIndex.get(measure.index);
        if (!svgMeasure) continue;
        for (const event of measure.notes) {
          const element = findNote(byId, score, event);
          if (!element || !svgMeasure.contains(element)) continue;
          const anchor = element.querySelector('.notehead') || element;
          const rect = box(anchor, svg); const x = rect.x + rect.width / 2; const y = rect.y + rect.height / 2;
          element.classList.add('reader-note'); element.setAttribute('data-note-id', event.id);
          page.notes.push({ element, event, partIndex, measure: measure.index, x, y });
          if (!band) continue;
          const labelled = part.clef !== 'percussion';
          if (showNames && labelled) [...event.pitches].sort((a, b) => b.midi - a.midi).forEach((pitch, row) => annotation(layer, 'note-label', x, band.laneTop + LANE_ROW * (row + 1) - 4, pitch.step));
          if (showCounts) annotation(layer, 'count-label', x, band.laneTop + LANE_ROW * (nameRows + 1) - 4, beatLabel(event.start, subdivisions));
          if (laneRows) laneBottom = Math.max(laneBottom, band.laneTop + laneRows * LANE_ROW + 2);
          if (showChordSymbols && inferChordSymbols && !event.chordSymbol && labelled) {
            const chord = inferChordSymbol(event.pitches); if (chord) annotation(layer, 'chord-symbol', x, band.top - 20, chord);
          }
        }
      }
    }
    svg.appendChild(layer);
    if (laneBottom > page.naturalHeight) {
      page.naturalHeight = Math.ceil(laneBottom + 4);
      const viewBox = (svg.getAttribute('viewBox') || '').split(/\s+/).map(Number);
      svg.setAttribute('viewBox', `${viewBox[0] || 0} ${viewBox[1] || 0} ${page.naturalWidth} ${page.naturalHeight}`);
    }
  }
  if (!isCurrent()) throw new Error('Superseded score render.');

  // Staff controls scale with the first system's staves, and the first system fits beside the controls' gutter.
  const firstBands = visibleParts.map(part => geometry[0].bands.get(staffOf.get(part.id) || '')).filter((band): band is StaffBand => !!band);
  const lined = firstBands.find(band => band.lines);
  const staffNatural = lined ? lined.bottom - lined.top : 72;
  const centers = firstBands.map(band => band.center).sort((a, b) => a - b);
  const pitchNatural = centers.slice(1).reduce((least, center, index) => Math.min(least, center - centers[index]), Infinity);
  // Systems draw at the stave scale; a portrait system is only width-fitted when its bars cannot fit at their minimum width.
  const widthLimitFor = (pageIndex: number, gutter: number) => pageIndex === 0 ? Math.max(180, viewportWidth - gutter) : viewportWidth;
  const scaleFor = (page: PageGeometry, pageIndex: number, gutter: number) => mode === 'portrait' ? Math.min(layout.zoom, widthLimitFor(pageIndex, gutter) / page.naturalWidth) : layout.zoom;
  let gutter = layoutGutter(layout.zoom);
  if (options.gutterFor) {
    // Gutter grows with the staff while a wider gutter shrinks a width-fitted staff; damped iteration settles in a few steps.
    for (let step = 0; step < 12; step++) {
      const scale = scaleFor(geometry[0], 0, gutter);
      const next = options.gutterFor(staffNatural * scale, pitchNatural * scale);
      if (Math.abs(next - gutter) < .5) { gutter = next; break; }
      gutter = step < 2 ? next : (gutter + next) / 2;
    }
    gutter = Math.round(gutter);
  }

  // Size every system, then read positions (earlier heights move later blocks).
  const scales = geometry.map((page, pageIndex) => {
    const scale = scaleFor(page, pageIndex, gutter);
    const { block, svg } = page;
    block.dataset.firstMeasure = String(page.firstMeasure + 1);
    block.style.width = `${page.naturalWidth * scale}px`;
    block.style.height = `${page.naturalHeight * scale}px`;
    const width = page.naturalWidth * scale;
    const minLeft = pageIndex === 0 ? gutter : 0;
    // Portrait systems end flush with the viewport; explicit bar counts and short scores narrower than it are centred.
    const left = mode === 'landscape' ? minLeft : layout.centred ? Math.max(minLeft, (viewportWidth - width) / 2) : Math.max(minLeft, viewportWidth - width);
    block.style.marginLeft = left ? `${Math.floor(left)}px` : '';
    svg.style.width = `${page.naturalWidth * scale}px`; svg.style.height = `${page.naturalHeight * scale}px`;
    return scale;
  });

  const systems: SystemGeometry[] = [];
  const measures: MeasureGeometry[] = [];
  const points: NotePoint[] = [];
  const measureStarts: number[] = [];
  geometry.forEach((page, pageIndex) => {
    const scale = scales[pageIndex];
    const blockTop = page.block.offsetTop;
    const staffCenters = visibleParts.map(part => (page.bands.get(staffOf.get(part.id) || '')?.center ?? NaN) * scale);
    systems.push({ index: pageIndex, firstMeasure: page.firstMeasure, measureCount: page.measureCount, width: page.naturalWidth * scale, height: page.naturalHeight * scale, staffCenters });
    for (const { index, element, rect } of page.measureRects) {
      measureStarts[index] = mode === 'landscape' ? page.block.offsetLeft + rect.x * scale : blockTop + rect.x * scale;
      measures.push({ index, system: pageIndex, x: rect.x * scale, width: rect.width * scale, y: blockTop + rect.y * scale, height: rect.height * scale, element });
    }
    for (const note of page.notes) points.push({ id: note.event.id, measure: note.measure, part: note.partIndex, start: note.event.start, duration: note.event.duration, rest: note.event.rest, x: note.x * scale, y: blockTop + note.y * scale, element: note.element, sourceId: note.event.sourceId });
  });
  const first = systems[0];
  const firstCenters = first.staffCenters.map((center, index) => Number.isFinite(center) ? center : (first.staffCenters[index - 1] ?? 0) + 80 * scales[0]);
  return { points, measureStarts, systemSize: bars, staffCenters: firstCenters, scale: scales[0], visiblePartIds: visibleParts.map(part => part.id),
    barWidth: Math.max(1, first.width) / Math.max(1, first.measureCount || bars), systemHeight: first.height, measures, systems,
    stavePx: staffNatural * scales[0], staffPitchPx: pitchNatural * scales[0], gutter, zoom: layout.zoom };
}
