type SamplePack = { name: string; samples: Record<string, string> };
type StartOptions = { note: number; time: number; duration: number; velocity: number; destination?: AudioNode };

export class FluidPlayer {
  private decoded = new Map<number, AudioBuffer>();
  private active = new Set<AudioBufferSourceNode>();
  private keys: number[];

  constructor(private context: AudioContext, private pack: SamplePack) {
    this.keys = Object.keys(pack.samples).map(Number).sort((a, b) => a - b);
  }

  private nearest(note: number) {
    return this.keys.reduce((best, key) => Math.abs(key - note) < Math.abs(best - note) ? key : best);
  }

  async loadNotes(notes: number[]) {
    const needed = [...new Set(notes.map(note => this.nearest(note)))].filter(key => !this.decoded.has(key));
    await Promise.all(needed.map(async key => {
      const binary = atob(this.pack.samples[key]);
      const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
      const buffer = await this.context.decodeAudioData(bytes.buffer);
      this.decoded.set(key, buffer);
    }));
  }

  start({ note, time, duration, velocity, destination }: StartOptions) {
    const key = this.nearest(note);
    const buffer = this.decoded.get(key);
    if (!buffer) throw new Error(`${this.pack.name} has not loaded note ${note}.`);
    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    source.buffer = buffer;
    source.playbackRate.value = 2 ** ((note - key) / 12);
    gain.gain.value = Math.max(0, Math.min(1, velocity / 127)) * .7;
    source.connect(gain).connect(destination || this.context.destination);
    source.onended = () => { this.active.delete(source); source.disconnect(); gain.disconnect(); };
    this.active.add(source);
    source.start(time);
    source.stop(time + Math.max(.06, duration));
    return () => { if (this.active.has(source)) { try { source.stop(); } catch { /* already ended */ } } };
  }

  stop() { for (const source of this.active) { try { source.stop(); } catch { /* already ended */ } } }
  dispose() { this.stop(); this.decoded.clear(); }
}

const packs = new Map<string, Promise<SamplePack>>();

/** A FluidR3-format sample pack (`{ name, samples: { midi: base64 mp3 } }`), fetched once per URL and shared by instances. */
export async function loadFluidPlayer(context: AudioContext, url: string, name: string) {
  let pack = packs.get(url);
  if (!pack) {
    pack = fetch(url).then(async response => {
      if (!response.ok) throw new Error(`Could not load ${name} sound samples.`);
      const json = await response.json() as SamplePack;
      if (!json.samples || !Object.keys(json.samples).length) throw new Error(`Invalid ${name} sound samples.`);
      return json;
    });
    pack.catch(() => packs.delete(url));
    packs.set(url, pack);
  }
  return new FluidPlayer(context, await pack);
}
