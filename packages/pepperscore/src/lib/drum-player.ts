type DrumManifest = { name: string; notes: Record<string, string> };
type StartOptions = { note: number; time: number; velocity: number; destination?: AudioNode };

export class DrumPlayer {
  private decoded = new Map<number, AudioBuffer>();
  private active = new Set<AudioBufferSourceNode>();
  private hats = new Set<AudioBufferSourceNode>();

  constructor(private context: AudioContext, private manifest: DrumManifest) {}

  async loadNotes(notes: number[]) {
    const needed = [...new Set(notes)].filter(note => this.manifest.notes[note] && !this.decoded.has(note));
    await Promise.all(needed.map(async note => {
      const response = await fetch(`/soundfonts/perfect-drums/${this.manifest.notes[note]}`);
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

export async function loadDrumPlayer(context: AudioContext) {
  const response = await fetch('/soundfonts/perfect-drums/manifest.json');
  if (!response.ok) throw new Error('Could not load the Perfect Drums manifest.');
  const manifest = await response.json() as DrumManifest;
  if (!manifest.notes || !Object.keys(manifest.notes).length) throw new Error('The Perfect Drums manifest is empty.');
  return new DrumPlayer(context, manifest);
}
