import type { Part, Pitch, Score, ScoreDirection } from '../score';
import { soundingMidi } from '../transpose';
import { musicXmlTextNavigation } from '../notation/navigation';
import { musicXmlPlaybackMarks, type NoteMark, type PedalChange, type PlaybackMarks } from './source-marks';
import { fractionValue } from './fraction';
import { buildRoadmap, generatedSegments, measureLengths, resolveRoadmap, roadmapFromNavigation, type ResolvedSegment, type Roadmap } from './roadmap';

/** A sounding pitch. Repeated visits to a written note have separate occurrences. */
export type PerformanceEvent = {
  id: string; noteId: string; pitchId: string; pitchIndex: number;
  partId: string; voice: string; measureIndex: number; occurrence: number;
  scoreBeat: number; endScoreBeat: number; startSeconds: number;
  /** Written (articulated) release: drives highlighting and the visual segments. */
  endSeconds: number;
  /**
   * Audible release. Equals endSeconds unless the sustain pedal holds the note
   * past its written release (or a same-pitch re-attack cuts that tail short).
   * Schedule audio with this; never highlight with it.
   */
  soundEndSeconds: number;
  midi: number; velocity: number; visualNoteIds: string[];
  visualSegments: { noteId: string; startSeconds: number; endSeconds: number }[];
};
export type PlaybackPosition = {
  seconds: number; scoreBeat: number; measureIndex: number; occurrence: number;
  measureBeat: number; noteId: string | null; activeNoteIds: string[];
};
export type PerformanceTimeline = {
  events: PerformanceEvent[]; positions: PlaybackPosition[]; durationSeconds: number;
  initialBpm: number; diagnostics: string[];
  /** The roadmap that was performed: the override when it was valid, else the one built from the score. */
  roadmap: Roadmap;
};
export type TimelineOptions = {
  bpm: number; semitones?: number; musicXml?: string; verovioTimemap?: unknown;
  /**
   * The complete, unfiltered score when `score` is a view with hidden parts.
   * Tempo changes, fermata holds and sibling-staff dynamics are read from it so
   * hiding a part never changes the performance of the parts that remain.
   */
  fullScore?: Score;
  /**
   * A user or saved performance order that replaces the one built from the
   * score's navigation. It is validated; an unusable one is diagnosed and the
   * built roadmap is used instead.
   */
  roadmap?: Roadmap;
};

const EPS = 1e-7;
/** Extra hold added by a fermata, as a fraction of the held note's length. */
const FERMATA_HOLD = .5;
/** Grace notes steal at most this many beats from the beat they ornament. */
const GRACE_BEATS = .125, GRACE_TOTAL = .25;
const dynamics: Record<string, number> = { pppp: 20, ppp: 28, pp: 39, p: 52, mp: 66, mf: 82, f: 96, ff: 108, fff: 118, ffff: 124, sf: 112, sfz: 112, fz: 112, fp: 96, sforzando: 112 };

function scoreOffsets(lengths: number[]): number[] {
  let offset = 0;
  return lengths.map(length => { const here = offset; offset += length; return here; });
}

/** One measure's share of a roadmap segment, with its performed occurrence of that measure. */
type Slice = { measureIndex: number; from: number; to: number; occurrence: number; linearIn: boolean; linearOut: boolean };
/**
 * Splits roadmap segments into per-measure slices. A slice that continues the
 * previous one exactly (next measure start, or the same offset in the same
 * measure) is linear: ties and sounding notes carry across it. Any other
 * entry into a measure is a new occurrence of that measure.
 */
function slices(segments: ResolvedSegment[], lengths: number[]): Slice[] {
  const result: Slice[] = [];
  const occurrences = new Map<number, number>();
  for (const segment of segments) {
    for (let bar = segment.from.bar; bar <= segment.to.bar; bar++) {
      const from = bar === segment.from.bar ? fractionValue(segment.from.beat) : 0;
      const to = bar === segment.to.bar ? fractionValue(segment.to.beat) : lengths[bar];
      if (to <= from + EPS) continue;
      const previous = result.at(-1);
      const sameBar = Boolean(previous && previous.measureIndex === bar && Math.abs(previous.to - from) < EPS);
      const nextBar = Boolean(previous && previous.measureIndex + 1 === bar && from < EPS && Math.abs(previous.to - lengths[previous.measureIndex]) < EPS);
      let occurrence: number;
      if (sameBar) occurrence = previous!.occurrence;
      else { occurrence = occurrences.get(bar) || 0; occurrences.set(bar, occurrence + 1); }
      if (previous) previous.linearOut = sameBar || nextBar;
      result.push({ measureIndex: bar, from, to, occurrence, linearIn: sameBar || nextBar, linearOut: false });
    }
  }
  return result;
}

type TempoPoint = { beat: number; bpm: number };
function tempoPoints(score: Score, offsets: number[], diagnostics: string[]): TempoPoint[] {
  const byBeat = new Map<number, number>();
  for (const part of score.parts) for (const measure of part.measures) for (const direction of measure.directions || []) {
    if (direction.tempo && direction.tempo > 0 && offsets[measure.index] !== undefined) {
      const beat = offsets[measure.index] + direction.start;
      const old = byBeat.get(beat);
      if (old && Math.abs(old - direction.tempo) > EPS) diagnostics.push(`Conflicting tempos at score beat ${beat}; first part wins.`);
      else if (!old) byBeat.set(beat, direction.tempo);
    }
  }
  const points = [...byBeat].map(([beat, bpm]) => ({ beat, bpm })).sort((a, b) => a.beat - b.beat);
  if (!points.length || points[0].beat > EPS) points.unshift({ beat: 0, bpm: score.tempo > 0 ? score.tempo : 120 });
  return points;
}
function tempoAt(points: TempoPoint[], beat: number): number {
  let bpm = points[0].bpm;
  for (const point of points) { if (point.beat > beat + EPS) break; bpm = point.bpm; }
  return bpm;
}

/** MusicXML <sound dynamics> is a percentage of forte, which is MIDI velocity 90. */
function directionVelocity(direction: ScoreDirection): number | undefined {
  if (direction.soundDynamics !== undefined && Number.isFinite(direction.soundDynamics)) return Math.max(1, Math.min(127, Math.round(direction.soundDynamics * .9)));
  for (const symbol of direction.symbols || []) if (dynamics[symbol] !== undefined) return dynamics[symbol];
  return undefined;
}

type DynamicPoint = { beat: number; staffId: string; voice?: string; velocity?: number; wedge?: { type: string; number: string } };
/** The source part (not staff) a Score part came from; piano staves share dynamics. */
function sourcePartId(score: Score, part: Part): string {
  return score.document?.identity?.staffIdToSource?.[part.id]?.partId || part.id;
}
function dynamicPoints(score: Score, offsets: number[]): Map<string, DynamicPoint[]> {
  const groups = new Map<string, DynamicPoint[]>();
  for (const part of score.parts) {
    const list = groups.get(sourcePartId(score, part)) || [];
    groups.set(sourcePartId(score, part), list);
    for (const measure of part.measures) {
      const offset = offsets[measure.index];
      if (offset === undefined) continue;
      const directions = measure.directions || [];
      const explicit = directions.some(direction => direction.symbols?.length || direction.soundDynamics !== undefined);
      for (const direction of directions) {
        const velocity = directionVelocity(direction);
        if (velocity !== undefined || direction.wedge) list.push({ beat: offset + direction.start, staffId: part.id, voice: direction.voice, velocity, wedge: direction.wedge });
      }
      // Older imports only filled measure.dynamics; directions win when present.
      if (!explicit) for (const mark of measure.dynamics || []) {
        if (dynamics[mark.symbol] !== undefined) list.push({ beat: offset + mark.start, staffId: part.id, velocity: dynamics[mark.symbol] });
      }
    }
  }
  for (const list of groups.values()) list.sort((a, b) => a.beat - b.beat);
  return groups;
}
function velocityFor(points: DynamicPoint[], staffId: string, targetBeat: number, voice: string): number {
  let value = 82, valueBeat = -Infinity, valueOwn = false;
  const openWedges = new Map<string, { start: number; velocity: number; type: string }>();
  const completed: { start: number; end: number; velocity: number; type: string }[] = [];
  for (const point of points) {
    if (point.beat > targetBeat + EPS) break;
    const own = point.staffId === staffId;
    // Voice-specific marks only filter notes on their own staff.
    if (own && point.voice && point.voice !== voice) continue;
    if (point.wedge) {
      const key = `${point.staffId}:${point.wedge.number}`;
      const type = point.wedge.type;
      if (type === 'crescendo' || type === 'diminuendo') openWedges.set(key, { start: point.beat, velocity: value, type });
      else if (type === 'stop') {
        const open = openWedges.get(key);
        if (open) { completed.push({ ...open, end: point.beat }); openWedges.delete(key); }
      }
    }
    if (point.velocity === undefined) continue;
    // At the same instant, a mark on the note's own staff beats a sibling staff's.
    if (Math.abs(point.beat - valueBeat) < EPS && valueOwn && !own) continue;
    value = point.velocity; valueBeat = point.beat; valueOwn = own;
  }
  const wedge = [...completed, ...[...openWedges.values()].map(open => ({ ...open, end: targetBeat + 4 }))].find(span => span.start <= targetBeat && span.end > targetBeat);
  if (wedge) {
    const progress = Math.max(0, Math.min(1, (targetBeat - wedge.start) / Math.max(.01, wedge.end - wedge.start)));
    value = Math.round(wedge.velocity + (wedge.type === 'crescendo' ? 22 : -22) * progress);
  }
  return Math.max(1, Math.min(127, value));
}


/** Prefer the identified partwise engraving text: it carries generated note IDs and normalized timewise layout. */
function documentXml(score: Score): string | undefined {
  const document = score.document;
  for (const xml of [document?.engravingText, document?.originalText]) {
    if (xml && /<\s*(?:\w+:)?score-(?:partwise|timewise)\b/.test(xml)) return xml;
  }
  return undefined;
}

/** Grace notes sound for at least this long, in seconds at the score's opening tempo. */
const GRACE_FLOOR_SECONDS = .03;
type PerformedPedal = { seconds: number; kind: PedalChange['kind'] };

/**
 * The performance built once per score, independent of BPM, transposition and hidden parts.
 *
 * Every `...Seconds` field (events, visual segments, positions, `durationSeconds`, pedal times) is in performed
 * beats at the score's opening tempo: where the tempo doubles, a written beat counts 1/2. Playback seconds are
 * those values times 60 / bpm (playbackScale), so a BPM change never rebuilds the timeline. MIDI numbers are at
 * 0 semitones; playback adds the transposition to every event of a non-percussion part.
 *
 * Plain data (arrays and Maps of plain values), so a worker can build it and post it.
 */
export type BaseTimeline = PerformanceTimeline & {
  /** Source part (pedal scope) of each event, parallel to `events`. */
  eventSources: string[];
  /** Pedal changes in performed time per source part, in performed order. */
  performedPedals: Map<string, PerformedPedal[]>;
  /** End of the performed roadmap, before the last notes' tails. */
  pieceEnd: number;
  /** Parts whose events are never transposed (percussion). */
  percussionPartIds: string[];
  /** Diagnostics not tied to one part, in the order they were found. */
  headDiagnostics: string[];
  /** Per-part diagnostics (unmatched ties), in the order they were found. */
  partDiagnostics: { partId: string; message: string }[];
};

export type BaseTimelineOptions = {
  /** A caller's own MusicXML: navigation, marks and pedals are read from it instead of the score. */
  musicXml?: string;
  roadmap?: Roadmap;
  /** Note marks and pedals already read from the source (for example by the import worker). */
  marks?: PlaybackMarks;
  /** Parts to perform; all parts of the score by default. Tempo, fermatas and dynamics always come from the whole score. */
  parts?: Part[];
};

/** Build the BPM-independent performance of `full` (see BaseTimeline). */
export function buildBaseTimeline(full: Score, options: BaseTimelineOptions = {}): BaseTimeline {
  const diagnostics: string[] = [];
  const partDiagnostics: { partId: string; message: string }[] = [];
  const parts = options.parts || full.parts;
  // Measure lengths, navigation and the roadmap come from the full score, so hiding a part never changes them.
  const exactLengths = measureLengths(full);
  const lengths = exactLengths.map(fractionValue);
  const offsets = scoreOffsets(lengths);
  const points = tempoPoints(full, offsets, diagnostics);
  const initialBpm = tempoAt(points, 0);
  /** Timeline units (opening-tempo beats) per written beat at a score beat. */
  const unitsPerBeat = (beat: number) => initialBpm / tempoAt(points, beat);
  const source = options.marks || musicXmlPlaybackMarks(options.musicXml || documentXml(full));
  const marks = source.marks;
  diagnostics.push(...source.markDiagnostics);
  const markFor = (note: { sourceId?: string; pitches: (Pitch & { sourceId?: string })[] }) => [note.sourceId, ...note.pitches.map(p => p.sourceId)].map(id => id ? marks.get(id) : undefined).find((item): item is NoteMark => Boolean(item));
  const dynamicGroups = dynamicPoints(full, offsets);
  // Navigation lives on the Score; an explicit musicXml option (a caller's own source) is read instead.
  const built = options.musicXml
    ? roadmapFromNavigation(musicXmlTextNavigation(options.musicXml, lengths.length, diagnostics), exactLengths, diagnostics)
    : buildRoadmap(full, diagnostics);
  const override = options.roadmap ? resolveRoadmap(options.roadmap, exactLengths, diagnostics) : undefined;
  const roadmap = override ? options.roadmap! : built;
  // Only a user override is validated; a rejected one falls back to the generated roadmap, which always plays.
  const performedSlices = slices(override || generatedSegments(built), lengths);
  const pedals = source.pedals;
  diagnostics.push(...source.pedalDiagnostics);
  const performedPedals = new Map<string, PerformedPedal[]>();
  const eventSource = new Map<PerformanceEvent, string>();
  const events: PerformanceEvent[] = [];
  const positions: PlaybackPosition[] = [];
  const openTies = new Map<string, PerformanceEvent>();
  // The floor is in timeline units, so it scales with BPM like every other duration: 30 ms at the opening tempo.
  const graceFloor = GRACE_FLOOR_SECONDS * initialBpm / 60;
  let elapsed = 0;
  for (const slice of performedSlices) {
    const { measureIndex, from, to } = slice;
    const length = lengths[measureIndex];
    const offset = offsets[measureIndex];
    // A slice continued within the same measure lets its notes sound on past `to`, so time is mapped up to the bar end.
    const horizon = slice.linearOut ? Math.max(to, length) : to;
    const localTempos = points.filter(point => point.beat > offset + from + EPS && point.beat < offset + horizon - EPS);
    const boundaries = [from, ...localTempos.map(point => point.beat - offset), horizon];
    const times = [0];
    for (let i = 1; i < boundaries.length; i++) times.push(times[i - 1] + (boundaries[i] - boundaries[i - 1]) * unitsPerBeat(offset + boundaries[i - 1] + EPS));
    const baseAt = (beat: number) => {
      const limited = Math.max(from, Math.min(horizon, beat));
      let segment = boundaries.length - 2;
      for (let i = 0; i < boundaries.length - 1; i++) if (limited < boundaries[i + 1] - EPS) { segment = i; break; }
      return elapsed + times[segment] + (limited - boundaries[segment]) * unitsPerBeat(offset + boundaries[segment] + EPS);
    };
    const secondsPerBeat = (beat: number) => unitsPerBeat(offset + beat + EPS);
    const inSlice = (beat: number) => beat >= from - EPS && beat < to - EPS;
    // Fermatas hold the music: time is inserted where the shortest held note of
    // each fermata onset ends, so later notes wait instead of overlapping.
    const fermataStarts = new Map<string, { start: number; duration: number }>();
    for (const part of full.parts) for (const note of part.measures[measureIndex]?.notes || []) {
      if (note.grace || note.duration <= 0 || !inSlice(note.start) || !markFor(note)?.fermata) continue;
      const key = note.start.toFixed(6);
      const old = fermataStarts.get(key);
      if (!old || note.duration < old.duration) fermataStarts.set(key, { start: note.start, duration: note.duration });
    }
    const holdMap = new Map<string, { beat: number; seconds: number }>();
    for (const { start, duration } of fermataStarts.values()) {
      const beat = Math.min(to, start + duration);
      const seconds = (baseAt(beat) - baseAt(start)) * FERMATA_HOLD;
      const key = beat.toFixed(6);
      holdMap.set(key, { beat, seconds: Math.max(seconds, holdMap.get(key)?.seconds || 0) });
    }
    const holds = [...holdMap.values()].sort((a, b) => a.beat - b.beat);
    const heldBefore = (beat: number, inclusive: boolean) => holds.reduce((sum, hold) => sum + (hold.beat < beat - EPS || (inclusive && hold.beat <= beat + EPS) ? hold.seconds : 0), 0);
    const secondsAt = (beat: number) => baseAt(beat) + heldBefore(beat, true);
    // A note is cut where a segment ends in a jump; a linear continuation lets it sound on.
    const release = (beat: number) => slice.linearOut ? beat : Math.min(to, beat);

    // Ties survive a repeat/D.S. jump only if the target note stops the tie.
    const carried = slice.linearIn ? undefined : new Map(openTies);
    const positionBeats = [...new Set([...boundaries.filter(beat => beat < to - EPS), to, ...holds.map(hold => hold.beat)].map(beat => beat.toFixed(9)))].map(Number).sort((a, b) => a - b);
    for (const beat of positionBeats) {
      const base = { scoreBeat: offset + beat, measureIndex, occurrence: slice.occurrence, measureBeat: beat, noteId: null, activeNoteIds: [] };
      if (holds.some(hold => Math.abs(hold.beat - beat) < 1e-6)) positions.push({ ...base, seconds: baseAt(beat) + heldBefore(beat, false) });
      positions.push({ ...base, seconds: secondsAt(beat) });
    }
    // Pedal marks are placed per performed occurrence, so repeats and jumps re-pedal.
    // A mark exactly at a slice end belongs to the slice that continues from there, if any.
    for (const [sourceId, changes] of pedals) for (const change of changes) {
      if (change.measureIndex !== measureIndex) continue;
      const atEnd = change.beat >= to - EPS && (to >= length - EPS || (!slice.linearOut && change.beat <= to + EPS));
      if (!inSlice(change.beat) && !atEnd) continue;
      const list = performedPedals.get(sourceId) || [];
      list.push({ seconds: secondsAt(Math.min(to, change.beat)), kind: change.kind });
      performedPedals.set(sourceId, list);
    }
    for (const part of parts) {
      const measure = part.measures[measureIndex];
      if (!measure) continue;
      const graceGroups = new Map<string, string[]>();
      for (const note of measure.notes) if (note.grace) {
        const key = `${note.voice || '1'}:${note.start.toFixed(6)}`;
        graceGroups.set(key, [...(graceGroups.get(key) || []), note.id]);
      }
      const graceBeat = (n: number) => Math.min(GRACE_BEATS, GRACE_TOTAL / Math.max(1, n));
      const dynamicList = dynamicGroups.get(sourcePartId(full, part)) || dynamicGroups.get(part.id) || [];
      const pedalSource = sourcePartId(full, part);
      for (const note of measure.notes) {
        if (note.rest || !note.pitches.length) continue;
        if (note.duration <= 0 && !note.grace) continue;
        // Only notes that start inside the slice sound in it; a note begun before a jump target is not re-attacked.
        if (!inSlice(note.start)) continue;
        const voice = note.voice || '1';
        let start: number, end: number;
        if (note.grace) {
          const group = graceGroups.get(`${voice}:${note.start.toFixed(6)}`) || [note.id];
          const n = group.length, i = Math.max(0, group.indexOf(note.id));
          const step = graceBeat(n) * secondsPerBeat(note.start);
          const principal = secondsAt(note.start);
          // Graces on the downbeat delay their principal; others steal from the previous beat.
          if (note.start <= EPS) { start = principal + i * step; end = principal + (i + 1) * step; }
          else { start = Math.max(baseAt(from), principal - (n - i) * step); end = principal - (n - i - 1) * step; }
          end = Math.max(start + graceFloor, end);
        } else {
          const opening = note.start <= EPS ? (graceGroups.get(`${voice}:${note.start.toFixed(6)}`)?.length || 0) : 0;
          start = secondsAt(note.start) + (opening ? opening * graceBeat(opening) * secondsPerBeat(0) : 0);
          end = secondsAt(release(note.start + note.duration));
        }
        const mark = markFor(note);
        if (mark?.silent) continue;
        note.pitches.forEach((pitch: Pitch & { sourceId?: string }, pitchIndex) => {
          const midi = soundingMidi(part, measure, pitch, 0);
          const pitchMark = (pitch.sourceId ? marks.get(pitch.sourceId) : undefined) || mark;
          const soundingEnd = start + (end - start) * (pitchMark?.durationScale ?? 1);
          const tieKey = `${part.id}:${voice}:${midi}`;
          const old = openTies.get(tieKey);
          if (pitch.tieStop && old) {
            old.endSeconds = Math.max(old.endSeconds, soundingEnd);
            old.endScoreBeat = offset + note.start + note.duration;
            if (!old.visualNoteIds.includes(note.id)) old.visualNoteIds.push(note.id);
            old.visualSegments.push({ noteId: note.id, startSeconds: start, endSeconds: soundingEnd });
            if (!pitch.tieStart) openTies.delete(tieKey);
            return;
          }
          if (pitch.tieStop && !old) partDiagnostics.push({ partId: part.id, message: `Unmatched tie stop at ${note.id}, pitch ${pitchIndex}.` });
          const event: PerformanceEvent = {
            id: `${note.id}:${pitchIndex}:${slice.occurrence}`, noteId: note.id,
            pitchId: pitch.sourceId || `${note.id}:${pitchIndex}`, pitchIndex, partId: part.id, voice,
            measureIndex, occurrence: slice.occurrence, scoreBeat: offset + note.start,
            endScoreBeat: offset + note.start + note.duration, startSeconds: start, endSeconds: soundingEnd, soundEndSeconds: soundingEnd,
            midi, velocity: Math.max(1, Math.min(127, velocityFor(dynamicList, part.id, offset + note.start, voice) + (pitchMark?.velocityDelta || 0))), visualNoteIds: [note.id],
            visualSegments: [{ noteId: note.id, startSeconds: start, endSeconds: soundingEnd }],
          };
          events.push(event);
          eventSource.set(event, pedalSource);
          if (pitch.tieStart) openTies.set(tieKey, event);
        });
      }
    }
    if (carried) for (const [key, event] of carried) if (openTies.get(key) === event) openTies.delete(key);
    elapsed = secondsAt(to);
  }
  events.sort((a, b) => a.startSeconds - b.startSeconds || a.partId.localeCompare(b.partId) || a.pitchIndex - b.pitchIndex);
  const eventSources = events.map(event => eventSource.get(event)!);
  applySustainPedal(events, eventSources, performedPedals, elapsed);
  return {
    events, positions, durationSeconds: timelineEnd(events, elapsed), initialBpm,
    diagnostics: [...new Set([...diagnostics, ...partDiagnostics.map(item => item.message)])], roadmap,
    eventSources, performedPedals, pieceEnd: elapsed, percussionPartIds: parts.filter(part => part.clef === 'percussion').map(part => part.id),
    headDiagnostics: diagnostics, partDiagnostics,
  };
}

function timelineEnd(events: PerformanceEvent[], pieceEnd: number): number {
  let end = pieceEnd;
  for (const event of events) end = Math.max(end, event.endSeconds, event.soundEndSeconds);
  return end;
}

/**
 * The base timeline restricted to `visiblePartIds` (hidden parts muted). Events of each part do not depend on the
 * others, so this filters them and re-applies the sustain pedal, whose re-attack damping is scoped to what sounds.
 * Tempo, fermatas, dynamics and navigation stay those of the whole score. Returns `base` when nothing is hidden.
 */
export function deriveTimeline(base: BaseTimeline, options: { visiblePartIds?: readonly string[] } = {}): BaseTimeline {
  if (!options.visiblePartIds) return base;
  const visible = new Set(options.visiblePartIds);
  if (base.events.every(event => visible.has(event.partId)) && base.partDiagnostics.every(item => visible.has(item.partId))) return base;
  const events: PerformanceEvent[] = [];
  const eventSources: string[] = [];
  base.events.forEach((event, index) => {
    if (!visible.has(event.partId)) return;
    events.push({ ...event });
    eventSources.push(base.eventSources[index]);
  });
  applySustainPedal(events, eventSources, base.performedPedals, base.pieceEnd);
  const partDiagnostics = base.partDiagnostics.filter(item => visible.has(item.partId));
  return {
    ...base, events, eventSources, partDiagnostics, durationSeconds: timelineEnd(events, base.pieceEnd),
    percussionPartIds: base.percussionPartIds.filter(id => visible.has(id)),
    diagnostics: [...new Set([...base.headDiagnostics, ...partDiagnostics.map(item => item.message)])],
  };
}

/** Playback seconds per timeline unit at `bpm` (an invalid BPM plays at the score's opening tempo). */
export function playbackScale(timeline: Pick<PerformanceTimeline, 'initialBpm'>, bpm: number): number {
  return 60 / (Number.isFinite(bpm) && bpm > 0 ? bpm : timeline.initialBpm);
}
const transposable = (timeline: BaseTimeline) => {
  const percussion = new Set(timeline.percussionPartIds);
  return (event: PerformanceEvent) => !percussion.has(event.partId);
};
function scaledEvent(event: PerformanceEvent, scale: number, semitones: number): PerformanceEvent {
  return {
    ...event, startSeconds: event.startSeconds * scale, endSeconds: event.endSeconds * scale, soundEndSeconds: event.soundEndSeconds * scale,
    midi: event.midi + semitones, visualNoteIds: [...event.visualNoteIds],
    visualSegments: event.visualSegments.map(segment => ({ ...segment, startSeconds: segment.startSeconds * scale, endSeconds: segment.endSeconds * scale })),
  };
}

/** Playback length in seconds at `bpm`. */
export function playbackDuration(timeline: BaseTimeline, bpm: number): number {
  return timeline.durationSeconds * playbackScale(timeline, bpm);
}
/** The position at playback `seconds` when the timeline plays at `bpm`. */
export function playbackPositionAt(timeline: BaseTimeline, seconds: number, bpm: number): PlaybackPosition {
  const scale = playbackScale(timeline, bpm);
  const position = positionAtSeconds(timeline, seconds / scale);
  return { ...position, seconds: position.seconds * scale };
}
/**
 * Events still sounding from playback `seconds` on (as eventsFromSeconds: tails of events begun earlier are clipped
 * to start there), in playback seconds at `bpm` and transposed by `semitones`. Only these events are copied.
 */
export function playbackEventsFrom(timeline: BaseTimeline, seconds: number, bpm: number, semitones = 0): PerformanceEvent[] {
  const scale = playbackScale(timeline, bpm);
  const units = seconds / scale;
  const shifts = transposable(timeline);
  const result: PerformanceEvent[] = [];
  for (const event of timeline.events) {
    if (event.soundEndSeconds <= units + EPS) continue;
    const scaled = scaledEvent(event, scale, shifts(event) ? semitones : 0);
    if (event.startSeconds < units) { scaled.startSeconds = seconds; scaled.endSeconds = Math.max(seconds, scaled.endSeconds); }
    result.push(scaled);
  }
  return result;
}
/** Sounding MIDI numbers of the given parts' events, transposed by `semitones`. */
export function playbackMidis(timeline: BaseTimeline, partIds: ReadonlySet<string>, semitones = 0): number[] {
  const shifts = transposable(timeline);
  return timeline.events.filter(event => partIds.has(event.partId)).map(event => event.midi + (shifts(event) ? semitones : 0));
}

/** The timeline in playback seconds at `bpm`, transposed by `semitones` (the shape buildPerformanceTimeline returns). */
export function materializeTimeline(timeline: BaseTimeline, bpm: number, semitones = 0): PerformanceTimeline {
  const scale = playbackScale(timeline, bpm);
  const shifts = transposable(timeline);
  return {
    events: timeline.events.map(event => scaledEvent(event, scale, shifts(event) ? semitones : 0)),
    positions: timeline.positions.map(position => ({ ...position, seconds: position.seconds * scale, activeNoteIds: [...position.activeNoteIds] })),
    durationSeconds: timeline.durationSeconds * scale, initialBpm: timeline.initialBpm, diagnostics: [...timeline.diagnostics], roadmap: timeline.roadmap,
  };
}

/** Base timelines registered for a score's source document (for example built by the import worker). */
const registered = new WeakMap<object, Promise<BaseTimeline>>();
export function registerBaseTimeline(document: object, timeline: Promise<BaseTimeline>): void {
  registered.set(document, timeline);
}
export function registeredBaseTimeline(document: object): Promise<BaseTimeline> | undefined {
  return registered.get(document);
}
/**
 * The base timeline of a full score: the one registered for its document (falling back to building here if that
 * fails), else one built here on first use. It is kept per document, so instrument changes, BPM and transposition
 * never rebuild it.
 */
export function baseTimelineFor(score: Score): Promise<BaseTimeline> {
  const key: object = score.document || score;
  const known = registered.get(key);
  if (known) return known.catch(() => buildBaseTimeline(score));
  const timeline = new Promise<BaseTimeline>(resolve => resolve(buildBaseTimeline(score)));
  registered.set(key, timeline);
  return timeline;
}

/** Build one ordered performed timeline, with source tempo scaled by the displayed BPM. */
export function buildPerformanceTimeline(score: Score, options: TimelineOptions): PerformanceTimeline {
  const full = options.fullScore && options.fullScore.parts.length ? options.fullScore : score;
  const xml = options.musicXml || documentXml(score) || documentXml(full);
  const base = buildBaseTimeline(full, { musicXml: options.musicXml, roadmap: options.roadmap, marks: musicXmlPlaybackMarks(xml), parts: score.parts });
  const timeline = materializeTimeline(base, options.bpm, options.semitones || 0);
  if (options.verovioTimemap !== undefined) {
    const diagnostics = [...timeline.diagnostics];
    if (!Array.isArray(options.verovioTimemap)) diagnostics.push('Verovio timemap shape is unrecognized; source timing was used.');
    else {
      // Verovio 6.3.0 exposes {on,off,qstamp,tstamp}. qstamp is a useful
      // source-index check, while source tempo/navigation remain authoritative.
      const firstOnset = new Map<string, number>();
      for (const item of options.verovioTimemap as unknown[]) {
        if (!item || typeof item !== 'object') continue;
        const row = item as { on?: unknown; qstamp?: unknown };
        if (!Array.isArray(row.on) || typeof row.qstamp !== 'number') continue;
        for (const id of row.on) if (typeof id === 'string' && !firstOnset.has(id)) firstOnset.set(id, row.qstamp);
      }
      const checked = new Set<string>();
      for (const event of timeline.events) {
        if (checked.has(event.pitchId)) continue;
        checked.add(event.pitchId);
        const qstamp = firstOnset.get(event.pitchId);
        if (qstamp !== undefined && Math.abs(qstamp - event.scoreBeat) > .01) diagnostics.push(`Verovio/source onset differs for ${event.pitchId}.`);
      }
    }
    timeline.diagnostics = [...new Set(diagnostics)];
  }
  return timeline;
}

/**
 * The damper pedal scopes a whole source part (every staff). A note released
 * while the pedal is down keeps sounding until the next lift; a change is a lift
 * and re-depress at the same instant, so notes released before it end there.
 * Only soundEndSeconds moves; written ends and highlighting are untouched.
 */
function applySustainPedal(events: PerformanceEvent[], eventSources: string[], performed: Map<string, PerformedPedal[]>, pieceEnd: number) {
  // Tie chains extend endSeconds after creation; the audible end starts from the final written end.
  for (const event of events) event.soundEndSeconds = event.endSeconds;
  const spans = new Map<string, { down: number; up: number }[]>();
  for (const [sourceId, changes] of performed) {
    const list: { down: number; up: number }[] = [];
    let downAt: number | undefined;
    // Stable sort keeps performed order for changes at the same instant.
    for (const change of [...changes].sort((a, b) => a.seconds - b.seconds)) {
      if (change.kind === 'down') { downAt ??= change.seconds; continue; }
      if (downAt !== undefined) list.push({ down: downAt, up: change.seconds });
      downAt = change.kind === 'change' ? change.seconds : undefined;
    }
    if (downAt !== undefined) list.push({ down: downAt, up: pieceEnd });
    spans.set(sourceId, list.filter(span => span.up > span.down + EPS));
  }
  if (!spans.size) return;
  const byKey = new Map<string, PerformanceEvent[]>();
  events.forEach((event, index) => {
    const sourceId = eventSources[index];
    if (sourceId === undefined) return;
    const key = `${sourceId}:${event.midi}`;
    const group = byKey.get(key);
    if (group) group.push(event); else byKey.set(key, [event]);
    const span = spans.get(sourceId)?.find(item => item.down < event.endSeconds - EPS && event.endSeconds < item.up - EPS);
    if (span) event.soundEndSeconds = span.up;
  });
  // Re-striking a sustained pitch damps the previous string at the new attack.
  for (const group of byKey.values()) for (const event of group) {
    if (event.soundEndSeconds <= event.endSeconds + EPS) continue;
    const next = group.find(other => other.startSeconds > event.startSeconds + EPS && other.startSeconds < event.soundEndSeconds - EPS);
    if (next) event.soundEndSeconds = Math.max(event.endSeconds, next.startSeconds);
  }
}

/** Includes sustained notes; useful for cursor, highlights, seek and resume. */
export function positionAtSeconds(timeline: PerformanceTimeline, seconds: number): PlaybackPosition {
  const clamped = Math.max(0, Math.min(timeline.durationSeconds, seconds));
  const positions = timeline.positions;
  let index = positions.length ? 0 : -1;
  for (let i = 0; i < positions.length; i++) { if (positions[i].seconds > clamped + EPS) break; index = i; }
  const current = positions[index] || { seconds: 0, scoreBeat: 0, measureIndex: 0, occurrence: 0, measureBeat: 0, noteId: null, activeNoteIds: [] };
  const next = index >= 0 ? positions[index + 1] : undefined;
  const ratio = next && next.seconds > current.seconds && next.measureIndex === current.measureIndex && next.occurrence === current.occurrence ? (clamped - current.seconds) / (next.seconds - current.seconds) : 0;
  const scoreBeat = current.scoreBeat + ratio * (next ? next.scoreBeat - current.scoreBeat : 0);
  const active = new Set<string>();
  for (const event of timeline.events) {
    if (event.startSeconds > clamped + EPS || event.endSeconds <= clamped + EPS) continue;
    for (const segment of event.visualSegments) if (segment.startSeconds <= clamped + EPS && segment.endSeconds > clamped + EPS) active.add(segment.noteId);
  }
  let latest: PerformanceEvent | undefined;
  for (let i = timeline.events.length - 1; i >= 0; i--) {
    const event = timeline.events[i];
    if (event.startSeconds <= clamped + EPS && event.measureIndex === current.measureIndex && event.occurrence === current.occurrence) { latest = event; break; }
  }
  const activeNoteIds = [...active];
  return { ...current, seconds: clamped, scoreBeat, measureBeat: current.measureBeat + scoreBeat - current.scoreBeat, noteId: activeNoteIds[0] || latest?.noteId || null, activeNoteIds };
}

/** Active event tails are clipped to the seek time so pause/resume sustains correctly. */
export function eventsFromSeconds(timeline: PerformanceTimeline, seconds: number): PerformanceEvent[] {
  return timeline.events.filter(event => event.soundEndSeconds > seconds + EPS).map(event => event.startSeconds < seconds ? { ...event, startSeconds: seconds, endSeconds: Math.max(seconds, event.endSeconds) } : event);
}
