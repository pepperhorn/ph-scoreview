import type createVerovioModule from 'verovio/wasm';
import type { VerovioToolkit } from 'verovio/esm';
import type { VerovioFiles } from '../verovio-protocol';
import { attributeOf, buildViewMei, scan, scanBaseline } from '../notation/mei-view';
import { spellBaseline } from '../notation/mei-spelling';
import { injectTab } from '../notation/mei-tab';
import { breakLines } from './fit';
import { MM_PER_UNIT, PAPER_SIZES, pageGeometry } from './paper';
import type { PageInput, PageOptions, PagesResult } from './engrave';

type Toolkit = InstanceType<typeof VerovioToolkit>;
/** SVG dimensions are Verovio layout units, while paths/bounding boxes are tenths of a unit. */
function dimensions(svg: string): [number, number] {
  const match = /<svg\b[^>]*viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
  if (!match) throw new Error('PDF spike: missing SVG page dimensions.');
  return [Number(match[1]), Number(match[2])];
}
/** Complete measure extents in one coordinate system, across every staff and layer.
 * Staff paths establish barline-to-barline width; glyph boxes add any overhang. Signature
 * changes stay inside their contextual measure, rather than becoming discarded prefixes.
 */
function measureSvg(svg: string) {
  const bars: { left: number; right: number }[] = [];
  const systems: { left: number; right: number }[] = [];
  const groups: string[][] = [];
  let bar = -1, system = -1, signatureWidth = 0;
  scan(svg, ({ closing, name, attributes, selfClosing }) => {
    if (name === 'g') {
      if (closing) { groups.pop(); return; }
      const classes = (attributeOf(attributes, 'class') || '').split(' ');
      // Bounding-box groups repeat the owning element's class.
      if (!classes.includes('bounding-box')) {
        if (classes.includes('system')) { system = systems.length; systems.push({left:Infinity,right:-Infinity}); bar = -1; }
        if (classes.includes('measure')) { bar = bars.length; bars.push({left:Infinity,right:-Infinity}); }
      }
      if (!selfClosing) groups.push(classes);
      return;
    }
    if (closing || bar < 0) return;
    const include = (left: number, right: number) => {
      bars[bar].left = Math.min(bars[bar].left,left/10);
      bars[bar].right = Math.max(bars[bar].right,right/10);
      if (system >= 0) {
        systems[system].left = Math.min(systems[system].left,left/10);
        systems[system].right = Math.max(systems[system].right,right/10);
      }
    };
    if (name === 'rect') {
      const x = Number(attributeOf(attributes,'x')), width = Number(attributeOf(attributes,'width'));
      if (Number.isFinite(x) && width > 0) {
        // Staff boxes use the bar's coordinate system and include all of that staff's glyphs.
        // Nested text boxes (e.g. measure numbers) can have local transforms; do not mix them in.
        if (groups.at(-1)?.includes('staff') && groups.at(-1)?.includes('bounding-box')) include(x,x+width);
        if (groups.at(-1)?.some(c => ['clef','keySig','meterSig'].includes(c))) signatureWidth = Math.max(signatureWidth,width/10);
      }
    } else if (name === 'path' && groups.at(-1)?.includes('staff')) {
      const path = /^M([\d.-]+) ([\d.-]+) L([\d.-]+) ([\d.-]+)$/.exec(attributeOf(attributes,'d') || '');
      if (path && path[2] === path[4]) include(Number(path[1]),Number(path[3]));
    }
  });
  return { bars, systems, signatureWidth };
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
    // Measure once in context: no system breaks, no justification, all visible staves.
    load(buildViewMei(mei, { ...view, breakBefore: [], breakEvery: 0 }), {
      ...common, breaks: 'none', pageWidth: 100000, pageHeight: 60000,
      pageMarginLeft: 0, pageMarginRight: 0, pageMarginTop: 0, pageMarginBottom: 0,
      noJustification: true, adjustPageWidth: true, adjustPageHeight: true, svgBoundingBoxes: true,
    });
    const naturalSvg = tk.renderToSVG(1);
    const measured = measureSvg(naturalSvg);
    if (measured.bars.length !== count) throw new Error('PDF spike: contextual measure count differs.');
    const naturalHeight = dimensions(naturalSvg)[1];
    // Keep the full first measure (including its prefix); additionally reserve room per line
    // for a repeated clef/key/meter. Mid-line changes remain in the complete bar widths.
    let overhead = 120 + measured.signatureWidth;
    let geometry = pageGeometry(opts.paper, naturalHeight, overhead);
    const widths = measured.bars.map(bar => Math.max(1, bar.right - bar.left));
    if (widths.some(width => !Number.isFinite(width))) throw new Error('PDF spike: missing contextual bar extents.');
    const pageOptions = {
      ...common, breaks: 'line', pageWidth: geometry.pageWidth, pageHeight: geometry.pageHeight,
      pageMarginLeft: geometry.margin, pageMarginRight: geometry.margin,
      pageMarginTop: geometry.margin, pageMarginBottom: geometry.margin,
      adjustPageWidth: false, adjustPageHeight: false,
    };
    let lines: PagesResult['lines'] = [], plannedMei = '';
    // Encoded mode is essential here: line mode still width-fits systems even with
    // noJustification, so its extents depend on the requested page width.
    // A new system can repeat a clef/key or add a cautionary signature at the preceding line's
    // end. Observe that extra width in unstretched planned systems and increase the shared
    // per-line reserve before re-planning. Bar measurements always come from the one context pass.
    for (let attempt = 0; ; attempt++) {
      const starts = breakLines(widths, geometry.capacity, opts.maxBars);
      lines = starts.map((start,i)=>({start,count:(starts[i+1] ?? count)-start,width:0}));
      plannedMei = buildViewMei(mei, { ...view, breakBefore: starts });
      load(plannedMei, { ...pageOptions, breaks: 'encoded', noJustification: true, svgBoundingBoxes: true });
      const naturalLines = Array.from({length:tk.getPageCount()},(_,i)=>measureSvg(tk!.renderToSVG(i+1)).systems).flat();
      if (naturalLines.length !== lines.length) throw new Error('PDF spike: natural system count differs.');
      let needed = overhead, overflow = false;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        line.width = naturalLines[i].right - Math.min(0,naturalLines[i].left);
        const content = widths.slice(line.start,line.start+line.count).reduce((a,b)=>a+b,0);
        needed = Math.max(needed,line.width-content+2);
        // A genuinely oversize bar has its own line, per breakLines' contract.
        if (line.count > 1 && line.width > geometry.pageWidth-2*geometry.margin+2) overflow = true;
      }
      if (!overflow) break;
      if (attempt >= count || needed <= overhead) throw new Error('PDF spike: could not fit natural system widths.');
      overhead = needed;
      geometry = pageGeometry(opts.paper,naturalHeight,overhead);
    }
    load(plannedMei, pageOptions);
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
    self.postMessage({ value: { pages, lines, shrunk: geometry.scale < 1 } satisfies PagesResult });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) });
  } finally { tk?.destroy(); }
};
