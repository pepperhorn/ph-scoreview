import type { Score, ScoreNote } from './score';
import { inferChordSymbol } from './chords';
import { importVerovio, renderVerovio, type VerovioTimemapEvent } from './verovio-runtime';
import { scoreToMei } from './notation/document';

const MEI = 'http://www.music-encoding.org/ns/mei';
const XML = 'http://www.w3.org/XML/1998/namespace';
const SVG = 'http://www.w3.org/2000/svg';

export type NotePoint = { id: string; measure: number; part: number; start: number; duration: number; rest?: boolean; x: number; y: number; element?: Element; sourceId?: string };
export type MeasureGeometry = { index: number; system: number; x: number; width: number; y: number; height: number; element?: Element };
export type SystemGeometry = { index: number; firstMeasure: number; measureCount: number; width: number; height: number; staffCenters: number[] };
export type RenderResult = { points: NotePoint[]; measureStarts: number[]; systemSize: number; staffCenters: number[]; scale: number; barWidth: number; systemHeight: number; measures: MeasureGeometry[]; systems: SystemGeometry[]; timemap: VerovioTimemapEvent[] };
export type RenderOptions = { font?: 'Bravura' | 'Petaluma'; textFont?: 'Sans' | 'Serif' | 'Mono'; transpose?: number; semitones?: number; scorePitch?: 'written' | 'concert'; generation?: number; hiddenPartIds?: string[] };

const latestGeneration = new WeakMap<HTMLElement, number>();

export function portraitMinimumBarWidth(score: Score): number {
  let busiest = 4;
  for (const part of score.parts) for (const measure of part.measures) busiest = Math.max(busiest, measure.notes.length);
  return Math.max(190, 50 + busiest * 34, 190 + Math.max(0, busiest - 4) * 44);
}
export function portraitBarLimit(width: number, score: Score): number {
  return Math.max(1, Math.min(4, score.parts[0]?.measures.length || 1, Math.floor((Math.max(240, width) - 56) / portraitMinimumBarWidth(score))));
}

function parseXml(text: string): XMLDocument {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const error = doc.querySelector('parsererror');
  if (error) throw new Error(`Could not parse Verovio output: ${error.textContent?.slice(0, 180)}`);
  return doc;
}
function nodes(root: Document | Element, name: string): Element[] { return Array.from(root.getElementsByTagNameNS(MEI, name)); }
function box(element: Element, svg: SVGSVGElement): DOMRect {
  try {
    const graphics = element as SVGGraphicsElement;
    const rect = graphics.getBBox();
    const transform = svg.getCTM()?.inverse().multiply(graphics.getCTM() || new DOMMatrix()) || new DOMMatrix();
    const points = [[rect.x, rect.y], [rect.x + rect.width, rect.y], [rect.x, rect.y + rect.height], [rect.x + rect.width, rect.y + rect.height]]
      .map(([x, y]) => new DOMPoint(x, y).matrixTransform(transform));
    const left = Math.min(...points.map(p => p.x)); const top = Math.min(...points.map(p => p.y));
    return new DOMRect(left, top, Math.max(...points.map(p => p.x)) - left, Math.max(...points.map(p => p.y)) - top);
  } catch { return new DOMRect(0, 0, 0, 0); }
}

function viewMei(baseline: string, score: Score, bars: number, hiddenIds: Set<string>, showChordSymbols: boolean): { mei: string; measureIds: string[] } {
  const doc = parseXml(baseline);
  const measures = nodes(doc, 'measure');
  const measureIds = measures.map(m => m.getAttributeNS(XML, 'id') || '');
  // Reader metadata is displayed by React; keep the imported source untouched.
  for (const head of nodes(doc, 'meiHead')) head.remove();
  if (!showChordSymbols) for (const harmony of nodes(doc, 'harm')) harmony.remove();
  for (const item of [...nodes(doc, 'sb'), ...nodes(doc, 'pb'), ...nodes(doc, 'pgHead'), ...nodes(doc, 'pgFoot')]) item.remove();
  for (let index = bars; index < measures.length; index += bars) {
    measures[index].parentNode?.insertBefore(doc.createElementNS(MEI, 'pb'), measures[index]);
  }
  if (hiddenIds.size) {
    const definitions = nodes(doc, 'staffDef');
    const hiddenNumbers = new Set<string>();
    for (const definition of definitions) {
      const id = definition.getAttributeNS(XML, 'id') || '';
      const mapped = score.document?.identity?.staffIdToSource?.[id];
      if (!hiddenIds.has(id) && !hiddenIds.has(mapped?.sourceId || '') && !hiddenIds.has(mapped?.partId || '') && !hiddenIds.has(mapped ? `${mapped.partId}-${mapped.staff}` : '')) continue;
      const n = definition.getAttribute('n');
      if (n) hiddenNumbers.add(n);
      definition.remove();
    }
    if (hiddenNumbers.size && definitions.length > hiddenNumbers.size) {
      for (const staff of nodes(doc, 'staff')) if (hiddenNumbers.has(staff.getAttribute('n') || '')) staff.remove();
      for (const group of nodes(doc, 'staffGrp')) if (!nodes(group, 'staffDef').length) group.remove();
    }
  }
  return { mei: new XMLSerializer().serializeToString(doc), measureIds };
}

function beatLabel(start: number, subdivisions: boolean): string {
  const beat = Math.floor(start) + 1;
  if (!subdivisions) return String(beat);
  const fraction = ((start % 1) + 1) % 1;
  return fraction < .01 ? String(beat) : fraction < .3 ? `${beat}e` : fraction < .55 ? `${beat}&` : `${beat}a`;
}
function annotation(svg: SVGSVGElement, className: string, x: number, y: number, label: string): void {
  const text = document.createElementNS(SVG, 'text');
  text.setAttribute('x', String(x)); text.setAttribute('y', String(y)); text.setAttribute('text-anchor', 'middle');
  text.setAttribute('class', `annotation ${className}`); text.textContent = label; svg.appendChild(text);
}
function sourceIds(score: Score, event: ScoreNote): string[] {
  const mapped = score.document?.identity?.noteIdToSourceId?.[event.id];
  return [event.sourceId, mapped, event.id, ...event.pitches.map(p => p.sourceId)].filter((id): id is string => !!id);
}
function findNote(svg: SVGSVGElement, score: Score, event: ScoreNote): Element | undefined {
  for (const id of sourceIds(score, event)) {
    const target = svg.querySelector(`[id="${CSS.escape(id)}"]`);
    if (target?.matches('.note, .chord, .rest')) return target;
    const related = target?.closest('.note, .chord, .rest');
    if (related) return related;
  }
  return undefined;
}
function sanitizeSvg(doc: XMLDocument): SVGSVGElement {
  if (doc.documentElement.namespaceURI !== SVG || doc.documentElement.localName !== 'svg') throw new Error('Verovio returned invalid SVG.');
  for (const element of Array.from(doc.querySelectorAll('*'))) {
    if (['script', 'foreignObject', 'iframe', 'image'].includes(element.localName)) { element.remove(); continue; }
    if (element.localName === 'style' && /@import|url\(\s*['"]?(?!#)/i.test(element.textContent || '')) { element.remove(); continue; }
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith('on') || ((name === 'href' || name === 'xlink:href') && !attribute.value.startsWith('#')) || /url\(\s*['"]?https?:/i.test(attribute.value)) element.removeAttributeNode(attribute);
    }
  }
  return document.importNode(doc.documentElement, true) as unknown as SVGSVGElement;
}

/** Render from the original engraving document through the locally bundled WASM worker. */
export async function renderScore(
  container: HTMLElement, score: Score, mode: 'portrait' | 'landscape',
  showNames: boolean, showCounts: boolean, subdivisions: boolean,
  barsPerLine: 'auto' | number, showChordSymbols: boolean, inferChordSymbols: boolean,
  availableHeight = 0, zoom = 1, firstSystemGutter = 0, options: RenderOptions = {},
): Promise<RenderResult> {
  const generation = options.generation ?? (latestGeneration.get(container) || 0) + 1;
  latestGeneration.set(container, generation);
  const isCurrent = () => latestGeneration.get(container) === generation;
  const source = score.document?.engravingText || scoreToMei(score);
  const { mei: baseline, timemap } = await importVerovio(source);
  if (!isCurrent()) throw new Error('Superseded score render.');
  const viewportWidth = Math.max(240, container.clientWidth);
  const usableWidth = Math.max(180, viewportWidth - firstSystemGutter);
  const count = Math.max(1, score.parts[0]?.measures.length || 1);
  const bars = mode === 'landscape' ? Math.min(12, count) : barsPerLine === 'auto' ? portraitBarLimit(usableWidth, score) : Math.min(4, Math.max(1, barsPerLine));
  const { mei, measureIds } = viewMei(baseline, score, bars, new Set(options.hiddenPartIds || []), showChordSymbols);
  const minimumBar = portraitMinimumBarWidth(score);
  const pageWidth = mode === 'landscape' ? Math.max(usableWidth, bars * Math.max(230, minimumBar) + 160) : Math.max(usableWidth, bars * Math.max(190, minimumBar) + 120);
  const rendered = await renderVerovio(mei, {
    breaks: 'encoded', font: options.font || 'Bravura', pageWidth: Math.min(100000, Math.round(pageWidth)), pageHeight: 60000,
    pageMarginLeft: 25, pageMarginRight: 25, pageMarginTop: 20, pageMarginBottom: 20,
    adjustPageHeight: true, svgViewBox: true, scale: 100, xmlIdChecksum: true,
    transposeToSoundingPitch: options.scorePitch === 'concert', transpose: String(options.transpose ?? options.semitones ?? 0),
    spacingStaff: showNames || showCounts ? 24 : 14, smuflTextFont: 'embedded',
  });
  if (!isCurrent()) throw new Error('Superseded score render.');
  if (!rendered.pages.length) throw new Error('Verovio did not produce a score page.');

  const fragment = document.createDocumentFragment();
  const blocks: HTMLElement[] = [];
  const pageSvgs: SVGSVGElement[] = [];
  const systems: SystemGeometry[] = [];
  const measures: MeasureGeometry[] = [];
  const points: NotePoint[] = [];
  const measureStarts: number[] = [];
  const firstCenters: number[] = [];
  let firstScale = 1;
  let firstHeight = 0;
  for (let pageIndex = 0; pageIndex < rendered.pages.length; pageIndex++) {
    const svg = sanitizeSvg(parseXml(rendered.pages[pageIndex]));
    const viewBox = (svg.getAttribute('viewBox') || '0 0 1000 200').split(/\s+/).map(Number);
    const naturalWidth = viewBox[2] || 1000;
    const naturalHeight = viewBox[3] || 200;
    const firstMeasure = pageIndex * bars;
    const widthLimit = mode === 'portrait' ? (pageIndex === 0 ? usableWidth : viewportWidth) : naturalWidth;
    const widthFit = mode === 'portrait' ? Math.min(1, widthLimit / naturalWidth) : 1;
    const heightFit = score.parts.length > 4 && availableHeight > 0 ? Math.min(1, availableHeight / naturalHeight) : 1;
    const scale = Math.min(widthFit, heightFit) * zoom;
    if (!pageIndex) { firstScale = scale; firstHeight = naturalHeight * scale; }
    const block = document.createElement('div');
    block.className = 'score-system'; block.dataset.firstMeasure = String(firstMeasure + 1);
    block.style.width = `${naturalWidth * scale}px`;
    block.style.height = `${naturalHeight * scale + (showNames || showCounts ? 30 * scale : 0)}px`;
    if (!pageIndex) block.style.marginLeft = `${firstSystemGutter}px`;
    svg.style.width = `${naturalWidth * scale}px`; svg.style.height = `${naturalHeight * scale}px`;
    svg.style.overflow = 'visible';
    svg.style.fontFamily = options.textFont === 'Serif' ? 'Georgia, serif' : options.textFont === 'Mono' ? 'ui-monospace, monospace' : 'Arial, sans-serif';
    block.appendChild(svg); fragment.appendChild(block); blocks.push(block); pageSvgs.push(svg);
    systems.push({ index: pageIndex, firstMeasure, measureCount: svg.querySelectorAll('g.measure').length, width: naturalWidth * scale, height: naturalHeight * scale, staffCenters: [] });
  }
  if (!isCurrent()) throw new Error('Superseded score render.');
  container.replaceChildren(fragment);
  for (let pageIndex = 0; pageIndex < pageSvgs.length; pageIndex++) {
    const svg = pageSvgs[pageIndex]; const block = blocks[pageIndex]; const system = systems[pageIndex];
    const scale = system.width / (Number((svg.getAttribute('viewBox') || '').split(/\s+/)[2]) || system.width);
    const blockTop = block.offsetTop;
    system.staffCenters = Array.from(svg.querySelectorAll('g.staff')).slice(0, score.parts.length).map(staff => {
      const lines = Array.from(staff.querySelectorAll(':scope > path')).slice(0, 5);
      const rects = lines.map(line => box(line, svg));
      const center = rects.length ? (Math.min(...rects.map(rect => rect.y)) + Math.max(...rects.map(rect => rect.y))) / 2 : box(staff, svg).y;
      return center * scale;
    });
    if (!pageIndex) firstCenters.push(...system.staffCenters);
    const measureElements = Array.from(svg.querySelectorAll('g.measure'));
    for (let local = 0; local < measureElements.length; local++) {
      const element = measureElements[local]; const id = element.getAttribute('id');
      const byId = id ? measureIds.indexOf(id) : -1;
      const index = byId >= 0 ? byId : system.firstMeasure + local;
      const rect = box(element, svg);
      measureStarts[index] = mode === 'landscape' ? block.offsetLeft + rect.x * scale : blockTop + rect.x * scale;
      measures.push({ index, system: pageIndex, x: rect.x * scale, width: rect.width * scale, y: blockTop + rect.y * scale, height: rect.height * scale, element });
    }
    for (let partIndex = 0; partIndex < score.parts.length; partIndex++) for (const measure of score.parts[partIndex].measures) {
      const measureIndex = measure.index;
      if (measureIndex < system.firstMeasure || measureIndex >= system.firstMeasure + system.measureCount) continue;
      const svgMeasure = measureElements[measureIndex - system.firstMeasure];
      if (!svgMeasure) continue;
      for (const event of measure.notes) {
        const element = findNote(svg, score, event);
        if (!element || !svgMeasure.contains(element)) continue;
        const anchor = element.querySelector('.notehead') || element;
        const rect = box(anchor, svg); const x = rect.x + rect.width / 2; const y = rect.y + rect.height / 2;
        element.classList.add('reader-note'); element.setAttribute('data-note-id', event.id);
        points.push({ id: event.id, measure: measureIndex, part: partIndex, start: event.start, duration: event.duration, rest: event.rest, x: x * scale, y: blockTop + y * scale, element, sourceId: event.sourceId });
        if (showNames) [...event.pitches].sort((a, b) => b.midi - a.midi).forEach((pitch, row) => annotation(svg, 'note-label', x, y + 50 + row * 14, pitch.step));
        if (showCounts) annotation(svg, 'count-label', x, y + 65 + (showNames ? event.pitches.length * 14 : 0), beatLabel(event.start, subdivisions));
        if (showChordSymbols && inferChordSymbols && !event.chordSymbol && score.parts[partIndex].clef !== 'percussion') {
          const chord = inferChordSymbol(event.pitches); if (chord) annotation(svg, 'chord-symbol', x, y - 48, chord);
        }
      }
    }
  }
  return { points, measureStarts, systemSize: bars, staffCenters: firstCenters, scale: firstScale,
    barWidth: Math.max(1, systems[0]?.width || 230) / bars, systemHeight: firstHeight, measures, systems, timemap };
}
