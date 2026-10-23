import type { SoundPlan } from './sounds';

/** One sound source's player (public through pepperscore/audio). */
export type AudioPlayer = {
  /** @internal The drum kit's TimGM6mb fallback (see addDrumFallback). */
  fallback?: boolean;
  /**
   * Play MIDI `note` at `time` (AudioContext seconds) for `duration` seconds at `velocity` (0-127). Returns a function
   * that stops (or, if it has not started yet, cancels) that one note.
   */
  start(options: { note: number; time: number; duration: number; velocity: number; destination?: AudioNode }): () => void;
  /** Stop every sounding note and cancel every scheduled one. */
  stop(): void;
  /** Stop and release the player's buffers and nodes. */
  dispose(): void;
  /** Load (decode) these notes before they are started. */
  loadNotes?(notes: number[]): Promise<void>;
  /** Whether the player has a sound for this note. */
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
  players.push({ fallback: true, start: options => kit.covers!(options.note) ? () => {} : drums.start(options), stop: () => drums.stop(), dispose: () => drums.dispose(), covers: note => drums.covers?.(note) ?? true });
}
