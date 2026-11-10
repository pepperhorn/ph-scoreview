import type { Score, ScoreNote } from '../score';
import { annotationBox, annotationLayout, drawEventAnnotations, findAnnotationNote, type AnnotationSettings } from '../render';

/** Attach to the DOM before calling: SVG matrices and glyph boxes require a rendered tree. */
export function annotatePage(svg: SVGSVGElement, score: Score, settings: AnnotationSettings, font?: string, aliases: ReadonlyMap<string, ScoreNote> = new Map()): void {
  const parts = score.parts.filter(part => !part.tabOf);
  const layout = annotationLayout(parts, settings);
  const byId = new Map(Array.from(svg.querySelectorAll('[id]'), element => [element.id, element]));
  const layer = document.createElementNS(svg.namespaceURI, 'g');
  layer.setAttribute('class', 'reader-annotations');
  const bands = new Map<string, { top: number; laneTop: number }>();
  const systems = Array.from(svg.querySelectorAll('g.system'));
  for (const part of parts) for (const measure of part.measures) for (const event of measure.notes) {
    const alias = aliases.get(event.id);
    const element = findAnnotationNote(byId, score, event) || (alias ? findAnnotationNote(byId, score, alias) : undefined);
    if (!element) continue;
    const staff = element.closest('g.staff');
    if (!staff) continue;
    const system = staff.closest('g.system') || svg;
    const n = staff.getAttribute('data-n');
    const key = `${systems.indexOf(system)}:${n || staff.id}`;
    let band = bands.get(key);
    if (!band) {
      const staves = n ? Array.from(system.querySelectorAll(`g.staff[data-n="${CSS.escape(n)}"]`)) : [staff];
      const first = staves[0];
      const lines = Array.from(first.querySelectorAll(':scope > path')).slice(0, 5).map(line => annotationBox(line, svg));
      const content = annotationBox(first, svg);
      const top = lines.length ? Math.min(...lines.map(line => line.top)) : content.top;
      const bottom = lines.length ? Math.max(...lines.map(line => line.bottom)) : content.bottom;
      let lowest = Math.max(bottom, ...staves.map(stave => annotationBox(stave, svg).bottom));
      const nextTop = Math.min(Infinity, ...Array.from(system.querySelectorAll('g.staff > path')).map(line=>annotationBox(line,svg).top).filter(y=>y>bottom+2));
      for (const control of Array.from(system.querySelectorAll('g.measure > g.dynam, g.measure > g.hairpin, g.measure > g.dir, g.measure > g.pedal'))) {
        const rect = annotationBox(control, svg);
        if (rect.height && rect.top >= bottom - 2 && rect.top < bottom + (nextTop - bottom) / 2) lowest = Math.max(lowest, rect.bottom);
      }
      band = { top, laneTop: lowest + 6 }; bands.set(key, band);
    }
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

/** svg2pdf ignores paint-order: make its outline, shadow and fill explicit drawing passes. */
export function materializePaint(svg: SVGSVGElement): void {
  for (const element of Array.from(svg.querySelectorAll('text, .notehead'))) {
    const style = getComputedStyle(element);
    element.setAttribute('fill', style.fill === 'currentcolor' ? style.color : style.fill);
    if (style.stroke === 'none' || style.strokeWidth === '0px') continue;
    const outline = element.cloneNode(true) as Element;
    outline.removeAttribute('id');
    for (const child of Array.from(outline.querySelectorAll('[id]'))) child.removeAttribute('id');
    outline.removeAttribute('style'); outline.setAttribute('fill', 'none');
    outline.setAttribute('stroke', style.stroke); outline.setAttribute('stroke-width', style.strokeWidth);
    outline.setAttribute('stroke-opacity', style.strokeOpacity);
    const shadow = outline.cloneNode(true) as Element;
    shadow.setAttribute('stroke', '#000000'); shadow.setAttribute('stroke-opacity', '0.15');
    shadow.setAttribute('transform', `${element.getAttribute('transform') || ''} translate(0 0.5)`);
    element.before(outline, shadow);
    element.setAttribute('stroke', 'none');
    (element as SVGElement).style.setProperty('stroke', 'none');
  }
}
