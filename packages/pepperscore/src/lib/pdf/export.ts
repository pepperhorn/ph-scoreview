import { sanitizeSvg } from '../render';
import { PAPER_SIZES } from './paper';
import type { Score, ScoreNote } from '../score';
import { annotationLayout, type AnnotationSettings } from '../render';
import type { PitchColourPaint } from '../pitch-colours';
import { annotatePage, paintPitchColours } from './annotations';
import { composePdf } from './compose';
import { engravePages, type PageInput, type PageOptions } from './engrave';

/** Immutable Save snapshot: score is already the reader's instrument/transposition view;
 * input.view is its planStaves view (including hidden staves, spelling and TAB).
 * No reader channel or live DOM is used. T3 imports only this module, dynamically.
 */
export type ExportRequest = { input: PageInput; options: PageOptions; score: Score; annotations?: AnnotationSettings; pitchColours?: PitchColourPaint; visiblePartIds?: string[]; tabAliases?: ReadonlyMap<string, ScoreNote>; tabStaves?: ReadonlySet<string> };
export async function exportScore(request: ExportRequest, signal: AbortSignal): Promise<Blob> {
  signal.throwIfAborted();
  const score = request.visiblePartIds ? { ...request.score, parts: request.score.parts.filter(part => request.visiblePartIds!.includes(part.id)) } : request.score;
  const settings = request.annotations || {};
  const layout = annotationLayout(score.parts, settings);
  const metadata = [request.score.title, request.score.subtitle, request.score.composer, ...(request.score.credits || [])].filter((line): line is string => !!line);
  const result = await engravePages({ ...request.input, view: request.input.view && { ...request.input.view, harmSize: layout.harmSize } },
    { ...request.options, spacingStaff: layout.spacingStaff, annotationRoom: layout.laneHeight, headingMm: metadata.length ? 8 + metadata.length * 4 : 0 }, signal);
  const host = document.createElement('div');
  host.style.cssText = 'position:absolute;left:-100000px;top:0;pointer-events:none';
  document.body.appendChild(host);
  try {
    const pages: string[] = [];
    for (const [index, text] of result.pages.entries()) {
      signal.throwIfAborted();
      const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
      const svg = sanitizeSvg(doc);
      host.replaceChildren(svg);
      if (request.pitchColours) paintPitchColours(svg, score, request.pitchColours, request.tabStaves);
      annotatePage(svg, score, settings, request.options.font, request.tabAliases, request.tabStaves);
      if (!index) {
        const ratio = svg.viewBox.baseVal.width / PAPER_SIZES[request.options.paper].width;
        // Metadata stays in the reserved heading band, shrinking long lines to fit the page.
        let y = 15;
        for (const line of metadata) {
          const node = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          node.setAttribute('x', String(12 * ratio)); node.setAttribute('y', String(y * ratio));
          node.setAttribute('font-family', 'Poppins'); node.setAttribute('font-size', String((y === 15 ? 4 : 2.7) * ratio));
          node.textContent = line; svg.appendChild(node);
          const width = node.getBBox().width, available = (PAPER_SIZES[request.options.paper].width - 24) * ratio;
          if (width > available) node.setAttribute('font-size', String(Number(node.getAttribute('font-size')) * available / width));
          y += 4;
        }
      }
      pages.push(new XMLSerializer().serializeToString(svg));
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
    return await composePdf(pages, { paper: request.options.paper, title: request.score.title }, signal);
  } finally { host.remove(); }
}
