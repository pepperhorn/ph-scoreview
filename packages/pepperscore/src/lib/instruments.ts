/**
 * Instruments and the metronome for pepperscore/audio (src/audio.ts). Built on the reader's own sound code: the same
 * shared AudioContext (audio-engine), sound resolution (sounds.ts planSound: soundSources, then the pack's FluidR3
 * sound, then TimGM6mb.sf2; drums from Perfect Drums with TimGM6mb's kit for missing notes) and players. Every built-in
 * file is fetched from the asset base, so a page that self-hosts the sounds talks to no other host.
 */
import { programs } from './gm-soundfont-manifest.json';
import { getSharedAudio } from './audio-engine';
import { loadPackInfo, resolveAssetBase, type SoundPackName } from './assets';
import { addDrumFallback, loadPlayers, type AudioPlayer } from './sound-players';
import { fallbackSf2Url, planSound, type SoundPlan, type SoundRequest, type SoundSource } from './sounds';
import { metronomeHits, metronomeNotes, type MetronomeVoice } from './metronome';

export type InstrumentOptions = {
  /** Root of a pepperscore-sounds-<pack> layout (relative to the page); default: the jsDelivr copy of pepperscore-sounds-<soundPack>. */
  assetBaseUrl?: string;
  /** Picks the default assetBaseUrl. With your own assetBaseUrl, its pack.json decides which FluidR3 sounds exist. */
  soundPack?: SoundPackName;
  /** Your own sounds, claimed per GM program or for the drum kit (the PepperScore `soundSources` prop). */
  sources?: readonly SoundSource[];
  /** Default: the page's shared AudioContext (getSharedAudio). */
  context?: AudioContext;
  /** Where the instrument's output goes. Default: the shared master compressor (or `context.destination` for your own context). */
  destination?: AudioNode;
  /** Notes to load before the promise resolves. Default: 21-108 for an instrument, none for the drum kit. */
  notes?: number[];
};

/** A loaded sound: an AudioPlayer plus its output gain (volume) and the plan it came from. */
export type Instrument = AudioPlayer & {
  readonly context: AudioContext;
  /** The instrument's volume; connected to `destination`. */
  readonly output: GainNode;
  /** Which source plays it (sample pack, SF2 or note files) and from where. */
  readonly plan: SoundPlan;
  /** Load (decode) these notes; a note starts silently until it is loaded. Drums load TimGM6mb's kit for notes the kit lacks. */
  loadNotes(notes: number[]): Promise<void>;
  /** Whether a loaded player can sound this note. */
  covers(note: number): boolean;
};

/** A GM program (1-128), a FluidR3 sound name (`'acoustic_grand_piano'`), or `'drums'` for the GM drum kit. */
export type InstrumentName = number | string;

const PIANO_RANGE = Array.from({ length: 88 }, (_, i) => 21 + i);
const pageBase = (): string => (typeof document !== 'undefined' && document.baseURI) || 'http://localhost/';

/** The sound request for a program number, a FluidR3 name or 'drums'/'drum-kit'. */
export function instrumentRequest(sound: InstrumentName): SoundRequest {
  if (sound === 'drums' || sound === 'drum-kit') return { drums: true };
  const entry = typeof sound === 'number' ? (Number.isInteger(sound) ? programs[sound - 1] : undefined) : programs.find(item => item.soundfont === sound);
  if (!entry) throw new Error(`pepperscore/audio: unknown instrument ${JSON.stringify(sound)} (use a GM program 1-128, a FluidR3 name or 'drums').`);
  return { drums: false, program: entry.program, name: entry.soundfont };
}

function audioTarget(options: { context?: AudioContext; destination?: AudioNode }): { context: AudioContext; destination: AudioNode } {
  if (options.context) return { context: options.context, destination: options.destination ?? options.context.destination };
  const shared = getSharedAudio();
  if (!shared) throw new Error('pepperscore/audio: Web Audio is not available on this device.');
  return { context: shared.context, destination: options.destination ?? shared.master };
}

/**
 * Load an instrument through pepperscore's sound resolution. `start()` returns a stop function for that one note;
 * `stop()` stops every sounding note and cancels every scheduled one. A note's `destination` is honoured by sample-pack
 * and note-file sounds; SF2 sounds always play through `output`.
 */
export async function loadInstrument(sound: InstrumentName, options: InstrumentOptions = {}): Promise<Instrument> {
  const request = instrumentRequest(sound);
  const { context, destination } = audioTarget(options);
  const base = resolveAssetBase(options.assetBaseUrl, options.soundPack ?? 'core');
  const pack = await loadPackInfo(base);
  const plan = planSound(request, { sources: options.sources, fluidr3: pack.fluidr3, base, page: pageBase() });
  const output = context.createGain();
  output.connect(destination);
  let players: AudioPlayer[];
  try { players = await loadPlayers(context, plan, output); } catch (error) { output.disconnect(); throw error; }
  const loadNotes = async (notes: number[]) => {
    await Promise.all(players.map(player => player.loadNotes?.(notes)));
    if (plan.kind === 'note-files' && plan.drums) await addDrumFallback(context, players, notes, fallbackSf2Url(base), output);
  };
  const instrument: Instrument = {
    context, output, plan, loadNotes,
    covers: note => players.some(player => player.covers?.(note) ?? true),
    start: options => {
      const stops: Array<() => void> = [];
      for (const player of players) {
        // A sample-pack player throws for a note it has not loaded; that note is silent rather than an error mid-schedule.
        try { stops.push(player.start({ ...options, destination: options.destination ?? output })); } catch { /* not loaded */ }
      }
      return () => stops.forEach(stop => stop());
    },
    stop: () => players.forEach(player => player.stop()),
    dispose: () => { players.forEach(player => player.dispose()); players = []; output.disconnect(); },
  };
  try { await loadNotes(options.notes ?? (request.drums ? [] : PIANO_RANGE)); } catch (error) { instrument.dispose(); throw error; }
  return instrument;
}

/** The GM drum kit (`loadInstrument('drums', options)`): Perfect Drums note files, TimGM6mb's kit for notes they lack. */
export const loadDrumKit = (options: InstrumentOptions = {}): Promise<Instrument> => loadInstrument('drums', options);

export type MetronomeOptions = Omit<InstrumentOptions, 'notes'> & {
  /** Default 'woodblock'. */
  voice?: MetronomeVoice;
  /** Output volume, 0-1. Default 0.5 (gentle). */
  gain?: number;
};

export type Metronome = {
  readonly voice: MetronomeVoice;
  readonly output: GainNode;
  /**
   * Schedule one beat at `time` (AudioContext seconds). `beat` counts from 0 within the bar; beat 0 is accented unless
   * `accent` says otherwise. Returns a stop function for that beat.
   */
  tick(options: { time: number; beat: number; accent?: boolean }): () => void;
  /** Switch voice; loads the drum kit notes the voice needs. */
  setVoice(voice: MetronomeVoice): Promise<void>;
  /** Stop every sounding and scheduled beat. */
  stop(): void;
  dispose(): void;
};

const SYNTH = {
  knock: { frequency: [740, 1040], drop: .6, decay: .07, level: [.5, .7], type: 'triangle' },
  tick: { frequency: [1800, 2400], drop: 1, decay: .025, level: [.18, .28], type: 'sine' },
} as const;

/** A metronome on the shared AudioContext; drum voices come from the same drum kit loadDrumKit plays. */
export async function createMetronome(options: MetronomeOptions = {}): Promise<Metronome> {
  const { context, destination } = audioTarget(options);
  const output = context.createGain();
  output.gain.value = Math.max(0, Math.min(1, options.gain ?? .5));
  output.connect(destination);
  let voice: MetronomeVoice = options.voice ?? 'woodblock';
  let kit: Instrument | null = null;
  let kitFailed = false;
  const synths = new Set<OscillatorNode>();
  const setVoice = async (next: MetronomeVoice) => {
    voice = next;
    const notes = metronomeNotes(next);
    if (!notes.length || kitFailed) return;
    try {
      kit ??= await loadDrumKit({ ...options, context, destination: output });
      await kit.loadNotes(notes);
    } catch (error) {
      // No drum kit at the asset base: the sample voices fall back to synthesized sounds.
      kitFailed = true;
      console.warn(`pepperscore/audio: the metronome's drum sounds could not load (${error instanceof Error ? error.message : String(error)}); using synthesized sounds.`);
    }
  };
  const synth = (kind: 'knock' | 'tick', accent: boolean, time: number) => {
    const spec = SYNTH[kind], i = accent ? 1 : 0;
    const osc = context.createOscillator(), env = context.createGain();
    osc.type = spec.type;
    osc.frequency.setValueAtTime(spec.frequency[i], time);
    osc.frequency.exponentialRampToValueAtTime(spec.frequency[i] * spec.drop, time + spec.decay);
    env.gain.setValueAtTime(0, time);
    env.gain.linearRampToValueAtTime(spec.level[i], time + .002);
    env.gain.exponentialRampToValueAtTime(.0001, time + spec.decay);
    osc.connect(env).connect(output);
    osc.onended = () => { synths.delete(osc); osc.disconnect(); env.disconnect(); };
    synths.add(osc);
    osc.start(time);
    osc.stop(time + spec.decay + .01);
    return () => { if (synths.has(osc)) try { osc.stop(); } catch { /* ended */ } };
  };
  const stop = () => { kit?.stop(); for (const osc of [...synths]) try { osc.stop(); } catch { /* ended */ } };
  await setVoice(voice);
  return {
    get voice() { return voice; },
    output,
    setVoice,
    tick: ({ time, beat, accent }) => {
      const at = Math.max(time, context.currentTime);
      const stops = metronomeHits(voice, beat, { accent, covers: kit && !kitFailed ? note => kit!.covers(note) : undefined }).map(hit =>
        hit.kind === 'note' ? kit!.start({ note: hit.note, time: at, duration: .5, velocity: hit.velocity }) : synth(hit.kind, hit.accent, at));
      return () => stops.forEach(stop => stop());
    },
    stop,
    dispose: () => { stop(); kit?.dispose(); kit = null; output.disconnect(); },
  };
}
