import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { ChevronDown, ChevronLeft, ChevronRight, Ellipsis, Eye, EyeOff, FileMusic, FolderOpen, Minus, Pause, Play, Plus, RotateCcw, SlidersHorizontal, Square, Settings2, VolumeX, X } from 'lucide-react';
import { exampleScore, gmSoundfontLabel, GM_FAMILIES, GM_SOUNDS, instrumentDetails, type GmFamily, type GmSound, type Part, type Score } from '../lib/score';
import { importFile, parseAbc, parseMusicXml } from '../lib/import';
import { portraitBarLimit, renderScore, type MeasureGeometry, type RenderResult } from '../lib/render';
import { partControlMetrics, type PartControlMetrics } from '../lib/part-controls';
import { HEADER_CONTROLS, MOBILE_HEADER_QUERY, type HeaderControlId } from '../lib/header-controls';
import { clampStaveScale, deviceClass, ENDLESS_STAVE_SCALE, minimumDefaultStaveScale, STAVE_SCALE_MAX, STAVE_SCALE_MIN, STAVE_SCALE_STEP } from '../lib/stave-scale';
import { buildFileState, clampBpm, fileSource, MAX_BPM, MIN_BPM, textSource, type FileSettings, type FileSource, type FileState, type ScoreView } from '../lib/file-state';
import { sampleSource, scoreDb } from '../lib/score-db';
import { scoreForView } from '../lib/transpose';
import { buildPerformanceTimeline, eventsFromSeconds, positionAtSeconds } from '../lib/playback/timeline';
import { disposeVerovio, isSuperseded, prepareVerovio } from '../lib/verovio-runtime';
import { withEngravingDocument } from '../lib/notation/document';
import { SCORE_FILE_ACCEPT } from '../lib/score-files';
import { PAGE_PAD_PX, pageOfSystem, systemPages, turnTarget, type ReadingPage, type SystemSpan } from '../lib/paging';
import OpenScoreDialog from './OpenScoreDialog';
import '@fontsource/poppins/400.css';
import '@fontsource/poppins/500.css';
import '@fontsource/poppins/600.css';
import '@fontsource/poppins/700.css';

/** Reader settings; `zoom` is the score's explicit stave scale, or null for the device default (see stave-scale.ts). */
type Prefs = FileSettings & { zoom: number | null };
const defaults: Prefs = { mode: 'portrait', notationFont: 'Bravura', barsPerLine: 'auto', overlap: 1, names: false, chordSymbols: false, inferChordSymbols: false, counts: false, subdivisions: false, annotationFont: 'Sans', bpm: 96, zoom: null, semitones: 0, scorePitch: 'written' };
const sampleScore = () => withEngravingDocument(exampleScore());
const textFonts = { Sans: 'Poppins, Arial, sans-serif', Serif: 'Georgia, serif', Mono: 'ui-monospace, monospace' } as const;
const sampleAbc = `X:1\nT:A little room to play\nM:4/4\nL:1/4\nQ:1/4=96\nK:C\nC E G c | B A G E | C E G c | d2 c2 | G E D C | E G A G | F E D B, | C4 |`;
const playbackSound = (part: Part) => part.gmSoundfont || (part.instrument === 'drum-kit' ? 'drum-kit' : instrumentDetails(part.instrument).soundfont!);
const audioKey = (part: Part) => playbackSound(part) === 'drum-kit' ? `drum-kit:${part.id}` : playbackSound(part);
const RESUME_TIMEOUT_MS = 1000;
const SILENT_PLAYBACK_NOTICE = 'Audio couldn’t start on this device — playing silently.';
// AudioContext.resume() can stay pending forever (no output device, autoplay policy), so give it a bounded wait.
const resumeAudio = async (context: AudioContext) => {
  if (context.state === 'running') return true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { await Promise.race([context.resume(), new Promise(resolve => { timer = setTimeout(resolve, RESUME_TIMEOUT_MS); })]); }
  catch { /* a rejected resume means no sound; fall through to the state check */ }
  finally { clearTimeout(timer); }
  return (context.state as AudioContextState) === 'running'; // re-read: resume() changes it
};
type AudioPlayer = {
  fallback?: boolean;
  start(options: { note: number; time: number; duration: number; velocity: number; destination?: AudioNode }): () => void;
  stop(): void;
  dispose(): void;
  loadNotes?(notes: number[]): Promise<void>;
};
export type ReaderProps = { musicXml?: string };
/** The widest control gutter a viewport can spare. */
const maxControlGutter = (width: number) => Math.max(120, Math.round(width * .42));
/** Keyboard steps on the stave scale slider commit once they settle; drags and pinches commit on release. */
const STAVE_SCALE_COMMIT_MS = 180;
/** A per-score record read never holds up the first paint for longer than this. */
const SCORE_RECORD_TIMEOUT_MS = 1200;
const readScoreRecord = (source: FileSource) => Promise.race([
  scoreDb.read(source).catch(() => null),
  new Promise<null>(resolve => setTimeout(() => resolve(null), SCORE_RECORD_TIMEOUT_MS)),
]);
/** After a user scroll (wheel, scrollbar drag, page turn) playback follow leaves the view alone this long. */
const FOLLOW_SUSPEND_MS = 2500;
/** A programmatic smooth scroll counts as in flight until it lands, or for at most this long. */
const SCROLL_SETTLE_MS = 900;
const scrollBehavior = (): ScrollBehavior => window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
/** Where the viewport centre sits in a measure, so a re-layout can put that point back at the centre. */
type ZoomAnchor = { index: number; fx: number; fy: number };

export default function Reader({ musicXml }: ReaderProps) {
  const [score, setScore] = useState<Score>(sampleScore);
  const [scoreRevision, setScoreRevision] = useState(0);
  const [prefs, setPrefs] = useState<Prefs>(defaults);
  const [source, setSource] = useState<FileSource | null>(null);
  const [hiddenIds, setHiddenIds] = useState<string[]>([]);
  const [trackVolumes, setTrackVolumes] = useState<Record<string, number>>({});
  const [drawer, setDrawer] = useState(false);
  const [mixer, setMixer] = useState(false);
  const [openDialog, setOpenDialog] = useState(false);
  const [pickerPartId, setPickerPartId] = useState<string | null>(null);
  const [pickerFamily, setPickerFamily] = useState<GmFamily>('Keyboard');
  const [pickerPage, setPickerPage] = useState(0);
  const [abc, setAbc] = useState(sampleAbc);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [playing, setPlaying] = useState(false);
  const [loadingAudio, setLoadingAudio] = useState(false);
  const [loadingFont, setLoadingFont] = useState(false);
  const [painted, setPainted] = useState(false);
  const [painting, setPainting] = useState(true);
  const [resizeTick, setResizeTick] = useState(0);
  /** Bumped when systems are drawn, released or resized after the first paint (large scores draw on demand). */
  const [layoutTick, setLayoutTick] = useState(0);
  const [active, setActive] = useState<string | null>(null);
  const [activeNotes, setActiveNotes] = useState<string[]>([]);
  const [position, setPosition] = useState(0);
  const [ready, setReady] = useState(false);
  const [staffCenters, setStaffCenters] = useState<Record<string, number>>({});
  const [controlMetrics, setControlMetrics] = useState<PartControlMetrics>(() => partControlMetrics(72));
  const [zoomDraft, setZoomDraft] = useState<number | null>(null);
  const zoomCommitRef = useRef(0);
  /** Stave scale of the score on screen (the resolved default when prefs.zoom is null). */
  const [renderedZoom, setRenderedZoom] = useState(1);
  const renderedZoomRef = useRef(1);
  const prefsZoomRef = useRef<number | null>(null);
  prefsZoomRef.current = prefs.zoom;
  /** Slider floor: STAVE_SCALE_MIN, or lower when a many-staff height fit is smaller. */
  const staveScaleMinRef = useRef(STAVE_SCALE_MIN);
  const savedViewRef = useRef<ScoreView | undefined>(undefined);
  /** The next render is a zoom commit: no paint reveal or loading overlay, and the anchor measure is kept centred. */
  const quietRenderRef = useRef(false);
  const zoomAnchorRef = useRef<ZoomAnchor | null>(null);
  const previewOriginRef = useRef<{ x: number; y: number } | null>(null);
  /** A pointer is pressed on the stave scale slider. */
  const sliderPointerRef = useRef(false);
  /** Zoom handed to the pending quiet render, so a duplicate release (change + pointerup) does not commit twice. */
  const pendingZoomRef = useRef<number | null>(null);
  /** Latest native `change` handler for the slider (React's onChange is the `input` event). */
  const staveScaleChangeRef = useRef<(input: HTMLInputElement) => void>(() => {});
  const staveScaleInputRef = useRef<HTMLInputElement | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const [scoreWidth, setScoreWidth] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const renderRef = useRef<RenderResult | null>(null);
  const audioRef = useRef<{ context: AudioContext; master: DynamicsCompressorNode; players: Map<string, AudioPlayer[]>; trackGains: Map<string, GainNode>; mixScale: number } | null>(null);
  const playRef = useRef<{ start: number; beat: number; frame: number; interval?: ReturnType<typeof setInterval> } | null>(null);
  const scheduledStopsRef = useRef<Array<{ stop: () => void; end: number }>>([]);
  const playRunRef = useRef(0);
  const importRunRef = useRef(0);
  const renderRunRef = useRef(0);
  const swipeRef = useRef<{ x: number; y: number } | null>(null);
  const pinchRef = useRef<{ distance: number; zoom: number; nextZoom: number } | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const hasPaintedRef = useRef(false);
  const modeRef = useRef(prefs.mode);
  modeRef.current = prefs.mode;
  const overlapRef = useRef(prefs.overlap);
  overlapRef.current = prefs.overlap;
  /** Vertical reading pages (see paging.ts), recomputed from the rendered systems whenever they are used. */
  const pagesRef = useRef<{ pages: ReadingPage[]; spans: SystemSpan[] }>({ pages: [], spans: [] });
  /** Extra space below the score so the last page start can reach the viewport top. */
  const pageTailRef = useRef(0);
  /** Destination of the last programmatic smooth scroll, so a turn or follow during it builds on where it lands. */
  const scrollTargetRef = useRef<{ top: number; left: number; at: number } | null>(null);
  const userScrollAtRef = useRef(-Infinity);
  const hiddenSet = useMemo(() => new Set(hiddenIds), [hiddenIds]);
  const visibleScore = useMemo(() => {
    const parts = score.parts.filter(part => !hiddenSet.has(part.id));
    return { ...score, parts: parts.length ? parts : score.parts.slice(0, 1) };
  }, [score, hiddenSet]);
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    for (const [id, gain] of audio.trackGains) gain.gain.setTargetAtTime((trackVolumes[id] ?? 100) / 100 * audio.mixScale, audio.context.currentTime, .015);
  }, [trackVolumes]);
  // Verovio can only transpose written pitch to sounding pitch, so concert-basis scores always show concert pitch.
  const concertBasis = score.parts.some(part => part.pitchBasis === 'concert');
  const scorePitch = concertBasis ? 'concert' : prefs.scorePitch;
  const displayScore = useMemo(() => scoreForView(score, scorePitch, prefs.semitones), [score, scorePitch, prefs.semitones]);
  const hasTransposingParts = score.parts.some(part => part.transposition?.semitones || part.measures.some(measure => measure.transposition?.semitones));
  // The performance timeline is built when playback first needs it, not while a score loads: on a large score it is
  // seconds of main-thread work that would otherwise hold up the first paint (docs/specs/large-score-performance.md).
  const timelineOf = useMemo(() => {
    let built: ReturnType<typeof buildPerformanceTimeline> | undefined;
    return () => built ??= buildPerformanceTimeline(visibleScore, { bpm: prefs.bpm, semitones: prefs.semitones, fullScore: score });
  }, [visibleScore, score, prefs.bpm, prefs.semitones]);

  useEffect(() => {
    try {
      // Zoom is per score (score-db), so a legacy global zoom is ignored.
      const { zoom: _legacyZoom, ...saved } = JSON.parse(localStorage.getItem('scoreflow-prefs') || '{}');
      const next = { ...defaults, ...saved, zoom: null };
      if (typeof next.barsPerLine === 'number') next.barsPerLine = Math.max(1, Math.min(4, next.barsPerLine));
      if (!Number.isInteger(next.semitones)) next.semitones = 0;
      next.semitones = Math.max(-12, Math.min(12, next.semitones));
      if (!['written', 'concert'].includes(next.scorePitch)) next.scorePitch = 'written';
      if (!['Sans', 'Serif', 'Mono'].includes(next.annotationFont)) next.annotationFont = 'Sans';
      setPrefs(next);
    }
    catch { /* keep defaults */ }
    // The sample's record (saved zoom and settings) is read before the first paint; the musicXml prop loads its own.
    if (musicXml) { setReady(true); return; }
    let cancelled = false;
    const sample = score;
    const src = sampleSource(sample);
    void readScoreRecord(src).then(saved => {
      if (cancelled) return;
      if (importRunRef.current === 0) loadScore(sample, src, saved);
      setReady(true);
    });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => { if (ready) { const { zoom: _zoom, ...global } = prefs; localStorage.setItem('scoreflow-prefs', JSON.stringify(global)); } }, [prefs, ready]);
  useEffect(() => {
    if (!ready || !source) return;
    const view = prefs.zoom !== null ? { zoom: prefs.zoom, zoomDevice: deviceClass() } : savedViewRef.current;
    savedViewRef.current = view;
    scoreDb.write(buildFileState(source, prefs, score, hiddenIds, trackVolumes, view));
  }, [ready, source, prefs, score, hiddenIds, trackVolumes]);
  // Unload can cut an IndexedDB transaction short, so pending writes are also saved synchronously (write-ahead).
  useEffect(() => {
    const persist = () => scoreDb.persistPending();
    const hidden = () => { if (document.visibilityState === 'hidden') persist(); };
    window.addEventListener('pagehide', persist);
    document.addEventListener('visibilitychange', hidden);
    return () => { window.removeEventListener('pagehide', persist); document.removeEventListener('visibilitychange', hidden); void scoreDb.flush(); };
  }, []);
  const update = (patch: Partial<Prefs>) => {
    if (['mode', 'notationFont', 'annotationFont', 'barsPerLine', 'names', 'chordSymbols', 'inferChordSymbols', 'counts', 'subdivisions', 'semitones', 'scorePitch'].some(key => key in patch && patch[key as keyof Prefs] !== prefs[key as keyof Prefs])) setPainting(true);
    if (patch.mode && patch.mode !== prefs.mode) viewportRef.current?.scrollTo({ left: 0, top: 0 });
    setPrefs(prev => ({ ...prev, ...patch }));
  };
  const stop = useCallback((reset = false) => {
    playRunRef.current += 1;
    if (playRef.current) { cancelAnimationFrame(playRef.current.frame); clearInterval(playRef.current.interval); }
    playRef.current = null;
    scheduledStopsRef.current.splice(0).forEach(item => item.stop());
    audioRef.current?.players.forEach(players => players.forEach(player => player.stop()));
    setPlaying(false);
    setLoadingAudio(false);
    if (reset) { setPosition(0); setActive(null); setActiveNotes([]); }
  }, []);
  const changePitch = (patch: Partial<Prefs>) => { stop(true); update(patch); };
  /** Show a score with its saved record (if any). The saved zoom applies only on the device class it was chosen on. */
  const loadScore = (next: Score, nextSource: FileSource, saved: FileState | null) => {
    const device = deviceClass();
    savedViewRef.current = saved?.view;
    const zoom = saved?.view?.zoomDevice === device ? saved.view.zoom : null;
    const restored = saved ? { ...next, parts: next.parts.map(part => {
      const state = saved.parts[part.id];
      if (!state) return part;
      return { ...part, instrument: state.instrument, gmSoundfont: state.gmSoundfont || (state.instrument === part.instrument ? part.gmSoundfont : instrumentDetails(state.instrument).soundfont || undefined) };
    }) } : next;
    stop(true); setPainting(true); setPickerPartId(null); setScore(restored); setScoreRevision(value => value + 1); setSource(nextSource);
    setHiddenIds(saved ? next.parts.filter(part => saved.parts[part.id]?.visible === false).map(part => part.id) : []);
    setTrackVolumes(saved ? Object.fromEntries(next.parts.map(part => [part.id, saved.parts[part.id]?.volume ?? 100])) : {});
    setError('');
    setPrefs(prev => saved ? { ...prev, ...saved.settings, zoom } : { ...prev, bpm: clampBpm(Math.round(next.tempo)), zoom: null, semitones: 0, scorePitch: next.parts.some(part => part.pitchBasis === 'concert') ? 'concert' : 'written' });
    viewportRef.current?.scrollTo({ left: 0, top: 0 });
    setDrawer(false);
  };
  useEffect(() => {
    if (!musicXml) return;
    const run = ++importRunRef.current;
    stop(true); setPainting(true);
    void (async () => {
      try {
        const src = textSource('musicxml', musicXml, 'MusicXML');
        const record = readScoreRecord(src);
        const next = parseMusicXml(musicXml);
        if (next.document) await prepareVerovio(next.document);
        const saved = await record;
        if (run === importRunRef.current) loadScore(next, src, saved);
      } catch (e) {
        if (run === importRunRef.current) { setPainting(false); setError(e instanceof Error ? e.message : 'Could not read the supplied MusicXML.'); }
      }
    })();
    return () => { importRunRef.current++; };
  }, [musicXml]);
  const readFile = async (file?: File) => {
    if (!file) return;
    const run = ++importRunRef.current;
    stop(true);
    setPainting(true);
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    try {
      // The file is read and hashed once; the saved record is read while the score imports, so its zoom is applied
      // before the first paint.
      const bytes = new Uint8Array(await file.arrayBuffer());
      const nextSource = await fileSource(file, bytes);
      const [saved, nextScore] = await Promise.all([readScoreRecord(nextSource), importFile(file, { bytes, sha256: nextSource.sha256 })]);
      if (nextScore.document) await prepareVerovio(nextScore.document);
      if (run === importRunRef.current) loadScore(nextScore, nextSource, saved);
    }
    catch (e) { if (run === importRunRef.current) { setPainting(false); setError(e instanceof Error ? e.message : 'Could not open this file.'); } }
  };
  const readAbc = async (text: string) => {
    const run = ++importRunRef.current;
    setPainting(true);
    try {
      const src = textSource('abc', text, 'Pasted ABC');
      const [next, saved] = await Promise.all([parseAbc(text), readScoreRecord(src)]);
      if (run === importRunRef.current) loadScore(next, src, saved);
    } catch (e) { if (run === importRunRef.current) { setPainting(false); setError(e instanceof Error ? e.message : 'Could not read ABC notation.'); } }
  };
  const loadSample = async () => {
    const run = ++importRunRef.current;
    setPainting(true);
    const sample = sampleScore();
    const src = sampleSource(sample);
    const saved = await readScoreRecord(src);
    if (run === importRunRef.current) loadScore(sample, src, saved);
  };
  const togglePart = (id: string) => {
    if (!hiddenSet.has(id) && visibleScore.parts.length <= 1) return;
    stop(true); setPainting(true);
    setHiddenIds(previous => previous.includes(id) ? previous.filter(partId => partId !== id) : [...previous, id]);
    viewportRef.current?.scrollTo({ left: 0, top: 0 });
  };
  const resetStaves = () => { stop(true); setPainting(true); setHiddenIds([]); viewportRef.current?.scrollTo({ left: 0, top: 0 }); };
  // Stave scale: while dragging or pinching, a GPU transform previews the new size around the viewport centre;
  // the commit re-lays out at the new scale in place (no paint reveal) and keeps the centre measure centred.
  const viewportCentre = () => {
    const viewport = viewportRef.current;
    if (!viewport) return null;
    const view = viewport.getBoundingClientRect();
    return { x: view.left + viewport.clientLeft + viewport.clientWidth / 2, y: view.top + viewport.clientTop + viewport.clientHeight / 2 };
  };
  // The whole score content (title included) is scaled, with the paint-reveal transition off so it tracks the pointer.
  const previewStaveScale = (draft: number) => {
    const content = contentRef.current, centre = viewportCentre();
    if (!content || !centre) return;
    if (!previewOriginRef.current) {
      const box = content.getBoundingClientRect();
      previewOriginRef.current = { x: centre.x - box.left, y: centre.y - box.top };
      content.style.transition = 'none';
      content.style.transformOrigin = `${previewOriginRef.current.x}px ${previewOriginRef.current.y}px`;
      content.style.willChange = 'transform';
    }
    content.style.transform = `scale(${draft / renderedZoomRef.current})`;
  };
  const clearStaveScalePreview = () => {
    const content = contentRef.current;
    if (!previewOriginRef.current || !content) return;
    previewOriginRef.current = null;
    content.style.transform = ''; content.style.transformOrigin = ''; content.style.willChange = '';
    // Settle the style without a transition, then hand the reveal transition back.
    void getComputedStyle(content).transform;
    content.style.transition = '';
  };
  const captureZoomAnchor = (): ZoomAnchor | null => {
    const centre = viewportCentre(), measures = renderRef.current?.measures;
    if (!centre || !measures?.length) return null;
    let best: { measure: MeasureGeometry; rect: DOMRect; distance: number } | null = null;
    for (const measure of measures) {
      const rect = measure.element?.getBoundingClientRect();
      if (!rect || !rect.width) continue;
      const distance = Math.hypot(Math.max(rect.left - centre.x, 0, centre.x - rect.right), Math.max(rect.top - centre.y, 0, centre.y - rect.bottom));
      if (!best || distance < best.distance) best = { measure, rect, distance };
    }
    if (!best) return null;
    const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
    return { index: best.measure.index, fx: clamp01((centre.x - best.rect.left) / best.rect.width), fy: clamp01((centre.y - best.rect.top) / best.rect.height) };
  };
  const restoreZoomAnchor = (anchor: ZoomAnchor, result: RenderResult, mode: Prefs['mode']) => {
    const viewport = viewportRef.current, centre = viewportCentre();
    // An undrawn anchor (a large score draws systems on demand) falls back to its system block from layout data, with
    // the measure's share of it: exact for a drawn measure, approximate (equal-width measures) otherwise.
    let rect = result.measure(anchor.index)?.element?.getBoundingClientRect();
    if (!rect) {
      const system = result.systems[result.systemOfMeasure(anchor.index)];
      const block = system && canvasRef.current?.querySelector<HTMLElement>(`:scope > .score-system[data-system="${system.index}"]`)?.getBoundingClientRect();
      if (block && system.measureCount > 0) {
        const share = block.width / system.measureCount;
        rect = new DOMRect(block.left + share * Math.max(0, anchor.index - system.firstMeasure), block.top, share, block.height);
      }
    }
    if (!viewport || !centre || !rect) return;
    const dx = rect.left + anchor.fx * rect.width - centre.x, dy = rect.top + anchor.fy * rect.height - centre.y;
    // Endless keeps its vertical centring; Vertical scrolls the anchor's system back to the centre.
    if (mode === 'landscape') viewport.scrollLeft += dx;
    else viewport.scrollTop += dy;
  };
  const commitStaveScale = (value: number) => {
    window.clearTimeout(zoomCommitRef.current);
    const next = clampStaveScale(value, staveScaleMinRef.current);
    setZoomDraft(null);
    const committed = quietRenderRef.current ? pendingZoomRef.current : prefsZoomRef.current;
    if (next === committed) { if (!quietRenderRef.current) clearStaveScalePreview(); return; }
    zoomAnchorRef.current = captureZoomAnchor();
    quietRenderRef.current = true;
    pendingZoomRef.current = next;
    setPrefs(prev => ({ ...prev, zoom: next }));
  };
  // `input` (React onChange) previews and moves the label; the native `change` event commits. Range inputs fire
  // `change` on release after a drag and once per keyboard step, so keyboard steps are debounced.
  const draftStaveScale = (value: number) => {
    const next = clampStaveScale(value, staveScaleMinRef.current);
    setZoomDraft(next);
    previewStaveScale(next);
  };
  staveScaleChangeRef.current = input => {
    window.clearTimeout(zoomCommitRef.current);
    const value = Number(input.value);
    if (sliderPointerRef.current) { sliderPointerRef.current = false; commitStaveScale(value); }
    else zoomCommitRef.current = window.setTimeout(() => commitStaveScale(value), STAVE_SCALE_COMMIT_MS);
  };
  // Fallback for engines that end a drag without `change`: commit on release if the value moved.
  const releaseStaveScale = (input: HTMLInputElement) => {
    if (!sliderPointerRef.current) return;
    sliderPointerRef.current = false;
    commitStaveScale(Number(input.value));
  };
  const onStaveScaleChange = useCallback((event: Event) => staveScaleChangeRef.current(event.currentTarget as HTMLInputElement), []);
  // The slider remounts when it moves in or out of the More panel, so (re)attach the native listener by ref.
  const staveScaleInput = useCallback((input: HTMLInputElement | null) => {
    staveScaleInputRef.current?.removeEventListener('change', onStaveScaleChange);
    staveScaleInputRef.current = input;
    input?.addEventListener('change', onStaveScaleChange);
  }, [onStaveScaleChange]);
  useEffect(() => () => window.clearTimeout(zoomCommitRef.current), []);
  useEffect(() => {
    if (!moreOpen) return;
    // Layout is CSS-only (styles.css); this listener just closes an open panel once the header widens past the breakpoint.
    const compact = window.matchMedia(MOBILE_HEADER_QUERY);
    const widened = () => { if (!compact.matches) setMoreOpen(false); };
    compact.addEventListener('change', widened);
    const outside = (event: PointerEvent) => { if (!moreRef.current?.contains(event.target as Node)) setMoreOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setMoreOpen(false); moreRef.current?.querySelector<HTMLButtonElement>('.header-more-toggle')?.focus(); } };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { compact.removeEventListener('change', widened); document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [moreOpen]);
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    let width = viewport.clientWidth;
    let height = viewport.clientHeight;
    const observer = new ResizeObserver(() => {
      // A height change keeps the layout but changes how many systems make a page.
      if (Math.abs(viewport.clientHeight - height) >= 1) { height = viewport.clientHeight; refreshPagesRef.current(); }
      if (Math.abs(viewport.clientWidth - width) < 1) return;
      width = viewport.clientWidth;
      setResizeTick(value => value + 1);
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !ready) return;
    let disposed = false;
    const generation = ++renderRunRef.current;
    let timer = 0;
    let frame = 0;
    // A zoom commit keeps the current score on screen until the new layout replaces it in place.
    const quiet = quietRenderRef.current;
    quietRenderRef.current = false;
    const anchor = quiet ? zoomAnchorRef.current : null;
    zoomAnchorRef.current = null;
    if (!quiet) setPainting(true);
    const draw = async () => {
      try {
        if (disposed) return;
        setScoreWidth(previous => previous === canvas.clientWidth ? previous : canvas.clientWidth);
        const many = displayScore.parts.length > 4;
        const maxGutter = maxControlGutter(canvas.clientWidth);
        const metricsFor = (stavePx: number, staffPitchPx: number) => partControlMetrics(stavePx, { staffPitchPx, maxGutter, eye: many });
        const metaHeight = canvas.closest('.score-content')?.querySelector('.score-meta')?.getBoundingClientRect().height || 0;
        const availableHeight = Math.max(120, (viewportRef.current?.clientHeight || 600) - metaHeight - 70);
        // Without a user zoom the default ('fit': four bars in Vertical) is re-resolved for the viewport, so rotation re-fits.
        const requested = prefs.zoom ?? 'fit';
        const result = await renderScore(canvas, displayScore, prefs.mode, prefs.names, prefs.counts, prefs.subdivisions, prefs.barsPerLine, prefs.chordSymbols, prefs.inferChordSymbols, availableHeight, requested, 0, { gutterFor: (stavePx, staffPitchPx) => metricsFor(stavePx, staffPitchPx).gutter, fitCap: ENDLESS_STAVE_SCALE[deviceClass()], fitFloor: minimumDefaultStaveScale(deviceClass()), font: prefs.notationFont, textFont: prefs.annotationFont, transpose: prefs.semitones, scorePitch, hiddenPartIds: hiddenIds, generation, focusMeasure: anchor?.index });
        if (disposed || generation !== renderRunRef.current) { result.dispose(); return; }
        renderRef.current = result;
        // Systems drawn later (scrolling, playback) change block sizes: re-page, and let the playhead find new notes.
        result.onChange(() => {
          refreshPagesRef.current();
          canvas.closest<HTMLElement>('.score-content')?.style.setProperty('--landscape-content-width', `${canvas.scrollWidth + 88}px`);
          setLayoutTick(value => value + 1);
        });
        renderedZoomRef.current = result.zoom;
        const metrics = metricsFor(result.stavePx, result.staffPitchPx);
        // Commit the controls with the new SVG so no frame shows them against the other layout.
        flushSync(() => {
          setStaffCenters(Object.fromEntries(result.visiblePartIds.map((id, index) => [id, result.staffCenters[index]])));
          setControlMetrics(metrics);
          setRenderedZoom(result.zoom);
        });
        const content = canvas.closest<HTMLElement>('.score-content');
        // Staff controls size from the rendered stave, so their ratio to it holds at every zoom and fit.
        content?.style.setProperty('--stave-px', `${result.stavePx.toFixed(2)}px`);
        content?.style.setProperty('--stave-scale', (result.stavePx / 72).toFixed(4));
        content?.style.setProperty('--landscape-staff-center', `${result.visiblePartIds.length > 4 ? result.systemHeight / 2 : result.staffCenters[0] ?? 74}px`);
        content?.style.setProperty('--landscape-content-width', `${canvas.scrollWidth + 88}px`);
        const stage = canvas.closest<HTMLElement>('.score-stage');
        stage?.style.setProperty('--control-gutter', `${result.gutter}px`);
        clearStaveScalePreview();
        refreshPages();
        if (anchor) restoreZoomAnchor(anchor, result, prefs.mode);
        setError('');
      } catch (e) { if (!disposed && !isSuperseded(e)) setError(e instanceof Error ? e.message : 'Could not draw this score.'); }
      finally {
        if (!disposed) frame = requestAnimationFrame(() => {
          hasPaintedRef.current = true;
          setPainted(true);
          setPainting(false);
        });
      }
    };
    setLoadingFont(false);
    const delay = !quiet && hasPaintedRef.current && !window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 260 : 0;
    timer = window.setTimeout(() => void draw(), delay);
    return () => { disposed = true; window.clearTimeout(timer); cancelAnimationFrame(frame); };
  }, [ready, resizeTick, scoreRevision, hiddenIds, prefs.mode, prefs.notationFont, prefs.annotationFont, prefs.names, prefs.chordSymbols, prefs.inferChordSymbols, prefs.counts, prefs.subdivisions, prefs.barsPerLine, prefs.zoom, prefs.semitones, scorePitch]);

  /** Each rendered system's top and bottom in the viewport's scroll coordinates (score title included). */
  const systemSpans = (): SystemSpan[] => {
    const viewport = viewportRef.current, canvas = canvasRef.current, content = contentRef.current;
    if (!viewport || !canvas || !content) return [];
    const blocks = [...canvas.querySelectorAll<HTMLElement>(':scope > .score-system')];
    // Rects are exact but follow the paint-reveal and zoom-preview transforms; offsets ignore them (whole pixels).
    if (getComputedStyle(content).transform === 'none') {
      const origin = viewport.getBoundingClientRect().top + viewport.clientTop - viewport.scrollTop;
      return blocks.map(block => { const rect = block.getBoundingClientRect(); return { top: rect.top - origin, bottom: rect.bottom - origin }; });
    }
    return blocks.map(block => {
      let top = 0;
      for (let element: HTMLElement | null = block; element && element !== viewport; element = element.offsetParent as HTMLElement | null) top += element.offsetTop;
      return { top, bottom: top + block.offsetHeight };
    });
  };
  /** Recompute the Vertical pages from the rendered systems, and pad the score so the last page start is reachable. */
  const refreshPages = () => {
    const viewport = viewportRef.current, content = contentRef.current;
    if (!viewport || !content) return pagesRef.current;
    const spans = modeRef.current === 'portrait' ? systemSpans() : [];
    // The pad above a page stays inside the previous system's blank bottom margin (20 Verovio units).
    const pad = Math.min(PAGE_PAD_PX, 16 * (renderRef.current?.scale ?? 1));
    const pages = spans.length ? systemPages(spans, viewport.clientHeight, overlapRef.current, pad) : [];
    const lastStart = pages.at(-1)?.start ?? 0;
    const tail = lastStart > 0 ? Math.max(0, Math.ceil(lastStart + viewport.clientHeight - (viewport.scrollHeight - pageTailRef.current))) : 0;
    if (tail !== pageTailRef.current) { pageTailRef.current = tail; content.style.setProperty('--page-tail', `${tail}px`); }
    return pagesRef.current = { pages, spans };
  };
  const refreshPagesRef = useRef(refreshPages);
  refreshPagesRef.current = refreshPages;
  const scrollViewport = (to: { top?: number; left?: number }) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const top = Math.max(0, Math.min(viewport.scrollHeight - viewport.clientHeight, to.top ?? viewport.scrollTop));
    const left = Math.max(0, Math.min(viewport.scrollWidth - viewport.clientWidth, to.left ?? viewport.scrollLeft));
    // Already there: nothing will be in flight (and no scroll event will mark it landed).
    scrollTargetRef.current = Math.abs(viewport.scrollTop - top) <= 1 && Math.abs(viewport.scrollLeft - left) <= 1 ? null : { top, left, at: performance.now() };
    viewport.scrollTo({ top, left, behavior: scrollBehavior() });
  };
  /** The destination of a programmatic scroll that has not landed yet. */
  const pendingScroll = () => {
    const viewport = viewportRef.current, target = scrollTargetRef.current;
    if (!viewport || !target || performance.now() - target.at > SCROLL_SETTLE_MS) return null;
    return Math.abs(viewport.scrollTop - target.top) > 1 || Math.abs(viewport.scrollLeft - target.left) > 1 ? target : null;
  };
  // Endless turns by a viewport less the overhang bars; Vertical turns to the next or previous system page.
  const turn = useCallback((direction: number) => {
    const el = viewportRef.current;
    if (!el) return;
    userScrollAtRef.current = performance.now();
    const pending = pendingScroll();
    if (prefs.mode === 'landscape') {
      const step = Math.max(100, el.clientWidth - prefs.overlap * (renderRef.current?.barWidth || 230));
      scrollViewport({ left: (pending?.left ?? el.scrollLeft) + direction * step });
    } else {
      const target = turnTarget(refreshPages().pages, pending?.top ?? el.scrollTop, direction);
      if (target !== null) scrollViewport({ top: target });
    }
  }, [prefs.mode, prefs.overlap]);
  useEffect(() => { refreshPages(); }, [prefs.mode, prefs.overlap]);
  // Wheel and scrollbar drags are the reader's own scrolling: playback follow waits for them.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const manual = () => { userScrollAtRef.current = performance.now(); scrollTargetRef.current = null; };
    const scrollbar = (event: PointerEvent) => { if (event.target === viewport) manual(); };
    // A programmatic scroll that has landed is no longer in flight: a touch or other scroll away from it within
    // SCROLL_SETTLE_MS must not make the next turn or follow build on that stale destination.
    const landed = () => {
      const target = scrollTargetRef.current;
      if (target && Math.abs(viewport.scrollTop - target.top) <= 1 && Math.abs(viewport.scrollLeft - target.left) <= 1) scrollTargetRef.current = null;
    };
    viewport.addEventListener('wheel', manual, { passive: true });
    viewport.addEventListener('pointerdown', scrollbar);
    viewport.addEventListener('scroll', landed, { passive: true });
    return () => { viewport.removeEventListener('wheel', manual); viewport.removeEventListener('pointerdown', scrollbar); viewport.removeEventListener('scroll', landed); };
  }, []);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && pickerPartId) { setPickerPartId(null); return; }
      if (event.key === 'Escape' && mixer) { setMixer(false); return; }
      if (pickerPartId || mixer || openDialog) return;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((event.target as HTMLElement).tagName)) return;
      if (['PageDown', 'ArrowRight', 'ArrowDown', ' '].includes(event.key)) { event.preventDefault(); turn(1); }
      if (['PageUp', 'ArrowLeft', 'ArrowUp'].includes(event.key)) { event.preventDefault(); turn(-1); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [turn, mixer, pickerPartId, openDialog]);
  // Where the playhead is when no engraved note marks it (an empty intro, rest bars, or an unmapped note):
  // the measure and its fraction, quantized to a 32nd of the bar so the effect below re-runs only as the line moves.
  const measureCursor = useMemo(() => {
    if (!playing && position <= 0) return null;
    if (active && renderRef.current?.point(active)?.element) return null;
    const current = positionAtSeconds(timelineOf(), position);
    const length = visibleScore.parts[0]?.measures[current.measureIndex]?.beats || 0;
    const fraction = length > 0 ? Math.max(0, Math.min(1, current.measureBeat / length)) : 0;
    return { measureIndex: current.measureIndex, fraction: Math.floor(fraction * 32) / 32 };
  }, [active, playing, position, timelineOf, visibleScore, layoutTick]);
  const measureCursorKey = measureCursor ? `${measureCursor.measureIndex}:${measureCursor.fraction}` : '';
  useEffect(() => {
    const result = renderRef.current;
    const note = active ? result?.point(active) : undefined;
    canvasRef.current?.querySelectorAll('.reader-note.is-playing').forEach(n => n.classList.remove('is-playing'));
    canvasRef.current?.querySelectorAll('.playback-line').forEach(n => n.remove());
    for (const id of activeNotes) {
      const point = result?.point(id);
      if (point && !point.rest) point.element?.classList.add('is-playing');
    }
    // A note marks the playhead; otherwise it moves through the current measure's engraved bounds.
    const measure = !note?.element && measureCursor ? result?.measure(measureCursor.measureIndex) : undefined;
    const anchor = note?.element || measure?.element;
    // The playhead's system may not be drawn yet (large scores draw systems on demand): draw it, and this effect runs
    // again when it lands (layoutTick). Follow still scrolls to its placeholder block meanwhile.
    const pendingSystem = !anchor && measureCursor && result ? result.systemOfMeasure(measureCursor.measureIndex) : -1;
    if (pendingSystem >= 0) void result!.ensureSystem(pendingSystem);
    const block = anchor ? anchor.closest<HTMLElement>('.score-system') : pendingSystem >= 0 ? canvasRef.current?.querySelector<HTMLElement>(`:scope > .score-system[data-system="${pendingSystem}"]`) : null;
    if (!block) return;
    const line = anchor ? document.createElement('div') : null;
    if (line) {
      line.className = 'playback-line';
      line.style.left = `${note?.element ? note.x : measure!.x + measure!.width * measureCursor!.fraction}px`;
      block.appendChild(line);
    }
    // Follow playback in page jumps: nothing moves while the active system is in view, a smooth scroll in flight
    // is left to land, and a reader who just scrolled keeps their view for a moment.
    const viewport = viewportRef.current;
    if (!viewport || !playRef.current || performance.now() - userScrollAtRef.current < FOLLOW_SUSPEND_MS || pendingScroll()) return;
    if (prefs.mode === 'landscape') {
      const view = viewport.getBoundingClientRect();
      const x = (line || block).getBoundingClientRect().left;
      if (x > view.left + view.width * .78 || x < view.left + view.width * .18) scrollViewport({ left: viewport.scrollLeft + x - view.left - view.width * .35 });
      return;
    }
    const { pages, spans } = refreshPages();
    const index = [...canvasRef.current?.querySelectorAll(':scope > .score-system') || []].indexOf(block);
    const span = spans[index], page = pageOfSystem(pages, index);
    if (!span || !page) return;
    const top = viewport.scrollTop, bottom = top + viewport.clientHeight;
    // A tall system is followed while any of it (and so the playback line) is in view; others must be wholly in view.
    const inView = page.tall ? span.top < bottom && span.bottom > top : span.top >= top - 1 && span.bottom <= bottom + 1;
    if (!inView && Math.abs(page.start - top) > 1) scrollViewport({ top: page.start });
  // measureCursor is read through its key, so the effect re-runs when the line moves rather than on every frame.
  }, [active, activeNotes, prefs.mode, painting, measureCursorKey, layoutTick]);

  // Returns null when the device can't produce sound (no output device, autoplay blocked, resume() never settling),
  // so playback falls back to a silent wall-clock run instead of hanging on a suspended AudioContext.
  const ensureAudio = async () => {
    if (!audioRef.current) {
      let context: AudioContext;
      try { context = new AudioContext(); } catch { return null; }
      const master = context.createDynamicsCompressor();
      master.threshold.value = -15;
      master.knee.value = 12;
      master.ratio.value = 4;
      master.attack.value = .003;
      master.release.value = .18;
      master.connect(context.destination);
      audioRef.current = { context, master, players: new Map(), trackGains: new Map(), mixScale: 1 };
    }
    const audio = audioRef.current;
    if (!await resumeAudio(audio.context)) return null;
    audio.mixScale = .8 / Math.sqrt(Math.max(1, visibleScore.parts.length));
    for (const part of visibleScore.parts) {
      let gain = audio.trackGains.get(part.id);
      if (!gain) { gain = audio.context.createGain(); gain.connect(audio.master); audio.trackGains.set(part.id, gain); }
      gain.gain.value = (trackVolumes[part.id] ?? 100) / 100 * audio.mixScale;
    }
    for (const sound of [...new Set(visibleScore.parts.map(audioKey))]) {
      const matching = visibleScore.parts.filter(part => audioKey(part) === sound);
      const matchingIds = new Set(matching.map(part => part.id));
      const notes = timelineOf().events.filter(event => matchingIds.has(event.partId)).map(event => event.midi);
      let players = audio.players.get(sound);
      if (!players) {
        if (sound.startsWith('drum-kit:')) {
          const { loadDrumPlayer } = await import('../lib/drum-player');
          players = [await loadDrumPlayer(audio.context)];
        } else {
          const { loadFluidPlayer } = await import('../lib/fluid-player');
          players = [await loadFluidPlayer(audio.context, sound)];
        }
        audio.players.set(sound, players);
      }
      if (sound.startsWith('drum-kit:') && notes.some(note => note < 35 || note > 70) && !players.some(player => player.fallback)) {
        const [{ Soundfont2 }, { default: soundfont2 }] = await Promise.all([import('smplr'), import('soundfont2')]);
        const { SoundFont2 } = soundfont2;
        const drum = Soundfont2(audio.context, { url: '/soundfonts/TimGM6mb.sf2', createSoundfont: data => new SoundFont2(data), destination: audio.trackGains.get(matching[0].id) });
        await drum.ready;
        if (!drum.instrumentNames.includes('Standard0')) throw new Error('The fallback drum soundfont has no standard kit.');
        await drum.loadInstrument('Standard0');
        players.push({ fallback: true, start: options => options.note < 35 || options.note > 70 ? drum.start(options) : () => {}, stop: () => drum.stop(), dispose: () => drum.dispose() });
      }
      await Promise.all(players.map(player => player.loadNotes?.(notes)));
    }
    return audio;
  };
  const play = async () => {
    if (playing || loadingAudio) { stop(); return; }
    const run = ++playRunRef.current;
    try {
      setLoadingAudio(true);
      const audio = await ensureAudio();
      if (run !== playRunRef.current) return;
      setLoadingAudio(false);
      setNotice(audio ? '' : SILENT_PLAYBACK_NOTICE);
      // One clock drives scheduling and the cursor: audio time when sound works, wall time when playing silently.
      const now = audio ? () => audio.context.currentTime : () => performance.now() / 1000;
      const secondsStart = position;
      const started = now() + (audio ? .09 : 0);
      const parts = new Map(visibleScore.parts.map(part => [part.id, part]));
      const timeline = timelineOf();
      const events = eventsFromSeconds(timeline, secondsStart);
      let nextEvent = 0;
      const schedule = audio && (() => {
        const horizon = audio.context.currentTime + .5;
        while (nextEvent < events.length) {
          const event = events[nextEvent];
          const time = started + event.startSeconds - secondsStart;
          if (time > horizon) break;
          const duration = Math.max(.01, event.soundEndSeconds - event.startSeconds);
          const destination = audio.trackGains.get(event.partId);
          const part = parts.get(event.partId);
          for (const player of part ? audio.players.get(audioKey(part)) || [] : []) scheduledStopsRef.current.push({ stop: player.start({ note: event.midi, time: Math.max(time, audio.context.currentTime), duration, velocity: event.velocity, destination }), end: time + duration });
          nextEvent++;
        }
        scheduledStopsRef.current = scheduledStopsRef.current.filter(item => item.end > audio.context.currentTime);
      });
      schedule?.();
      const interval = schedule ? setInterval(schedule, 50) : undefined;
      const tick = () => {
        const seconds = secondsStart + Math.max(0, now() - started);
        if (seconds >= timeline.durationSeconds) { stop(true); return; }
        const current = positionAtSeconds(timeline, seconds);
        setActive(current.noteId);
        setActiveNotes(previous => previous.join('|') === current.activeNoteIds.join('|') ? previous : current.activeNoteIds);
        setPosition(seconds);
        if (playRef.current) playRef.current.frame = requestAnimationFrame(tick);
      };
      playRef.current = { start: started, beat: secondsStart, frame: requestAnimationFrame(tick), interval };
      setPlaying(true);
    } catch (e) { if (run === playRunRef.current) { setLoadingAudio(false); setError(e instanceof Error ? e.message : 'Audio could not start.'); } }
  };
  useEffect(() => () => { importRunRef.current++; playRunRef.current++; renderRef.current?.dispose(); disposeVerovio(); if (playRef.current) { cancelAnimationFrame(playRef.current.frame); clearInterval(playRef.current.interval); } scheduledStopsRef.current.splice(0).forEach(item => item.stop()); audioRef.current?.players.forEach(players => players.forEach(p => p.dispose())); audioRef.current?.context.close(); }, []);
  const openInstrumentPicker = (part: Part) => {
    const currentSound = playbackSound(part);
    const selected = GM_SOUNDS.find(sound => (sound.soundfont || 'drum-kit') === currentSound);
    const family = selected?.family || 'Keyboard';
    setPickerFamily(family);
    setPickerPage(Math.max(0, Math.floor(GM_SOUNDS.filter(sound => sound.family === family).findIndex(sound => sound === selected) / 16)));
    setPickerPartId(part.id);
  };
  const changeInstrument = (partId: string, sound: GmSound) => {
    stop(true); setScore(prev => ({ ...prev, parts: prev.parts.map(p => p.id === partId ? { ...p, instrument: sound.iconId, gmProgram: sound.program || undefined, gmSoundfont: sound.soundfont || undefined } : p) }));
    setPickerPartId(null);
  };
  const pickerPart = score.parts.find(part => part.id === pickerPartId);
  const familySounds = GM_SOUNDS.filter(sound => sound.family === pickerFamily);
  const pickerPages = Math.ceil(familySounds.length / 16);
  const pickerSounds = familySounds.slice(pickerPage * 16, (pickerPage + 1) * 16);
  const hasScoreText = Boolean(score.title || score.subtitle || score.composer || score.credits?.length);
  // Auto bars follow the layout width in Verovio units: (width - gutter) / stave scale.
  const barsLimit = portraitBarLimit(Math.max(180, (scoreWidth || 800) - controlMetrics.gutter) / renderedZoom, visibleScore);
  // Always rendered (disabled in Endless, same footprint) so a saved mode applied after hydration can't add/remove it and shift the header.
  const barsDisabled = prefs.mode !== 'portrait';
  const barsSetting = <label className={`header-bars-setting ${barsDisabled ? 'is-disabled' : ''}`} title={barsDisabled ? 'Bars per line applies to Vertical view' : undefined}><span>Bars</span><select aria-label="Bars per line" title={barsDisabled ? 'Bars per line applies to Vertical view' : `Auto fits up to ${barsLimit} bars`} disabled={barsDisabled} aria-disabled={barsDisabled} value={prefs.barsPerLine} onChange={event => update({ barsPerLine: event.target.value === 'auto' ? 'auto' : Number(event.target.value) })}><option value="auto">Auto</option>{[1, 2, 3, 4].map(count => <option value={count} key={count}>{count}</option>)}</select></label>;

  const staveScale = zoomDraft ?? prefs.zoom ?? renderedZoom;
  const staveScaleMin = Math.min(STAVE_SCALE_MIN, renderedZoom);
  staveScaleMinRef.current = staveScaleMin;
  const staveScalePercent = Math.round(staveScale * 100);
  const headerElements: Record<HeaderControlId, React.ReactNode> = {
    stop: <button className="icon-button stop-button" aria-label="Stop playback" title="Stop playback" onClick={() => { stop(true); viewportRef.current?.scrollTo({ top: 0, left: 0, behavior: 'smooth' }); }}><Square size={17} fill="currentColor"/></button>,
    play: <button className={`play-button ${loadingAudio ? 'is-loading' : ''}`} aria-label={playing || loadingAudio ? 'Pause playback' : 'Play score'} onClick={play}>{playing || loadingAudio ? <Pause size={17} fill="currentColor"/> : <Play size={17} fill="currentColor"/>}<span className="play-button-label">{loadingAudio ? 'Loading' : playing ? 'Pause' : 'Play'}</span></button>,
    openFile: <button className="header-open-file" aria-label="Open score file" title="Open score file" aria-haspopup="dialog" aria-expanded={openDialog} onClick={() => { setDrawer(false); setMoreOpen(false); setOpenDialog(true); }}><FolderOpen size={17}/><span className="header-open-file-label">Open</span></button>,
    bpm: <label className="bpm-control"><span>BPM</span><input type="number" min={MIN_BPM} max={MAX_BPM} value={prefs.bpm} onChange={e => { stop(true); update({ bpm: clampBpm(Number(e.target.value) || 96) }); }}/></label>,
    mode: <div className="mode-toggle" role="group" aria-label="Reading mode">
      <button aria-label="Vertical view" title="Vertical view" className={`mode-toggle-vertical ${prefs.mode === 'portrait' ? 'selected' : ''}`} onClick={() => update({ mode: 'portrait' })}><span className="mode-toggle-label-full">Vertical</span><span className="mode-toggle-label-short" aria-hidden="true">V</span></button>
      <button aria-label="Endless view" title="Endless view" className={`mode-toggle-endless ${prefs.mode === 'landscape' ? 'selected' : ''}`} onClick={() => update({ mode: 'landscape' })}><span className="mode-toggle-label-full">Endless</span><span className="mode-toggle-label-short" aria-hidden="true">E</span></button>
    </div>,
    bars: barsSetting,
    staveScale: <label className="header-stave-scale" title="Stave scale">
      <span className="header-stave-scale-label">Scale</span>
      <input className="header-stave-scale-input" type="range" min={staveScaleMin} max={STAVE_SCALE_MAX} step={STAVE_SCALE_STEP} value={staveScale} aria-label="Stave scale" aria-valuetext={`${staveScalePercent}%`} onChange={event => draftStaveScale(Number(event.target.value))}
        ref={staveScaleInput} onPointerDown={() => { sliderPointerRef.current = true; window.clearTimeout(zoomCommitRef.current); }}
        onPointerUp={event => releaseStaveScale(event.currentTarget)} onPointerCancel={event => releaseStaveScale(event.currentTarget)}/>
      <output className="header-stave-scale-value">{staveScalePercent}%</output>
    </label>,
    mixer: <button className="icon-button mixer-trigger" aria-label="Track mixer" title="Track mixer" aria-haspopup="dialog" aria-expanded={mixer} onClick={() => { setDrawer(false); setMoreOpen(false); setMixer(true); }}><SlidersHorizontal size={18}/><span className="mixer-trigger-label">Track mixer</span></button>,
  };
  const renderControls = (tier: 'primary' | 'secondary') => HEADER_CONTROLS.filter(control => control.tier === tier && headerElements[control.id]).map(control => <div key={control.id} className={`header-control header-control-${control.id}`} data-header-control={control.id}>{headerElements[control.id]}</div>);
  const primaryControls = renderControls('primary');
  const secondaryControls = renderControls('secondary');

  return <main className="app-shell">
    <header className="topbar" aria-label="Playback transport">
      <input ref={fileRef} type="file" accept={SCORE_FILE_ACCEPT} hidden onChange={e => { readFile(e.target.files?.[0]); e.target.value = ''; }}/>
      <div className="transport">
        {primaryControls}
        {/* Secondary controls render once. CSS lays them out inline above MOBILE_HEADER_BREAKPOINT and as the
            More dropdown (toggle shown, panel display:none until data-open) at or below it, so SSR paints the right arrangement. */}
        {secondaryControls.length > 0 && <div className="header-more" ref={moreRef} data-open={moreOpen ? 'true' : 'false'}>
          <button className={`icon-button header-more-toggle ${moreOpen ? 'open' : ''}`} aria-label="More controls" title="More controls" aria-expanded={moreOpen} aria-controls="header-secondary-panel" onClick={() => setMoreOpen(open => !open)}><Ellipsis size={19}/></button>
          <div id="header-secondary-panel" className="header-secondary-panel" role="group" aria-label="Secondary controls">{secondaryControls}</div>
        </div>}
      </div>
    </header>

    {mixer && <div className="mixer-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setMixer(false); }}>
      <section className="mixer-panel" role="dialog" aria-modal="true" aria-label="Track mixer">
        <div className="mixer-heading"><div><SlidersHorizontal size={18}/><h2>Track mixer</h2></div><button className="icon-button" aria-label="Close track mixer" onClick={() => setMixer(false)}><X size={19}/></button></div>
        <p>Choose each track’s sound and volume.</p>
        <div className="mixer-tracks">{score.parts.map(part => <div className="mixer-track" key={part.id}><img src={instrumentDetails(part.instrument).icon} alt=""/><span className="mixer-track-name">{part.name}{hiddenSet.has(part.id) && <small>Muted · hidden</small>}</span><button className="mixer-voice-button" aria-label={`Voice for ${part.name}`} onClick={() => openInstrumentPicker(part)}>{part.gmSoundfont ? gmSoundfontLabel(part.gmSoundfont) : instrumentDetails(part.instrument).label}<ChevronDown size={14}/></button><label className="mixer-volume"><span>Volume</span><input type="range" min="0" max="100" value={trackVolumes[part.id] ?? 100} aria-label={`Volume for ${part.name}`} onChange={event => setTrackVolumes(previous => ({ ...previous, [part.id]: Number(event.target.value) }))}/><output>{trackVolumes[part.id] ?? 100}%</output></label></div>)}</div>
      </section>
    </div>}

    {openDialog && <OpenScoreDialog onClose={() => setOpenDialog(false)} onOpenFile={file => void readFile(file)} onOpenAbc={text => void readAbc(text)} onBrowse={() => fileRef.current?.click()}/>}

    {pickerPart && <div className="instrument-picker-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setPickerPartId(null); }}>
      <section className="instrument-picker-panel" role="dialog" aria-modal="true" aria-label={`Choose voice for ${pickerPart.name}`}>
        <div className="instrument-picker-heading"><div><h2>{pickerPart.name}</h2><p>Choose a playback sound</p></div><button className="icon-button" aria-label="Close voice picker" onClick={() => setPickerPartId(null)}><X size={19}/></button></div>
        <div className="instrument-family-filters" role="group" aria-label="Instrument families">{GM_FAMILIES.map(family => <button key={family} className={pickerFamily === family ? 'selected' : ''} aria-pressed={pickerFamily === family} onClick={() => { setPickerFamily(family); setPickerPage(0); }}>{family}</button>)}</div>
        <div className="instrument-picker-grid">{pickerSounds.map(sound => <button key={sound.program ?? 'drum-kit'} className={playbackSound(pickerPart) === (sound.soundfont || 'drum-kit') ? 'selected' : ''} aria-pressed={playbackSound(pickerPart) === (sound.soundfont || 'drum-kit')} onClick={() => changeInstrument(pickerPart.id, sound)}><img src={sound.icon} alt=""/><span>{sound.label}</span></button>)}</div>
        <div className="instrument-picker-pages"><button aria-label="Previous instruments" disabled={pickerPage === 0} onClick={() => setPickerPage(page => page - 1)}><ChevronLeft size={18}/></button><span>Page {pickerPage + 1} of {pickerPages}</span><button aria-label="Next instruments" disabled={pickerPage + 1 >= pickerPages} onClick={() => setPickerPage(page => page + 1)}><ChevronRight size={18}/></button></div>
      </section>
    </div>}

    <section className={`reader-area ${prefs.mode} ${score.parts.length > 4 ? 'has-many-staves' : ''}`}>
      <div className="edge-fade edge-start"/><div className="edge-fade edge-end"/>
      <div className="score-viewport" ref={viewportRef} onTouchStart={e => {
        if (score.parts.length > 4 && e.touches.length === 2) {
          const distance = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
          pinchRef.current = { distance, zoom: renderedZoomRef.current, nextZoom: renderedZoomRef.current };
          swipeRef.current = null;
        } else if (!pinchRef.current && e.touches.length === 1) swipeRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }} onTouchMove={e => {
        if (!pinchRef.current || e.touches.length !== 2) return;
        const distance = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        pinchRef.current.nextZoom = clampStaveScale(pinchRef.current.zoom * distance / Math.max(1, pinchRef.current.distance), staveScaleMinRef.current);
        setZoomDraft(pinchRef.current.nextZoom);
        previewStaveScale(pinchRef.current.nextZoom);
      }} onTouchEnd={e => {
        if (pinchRef.current) {
          const nextZoom = pinchRef.current.nextZoom;
          pinchRef.current = null;
          commitStaveScale(nextZoom);
          swipeRef.current = null;
          return;
        }
        if (!swipeRef.current) return;
        const dx = e.changedTouches[0].clientX - swipeRef.current.x, dy = e.changedTouches[0].clientY - swipeRef.current.y;
        const delta = prefs.mode === 'landscape' ? dx : dy;
        if (Math.abs(delta) > 65) turn(delta < 0 ? 1 : -1);
        swipeRef.current = null;
      }} onTouchCancel={() => { if (pinchRef.current) { setZoomDraft(null); clearStaveScalePreview(); } pinchRef.current = null; swipeRef.current = null; }}>
        {loadingFont && <div className="font-load-progress" role="status" aria-label="Loading notation font"/>}
        {painting && <div className="score-loading" role="status" aria-label={painted ? 'Rendering score' : 'Preparing score'}><span className="score-loading-spinner"/><span>{painted ? 'Rendering score' : 'Preparing score'}</span></div>}
        <div ref={contentRef} className={`score-content ${painting || !painted ? 'is-painting' : ''}`} data-stave-scale={painted ? renderedZoom : undefined} style={{ '--landscape-meta-offset': prefs.chordSymbols ? '0px' : '35px', '--annotation-font': textFonts[prefs.annotationFont] || textFonts.Sans, '--score-text-font': textFonts[prefs.annotationFont] || textFonts.Sans, '--music-font': prefs.notationFont } as React.CSSProperties}>
          {(hasScoreText || hiddenIds.length > 0) && <div className="score-meta">
            {score.title && <h1>{score.title}</h1>}
            {score.subtitle && <p className="score-subtitle">{score.subtitle}</p>}
            {score.composer && <p className="score-composer">{score.composer}</p>}
            {score.credits?.map((line, i) => <p className="score-credit" key={`${line}-${i}`}>{line}</p>)}
            {hiddenIds.length > 0 && <div className="hidden-staves" aria-label="Hidden staves">{score.parts.filter(part => hiddenSet.has(part.id)).map(part => <button key={part.id} onClick={() => togglePart(part.id)} title={`Show ${part.name}`} aria-label={`Show ${part.name}`}><img src={instrumentDetails(part.instrument).icon} alt=""/><EyeOff size={15}/><span>{part.name}</span></button>)}</div>}
          </div>}
          <div className="score-stage">
            <div className="score-staves" ref={canvasRef}/>
            <div className="part-controls" style={{ '--part-icon': `${controlMetrics.icon}px`, '--part-font': `${controlMetrics.font}px`, '--part-eye': `${controlMetrics.eye}px`, '--part-control-height': `${controlMetrics.height}px` } as React.CSSProperties}>{visibleScore.parts.map((part, index) => <div key={part.id} className="part-control" style={{ top: `${staffCenters[part.id] ?? 86 + index * ((prefs.names || prefs.counts) ? 125 : 100)}px` }} title={`Sound for ${part.name}`}><button className="instrument-control" aria-label={`Instrument for ${part.name}`} aria-haspopup="dialog" onClick={() => openInstrumentPicker(part)}><img className="part-icon" src={instrumentDetails(part.instrument).icon} alt=""/></button><span className="part-name" title={part.name}>{part.name}</span>{score.parts.length > 4 && <button className="staff-eye" aria-label={`Hide ${part.name}`} title={`Hide ${part.name}`} onClick={() => togglePart(part.id)} disabled={visibleScore.parts.length <= 1}><Eye size={17}/></button>}</div>)}</div>
          </div>
        </div>
      </div>
      <div className="page-controls"><button aria-label="Previous view" onClick={() => turn(-1)}><ChevronLeft size={18}/></button><span>{prefs.mode === 'portrait' ? 'SCROLL TO READ' : 'SWIPE TO READ'}</span><button aria-label="Next view" onClick={() => turn(1)}><ChevronRight size={18}/></button></div>
    </section>

    <button className={`drawer-handle ${drawer ? 'open' : ''}`} onClick={() => setDrawer(!drawer)} aria-expanded={drawer}><span className="handle-grip"/><span>{drawer ? 'Close options' : 'Options'}</span><ChevronDown size={16}/></button>
    {drawer && <div className="drawer-backdrop" onClick={() => setDrawer(false)}/>}
    <aside className={`bottom-drawer ${drawer ? 'open' : ''}`} aria-hidden={!drawer}>
      <div className="drawer-top"><div><div className="eyebrow">MAKE IT YOURS</div><h2>Reading options</h2></div><button className="icon-button" aria-label="Close options" onClick={() => setDrawer(false)}><X size={20}/></button></div>
      <div className="drawer-grid">

        <div className="drawer-panel"><h3><Settings2 size={17}/> Reading</h3><div className="font-choice"><span>Notation font</span><div className="font-toggle" role="group" aria-label="Notation font"><button className={prefs.notationFont === 'Bravura' ? 'selected' : ''} aria-pressed={prefs.notationFont === 'Bravura'} onClick={() => update({ notationFont: 'Bravura' })}>Bravura</button><button className={prefs.notationFont === 'Petaluma' ? 'selected' : ''} aria-pressed={prefs.notationFont === 'Petaluma'} onClick={() => update({ notationFont: 'Petaluma' })}>Petaluma</button></div></div><div className="font-choice"><span>Stave text font</span><div className="font-toggle" role="group" aria-label="Stave text font">{(['Sans', 'Serif', 'Mono'] as const).map(font => <button key={font} className={prefs.annotationFont === font ? 'selected' : ''} aria-pressed={prefs.annotationFont === font} onClick={() => update({ annotationFont: font })}>{font}</button>)}</div></div><label className="field-label" htmlFor="overhang">Overhang <span>{prefs.overlap === 0 ? 'Off' : `${prefs.overlap} ${prefs.mode === 'portrait' ? (prefs.overlap === 1 ? 'system' : 'systems') : (prefs.overlap === 1 ? 'bar' : 'bars')}`}</span></label><input id="overhang" className="range" type="range" min="0" max="3" step="1" value={prefs.overlap} onChange={e => update({ overlap: Number(e.target.value) })}/><div className="switch-row"><span>Note names</span><button className={`switch ${prefs.names ? 'on' : ''}`} role="switch" aria-label="Note names" aria-checked={prefs.names} onClick={() => update({ names: !prefs.names })}/></div><div className="switch-row"><span>Chord symbols</span><button className={`switch ${prefs.chordSymbols ? 'on' : ''}`} role="switch" aria-label="Chord symbols" aria-checked={prefs.chordSymbols} onClick={() => update({ chordSymbols: !prefs.chordSymbols })}/></div><label className="switch-row inference-row"><span>Infer chord symbols</span><input type="checkbox" checked={prefs.inferChordSymbols} onChange={e => update({ inferChordSymbols: e.target.checked })}/></label><div className="switch-row"><span>Beat counts</span><button className={`switch ${prefs.counts ? 'on' : ''}`} role="switch" aria-label="Beat counts" aria-checked={prefs.counts} onClick={() => update({ counts: !prefs.counts })}/></div><div className="switch-row"><span>Count subdivisions</span><button className={`switch ${prefs.subdivisions ? 'on' : ''}`} role="switch" aria-label="Count subdivisions" aria-checked={prefs.subdivisions} onClick={() => update({ subdivisions: !prefs.subdivisions, counts: true })}/></div>{score.parts.length > 4 && <button className="text-action reset-staves" onClick={resetStaves}><RotateCcw size={15}/> Reset score staves</button>}</div>
        <div className="drawer-panel abc-panel"><h3><FileMusic size={17}/> ABC notation</h3><p>Paste ABC text here, or use the open button in the header for files and folders.</p><textarea value={abc} onChange={e => setAbc(e.target.value)} spellCheck={false} aria-label="ABC notation"/><button className="primary-action" onClick={() => void readAbc(abc)}>View notation <ChevronRight size={17}/></button><button className="text-action" onClick={loadSample}><FileMusic size={16}/> Open sample score</button></div>
        <div className="drawer-panel pitch-panel"><h3><Settings2 size={17}/> Pitch</h3><div className="pitch-options"><div><span className="pitch-label">Transpose score</span><div className="semitone-control"><button aria-label="Transpose down one semitone" disabled={prefs.semitones <= -12} onClick={() => changePitch({ semitones: prefs.semitones - 1 })}><Minus size={16}/></button><output aria-live="polite">{prefs.semitones > 0 ? '+' : ''}{prefs.semitones} semitones</output><button aria-label="Transpose up one semitone" disabled={prefs.semitones >= 12} onClick={() => changePitch({ semitones: prefs.semitones + 1 })}><Plus size={16}/></button><button className="pitch-reset" aria-label="Reset transposition" title="Reset transposition" disabled={prefs.semitones === 0} onClick={() => changePitch({ semitones: 0 })}><RotateCcw size={15}/></button></div></div>{!concertBasis && <div><span className="pitch-label">Score view</span><div className="font-toggle pitch-view" role="group" aria-label="Score pitch view"><button className={prefs.scorePitch === 'written' ? 'selected' : ''} aria-pressed={prefs.scorePitch === 'written'} onClick={() => changePitch({ scorePitch: 'written' })}>Transposing</button><button className={prefs.scorePitch === 'concert' ? 'selected' : ''} aria-pressed={prefs.scorePitch === 'concert'} onClick={() => changePitch({ scorePitch: 'concert' })}>Concert</button></div></div>}</div><p className="pitch-hint">{concertBasis ? 'This score is written at concert pitch, so it is shown at concert pitch. Playback stays at concert pitch.' : hasTransposingParts ? 'Transposing shows written parts; Concert shows sounding pitches. Playback stays at concert pitch.' : 'This score has no instrument transposition data, so both views match.'}</p></div>
      </div>
      {error && <div className="error" role="alert">{error}</div>}
      <div className="drawer-foot">SPACE / PAGE DOWN · next view &nbsp;&nbsp; PAGE UP · previous view <span>FluidR3 GM · CC BY 3.0; TimGM drums · GPL-2</span></div>
    </aside>
    {notice && !drawer && <div className="playback-notice" role="status"><VolumeX className="playback-notice-icon" size={16}/><span className="playback-notice-text">{notice}</span><button className="playback-notice-dismiss" onClick={() => setNotice('')} aria-label="Dismiss playback notice"><X size={16}/></button></div>}
    {error && !drawer && <div className="toast" role="alert"><span>{error}</span><button onClick={() => setError('')} aria-label="Dismiss"><X size={16}/></button></div>}
  </main>;
}
