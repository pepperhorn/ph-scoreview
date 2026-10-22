import type { Instrument, InstrumentZone, Preset, SoundFont2 } from 'soundfont2';
import type { AudioPlayer } from './sound-players';

const soundfonts = new Map<string, Promise<SoundFont2>>();

/**
 * Each SF2 is downloaded and parsed once per URL. Every program, part and instance builds its player from the same
 * parsed soundfont (read-only here), so disposing one player never touches data another is using.
 */
function parsedSoundfont(url: string): Promise<SoundFont2> {
  let cached = soundfonts.get(url);
  if (!cached) {
    cached = Promise.all([
      fetch(url).then(response => {
        if (!response.ok) throw new Error(`Could not load the soundfont (${response.status}).`);
        return response.arrayBuffer();
      }),
      import('soundfont2'),
    ]).then(([buffer, { default: soundfont2 }]) => new soundfont2.SoundFont2(new Uint8Array(buffer)));
    cached.catch(() => soundfonts.delete(url));
    soundfonts.set(url, cached);
  }
  return cached;
}

/** Name of the synthetic instrument that layers every instrument zone of the chosen preset. */
const LAYERED = '\u0000pepperscore-preset';

/**
 * smplr's Soundfont2 plays one SF2 instrument, but a GM preset often layers several (TimGM6mb's Standard kit is
 * Standard0 + Standard1, its strings stack six). This merges them into one instrument, clipped to each preset zone's key
 * range; smplr then sounds every region that matches a note. Sample names get a layer prefix because smplr keys its
 * buffers by name. Velocity ranges, pan and attenuation are not applied (smplr's SF2 conversion ignores them).
 */
function layeredInstrument(preset: Preset): Instrument {
  const zones = preset.zones.flatMap((presetZone, layer) => (presetZone.instrument?.zones ?? []).flatMap((zone): InstrumentZone[] => {
    const lo = Math.max(zone.keyRange?.lo ?? 0, presetZone.keyRange?.lo ?? 0);
    const hi = Math.min(zone.keyRange?.hi ?? 127, presetZone.keyRange?.hi ?? 127);
    if (!zone.sample || lo > hi) return [];
    return [{ ...zone, keyRange: { lo, hi }, sample: { ...zone.sample, header: { ...zone.sample.header, name: `${layer}:${zone.sample.header.name}` } } }];
  }));
  return { header: { name: LAYERED, bagIndex: -1 }, zones };
}

/** The GM preset: bank 128 preset 0 (Standard kit) for drums, else bank 0 preset `program - 1`; or a preset named `preset`. */
const findPreset = (presets: Preset[], drums: boolean, program = 1, preset?: string) =>
  presets.find(item => preset ? item.header.name === preset : drums ? item.header.bank === 128 && item.header.preset === 0 : item.header.bank === 0 && item.header.preset === program - 1);

export type Sf2Options = { url: string; drums: boolean; program?: number; preset?: string; destination: AudioNode };

/** A player for one preset of an SF2. `preset` names an SF2 preset, or failing that a single SF2 instrument. */
export async function loadSf2Player(context: AudioContext, { url, drums, program, preset, destination }: Sf2Options): Promise<AudioPlayer> {
  const [{ Instrument: smplrInstrument, sf2InstrumentToPreset }, soundfont] = await Promise.all([import('smplr'), parsedSoundfont(url)]);
  const match = findPreset(soundfont.presets, drums, program, preset);
  const instrument = match ? layeredInstrument(match) : preset ? soundfont.instruments.find(item => item.header.name === preset) : undefined;
  if (!instrument) throw new Error(preset ? `The soundfont has no preset or instrument named "${preset}".` : drums ? 'The soundfont has no standard drum kit.' : `The soundfont has no instrument for GM program ${program}.`);
  // smplr's own Soundfont2 fetches and parses the file per sampler; this plugin only turns the shared instrument into samples.
  const Sf2Sampler = smplrInstrument<{ instrument: Instrument }>((ctx, options, smplr) => {
    const { json, buffers } = sf2InstrumentToPreset(options.instrument, ctx);
    return smplr.loadInstrument(json, buffers);
  });
  const output = context.createGain();
  output.connect(destination);
  const sampler = Sf2Sampler(context, { instrument, destination: output });
  try { await sampler.ready; } catch (error) { sampler.dispose(); output.disconnect(); throw error; }
  // Stacked layers add up: scale by 1/sqrt(the most regions any one note sounds) so the preset sits near single-layer
  // ones. A global approximation: notes with fewer layers are scaled by the same amount.
  if (match) output.gain.value = 1 / Math.sqrt(Math.max(1, ...Array.from({ length: 128 }, (_, note) => instrument.zones.filter(zone => zone.keyRange!.lo <= note && note <= zone.keyRange!.hi).length)));
  // smplr queues a note more than its 200 ms lookahead ahead in its own scheduler, and its argument-less stop() only
  // stops sounding voices: queued notes would still play after a stop. So every start keeps its own stop handle (with a
  // unique stopId, since smplr's handle stops every voice sharing the id, which defaults to the pitch), and stop() calls
  // them all. Handles are dropped once their note has ended.
  const pending = new Map<() => void, number>();
  let nextId = 0;
  const release = 2; // seconds after a note's end before its handle is forgotten (covers smplr's release tail)
  const stopAll = () => { for (const stop of [...pending.keys()]) stop(); pending.clear(); sampler.stop(); };
  // Notes some zone sounds (a zone without a key range covers every key).
  const covered = new Set(instrument.zones.flatMap(({ keyRange: { lo, hi } = { lo: 0, hi: 127 } }) => Array.from({ length: Math.max(0, hi - lo + 1) }, (_, i) => lo + i)));
  return {
    start: ({ note, time, duration, velocity }) => {
      const now = context.currentTime;
      for (const [stop, end] of pending) if (end < now) pending.delete(stop);
      const handle = sampler.start({ note, time, duration, velocity, stopId: `n${nextId++}` });
      const stop = () => { pending.delete(stop); handle(); };
      pending.set(stop, Math.max(time, now) + duration + release);
      return stop;
    },
    stop: stopAll,
    dispose: () => { stopAll(); sampler.dispose(); output.disconnect(); },
    covers: note => covered.has(note),
  };
}
