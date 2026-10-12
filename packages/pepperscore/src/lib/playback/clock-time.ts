// Time mapping for clock mode and seeking. Type-only imports, so Node can run it directly (validation/clock.mjs).
import type { PerformanceTimeline } from './timeline';

export type ClockTimeline = Pick<PerformanceTimeline, 'events' | 'positions' | 'initialBpm'>;
export type NoteOnset = { noteId: string; midi: number; measureIndex: number; occurrence: number; seconds: number };

/** Playback seconds per timeline unit at `bpm`; an invalid BPM plays at the score's opening tempo (same rule as playbackScale). */
export function scoreSecondsScale(timeline: Pick<PerformanceTimeline, 'initialBpm'>, bpm: number): number {
  return 60 / (Number.isFinite(bpm) && bpm > 0 ? bpm : timeline.initialBpm);
}

/**
 * Note onsets in seconds at the score's own tempo map: the times clock mode maps `clock.now()` against. One entry per
 * performed pitch (repeats included), in performed order. Seconds count from score beat 0, a pickup's first beat.
 */
export function noteOnsetSeconds(timeline: Pick<PerformanceTimeline, 'events' | 'initialBpm'>): NoteOnset[] {
  const scale = scoreSecondsScale(timeline, timeline.initialBpm);
  return timeline.events.map(event => ({ noteId: event.noteId, midi: event.midi, measureIndex: event.measureIndex, occurrence: event.occurrence, seconds: event.startSeconds * scale }));
}

/** The candidate nearest `near`; on a tie, the earlier one. */
function nearest(candidates: number[], near: number): number | null {
  let best: number | null = null;
  for (const value of candidates) if (best === null || Math.abs(value - near) < Math.abs(best - near) - 1e-9 || (Math.abs(Math.abs(value - near) - Math.abs(best - near)) <= 1e-9 && value < best)) best = value;
  return best;
}

/** Playback seconds (at `bpm`) where a written note sounds, at its performed occurrence nearest `nearSeconds`; null for a rest or unknown note. */
export function noteSeekSeconds(timeline: ClockTimeline, noteId: string, nearSeconds: number, bpm: number): number | null {
  const scale = scoreSecondsScale(timeline, bpm);
  const starts: number[] = [];
  for (const event of timeline.events) for (const segment of event.visualSegments) if (segment.noteId === noteId) starts.push(segment.startSeconds * scale);
  return nearest(starts, nearSeconds);
}

/** Playback seconds (at `bpm`) where a measure's performed occurrence nearest `nearSeconds` starts; null if it is never performed. */
export function measureSeekSeconds(timeline: ClockTimeline, measureIndex: number, nearSeconds: number, bpm: number): number | null {
  const scale = scoreSecondsScale(timeline, bpm);
  const firstByOccurrence = new Map<number, number>();
  for (const position of timeline.positions) {
    if (position.measureIndex !== measureIndex) continue;
    const old = firstByOccurrence.get(position.occurrence);
    if (old === undefined || position.seconds < old) firstByOccurrence.set(position.occurrence, position.seconds);
  }
  return nearest([...firstByOccurrence.values()].map(seconds => seconds * scale), nearSeconds);
}
