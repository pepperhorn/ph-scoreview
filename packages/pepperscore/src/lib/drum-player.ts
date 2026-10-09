type DrumManifest = { name: string; notes: Record<string, string> };
type StartOptions = { note: number; time: number; velocity: number; destination?: AudioNode };

export class DrumPlayer {
  private decoded = new Map<number, AudioBuffer>();
  private active = new Set<AudioBufferSourceNode>();
  private hats = new Set<AudioBufferSourceNode>();

  constructor(private context: AudioContext, private manifest: DrumManifest, private manifestUrl: string) {}

  /** Whether this kit has a sample for `note` (the GM soundfont plays the rest). */
  covers(note: number) { return Object.hasOwn(this.manifest.notes, String(note)); }

  async loadNotes(notes: number[]) {
    const needed = [...new Set(notes)].filter(note => this.covers(note) && !this.decoded.has(note));
    await Promise.all(needed.map(async note => {
      const response = await fetch(new URL(this.manifest.notes[note], this.manifestUrl));
      if (!response.ok) throw new Error(`Could not load drum sample ${note}.`);
      this.decoded.set(note, await this.context.decodeAudioData(await response.arrayBuffer()));
    }));
  }

  start({ note, time, velocity, destination }: StartOptions) {
    const buffer = this.decoded.get(note);
    if (!buffer) return () => {};
    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    source.buffer = buffer;
    gain.gain.value = Math.max(0, Math.min(1, velocity / 127)) * .8;
    source.connect(gain).connect(destination || this.context.destination);
    if (note === 42 || note === 44 || note === 46) {
      for (const hat of this.hats) { try { hat.stop(time); } catch { /* already stopped */ } }
      this.hats.add(source);
    }
    source.onended = () => { this.active.delete(source); this.hats.delete(source); source.disconnect(); gain.disconnect(); };
    this.active.add(source);
    source.start(time);
    return () => { if (this.active.has(source)) { try { source.stop(); } catch { /* already ended */ } } };
  }

  stop() { for (const source of this.active) { try { source.stop(); } catch { /* already ended */ } } }
  dispose() { this.stop(); this.decoded.clear(); }
}

/** A note-file kit: a manifest `{ name, notes: { midi: file } }` with files beside it (Perfect Drums, or a soundSources entry). */
export async function loadNoteFilePlayer(context: AudioContext, manifestUrl: string) {
  const response = await fetch(manifestUrl);
  if (!response.ok) throw new Error('Could not load the drum kit manifest.');
  const manifest = await response.json() as DrumManifest;
  if (!manifest.notes || !Object.keys(manifest.notes).length) throw new Error('The drum kit manifest is empty.');
  return new DrumPlayer(context, manifest, manifestUrl);
}
