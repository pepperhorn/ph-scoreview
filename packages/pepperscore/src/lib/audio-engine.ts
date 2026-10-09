/** One AudioContext and master compressor for every reader on the page, and one playing reader at a time. */
export type SharedAudio = { context: AudioContext; master: DynamicsCompressorNode };
let shared: SharedAudio | undefined;

/** The page's audio graph, created on first use; null when the device has no Web Audio (playback then runs silently). */
export function getSharedAudio(): SharedAudio | null {
  if (shared && shared.context.state !== 'closed') return shared;
  let context: AudioContext;
  try { context = new AudioContext(); } catch { return null; }
  const master = context.createDynamicsCompressor();
  master.threshold.value = -15; master.knee.value = 12; master.ratio.value = 4; master.attack.value = .003; master.release.value = .18;
  master.connect(context.destination);
  return shared = { context, master };
}

const RESUME_TIMEOUT_MS = 1000;
/** AudioContext.resume() can stay pending forever (no output device, autoplay policy), so give it a bounded wait. */
export async function resumeAudio(context: AudioContext): Promise<boolean> {
  if (context.state === 'running') return true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { await Promise.race([context.resume(), new Promise(resolve => { timer = setTimeout(resolve, RESUME_TIMEOUT_MS); })]); }
  catch { /* a rejected resume means no sound */ }
  finally { clearTimeout(timer); }
  return (context.state as AudioContextState) === 'running'; // re-read: resume() changes it
}

export type PlaybackOwner = { stop(): void };
let owner: PlaybackOwner | null = null;
/** Starting playback in one reader stops whichever other reader is playing (also in silent wall-clock playback). */
export function claimPlayback(next: PlaybackOwner): void {
  if (owner && owner !== next) owner.stop();
  owner = next;
}
export function releasePlayback(who: PlaybackOwner): void {
  if (owner === who) owner = null;
}
