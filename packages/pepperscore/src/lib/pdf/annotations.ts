import type { Score, ScoreNote } from '../score';
import { annotationBands, annotationBox, annotationLayout, drawEventAnnotations, findAnnotationNote, type AnnotationSettings } from '../render';

/** Attach to the DOM before calling: SVG matrices and glyph boxes require a rendered tree. */
export function annotatePage(svg: SVGSVGElement, score: Score, settings: AnnotationSettings, font?: string, aliases: ReadonlyMap<string, ScoreNote> = new Map()): void {
  const parts = score.parts.filter(part => !part.tabOf);
  const layout = annotationLayout(parts, settings);
  const byId = new Map(Array.from(svg.querySelectorAll('[id]'), element => [element.id, element]));
  const layer = document.createElementNS(svg.namespaceURI, 'g');
  layer.setAttribute('class', 'reader-annotations');
  const bands = new Map<Element, ReturnType<typeof annotationBands>>();
  for (const part of parts) for (const measure of part.measures) for (const event of measure.notes) {
    const alias = aliases.get(event.id);
    const element = findAnnotationNote(byId, score, event) || (alias ? findAnnotationNote(byId, score, alias) : undefined);
    if (!element) continue;
    const staff = element.closest('g.staff');
    if (!staff) continue;
    const system = staff.closest('g.system') || svg;
    const n = staff.getAttribute('data-n');
    let systemBands = bands.get(system);
    if (!systemBands) {
      const tabStaves = new Set(Array.from(system.querySelectorAll('g.staff')).filter(staff => staff.querySelector('.tabGrp, .tabDurSym') || staff.querySelectorAll(':scope > path').length > 5).map(staff=>staff.getAttribute('data-n') || ''));
      systemBands = annotationBands(system, element=>annotationBox(element,svg), tabStaves, !!layout.laneRows);
      bands.set(system, systemBands);
    }
    const band = systemBands.get(n || '');
    if (!band) continue;
    const anchor = annotationBox(element.querySelector('.notehead') || element, svg);
    drawEventAnnotations(layer, score, part, measure, event, anchor.x + anchor.width / 2,
      band, settings, layout);
  }
  svg.appendChild(layer);
  for (const text of Array.from(layer.querySelectorAll('text'))) {
    const names = text.classList.contains('note-label'), chord = text.classList.contains('chord-symbol');
    const scale = names ? layout.nameScale : chord ? layout.chordScale : text.classList.contains('is-subdivision') ? layout.offbeatScale : layout.beatScale;
    text.setAttribute('font-family', font === 'Petaluma' ? 'Petaluma Script' : 'Poppins');
    text.setAttribute('font-size', String((names ? 15 : chord ? 17 : 13) * scale));
    text.setAttribute('font-weight', names || chord ? '600' : '400');
    text.setAttribute('fill', names ? '#617262' : chord ? '#465549' : '#8a978c');
  }
}

/** svg2pdf ignores paint-order: retain identical text geometry in each explicit pass. */
export function materializePaint(svg: SVGSVGElement, textWidth: (element: SVGElement, size: number) => number): void {
  for (const element of Array.from(svg.querySelectorAll<SVGElement>('text, .notehead'))) {
    const computed = getComputedStyle(element);
    // Freeze inherited/computed drawing properties before cloning, including inline CSS.
    for (const property of ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity', 'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor', 'dominant-baseline']) {
      element.style.setProperty(property, computed.getPropertyValue(property));
    }
    if (element.localName === 'text' && !element.children.length && computed.textAnchor === 'middle') {
      // Use the embedded face's advances, rather than svg2pdf's rounded browser measurement.
      const offset = textWidth(element, parseFloat(computed.fontSize)) / 2;
      element.setAttribute('dx', String((Number(element.getAttribute('dx')) || 0) - offset));
      element.style.setProperty('text-anchor', 'start');
    }
    if (element.localName === 'text' && computed.dominantBaseline === 'central') {
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d')!;
      context.font = `${computed.fontWeight} ${computed.fontSize} ${computed.fontFamily}`;
      const metrics = context.measureText(element.textContent || '');
      const offset = (metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent) / 2;
      element.setAttribute('dy', String((Number(element.getAttribute('dy')) || 0) + offset));
      element.style.setProperty('dominant-baseline', 'alphabetic');
    }
    if (computed.stroke === 'none' || parseFloat(computed.strokeWidth) === 0) continue;
    const outline = element.cloneNode(true) as SVGElement;
    outline.removeAttribute('id');
    for (const child of Array.from(outline.querySelectorAll('[id]'))) child.removeAttribute('id');
    outline.style.setProperty('fill', 'none');
    const shadow = outline.cloneNode(true) as SVGElement;
    shadow.style.setProperty('stroke', '#000000'); shadow.style.setProperty('stroke-opacity', '0.15');
    shadow.setAttribute('transform', `${element.getAttribute('transform') || ''} translate(0 0.5)`);
    element.before(outline, shadow);
    element.style.setProperty('stroke', 'none');
  }
}
