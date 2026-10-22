/**
 * What a metronome beat sounds like, per voice (public through pepperscore/audio's createMetronome). Pure: no Web Audio
 * and no runtime imports (validation/audio-api.mjs runs it in Node).
 * - woodblock: GM hi wood block (76) on beat 1, low wood block (77) on the others, when the drum kit has them; else a
 *   soft synthesized knock.
 * - drum-machine: kick (36) on beat 1, closed hi-hat (42) on the others, from the drum kit.
 * - click: a soft, short synthesized tick.
 * Beat 1 (`beat` 0) is accented: a louder note, or a higher, louder synth sound.
 */
export type MetronomeVoice = 'woodblock' | 'drum-machine' | 'click';
export const METRONOME_VOICES: readonly MetronomeVoice[] = ['woodblock', 'drum-machine', 'click'];

export type MetronomeHit =
  | { kind: 'note'; note: number; velocity: number }
  | { kind: 'knock' | 'tick'; accent: boolean };

export const WOODBLOCK_HIGH = 76;
export const WOODBLOCK_LOW = 77;
export const KICK = 36;
export const CLOSED_HAT = 42;
const ACCENT_VELOCITY = 112;
const BEAT_VELOCITY = 78;

/** Drum notes a voice plays (loaded up front); the synthesized click needs none. */
export const metronomeNotes = (voice: MetronomeVoice): number[] =>
  voice === 'woodblock' ? [WOODBLOCK_HIGH, WOODBLOCK_LOW] : voice === 'drum-machine' ? [KICK, CLOSED_HAT] : [];

/**
 * The hits for one beat. `beat` counts from 0 (beat 1 of the bar) and `accent` defaults to `beat === 0`. `kit` says
 * whether the drum kit loaded and which notes it plays; without it, sample voices fall back to synthesized sounds.
 */
export function metronomeHits(voice: MetronomeVoice, beat: number, { accent = beat === 0, covers }: { accent?: boolean; covers?: (note: number) => boolean } = {}): MetronomeHit[] {
  const velocity = accent ? ACCENT_VELOCITY : BEAT_VELOCITY;
  if (voice === 'woodblock') {
    const note = accent ? WOODBLOCK_HIGH : WOODBLOCK_LOW;
    return covers?.(note) ? [{ kind: 'note', note, velocity }] : [{ kind: 'knock', accent }];
  }
  if (voice === 'drum-machine') {
    const note = accent ? KICK : CLOSED_HAT;
    return covers?.(note) ? [{ kind: 'note', note, velocity }] : [{ kind: 'tick', accent }];
  }
  return [{ kind: 'tick', accent }];
}
