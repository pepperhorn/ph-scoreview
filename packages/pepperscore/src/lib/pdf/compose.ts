import { sanitizeSvg } from '../render';
import { PAPER_SIZES, type PaperId } from './paper';
import { embedFonts } from './fonts';
import { flattenViewports, normalizeText } from './normalize';
import { materializePaint } from './annotations';

type ComposeOptions = { paper: PaperId; title?: string };

/** Vector pages in exact physical dimensions. Import this module dynamically from the export UI. */
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
  try {
    for (const [index, page] of pages.entries()) {
      signal.throwIfAborted();
      const doc = new DOMParser().parseFromString(page, 'image/svg+xml');
      if (doc.querySelector('parsererror') || doc.documentElement.localName !== 'svg') throw new Error('Invalid PDF SVG page.');
      const svg = sanitizeSvg(doc);
      host.replaceChildren(svg);
      flattenViewports(svg);
      normalizeText(svg);
      // Fail clearly rather than silently producing missing glyphs (e.g. CJK titles).
      for (const text of Array.from(svg.querySelectorAll('text, tspan'))) {
        pdf.setFont(text.getAttribute('font-family') || 'Poppins', text.getAttribute('font-weight') === 'bold' ? 'bold' : 'normal');
        const font = pdf.getFont();
        const metadata = font.metadata as { characterToGlyph?: (code: number) => number };
        for (const character of Array.from(text.childNodes).filter(node=>node.nodeType === Node.TEXT_NODE).map(node=>node.textContent).join('')) if (!/\s/.test(character) && !metadata.characterToGlyph?.(character.codePointAt(0)!)) {
          throw new Error(`PDF font ${pdf.getFont().fontName} has no glyph for "${character}". Use a supported title or text.`);
        }
      }
      materializePaint(svg, (element, size) => {
        pdf.setFont(element.getAttribute('font-family') || 'Poppins', element.getAttribute('font-weight') === 'bold' ? 'bold' : 'normal');
        return pdf.getStringUnitWidth(element.textContent || '') * size;
      });
      if (index) pdf.addPage([size.width, size.height], 'portrait');
      await svg2pdf(svg, pdf, { x: 0, y: 0, width: size.width, height: size.height });
      pdf.setFont('Poppins', 'normal'); pdf.setFontSize(8); pdf.setTextColor(0);
      pdf.text(String(index + 1), size.width / 2, size.height - 5, { align: 'center' });
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
    signal.throwIfAborted();
    return pdf.output('blob');
  } finally { host.remove(); for (const face of faces) document.fonts.delete(face); }
}
