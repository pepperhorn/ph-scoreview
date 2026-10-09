import { readPlaybackMarks } from '../notation/musicxml-source';

/**
 * Playback marks read from MusicXML source text: per-note articulation/fermata/cue marks and damper pedal changes.
 * The timeline consumes only this DOM-free shape, so it can be built in a worker. The import worker reads them in its
 * single pass over the source; other callers read them here with the same streaming reader.
 */
export type NoteMark = { durationScale: number; velocityDelta: number; fermata: boolean; silent: boolean };
export type PedalChange = { measureIndex: number; beat: number; kind: 'down' | 'up' | 'change' };
export type PlaybackMarks = { marks: Map<string, NoteMark>; markDiagnostics: string[]; pedals: Map<string, PedalChange[]>; pedalDiagnostics: string[] };

export const emptyPlaybackMarks = (): PlaybackMarks => ({ marks: new Map(), markDiagnostics: [], pedals: new Map(), pedalDiagnostics: [] });

/** Marks of a MusicXML text (partwise or timewise); empty when there is none or it is not well-formed XML. */
export function musicXmlPlaybackMarks(xml: string | undefined): PlaybackMarks {
  return readPlaybackMarks(xml);
}
