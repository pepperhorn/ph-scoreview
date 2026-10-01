import type { Measure, Score } from './score';
import type { FeatureInventory, SourceDiagnostic } from './notation/musicxml-source';
import type { BaseTimeline } from './playback/timeline';

/** Messages between import.ts (main thread) and import.worker.ts. One worker serves one import. */
export type ImportRequest =
  /** A score file: the worker reads it, hashes it, and reads MusicXML/MXL itself. */
  | { kind: 'file'; file: File }
  /** MusicXML text the page already holds (the Reader's musicXml prop). */
  | { kind: 'text'; text: string };

export type ImportReply =
  /**
   * SHA-256 of the file bytes (sent first, so the saved record can be read while the score is parsed); for text, of the
   * text with a format prefix, and its UTF-8 size (see file-state.ts textSource).
   */
  | { kind: 'source'; sha256: string; size?: number }
  /** A format the main thread reads itself (MEI, ABC, MIDI, or an unknown extension): the file bytes, transferred. */
  | { kind: 'bytes'; bytes: ArrayBuffer }
  /** The Score without measures; `measures` messages fill its parts in order, in bounded chunks. */
  | { kind: 'head'; score: Score }
  | { kind: 'measures'; part: number; measures: Measure[] }
  /**
   * The score is complete. `original` is the file bytes (transferred back), `engraving` the engraving text's UTF-8
   * bytes, or null when the engraving text is the source unchanged.
   */
  | { kind: 'done'; format: 'musicxml' | 'mxl'; original: ArrayBuffer | null; engraving: ArrayBuffer | null; inventory: FeatureInventory; diagnostics: SourceDiagnostic[] }
  /** The playback timeline (in beats), without its events; `timeline-events` chunks follow, then `timeline-end`. */
  | { kind: 'timeline'; timeline: BaseTimeline }
  | { kind: 'timeline-events'; events: BaseTimeline['events']; eventSources: BaseTimeline['eventSources'] }
  | { kind: 'timeline-end' }
  | { kind: 'error'; message: string };
