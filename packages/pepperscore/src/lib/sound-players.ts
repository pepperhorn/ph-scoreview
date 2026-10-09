import type { SoundPlan } from './sounds';

export type AudioPlayer = {
  fallback?: boolean;
  start(options: { note: number; time: number; duration: number; velocity: number; destination?: AudioNode }): () => void;
  stop(): void;
  dispose(): void;
  loadNotes?(notes: number[]): Promise<void>;
  covers?(note: number): boolean;
};

/** The players for one plan (sf2 players are bound to `destination`, a part's track gain). */
export async function loadPlayers(context: AudioContext, plan: SoundPlan, destination: AudioNode): Promise<AudioPlayer[]> {
  if (plan.kind === 'sample-pack') {
    const { loadFluidPlayer } = await import('./fluid-player');
    return [await loadFluidPlayer(context, plan.url, plan.name)];
  }
  if (plan.kind === 'sf2') {
    const { loadSf2Player } = await import('./sf2-player');
    return [await loadSf2Player(context, { url: plan.url, drums: plan.drums, program: plan.program, preset: plan.preset, destination })];
  }
  const { loadNoteFilePlayer } = await import('./drum-player');
  return [await loadNoteFilePlayer(context, plan.manifest)];
}

/** A note-file drum kit plays the notes it lacks through the GM soundfont's standard kit, as before (added once). */
export async function addDrumFallback(context: AudioContext, players: AudioPlayer[], notes: number[], fallbackSf2: string, destination: AudioNode): Promise<void> {
  const kit = players[0];
  if (!kit?.covers || players.some(player => player.fallback) || notes.every(note => kit.covers!(note))) return;
  const { loadSf2Player } = await import('./sf2-player');
  const drums = await loadSf2Player(context, { url: fallbackSf2, drums: true, destination });
  players.push({ fallback: true, start: options => kit.covers!(options.note) ? () => {} : drums.start(options), stop: () => drums.stop(), dispose: () => drums.dispose() });
}
