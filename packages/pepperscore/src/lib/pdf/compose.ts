import { sanitizeSvg } from '../render';
import { PAPER_SIZES, type PaperId } from './paper';
import { embedFonts } from './fonts';
import { flattenViewports, normalizeTextSteps } from './normalize';
import { materializePaintSteps } from './annotations';
import { driveSteps, sliceTicker, type ExportProgress } from './cooperative';
import { planSlices, sliceShell } from './slices';

type ComposeOptions = { paper: PaperId; title?: string; onProgress?: (progress: ExportProgress) => void };

/** Vector pages in exact physical dimensions. Import this module dynamically from the export UI.
 * Works in slices, yielding to the page between them; `signal` is checked at every slice. */
export async function composePdf(pages: string[], opts: ComposeOptions, signal: AbortSignal): Promise<Blob> {
  signal.throwIfAborted();
  const size = PAPER_SIZES[opts.paper];
  if (!size || !pages.length) throw new Error('PDF export requires a paper size and at least one page.');
  const [{ jsPDF }, { svg2pdf }] = await Promise.all([import('jspdf'), import('svg2pdf.js')]);
  signal.throwIfAborted();
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [size.width, size.height], compress: true });
  const faces = await embedFonts(pdf, signal);
  pdf.setProperties({ title: opts.title || '' });
  const host = document.createElement('div');
  host.style.cssText = 'position:absolute;left:-100000px;top:0;pointer-events:none';
  document.body.appendChild(host);
  const tick = sliceTicker(signal);
  try {
    for (const [index, page] of pages.entries()) {
      await tick();
      const doc = new DOMParser().parseFromString(page, 'image/svg+xml');
      if (doc.querySelector('parsererror') || doc.documentElement.localName !== 'svg') throw new Error('Invalid PDF SVG page.');
      const svg = sanitizeSvg(doc);
      host.replaceChildren(svg);
      await tick();
      flattenViewports(svg);
      await tick();
      await driveSteps(normalizeTextSteps(svg), tick);
      // Fail clearly rather than silently producing missing glyphs (e.g. CJK titles).
      for (const text of Array.from(svg.querySelectorAll('text, tspan'))) {
        await tick();
        pdf.setFont(text.getAttribute('font-family') || 'Poppins', text.getAttribute('font-weight') === 'bold' ? 'bold' : 'normal');
        const font = pdf.getFont();
        const metadata = font.metadata as { characterToGlyph?: (code: number) => number };
        for (const character of Array.from(text.childNodes).filter(node=>node.nodeType === Node.TEXT_NODE).map(node=>node.textContent).join('')) if (!/\s/.test(character) && !metadata.characterToGlyph?.(character.codePointAt(0)!)) {
          throw new Error(`PDF font ${pdf.getFont().fontName} has no glyph for "${character}". Use a supported title or text.`);
        }
      }
      await driveSteps(materializePaintSteps(svg, size, (element, size) => {
        pdf.setFont(element.getAttribute('font-family') || 'Poppins', element.getAttribute('font-weight') === 'bold' ? 'bold' : 'normal');
        return pdf.getStringUnitWidth(element.textContent || '') * size;
      }), tick);
      if (index) pdf.addPage([size.width, size.height], 'portrait');
      // svg2pdf draws a whole page in one synchronous burst (seconds for a 30-part system), so give it
      // a few dozen elements at a time. Slices are drawn in document order, so paint order is unchanged.
      const slices = planSlices(svg);
      svg.remove();
      for (const chunks of slices) {
        await tick();
        const shell = sliceShell(svg, chunks);
        host.replaceChildren(shell);
        await svg2pdf(shell, pdf, { x: 0, y: 0, width: size.width, height: size.height });
      }
      host.replaceChildren();
      pdf.setFont('Poppins', 'normal'); pdf.setFontSize(8); pdf.setTextColor(0);
      pdf.text(String(index + 1), size.width / 2, size.height - 5, { align: 'center' });
      opts.onProgress?.({ phase: 'composing', page: index + 1, pages: pages.length });
    }
    signal.throwIfAborted();
    return pdf.output('blob');
  } finally { host.remove(); for (const face of faces) document.fonts.delete(face); }
}
