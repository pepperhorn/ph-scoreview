/**
 * pepperscore/audio: the reader's audio engine as a small, framework-free API (no React), so other apps on the page
 * (a piano visualiser, a practice tool) share one AudioContext, one "who is playing" slot and the same sounds.
 *
 * - getSharedAudio(): the page's AudioContext and master compressor (null without Web Audio). resumeAudio(context)
 *   resumes it with a bounded wait (call it from a user gesture).
 * - claimPlayback(owner) / releasePlayback(owner): one player at a time. Claiming stops the previous owner (a
 *   PepperScore reader, or your own `{ stop() }`); PepperScore claims it when it starts playing.
 * - loadInstrument(program | name | 'drums', options) / loadDrumKit(options): an AudioPlayer through pepperscore's sound
 *   resolution (soundSources, the pack's FluidR3 sound, TimGM6mb.sf2; drums from Perfect Drums plus TimGM6mb's kit).
 * - createMetronome({ voice: 'woodblock' | 'drum-machine' | 'click', gain }).
 *
 * Everything not exported here is internal.
 */
export { getSharedAudio, resumeAudio, claimPlayback, releasePlayback } from './lib/audio-engine';
export type { SharedAudio, PlaybackOwner } from './lib/audio-engine';
export { loadInstrument, loadDrumKit, createMetronome } from './lib/instruments';
export type { Instrument, InstrumentName, InstrumentPlan, InstrumentOptions, Metronome, MetronomeOptions } from './lib/instruments';
export { METRONOME_VOICES } from './lib/metronome';
export type { MetronomeVoice } from './lib/metronome';
export type { AudioPlayer } from './lib/sound-players';
export type { SoundSource, SoundPlan } from './lib/sounds';
export type { SoundPackName } from './lib/assets';
export { SOUNDS_VERSION, defaultAssetBaseUrl } from './lib/assets';
