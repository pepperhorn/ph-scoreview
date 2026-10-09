import type { Instrument, InstrumentZone, Preset } from 'soundfont2';
import type { AudioPlayer } from './sound-players';

const objectUrls = new Map<string, Promise<string>>();

/** Each SF2 is downloaded once per URL; every program and instance reads it through one object URL. */
function cachedObjectUrl(url: string): Promise<string> {
  let cached = objectUrls.get(url);
  if (!cached) {
    cached = fetch(url).then(response => {
      if (!response.ok) throw new Error(`Could not load the soundfont (${response.status}).`);
      return response.blob();
    }).then(blob => URL.createObjectURL(blob));
    cached.catch(() => objectUrls.delete(url));
    objectUrls.set(url, cached);
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
  const [{ Soundfont2 }, { default: soundfont2 }, objectUrl] = await Promise.all([import('smplr'), import('soundfont2'), cachedObjectUrl(url)]);
  const output = context.createGain();
  output.connect(destination);
  let layered: Instrument | undefined;
  const sampler = Soundfont2(context, {
    url: objectUrl,
    destination: output,
    createSoundfont: data => {
      const sf = new soundfont2.SoundFont2(data);
      const match = findPreset(sf.presets, drums, program, preset);
      if (!match) return sf;
      layered = layeredInstrument(match);
      return { instruments: [...sf.instruments, layered] };
    },
  });
  try {
    await sampler.ready;
    const name = layered ? LAYERED : preset;
    if (!name || !sampler.instrumentNames.includes(name)) throw new Error(preset ? `The soundfont has no preset or instrument named "${preset}".` : drums ? 'The soundfont has no standard drum kit.' : `The soundfont has no instrument for GM program ${program}.`);
    await sampler.loadInstrument(name);
  } catch (error) { sampler.dispose(); output.disconnect(); throw error; }
  // Stacked layers add up: scale by 1/sqrt(the most regions any one note sounds) to sit near single-layer presets.
  if (layered) output.gain.value = 1 / Math.sqrt(Math.max(1, ...Array.from({ length: 128 }, (_, note) => layered!.zones.filter(zone => zone.keyRange!.lo <= note && note <= zone.keyRange!.hi).length)));
  return { start: options => sampler.start(options), stop: () => sampler.stop(), dispose: () => { sampler.dispose(); output.disconnect(); } };
}
