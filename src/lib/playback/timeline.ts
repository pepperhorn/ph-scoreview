import type { Part, Pitch, Score, ScoreDirection } from '../score';
import { soundingMidi } from '../transpose';
import { musicXmlTextNavigation } from '../notation/navigation';
import { fractionValue } from './fraction';
import { buildRoadmap, measureLengths, resolveRoadmap, roadmapFromNavigation, type ResolvedSegment, type Roadmap } from './roadmap';

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

function xmlChildren(el: Element, name: string): Element[] { return Array.from(el.children).filter(item => item.localName === name); }
function first(el: Element, name: string): Element | undefined { return xmlChildren(el, name)[0]; }
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
type NoteMark = { durationScale: number; velocityDelta: number; fermata: boolean; silent: boolean };
function sourceNoteMarks(xml: string | undefined, diagnostics: string[]): Map<string, NoteMark> {
  const result = new Map<string, NoteMark>();
  if (!xml || typeof DOMParser === 'undefined') return result;
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) return result;
  for (const note of Array.from(doc.getElementsByTagName('*')).filter(el => el.localName === 'note')) {
    const id = note.getAttribute('id');
    const notations = first(note, 'notations');
    // Cue notes are engraved for reference only and never sound.
    const silent = Boolean(first(note, 'cue'));
    if (!notations && !silent) continue;
    const art = notations && first(notations, 'articulations');
    const names = art ? Array.from(art.children).map(el => el.localName) : [];
    let durationScale = 1, velocityDelta = 0;
    if (names.includes('staccatissimo')) durationScale = .25;
    else if (names.includes('staccato')) durationScale = .5;
    else if (names.includes('detached-legato')) durationScale = .75;
    else if (names.includes('tenuto')) durationScale = .96;
    if (names.includes('strong-accent')) velocityDelta = 18;
    else if (names.includes('accent')) velocityDelta = 12;
    const fermata = Boolean(notations && first(notations, 'fermata'));
    const meaningful = durationScale !== 1 || velocityDelta || fermata || silent;
    if (id && meaningful) result.set(id, { durationScale, velocityDelta, fermata, silent });
    else if (!id && meaningful) diagnostics.push('Some articulations lack MusicXML note IDs and could not be mapped to sound.');
    if (notations && first(notations, 'ornaments')) diagnostics.push('Ornaments are engraved but not synthesized.');
  }
  return result;
}

type PedalChange = { measureIndex: number; beat: number; kind: 'down' | 'up' | 'change' };
/**
 * Damper (sustain) pedal changes per source part, in written measure/beat
 * position. <pedal> marks in a direction win; a bare <sound damper-pedal>
 * (yes/no or 0-100) is used when the direction has no pedal mark.
 * Sostenuto is not synthesized and is diagnosed.
 */
function sourcePedals(xml: string | undefined, diagnostics: string[]): Map<string, PedalChange[]> {
  const result = new Map<string, PedalChange[]>();
  if (!xml || typeof DOMParser === 'undefined') return result;
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) return result;
  const root = doc.documentElement;
  const partMeasures = new Map<string, Element[]>();
  if (root.localName === 'score-timewise') {
    for (const measure of xmlChildren(root, 'measure')) for (const part of xmlChildren(measure, 'part')) {
      const id = part.getAttribute('id') || '';
      partMeasures.set(id, [...(partMeasures.get(id) || []), part]);
    }
  } else for (const part of xmlChildren(root, 'part')) partMeasures.set(part.getAttribute('id') || '', xmlChildren(part, 'measure'));
  const duration = (el: Element) => Number(first(el, 'duration')?.textContent) || 0;
  for (const [partId, measures] of partMeasures) {
    const changes: PedalChange[] = [];
    let divisions = 1;
    measures.forEach((measure, measureIndex) => {
      let cursor = 0;
      const damper = (sound: Element | undefined, beat: number) => {
        if (sound?.hasAttribute('sostenuto-pedal')) diagnostics.push('Sostenuto pedal is engraved but not synthesized.');
        const value = sound?.getAttribute('damper-pedal');
        if (value === null || value === undefined) return;
        const down = value === 'yes' || (value !== 'no' && Number(value) > 0);
        changes.push({ measureIndex, beat, kind: down ? 'down' : 'up' });
      };
      for (const item of Array.from(measure.children)) {
        const name = item.localName;
        if (name === 'attributes') { const d = Number(first(item, 'divisions')?.textContent); if (d > 0) divisions = d; }
        else if (name === 'note') { if (!first(item, 'chord') && !first(item, 'grace')) cursor += duration(item) / divisions; }
        else if (name === 'backup') cursor = Math.max(0, cursor - duration(item) / divisions);
        else if (name === 'forward') cursor += duration(item) / divisions;
        else if (name === 'sound') damper(item, cursor);
        else if (name === 'direction') {
          const offset = first(item, 'offset');
          const beat = Math.max(0, cursor + (offset?.getAttribute('sound') === 'yes' ? (Number(offset.textContent) || 0) / divisions : 0));
          const pedals = xmlChildren(item, 'direction-type').flatMap(type => xmlChildren(type, 'pedal'));
          for (const pedal of pedals) {
            const type = pedal.getAttribute('type');
            if (type === 'start' || type === 'resume') changes.push({ measureIndex, beat, kind: 'down' });
            else if (type === 'stop' || type === 'discontinue') changes.push({ measureIndex, beat, kind: 'up' });
            else if (type === 'change') changes.push({ measureIndex, beat, kind: 'change' });
            else if (type === 'sostenuto') diagnostics.push('Sostenuto pedal is engraved but not synthesized.');
          }
          if (pedals.length) { if (first(item, 'sound')?.hasAttribute('sostenuto-pedal')) diagnostics.push('Sostenuto pedal is engraved but not synthesized.'); }
          else damper(first(item, 'sound'), beat);
        }
      }
    });
    if (changes.length) result.set(partId, changes);
  }
  return result;
}
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

/** Build one ordered performed timeline, with source tempo scaled by the displayed BPM. */
export function buildPerformanceTimeline(score: Score, options: TimelineOptions): PerformanceTimeline {
  const diagnostics: string[] = [];
  const full = options.fullScore && options.fullScore.parts.length ? options.fullScore : score;
  // Measure lengths, navigation and the roadmap come from the full score, so hiding a part never changes them.
  const exactLengths = measureLengths(full);
  const lengths = exactLengths.map(fractionValue);
  const offsets = scoreOffsets(lengths);
  const points = tempoPoints(full, offsets, diagnostics);
  const initialBpm = tempoAt(points, 0);
  const requestedBpm = Number.isFinite(options.bpm) && options.bpm > 0 ? options.bpm : initialBpm;
  const tempoScale = requestedBpm / initialBpm;
  const xml = options.musicXml || documentXml(score) || documentXml(full);
  const marks = sourceNoteMarks(xml, diagnostics);
  const markFor = (note: { sourceId?: string; pitches: (Pitch & { sourceId?: string })[] }) => [note.sourceId, ...note.pitches.map(p => p.sourceId)].map(id => id ? marks.get(id) : undefined).find((item): item is NoteMark => Boolean(item));
  const dynamicGroups = dynamicPoints(full, offsets);
  // Navigation lives on the Score; an explicit musicXml option (a caller's own source) is read instead.
  const built = options.musicXml
    ? roadmapFromNavigation(musicXmlTextNavigation(options.musicXml, lengths.length, diagnostics), exactLengths, diagnostics)
    : buildRoadmap(full, diagnostics);
  const override = options.roadmap ? resolveRoadmap(options.roadmap, exactLengths, diagnostics) : undefined;
  const roadmap = override ? options.roadmap! : built;
  const performedSlices = slices(override || resolveRoadmap(built, exactLengths, diagnostics) || [], lengths);
  const pedals = sourcePedals(xml, diagnostics);
  /** Pedal changes in performed time, per source part, in performed order. */
  const performedPedals = new Map<string, { seconds: number; kind: PedalChange['kind'] }[]>();
  const eventSource = new Map<PerformanceEvent, string>();
  const events: PerformanceEvent[] = [];
  const positions: PlaybackPosition[] = [];
  const openTies = new Map<string, PerformanceEvent>();
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
    for (let i = 1; i < boundaries.length; i++) {
      const bpm = tempoAt(points, offset + boundaries[i - 1] + EPS) * tempoScale;
      times.push(times[i - 1] + (boundaries[i] - boundaries[i - 1]) * 60 / bpm);
    }
    const baseAt = (beat: number) => {
      const limited = Math.max(from, Math.min(horizon, beat));
      let segment = boundaries.length - 2;
      for (let i = 0; i < boundaries.length - 1; i++) if (limited < boundaries[i + 1] - EPS) { segment = i; break; }
      return elapsed + times[segment] + (limited - boundaries[segment]) * 60 / (tempoAt(points, offset + boundaries[segment] + EPS) * tempoScale);
    };
    const secondsPerBeat = (beat: number) => 60 / (tempoAt(points, offset + beat + EPS) * tempoScale);
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
    for (const part of score.parts) {
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
          end = Math.max(start + .03, end);
        } else {
          const opening = note.start <= EPS ? (graceGroups.get(`${voice}:${note.start.toFixed(6)}`)?.length || 0) : 0;
          start = secondsAt(note.start) + (opening ? opening * graceBeat(opening) * secondsPerBeat(0) : 0);
          end = secondsAt(release(note.start + note.duration));
        }
        const mark = markFor(note);
        if (mark?.silent) continue;
        note.pitches.forEach((pitch: Pitch & { sourceId?: string }, pitchIndex) => {
          const midi = soundingMidi(part, measure, pitch, options.semitones || 0);
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
          if (pitch.tieStop && !old) diagnostics.push(`Unmatched tie stop at ${note.id}, pitch ${pitchIndex}.`);
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
  applySustainPedal(events, eventSource, performedPedals, elapsed);
  if (options.verovioTimemap !== undefined) {
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
      for (const event of events) {
        if (checked.has(event.pitchId)) continue;
        checked.add(event.pitchId);
        const qstamp = firstOnset.get(event.pitchId);
        if (qstamp !== undefined && Math.abs(qstamp - event.scoreBeat) > .01) diagnostics.push(`Verovio/source onset differs for ${event.pitchId}.`);
      }
    }
  }
  let durationSeconds = elapsed;
  for (const event of events) durationSeconds = Math.max(durationSeconds, event.endSeconds, event.soundEndSeconds);
  return { events, positions, durationSeconds, initialBpm, diagnostics: [...new Set(diagnostics)], roadmap };
}

/**
 * The damper pedal scopes a whole source part (every staff). A note released
 * while the pedal is down keeps sounding until the next lift; a change is a lift
 * and re-depress at the same instant, so notes released before it end there.
 * Only soundEndSeconds moves; written ends and highlighting are untouched.
 */
function applySustainPedal(events: PerformanceEvent[], eventSource: Map<PerformanceEvent, string>, performed: Map<string, { seconds: number; kind: PedalChange['kind'] }[]>, pieceEnd: number) {
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
  for (const event of events) {
    const sourceId = eventSource.get(event);
    if (sourceId === undefined) continue;
    const key = `${sourceId}:${event.midi}`;
    byKey.set(key, [...(byKey.get(key) || []), event]);
    const span = spans.get(sourceId)?.find(item => item.down < event.endSeconds - EPS && event.endSeconds < item.up - EPS);
    if (span) event.soundEndSeconds = span.up;
  }
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
  let current = timeline.positions[0] || { seconds: 0, scoreBeat: 0, measureIndex: 0, occurrence: 0, measureBeat: 0, noteId: null, activeNoteIds: [] };
  for (const position of timeline.positions) { if (position.seconds > clamped + EPS) break; current = position; }
  const next = timeline.positions[timeline.positions.indexOf(current) + 1];
  const ratio = next && next.seconds > current.seconds && next.measureIndex === current.measureIndex && next.occurrence === current.occurrence ? (clamped - current.seconds) / (next.seconds - current.seconds) : 0;
  const scoreBeat = current.scoreBeat + ratio * (next ? next.scoreBeat - current.scoreBeat : 0);
  const sounding = timeline.events.filter(event => event.startSeconds <= clamped + EPS && event.endSeconds > clamped + EPS);
  const latest = [...timeline.events].reverse().find(event => event.startSeconds <= clamped + EPS && event.measureIndex === current.measureIndex && event.occurrence === current.occurrence);
  const activeNoteIds = [...new Set(sounding.flatMap(event => event.visualSegments.filter(segment => segment.startSeconds <= clamped + EPS && segment.endSeconds > clamped + EPS).map(segment => segment.noteId)))];
  return { ...current, seconds: clamped, scoreBeat, measureBeat: current.measureBeat + scoreBeat - current.scoreBeat, noteId: activeNoteIds[0] || latest?.noteId || null, activeNoteIds };
}

/** Active event tails are clipped to the seek time so pause/resume sustains correctly. */
export function eventsFromSeconds(timeline: PerformanceTimeline, seconds: number): PerformanceEvent[] {
  return timeline.events.filter(event => event.soundEndSeconds > seconds + EPS).map(event => event.startSeconds < seconds ? { ...event, startSeconds: seconds, endSeconds: Math.max(seconds, event.endSeconds) } : event);
}
