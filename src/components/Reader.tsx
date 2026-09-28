import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, Eye, EyeOff, FileMusic, FolderOpen, Minus, Pause, Play, Plus, RotateCcw, SlidersHorizontal, Square, Settings2, X } from 'lucide-react';
import { Font, VexFlow } from 'vexflow/core';
import { exampleScore, gmSoundfontLabel, GM_FAMILIES, GM_SOUNDS, instrumentDetails, type GmFamily, type GmSound, type Part, type Score } from '../lib/score';
import { importFile, parseAbc, parseMusicXml } from '../lib/import';
import { portraitBarLimit, renderScore, type RenderResult } from '../lib/render';
import { fileSource, readFileState, writeFileState, type FileSettings, type FileSource } from '../lib/file-state';
import { scoreForView, soundingMidi } from '../lib/transpose';

type Prefs = FileSettings;
const defaults: Prefs = { mode: 'portrait', notationFont: 'Bravura', barsPerLine: 'auto', overlap: 1, names: false, chordSymbols: false, inferChordSymbols: false, counts: false, subdivisions: false, annotationFont: 'Sans', bpm: 96, zoom: 1, semitones: 0, scorePitch: 'written' };
const sampleAbc = `X:1\nT:A little room to play\nM:4/4\nL:1/4\nQ:1/4=96\nK:C\nC E G c | B A G E | C E G c | d2 c2 | G E D C | E G A G | F E D B, | C4 |`;
const playbackSound = (part: Part) => part.gmSoundfont || (part.instrument === 'drum-kit' ? 'drum-kit' : instrumentDetails(part.instrument).soundfont!);
const audioKey = (part: Part) => playbackSound(part) === 'drum-kit' ? `drum-kit:${part.id}` : playbackSound(part);
const musicFontLoads = new Map<string, Promise<unknown>>();
function ensureMusicFont(name: 'Bravura' | 'Petaluma') {
  if (!musicFontLoads.has(name)) musicFontLoads.set(name, Font.load(name, `/fonts/${name}.woff2`, { display: 'block' }));
  return musicFontLoads.get(name)!;
}
type AudioPlayer = {
  fallback?: boolean;
  start(options: { note: number; time: number; duration: number; velocity: number; destination?: AudioNode }): () => void;
  stop(): void;
  dispose(): void;
  loadNotes?(notes: number[]): Promise<void>;
};
export type ReaderProps = { musicXml?: string };

export default function Reader({ musicXml }: ReaderProps) {
  const [score, setScore] = useState<Score>(exampleScore);
  const [scoreRevision, setScoreRevision] = useState(0);
  const [prefs, setPrefs] = useState<Prefs>(defaults);
  const [source, setSource] = useState<FileSource | null>(null);
  const [hiddenIds, setHiddenIds] = useState<string[]>([]);
  const [trackVolumes, setTrackVolumes] = useState<Record<string, number>>({});
  const [drawer, setDrawer] = useState(false);
  const [mixer, setMixer] = useState(false);
  const [pickerPartId, setPickerPartId] = useState<string | null>(null);
  const [pickerFamily, setPickerFamily] = useState<GmFamily>('Keyboard');
  const [pickerPage, setPickerPage] = useState(0);
  const [abc, setAbc] = useState(sampleAbc);
  const [error, setError] = useState('');
  const [playing, setPlaying] = useState(false);
  const [loadingAudio, setLoadingAudio] = useState(false);
  const [loadingFont, setLoadingFont] = useState(false);
  const [painted, setPainted] = useState(false);
  const [painting, setPainting] = useState(true);
  const [resizeTick, setResizeTick] = useState(0);
  const [active, setActive] = useState<string | null>(null);
  const [position, setPosition] = useState(0);
  const [ready, setReady] = useState(false);
  const [staffCenters, setStaffCenters] = useState<number[]>([]);
  const [scoreScale, setScoreScale] = useState(1);
  const [scoreWidth, setScoreWidth] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const renderRef = useRef<RenderResult | null>(null);
  const audioRef = useRef<{ context: AudioContext; master: DynamicsCompressorNode; players: Map<string, AudioPlayer[]>; trackGains: Map<string, GainNode>; mixScale: number } | null>(null);
  const playRef = useRef<{ start: number; beat: number; frame: number; interval: ReturnType<typeof setInterval> } | null>(null);
  const scheduledStopsRef = useRef<Array<{ stop: () => void; end: number }>>([]);
  const playRunRef = useRef(0);
  const swipeRef = useRef<{ x: number; y: number } | null>(null);
  const pinchRef = useRef<{ distance: number; zoom: number; nextZoom: number } | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const hasPaintedRef = useRef(false);
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
  const displayScore = useMemo(() => scoreForView(visibleScore, prefs.scorePitch, prefs.semitones), [visibleScore, prefs.scorePitch, prefs.semitones]);
  const hasTransposingParts = score.parts.some(part => part.transposition?.semitones || part.measures.some(measure => measure.transposition?.semitones));
  const measureOffsets = useMemo(() => {
    let elapsed = 0;
    return visibleScore.parts[0]?.measures.map(measure => {
      const start = elapsed;
      elapsed += measure.beats;
      return start;
    }) || [];
  }, [visibleScore]);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('scoreflow-prefs') || '{}');
      const next = { ...defaults, ...saved };
      if (typeof next.barsPerLine === 'number') next.barsPerLine = Math.max(1, Math.min(4, next.barsPerLine));
      if (!Number.isInteger(next.semitones)) next.semitones = 0;
      next.semitones = Math.max(-12, Math.min(12, next.semitones));
      if (!['written', 'concert'].includes(next.scorePitch)) next.scorePitch = 'written';
      if (!['Sans', 'Serif', 'Mono'].includes(next.annotationFont)) next.annotationFont = 'Sans';
      setPrefs(next);
    }
    catch { /* keep defaults */ }
    setReady(true);
  }, []);
  useEffect(() => { if (ready) localStorage.setItem('scoreflow-prefs', JSON.stringify(prefs)); }, [prefs, ready]);
  useEffect(() => { if (ready && source) writeFileState(source, prefs, score, hiddenIds, trackVolumes); }, [ready, source, prefs, score, hiddenIds, trackVolumes]);
  const update = (patch: Partial<Prefs>) => {
    if (['mode', 'notationFont', 'barsPerLine', 'names', 'chordSymbols', 'inferChordSymbols', 'counts', 'subdivisions', 'zoom', 'semitones', 'scorePitch'].some(key => key in patch)) setPainting(true);
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
    if (reset) { setPosition(0); setActive(null); }
  }, []);
  const changePitch = (patch: Partial<Prefs>) => { stop(true); update(patch); };
  const loadScore = (next: Score, nextSource: FileSource | null = null) => {
    const saved = nextSource && readFileState(nextSource);
    const restored = saved ? { ...next, parts: next.parts.map(part => {
      const state = saved.parts[part.id];
      if (!state) return part;
      return { ...part, instrument: state.instrument, gmSoundfont: state.gmSoundfont || (state.instrument === part.instrument ? part.gmSoundfont : instrumentDetails(state.instrument).soundfont || undefined) };
    }) } : next;
    stop(true); setPainting(true); setPickerPartId(null); setScore(restored); setScoreRevision(value => value + 1); setSource(nextSource);
    setHiddenIds(saved ? next.parts.filter(part => saved.parts[part.id]?.visible === false).map(part => part.id) : []);
    setTrackVolumes(saved ? Object.fromEntries(next.parts.map(part => [part.id, saved.parts[part.id]?.volume ?? 100])) : {});
    setError('');
    setPrefs(prev => saved ? { ...prev, ...saved.settings } : { ...prev, bpm: Math.round(next.tempo), zoom: 1, semitones: 0, scorePitch: next.parts.some(part => part.pitchBasis === 'concert') ? 'concert' : 'written' });
    viewportRef.current?.scrollTo({ left: 0, top: 0 });
    setDrawer(false);
  };
  useEffect(() => {
    if (!musicXml) return;
    try { loadScore(parseMusicXml(musicXml)); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not read the supplied MusicXML.'); }
  }, [musicXml]);
  const readFile = async (file?: File) => {
    if (!file) return;
    setPainting(true);
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    try { const [nextSource, nextScore] = await Promise.all([fileSource(file), importFile(file)]); loadScore(nextScore, nextSource); }
    catch (e) { setPainting(false); setError(e instanceof Error ? e.message : 'Could not open this file.'); }
  };
  const togglePart = (id: string) => {
    if (!hiddenSet.has(id) && visibleScore.parts.length <= 1) return;
    stop(true); setPainting(true);
    setHiddenIds(previous => previous.includes(id) ? previous.filter(partId => partId !== id) : [...previous, id]);
    viewportRef.current?.scrollTo({ left: 0, top: 0 });
  };
  const resetStaves = () => { stop(true); setPainting(true); setHiddenIds([]); viewportRef.current?.scrollTo({ left: 0, top: 0 }); };
  const zoomBy = (delta: number) => update({ zoom: Math.max(.5, Math.min(4, Math.round((prefs.zoom + delta) * 4) / 4)) });
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    let width = viewport.clientWidth;
    const observer = new ResizeObserver(() => {
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
    let timer = 0;
    let frame = 0;
    setPainting(true);
    const draw = () => {
      try {
        if (disposed) return;
        VexFlow.setFonts(prefs.notationFont);
        setScoreWidth(previous => previous === canvas.clientWidth ? previous : canvas.clientWidth);
        const controlGutter = Math.min(190, Math.max(128, Math.round(canvas.clientWidth * .36)));
        const metaHeight = canvas.closest('.score-content')?.querySelector('.score-meta')?.getBoundingClientRect().height || 0;
        const availableHeight = Math.max(120, (viewportRef.current?.clientHeight || 600) - metaHeight - 70);
        const result = renderScore(canvas, displayScore, prefs.mode, prefs.names, prefs.counts, prefs.subdivisions, prefs.barsPerLine, prefs.chordSymbols, prefs.inferChordSymbols, availableHeight, prefs.zoom, controlGutter);
        renderRef.current = result;
        setStaffCenters(result.staffCenters);
        setScoreScale(result.scale);
        const content = canvas.closest<HTMLElement>('.score-content');
        content?.style.setProperty('--landscape-staff-center', `${visibleScore.parts.length > 4 ? result.systemHeight / 2 : result.staffCenters[0] ?? 74}px`);
        content?.style.setProperty('--landscape-content-width', `${canvas.scrollWidth + 88}px`);
        const stage = canvas.closest<HTMLElement>('.score-stage');
        stage?.style.setProperty('--control-gutter', `${controlGutter}px`);
        setError('');
      } catch (e) { if (!disposed) setError(e instanceof Error ? e.message : 'Could not draw this score.'); }
      finally {
        if (!disposed) frame = requestAnimationFrame(() => {
          hasPaintedRef.current = true;
          setPainted(true);
          setPainting(false);
        });
      }
    };
    const prepare = async () => {
      const pending = !musicFontLoads.has(prefs.notationFont);
      setLoadingFont(pending);
      try { await ensureMusicFont(prefs.notationFont); }
      catch {
        musicFontLoads.delete(prefs.notationFont);
        if (!disposed) { setLoadingFont(false); setPainting(false); setError(`Could not load the ${prefs.notationFont} notation font.`); }
        return;
      }
      if (disposed) return;
      setLoadingFont(false);
      const delay = hasPaintedRef.current && !window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 260 : 0;
      timer = window.setTimeout(draw, delay);
    };
    void prepare();
    return () => { disposed = true; window.clearTimeout(timer); cancelAnimationFrame(frame); };
  }, [ready, resizeTick, scoreRevision, hiddenIds, prefs.mode, prefs.notationFont, prefs.names, prefs.chordSymbols, prefs.inferChordSymbols, prefs.counts, prefs.subdivisions, prefs.barsPerLine, prefs.zoom, prefs.semitones, prefs.scorePitch]);

  const turn = useCallback((direction: number) => {
    const el = viewportRef.current;
    if (!el) return;
    if (prefs.mode === 'landscape') {
      const step = Math.max(100, el.clientWidth - prefs.overlap * (renderRef.current?.barWidth || 230));
      el.scrollTo({ left: Math.max(0, el.scrollLeft + direction * step), behavior: 'smooth' });
    } else {
      const firstSystem = canvasRef.current?.querySelector<HTMLElement>('.score-system');
      const centers = renderRef.current?.staffCenters || [];
      const staveHeight = centers.length > 1 ? centers[1] - centers[0] : firstSystem?.offsetHeight || 170;
      const step = Math.max(100, el.clientHeight - prefs.overlap * staveHeight);
      el.scrollTo({ top: Math.max(0, el.scrollTop + direction * step), behavior: 'smooth' });
    }
  }, [prefs.mode, prefs.overlap]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && pickerPartId) { setPickerPartId(null); return; }
      if (event.key === 'Escape' && mixer) { setMixer(false); return; }
      if (pickerPartId || mixer) return;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((event.target as HTMLElement).tagName)) return;
      if (['PageDown', 'ArrowRight', 'ArrowDown', ' '].includes(event.key)) { event.preventDefault(); turn(1); }
      if (['PageUp', 'ArrowLeft', 'ArrowUp'].includes(event.key)) { event.preventDefault(); turn(-1); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [turn, mixer, pickerPartId]);
  useEffect(() => {
    const note = active && renderRef.current?.points.find(p => p.id === active);
    canvasRef.current?.querySelectorAll('.reader-note.is-playing').forEach(n => n.classList.remove('is-playing'));
    canvasRef.current?.querySelectorAll('.playback-line').forEach(n => n.remove());
    if (!note || !note.element) return;
    const beat = (measureOffsets[note.measure] || 0) + note.start;
    renderRef.current?.points.forEach(point => {
      const onset = (measureOffsets[point.measure] || 0) + point.start;
      if (!point.rest && onset <= beat && onset + point.duration > beat) point.element?.classList.add('is-playing');
    });
    const block = note.element.closest<HTMLElement>('.score-system');
    if (!block) return;
    const line = document.createElement('div');
    line.className = 'playback-line';
    line.style.left = `${note.x}px`;
    block.appendChild(line);
    const viewport = viewportRef.current;
    if (!viewport) return;
    const view = viewport.getBoundingClientRect();
    if (prefs.mode === 'landscape') {
      const x = line.getBoundingClientRect().left;
      if (x > view.left + view.width * .78 || x < view.left + view.width * .18) viewport.scrollBy({ left: x - view.left - view.width * .35, behavior: 'smooth' });
    } else {
      const head = note.element.getBoundingClientRect();
      const y = head.top + head.height / 2;
      if (y > view.top + view.height * .72 || y < view.top + view.height * .18) viewport.scrollBy({ top: y - view.top - view.height * .38, behavior: 'smooth' });
    }
  }, [active, prefs.mode, measureOffsets]);

  const ensureAudio = async () => {
    if (!audioRef.current) {
      const context = new AudioContext();
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
    await audio.context.resume();
    audio.mixScale = .8 / Math.sqrt(Math.max(1, visibleScore.parts.length));
    for (const part of visibleScore.parts) {
      let gain = audio.trackGains.get(part.id);
      if (!gain) { gain = audio.context.createGain(); gain.connect(audio.master); audio.trackGains.set(part.id, gain); }
      gain.gain.value = (trackVolumes[part.id] ?? 100) / 100 * audio.mixScale;
    }
    for (const sound of [...new Set(visibleScore.parts.map(audioKey))]) {
      const matching = visibleScore.parts.filter(part => audioKey(part) === sound);
      const notes = matching.flatMap(part => part.measures.flatMap(measure => measure.notes.flatMap(note => note.pitches.map(notePitch => soundingMidi(part, measure, notePitch, prefs.semitones)))));
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
      const beatStart = position;
      const started = audio.context.currentTime + .09;
      const secondsPerBeat = 60 / Math.max(30, prefs.bpm);
      const events: { beat: number; duration: number; pitch: number; partId: string; key: string }[] = [];
      for (const part of visibleScore.parts) {
        for (const m of part.measures) for (const note of m.notes) {
          if (note.rest) continue;
          const beat = (measureOffsets[m.index] || 0) + note.start;
          if (beat < beatStart) continue;
          for (const notePitch of note.pitches) events.push({ beat, duration: note.duration, pitch: soundingMidi(part, m, notePitch, prefs.semitones), partId: part.id, key: audioKey(part) });
        }
      }
      events.sort((a, b) => a.beat - b.beat);
      let nextEvent = 0;
      const schedule = () => {
        const horizon = audio.context.currentTime + .5;
        while (nextEvent < events.length) {
          const event = events[nextEvent];
          const time = started + (event.beat - beatStart) * secondsPerBeat;
          if (time > horizon) break;
          const duration = Math.max(.06, event.duration * secondsPerBeat * .92);
          const destination = audio.trackGains.get(event.partId);
          for (const player of audio.players.get(event.key) || []) scheduledStopsRef.current.push({ stop: player.start({ note: event.pitch, time: Math.max(time, audio.context.currentTime), duration, velocity: 82, destination }), end: time + duration });
          nextEvent++;
        }
        scheduledStopsRef.current = scheduledStopsRef.current.filter(item => item.end > audio.context.currentTime);
      };
      schedule();
      const interval = setInterval(schedule, 50);
      const total = visibleScore.parts[0].measures.reduce((sum, m) => sum + m.beats, 0);
      const tick = () => {
        const nowBeat = beatStart + Math.max(0, audio.context.currentTime - started) / secondsPerBeat;
        if (nowBeat >= total) { stop(true); return; }
        let current: RenderResult['points'][number] | undefined;
        let currentOnset = -Infinity;
        for (const point of renderRef.current?.points || []) {
          const onset = (measureOffsets[point.measure] || 0) + point.start;
          if (onset > nowBeat + .001) continue;
          if (onset > currentOnset + .001 || (Math.abs(onset - currentOnset) < .001 && current?.rest && !point.rest)) {
            current = point;
            currentOnset = onset;
          }
        }
        if (current) setActive(current.id);
        setPosition(nowBeat);
        if (playRef.current) playRef.current.frame = requestAnimationFrame(tick);
      };
      playRef.current = { start: started, beat: beatStart, frame: requestAnimationFrame(tick), interval };
      setPlaying(true);
    } catch (e) { if (run === playRunRef.current) { setLoadingAudio(false); setError(e instanceof Error ? e.message : 'Audio could not start.'); } }
  };
  useEffect(() => () => { if (playRef.current) { cancelAnimationFrame(playRef.current.frame); clearInterval(playRef.current.interval); } audioRef.current?.players.forEach(players => players.forEach(p => p.dispose())); audioRef.current?.context.close(); }, []);
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
  const firstLineWidth = (scoreWidth || 800) - Math.min(190, Math.max(128, Math.round((scoreWidth || 800) * .36)));
  const barsLimit = portraitBarLimit(firstLineWidth, visibleScore);
  const barsSetting = prefs.mode === 'portrait' && <label className="header-bars-setting"><span>Bars</span><select aria-label="Bars per line" title={`Auto fits up to ${barsLimit} bars`} value={prefs.barsPerLine} onChange={event => update({ barsPerLine: event.target.value === 'auto' ? 'auto' : Number(event.target.value) })}><option value="auto">Auto</option>{[1, 2, 3, 4].map(count => <option value={count} key={count}>{count}</option>)}</select></label>;

  return <main className="app-shell">
    <header className={`topbar ${score.parts.length > 4 ? 'has-zoom' : ''}`} aria-label="Playback transport">
      <input ref={fileRef} type="file" accept=".xml,.musicxml,.mxl,.mid,.midi,.mei,.abc,.txt" hidden onChange={e => { readFile(e.target.files?.[0]); e.target.value = ''; }}/>
      <div className="transport">
        <button className="icon-button stop-button" aria-label="Stop playback" title="Stop playback" onClick={() => { stop(true); viewportRef.current?.scrollTo({ top: 0, left: 0, behavior: 'smooth' }); }}><Square size={17} fill="currentColor"/></button>
        <button className="play-button" aria-label={playing || loadingAudio ? 'Pause playback' : 'Play score'} onClick={play}>{playing || loadingAudio ? <Pause size={17} fill="currentColor"/> : <Play size={17} fill="currentColor"/>}<span>{loadingAudio ? 'Loading sounds' : playing ? 'Pause' : 'Play'}</span></button>
        <label className="bpm-control"><span>BPM</span><input type="number" min="30" max="240" value={prefs.bpm} onChange={e => update({ bpm: Math.max(30, Math.min(240, Number(e.target.value) || 96)) })}/></label>
        <div className="mode-toggle" role="group" aria-label="Reading mode"><button aria-label="Vertical view" title="Vertical view" className={prefs.mode === 'portrait' ? 'selected' : ''} onClick={() => update({ mode: 'portrait' })}><span>Vertical</span></button><button aria-label="Endless view" title="Endless view" className={prefs.mode === 'landscape' ? 'selected' : ''} onClick={() => update({ mode: 'landscape' })}><span>Endless</span></button></div>
        {barsSetting}
        {score.parts.length > 4 && <div className="zoom-controls" role="group" aria-label="Score zoom"><button aria-label="Zoom out" title="Zoom out" disabled={prefs.zoom <= .5} onClick={() => zoomBy(-.25)}><Minus size={15}/></button><span aria-live="polite">{Math.round(prefs.zoom * 100)}%</span><button aria-label="Zoom in" title="Zoom in" disabled={prefs.zoom >= 4} onClick={() => zoomBy(.25)}><Plus size={15}/></button></div>}
        <button className="icon-button header-open-file" aria-label="Open score file" title="Open score file" onClick={() => fileRef.current?.click()}><FolderOpen size={18}/></button>
        <button className="icon-button mixer-trigger" aria-label="Track mixer" title="Track mixer" aria-haspopup="dialog" aria-expanded={mixer} onClick={() => { setDrawer(false); setMixer(true); }}><SlidersHorizontal size={18}/></button>
      </div>
    </header>

    {mixer && <div className="mixer-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setMixer(false); }}>
      <section className="mixer-panel" role="dialog" aria-modal="true" aria-label="Track mixer">
        <div className="mixer-heading"><div><SlidersHorizontal size={18}/><h2>Track mixer</h2></div><button className="icon-button" aria-label="Close track mixer" onClick={() => setMixer(false)}><X size={19}/></button></div>
        <p>Choose each track’s sound and volume.</p>
        <div className="mixer-tracks">{score.parts.map(part => <div className="mixer-track" key={part.id}><img src={instrumentDetails(part.instrument).icon} alt=""/><span className="mixer-track-name">{part.name}{hiddenSet.has(part.id) && <small>Muted · hidden</small>}</span><button className="mixer-voice-button" aria-label={`Voice for ${part.name}`} onClick={() => openInstrumentPicker(part)}>{part.gmSoundfont ? gmSoundfontLabel(part.gmSoundfont) : instrumentDetails(part.instrument).label}<ChevronDown size={14}/></button><label className="mixer-volume"><span>Volume</span><input type="range" min="0" max="100" value={trackVolumes[part.id] ?? 100} aria-label={`Volume for ${part.name}`} onChange={event => setTrackVolumes(previous => ({ ...previous, [part.id]: Number(event.target.value) }))}/><output>{trackVolumes[part.id] ?? 100}%</output></label></div>)}</div>
      </section>
    </div>}

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
          pinchRef.current = { distance, zoom: prefs.zoom, nextZoom: prefs.zoom };
          swipeRef.current = null;
        } else if (!pinchRef.current && e.touches.length === 1) swipeRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }} onTouchMove={e => {
        if (!pinchRef.current || e.touches.length !== 2) return;
        const distance = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        pinchRef.current.nextZoom = Math.max(.5, Math.min(4, pinchRef.current.zoom * distance / Math.max(1, pinchRef.current.distance)));
        if (stageRef.current) { stageRef.current.style.transformOrigin = 'center top'; stageRef.current.style.transform = `scale(${pinchRef.current.nextZoom / pinchRef.current.zoom})`; }
      }} onTouchEnd={e => {
        if (pinchRef.current) {
          const nextZoom = pinchRef.current.nextZoom;
          pinchRef.current = null;
          if (stageRef.current) stageRef.current.style.transform = '';
          update({ zoom: Math.round(nextZoom * 4) / 4 });
          swipeRef.current = null;
          return;
        }
        if (!swipeRef.current) return;
        const dx = e.changedTouches[0].clientX - swipeRef.current.x, dy = e.changedTouches[0].clientY - swipeRef.current.y;
        const delta = prefs.mode === 'landscape' ? dx : dy;
        if (Math.abs(delta) > 65) turn(delta < 0 ? 1 : -1);
        swipeRef.current = null;
      }} onTouchCancel={() => { pinchRef.current = null; swipeRef.current = null; if (stageRef.current) stageRef.current.style.transform = ''; }}>
        {loadingFont && <div className="font-load-progress" role="status" aria-label="Loading notation font"/>}
        {painting && <div className="score-loading" role="status" aria-label={painted ? 'Rendering score' : 'Preparing score'}><span className="score-loading-spinner"/><span>{painted ? 'Rendering score' : 'Preparing score'}</span></div>}
        <div className={`score-content ${painting || !painted ? 'is-painting' : ''}`} style={{ '--landscape-meta-offset': prefs.chordSymbols ? '0px' : '35px', '--annotation-font': prefs.annotationFont === 'Serif' ? 'Georgia, serif' : prefs.annotationFont === 'Mono' ? 'ui-monospace, monospace' : 'DM Sans, Arial, sans-serif', '--music-font': prefs.notationFont } as React.CSSProperties}>
          {(hasScoreText || hiddenIds.length > 0) && <div className="score-meta">
            {score.title && <h1>{score.title}</h1>}
            {score.subtitle && <p className="score-subtitle">{score.subtitle}</p>}
            {score.composer && <p className="score-composer">{score.composer}</p>}
            {score.credits?.map((line, i) => <p className="score-credit" key={`${line}-${i}`}>{line}</p>)}
            {hiddenIds.length > 0 && <div className="hidden-staves" aria-label="Hidden staves">{score.parts.filter(part => hiddenSet.has(part.id)).map(part => <button key={part.id} onClick={() => togglePart(part.id)} title={`Show ${part.name}`} aria-label={`Show ${part.name}`}><img src={instrumentDetails(part.instrument).icon} alt=""/><EyeOff size={15}/><span>{part.name}</span></button>)}</div>}
          </div>}
          <div className="score-stage" ref={stageRef}>
            <div className="score-staves" ref={canvasRef}/>
            <div className="part-controls">{visibleScore.parts.map((part, index) => <div key={part.id} className="part-control" style={{ top: `${staffCenters[index] ?? 86 + index * ((prefs.names || prefs.counts) ? 125 : 100)}px`, height: score.parts.length > 4 ? '30px' : `${36 * scoreScale}px` }} title={`Sound for ${part.name}`}><button className="instrument-control" aria-label={`Instrument for ${part.name}`} aria-haspopup="dialog" onClick={() => openInstrumentPicker(part)}><img className="part-icon" style={{ width: score.parts.length > 4 ? '24px' : `${28 * scoreScale}px`, height: score.parts.length > 4 ? '24px' : `${28 * scoreScale}px` }} src={instrumentDetails(part.instrument).icon} alt=""/></button><span className="part-name" title={part.name}>{part.name}</span>{score.parts.length > 4 && <button className="staff-eye" aria-label={`Hide ${part.name}`} title={`Hide ${part.name}`} onClick={() => togglePart(part.id)} disabled={visibleScore.parts.length <= 1}><Eye size={17}/></button>}</div>)}</div>
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

        <div className="drawer-panel"><h3><Settings2 size={17}/> Reading</h3><div className="font-choice"><span>Notation font</span><div className="font-toggle" role="group" aria-label="Notation font"><button className={prefs.notationFont === 'Bravura' ? 'selected' : ''} aria-pressed={prefs.notationFont === 'Bravura'} onClick={() => update({ notationFont: 'Bravura' })}>Bravura</button><button className={prefs.notationFont === 'Petaluma' ? 'selected' : ''} aria-pressed={prefs.notationFont === 'Petaluma'} onClick={() => update({ notationFont: 'Petaluma' })}>Petaluma</button></div></div><div className="font-choice"><span>Stave text font</span><div className="font-toggle" role="group" aria-label="Stave text font">{(['Sans', 'Serif', 'Mono'] as const).map(font => <button key={font} className={prefs.annotationFont === font ? 'selected' : ''} aria-pressed={prefs.annotationFont === font} onClick={() => update({ annotationFont: font })}>{font}</button>)}</div></div><label className="field-label" htmlFor="overhang">Overhang <span>{prefs.overlap === 0 ? 'Off' : `${prefs.overlap} ${prefs.mode === 'portrait' ? (prefs.overlap === 1 ? 'stave line' : 'stave lines') : (prefs.overlap === 1 ? 'bar' : 'bars')}`}</span></label><input id="overhang" className="range" type="range" min="0" max="3" step="1" value={prefs.overlap} onChange={e => update({ overlap: Number(e.target.value) })}/><div className="switch-row"><span>Note names</span><button className={`switch ${prefs.names ? 'on' : ''}`} role="switch" aria-label="Note names" aria-checked={prefs.names} onClick={() => update({ names: !prefs.names })}/></div><div className="switch-row"><span>Chord symbols</span><button className={`switch ${prefs.chordSymbols ? 'on' : ''}`} role="switch" aria-label="Chord symbols" aria-checked={prefs.chordSymbols} onClick={() => update({ chordSymbols: !prefs.chordSymbols })}/></div><label className="switch-row inference-row"><span>Infer chord symbols</span><input type="checkbox" checked={prefs.inferChordSymbols} onChange={e => update({ inferChordSymbols: e.target.checked })}/></label><div className="switch-row"><span>Beat counts</span><button className={`switch ${prefs.counts ? 'on' : ''}`} role="switch" aria-label="Beat counts" aria-checked={prefs.counts} onClick={() => update({ counts: !prefs.counts })}/></div><div className="switch-row"><span>Count subdivisions</span><button className={`switch ${prefs.subdivisions ? 'on' : ''}`} role="switch" aria-label="Count subdivisions" aria-checked={prefs.subdivisions} onClick={() => update({ subdivisions: !prefs.subdivisions, counts: true })}/></div>{score.parts.length > 4 && <button className="text-action reset-staves" onClick={resetStaves}><RotateCcw size={15}/> Reset score staves</button>}</div>
        <div className="drawer-panel abc-panel"><h3><FileMusic size={17}/> ABC notation</h3><p>Paste ABC text, or use Open score file in the header.</p><textarea value={abc} onChange={e => setAbc(e.target.value)} spellCheck={false} aria-label="ABC notation"/><button className="primary-action" onClick={async () => { setPainting(true); try { loadScore(await parseAbc(abc)); } catch (e) { setPainting(false); setError(e instanceof Error ? e.message : 'Could not read ABC notation.'); } }}>View notation <ChevronRight size={17}/></button><button className="text-action" onClick={() => loadScore(exampleScore())}><FileMusic size={16}/> Open sample score</button></div>
        <div className="drawer-panel pitch-panel"><h3><Settings2 size={17}/> Pitch</h3><div className="pitch-options"><div><span className="pitch-label">Transpose score</span><div className="semitone-control"><button aria-label="Transpose down one semitone" disabled={prefs.semitones <= -12} onClick={() => changePitch({ semitones: prefs.semitones - 1 })}><Minus size={16}/></button><output aria-live="polite">{prefs.semitones > 0 ? '+' : ''}{prefs.semitones} semitones</output><button aria-label="Transpose up one semitone" disabled={prefs.semitones >= 12} onClick={() => changePitch({ semitones: prefs.semitones + 1 })}><Plus size={16}/></button><button className="pitch-reset" aria-label="Reset transposition" title="Reset transposition" disabled={prefs.semitones === 0} onClick={() => changePitch({ semitones: 0 })}><RotateCcw size={15}/></button></div></div><div><span className="pitch-label">Score view</span><div className="font-toggle pitch-view" role="group" aria-label="Score pitch view"><button className={prefs.scorePitch === 'written' ? 'selected' : ''} aria-pressed={prefs.scorePitch === 'written'} onClick={() => changePitch({ scorePitch: 'written' })}>Transposing</button><button className={prefs.scorePitch === 'concert' ? 'selected' : ''} aria-pressed={prefs.scorePitch === 'concert'} onClick={() => changePitch({ scorePitch: 'concert' })}>Concert</button></div></div></div><p className="pitch-hint">{hasTransposingParts ? 'Transposing shows written parts; Concert shows sounding pitches. Playback stays at concert pitch.' : 'This score has no instrument transposition data, so both views match.'}</p></div>
      </div>
      {error && <div className="error" role="alert">{error}</div>}
      <div className="drawer-foot">SPACE / PAGE DOWN · next view &nbsp;&nbsp; PAGE UP · previous view <span>FluidR3 GM · CC BY 3.0; TimGM drums · GPL-2</span></div>
    </aside>
    {error && !drawer && <div className="toast" role="alert"><span>{error}</span><button onClick={() => setError('')} aria-label="Dismiss"><X size={16}/></button></div>}
  </main>;
}
