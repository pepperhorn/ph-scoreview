import { BAR_HEADER_ID, drawerExtras, resolveBar, warnUnknownBar } from '../lib/bar-items';
import SkinBar from './SkinBar';
import DrawerControls from './DrawerControls';
import { skinKey, skinStyle, warnInvalidTheme, type PepperScoreSkin } from '../lib/skin';
import { useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Music2, Hash, ChevronDown, ChevronLeft, ChevronRight, Ellipsis, Eye, EyeOff, FileMusic, Focus, FolderOpen, History, Hourglass, Minus, Pause, Play, Plus, RotateCcw, SlidersHorizontal, Square, Settings2, Trash2, Type, VolumeX, X } from 'lucide-react';
import { exampleScore, gmProgramForSoundfont, gmSoundfontLabel, GM_FAMILIES, GM_SOUNDS, instrumentDetails, type GmFamily, type GmSound, type Part, type Score } from '../lib/score';
import { cancelImports, importMusicXmlText, importScoreFile, parseAbc } from '../lib/import';
import { portraitBarLimit, renderScore, type MeasureGeometry, type RenderResult } from '../lib/render';
import { partControlMetrics, type PartControlMetrics } from '../lib/part-controls';
import { HEADER_CONTROL_GROUP, HEADER_CONTROLS, MOBILE_HEADER_BREAKPOINT, type HeaderControlId } from '../lib/header-controls';
import { resolveChrome, type ChromePreset, type PepperScoreControls } from '../lib/chrome';
import { clampStaveScale, DESKTOP_QUERY, deviceClass, ENDLESS_STAVE_SCALE, minimumDefaultStaveScale, STAVE_SCALE_MAX, STAVE_SCALE_MIN, STAVE_SCALE_STEP } from '../lib/stave-scale';
import { buildFileState, clampBpm, MAX_BPM, MIN_BPM, textSource, type FileSource, type FileState, type ScoreView } from '../lib/file-state';
import { sampleSource, type ScoreDb } from '../lib/score-db';
import { ANNOTATION_SCALE, ANNOTATION_SIZE_PREF_KEYS, ANNOTATION_SIZES, BARS_PER_LINE_MAX, defaults, sanitizeSavedPrefs, settingsToPrefs, viewToMode, type AnnotationSize, type AnnotationSizePref, type PepperScoreSettings, type Prefs } from '../lib/prefs';
import { readerStorage, type PersistNamespace } from '../lib/storage';
import { scoreForView, spokenKey, transposeReadout } from '../lib/transpose';
import type { SpellingKey } from '../lib/spelling';
import { baseTimelineFor, deriveTimeline, playbackDuration, playbackEventsFrom, playbackMidis, playbackPositionAt, type BaseTimeline } from '../lib/playback/timeline';
import { closeVerovioChannel, isOutOfMemory, isRestarted, isSuperseded, openVerovioChannel, prepareVerovio, reduceChunkSize, setVerovioBaseUrl, warmVerovio } from '../lib/verovio-runtime';
import { thirdPartyNoticesUrl } from '../runtime-files';
import { claimPlayback, getSharedAudio, releasePlayback, resumeAudio } from '../lib/audio-engine';
import { isLargeFile, isLargeScore, largeScoreMessage, staffMeasures } from '../lib/large-file';
import { isSameFile, lastFileToFile, type LastFileInfo } from '../lib/last-file';
import { withEngravingDocument } from '../lib/notation/document';
import { SCORE_FILE_ACCEPT } from '../lib/score-files';
import { PAGE_PAD_PX, pageOfSystem, systemPages, turnTarget, type ReadingPage, type SystemSpan } from '../lib/paging';
import { fetchScoreFile } from '../lib/remote-score';
import OpenScoreDialog from './OpenScoreDialog';
import InstrumentChooser from './InstrumentChooser';
import OctaveTool from './OctaveTool';
import { loadPackInfo, resolveAssetBase, warnAssetBase, type SoundPackName } from '../lib/assets';
import { fallbackSf2Url, planKey, planSound, type SoundPlan, type SoundRequest, type SoundSource } from '../lib/sounds';
import { addDrumFallback, loadPlayers, type AudioPlayer } from '../lib/sound-players';
import { ensureMusicFonts, musicFontsReady, preloadMusicFont } from '../lib/asset-fonts';
import type { ExternalClock } from '../lib/clock';
import type { Shift } from '../lib/range-fit-core';
import { measureSeekSeconds, noteSeekSeconds } from '../lib/playback/clock-time';
import { nearestNote, noteInBox } from '../lib/hit-test';
import { withTabSettings } from '../lib/tab/string-instruments';
import { validTabTuning, STANDARD_TAB_TUNING } from '../lib/prefs';
import { canShowTab, hiddenReaderParts, type TabView } from '../lib/tab/tab-parts';
import { sourcePartOf, switchablePart, withPickedSound, type PartSwitch } from '../lib/instrument-view';
import { EMBED_INSTRUMENTS, type InstrumentId, type RangeLevel } from '../lib/instrument-model';
import { applyHostSwitchChange, hostInstrumentKey, pitchHint, readerPartsInfo, readerPitch, restoredScorePitch, selectOctaveNote, selectOctavePhrase, steppedOctaves, SWITCH_TARGETS, switchDefaults, switchedSoundParts, switchedTimeline, switchedView, switchesOnLoad, switchHighlights, withOctaves, withoutStalePins, withSound, withSourceSwitch, partLabel, type InstrumentSettings, type OctaveSelection } from '../lib/instrument-switch-state';

// Replaced by the consuming bundler, rather than by our library-mode build.
declare const process: { env: { NODE_ENV?: string } };

/** Short key name for readouts: 'Gb', 'C#m'. */
const keyName = (key: SpellingKey) => `${key.tonic}${key.mode === 'minor' ? 'm' : ''}`;
const clampSemitones = (semitones: number) => Math.max(-12, Math.min(12, semitones));
/** The longest a draw waits for the notation font (the first paint only; afterwards it is loaded). */
const FONT_WAIT_MS = 1500;
const sampleScore = () => withEngravingDocument(exampleScore());
const textFonts = { Sans: 'Poppins, Arial, sans-serif', Serif: 'Georgia, serif', Mono: 'ui-monospace, monospace' } as const;
const sampleAbc = `X:1\nT:A little room to play\nM:4/4\nL:1/4\nQ:1/4=96\nK:C\nC E G c | B A G E | C E G c | d2 c2 | G E D C | E G A G | F E D B, | C4 |`;
const playbackSound = (part: Part) => part.gmSoundfont || (part.instrument === 'drum-kit' ? 'drum-kit' : instrumentDetails(part.instrument).soundfont!);
const soundLabel = (part: Part) => part.gmSoundfont ? gmSoundfontLabel(part.gmSoundfont) : instrumentDetails(part.instrument).label;
const soundRequest = (part: Part): SoundRequest => {
  const sound = playbackSound(part);
  return sound === 'drum-kit' ? { drums: true } : { drums: false, program: gmProgramForSoundfont(sound) ?? 1, name: sound };
};
/** Sample packs route each note to its part's gain, so parts share them; sf2 and note-file players are bound to one part's gain. */
const audioKey = (plan: SoundPlan, part: Part) => plan.kind === 'sample-pack' ? planKey(plan) : `${planKey(plan)}|${part.id}`;
const SILENT_PLAYBACK_NOTICE = 'Audio couldn’t start on this device — playing silently.';
/** Systems drawn ahead of the playhead during playback (large scores draw systems on demand). */
const LOOKAHEAD_SYSTEMS = 2;
/** onTimeUpdate fires at most this often during self-driven playback (about 10 Hz). */
const TIME_UPDATE_MS = 100;
/** A click this many px outside a note's drawn box still hits it (a thin stem or a lone notehead). */
const NOTE_HIT_SLOP = 2;
export type PepperScoreReadyInfo = {
  title: string; composer?: string;
  /**
   * One entry per listed staff (a grand staff lists each staff; a TAB staff doubling a part is not listed). `sourcePart`
   * is the 1-based source part number (a grand staff's staves share one), `switchable` whether the instrument switch
   * applies to it. `settings.instruments` takes either `String(sourcePart)` or `id` as a key.
   */
  parts: Array<{ id: string; name: string; sourcePart: number; switchable: boolean }>;
  measures: number;
};
/** What a click on the engraving hit (`onElementClick`). */
export type PepperScoreClickInfo = {
  /** Viewer note id (data-note-id) when a note or rest was hit. */
  noteId?: string;
  /** Source element id (the MusicXML `id` attribute) of the first pitch of that note, when known. */
  sourceId?: string;
  /** Zero-based measure index, when a measure box was hit. */
  measureIndex?: number;
  /** 0..1 position of the click across the measure's width. */
  fraction?: number;
  /** 1-based index of the nearest visible staff in the system. */
  staff?: number;
  /**
   * When no note was hit: the drawn note or rest in the hit measure, on `staff`, whose notehead is nearest the click
   * across the engraving (its viewer id and MusicXML id). Engraved positions are not proportional to time, so this
   * maps a click in staff space to an event better than `fraction`.
   */
  nearestNoteId?: string;
  nearestSourceId?: string;
  clientX: number; clientY: number;
};
/** Adds `className` to the drawn notes (`ids`: note or source ids) and measures (`measures`: zero-based indexes); re-applied after every draw. */
export type PepperScoreHighlight = { ids?: string[]; measures?: number[]; className: string };
/** CSS pixels from each edge. */
export type PepperScoreInsets = { top?: number; right?: number; bottom?: number; left?: number };
/** What `scrollIntoView` reveals: the drawn notes (note or source ids, like `highlights`), else the measure (zero-based). */
export type PepperScoreScrollTarget = { ids?: string[]; measure?: number };
export type PepperScoreScrollOptions = {
  /** Keep the target at least this far inside the visible edges (a number for every edge). Default 0. */
  margin?: number | PepperScoreInsets;
  /**
   * When a scroll is needed, go this share (0..1) of the visible extent past the least scroll, in the direction of
   * travel, so what follows is in view too (the target always stays inside the margins). Default 0.
   */
  lead?: number;
  /** Client coordinates the target must also stay inside, e.g. the space between a host's overlays. */
  bounds?: PepperScoreInsets;
  /**
   * A `performance.now()` time: do nothing if the reader has scrolled, wheeled, touched or pressed on the score
   * since then (or a pointer is still down on it), so a reader's own scrolling or click is never overridden.
   */
  interactedSince?: number;
};
export type PepperScoreHandle = {
  /** Start playback (no-op while playing, when the chrome loads no audio, or with a `clock`). */
  play(): Promise<void>;
  /** Stop and rewind (no-op with a `clock`: the host owns time). */
  stop(): void;
  /** Set the absolute transposition in semitones (clamped to -12…12), like `settings.semitones`. */
  transpose(semitones: number): void;
  /**
   * Self-driven: move the playhead to `seconds` (playback seconds at the current BPM); while playing, playback continues
   * from there. With a `clock`: report `seconds` through `onSeek` (the host seeks its clock).
   */
  seek(seconds: number): void;
  /** Seconds of the playhead: `clock.now()` with a `clock`, else the self-driven position. */
  currentTime(): number;
  /** Draw the measure's system if needed and scroll the measure into view. */
  scrollToMeasure(index: number): Promise<void>;
  /** `seek` to the start of a measure (its first performed occurrence). */
  seekToMeasure(index: number): void;
  /**
   * Scroll the least distance (plus `lead`) that brings the target `margin` inside the visible edges; nothing moves
   * when it is already there. Horizontally the notes (else the measure) must show; vertically their whole system
   * (or the notes, when the system is taller than the view). Draws the measure's system if needed. Smooth, unless the
   * user prefers reduced motion. Does nothing while playback follows (it owns the view). Resolves `true` when it scrolled.
   */
  scrollIntoView(target: PepperScoreScrollTarget, options?: PepperScoreScrollOptions): Promise<boolean>;
};
export type PepperScoreProps = {
  /** Score sources; the first present wins, in this order. */
  musicXml?: string;
  /** A score file (MusicXML, MXL, MIDI, MEI or ABC). */
  file?: File;
  /** A public score file to download and open (relative URLs resolve against the page). */
  scoreUrl?: string;
  abc?: string;
  /** `"full"` (default): header, drawer, mixer, sample score and open-file UI; `"minimal"`: notation with a compact play button; `"none"`: engraving only, no audio. */
  chrome?: ChromePreset;
  /** Per-control overrides of the chrome preset (lib/chrome.ts). */
  controls?: PepperScoreControls;
  /** Plain-data skin; theme overrides apply live without re-engraving. */
  skin?: PepperScoreSkin;
  /** Initial reading view; changing it re-applies it. */
  view?: 'vertical' | 'endless';
  /** `"fill"` fills the parent's height; any CSS length fixes it; omitted, full chrome fills its parent (480px floor) and the others size to their score. */
  height?: string;
  /** Extra classes on the `.pepperscore` root. */
  className?: string;
  /** Accessible name of the reader's landmark region; default `"Score: <title>"` once a titled score loads, else `"Score reader"`. */
  ariaLabel?: string;
  /** Initial reader settings; changing a key re-applies that key. A score's saved record (with `persist`) wins over them. */
  settings?: PepperScoreSettings;
  /**
   * Namespace of the saved state (prefs, per-score records, last file; see lib/storage.ts); `false` saves nothing.
   * Default `"pepperscore"` for full chrome, `false` otherwise. `"scoreflow"` keeps the original Scoreflow names.
   */
  persist?: PersistNamespace;
  /** Root of a pepperscore-sounds-<pack> layout; default: the jsDelivr copy of pepperscore-sounds-<soundPack>. */
  assetBaseUrl?: string;
  /**
   * A directory with an interface-compatible Verovio build to engrave with instead of the copy shipped in
   * dist/verovio/, laid out like the verovio npm package's dist/ (`verovio-module.mjs` and `verovio.mjs`), for example
   * `https://cdn.jsdelivr.net/npm/verovio@6.3.0/dist/`. Relative URLs resolve against the page; cross-origin needs CORS.
   * All readers on a page share one Verovio worker: set it before the first score engraves (the latest value wins
   * when the worker next starts).
   */
  verovioBaseUrl?: string;
  soundPack?: SoundPackName;
  /** Sounds that replace the built-in ones for the programs (or drum kit) they claim; the first claiming entry wins. */
  soundSources?: SoundSource[];
  /** A score finished loading and drew (once per score). */
  onReady?(info: PepperScoreReadyInfo): void;
  onPlay?(): void;
  onStop?(): void;
  onError?(error: Error): void;
  /**
   * A host clock that drives the playhead (seconds from score beat 0, at the score's own tempo; the BPM setting is ignored).
   * With a clock, the reader never plays sound or runs its own transport, and the playhead shows for every chrome preset.
   * Pass a stable object (a new object re-subscribes).
   */
  clock?: ExternalClock;
  /** `false` never loads or schedules sound: self-driven playback runs silently on wall-clock time. Default `true`. */
  audio?: boolean;
  /** With a `clock`: a click on a note or measure (or `handle.seek`) reports its time here instead of seeking. */
  onSeek?(seconds: number): void;
  /** Self-driven playback time, about 10 times a second while playing. */
  onTimeUpdate?(seconds: number): void;
  /** Any click on the engraving (every chrome, with or without a clock): the note, measure and staff it hit. */
  onElementClick?(info: PepperScoreClickInfo): void;
  /** Every draw landed (the first paint, a re-layout, an in-place swap), with `highlights` already applied. */
  onRender?(): void;
  /** Classes to add to notes and measures (for a host's selection or cursor; see the `ps-*` classes in styles.css). */
  highlights?: PepperScoreHighlight[];
  /** Focus the reader on mount so page-turn keys work before any click. */
  autoFocus?: boolean;
  /**
   * How a new `musicXml` or `abc` replaces a score already on screen. `"reveal"` (default): fade out, show the loading
   * overlay, scroll to the top and fade the new score in. `"none"`: keep the current engraving and scroll position until
   * the new one replaces it in place, with no fade or overlay (for a host that edits the score it shows, like the
   * editor). The first paint, other sources and setting changes (mode, font, transposition) always reveal.
   */
  paintTransition?: 'reveal' | 'none';
  ref?: React.Ref<PepperScoreHandle>;
};
/** The widest control gutter a viewport can spare: 42% of it, leaving the first system at least its 180px minimum (render.ts). */
const maxControlGutter = (width: number) => Math.max(120, Math.min(Math.round(width * .42), width - 180));
/** Keyboard steps on the stave scale slider commit once they settle; drags and pinches commit on release. */
const STAVE_SCALE_COMMIT_MS = 180;
/** A per-score record read never holds up the first paint for longer than this. */
const SCORE_RECORD_TIMEOUT_MS = 1200;
const readScoreRecord = (scoreDb: ScoreDb, source: FileSource) => Promise.race([
  scoreDb.read(source).catch(() => null),
  new Promise<null>(resolve => setTimeout(() => resolve(null), SCORE_RECORD_TIMEOUT_MS)),
]);
/** After a user scroll (wheel, scrollbar drag, page turn) playback follow leaves the view alone this long. */
const FOLLOW_SUSPEND_MS = 2500;
/** A programmatic smooth scroll counts as in flight until it lands, or for at most this long. */
const SCROLL_SETTLE_MS = 900;
/**
 * A scroll event this soon after the reader's last wheel, touch or scroll is theirs too (momentum after a flick, a
 * smooth wheel scroll), so `scrollIntoView` keeps waiting until it has stopped.
 */
const MOMENTUM_GAP_MS = 200;
/** Guidance added to the renderer's out-of-memory message. */
const OOM_GUIDANCE = 'Close other tabs, or try again with smaller sections.';
/** Shown when the renderer kept restarting under a draw (other readers on the page running out of memory). */
const RENDERER_RESTARTED = 'The notation renderer restarted while drawing this score.';
/** Draws re-run this many times after a renderer restart before the reader reports it. */
const RESTART_REDRAWS = 2;
/**
 * A draw superseded while it is still this reader's latest (an import of another score on its channel was in flight,
 * e.g. the built-in sample's when a source prop arrives) is tried again after this delay, up to SUPERSEDED_REDRAWS times.
 */
const SUPERSEDED_REDRAW_MS = 250;
const SUPERSEDED_REDRAWS = 40;
const LAST_FILE_PRIVACY = 'The last opened file is kept only on this device (in this browser), so it can be reopened after a reload. It is never uploaded.';
const scrollBehavior = (): ScrollBehavior => window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
const flag = (element: HTMLElement, key: 'psShort' | 'psTiny' | 'psWide', on: boolean) => { if (on) element.dataset[key] = ''; else delete element.dataset[key]; };
/** Where the viewport centre sits in a measure, so a re-layout can put that point back at the centre. */
type ZoomAnchor = { index: number; fx: number; fy: number };

/** Size step names (button titles in the drawer's size controls). */
const ANNOTATION_SIZE_NAMES: Record<AnnotationSize, string> = { xs: 'Extra small', sm: 'Small', md: 'Medium', rg: 'Regular', lg: 'Large', xl: 'Extra large' };

/**
 * A staff's label beside the score: its name and, while switched, the instrument it is shown as ("Piano → Guitar").
 * The arrow is visual only; a screen reader reads "Piano as Guitar".
 */
function PartName({ label }: { label: { name: string; switched?: string } }) {
  if (!label.switched) return <span className="part-name" title={label.name}>{label.name}</span>;
  return <span className="part-name is-switched" title={`${label.name}, shown as ${label.switched}`}>
    <span className="part-name-source">{label.name}</span>
    <span className="part-name-target"><span className="part-name-arrow" aria-hidden="true">→ </span><span className="ps-visually-hidden"> as </span>{label.switched}</span>
  </span>;
}

export default function PepperScore({ musicXml, file, scoreUrl, abc, chrome: preset = 'full', controls, skin, view, height, className, ariaLabel, settings, persist, assetBaseUrl, verovioBaseUrl, soundPack = 'core', soundSources, onReady, onPlay, onStop, onError, clock, audio: withAudio = true, onSeek, onTimeUpdate, onElementClick, onRender, highlights, autoFocus, paintTransition = 'reveal', ref }: PepperScoreProps) {
  const themeKey = skinKey(skin);
  const themeStyle = useMemo(() => skinStyle(skin), [themeKey]);
  useEffect(() => {
    try {
      if (process.env.NODE_ENV !== 'production' && rootRef.current) { warnInvalidTheme(rootRef.current, skin); warnUnknownBar(skin); }
    } catch {
      // No process global: not a known development host, so skip the diagnostic.
    }
  }, [themeKey]);
  const bar = resolveBar(skin, preset, controls);
  const barKey = JSON.stringify(bar);
  const chrome = useMemo(() => resolveChrome(preset, controls, bar), [preset, barKey, controls?.mixer, controls?.openFile, controls?.drawer, controls?.transport, controls?.viewToggle, controls?.zoom, controls?.tabToggle, controls?.instrumentSwitch, controls?.octaveTool]);
  /** A host clock always shows the playhead (ivories uses chrome="none" with a clock). */
  const playhead = chrome.playhead || Boolean(clock);
  const storage = useMemo(() => readerStorage(persist ?? (preset === 'full' ? 'pepperscore' : false)), [persist, preset]);
  // Host settings and view as prefs; only keys the host gives are applied (on mount, on each score load, and when they change).
  const settingsKey = JSON.stringify(settings ?? {});
  const hostPrefs = useMemo<Partial<Prefs>>(() => {
    const mapped = settingsToPrefs(settings);
    if (mapped.zoom != null) mapped.zoom = clampStaveScale(mapped.zoom);
    return { ...mapped, ...(view ? { mode: viewToMode(view) } : {}) };
  }, [settingsKey, view]);
  const hostPrefsRef = useRef(hostPrefs);
  // The host's instrument settings (per-part state, not prefs): applied on a score load without a saved record (or over
  // one saved under other host instrument settings: instrument-switch-state.ts switchesOnLoad), and again for the keys a
  // host changes.
  const instrumentSettings = useMemo<InstrumentSettings>(() => ({ instrument: settings?.instrument, instruments: settings?.instruments, rangeLevel: settings?.rangeLevel, autoRange: settings?.autoRange }), [settingsKey]);
  const instrumentSettingsRef = useRef(instrumentSettings);
  const callbacks = useRef({ onReady, onPlay, onStop, onError, onSeek, onTimeUpdate, onElementClick, onRender });
  callbacks.current = { onReady, onPlay, onStop, onError, onSeek, onTimeUpdate, onElementClick, onRender };
  const clockRef = useRef(clock);
  clockRef.current = clock;
  const natural = !height && preset !== 'full';
  const storageRef = useRef(storage);
  storageRef.current = storage;
  const [score, setScore] = useState<Score>(sampleScore);
  const [scoreRevision, setScoreRevision] = useState(0);
  const [prefs, setPrefs] = useState<Prefs>(defaults);
  const [source, setSource] = useState<FileSource | null>(null);
  const [hiddenIds, setHiddenIds] = useState<string[]>([]);
  /** The reader's instrument switch per staff part (instrument-view.ts); a grand staff's staves share one choice. */
  const [partSwitches, setPartSwitches] = useState<Record<string, PartSwitch>>({});
  /** The octave tool (on: a note click selects instead of seeking) and its selection. */
  const [octaveTool, setOctaveTool] = useState(false);
  const [octaveSelection, setOctaveSelection] = useState<OctaveSelection | null>(null);
  const [trackVolumes, setTrackVolumes] = useState<Record<string, number>>({});
  const [drawer, setDrawer] = useState(false);
  const [mixer, setMixer] = useState(false);
  const [openDialog, setOpenDialog] = useState(false);
  const [pickerPartId, setPickerPartId] = useState<string | null>(null);
  const [pickerFamily, setPickerFamily] = useState<GmFamily>('Keyboard');
  const [pickerPage, setPickerPage] = useState(0);
  const [pickerSection, setPickerSection] = useState<'instrument' | 'sound'>('sound');
  const [abcDraft, setAbcDraft] = useState(sampleAbc);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  /** Non-blocking "large score, this may take a while" notice for the file being opened. */
  const [largeNotice, setLargeNotice] = useState('');
  /** The large-score notice clears when the score it was shown for paints (armed once that score is loaded). */
  const largeNoticeArmedRef = useRef(false);
  /** An out-of-memory error and what to re-run after shrinking the engraving chunks; shown while `error` is its message. */
  const [oomRetry, setOomRetry] = useState<{ message: string; kind: 'open' | 'draw' } | null>(null);
  /** The file most recently passed to readFile, for an out-of-memory retry. */
  const lastFileRef = useRef<File | null>(null);
  /** The remembered last opened file (stored on this device), and whether to offer reopening it. */
  const [lastFileInfo, setLastFileInfo] = useState<LastFileInfo | null>(null);
  const [reopenOffer, setReopenOffer] = useState<LastFileInfo | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loadingAudio, setLoadingAudio] = useState(false);
  const [loadingFont, setLoadingFont] = useState(false);
  const [painted, setPainted] = useState(false);
  const [painting, setPainting] = useState(true);
  const [resizeTick, setResizeTick] = useState(0);
  /** Bumped when systems are drawn, released or resized after the first paint (large scores draw on demand). */
  const [layoutTick, setLayoutTick] = useState(0);
  /** Counts completed draws (a new RenderResult), so effects that decorate the engraving re-run on it. */
  const [drawTick, setDrawTick] = useState(0);
  const [active, setActive] = useState<string | null>(null);
  const [activeNotes, setActiveNotes] = useState<string[]>([]);
  const [position, setPosition] = useState(0);
  /** The playhead seconds as of the last move (state lags a render; the handle's currentTime() reads this). */
  const positionRef = useRef(0);
  const moveTo = useCallback((seconds: number) => { positionRef.current = seconds; setPosition(seconds); }, []);
  /** Whether the host clock is running (clock mode only); drives the measure cursor and follow like `playing`. */
  const [clockPlaying, setClockPlaying] = useState(false);
  /** Follow in clock mode: while the clock plays, and once after each clock seek. */
  const clockFollowRef = useRef({ playing: false, seekPending: false });
  const [ready, setReady] = useState(false);
  // Whether a score has loaded. Full chrome starts with the sample; the others show an empty frame until their source
  // loads. The first render depends only on the chrome, never on source props, so a client-only source (the demo's
  // ?score= link) cannot cause a hydration mismatch.
  const [loaded, setLoaded] = useState(preset === 'full');
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
  /** The next render swaps an edited source in place (`paintTransition: "none"`): no paint reveal or loading overlay. */
  const inPlaceRenderRef = useRef(false);
  const paintTransitionRef = useRef(paintTransition);
  paintTransitionRef.current = paintTransition;
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
  const rootRef = useRef<HTMLDivElement>(null);
  const bottomToolbarRef = useRef<HTMLDivElement>(null);
  const uid = useId();
  const panelId = `${uid}-more`;
  /** The embed instrument switcher (minimal chrome): its menu, the source part it shows, and whether it sits in the phone toolbar. */
  const [switchMenu, setSwitchMenu] = useState(false);
  const [switchSourceId, setSwitchSourceId] = useState<string | null>(null);
  const [skinPhone, setSkinPhone] = useState(false);
  const [phoneToolbar, setPhoneToolbar] = useState(false);
  const switchButtonRef = useRef<HTMLButtonElement>(null);
  const switchMenuRef = useRef<HTMLDivElement>(null);
  const switchMenuId = `${uid}-instrument-menu`;
  const overhangId = `${uid}-overhang`;
  const [scoreWidth, setScoreWidth] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const renderRef = useRef<RenderResult | null>(null);
  /** This reader's players and track gains on the page's shared AudioContext and master (audio-engine.ts). */
  const audioRef = useRef<{ context: AudioContext; master: DynamicsCompressorNode; players: Map<string, AudioPlayer[]>; partKeys: Map<string, string>; trackGains: Map<string, GainNode>; mixScale: number } | null>(null);
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
  /** The reader's last scroll, wheel, touch or press on the viewport (`scrollIntoView`'s `interactedSince`), and whether a pointer is down. */
  const interactedAtRef = useRef(-Infinity);
  const pointerDownRef = useRef(false);
  const assetBase = useMemo(() => resolveAssetBase(assetBaseUrl, soundPack), [assetBaseUrl, soundPack]);
  // This reader's Verovio channel (opened in an effect and closed in its cleanup, so StrictMode's remount gets a new one):
  // its imports and renders never supersede another reader's on the shared worker.
  const channelRef = useRef(0);
  const restartRedrawsRef = useRef(0);
  const supersededRedrawsRef = useRef(0);
  /** The score revision onReady last fired for. */
  const readyRevisionRef = useRef(-1);
  /** The score revision last drawn: a new source draws at once, only setting changes wait for the redraw fade. */
  const drawnRevisionRef = useRef(-1);
  // Before the channel and warm-up effects, so the worker (started on mount, see below) loads the host's Verovio.
  useEffect(() => setVerovioBaseUrl(verovioBaseUrl), [verovioBaseUrl]);
  /** The third-party notices URL, set after mount: on an SSR host the server would resolve it to a file: URL. */
  const [noticesUrl, setNoticesUrl] = useState<string>();
  useEffect(() => setNoticesUrl(thirdPartyNoticesUrl()), []);
  useEffect(() => { const channel = openVerovioChannel(); channelRef.current = channel; return () => { cancelImports(channel); closeVerovioChannel(channel); }; }, []);
  // A reader that will engrave (a supplied score, or full chrome's sample) starts Verovio now, in parallel with the
  // score's import, instead of after it. After the channel effect (so the worker belongs to an open channel and goes
  // when the last one closes) and with the host's Verovio applied first (the worker loads its files once).
  const engraves = Boolean(musicXml || file || scoreUrl || abc) || preset === 'full';
  useEffect(() => { if (engraves) { setVerovioBaseUrl(verovioBaseUrl); warmVerovio(); } }, [engraves]);
  useEffect(() => ensureMusicFonts(assetBase, failed => warnAssetBase(assetBase, failed)), [assetBase]);
  // The notation font downloads from mount, in parallel with the import and Verovio, rather than on first paint.
  useEffect(() => preloadMusicFont(prefs.notationFont), [prefs.notationFont, assetBase]);
  const hiddenSet = useMemo(() => new Set(hiddenIds), [hiddenIds]);
  /** Parts the reader lists, plays and controls: a TAB staff that doubles a notation part shows with it (tab/tab-parts.ts). */
  const readerParts = useMemo(() => score.parts.filter(part => !part.tabOf), [score]);
  const tabTuningKey = prefs.tabTuning.join(',');
  /** Hidden reader parts (the hidden-staves bar lists them; an ID of no reader part is never shown there). */
  const hiddenReader = useMemo(() => readerParts.filter(part => hiddenSet.has(part.id)), [readerParts, hiddenSet]);
  const visibleScore = useMemo(() => {
    const parts = readerParts.filter(part => !hiddenSet.has(part.id));
    return { ...score, parts: parts.length ? parts : readerParts.slice(0, 1) };
  }, [score, readerParts, hiddenSet]);
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    for (const [id, gain] of audio.trackGains) gain.gain.setTargetAtTime((trackVolumes[id] ?? 100) / 100 * audio.mixScale, audio.context.currentTime, .015);
  }, [trackVolumes]);
  // Verovio can only transpose written pitch to sounding pitch, so concert-basis scores show concert pitch, unless a
  // part is switched to a transposing instrument (instrument-switch-state.ts readerPitch).
  const pitchView = useMemo(() => readerPitch(score, partSwitches, prefs.scorePitch), [score, partSwitches, prefs.scorePitch]);
  const { scorePitch, forcedConcert } = pitchView;
  const viewedScore = useMemo(() => scoreForView(score, scorePitch, prefs.semitones, prefs.keyFlip), [score, scorePitch, prefs.semitones, prefs.keyFlip]);
  // The instrument switch runs last (a later scoreForView would drop it); the result carries its own pitches, so the
  // renderer never re-views it.
  const instrumentView = useMemo(() => switchedView(viewedScore, partSwitches, scorePitch), [viewedScore, partSwitches, scorePitch]);
  const tabInstrumentsKey = JSON.stringify(settings?.tabInstruments);
  const explicitTabTuning = validTabTuning(settings?.tabTuning) || prefs.tabTuning.join() !== STANDARD_TAB_TUNING.join();
  const displayScore = useMemo(() => withTabSettings(instrumentView.score, settings?.tabInstruments,
    explicitTabTuning ? prefs.tabTuning : undefined), [instrumentView.score, tabInstrumentsKey, tabTuningKey, explicitTabTuning]);
  /** The Notation / TAB / Both switch only shows when a stave of the score as shown (switched) can take TAB. */
  const tabAvailable = useMemo(() => canShowTab(displayScore), [displayScore]);
  const switchKey = JSON.stringify(partSwitches);
  // TAB staves doubling a switched part are hidden while it is (rendering only, never saved).
  const hiddenTabKey = instrumentView.hiddenTab.join('\u0000');
  const renderHiddenIds = useMemo(() => instrumentView.hiddenTab.length ? [...hiddenIds, ...instrumentView.hiddenTab] : hiddenIds, [hiddenIds, hiddenTabKey]);
  /** The octave tool is on (the host may hide it, and only a loaded score has notes to select). */
  const octaveOn = octaveTool && chrome.octaveTool && loaded;
  const selectionIds = octaveOn ? octaveSelection?.ids : undefined;
  /** Switched parts play the target instrument's sound. */
  const playParts = useMemo(() => switchedSoundParts(visibleScore.parts, instrumentView, partSwitches), [visibleScore, instrumentView, partSwitches]);
  /** Moved and out-of-range notes of the switch, the octave tool's selection, then the host's highlights. */
  const allHighlights = useMemo((): PepperScoreHighlight[] | undefined => {
    const own = [...switchHighlights(instrumentView), ...(selectionIds?.length ? [{ ids: selectionIds, className: 'ps-octave-selection' }] : [])];
    return own.length ? [...own, ...(highlights ?? [])] : highlights;
  }, [instrumentView, highlights, selectionIds]);
  // The key readout ("+2 · D") and the enharmonic key the flip offers, for the score as it is shown (header and drawer).
  const readout = useMemo(() => transposeReadout(score, scorePitch, prefs.semitones, prefs.keyFlip), [score, scorePitch, prefs.semitones, prefs.keyFlip]);
  // The performance timeline is built when playback first needs it, not while a score loads: on a large score it is
  // seconds of main-thread work that would otherwise hold up the first paint (docs/specs/large-score-performance.md).
  // It is built once per score (by the import worker when it registered one), in beats: BPM and transposition are
  // applied while playing, and hiding parts only filters it, so none of them rebuild it.
  const timelineRef = useRef<{ key: object; visible: string; view: object | null; timeline: BaseTimeline } | null>(null);
  /** The switched view the timeline follows (none without switched or moved parts: a sound pick or transpose keeps it). */
  const timelineView = Object.keys(instrumentView.staves).length ? instrumentView : null;
  // Without switched parts nothing the timeline reads changes with the view, so a transpose, key flip or pitch view
  // change keeps `loadTimeline` (and a host clock's subscription) as on a reader without the switch.
  const timelineSemitones = timelineView ? prefs.semitones : 0;
  const timelineKey: object = score.document || score;
  const visibleKey = visibleScore.parts.map(part => part.id).join('\u0000');
  const timelineOf = useCallback((): BaseTimeline | null => {
    const cached = timelineRef.current;
    return cached && cached.key === timelineKey && cached.visible === visibleKey && cached.view === timelineView ? cached.timeline : null;
  }, [timelineKey, visibleKey, timelineView]);
  const loadTimeline = useCallback(async (): Promise<BaseTimeline> => {
    const cached = timelineOf();
    if (cached) return cached;
    // Switched (and octave-moved) parts play the view's pitches; every other part plays the source as before.
    const base = deriveTimeline(await baseTimelineFor(score), { visiblePartIds: visibleScore.parts.map(part => part.id) });
    const timeline = timelineView ? switchedTimeline(base, timelineView, timelineSemitones) : base;
    timelineRef.current = { key: timelineKey, visible: visibleKey, view: timelineView, timeline };
    return timeline;
  }, [timelineOf, score, visibleScore, timelineKey, visibleKey, timelineView, timelineSemitones]);

  useEffect(() => {
    setPrefs({ ...sanitizeSavedPrefs(storage.readPrefs()), ...hostPrefsRef.current });
    const hasSource = Boolean(musicXml || file || scoreUrl || abc);
    // The last opened file is offered (never opened) on start, unless a score was supplied or one is already opening.
    let offerCancelled = false;
    void storage.lastFile.readInfo().then(info => {
      if (offerCancelled) return;
      setLastFileInfo(info);
      if (chrome.openFile && info && !hasSource && importRunRef.current === 0 && !storage.reopenDismissed()) setReopenOffer(info);
    });
    // A supplied score loads in the source effect below; without one, only full chrome shows the sample (the others
    // stay an empty frame: never ready, nothing engraved).
    if (hasSource || preset !== 'full') return () => { offerCancelled = true; };
    // The sample's record (saved zoom and settings) is read before the first paint.
    let cancelled = false;
    const sample = score;
    const src = sampleSource(sample);
    void readScoreRecord(storageRef.current.scoreDb, src).then(saved => {
      if (cancelled) return;
      if (importRunRef.current === 0) loadScore(sample, src, saved);
      setReady(true);
    });
    return () => { cancelled = true; offerCancelled = true; };
  }, []);
  // Global prefs are saved with the host's settings applied (they are re-applied on mount anyway); a key the host later
  // drops keeps its last value here.
  useEffect(() => { if (ready) { const { zoom: _zoom, ...global } = prefs; storage.writePrefs(global); } }, [prefs, ready, storage]);
  useEffect(() => {
    if (!ready || !source) return;
    const view = prefs.zoom !== null ? { zoom: prefs.zoom, zoomDevice: deviceClass() } : savedViewRef.current;
    savedViewRef.current = view;
    storage.scoreDb.write(buildFileState(source, prefs, score, hiddenIds, trackVolumes, view, Date.now(), partSwitches, hostInstrumentKey(instrumentSettings)));
  }, [ready, source, prefs, score, hiddenIds, trackVolumes, partSwitches, storage, instrumentSettings]);
  // Unload can cut an IndexedDB transaction short, so pending writes are also saved synchronously (write-ahead).
  useEffect(() => {
    const { scoreDb } = storage;
    const persistPending = () => scoreDb.persistPending();
    const hidden = () => { if (document.visibilityState === 'hidden') persistPending(); };
    window.addEventListener('pagehide', persistPending);
    document.addEventListener('visibilitychange', hidden);
    return () => { window.removeEventListener('pagehide', persistPending); document.removeEventListener('visibilitychange', hidden); void scoreDb.flush(); };
  }, [storage]);
  const update = (patch: Partial<Prefs>) => {
    if (['mode', 'notationFont', 'annotationFont', 'barsPerLine', 'names', 'chordSymbols', 'inferChordSymbols', 'counts', 'subdivisions', ...ANNOTATION_SIZE_PREF_KEYS, 'semitones', 'scorePitch', 'keyFlip', 'tabView', 'capo'].some(key => key in patch && patch[key as keyof Prefs] !== prefs[key as keyof Prefs])
      || (patch.tabTuning && patch.tabTuning.join() !== prefs.tabTuning.join())) setPainting(true);
    if (patch.mode && patch.mode !== prefs.mode) viewportRef.current?.scrollTo({ left: 0, top: 0 });
    setPrefs(prev => ({ ...prev, ...patch }));
  };
  // Another reader starting playback stops this one through the shared owner slot (audio-engine claimPlayback).
  const stopRef = useRef<(reset?: boolean) => void>(() => {});
  const playbackOwner = useMemo(() => ({ stop: () => stopRef.current(true) }), []);
  /** End the running playback (loop, scheduling, sounding notes) without changing the playing/loading state. */
  const halt = useCallback(() => {
    releasePlayback(playbackOwner);
    playRunRef.current += 1;
    if (playRef.current) { cancelAnimationFrame(playRef.current.frame); clearInterval(playRef.current.interval); }
    playRef.current = null;
    scheduledStopsRef.current.splice(0).forEach(item => item.stop());
    audioRef.current?.players.forEach(players => players.forEach(player => player.stop()));
  }, []);
  const stop = useCallback((reset = false) => {
    halt();
    setPlaying(false);
    setLoadingAudio(false);
    if (reset) { moveTo(0); setActive(null); setActiveNotes([]); }
  }, []);
  stopRef.current = stop;
  // A host clock owns the playhead: a transpose keeps it at the clock's time (it does not rebuild the timeline, so nothing would repaint it).
  const changePitch = (patch: Partial<Prefs>) => {
    if (!clockRef.current) stop(true);
    update(patch);
    // A transpose, key flip or pitch view changes the auto-fit plan too, so drop the "as written" pins it no longer overrides.
    const pitch = { scorePitch: patch.scorePitch ?? prefs.scorePitch, semitones: patch.semitones ?? prefs.semitones, keyFlip: patch.keyFlip ?? prefs.keyFlip };
    changeSwitches(current => withoutStalePins(score, current, pitch, hostSwitchDefaults()));
  };
  const transposeBy = (delta: number) => changePitch({ semitones: clampSemitones(prefs.semitones + delta) });
  /** Change the instrument switches (stops playback like a pitch change; nothing happens when they are unchanged). */
  const changeSwitches = (change: (current: Record<string, PartSwitch>) => Record<string, PartSwitch>) => {
    const next = change(partSwitches);
    if (JSON.stringify(next) === JSON.stringify(partSwitches)) return;
    if (!clockRef.current) stop(true);
    setPartSwitches(next);
  };
  const hostSwitchDefaults = () => switchDefaults(instrumentSettingsRef.current);
  /** Show every staff of a source part as `instrument` (undefined = as written). */
  /** A change of instrument, level or fit, without the "as written" pins its new auto-fit plan no longer overrides. */
  const changeSwitchPlan = (change: (current: Record<string, PartSwitch>) => Record<string, PartSwitch>) => changeSwitches(current => withoutStalePins(score, change(current), { scorePitch: prefs.scorePitch, semitones: prefs.semitones, keyFlip: prefs.keyFlip }, hostSwitchDefaults()));
  const setPartInstrument = (sourcePart: string, instrument: InstrumentId | undefined) => changeSwitchPlan(current => withSourceSwitch(score, current, sourcePart, { instrument }, hostSwitchDefaults()));
  const setPartLevel = (sourcePart: string, level: RangeLevel) => changeSwitchPlan(current => withSourceSwitch(score, current, sourcePart, { level }, hostSwitchDefaults()));
  const setPartAutoRange = (sourcePart: string, autoRange: boolean) => changeSwitchPlan(current => withSourceSwitch(score, current, sourcePart, { autoRange }, hostSwitchDefaults()));
  /** The reader's octave moves (by ScoreNote id) of one staff part. */
  const setOctaves = (partId: string, octaves: Record<string, Shift>) => changeSwitches(current => withOctaves(current, partId, octaves, hostSwitchDefaults()));
  /** Turn the octave tool on or off; it starts with nothing selected. Focus goes to its toolbar, then back to the reader. */
  const setOctaveToolOn = (on: boolean) => {
    setOctaveSelection(null);
    setOctaveTool(on);
    if (on) { setDrawer(false); setSwitchMenu(false); requestAnimationFrame(() => rootRef.current?.querySelector<HTMLElement>('.octave-toolbar')?.focus({ preventScroll: true })); }
    else rootRef.current?.focus({ preventScroll: true });
  };
  /** 8va / 8vb on the selection, from where its notes are shown (auto-fit and earlier moves). */
  const stepSelection = (step: 12 | -12) => { if (octaveSelection) setOctaves(octaveSelection.partId, steppedOctaves(partSwitches[octaveSelection.partId]?.octaves ?? {}, octaveSelection.ids, step, instrumentView.shifts, instrumentView.planned)); };
  /** Reset: the selection's staff, else every staff's octave moves. */
  const resetOctaves = () => changeSwitches(current => (octaveSelection ? [octaveSelection.partId] : Object.keys(current)).reduce((out, partId) => withOctaves(out, partId, {}, hostSwitchDefaults()), current));
  /**
   * Show a score with its saved record (if any). The saved zoom applies only on the device class it was chosen on.
   * `inPlace` replaces the score on screen without the paint reveal and keeps the scroll position.
   */
  const loadScore = (next: Score, nextSource: FileSource, saved: FileState | null, inPlace = false) => {
    const device = deviceClass();
    savedViewRef.current = saved?.view;
    const zoom = saved?.view?.zoomDevice === device ? saved.view.zoom : null;
    const restored = saved ? { ...next, parts: next.parts.map(part => {
      const state = saved.parts[part.id];
      if (!state) return part;
      return { ...part, importedInstrument: part.importedInstrument ?? part.instrument, instrument: state.instrument, gmSoundfont: state.gmSoundfont || (state.instrument === part.instrument ? part.gmSoundfont : instrumentDetails(state.instrument).soundfont || undefined) };
    }) } : next;
    stop(true); setPickerPartId(null); setScore(restored);
    if (inPlace) inPlaceRenderRef.current = true;
    else setPainting(true); setOctaveSelection(null); setScoreRevision(value => value + 1); setSource(nextSource); setLoaded(true);
    // Only reader parts hide (a TAB part that doubles a guitar shows with it: tab/tab-parts.ts hiddenReaderParts).
    setHiddenIds(saved ? hiddenReaderParts(next, saved.parts) : []);
    // The host's instruments apply to a score without a saved record, and over a saved record whose host instrument
    // settings differ from the host's now (a block changed to another instrument); else the reader's saved choices win.
    const switches = switchesOnLoad(next, saved, instrumentSettingsRef.current);
    setPartSwitches(switches);
    setTrackVolumes(saved ? Object.fromEntries(next.parts.map(part => [part.id, saved.parts[part.id]?.volume ?? 100])) : {});
    setError('');
    // A saved per-score record (persist on) wins over the host's settings and view: they are initial values, and the
    // reader's own edits to this score are newer. Without a record, the per-score resets (zoom, transposition, pitch
    // view) take the host's value for the keys it gives; every other pref keeps what the reader has now (drawer edits).
    const host = hostPrefsRef.current;
    const hostResets: Partial<Prefs> = Object.fromEntries((['zoom', 'semitones', 'scorePitch', 'bpm', 'keyFlip', 'tabView'] as const).filter(key => host[key] !== undefined).map(key => [key, host[key]]));
    setPrefs(prev => saved ? { ...prev, ...saved.settings, scorePitch: restoredScorePitch(next, switches, saved.settings.scorePitch), zoom } : { ...prev, bpm: clampBpm(Math.round(next.tempo)), zoom: null, semitones: 0, keyFlip: false, tabView: 'notation', scorePitch: 'written', ...hostResets });
    if (!inPlace) viewportRef.current?.scrollTo({ left: 0, top: 0 });
    setDrawer(false);
  };
  /** A supplied text source replaces a painted score in place (`paintTransition: "none"`). */
  const swapsInPlace = () => paintTransitionRef.current === 'none' && hasPaintedRef.current;
  /** Import supplied MusicXML text (read and identified in the import worker, like a file). */
  const readMusicXml = async (text: string) => {
    const run = ++importRunRef.current;
    const inPlace = swapsInPlace();
    setReady(true);
    startOpening(); stop(true);
    if (!inPlace) setPainting(true);
    try {
      const job = importMusicXmlText(text, 'MusicXML', channelRef.current);
      const src = await job.source;
      const [saved, next] = await Promise.all([readScoreRecord(storageRef.current.scoreDb, src), job.score]);
      if (run !== importRunRef.current) return;
      if (next.document) await prepareEngraving(next.document);
      if (run === importRunRef.current) loadScore(next, src, saved, inPlace);
    } catch (e) {
      if (run === importRunRef.current) { setPainting(false); showError(e, 'Could not read the supplied MusicXML.'); }
    }
  };
  /**
   * Show an error; an out-of-memory one gets guidance and a retry with smaller engraving chunks. So does a renderer that
   * kept restarting under this reader (other readers running out of memory), which has no raw message to show.
   */
  const showError = (e: unknown, fallback: string, retry?: 'open' | 'draw') => {
    const restarted = isRestarted(e);
    if (retry && (isOutOfMemory(e) || restarted)) {
      const message = `${restarted ? RENDERER_RESTARTED : (e as Error).message} ${OOM_GUIDANCE}`;
      setOomRetry({ message, kind: retry });
      setError(message);
      return;
    }
    setError(restarted ? RENDERER_RESTARTED : e instanceof Error ? e.message : fallback);
  };
  /** Import a score's engraving on this reader's channel; a renderer restart under it is tried once more. */
  const prepareEngraving = (doc: NonNullable<Score['document']>) => prepareVerovio(doc, channelRef.current)
    .catch(error => isRestarted(error) ? prepareVerovio(doc, channelRef.current) : Promise.reject(error));
  /** Opening any score retires the large-score notice, the reopen offer and the last error (so a repeated failure reports again). */
  const startOpening = () => { largeNoticeArmedRef.current = false; setLargeNotice(''); setReopenOffer(null); setError(''); };
  const readFile = async (file?: File) => {
    if (!file) return;
    const run = ++importRunRef.current;
    setReady(true);
    lastFileRef.current = file;
    startOpening();
    const phone = deviceClass() === 'compact';
    const largeBytes = isLargeFile(file.size);
    if (largeBytes) setLargeNotice(largeScoreMessage(file.size, { phone }));
    stop(true);
    setPainting(true);
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    try {
      // The import worker reads and hashes the file once and parses it off the main thread; the saved record is read
      // while the score imports, so its zoom is applied before the first paint.
      const job = importScoreFile(file, channelRef.current);
      const nextSource = await job.source;
      const [saved, nextScore] = await Promise.all([readScoreRecord(storageRef.current.scoreDb, nextSource), job.score]);
      // A compact file (an .mxl, a dense MIDI) can still be a large score: warn before engraving starts.
      if (!largeBytes && run === importRunRef.current && isLargeScore(nextScore)) setLargeNotice(largeScoreMessage(file.size, { phone, staffMeasures: staffMeasures(nextScore) }));
      if (run !== importRunRef.current) return;
      if (nextScore.document) await prepareEngraving(nextScore.document);
      if (run === importRunRef.current) {
        largeNoticeArmedRef.current = true;
        loadScore(nextScore, nextSource, saved);
        // Remembered after the import succeeds, off the open path; an unchanged file is not written again.
        if (!isSameFile(lastFileInfo, file)) void storageRef.current.lastFile.remember(file).then(info => { if (info) setLastFileInfo(info); });
      }
    }
    catch (e) { if (run === importRunRef.current) { setPainting(false); setLargeNotice(''); showError(e, 'Could not open this file.', 'open'); } }
  };
  /** Download a public score and open it like a chosen file. */
  const readUrl = async (url: string) => {
    const run = ++importRunRef.current;
    setReady(true);
    startOpening(); stop(true); setPainting(true); setError('');
    try {
      const file = await fetchScoreFile(url, document.baseURI);
      if (run === importRunRef.current) await readFile(file);
    }
    catch (e) { if (run === importRunRef.current) { setPainting(false); showError(e, 'Could not download this score.'); } }
  };
  // The supplied source: the first present of musicXml, file, scoreUrl and abc. A newer source (or unmount) retires an import in flight.
  useEffect(() => {
    if (musicXml) { void readMusicXml(musicXml); return () => { importRunRef.current++; }; }
    if (file) { void readFile(file); return () => { importRunRef.current++; }; }
    if (scoreUrl) { void readUrl(scoreUrl); return () => { importRunRef.current++; }; }
    if (abc) { void readAbc(abc, true); return () => { importRunRef.current++; }; }
  }, [musicXml, file, scoreUrl, abc]);
  // Host settings and view: a changed key is applied again (unchanged keys keep the reader's own edits).
  useEffect(() => {
    const previous = hostPrefsRef.current;
    hostPrefsRef.current = hostPrefs;
    const changed = Object.fromEntries(Object.entries(hostPrefs).filter(([key, value]) => previous[key as keyof Prefs] !== value)) as Partial<Prefs>;
    if (!Object.keys(changed).length || !ready) return;
    if ('semitones' in changed || 'scorePitch' in changed) changePitch(changed);
    else update(changed);
  }, [hostPrefs]);
  useEffect(() => {
    const previous = instrumentSettingsRef.current;
    instrumentSettingsRef.current = instrumentSettings;
    if (!ready || !loaded || JSON.stringify(previous) === JSON.stringify(instrumentSettings)) return;
    changeSwitchPlan(current => applyHostSwitchChange(score, current, previous, instrumentSettings));
  }, [instrumentSettings]);
  /** After an out-of-memory failure: engrave in smaller chunks and open or draw the score again. */
  const retryOutOfMemory = () => {
    const retry = oomRetry;
    if (!retry) return;
    reduceChunkSize();
    setOomRetry(null);
    setError('');
    if (retry.kind === 'open' && lastFileRef.current) { void readFile(lastFileRef.current); return; }
    setPainting(true);
    setResizeTick(value => value + 1);
  };
  const reopenLastFile = async () => {
    setReopenOffer(null);
    const record = await storage.lastFile.read();
    if (!record) { setLastFileInfo(null); setError('The last opened file is no longer stored on this device.'); return; }
    void readFile(lastFileToFile(record));
  };
  const dismissReopen = () => {
    setReopenOffer(null);
    storage.dismissReopen();
  };
  const forgetLast = () => { setReopenOffer(null); setLastFileInfo(null); void storage.lastFile.forget(); };
  const readAbc = async (text: string, supplied = false) => {
    const run = ++importRunRef.current;
    const inPlace = supplied && swapsInPlace();
    setReady(true);
    startOpening();
    if (!inPlace) setPainting(true);
    try {
      const src = textSource('abc', text, 'Pasted ABC');
      const [next, saved] = await Promise.all([parseAbc(text), readScoreRecord(storageRef.current.scoreDb, src)]);
      if (run === importRunRef.current) loadScore(next, src, saved, inPlace);
    } catch (e) { if (run === importRunRef.current) { setPainting(false); setError(e instanceof Error ? e.message : 'Could not read ABC notation.'); } }
  };
  const loadSample = async () => {
    const run = ++importRunRef.current;
    startOpening();
    setPainting(true);
    const sample = sampleScore();
    const src = sampleSource(sample);
    const saved = await readScoreRecord(storageRef.current.scoreDb, src);
    if (run === importRunRef.current) loadScore(sample, src, saved);
  };
  const togglePart = (id: string) => {
    if (!hiddenSet.has(id) && visibleScore.parts.length <= 1) return;
    stop(true); setPainting(true);
    setHiddenIds(previous => previous.includes(id) ? previous.filter(partId => partId !== id) : [...previous, id]);
    viewportRef.current?.scrollTo({ left: 0, top: 0 });
  };
  /** The stave a lone visible part is focused on, if any. */
  const focusedId = readerParts.length > 1 && visibleScore.parts.length === 1 ? visibleScore.parts[0].id : null;
  /** Focus hides every other stave; focusing the focused stave again shows them all. */
  const focusPart = (id: string) => {
    stop(true); setPainting(true);
    setHiddenIds(focusedId === id ? [] : readerParts.filter(part => part.id !== id).map(part => part.id));
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
    const outside = (event: PointerEvent) => { if (!moreRef.current?.contains(event.target as Node) && !switchMenuRef.current?.contains(event.target as Node)) setMoreOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && rootRef.current?.contains(event.target as Node) && !switchMenuRef.current?.contains(event.target as Node)) { setMoreOpen(false); moreRef.current?.querySelector<HTMLButtonElement>('.header-more-toggle')?.focus(); } };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [moreOpen]);
  // The embed switcher's menu closes on a click outside it (Escape is handled on the root, onRootKeyDown).
  useEffect(() => {
    if (!switchMenu) return;
    const outside = (event: PointerEvent) => { const target = event.target as Node; if (!switchMenuRef.current?.contains(target) && !switchButtonRef.current?.contains(target)) setSwitchMenu(false); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [switchMenu]);
  // The menu takes focus once, when it opens (choosing an option re-renders it and must leave focus on that option).
  useEffect(() => { if (switchMenu) switchMenuRef.current?.focus({ preventScroll: true }); }, [switchMenu]);
  // The menu is a manual popover in the top layer, so it is never clipped by the root (overflow hidden) and the root never
  // grows; it stays under .pepperscore in the DOM, so the scoped styles still apply. It is placed from the button's rect:
  // below it (or above, from the bottom toolbar), right-aligned to it and clamped to the viewport, and follows scrolls and resizes.
  useLayoutEffect(() => {
    const menu = switchMenuRef.current;
    if (!switchMenu || !menu) return;
    const place = () => {
      const button = switchButtonRef.current;
      if (!button || !menu.isConnected) return;
      const gap = 8, rect = button.getBoundingClientRect(), width = window.innerWidth, height = window.innerHeight;
      menu.style.maxHeight = '';
      menu.style.width = `${Math.min(320, width - 2 * gap)}px`;
      const natural = menu.scrollHeight + 2;
      const below = height - rect.bottom - 2 * gap, above = rect.top - 2 * gap;
      const downward = natural <= below || below >= above;
      const room = Math.max(120, downward ? below : above);
      const menuHeight = Math.min(natural, room);
      const top = downward ? rect.bottom + gap : rect.top - gap - menuHeight;
      menu.style.maxHeight = `${Math.min(room, height - 2 * gap)}px`;
      menu.style.top = `${Math.max(gap, Math.min(top, height - gap - menuHeight))}px`;
      menu.style.left = `${Math.max(gap, Math.min(rect.right - menu.offsetWidth, width - gap - menu.offsetWidth))}px`;
    };
    // Without the Popover API (no top layer) the menu is fixed and stacked above host content.
    if (typeof menu.showPopover === 'function') { if (!menu.matches(':popover-open')) menu.showPopover(); } else { menu.style.position = 'fixed'; menu.style.zIndex = '40'; }
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => { window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place); };
  });
  // Phones and tablets (deviceClass compact) get the switcher in a bottom toolbar, within thumb reach; set after mount so SSR markup matches.
  useEffect(() => {
    const query = window.matchMedia?.(DESKTOP_QUERY);
    const update = () => setPhoneToolbar(deviceClass() === 'compact');
    update();
    query?.addEventListener?.('change', update);
    return () => query?.removeEventListener?.('change', update);
  }, []);
  // Sizes come from the root, not the viewport: short/tiny/wide replace the old max-height/orientation media queries,
  // and a root wider than the header breakpoint closes the More panel.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const observer = new ResizeObserver(() => {
      setSkinPhone(root.clientWidth <= 580);
      const width = root.clientWidth, height = root.clientHeight, natural = root.dataset.psHeight === 'natural';
      flag(root, 'psShort', !natural && height <= 500);
      flag(root, 'psTiny', !natural && height <= 360);
      flag(root, 'psWide', width >= height);
      if (width > MOBILE_HEADER_BREAKPOINT) setMoreOpen(false);
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, []);
  useEffect(() => { if (autoFocus) rootRef.current?.focus({ preventScroll: true }); }, []);
  // Keys are handled on the root, so focus has to stay inside it: an overlay takes focus when it opens, and when one
  // closes with focus lost to <body> (its close button unmounted) focus returns to the overlay still open, or the root.
  const focusOnMount = useCallback((element: HTMLElement | null) => { element?.focus({ preventScroll: true }); }, []);
  const overlaysRef = useRef('');
  useEffect(() => {
    const overlays = `${mixer}|${pickerPartId ?? ''}`, was = overlaysRef.current;
    overlaysRef.current = overlays;
    if (!was || was === overlays) return;
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected) return;
    rootRef.current?.querySelector<HTMLElement>('.instrument-picker-panel, .mixer-panel')?.focus({ preventScroll: true }) ?? rootRef.current?.focus({ preventScroll: true });
  }, [mixer, pickerPartId]);
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    // Re-engrave on the border-box width: the client width also moves when the viewport's own scrollbar comes or goes,
    // which a re-engrave can cause (content a few px taller or shorter), so following it could loop.
    let width = viewport.offsetWidth;
    let height = viewport.clientHeight;
    const observer = new ResizeObserver(() => {
      // A height change keeps the layout but changes how many systems make a page.
      if (Math.abs(viewport.clientHeight - height) >= 1) { height = viewport.clientHeight; refreshPagesRef.current(); }
      if (Math.abs(viewport.offsetWidth - width) < 1) return;
      width = viewport.offsetWidth;
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
    // A zoom commit (or an in-place source swap) keeps the current score on screen until the new layout replaces it.
    const zoomCommit = quietRenderRef.current;
    const quiet = zoomCommit || inPlaceRenderRef.current;
    quietRenderRef.current = false;
    inPlaceRenderRef.current = false;
    const anchor = zoomCommit ? zoomAnchorRef.current : null;
    zoomAnchorRef.current = null;
    if (!quiet) setPainting(true);
    const draw = async () => {
      try {
        if (disposed) return;
        setScoreWidth(previous => previous === canvas.clientWidth ? previous : canvas.clientWidth);
        // Every multi-stave score gets a focus button per stave; a hide button joins it from five staves.
        const buttons = (readerParts.length > 1 ? 1 : 0) + (readerParts.length > 4 ? 1 : 0);
        const maxGutter = maxControlGutter(canvas.clientWidth);
        // Without part controls (they follow the mixer) the score takes the full width.
        const metricsFor = (stavePx: number, staffPitchPx: number) => {
          const metrics = partControlMetrics(stavePx, { staffPitchPx, maxGutter, buttons });
          return chrome.partControls ? metrics : { ...metrics, gutter: 0 };
        };
        const metaHeight = canvas.closest('.score-content')?.querySelector('.score-meta')?.getBoundingClientRect().height || 0;
        // A natural-height root sizes to its score, so there is no viewport height to fit against.
        const availableHeight = natural ? 4000 : Math.max(120, (viewportRef.current?.clientHeight || 600) - metaHeight - 70);
        // Without a user zoom the default ('fit': four bars in Vertical) is re-resolved for the viewport, so rotation re-fits.
        const requested = prefs.zoom ?? 'fit';
        // The SVG's SMuFL text (dynamics, tempo glyphs) is measured right after it is drawn: let the notation font
        // (loading since mount) arrive first, briefly, so those boxes use its metrics rather than a fallback's.
        await musicFontsReady(prefs.notationFont, FONT_WAIT_MS);
        if (disposed) return;
        const result = await renderScore(canvas, displayScore, prefs.mode, prefs.names, prefs.counts, prefs.subdivisions, prefs.barsPerLine, prefs.chordSymbols, prefs.inferChordSymbols, availableHeight, requested, 0, { gutterFor: (stavePx, staffPitchPx) => metricsFor(stavePx, staffPitchPx).gutter, fitCap: ENDLESS_STAVE_SCALE[deviceClass()], fitFloor: minimumDefaultStaveScale(deviceClass()), font: prefs.notationFont, textFont: prefs.annotationFont, hiddenPartIds: renderHiddenIds, generation, focusMeasure: anchor?.index, channel: channelRef.current, annotationScale: { names: ANNOTATION_SCALE[prefs.namesSize], chordSymbols: ANNOTATION_SCALE[prefs.chordSymbolsSize], counts: ANNOTATION_SCALE[prefs.countsSize], subdivisions: ANNOTATION_SCALE[prefs.subdivisionsSize] }, tab: { view: prefs.tabView, tuning: prefs.tabTuning, capo: prefs.capo } });
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
          setDrawTick(value => value + 1);
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
        restartRedrawsRef.current = 0;
        supersededRedrawsRef.current = 0;
        setError('');
        drawnRevisionRef.current = scoreRevision;
        if (scoreRevision > 0 && readyRevisionRef.current !== scoreRevision) {
          readyRevisionRef.current = scoreRevision;
          callbacks.current.onReady?.({ title: score.title, composer: score.composer || undefined, parts: readerPartsInfo(score), measures: score.parts[0]?.measures.length ?? 0 });
        }
        if (largeNoticeArmedRef.current) { largeNoticeArmedRef.current = false; setLargeNotice(''); }
      } catch (e) {
        // The renderer restarted under this draw (another reader ran out of memory): draw again, a bounded number of times.
        if (!disposed && isRestarted(e) && restartRedrawsRef.current < RESTART_REDRAWS) { restartRedrawsRef.current++; setResizeTick(value => value + 1); return; }
        // Superseded but still the latest draw: nothing else will draw this score, so try again once the channel is free.
        if (!disposed && isSuperseded(e) && generation === renderRunRef.current && supersededRedrawsRef.current < SUPERSEDED_REDRAWS) {
          supersededRedrawsRef.current++;
          timer = window.setTimeout(() => { if (!disposed) setResizeTick(value => value + 1); }, SUPERSEDED_REDRAW_MS);
        }
        if (!disposed && !isSuperseded(e)) {
          if (largeNoticeArmedRef.current) { largeNoticeArmedRef.current = false; setLargeNotice(''); }
          showError(e, 'Could not draw this score.', 'draw');
        }
      }
      finally {
        if (!disposed) frame = requestAnimationFrame(() => {
          hasPaintedRef.current = true;
          setPainted(true);
          setPainting(false);
        });
      }
    };
    setLoadingFont(false);
    // The fade covers a settings re-layout (mode, zoom, font, transposition); a new score source draws without waiting.
    const newSource = scoreRevision !== drawnRevisionRef.current;
    const delay = !quiet && !newSource && hasPaintedRef.current && !window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 260 : 0;
    timer = window.setTimeout(() => void draw(), delay);
    return () => { disposed = true; window.clearTimeout(timer); cancelAnimationFrame(frame); };
  }, [ready, resizeTick, scoreRevision, chrome.partControls, renderHiddenIds, switchKey, prefs.mode, prefs.notationFont, prefs.annotationFont, prefs.names, prefs.chordSymbols, prefs.inferChordSymbols, prefs.counts, prefs.subdivisions, prefs.namesSize, prefs.chordSymbolsSize, prefs.countsSize, prefs.subdivisionsSize, prefs.barsPerLine, prefs.zoom, prefs.semitones, prefs.keyFlip, scorePitch, prefs.tabView, tabTuningKey, tabInstrumentsKey, explicitTabTuning, prefs.capo]);

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
    // Blocks share an offset parent: its offset is summed once (a long score has thousands of blocks).
    const shared = blocks[0]?.offsetParent as HTMLElement | null | undefined;
    let base = 0;
    for (let element = shared ?? null; element && element !== viewport; element = element.offsetParent as HTMLElement | null) base += element.offsetTop;
    return blocks.map(block => {
      let top = 0;
      if (block.offsetParent === shared) top = base + block.offsetTop;
      else for (let element: HTMLElement | null = block; element && element !== viewport; element = element.offsetParent as HTMLElement | null) top += element.offsetTop;
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
    // A natural-height root shows its whole score: no pages, and no tail (which would grow the root it is measured by).
    const pages = spans.length && !natural ? systemPages(spans, viewport.clientHeight, overlapRef.current, pad) : [];
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
  // Any wheel, touch or press on the viewport (scrollbar, notes, empty space) is the reader's own interaction for
  // `scrollIntoView`; playback follow keeps its narrower test above.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const touched = () => { interactedAtRef.current = performance.now(); };
    const down = () => { touched(); pointerDownRef.current = true; };
    const up = () => { if (pointerDownRef.current) touched(); pointerDownRef.current = false; };
    // Scrolling that carries on from the reader's own (iOS momentum after touchend, a smooth wheel scroll) is theirs
    // while the events keep coming; a programmatic scroll in flight is not.
    const scrolled = () => {
      const now = performance.now(), programmatic = scrollTargetRef.current && now - scrollTargetRef.current.at <= SCROLL_SETTLE_MS;
      if (!programmatic && now - interactedAtRef.current <= MOMENTUM_GAP_MS) interactedAtRef.current = now;
    };
    const own = ['wheel', 'touchstart', 'touchmove', 'touchend'] as const;
    const release = ['pointerup', 'pointercancel', 'blur'] as const;
    for (const type of own) viewport.addEventListener(type, touched, { passive: true });
    viewport.addEventListener('scroll', scrolled, { passive: true });
    viewport.addEventListener('pointerdown', down, { passive: true });
    for (const type of release) window.addEventListener(type, up, { passive: true });
    return () => {
      for (const type of own) viewport.removeEventListener(type, touched);
      viewport.removeEventListener('scroll', scrolled);
      viewport.removeEventListener('pointerdown', down);
      for (const type of release) window.removeEventListener(type, up);
    };
  }, []);
  /** handle.scrollIntoView (see PepperScoreHandle). */
  const revealTarget = async (target: PepperScoreScrollTarget, options: PepperScoreScrollOptions = {}) => {
    // Playback follow owns the view while it plays; the reader's own interaction always wins.
    const interrupted = () => Boolean(playRef.current) || (clockRef.current ? clockFollowRef.current.playing : false)
      || pointerDownRef.current || (options.interactedSince !== undefined && interactedAtRef.current >= options.interactedSince);
    const result = renderRef.current, canvas = canvasRef.current;
    if (!result || !canvas || interrupted()) return false;
    const index = target.measure ?? -1;
    if (index >= 0) await result.ensureSystem(result.systemOfMeasure(index));
    const viewport = viewportRef.current;
    if (!viewport || renderRef.current !== result || interrupted()) return false;
    // The same lookup as `highlights`: a note by id, its chord as the unit.
    const notes = (target.ids ?? []).flatMap(id => {
      const element = result.point(id)?.element ?? canvas.querySelector(`[data-note-id="${CSS.escape(id)}"]`) ?? canvas.querySelector(`#${CSS.escape(id)}`);
      return element ? [element.closest('.chord') ?? element] : [];
    });
    const measure = index >= 0 ? result.measure(index)?.element : undefined;
    const elements = notes.length ? notes : measure ? [measure] : [];
    if (!elements.length) return false;
    const rects = elements.map(element => element.getBoundingClientRect());
    const own = { left: Math.min(...rects.map(r => r.left)), right: Math.max(...rects.map(r => r.right)), top: Math.min(...rects.map(r => r.top)), bottom: Math.max(...rects.map(r => r.bottom)) };
    if (!(own.right > own.left || own.bottom > own.top)) return false;
    const margin = typeof options.margin === 'number' ? { top: options.margin, right: options.margin, bottom: options.margin, left: options.margin } : options.margin ?? {};
    const bounds = options.bounds ?? {};
    const rect = viewport.getBoundingClientRect();
    const left = rect.left + viewport.clientLeft, top = rect.top + viewport.clientTop;
    const box = {
      left: Math.max(left, bounds.left ?? -Infinity) + (margin.left ?? 0),
      right: Math.min(left + viewport.clientWidth, bounds.right ?? Infinity) - (margin.right ?? 0),
      top: Math.max(top, bounds.top ?? -Infinity) + (margin.top ?? 0),
      bottom: Math.min(top + viewport.clientHeight, bounds.bottom ?? Infinity) - (margin.bottom ?? 0),
    };
    if (!(box.right > box.left && box.bottom > box.top)) return false;
    // Vertically the target's whole system shows when it fits.
    const block = elements[0].closest('.score-system')?.getBoundingClientRect();
    const rows = block && block.bottom - block.top <= box.bottom - box.top ? { top: Math.min(block.top, own.top), bottom: Math.max(block.bottom, own.bottom) } : own;
    const lead = Math.max(0, Math.min(1, options.lead ?? 0));
    // The least move that brings [start, end] inside [lo, hi], plus the lead, never pushing start past lo (or end past hi).
    const shift = (start: number, end: number, lo: number, hi: number) => {
      const room = hi - lo;
      if (end - start >= room) return start < lo || start > hi ? start - lo : 0;
      if (end > hi) return Math.min(end - hi + lead * room, start - lo);
      if (start < lo) return Math.max(start - lo - lead * room, end - hi);
      return 0;
    };
    const toLeft = Math.max(0, Math.min(viewport.scrollWidth - viewport.clientWidth, viewport.scrollLeft + shift(own.left, own.right, box.left, box.right)));
    const toTop = Math.max(0, Math.min(viewport.scrollHeight - viewport.clientHeight, viewport.scrollTop + shift(rows.top, rows.bottom, box.top, box.bottom)));
    if (Math.abs(toLeft - viewport.scrollLeft) < 1 && Math.abs(toTop - viewport.scrollTop) < 1) return false;
    scrollViewport({ left: toLeft, top: toTop });
    return true;
  };
  const revealTargetRef = useRef(revealTarget);
  revealTargetRef.current = revealTarget;
  // Keys act on the focused reader only: the handler sits on the root, so another instance (or the host page) never turns this one.
  const onRootKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (switchMenu && embedSwitchShown) {
      if (event.key === 'Escape') { setSwitchMenu(false); switchButtonRef.current?.focus({ preventScroll: true }); }
      return;
    }
    if (event.key === 'Escape' && pickerPartId) { setPickerPartId(null); return; }
    if (event.key === 'Escape' && mixer) { setMixer(false); return; }
    if (event.key === 'Escape' && drawer) {
      if (rootRef.current?.querySelector('.bottom-drawer')?.contains(document.activeElement)) rootRef.current.focus({ preventScroll: true });
      setDrawer(false); return;
    }
    if (event.key === 'Escape' && octaveOn && !openDialog) { setOctaveToolOn(false); return; }
    if (pickerPartId || mixer || openDialog) return;
    const target = event.target as HTMLElement;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
    // Space presses a focused button; keys inside the octave toolbar or a menu are theirs.
    // Only a match inside the reader counts: a host <a>, [role=button] card or same-named class around it must not swallow Space.
    const inReader = (selector: string) => { const hit = target.closest(selector); return Boolean(hit && hit !== rootRef.current && rootRef.current?.contains(hit)); };
    if ((event.key === ' ' && inReader('button, a, [role="button"], [role="switch"]')) || inReader('.octave-toolbar, .instrument-menu')) return;
    if (['PageDown', 'ArrowRight', 'ArrowDown', ' '].includes(event.key)) { event.preventDefault(); turn(1); }
    if (['PageUp', 'ArrowLeft', 'ArrowUp'].includes(event.key)) { event.preventDefault(); turn(-1); }
  };
  // Where the playhead is when no engraved note marks it (an empty intro, rest bars, or an unmapped note):
  // the measure and its fraction, quantized to a 32nd of the bar so the effect below re-runs only as the line moves.
  const measureCursor = useMemo(() => {
    // A negative time is a host count-in: no playhead yet.
    if (position < 0 || (!playing && !clockPlaying && position <= 0)) return null;
    if (active && renderRef.current?.point(active)?.element) return null;
    const timeline = timelineOf();
    if (!timeline) return null;
    // A host clock runs at the score's own tempo; the BPM setting only scales self-driven playback.
    const current = playbackPositionAt(timeline, position, clock ? timeline.initialBpm : prefs.bpm);
    const length = visibleScore.parts[0]?.measures[current.measureIndex]?.beats || 0;
    const fraction = length > 0 ? Math.max(0, Math.min(1, current.measureBeat / length)) : 0;
    return { measureIndex: current.measureIndex, fraction: Math.floor(fraction * 32) / 32 };
  }, [active, playing, clockPlaying, position, timelineOf, visibleScore, layoutTick, prefs.bpm, clock]);
  const measureCursorKey = measureCursor ? `${measureCursor.measureIndex}:${measureCursor.fraction}` : '';
  useEffect(() => {
    const result = renderRef.current;
    const note = active ? result?.point(active) : undefined;
    canvasRef.current?.querySelectorAll('.reader-note.is-playing').forEach(n => n.classList.remove('is-playing'));
    canvasRef.current?.querySelectorAll('.playback-line').forEach(n => n.remove());
    if (!playhead) return;
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
    // While playing, draw the systems ahead of the playhead: drawn only on arrival, a system's first bar would play
    // unhighlighted for the length of the draw (a whole bar or more for a large score at a fast tempo). Two ahead, as a
    // one-bar system at a fast tempo lasts about as long as drawing one.
    const playingNow = Boolean(playRef.current) || (clock ? clockFollowRef.current.playing : false);
    if (playingNow && result) {
      let ahead = block.nextElementSibling;
      for (let step = 1; step <= LOOKAHEAD_SYSTEMS && ahead; step++, ahead = ahead.nextElementSibling) {
        if (ahead.classList.contains('is-pending')) void result.ensureSystem(Number((ahead as HTMLElement).dataset.system));
      }
    }
    const line = anchor ? document.createElement('div') : null;
    if (line) {
      line.className = 'playback-line';
      line.style.left = `${note?.element ? note.x : measure!.x + measure!.width * measureCursor!.fraction}px`;
      block.appendChild(line);
    }
    // Follow playback in page jumps: nothing moves while the active system is in view, a smooth scroll in flight
    // is left to land, and a reader who just scrolled keeps their view for a moment.
    const viewport = viewportRef.current;
    const following = Boolean(playRef.current) || (clock ? clockFollowRef.current.playing || clockFollowRef.current.seekPending : false);
    if (!viewport || !following || performance.now() - userScrollAtRef.current < FOLLOW_SUSPEND_MS || pendingScroll()) return;
    clockFollowRef.current.seekPending = false;
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
  // so playback falls back to a silent wall-clock run instead of hanging on a suspended AudioContext. Also null when the
  // built-in sounds at assetBaseUrl fail to load.
  const ensureAudio = async (timeline: BaseTimeline) => {
    if (!audioRef.current) {
      const sharedAudio = getSharedAudio();
      if (!sharedAudio) return null;
      audioRef.current = { ...sharedAudio, players: new Map(), partKeys: new Map(), trackGains: new Map(), mixScale: 1 };
    }
    const audio = audioRef.current;
    if (!await resumeAudio(audio.context)) return null;
    audio.mixScale = .8 / Math.sqrt(Math.max(1, playParts.length));
    for (const part of playParts) {
      let gain = audio.trackGains.get(part.id);
      if (!gain) { gain = audio.context.createGain(); gain.connect(audio.master); audio.trackGains.set(part.id, gain); }
      gain.gain.value = (trackVolumes[part.id] ?? 100) / 100 * audio.mixScale;
    }
    const pack = await loadPackInfo(assetBase);
    const page = document.baseURI;
    const plans = new Map(playParts.map(part => [part.id, planSound(soundRequest(part), { sources: soundSources, fluidr3: pack.fluidr3, base: assetBase, page })]));
    audio.partKeys = new Map(playParts.map(part => [part.id, audioKey(plans.get(part.id)!, part)]));
    // A built-in sound that fails to load (an assetBaseUrl with no sounds package behind it) plays silently, with one
    // console warning, instead of failing playback. A host soundSources entry that fails still reports an error.
    const builtinFailed = (e: unknown) => { warnAssetBase(assetBase, `built-in sounds (${e instanceof Error ? e.message : String(e)})`); return null; };
    for (const key of new Set(audio.partKeys.values())) {
      const matching = playParts.filter(part => audio.partKeys.get(part.id) === key);
      const plan = plans.get(matching[0].id)!;
      const notes = playbackMidis(timeline, new Set(matching.map(part => part.id)), prefs.semitones);
      const destination = audio.trackGains.get(matching[0].id)!;
      const builtin = plan.sourceId.startsWith('builtin:');
      let players = audio.players.get(key);
      try {
        if (!players) { players = await loadPlayers(audio.context, plan, destination); audio.players.set(key, players); }
        await Promise.all(players.map(player => player.loadNotes?.(notes)));
      } catch (e) { if (builtin) return builtinFailed(e); throw e; }
      // The drum fallback is always the built-in TimGM6mb kit.
      if (plan.kind === 'note-files' && plan.drums) try { await addDrumFallback(audio.context, players, notes, fallbackSf2Url(assetBase), destination); } catch (e) { return builtinFailed(e); }
    }
    // Players no visible part uses any more (another score, a changed instrument, a hidden part) are released.
    const used = new Set(audio.partKeys.values());
    for (const [key, players] of audio.players) if (!used.has(key)) { players.forEach(player => player.dispose()); audio.players.delete(key); }
    return audio;
  };
  /** Start playback, or toggle it off. `from` (seconds) restarts from there without a stop/play edge: a seek. */
  const play = async (from?: number) => {
    // Nothing to play until a supplied score has loaded: an unloaded, loading or failed snippet never plays the hidden sample.
    // A host clock owns time: the reader never runs its own transport then.
    if (clockRef.current || !chrome.audio || !loaded) return;
    if (from === undefined && (playing || loadingAudio)) { stop(); return; }
    if (from !== undefined) halt();
    const run = ++playRunRef.current;
    // A silent reader (audio={false}) has nothing to stop on another reader, so it never claims the page's playback slot.
    if (withAudio) claimPlayback(playbackOwner);
    try {
      setLoadingAudio(true);
      const timeline = await loadTimeline();
      if (run !== playRunRef.current) return;
      const audio = withAudio ? await ensureAudio(timeline) : null;
      if (run !== playRunRef.current) return;
      setLoadingAudio(false);
      setNotice(audio || !withAudio ? '' : SILENT_PLAYBACK_NOTICE);
      // One clock drives scheduling and the cursor: audio time when sound works, wall time when playing silently.
      const now = audio ? () => audio.context.currentTime : () => performance.now() / 1000;
      const bpm = prefs.bpm;
      const duration = playbackDuration(timeline, bpm);
      const secondsStart = Math.max(0, Math.min(from ?? positionRef.current, duration));
      const started = now() + (audio ? .09 : 0);
      const events = playbackEventsFrom(timeline, secondsStart, bpm, prefs.semitones);
      let nextEvent = 0;
      const schedule = audio && (() => {
        const horizon = audio.context.currentTime + .5;
        while (nextEvent < events.length) {
          const event = events[nextEvent];
          const time = started + event.startSeconds - secondsStart;
          if (time > horizon) break;
          const duration = Math.max(.01, event.soundEndSeconds - event.startSeconds);
          const destination = audio.trackGains.get(event.partId);
          for (const player of audio.players.get(audio.partKeys.get(event.partId) ?? '') || []) scheduledStopsRef.current.push({ stop: player.start({ note: event.midi, time: Math.max(time, audio.context.currentTime), duration, velocity: event.velocity, destination }), end: time + duration });
          nextEvent++;
        }
        scheduledStopsRef.current = scheduledStopsRef.current.filter(item => item.end > audio.context.currentTime);
      });
      schedule?.();
      const interval = schedule ? setInterval(schedule, 50) : undefined;
      let lastTimeUpdate = -Infinity;
      const tick = () => {
        const seconds = secondsStart + Math.max(0, now() - started);
        if (seconds >= duration) { stop(true); return; }
        const current = playbackPositionAt(timeline, seconds, bpm);
        setActive(current.noteId);
        setActiveNotes(previous => previous.join('|') === current.activeNoteIds.join('|') ? previous : current.activeNoteIds);
        moveTo(seconds);
        const wall = performance.now();
        if (wall - lastTimeUpdate >= TIME_UPDATE_MS) { lastTimeUpdate = wall; callbacks.current.onTimeUpdate?.(seconds); }
        if (playRef.current) playRef.current.frame = requestAnimationFrame(tick);
      };
      playRef.current = { start: started, beat: secondsStart, frame: requestAnimationFrame(tick), interval };
      setPlaying(true);
    } catch (e) { if (run === playRunRef.current) { setLoadingAudio(false); if (from !== undefined) setPlaying(false); releasePlayback(playbackOwner); setError(e instanceof Error ? e.message : 'Audio could not start.'); } }
  };
  // Host callbacks: onError for each shown error, onPlay/onStop on the playing edges (stop-others included).
  useEffect(() => { if (error) callbacks.current.onError?.(new Error(error)); }, [error]);
  // Clock mode: the host clock drives the playhead. Each animation frame while it plays (and once per clock event), its
  // time maps to the score at the score's own tempo. Nothing is scheduled and no audio loads.
  useEffect(() => {
    if (!clock || !loaded) return;
    let cancelled = false, frame = 0;
    let timeline: BaseTimeline | null = null;
    const paint = () => {
      if (!timeline) return;
      const raw = clock.now();
      const seconds = Number.isFinite(raw) ? raw : 0;
      moveTo(seconds);
      if (seconds < 0) { setActive(null); setActiveNotes([]); return; }
      const current = playbackPositionAt(timeline, seconds, timeline.initialBpm);
      setActive(current.noteId);
      setActiveNotes(previous => previous.join('|') === current.activeNoteIds.join('|') ? previous : current.activeNoteIds);
    };
    const loop = () => { paint(); frame = clock.playing ? requestAnimationFrame(loop) : 0; };
    const restart = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(loop); };
    clockFollowRef.current.playing = clock.playing;
    setClockPlaying(clock.playing);
    const unsubscribe = clock.subscribe(event => {
      if (event.type === 'play' || event.type === 'pause') { clockFollowRef.current.playing = event.type === 'play'; setClockPlaying(event.type === 'play'); }
      if (event.type === 'seek') clockFollowRef.current.seekPending = true;
      restart();
    });
    loadTimeline().then(built => { if (cancelled) return; timeline = built; restart(); })
      .catch(e => { if (!cancelled) showError(e, 'Could not build the playback timeline.'); });
    return () => { cancelled = true; cancelAnimationFrame(frame); unsubscribe(); };
  }, [clock, loaded, loadTimeline]);
  /** A click on the engraving: `onElementClick` gets what it hit; with a clock, the note's (or measure's) time goes to `onSeek`. */
  const onScoreClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!octaveOn && !clock && !callbacks.current.onElementClick) return; // nothing listens: skip the hit testing (layout reads)
    const result = renderRef.current;
    let noteId = (event.target as Element).closest?.('[data-note-id]')?.getAttribute('data-note-id') ?? undefined;
    const hit = result?.measures.find(measure => {
      const rect = measure.element?.getBoundingClientRect();
      return Boolean(rect && rect.width && event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom);
    });
    // The hit measure's drawn notes with their boxes and notehead centres (client px).
    const drawn = hit && result ? result.points.filter(point => point.measure === hit.index && point.element?.isConnected).map(point => {
      const element = point.element!;
      const heads = Array.from(element.querySelectorAll('.notehead'), head => head.getBoundingClientRect());
      return { point, box: element.getBoundingClientRect(), heads };
    }) : [];
    // A click inside a note's drawn box (its stem, flag, accidental, dots, or the gaps between them, not only the ink
    // under the pointer) hits that note; overlapping boxes go to the nearest notehead (stacked voices split by y).
    if (!noteId) noteId = noteInBox(drawn, event.clientX, event.clientY, NOTE_HIT_SLOP)?.point.id;
    // The octave tool: a note click selects (Shift-click extends); it neither seeks nor reports the click.
    if (octaveOn) {
      const id = noteId;
      if (id) setOctaveSelection(current => selectOctaveNote(score, current, id, event.shiftKey));
      return;
    }
    const sourceOf = (id: string) => score.document?.identity?.noteIdToSourceId?.[id] ?? id;
    if (callbacks.current.onElementClick) {
      const rect = hit?.element?.getBoundingClientRect();
      const system = hit && result ? result.systems[hit.system] : undefined;
      const block = hit?.element?.closest('.score-system')?.getBoundingClientRect();
      let staff: number | undefined;
      // Staff centres are px from the top of the system block.
      if (system?.staffCenters.length && block) {
        const y = event.clientY - block.top;
        staff = system.staffCenters.reduce((best, centre, i) => Math.abs(centre - y) < Math.abs(system.staffCenters[best] - y) ? i : best, 0) + 1;
      }
      // Staff space: the note or rest on the clicked staff whose notehead is nearest across the bar.
      const nearest = noteId || staff === undefined ? undefined : nearestNote(drawn.filter(({ point }) => point.part === staff! - 1), event.clientX, event.clientY)?.point.id;
      callbacks.current.onElementClick({
        noteId, sourceId: noteId ? sourceOf(noteId) : undefined,
        measureIndex: hit?.index, fraction: rect?.width ? Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)) : undefined,
        staff, ...(nearest ? { nearestNoteId: nearest, nearestSourceId: sourceOf(nearest) } : {}), clientX: event.clientX, clientY: event.clientY,
      });
    }
    if (!clock) return;
    const timeline = timelineOf();
    if (!timeline || !result) return;
    const bpm = timeline.initialBpm;
    const now = Math.max(0, Number.isFinite(clock.now()) ? clock.now() : 0);
    let seconds = noteId ? noteSeekSeconds(timeline, noteId, now, bpm) : null;
    if (seconds === null && hit) seconds = measureSeekSeconds(timeline, hit.index, now, bpm);
    if (seconds !== null) callbacks.current.onSeek?.(seconds);
  };
  // Host highlights: re-applied after every draw (systems drawn later included); elements a draw replaced lose them with it.
  // A highlighted measure also gets a dashed box (a CSS outline on an SVG group is drawn in viewBox units, a fraction of
  // a pixel on screen). The box lives in an overlay group beside the measures, so measure bounds (click hit-testing, the
  // zoom anchor) stay unpadded. Without highlights there is no DOM work and no draw subscription.
  useEffect(() => {
    const result = renderRef.current, canvas = canvasRef.current;
    if (!canvas || !allHighlights?.length) return;
    const classed = new Map<Element, string[]>();
    const boxes = new Map<Element, SVGRectElement>();
    const apply = () => {
      const wanted = new Map<Element, string[]>(), measures = new Map<Element, string[]>();
      const want = (map: Map<Element, string[]>, element: Element, name: string) => { const names = map.get(element); if (!names) map.set(element, [name]); else if (!names.includes(name)) names.push(name); };
      for (const item of allHighlights) {
        for (const id of item.ids ?? []) {
          const element = result?.point(id)?.element ?? canvas.querySelector(`[data-note-id="${CSS.escape(id)}"]`) ?? canvas.querySelector(`#${CSS.escape(id)}`);
          if (element) want(wanted, element.closest('.chord') ?? element, item.className);
        }
        for (const index of item.measures ?? []) {
          const element = result?.measure(index)?.element;
          if (element) { want(wanted, element, item.className); want(measures, element, item.className); }
        }
      }
      // Reads first: boxes for newly highlighted measures, in the user space of their parent (where the overlay goes).
      const added: { measure: Element; parent: Element; x: number; y: number; width: number; height: number }[] = [];
      for (const measure of measures.keys()) {
        const parent = measure.parentElement;
        if (boxes.has(measure) || !parent) continue;
        try {
          const graphics = measure as SVGGraphicsElement, bbox = graphics.getBBox();
          if (!(bbox.width > 0 && bbox.height > 0)) continue;
          const own = graphics.getCTM(), base = (parent as unknown as SVGGraphicsElement).getCTM?.(), screen = graphics.getScreenCTM();
          const transform = own && base ? base.inverse().multiply(own) : new DOMMatrix();
          const corners = [[bbox.x, bbox.y], [bbox.x + bbox.width, bbox.y], [bbox.x, bbox.y + bbox.height], [bbox.x + bbox.width, bbox.y + bbox.height]]
            .map(([x, y]) => new DOMPoint(x, y).matrixTransform(transform));
          // 4 screen pixels of padding, in the parent's user units.
          const parentScreen = screen ? screen.multiply(transform.inverse()) : null;
          const scale = parentScreen ? Math.hypot(parentScreen.a, parentScreen.b) : 0, pad = scale ? 4 / scale : 0;
          const left = Math.min(...corners.map(p => p.x)), top = Math.min(...corners.map(p => p.y));
          added.push({ measure, parent, x: left - pad, y: top - pad,
            width: Math.max(...corners.map(p => p.x)) - left + 2 * pad, height: Math.max(...corners.map(p => p.y)) - top + 2 * pad });
        } catch { /* not rendered */ }
      }
      // Then writes: classes, stale boxes, new boxes.
      for (const [element, names] of classed) {
        const keep = wanted.get(element);
        for (const name of names) if (!keep?.includes(name)) element.classList.remove(name);
        if (!keep) { element.removeAttribute('data-ps-highlight'); classed.delete(element); }
      }
      for (const [element, names] of wanted) {
        for (const name of names) if (!element.classList.contains(name)) element.classList.add(name);
        const joined = names.join(' ');
        if (element.getAttribute('data-ps-highlight') !== joined) element.setAttribute('data-ps-highlight', joined);
        classed.set(element, names);
      }
      for (const [measure, rect] of boxes) {
        if (measure.isConnected && measures.has(measure)) continue;
        const layer = rect.parentElement; rect.remove(); boxes.delete(measure);
        if (layer && !layer.childElementCount) layer.remove();
      }
      for (const box of added) {
        let layer = box.parent.querySelector(':scope > .ps-highlight-layer');
        if (!layer) {
          layer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
          layer.setAttribute('class', 'ps-highlight-layer');
          layer.setAttribute('aria-hidden', 'true');
          box.parent.appendChild(layer); // after the music, so it paints on top
        }
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('class', 'ps-measure-highlight');
        rect.setAttribute('x', String(box.x)); rect.setAttribute('y', String(box.y));
        rect.setAttribute('width', String(box.width)); rect.setAttribute('height', String(box.height));
        layer.appendChild(rect);
        boxes.set(box.measure, rect);
      }
      for (const [measure, rect] of boxes) {
        const names = measures.get(measure)!.join(' ');
        if (rect.getAttribute('data-ps-class') !== names) rect.setAttribute('data-ps-class', names);
      }
    };
    apply();
    const unsubscribe = result?.onChange(apply);
    return () => {
      unsubscribe?.();
      for (const [element, names] of classed) { for (const name of names) element.classList.remove(name); element.removeAttribute('data-ps-highlight'); }
      for (const rect of boxes.values()) { const layer = rect.parentElement; rect.remove(); if (layer && !layer.childElementCount) layer.remove(); }
    };
  }, [allHighlights, loaded, drawTick]);
  // After the highlights effect, so a host reading them (or the new layout) sees this draw's.
  useEffect(() => { if (drawTick) callbacks.current.onRender?.(); }, [drawTick]);
  const wasPlayingRef = useRef(false);
  useEffect(() => {
    if (playing && !wasPlayingRef.current) callbacks.current.onPlay?.();
    if (!playing && wasPlayingRef.current) callbacks.current.onStop?.();
    wasPlayingRef.current = playing;
  }, [playing]);
  const busyRef = useRef(false);
  busyRef.current = playing || loadingAudio;
  const latestPlayRef = useRef(play);
  latestPlayRef.current = play;
  const changePitchRef = useRef(changePitch);
  changePitchRef.current = changePitch;
  /** handle.seek: with a clock, report to the host; else move the playhead (and keep playing from there when playing). */
  const seekTo = (seconds: number) => {
    const target = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
    if (clockRef.current) { callbacks.current.onSeek?.(target); return; }
    if (!loaded) return;
    positionRef.current = target;
    if (busyRef.current) { void play(target); return; }
    void loadTimeline().then(timeline => {
      if (busyRef.current || clockRef.current) return;
      const bpm = prefs.bpm;
      const clamped = Math.min(target, playbackDuration(timeline, bpm));
      const current = playbackPositionAt(timeline, clamped, bpm);
      moveTo(clamped);
      setActive(current.noteId);
      setActiveNotes(current.activeNoteIds);
    }).catch(e => showError(e, 'Could not build the playback timeline.'));
  };
  const seekRef = useRef(seekTo);
  seekRef.current = seekTo;
  /** handle.seekToMeasure: seek to the measure's first performed occurrence (at the clock's score tempo, else the BPM setting). */
  const seekToMeasure = (index: number) => {
    void loadTimeline().then(timeline => {
      const seconds = measureSeekSeconds(timeline, index, 0, clockRef.current ? timeline.initialBpm : prefs.bpm);
      if (seconds !== null) seekRef.current(seconds);
    }).catch(e => showError(e, 'Could not build the playback timeline.'));
  };
  const seekToMeasureRef = useRef(seekToMeasure);
  seekToMeasureRef.current = seekToMeasure;
  useImperativeHandle(ref, () => ({
    play: async () => { if (chrome.audio && !clockRef.current && !busyRef.current) await latestPlayRef.current(); },
    stop: () => { if (!clockRef.current) stopRef.current(true); },
    transpose: semitones => changePitchRef.current({ semitones: clampSemitones(Math.round(Number(semitones) || 0)) }),
    seek: seconds => seekRef.current(Number(seconds)),
    currentTime: () => { const host = clockRef.current; return host ? host.now() : positionRef.current; },
    scrollToMeasure: async index => {
      const result = renderRef.current;
      if (!result) return;
      await result.ensureSystem(result.systemOfMeasure(index));
      result.measure(index)?.element?.scrollIntoView({ block: 'center', inline: 'center', behavior: scrollBehavior() });
    },
    seekToMeasure: index => seekToMeasureRef.current(Number(index)),
    scrollIntoView: (target, options) => revealTargetRef.current(target ?? {}, options),
  }), [chrome.audio]);
  // Unmount: release only this reader's players and track gains; the shared AudioContext and Verovio worker stay for other readers.
  useEffect(() => () => { importRunRef.current++; playRunRef.current++; renderRef.current?.dispose(); if (playRef.current) { cancelAnimationFrame(playRef.current.frame); clearInterval(playRef.current.interval); } scheduledStopsRef.current.splice(0).forEach(item => item.stop()); audioRef.current?.players.forEach(players => players.forEach(p => p.dispose())); audioRef.current?.trackGains.forEach(gain => gain.disconnect()); audioRef.current = null; releasePlayback(playbackOwner); }, []);
  /** The instrument choice is offered for pitched notation parts (never the drum kit or TAB) unless the host hides it. */
  const switchOffered = (part: Part) => chrome.instrumentSwitch && switchablePart(part);
  /** The instrument a part is shown as (its switch, else its own) and the part as it plays (a switch's sound). */
  const shownInstrument = (part: Part) => partSwitches[part.id]?.instrument ?? part.instrument;
  const soundPart = (part: Part) => switchedSoundParts([part], instrumentView, partSwitches)[0];
  /** Open the picker on a section; Sound opens at the family and page of the sound the part plays. */
  const openInstrumentPicker = (part: Part, section: 'instrument' | 'sound' = 'sound') => {
    setPickerSection(switchOffered(part) ? section : 'sound');
    const currentSound = playbackSound(soundPart(part));
    const selected = GM_SOUNDS.find(sound => (sound.soundfont || 'drum-kit') === currentSound);
    const family = selected?.family || 'Keyboard';
    setPickerFamily(family);
    setPickerPage(Math.max(0, Math.floor(GM_SOUNDS.filter(sound => sound.family === family).findIndex(sound => sound === selected) / 16)));
    setPickerPartId(part.id);
  };
  /** A Sound pick: on a switched part it only replaces the instrument's main sound (the switch stays). */
  const changeInstrument = (partId: string, sound: GmSound) => {
    const picked = withSound(partSwitches, partId, { instrument: sound.iconId, gmSoundfont: sound.soundfont || undefined });
    if (picked) { changeSwitches(() => picked); setPickerPartId(null); return; }
    stop(true); setScore(prev => ({ ...prev, parts: prev.parts.map(p => p.id === partId ? withPickedSound(p, { instrument: sound.iconId, gmProgram: sound.program || undefined, gmSoundfont: sound.soundfont || undefined }) : p) }));
    setPickerPartId(null);
  };
  const pickerPart = score.parts.find(part => part.id === pickerPartId);
  const pickerSound = pickerPart && playbackSound(soundPart(pickerPart));
  const familySounds = GM_SOUNDS.filter(sound => sound.family === pickerFamily);
  const pickerPages = Math.ceil(familySounds.length / 16);
  const pickerSounds = familySounds.slice(pickerPage * 16, (pickerPage + 1) * 16);
  const hasScoreText = Boolean(score.title || score.subtitle || score.composer || score.credits?.length);
  // Auto bars follow the layout width in Verovio units: (width - gutter) / stave scale.
  const barsLimit = portraitBarLimit(Math.max(180, (scoreWidth || 800) - controlMetrics.gutter) / renderedZoom, visibleScore);
  // Always rendered (disabled in Endless, same footprint) so a saved mode applied after hydration can't add/remove it and shift the header.
  const barsDisabled = prefs.mode !== 'portrait';
  const barsSetting = <label className={`header-bars-setting ${barsDisabled ? 'is-disabled' : ''}`} title={barsDisabled ? 'Bars per line applies to Vertical view' : undefined}><span>Bars</span><select aria-label="Bars per line" title={barsDisabled ? 'Bars per line applies to Vertical view' : `Auto fits up to ${barsLimit} bars`} disabled={barsDisabled} aria-disabled={barsDisabled} value={prefs.barsPerLine} onChange={event => update({ barsPerLine: event.target.value === 'auto' ? 'auto' : Number(event.target.value) })}><option value="auto">Auto</option>{Array.from({ length: BARS_PER_LINE_MAX }, (_, index) => index + 1).map(count => <option value={count} key={count}>{count}</option>)}</select></label>;

  const oomButton = oomRetry && oomRetry.message === error ? <button className="oom-retry-button" onClick={retryOutOfMemory}>Try again with smaller sections</button> : null;
  const staveScale = zoomDraft ?? prefs.zoom ?? renderedZoom;
  const staveScaleMin = Math.min(STAVE_SCALE_MIN, renderedZoom);
  staveScaleMinRef.current = staveScaleMin;
  const staveScalePercent = Math.round(staveScale * 100);
  /**
   * A text add-on's switch and, while it shows, its size (xs-xl, regular by default). The size control sits beside the
   * switch when the card is wide enough, else on its own line below it (styles.css .annotations-panel).
   */
  const annotationRow = (label: string, toggle: 'names' | 'chordSymbols' | 'counts' | 'subdivisions', sizeKey: AnnotationSizePref, onToggle: () => void, shown = prefs[toggle]) => (
    <div className={`ps-switch-row annotation-row annotation-row-${sizeKey}`}>
      <span className="annotation-name">{label}</span>
      {shown && <div className="font-toggle annotation-size" role="group" aria-label={`${label} size`}>{ANNOTATION_SIZES.map(size => <button key={size} className={prefs[sizeKey] === size ? 'is-selected' : ''} aria-pressed={prefs[sizeKey] === size} title={ANNOTATION_SIZE_NAMES[size]} aria-label={ANNOTATION_SIZE_NAMES[size]} onClick={() => update({ [sizeKey]: size })}>{size}</button>)}</div>}
      <button className={`ps-switch ${prefs[toggle] ? 'is-on' : ''}`} role="switch" aria-label={label} aria-checked={prefs[toggle]} onClick={onToggle}/>
    </div>
  );
  // Header and drawer readouts share state; only the visible one (drawer open or not) is a live region, so changes are announced once.
  // Key flip: aria-disabled (not disabled) so the button stays focusable and its label says why there is nothing to flip.
  const flipTo = readout.flipTo;
  const flipLabel = flipTo ? `Spell in ${spokenKey(flipTo)}` : 'No enharmonic key to flip to';
  const flipText = flipTo ? `${keyName(readout.key)} ↔ ${keyName(flipTo)}` : keyName(readout.key);
  const flipKey = () => { if (flipTo) changePitch({ keyFlip: !prefs.keyFlip }); };
  const transposeTitle = `Transposition ${prefs.semitones > 0 ? '+' : ''}${prefs.semitones} semitone${Math.abs(prefs.semitones) === 1 ? '' : 's'}, key ${spokenKey(readout.key)}`;
  // Each button is named by its visible label (WCAG 2.5.3); the condensed "Std" is read as "Std notation".
  const tabViews: { view: TabView; label: string; short: React.ReactNode; title: string }[] = [
    { view: 'notation', label: 'Notation', short: <>Std<span className="tab-view-toggle-sr ps-visually-hidden"> notation</span></>, title: 'Standard notation' },
    { view: 'tab', label: 'TAB', short: 'TAB', title: 'TAB' },
    { view: 'both', label: 'Both', short: 'Both', title: 'Both notation and TAB' },
  ];
  /** The Notation / TAB / Both switch (header and drawer); a pressed button is the current view. */
  const tabToggle = (placement: 'header' | 'drawer') => <div className={`tab-view-toggle tab-view-toggle-${placement} ${placement === 'header' ? '' : 'font-toggle'}`} role="group" aria-label="TAB view">
    {tabViews.map(({ view, label, short, title }) => <button key={view} type="button" className={`tab-view-toggle-${view} ${prefs.tabView === view ? 'is-selected' : ''}`} aria-pressed={prefs.tabView === view} title={title} onClick={() => update({ tabView: view })}>
      {placement === 'header' ? <><span className="tab-view-toggle-label-full">{label}</span><span className="tab-view-toggle-label-short">{short}</span></> : label}
    </button>)}
  </div>;

  const heightMode = height === 'fill' ? 'fill' : height ? 'fixed' : natural ? 'natural' : 'auto';
  const compactLabel = playing || loadingAudio ? 'Stop playback' : 'Play score';
  /** One row per switchable source part (a grand staff's staves share one), in score order. */
  const switchSources = readerParts.filter((part, index) => switchablePart(part) && readerParts.findIndex(other => sourcePartOf(other) === sourcePartOf(part)) === index);
  const switchSource = switchSources.find(part => sourcePartOf(part) === switchSourceId) ?? switchSources[0];
  /** Focus leaving both the menu and its button closes the menu (focus has already moved on, so nothing is restored). */
  const closeSwitchOnFocusOut = (event: React.FocusEvent) => {
    const next = event.relatedTarget as Node | null;
    if (next && !switchMenuRef.current?.contains(next) && !switchButtonRef.current?.contains(next)) setSwitchMenu(false);
  };
  const embedSwitch = chrome.instrumentSwitch && loaded && switchSource ? <button ref={switchButtonRef} onBlur={closeSwitchOnFocusOut} type="button" className={`instrument-switch icon-button ${switchMenu ? 'is-open' : ''}`} aria-label="Choose your instrument" title="Choose your instrument" aria-haspopup="dialog" aria-expanded={switchMenu} aria-controls={switchMenu ? switchMenuId : undefined} onClick={() => setSwitchMenu(open => !open)}>
    <img className="instrument-switch-icon" src={instrumentDetails(shownInstrument(switchSource)).icon} alt=""/>
  </button> : null;
  const switchState = switchSource && partSwitches[switchSource.id];
  /** The octave tool's entry (embed instrument menu and drawer Pitch panel), shown when the host allows it. */
  const octaveToggle = (placement: 'menu' | 'drawer' | 'bar') => chrome.octaveTool ? <div className={`octave-tool-entry octave-tool-entry-${placement}`}>
    <button type="button" className={`octave-tool-toggle ${octaveOn ? 'is-selected' : ''}`} aria-pressed={octaveOn} title="Select notes to move them by an octave" onClick={() => setOctaveToolOn(!octaveOn)}>Octave tool</button>
    {placement === 'drawer' && <span className="octave-tool-hint">Move notes or a passage up or down an octave.</span>}
  </div> : null;
  const octaveSelectionInfo = octaveOn && octaveSelection ? { count: octaveSelection.ids.length, partName: score.parts.find(part => part.id === octaveSelection.partId)?.name ?? '',
    outOfRange: octaveSelection.ids.filter(id => instrumentView.outOfRange.includes(id)).length } : null;
  const headerElements: Partial<Record<HeaderControlId, React.ReactNode>> = {
    stop: clock ? null : <button className="icon-button stop-button" aria-label="Stop playback" title="Stop playback" onClick={() => { stop(true); viewportRef.current?.scrollTo({ top: 0, left: 0, behavior: 'smooth' }); }}><Square size={17} fill="currentColor"/></button>,
    play: clock ? null : <button className={`play-button ${loadingAudio ? 'is-loading' : ''}`} aria-label={playing || loadingAudio ? 'Pause playback' : 'Play score'} onClick={() => void play()}>{playing || loadingAudio ? <Pause size={17} fill="currentColor"/> : <Play size={17} fill="currentColor"/>}<span className="play-button-label">{loadingAudio ? 'Loading' : playing ? 'Pause' : 'Play'}</span></button>,
    openFile: <button className="header-open-file" aria-label="Open score file" title="Open score file" aria-haspopup="dialog" aria-expanded={openDialog} onClick={() => { setDrawer(false); setMoreOpen(false); setOpenDialog(true); }}><FolderOpen size={17}/><span className="header-open-file-label">Open</span></button>,
    bpm: clock ? null : <label className="bpm-control"><span>BPM</span><input type="number" min={MIN_BPM} max={MAX_BPM} value={prefs.bpm} onChange={e => { stop(true); update({ bpm: clampBpm(Number(e.target.value) || 96) }); }}/></label>,
    mode: <div className="mode-toggle" role="group" aria-label="Reading mode">
      <button aria-label="Vertical view" title="Vertical view" className={`mode-toggle-vertical ${prefs.mode === 'portrait' ? 'is-selected' : ''}`} onClick={() => update({ mode: 'portrait' })}><span className="mode-toggle-label-full">Vertical</span><span className="mode-toggle-label-short" aria-hidden="true">V</span></button>
      <button aria-label="Endless view" title="Endless view" className={`mode-toggle-endless ${prefs.mode === 'landscape' ? 'is-selected' : ''}`} onClick={() => update({ mode: 'landscape' })}><span className="mode-toggle-label-full">Endless</span><span className="mode-toggle-label-short" aria-hidden="true">E</span></button>
    </div>,
    transpose: <div className="header-transpose" role="group" aria-label="Transpose">
      <span className="header-transpose-label" aria-hidden="true">Transpose</span>
      <span className="header-transpose-controls">
        <button className="header-transpose-down" aria-label="Transpose down a semitone" title="Transpose down a semitone" disabled={prefs.semitones <= -12} onClick={() => transposeBy(-1)}><Minus size={15}/></button>
        <output className="header-transpose-readout" aria-live={drawer ? 'off' : 'polite'} title={transposeTitle}>{readout.text}</output>
        <button className="header-transpose-up" aria-label="Transpose up a semitone" title="Transpose up a semitone" disabled={prefs.semitones >= 12} onClick={() => transposeBy(1)}><Plus size={15}/></button>
      </span>
    </div>,
    keyFlip: <div className="header-key-flip">
      <span className="header-key-flip-caption" aria-hidden="true">Key spelling</span>
      <button className={`header-key-flip-button ${flipTo ? '' : 'is-disabled'}`} aria-label={flipLabel} title={flipLabel} aria-disabled={!flipTo} onClick={flipKey}><span className="header-key-flip-icon" aria-hidden="true">⇄</span><span className="header-key-flip-label">{flipText}</span></button>
    </div>,
    tab: tabAvailable ? <div className={`header-tab-view ${chrome.drawer ? 'has-drawer-copy' : ''}`}><span className="header-tab-view-caption" aria-hidden="true">TAB</span>{tabToggle('header')}</div> : null,
    bars: barsSetting,
    staveScale: <label className="header-stave-scale" title="Stave scale">
      <span className="header-stave-scale-label">Scale</span>
      <input className="header-stave-scale-input" type="range" min={staveScaleMin} max={STAVE_SCALE_MAX} step={STAVE_SCALE_STEP} value={staveScale} aria-label="Stave scale" aria-valuetext={`${staveScalePercent}%`} onChange={event => draftStaveScale(Number(event.target.value))}
        ref={staveScaleInput} onPointerDown={() => { sliderPointerRef.current = true; window.clearTimeout(zoomCommitRef.current); }}
        onPointerUp={event => releaseStaveScale(event.currentTarget)} onPointerCancel={event => releaseStaveScale(event.currentTarget)}/>
      <output className="header-stave-scale-value">{staveScalePercent}%</output>
    </label>,
    noteNames: <button type="button" className="icon-button skin-note-names skin-annotation-toggle" aria-label="Note names" title="Note names" aria-pressed={prefs.names} onClick={() => update({ names: !prefs.names })}><Type size={18}/></button>,
    counts: <button type="button" className="icon-button skin-counts skin-annotation-toggle" aria-label="Counts" title="Counts" aria-pressed={prefs.counts} onClick={() => update({ counts: !prefs.counts })}><Hash size={18}/></button>,
    chordSymbols: <button type="button" className="icon-button skin-chord-symbols skin-annotation-toggle" aria-label="Chord symbols" title="Chord symbols" aria-pressed={prefs.chordSymbols && prefs.inferChordSymbols} onClick={() => { const on = !(prefs.chordSymbols && prefs.inferChordSymbols); update({ chordSymbols: on, inferChordSymbols: on }); }}><Music2 size={18}/></button>,
    options: <button type="button" className="icon-button skin-options" aria-label="Options" title="Options" aria-expanded={drawer} onClick={() => { setMoreOpen(false); setDrawer(!drawer); }}><Settings2 size={18}/></button>,
    instrumentSwitch: bar?.includes('instrumentSwitch') ? embedSwitch : null,
    octaveTool: octaveToggle('bar'),
    mixer: <button className="icon-button mixer-trigger" aria-label="Track mixer" title="Track mixer" aria-haspopup="dialog" aria-expanded={mixer} onClick={() => { setDrawer(false); setMoreOpen(false); setMixer(true); }}><SlidersHorizontal size={18}/><span className="mixer-trigger-label">Track mixer</span></button>,
  };
  const visibleBar = bar?.filter(id => headerElements[BAR_HEADER_ID[id]] != null) ?? null;
  const playbackItems = new Set(['play', 'stop', 'tempo', 'transpose', 'keyFlip']);
  const toolbarBar = skinPhone ? visibleBar?.filter(id => playbackItems.has(id)) ?? [] : [];
  const headerBar = visibleBar?.filter(id => !toolbarBar.includes(id)) ?? null;
  const activeBar = visibleBar?.length ? bar : null;
  const activeChrome = resolveChrome(preset, controls, bar, visibleBar);
  const embedSwitchShown = (activeBar ? activeBar.includes('instrumentSwitch') : preset === 'minimal') && chrome.instrumentSwitch && loaded && Boolean(switchSource);
  // The menu only renders with its switcher: when the switcher goes away (new score, instrumentSwitch off) the open state goes too, so keys are not left dead.
  useEffect(() => { if (!embedSwitchShown) setSwitchMenu(false); }, [embedSwitchShown]);
  /** Minimal chrome without the instrument switcher: the octave tool's entry is its own compact button (corner, or the phone toolbar). */
  const embedOctave = preset === 'minimal' && chrome.octaveTool && loaded && !embedSwitchShown
    ? <button type="button" className={`octave-tool-toggle octave-tool-toggle-compact ${octaveOn ? 'is-selected' : ''}`} aria-pressed={octaveOn} title="Octave tool: select notes to move them by an octave" onClick={() => setOctaveToolOn(!octaveOn)}>Octave</button> : null;
  const octaveCanReset = octaveSelection ? Object.keys(partSwitches[octaveSelection.partId]?.octaves ?? {}).length > 0 : Object.values(partSwitches).some(entry => Object.keys(entry.octaves).length > 0);
  const embedSwitchMenu = embedSwitchShown && switchMenu ? <div ref={switchMenuRef} popover="manual" onBlur={closeSwitchOnFocusOut} id={switchMenuId} tabIndex={-1} className="instrument-menu" role="dialog" aria-label="Choose your instrument">
    {switchSources.length > 1 && <div className="instrument-menu-parts" role="group" aria-label="Part">
      {switchSources.map(part => <button key={part.id} type="button" className={`instrument-menu-part ${part === switchSource ? 'is-selected' : ''}`} aria-pressed={part === switchSource} onClick={() => setSwitchSourceId(sourcePartOf(part))}>
        <img className="instrument-menu-part-icon" src={instrumentDetails(shownInstrument(part)).icon} alt=""/><span className="instrument-menu-part-name">{part.name}</span>
      </button>)}
    </div>}
    <InstrumentChooser compact instruments={EMBED_INSTRUMENTS} current={switchState?.instrument} level={switchState?.level ?? hostSwitchDefaults().level} autoRange={switchState?.autoRange ?? hostSwitchDefaults().autoRange} asWrittenIcon={instrumentDetails(switchSource.importedInstrument ?? switchSource.instrument).icon}
      onInstrument={id => setPartInstrument(sourcePartOf(switchSource), id)} onLevel={level => setPartLevel(sourcePartOf(switchSource), level)} onAutoRange={on => setPartAutoRange(sourcePartOf(switchSource), on)}/>
    {octaveToggle('menu')}
  </div> : null;

  const showHeader = activeChrome.header && (activeBar === null || Boolean(headerBar?.length));
  const compactPlay = activeChrome.compactPlay && loaded && !clock ? <button type="button" className={`ps-compact-play icon-button ${loadingAudio ? 'is-loading' : ''}`} aria-label={compactLabel} title={compactLabel} onClick={() => { if (playing || loadingAudio) stop(true); else void play(); }}>{playing || loadingAudio ? <Square size={15} fill="currentColor"/> : <Play size={15} fill="currentColor"/>}</button> : null;
  // Include the reserved drawer-tab strip in the measured bottom footprint.
  useLayoutEffect(() => {
    const root = rootRef.current, toolbar = bottomToolbarRef.current;
    if (!root || !toolbar) return;
    const measure = () => root.style.setProperty('--ps-bottom-toolbar-h', `${root.getBoundingClientRect().bottom - toolbar.getBoundingClientRect().top}px`);
    const observer = new ResizeObserver(measure);
    observer.observe(toolbar);
    observer.observe(root);
    measure();
    return () => { observer.disconnect(); root.style.removeProperty('--ps-bottom-toolbar-h'); };
  }, [toolbarBar.length > 0, chrome.drawer]);
  const renderControls = (tier: 'primary' | 'secondary') => HEADER_CONTROLS.filter(control => control.tier === tier && activeChrome[HEADER_CONTROL_GROUP[control.id]!] && headerElements[control.id]).map(control => <div key={control.id} className={`header-control header-control-${control.id}`} data-header-control={control.id}>{headerElements[control.id]}</div>);
  const primaryControls = renderControls('primary');
  const secondaryControls = renderControls('secondary');

  /** On phones and tablets the switcher and the play button move to a bottom toolbar, within thumb reach. */
  const noBarSwitch = embedSwitchShown ? embedSwitch : null;
  const inToolbar = activeBar === null && phoneToolbar && Boolean(noBarSwitch || embedOctave);
  const cornerSwitch = inToolbar || activeBar !== null ? null : noBarSwitch ?? embedOctave;
  const cornerPlay = inToolbar ? null : compactPlay;
  return <div ref={rootRef} className={`pepperscore ${className ?? ''}`.trim()} data-ps-height={heightMode} data-ps-clock={clock ? '' : undefined} data-ps-clickable={onElementClick || octaveOn ? '' : undefined} data-ps-octave-tool={octaveOn ? '' : undefined} style={{ ...themeStyle, ...(heightMode === 'fixed' ? { height } : {}) }}
    tabIndex={0} role="region" aria-label={ariaLabel || (loaded && score.title ? `Score: ${score.title}` : 'Score reader')} onKeyDown={onRootKeyDown}>
  <main className={`app-shell ${chrome.drawer ? '' : 'no-drawer'} ${toolbarBar.length ? 'has-skin-toolbar' : ''}`}>
    {chrome.openFile && <input ref={fileRef} type="file" accept={SCORE_FILE_ACCEPT} hidden onChange={e => { readFile(e.target.files?.[0]); e.target.value = ''; }}/>}
    {showHeader && <header className={`topbar ${activeBar !== null ? 'skin-topbar' : ''}`} aria-label="Playback transport">
      {activeBar !== null ? <SkinBar bar={headerBar ?? []} elements={headerElements} moreRef={moreRef} moreOpen={moreOpen} setMoreOpen={setMoreOpen} panelId={panelId}/> : <div className="transport">
        {primaryControls}
        {/* Secondary controls render once. CSS lays them out inline above MOBILE_HEADER_BREAKPOINT and as the
            More dropdown (toggle shown, panel display:none until data-open) at or below it, so SSR paints the right arrangement. */}
        {secondaryControls.length > 0 && <div className="header-more" ref={moreRef} data-open={moreOpen ? 'true' : 'false'}>
          <button className={`icon-button header-more-toggle ${moreOpen ? 'is-open' : ''}`} aria-label="More controls" title="More controls" aria-expanded={moreOpen} aria-controls={panelId} onClick={() => setMoreOpen(open => !open)}><Ellipsis size={19}/></button>
          <div id={panelId} className="header-secondary-panel" role="group" aria-label="Secondary controls">{secondaryControls}</div>
        </div>}
      </div>}
      {cornerSwitch && <div className={`ps-corner-controls ${compactPlay ? 'has-compact-play' : ''}`}>{cornerSwitch}</div>}
      {cornerPlay}
    </header>}
    {/* Shown once a score has loaded: an empty or failed snippet has nothing to play. With a header (minimal + controls)
        it sits in the header's right end, above the sticky header rather than under it. */}
    {!showHeader && cornerSwitch && <div className={`ps-corner-controls ${compactPlay ? 'has-compact-play' : ''}`}>{cornerSwitch}</div>}
    {!showHeader && cornerPlay}
    {embedSwitchMenu}

    {chrome.mixer && mixer && <div className="mixer-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setMixer(false); }}>
      <section ref={focusOnMount} tabIndex={-1} className="mixer-panel" role="dialog" aria-modal="true" aria-label="Track mixer">
        <div className="mixer-heading"><div><SlidersHorizontal size={18}/><h2>Track mixer</h2></div><button className="icon-button" aria-label="Close track mixer" onClick={() => setMixer(false)}><X size={19}/></button></div>
        <p>Choose each track’s sound and volume.</p>
        <div className="mixer-tracks">{readerParts.map(part => <div className="mixer-track" key={part.id}><img className="mixer-track-icon" src={instrumentDetails(shownInstrument(part)).icon} alt=""/><span className="mixer-track-name">{part.name}{hiddenSet.has(part.id) && <small>Muted · hidden</small>}</span><button className="icon-button mixer-visibility-button" aria-label={`${hiddenSet.has(part.id) ? 'Show' : 'Hide'} ${part.name}`} title={`${hiddenSet.has(part.id) ? 'Show' : 'Hide'} ${part.name}`} aria-pressed={!hiddenSet.has(part.id)} onClick={() => togglePart(part.id)} disabled={!hiddenSet.has(part.id) && visibleScore.parts.length <= 1}>{hiddenSet.has(part.id) ? <EyeOff size={17}/> : <Eye size={17}/>}</button><button className="mixer-voice-button" aria-label={`Voice for ${part.name}`} onClick={() => openInstrumentPicker(part)}>{soundLabel(soundPart(part))}<ChevronDown size={14}/></button><label className="mixer-volume"><span>Volume</span><input type="range" min="0" max="100" value={trackVolumes[part.id] ?? 100} aria-label={`Volume for ${part.name}`} onChange={event => setTrackVolumes(previous => ({ ...previous, [part.id]: Number(event.target.value) }))}/><output>{trackVolumes[part.id] ?? 100}%</output></label></div>)}</div>
      </section>
    </div>}

    {chrome.openFile && openDialog && <OpenScoreDialog onClose={() => setOpenDialog(false)} onOpenFile={file => void readFile(file)} onOpenAbc={text => void readAbc(text)} onBrowse={() => fileRef.current?.click()}/>}

    {chrome.partControls && pickerPart && <div className="instrument-picker-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setPickerPartId(null); }}>
      <section ref={focusOnMount} tabIndex={-1} className="instrument-picker-panel" role="dialog" aria-modal="true" aria-label={`Choose voice for ${pickerPart.name}`}>
        <div className="instrument-picker-heading"><div><h2>{pickerPart.name}</h2><p>{pickerSection === 'instrument' ? 'Choose an instrument to read as' : 'Choose a playback sound'}</p></div><button className="icon-button" aria-label="Close voice picker" onClick={() => setPickerPartId(null)}><X size={19}/></button></div>
        {switchOffered(pickerPart) && <div className="font-toggle instrument-picker-sections" role="group" aria-label="Instrument or sound">{(['instrument', 'sound'] as const).map(section => <button key={section} type="button" className={`instrument-picker-section-tab instrument-picker-section-${section} ${pickerSection === section ? 'is-selected' : ''}`} aria-pressed={pickerSection === section} onClick={() => openInstrumentPicker(pickerPart, section)}>{section === 'instrument' ? 'Instrument' : 'Sound'}</button>)}</div>}
        {pickerSection === 'instrument' && switchOffered(pickerPart) ? <section className="instrument-picker-section instrument-picker-instrument" aria-label="Instrument">
          <InstrumentChooser instruments={SWITCH_TARGETS} current={partSwitches[pickerPart.id]?.instrument} level={partSwitches[pickerPart.id]?.level ?? hostSwitchDefaults().level} autoRange={partSwitches[pickerPart.id]?.autoRange ?? hostSwitchDefaults().autoRange} asWrittenIcon={instrumentDetails(pickerPart.importedInstrument ?? pickerPart.instrument).icon}
            onInstrument={id => setPartInstrument(sourcePartOf(pickerPart), id)} onLevel={level => setPartLevel(sourcePartOf(pickerPart), level)} onAutoRange={on => setPartAutoRange(sourcePartOf(pickerPart), on)}/>
        </section> : <section className="instrument-picker-section instrument-picker-sound" aria-label="Sound">
        <div className="instrument-family-filters" role="group" aria-label="Instrument families">{GM_FAMILIES.map(family => <button key={family} className={pickerFamily === family ? 'is-selected' : ''} aria-pressed={pickerFamily === family} onClick={() => { setPickerFamily(family); setPickerPage(0); }}>{family}</button>)}</div>
        <div className="instrument-picker-grid">{pickerSounds.map(sound => <button key={sound.program ?? 'drum-kit'} className={pickerSound === (sound.soundfont || 'drum-kit') ? 'is-selected' : ''} aria-pressed={pickerSound === (sound.soundfont || 'drum-kit')} onClick={() => changeInstrument(pickerPart.id, sound)}><img src={sound.icon} alt=""/><span>{sound.label}</span></button>)}</div>
        <div className="instrument-picker-pages"><button aria-label="Previous instruments" disabled={pickerPage === 0} onClick={() => setPickerPage(page => page - 1)}><ChevronLeft size={18}/></button><span>Page {pickerPage + 1} of {pickerPages}</span><button aria-label="Next instruments" disabled={pickerPage + 1 >= pickerPages} onClick={() => setPickerPage(page => page + 1)}><ChevronRight size={18}/></button></div>
        </section>}
      </section>
    </div>}

    <section className={`reader-area ps-${prefs.mode} ${readerParts.length > 4 ? 'has-many-staves' : ''} ${chrome.zoom ? '' : 'no-page-controls'}`}>
      <div className="edge-fade edge-start"/><div className="edge-fade edge-end"/>
      <div className="score-viewport" ref={viewportRef} onTouchStart={e => {
        if (chrome.zoom && readerParts.length > 4 && e.touches.length === 2) {
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
        {painting && (loaded || ready) && <div className="score-loading" role="status" aria-label={painted ? 'Rendering score' : 'Preparing score'}><span className="score-loading-spinner"/><span>{painted ? 'Rendering score' : 'Preparing score'}</span></div>}
        {loaded && <div ref={contentRef} className={`score-content ${painting || !painted ? 'is-painting' : ''}`} data-stave-scale={painted ? renderedZoom : undefined} style={{ '--landscape-meta-offset': prefs.chordSymbols ? '0px' : '35px', '--annotation-font': textFonts[prefs.annotationFont] || textFonts.Sans, '--score-text-font': textFonts[prefs.annotationFont] || textFonts.Sans, '--music-font': prefs.notationFont } as React.CSSProperties}>
          {(hasScoreText || hiddenReader.length > 0) && <div className="score-meta">
            {score.title && <h1>{score.title}</h1>}
            {score.subtitle && <p className="score-subtitle">{score.subtitle}</p>}
            {score.composer && <p className="score-composer">{score.composer}</p>}
            {score.credits?.map((line, i) => <p className="score-credit" key={`${line}-${i}`}>{line}</p>)}
            {hiddenReader.length > 0 && <div className="hidden-staves" aria-label="Hidden staves">{hiddenReader.map(part => <button key={part.id} onClick={() => togglePart(part.id)} title={`Show ${part.name}`} aria-label={`Show ${part.name}`}><img src={instrumentDetails(part.instrument).icon} alt=""/><EyeOff size={15}/><span>{part.name}</span></button>)}</div>}
          </div>}
          <div className="score-stage">
            <div className="score-staves" ref={canvasRef} onClick={onScoreClick}/>
            {chrome.partControls && <div className="part-controls" style={{ '--part-icon': `${controlMetrics.icon}px`, '--part-font': `${controlMetrics.font}px`, '--part-eye': `${controlMetrics.eye}px`, '--part-control-height': `${controlMetrics.height}px` } as React.CSSProperties}>{visibleScore.parts.map((part, index) => <div key={part.id} className="part-control" style={{ top: `${staffCenters[part.id] ?? 86 + index * ((prefs.names || prefs.counts) ? 125 : 100)}px` }} title={`Instrument and sound for ${part.name}`}><button className="instrument-control" aria-label={`Instrument for ${part.name}`} aria-haspopup="dialog" onClick={() => openInstrumentPicker(part, 'instrument')}><img className="part-icon" src={instrumentDetails(shownInstrument(part)).icon} alt=""/></button><PartName label={partLabel(part, partSwitches)}/>{readerParts.length > 1 && <button className={`staff-eye staff-focus ${focusedId === part.id ? 'is-focused' : ''}`} aria-label={focusedId === part.id ? 'Show all staves' : `Focus on ${part.name}`} title={focusedId === part.id ? 'Show all staves' : `Focus on ${part.name}`} aria-pressed={focusedId === part.id} onClick={() => focusPart(part.id)}><Focus size={17}/></button>}{readerParts.length > 4 && <button className="staff-eye" aria-label={`Hide ${part.name}`} title={`Hide ${part.name}`} onClick={() => togglePart(part.id)} disabled={visibleScore.parts.length <= 1}><Eye size={17}/></button>}</div>)}</div>}
          </div>
        </div>}
      </div>
      {chrome.zoom && <div className="page-controls"><button aria-label="Previous view" onClick={() => turn(-1)}><ChevronLeft size={18}/></button><span>{prefs.mode === 'portrait' ? 'SCROLL TO READ' : 'SWIPE TO READ'}</span><button aria-label="Next view" onClick={() => turn(1)}><ChevronRight size={18}/></button></div>}
    </section>
    {toolbarBar.length > 0 && <div ref={bottomToolbarRef} className="ps-embed-toolbar skin-playback-toolbar" role="toolbar" aria-label="Playback controls">
      {toolbarBar.map(id => <div key={id} data-bar-item={id} className={`header-control header-control-${BAR_HEADER_ID[id]}`}>{headerElements[BAR_HEADER_ID[id]]}</div>)}
    </div>}
    {inToolbar && <div className="ps-embed-toolbar" role="toolbar" aria-label="Score controls">{noBarSwitch ?? embedOctave}{compactPlay}</div>}
    {octaveOn && <div className={`octave-tool-dock ${inToolbar || toolbarBar.length ? 'is-above-toolbar' : ''}`}>
      <OctaveTool selection={octaveSelectionInfo} canReset={octaveCanReset} onUp={() => stepSelection(12)} onDown={() => stepSelection(-12)}
        onPhrase={() => setOctaveSelection(current => current && selectOctavePhrase(score, current))} onReset={resetOctaves} onDone={() => setOctaveToolOn(false)}/>
    </div>}

    {chrome.drawer && <>
    <button className={`drawer-handle ${drawer ? 'is-open' : ''}`} onClick={() => setDrawer(!drawer)} aria-expanded={drawer}><span className="handle-grip"/><span>{drawer ? 'Close options' : 'Options'}</span><ChevronDown size={16}/></button>
    {drawer && <div className="drawer-backdrop" onClick={() => setDrawer(false)}/>}
    <aside className={`bottom-drawer ${drawer ? 'is-open' : ''}`} aria-hidden={!drawer}>
      <div className="drawer-top"><div><div className="ps-eyebrow">MAKE IT YOURS</div><h2>Reading options</h2></div><button className="icon-button" aria-label="Close options" onClick={() => setDrawer(false)}><X size={20}/></button></div>
      <div className="drawer-grid">
        <DrawerControls items={drawerExtras(activeBar, activeChrome)} elements={headerElements}/>

        <div className="drawer-panel reading-panel"><h3><Settings2 size={17}/> Reading</h3><div className="font-choice"><span>Notation font</span><div className="font-toggle" role="group" aria-label="Notation font"><button className={prefs.notationFont === 'Bravura' ? 'is-selected' : ''} aria-pressed={prefs.notationFont === 'Bravura'} onClick={() => update({ notationFont: 'Bravura' })}>Bravura</button><button className={prefs.notationFont === 'Petaluma' ? 'is-selected' : ''} aria-pressed={prefs.notationFont === 'Petaluma'} onClick={() => update({ notationFont: 'Petaluma' })}>Petaluma</button></div></div><div className="font-choice"><span>Stave text font</span><div className="font-toggle" role="group" aria-label="Stave text font">{(['Sans', 'Serif', 'Mono'] as const).map(font => <button key={font} className={prefs.annotationFont === font ? 'is-selected' : ''} aria-pressed={prefs.annotationFont === font} onClick={() => update({ annotationFont: font })}>{font}</button>)}</div></div><label className="field-label" htmlFor={overhangId}>Overhang <span>{prefs.overlap === 0 ? 'Off' : `${prefs.overlap} ${prefs.mode === 'portrait' ? (prefs.overlap === 1 ? 'system' : 'systems') : (prefs.overlap === 1 ? 'bar' : 'bars')}`}</span></label><input id={overhangId} className="ps-range" type="range" min="0" max="3" step="1" value={prefs.overlap} onChange={e => update({ overlap: Number(e.target.value) })}/>{chrome.tabToggle && tabAvailable && <div className="font-choice tab-view-choice"><span>TAB</span>{tabToggle('drawer')}</div>}{readerParts.length > 4 && <button className="text-action reset-staves" onClick={resetStaves}><RotateCcw size={15}/> Reset score staves</button>}</div>
        <div className="drawer-panel annotations-panel"><h3><Type size={17}/> Annotations</h3>{annotationRow('Note names', 'names', 'namesSize', () => update({ names: !prefs.names }))}{annotationRow('Chord symbols', 'chordSymbols', 'chordSymbolsSize', () => update({ chordSymbols: !prefs.chordSymbols }))}<label className="ps-switch-row inference-row"><span>Infer chord symbols</span><input type="checkbox" checked={prefs.inferChordSymbols} onChange={e => update({ inferChordSymbols: e.target.checked })}/></label>{annotationRow('Beat counts', 'counts', 'countsSize', () => update({ counts: !prefs.counts }))}{annotationRow('Count subdivisions', 'subdivisions', 'subdivisionsSize', () => update({ subdivisions: !prefs.subdivisions, counts: true }), prefs.counts && prefs.subdivisions)}</div>
        <div className="drawer-panel pitch-panel"><h3><Settings2 size={17}/> Pitch</h3><div className="pitch-options"><div><span className="pitch-label">Transpose score</span><div className="semitone-control"><button aria-label="Transpose down a semitone" disabled={prefs.semitones <= -12} onClick={() => transposeBy(-1)}><Minus size={16}/></button><output aria-live={drawer ? 'polite' : 'off'}>{prefs.semitones > 0 ? '+' : ''}{prefs.semitones} semitones</output><button aria-label="Transpose up a semitone" disabled={prefs.semitones >= 12} onClick={() => transposeBy(1)}><Plus size={16}/></button><button className="pitch-reset" aria-label="Reset transposition" title="Reset transposition" disabled={prefs.semitones === 0 && !prefs.keyFlip} onClick={() => changePitch({ semitones: 0, keyFlip: false })}><RotateCcw size={15}/></button></div></div><div className="pitch-key"><span className="pitch-label">Key</span><div className="pitch-key-control"><output className="pitch-key-readout" aria-live={drawer ? 'polite' : 'off'}>{readout.text}</output><button className={`pitch-key-flip ${flipTo ? '' : 'is-disabled'}`} aria-label={flipLabel} title={flipLabel} aria-disabled={!flipTo} onClick={flipKey}><span className="pitch-key-flip-icon" aria-hidden="true">⇄</span><span className="pitch-key-flip-label">{flipText}</span></button></div></div>{!forcedConcert && <div><span className="pitch-label">Score view</span><div className="font-toggle pitch-view" role="group" aria-label="Score pitch view"><button className={prefs.scorePitch === 'written' ? 'is-selected' : ''} aria-pressed={prefs.scorePitch === 'written'} onClick={() => changePitch({ scorePitch: 'written' })}>Transposing</button><button className={prefs.scorePitch === 'concert' ? 'is-selected' : ''} aria-pressed={prefs.scorePitch === 'concert'} onClick={() => changePitch({ scorePitch: 'concert' })}>Concert</button></div></div>}</div>{octaveToggle('drawer')}<p className="pitch-hint">{pitchHint(pitchView)}</p></div>
        <div className="drawer-panel abc-panel"><h3><FileMusic size={17}/> ABC notation</h3><p>Paste ABC text here, or use the open button in the header for files and folders.</p><textarea value={abcDraft} onChange={e => setAbcDraft(e.target.value)} spellCheck={false} aria-label="ABC notation"/><button className="primary-action" onClick={() => void readAbc(abcDraft)}>View notation <ChevronRight size={17}/></button><button className="text-action" onClick={loadSample}><FileMusic size={16}/> Open sample score</button>{lastFileInfo && <button className="text-action forget-last-file" title={LAST_FILE_PRIVACY} onClick={forgetLast}><Trash2 size={15}/> Forget last opened file</button>}</div>
      </div>
      {error && <div className="ps-error" role="alert"><span className="ps-error-text">{error}</span>{oomButton}</div>}
      <div className="drawer-foot">SPACE / PAGE DOWN · next view &nbsp;&nbsp; PAGE UP · previous view <span>FluidR3 GM · CC BY 3.0; TimGM drums · GPL-2</span>{noticesUrl && <a className="drawer-licences" href={noticesUrl} target="_blank" rel="noopener" title="Third-party licences: Verovio (LGPL-3.0-or-later), fonts (SIL OFL 1.1) and libraries">Licences</a>}</div>
    </aside>
    </>}
    {!drawer && (notice || largeNotice || reopenOffer) && <div className="reader-notices">
      {largeNotice && <div className="large-file-notice" role="status"><Hourglass className="large-file-notice-icon" size={16}/><span className="large-file-notice-text">{largeNotice}</span><button className="large-file-notice-dismiss" onClick={() => setLargeNotice('')} aria-label="Dismiss large score notice"><X size={16}/></button></div>}
      {chrome.openFile && reopenOffer && <div className="reopen-banner" role="status" aria-label="Reopen last file">
        <History className="reopen-banner-icon" size={16}/>
        <span className="reopen-banner-body"><span className="reopen-banner-text">Reopen <strong className="reopen-banner-name">{reopenOffer.name}</strong>?</span><span className="reopen-banner-privacy" title={LAST_FILE_PRIVACY}>Kept only on this device.</span></span>
        <span className="reopen-banner-actions">
          <button className="reopen-banner-reopen" onClick={() => void reopenLastFile()} aria-label={`Reopen ${reopenOffer.name}`}>Reopen</button>
          <button className="reopen-banner-later" onClick={dismissReopen}>Not now</button>
          <button className="reopen-banner-forget" onClick={forgetLast} aria-label={`Forget ${reopenOffer.name}`} title="Delete the copy kept on this device">Forget</button>
        </span>
      </div>}
      {notice && <div className="playback-notice" role="status"><VolumeX className="playback-notice-icon" size={16}/><span className="playback-notice-text">{notice}</span><button className="playback-notice-dismiss" onClick={() => setNotice('')} aria-label="Dismiss playback notice"><X size={16}/></button></div>}
    </div>}
    {error && !drawer && <div className={`ps-toast ${oomButton ? 'is-out-of-memory' : ''}`} role="alert"><span className="ps-toast-text">{error}</span>{oomButton}<button className="ps-toast-dismiss" onClick={() => setError('')} aria-label="Dismiss"><X size={16}/></button></div>}
  </main>
  </div>;
}
