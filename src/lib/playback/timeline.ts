import type { Part, Pitch, Score, ScoreDirection } from '../score';
import { soundingMidi } from '../transpose';

/** A sounding pitch. Repeated visits to a written note have separate occurrences. */
export type PerformanceEvent = {
  id: string; noteId: string; pitchId: string; pitchIndex: number;
  partId: string; voice: string; measureIndex: number; occurrence: number;
  scoreBeat: number; endScoreBeat: number; startSeconds: number; endSeconds: number;
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
};
export type TimelineOptions = { bpm: number; semitones?: number; musicXml?: string; verovioTimemap?: unknown };

type Marker = { forward?: boolean; backward?: number; ending?: number[]; dacapo?: boolean; dalsegno?: boolean; tocoda?: boolean; fine?: boolean; segno?: boolean; coda?: boolean };
type Visit = { measureIndex: number; occurrence: number };
const EPS = 1e-7;
const dynamics: Record<string, number> = { pppp: 20, ppp: 28, pp: 39, p: 52, mp: 66, mf: 82, f: 96, ff: 108, fff: 118, ffff: 124, sf: 112, sfz: 112, fz: 112, fp: 96, sforzando: 112 };

function xmlChildren(el: Element, name: string): Element[] { return Array.from(el.children).filter(item => item.localName === name); }
function first(el: Element, name: string): Element | undefined { return xmlChildren(el, name)[0]; }
function numbers(value: string | null): number[] {
  return (value || '').split(/[\s,]+/).flatMap(token => {
    const range = /^(\d+)-(\d+)$/.exec(token);
    if (range) return Array.from({ length: Math.min(16, Number(range[2]) - Number(range[1]) + 1) }, (_, i) => Number(range[1]) + i);
    const number = Number(token); return Number.isInteger(number) && number > 0 ? [number] : [];
  });
}

/** MusicXML navigation is read from the original source, never inferred from SVG. */
function sourceMarkers(xml: string | undefined, measureCount: number, diagnostics: string[]): Marker[] {
  const markers = Array.from({ length: measureCount }, () => ({} as Marker));
  if (!xml || typeof DOMParser === 'undefined') return markers;
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) { diagnostics.push('MusicXML navigation could not be parsed.'); return markers; }
  const root = doc.documentElement;
  const sourceMeasures = root.localName === 'score-timewise'
    ? xmlChildren(root, 'measure')
    : xmlChildren(first(root, 'part') || root, 'measure');
  let ending: number[] = [];
  sourceMeasures.slice(0, measureCount).forEach((measure, i) => {
    const marker = markers[i];
    for (const barline of xmlChildren(measure, 'barline')) {
      const end = first(barline, 'ending');
      if (end?.getAttribute('type') === 'start') ending = numbers(end.getAttribute('number'));
      if (end?.getAttribute('type') === 'stop' && barline.getAttribute('location') === 'left') ending = [];
      const repeat = first(barline, 'repeat');
      if (repeat?.getAttribute('direction') === 'forward') marker.forward = true;
      if (repeat?.getAttribute('direction') === 'backward') marker.backward = Math.max(2, Math.min(16, Number(repeat.getAttribute('times')) || 2));
    }
    marker.ending = ending.length ? [...ending] : undefined;
    for (const direction of xmlChildren(measure, 'direction')) {
      const sound = first(direction, 'sound');
      if (sound) {
        if (sound.getAttribute('dacapo') === 'yes') marker.dacapo = true;
        if (sound.hasAttribute('dalsegno')) marker.dalsegno = true;
        if (sound.hasAttribute('tocoda')) marker.tocoda = true;
        if (sound.getAttribute('fine') === 'yes') marker.fine = true;
        if (sound.hasAttribute('segno')) marker.segno = true;
        if (sound.hasAttribute('coda')) marker.coda = true;
      }
      const words = Array.from(direction.getElementsByTagName('*')).filter(item => item.localName === 'words').map(item => item.textContent || '').join(' ');
      if (/D\.?\s*C\.?\b/i.test(words)) marker.dacapo = true;
      if (/D\.?\s*S\.?\b/i.test(words)) marker.dalsegno = true;
      if (/\bto\s+coda\b/i.test(words)) marker.tocoda = true;
      if (/\bfine\b/i.test(words)) marker.fine = true;
      if (/\bsegno\b/i.test(words)) marker.segno = true;
      if (/\bcoda\b/i.test(words)) marker.coda = true;
    }
    for (const barline of xmlChildren(measure, 'barline')) {
      const end = first(barline, 'ending');
      if (end && ['stop', 'discontinue'].includes(end.getAttribute('type') || '') && barline.getAttribute('location') !== 'left') ending = [];
    }
  });
  return markers;
}

function traverse(markers: Marker[], diagnostics: string[]): Visit[] {
  const visits: Visit[] = [];
  const count = markers.length;
  let index = 0, trailingPass = 1, jumped = false, codaJumped = false;
  const repeatStack: { start: number; pass: number }[] = [];
  let steps = 0;
  const limit = Math.max(64, count * 16);
  const segno = markers.findIndex(marker => marker.segno);
  const coda = markers.findIndex(marker => marker.coda);
  const occurrences = new Map<number, number>();
  while (index >= 0 && index < count && steps++ < limit) {
    const marker = markers[index];
    if (!marker.ending && index > 0 && markers[index - 1].ending) trailingPass = 1;
    if (marker.forward && !repeatStack.some(repeat => repeat.start === index)) repeatStack.push({ start: index, pass: 1 });
    const pass = repeatStack.at(-1)?.pass || trailingPass;
    const endingSkipped = marker.ending?.length && !marker.ending.includes(pass) && !jumped;
    if (!endingSkipped) {
      const occurrence = occurrences.get(index) || 0;
      occurrences.set(index, occurrence + 1);
      visits.push({ measureIndex: index, occurrence });
    }
    if (!jumped && marker.backward) {
      if (!repeatStack.length) repeatStack.push({ start: 0, pass: 1 });
      const repeat = repeatStack.at(-1)!;
      if (!endingSkipped && repeat.pass < marker.backward) { repeat.pass++; index = repeat.start; continue; }
      trailingPass = repeat.pass;
      repeatStack.pop();
    }
    if (!jumped && (marker.dacapo || marker.dalsegno)) {
      jumped = true; trailingPass = 1; repeatStack.length = 0;
      if (marker.dalsegno && segno < 0) diagnostics.push('D.S. has no segno; restarted from the beginning.');
      index = marker.dalsegno && segno >= 0 ? segno : 0;
      continue;
    }
    if (jumped && marker.tocoda && !codaJumped && coda >= 0) { codaJumped = true; index = coda; continue; }
    if (jumped && marker.fine) break;
    index++;
  }
  if (steps >= limit) diagnostics.push('Playback navigation exceeded its safety limit; the score was truncated.');
  return visits;
}

function measureLength(score: Score, index: number): number {
  const measures = score.parts[0]?.measures;
  const measure = measures?.[index];
  if (!measure) return 0;
  return Number.isFinite(measure.beats) && measure.beats > 0 ? measure.beats : measure.notes.reduce((max, note) => Math.max(max, note.start + note.duration), 0);
}
function scoreOffsets(score: Score): number[] {
  let offset = 0;
  return (score.parts[0]?.measures || []).map((_, i) => { const here = offset; offset += measureLength(score, i); return here; });
}

type TempoPoint = { beat: number; bpm: number };
type Articulation = { durationScale: number; velocityDelta: number };
function sourceArticulations(xml: string | undefined, diagnostics: string[]): Map<string, Articulation> {
  const result = new Map<string, Articulation>();
  if (!xml || typeof DOMParser === 'undefined') return result;
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) return result;
  for (const note of Array.from(doc.getElementsByTagName('*')).filter(el => el.localName === 'note')) {
    const id = note.getAttribute('id');
    const notations = first(note, 'notations');
    if (!notations) continue;
    const art = first(notations, 'articulations');
    const names = art ? Array.from(art.children).map(el => el.localName) : [];
    let durationScale = 1, velocityDelta = 0;
    if (names.includes('staccatissimo')) durationScale = .25;
    else if (names.includes('staccato')) durationScale = .5;
    else if (names.includes('detached-legato')) durationScale = .75;
    else if (names.includes('tenuto')) durationScale = .96;
    if (names.includes('strong-accent')) velocityDelta = 18;
    else if (names.includes('accent')) velocityDelta = 12;
    if (first(notations, 'fermata')) durationScale *= 1.5;
    if (id && (durationScale !== 1 || velocityDelta)) result.set(id, { durationScale, velocityDelta });
    else if (!id && (durationScale !== 1 || velocityDelta)) diagnostics.push('Some articulations lack MusicXML note IDs and could not be mapped to sound.');
    if (first(notations, 'ornaments')) diagnostics.push('Ornaments are engraved but not synthesized.');
  }
  if (Array.from(doc.getElementsByTagName('*')).some(el => el.localName === 'pedal')) diagnostics.push('Pedal marks are engraved but pedal sustain is not synthesized.');
  return result;
}
function tempoPoints(score: Score, offsets: number[], diagnostics: string[]): TempoPoint[] {
  const byBeat = new Map<number, number>();
  for (const part of score.parts) for (const measure of part.measures) for (const direction of measure.directions || []) {
    if (direction.tempo && direction.tempo > 0) {
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

function directionVelocity(direction: ScoreDirection): number | undefined {
  if (direction.soundDynamics !== undefined && Number.isFinite(direction.soundDynamics)) return Math.max(1, Math.min(127, Math.round(direction.soundDynamics * 1.27)));
  for (const symbol of direction.symbols || []) if (dynamics[symbol] !== undefined) return dynamics[symbol];
  return undefined;
}
function velocityFor(part: Part, measureIndex: number, noteStart: number, voice: string, offsets: number[]): number {
  let value = 82;
  const targetBeat = offsets[measureIndex] + noteStart;
  const openWedges = new Map<string, { start: number; velocity: number; type: string }>();
  const completed: { start: number; end: number; velocity: number; type: string }[] = [];
  for (const measure of part.measures) {
    if (measure.index > measureIndex) break;
    for (const direction of measure.directions || []) {
      if (measure.index === measureIndex && direction.start > noteStart + EPS) continue;
      if (direction.voice && direction.voice !== voice) continue;
      if (direction.wedge) {
        const key = direction.wedge.number;
        const type = direction.wedge.type;
        const beat = offsets[measure.index] + direction.start;
        if (type === 'crescendo' || type === 'diminuendo') openWedges.set(key, { start: beat, velocity: value, type });
        else if (type === 'stop') {
          const open = openWedges.get(key);
          if (open) { completed.push({ ...open, end: beat }); openWedges.delete(key); }
        }
      }
      value = directionVelocity(direction) ?? value;
    }
    for (const direction of measure.dynamics || []) {
      if (measure.index === measureIndex && direction.start > noteStart + EPS) continue;
      value = dynamics[direction.symbol] ?? value;
    }
  }
  const wedge = [...completed, ...[...openWedges.values()].map(open => ({ ...open, end: targetBeat + 4 }))].find(span => span.start <= targetBeat && span.end > targetBeat);
  if (wedge) {
    const progress = Math.max(0, Math.min(1, (targetBeat - wedge.start) / Math.max(.01, wedge.end - wedge.start)));
    value = Math.round(wedge.velocity + (wedge.type === 'crescendo' ? 22 : -22) * progress);
  }
  return Math.max(1, Math.min(127, value));
}

function documentXml(score: Score): string | undefined {
  const document = (score as Score & { document?: { originalText?: string; engravingText?: string; format?: string } }).document;
  const xml = document?.originalText || document?.engravingText;
  return xml && /<\s*(?:\w+:)?score-(?:partwise|timewise)\b/.test(xml) ? xml : undefined;
}

/** Build one ordered performed timeline, with source tempo scaled by the displayed BPM. */
export function buildPerformanceTimeline(score: Score, options: TimelineOptions): PerformanceTimeline {
  const diagnostics: string[] = [];
  const count = score.parts[0]?.measures.length || 0;
  const offsets = scoreOffsets(score);
  const points = tempoPoints(score, offsets, diagnostics);
  const initialBpm = tempoAt(points, 0);
  const requestedBpm = Number.isFinite(options.bpm) && options.bpm > 0 ? options.bpm : initialBpm;
  const tempoScale = requestedBpm / initialBpm;
  const xml = options.musicXml || documentXml(score);
  const articulations = sourceArticulations(xml, diagnostics);
  const visits = traverse(sourceMarkers(xml, count, diagnostics), diagnostics);
  const events: PerformanceEvent[] = [];
  const positions: PlaybackPosition[] = [];
  const openTies = new Map<string, PerformanceEvent>();
  let elapsed = 0;
  let previousMeasure = -1;
  for (const visit of visits) {
    const measureIndex = visit.measureIndex;
    const length = measureLength(score, measureIndex);
    const offset = offsets[measureIndex];
    const localTempos = points.filter(point => point.beat > offset + EPS && point.beat < offset + length - EPS);
    const boundaries = [0, ...localTempos.map(point => point.beat - offset), length];
    const times = [elapsed];
    for (let i = 1; i < boundaries.length; i++) {
      const bpm = tempoAt(points, offset + boundaries[i - 1] + EPS) * tempoScale;
      times.push(times[i - 1] + (boundaries[i] - boundaries[i - 1]) * 60 / bpm);
    }
    const secondsAt = (beat: number) => {
      const limited = Math.max(0, Math.min(length, beat));
      let segment = boundaries.length - 2;
      for (let i = 0; i < boundaries.length - 1; i++) if (limited < boundaries[i + 1] - EPS) { segment = i; break; }
      return times[segment] + (limited - boundaries[segment]) * 60 / (tempoAt(points, offset + boundaries[segment] + EPS) * tempoScale);
    };
    if (previousMeasure >= 0 && measureIndex !== previousMeasure + 1) openTies.clear();
    boundaries.forEach((beat, i) => positions.push({ seconds: times[i], scoreBeat: offset + beat, measureIndex, occurrence: visit.occurrence, measureBeat: beat, noteId: null, activeNoteIds: [] }));
    for (const part of score.parts) {
      const measure = part.measures[measureIndex];
      if (!measure) continue;
      for (const note of measure.notes) {
        if (note.rest || !note.pitches.length) continue;
        if (note.duration <= 0 && !note.grace) continue;
        const voice = note.voice || '1';
        const hasOpeningGrace = !note.grace && note.start === 0 && measure.notes.some(other => other.grace && other.start === 0 && (other.voice || '1') === voice);
        const start = secondsAt(note.grace ? Math.max(0, note.start - .125) : note.start) + (hasOpeningGrace ? .125 * 60 / (tempoAt(points, offset) * tempoScale) : 0);
        const end = note.grace ? Math.max(start + .06, secondsAt(note.start) + (note.start === 0 ? .125 * 60 / (tempoAt(points, offset) * tempoScale) : 0)) : secondsAt(note.start + note.duration);
        note.pitches.forEach((pitch: Pitch & { sourceId?: string }, pitchIndex) => {
          const midi = soundingMidi(part, measure, pitch, options.semitones || 0);
          const mark = articulations.get(pitch.sourceId || '') || articulations.get((note as typeof note & { sourceId?: string }).sourceId || '');
          const soundingEnd = start + (end - start) * (mark?.durationScale ?? 1);
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
            id: `${note.id}:${pitchIndex}:${visit.occurrence}`, noteId: note.id,
            pitchId: pitch.sourceId || `${note.id}:${pitchIndex}`, pitchIndex, partId: part.id, voice,
            measureIndex, occurrence: visit.occurrence, scoreBeat: offset + note.start,
            endScoreBeat: offset + note.start + note.duration, startSeconds: start, endSeconds: soundingEnd,
            midi, velocity: Math.max(1, Math.min(127, velocityFor(part, measureIndex, note.start, voice, offsets) + (mark?.velocityDelta || 0))), visualNoteIds: [note.id],
            visualSegments: [{ noteId: note.id, startSeconds: start, endSeconds: soundingEnd }],
          };
          events.push(event);
          if (pitch.tieStart) openTies.set(tieKey, event);
        });
      }
    }
    elapsed = times.at(-1) || elapsed;
    previousMeasure = measureIndex;
  }
  events.sort((a, b) => a.startSeconds - b.startSeconds || a.partId.localeCompare(b.partId) || a.pitchIndex - b.pitchIndex);
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
  return { events, positions, durationSeconds: elapsed, initialBpm, diagnostics: [...new Set(diagnostics)] };
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
  return timeline.events.filter(event => event.endSeconds > seconds + EPS).map(event => event.startSeconds < seconds ? { ...event, startSeconds: seconds } : event);
}
