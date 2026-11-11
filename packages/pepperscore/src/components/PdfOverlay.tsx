import { useEffect, useRef, useState } from 'react';
import type { ExportProgress, ExportRequest } from '../lib/pdf/export';
import type { Score } from '../lib/score';
import type { PitchColourPaint } from '../lib/pitch-colours';
import { verovioBaseline } from '../lib/verovio-runtime';
import { annotationLayout, planStaves } from '../lib/render';
import { ANNOTATION_SCALE, BARS_PER_LINE_MAX, clampBarsPerLine, type Prefs } from '../lib/prefs';

type Snapshot = Omit<ExportRequest, 'options'>;
export type PdfCapture = { score: Score; prefs: Prefs; hiddenPartIds: string[]; channel: number; pitchColours?: PitchColourPaint };
async function prepareSnapshot({ score, prefs: saved, hiddenPartIds, channel, pitchColours }: PdfCapture): Promise<Snapshot> {
  if (!score.document) throw new Error('This score has no engraving document.');
  const hidden = new Set(hiddenPartIds);
  const info = await verovioBaseline(score.document, channel);
  const planned = planStaves(info, score, hidden, { view: saved.tabView, tuning: saved.tabTuning, capo: saved.capo });
  return { score, input: { data: score.document.engravingText, view: { breakEvery: 0, hiddenStaves: planned.hiddenStaves,
    spelling: planned.spelling, chordSymbols: saved.chordSymbols, ...(planned.tabPlan.spec ? { tab: planned.tabPlan.spec } : {}) } },
    visiblePartIds: planned.visibleParts.map(part => part.id), tabAliases: planned.tabAlias, tabStaves: planned.tabStaves, pitchColours,
    annotations: { showNames: saved.names, showCounts: saved.counts, subdivisions: saved.subdivisions,
      showChordSymbols: saved.chordSymbols, inferChordSymbols: saved.inferChordSymbols,
      scale: { names: ANNOTATION_SCALE[saved.namesSize], chordSymbols: ANNOTATION_SCALE[saved.chordSymbolsSize], counts: ANNOTATION_SCALE[saved.countsSize], subdivisions: ANNOTATION_SCALE[saved.subdivisionsSize] } } };
}
/** Engraving runs in a worker, then each page is drawn in turn: say which. */
const buildingText = (progress: ExportProgress | null) => progress && progress.pages ? `Building PDF… ${progress.phase === 'composing' ? 'drawing' : 'preparing'} page ${progress.page} of ${progress.pages}` : 'Building PDF…';
export default function PdfOverlay({ paper, onPaper, snapshot, revision, font, verovioBaseUrl, onClose }: {
  paper: Prefs['pdfPaper']; onPaper: (paper: Prefs['pdfPaper']) => void;
  snapshot: () => PdfCapture; revision: unknown; font: string; verovioBaseUrl?: string; onClose: () => void;
}) {
  const [bars, setBars] = useState(4), [busy, setBusy] = useState(false);
  const [barsDraft, setBarsDraft] = useState('4');
  const commitBars = () => {
    const number = Number(barsDraft);
    const next = barsDraft.trim() && Number.isFinite(number) ? clampBarsPerLine(number) : bars;
    setBars(next); setBarsDraft(String(next));
    return next;
  };
  const [fit, setFit] = useState('Checking fit…'), [error, setError] = useState(''), [progress, setProgress] = useState<ExportProgress | null>(null);
  const panel = useRef<HTMLElement>(null), measure = useRef<AbortController | null>(null), save = useRef<AbortController | null>(null);
  const snapshotRef = useRef(snapshot); snapshotRef.current = snapshot;
  const closeRef = useRef(onClose); closeRef.current = onClose;
  const files = verovioBaseUrl ? { module: new URL('verovio-module.mjs', new URL(verovioBaseUrl.replace(/\/?$/, '/'), document.baseURI)).href,
    toolkit: new URL('verovio.mjs', new URL(verovioBaseUrl.replace(/\/?$/, '/'), document.baseURI)).href } : undefined;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLElement>('select')?.focus({ preventScroll: true });
    const owner = panel.current?.closest('.pepperscore');
    return () => {
      measure.current?.abort(); save.current?.abort();
      const active = document.activeElement;
      if (previous?.isConnected && (active === document.body || (active && owner?.contains(active)))) previous.focus({ preventScroll: true });
    };
  }, []);
  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); return; }
    if (event.key !== 'Tab') return;
    const items = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),select:not(:disabled),input:not(:disabled),a[href]') ?? []);
    const first = items[0], last = items.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  };
  useEffect(() => {
    if (busy) return;
    const controller = new AbortController(); measure.current = controller;
    setFit('Checking fit…');
    void (async () => {
      try {
        const request = await prepareSnapshot(snapshotRef.current());
        controller.signal.throwIfAborted();
        const { engravePages } = await import('../lib/pdf/engrave');
        const visible = request.score.parts.filter(part => !request.visiblePartIds || request.visiblePartIds.includes(part.id));
        const layout = annotationLayout(visible, request.annotations ?? {});
        const metadata = [request.score.title, request.score.subtitle, request.score.composer, ...(request.score.credits ?? [])].filter(Boolean);
        const result = await engravePages({ ...request.input, view: { breakEvery: 0, hiddenStaves: [], chordSymbols: false, ...request.input.view, harmSize: layout.harmSize } },
          { paper, maxBars: bars, font, files, spacingStaff: layout.spacingStaff, annotationRoom: layout.laneHeight, headingMm: metadata.length ? 8 + metadata.length * 4 : 0 }, controller.signal);
        if (controller.signal.aborted) return;
        const reduced = result.lines.filter(line => line.count < bars).length;
        setFit(`${reduced} ${reduced === 1 ? 'line will' : 'lines will'} have fewer than ${bars} bars on ${paper.toUpperCase()}.${result.shrunk ? ' A tall system is reduced to fit the page.' : ''}`);
      } catch (failure) { if (!controller.signal.aborted) setFit(`Fit check unavailable: ${failure instanceof Error ? failure.message : String(failure)}. You can still Save.`); }
    })();
    return () => controller.abort();
  }, [paper, bars, font, verovioBaseUrl, revision, busy]);
  const download = async () => {
    const maxBars = commitBars();
    panel.current?.querySelector<HTMLButtonElement>('.pdf-cancel')?.focus({ preventScroll: true });
    measure.current?.abort();
    const controller = new AbortController(); save.current = controller;
    setBusy(true); setError(''); setProgress(null);
    try {
      // frameElement belongs to the parent's realm; instanceof against this window's
      // HTMLIFrameElement is false even for a same-origin embed.
      const frame = window.frameElement as HTMLIFrameElement | null;
      if (frame?.hasAttribute('sandbox') && !frame.sandbox.contains('allow-downloads')) throw new Error('Downloads are blocked by this embed. Open the score outside the embed or enable downloads.');
      const request = await prepareSnapshot(snapshotRef.current());
      controller.signal.throwIfAborted();
      const { exportScore } = await import('../lib/pdf/export');
      const blob = await exportScore({ ...request, options: { paper, maxBars, font, files }, onProgress: update => { if (!controller.signal.aborted) setProgress(update); } }, controller.signal);
      controller.signal.throwIfAborted();
      const url = URL.createObjectURL(blob), anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${request.score.title?.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'score'}.pdf`;
      document.body.append(anchor);
      try { anchor.click(); } finally { anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 60000); }
      closeRef.current();
    } catch (failure) { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  };
  return <div className="pdf-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={panel} className="pdf-panel" role="dialog" aria-modal="true" aria-label="Export PDF" aria-busy={busy} onKeyDown={onKeyDown}>
      <h2>Export PDF</h2>
      <label className="pdf-field">Paper size<select className="pdf-paper" value={paper} disabled={busy} onChange={event => onPaper(event.target.value as Prefs['pdfPaper'])}>
        <option value="a4">A4</option><option value="a3">A3</option><option value="letter">Letter</option><option value="legal">Legal</option>
      </select></label>
      <label className="pdf-field">Bars per line<input className="pdf-bars" type="number" min={1} max={BARS_PER_LINE_MAX} value={barsDraft} disabled={busy} onChange={event => setBarsDraft(event.target.value)} onBlur={commitBars}/></label>
      <p className="pdf-fit" role="status">{busy ? buildingText(progress) : fit}</p>
      {error && <p className="pdf-error" role="alert">{error}</p>}
      <div className="pdf-actions"><button type="button" className="pdf-cancel" onClick={onClose}>Cancel</button>{error && <button type="button" className="pdf-reload" onClick={() => window.history.go(0)}>Reload page</button>}<button type="button" className="pdf-save" disabled={busy} onClick={() => void download()}>Save</button></div>
    </section>
  </div>;
}
