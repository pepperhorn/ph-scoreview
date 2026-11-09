import type createVerovioModule from 'verovio/wasm';
import type { VerovioToolkit } from 'verovio/esm';
import type { VerovioFiles } from '../verovio-protocol';
import { attributeOf, buildViewMei, scan, scanBaseline } from '../notation/mei-view';
import { spellBaseline } from '../notation/mei-spelling';
import { injectTab } from '../notation/mei-tab';
import { breakLines } from './fit';
import { MARGIN_MM, MM_PER_UNIT, PAPER_SIZES } from './paper';
import type { PageInput, PageOptions, PagesResult } from './engrave';

type Toolkit = InstanceType<typeof VerovioToolkit>;
/** SVG dimensions are Verovio layout units, while paths/bounding boxes are tenths of a unit. */
function dimensions(svg: string): [number, number] {
  const match = /<svg\b[^>]*viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
  if (!match) throw new Error('PDF spike: missing SVG page dimensions.');
  return [Number(match[1]), Number(match[2])];
}
function naturalBar(svg: string): { width: number; prefix: number; height: number } {
  const [width, height] = dimensions(svg);
  // The first event's bounding box follows the clef/key/meter prefix. Taking its left edge leaves
  // all spacing after that edge in the bar width (including in-bar key/clef changes and lyrics).
  const layer = svg.indexOf('class="layer"');
  const rect = layer < 0 ? null : /<rect\b[^>]*\bx="([\d.-]+)"/.exec(svg.slice(layer));
  const prefix = rect ? Math.max(0, Number(rect[1]) / 10) : 0;
  if (!(width > prefix && height > 0)) throw new Error(`PDF spike: unreliable natural bar measurement (${width}, ${prefix}, ${height}).`);
  return { width: width - prefix, prefix, height };
}

self.onmessage = async ({ data }: MessageEvent<{ input: PageInput; opts: PageOptions; files: VerovioFiles }>) => {
  let tk: Toolkit | undefined;
  try {
    const { input, opts, files } = data;
    const paper = PAPER_SIZES[opts.paper];
    if (!paper) throw new Error('Unknown PDF paper size.');
    // Validate even an empty score before starting WASM.
    breakLines([], 1, opts.maxBars);
    const [wasm, api] = await Promise.all([import(/* @vite-ignore */ files.module), import(/* @vite-ignore */ files.toolkit)]);
    const module = await (wasm.default as typeof createVerovioModule)();
    api.enableLogToBuffer(1, module);
    const ToolkitClass = api.VerovioToolkit as typeof VerovioToolkit;
    tk = new ToolkitClass(module);
    const load = (text: string, options: Record<string, unknown>) => {
      tk!.resetOptions(); tk!.setOptions({ xmlIdChecksum: true, ...options });
      if (!tk!.loadData(text)) throw new Error('Could not engrave the PDF notation.');
    };
    const common = { font: opts.font || 'Bravura', fontFallback: 'Bravura', header: 'none', footer: 'none',
      svgViewBox: true, scale: 100, smuflTextFont: 'none' };
    load(input.data, { ...common, breaks: 'none' });
    let mei = tk.getMEI();
    const view = input.view ?? { breakEvery: 0, hiddenStaves: [], chordSymbols: true };
    mei = await spellBaseline(mei, view.spelling, async (text, transpose) => {
      load(text, { ...common, breaks: 'none', ...transpose }); return tk!.getMEI();
    });
    if (view.tab) mei = injectTab(mei, view.tab);
    const count = scanBaseline(mei).measureIds.length;
    if (!count) {
      const width = Math.round(paper.width / MM_PER_UNIT), height = Math.round(paper.height / MM_PER_UNIT);
      self.postMessage({ value: { pages: [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"></svg>`], lines: [], shrunk: false } satisfies PagesResult });
      return;
    }
    // A one-bar-per-page, unjustified pass: width is natural, never stretched to the paper.
    load(buildViewMei(mei, { ...view, breakBefore: undefined, breakEvery: 1 }), {
      ...common, breaks: 'encoded', pageWidth: 100000, pageHeight: 60000,
      pageMarginLeft: 0, pageMarginRight: 0, pageMarginTop: 0, pageMarginBottom: 0,
      noJustification: true, adjustPageWidth: true, adjustPageHeight: true, svgBoundingBoxes: true,
    });
    const measured = Array.from({ length: tk.getPageCount() }, (_, i) => naturalBar(tk!.renderToSVG(i + 1)));
    if (count && measured.length !== count) throw new Error('PDF spike: one natural page per bar was not honoured.');
    // Verovio cannot change scale per system. For an over-height system shrink the whole document,
    // keeping physical margins fixed. Normal documents always retain the fixed stave size.
    const naturalHeight = Math.max(1, ...measured.map(bar => bar.height));
    const scale = Math.min(1, (paper.height - 2 * MARGIN_MM) / (naturalHeight * MM_PER_UNIT));
    const mm = MM_PER_UNIT * scale;
    const overhead = Math.max(120, ...measured.map(bar => bar.prefix));
    const capacity = (paper.width - 2 * MARGIN_MM) / mm - overhead;
    const widths = measured.slice(0, count).map(bar => bar.width);
    const starts = breakLines(widths, capacity, opts.maxBars);
    const lines = starts.map((start, i) => ({ start, count: (starts[i + 1] ?? count) - start,
      width: overhead + widths.slice(start, starts[i + 1] ?? count).reduce((a,b) => a+b, 0) }));
    load(buildViewMei(mei, { ...view, breakBefore: starts }), {
      // 'line' honours encoded sb while choosing page breaks by the real page height.
      ...common, breaks: 'line', pageWidth: Math.round(paper.width / mm), pageHeight: Math.round(paper.height / mm),
      pageMarginLeft: Math.round(MARGIN_MM / mm), pageMarginRight: Math.round(MARGIN_MM / mm),
      pageMarginTop: Math.round(MARGIN_MM / mm), pageMarginBottom: Math.round(MARGIN_MM / mm),
      adjustPageWidth: false, adjustPageHeight: false,
    });
    const pages = Array.from({ length: Math.max(1, tk.getPageCount()) }, (_, i) => tk!.renderToSVG(i + 1));
    // Check actual membership, not just the number of systems: breaks must survive pagination.
    const actual: number[] = [];
    for (const svg of pages) {
      let system = -1;
      scan(svg, ({ closing, name, attributes }) => {
        if (closing || name !== 'g') return;
        const classes = (attributeOf(attributes, 'class') || '').split(' ');
        if (classes.includes('system')) { system = actual.length; actual.push(0); }
        if (classes.includes('measure') && system >= 0) actual[system]++;
      });
    }
    if (count && (actual.length !== lines.length || actual.some((n,i) => n !== lines[i].count))) {
      throw new Error(`PDF spike: encoded system breaks were not honoured (${actual.join(',')}).`);
    }
    self.postMessage({ value: { pages, lines, shrunk: scale < 1 } satisfies PagesResult });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) });
  } finally { tk?.destroy(); }
};
