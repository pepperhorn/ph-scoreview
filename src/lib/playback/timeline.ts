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
export type TimelineOptions = {
  bpm: number; semitones?: number; musicXml?: string; verovioTimemap?: unknown;
  /**
   * The complete, unfiltered score when `score` is a view with hidden parts.
   * Tempo changes, fermata holds and sibling-staff dynamics are read from it so
   * hiding a part never changes the performance of the parts that remain.
   */
  fullScore?: Score;
};

type Marker = { forward?: boolean; backward?: number; ending?: number[]; dacapo?: boolean; dalsegno?: boolean; tocoda?: boolean; fine?: boolean; segno?: boolean; coda?: boolean };
type Visit = { measureIndex: number; occurrence: number };
const EPS = 1e-7;
/** Extra hold added by a fermata, as a fraction of the held note's length. */
const FERMATA_HOLD = .5;
/** Grace notes steal at most this many beats from the beat they ornament. */
const GRACE_BEATS = .125, GRACE_TOTAL = .25;
const dynamics: Record<string, number> = { pppp: 20, ppp: 28, pp: 39, p: 52, mp: 66, mf: 82, f: 96, ff: 108, fff: 118, ffff: 124, sf: 112, sfz: 112, fz: 112, fp: 96, sforzando: 112 };
const NAVIGATION = ['dacapo', 'dalsegno', 'tocoda', 'fine', 'segno', 'coda'];

function xmlChildren(el: Element, name: string): Element[] { return Array.from(el.children).filter(item => item.localName === name); }
function first(el: Element, name: string): Element | undefined { return xmlChildren(el, name)[0]; }
function numbers(value: string | null): number[] {
  return (value || '').split(/[\s,]+/).flatMap(token => {
    const range = /^(\d+)-(\d+)$/.exec(token);
    if (range) return Array.from({ length: Math.min(16, Number(range[2]) - Number(range[1]) + 1) }, (_, i) => Number(range[1]) + i);
    const number = Number(token); return Number.isInteger(number) && number > 0 ? [number] : [];
  });
}

/**
 * MusicXML navigation is read from the source, never inferred from SVG.
 * Explicit <sound> attributes are authoritative; when a measure has none,
 * <segno/>/<coda/> glyphs and anchored words ("D.S. al Coda", "To Coda", "Fine")
 * are used. Words are anchored so "both hands" or "Winds" never trigger D.S.
 */
function sourceMarkers(xml: string | undefined, measureCount: number, diagnostics: string[]): Marker[] {
  const markers = Array.from({ length: measureCount }, () => ({} as Marker));
  if (!xml || typeof DOMParser === 'undefined') return markers;
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) { diagnostics.push('MusicXML navigation could not be parsed.'); return markers; }
  const root = doc.documentElement;
  const sourceMeasures = root.localName === 'score-timewise'
    ? xmlChildren(root, 'measure').map(measure => first(measure, 'part') || measure)
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
    const directions = xmlChildren(measure, 'direction');
    const sounds = [...xmlChildren(measure, 'sound'), ...directions.flatMap(direction => xmlChildren(direction, 'sound'))];
    const explicit = sounds.some(sound => NAVIGATION.some(name => sound.hasAttribute(name)));
    for (const sound of sounds) {
      if (sound.getAttribute('dacapo') === 'yes') marker.dacapo = true;
      if (sound.hasAttribute('dalsegno')) marker.dalsegno = true;
      if (sound.hasAttribute('tocoda')) marker.tocoda = true;
      if (sound.hasAttribute('fine') && sound.getAttribute('fine') !== 'no') marker.fine = true;
      if (sound.hasAttribute('segno')) marker.segno = true;
      if (sound.hasAttribute('coda')) marker.coda = true;
    }
    let codaGlyph = false;
    if (!explicit) for (const direction of directions) {
      const types = xmlChildren(direction, 'direction-type');
      const words = types.flatMap(type => xmlChildren(type, 'words')).map(item => (item.textContent || '').trim()).filter(Boolean).join(' ').trim();
      const segnoGlyph = types.some(type => first(type, 'segno'));
      const hasCodaGlyph = types.some(type => first(type, 'coda'));
      if (/^(?:D\.\s*C\.?|Da\s+Capo)(?![a-z])/i.test(words)) marker.dacapo = true;
      else if (/^(?:D\.\s*S\.?|Dal\s+Segno)(?![a-z])/i.test(words)) marker.dalsegno = true;
      else if (/^to\s*(?:the\s+)?(?:coda|\u{1D10C})/iu.test(words) || (hasCodaGlyph && /^to$/i.test(words))) marker.tocoda = true;
      else if (/^fine\.?$/i.test(words)) marker.fine = true;
      else if (/^(?:\u{1D10C}\s*)?coda\.?$/iu.test(words) || words === '\u{1D10C}' || (hasCodaGlyph && !words)) codaGlyph = true;
      if (segnoGlyph || /^(?:\u{1D10B}\s*)?segno$/iu.test(words) || words === '\u{1D10B}') marker.segno = true;
    }
    // A coda glyph printed beside "To Coda" marks the jump, not its target.
    if (codaGlyph && !marker.tocoda) marker.coda = true;
    for (const barline of xmlChildren(measure, 'barline')) {
      const end = first(barline, 'ending');
      if (end && ['stop', 'discontinue'].includes(end.getAttribute('type') || '') && barline.getAttribute('location') !== 'left') ending = [];
    }
  });
  return markers;
}

/** The highest ending number of each consecutive group of volta brackets. */
function lastEndings(markers: Marker[]): number[] {
  const result = markers.map(() => 0);
  for (let i = 0; i < markers.length;) {
    if (!markers[i].ending) { i++; continue; }
    let j = i, max = 0;
    while (j < markers.length && markers[j].ending && (j === i || !(markers[j].ending!.includes(1) && !markers[j - 1].ending!.includes(1)))) { max = Math.max(max, ...markers[j].ending!); j++; }
    for (let k = i; k < j; k++) result[k] = max;
    i = j;
  }
  return result;
}

function traverse(markers: Marker[], diagnostics: string[]): Visit[] {
  const visits: Visit[] = [];
  const count = markers.length;
  let index = 0, trailingPass = 1, jumped = false, codaJumped = false;
  const repeatStack: { start: number; pass: number }[] = [];
  let steps = 0;
  const limit = Math.max(64, count * 16);
  const segno = markers.findIndex(marker => marker.segno);
  const finalEnding = lastEndings(markers);
  const occurrences = new Map<number, number>();
  while (index >= 0 && index < count && steps++ < limit) {
    const marker = markers[index];
    if (!marker.ending && index > 0 && markers[index - 1].ending) trailingPass = 1;
    if (!jumped && marker.forward && !repeatStack.some(repeat => repeat.start === index)) repeatStack.push({ start: index, pass: 1 });
    const pass = repeatStack.at(-1)?.pass || trailingPass;
    // After D.C./D.S. repeats are not taken, so only the final ending plays.
    const endingSkipped = Boolean(marker.ending?.length && !marker.ending.includes(jumped ? finalEnding[index] : pass));
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
    if (!endingSkipped && !jumped && (marker.dacapo || marker.dalsegno)) {
      jumped = true; trailingPass = 1; repeatStack.length = 0;
      if (marker.dalsegno && segno < 0) diagnostics.push('D.S. has no segno; restarted from the beginning.');
      index = marker.dalsegno && segno >= 0 ? segno : 0;
      continue;
    }
    if (!endingSkipped && jumped && marker.tocoda && !codaJumped) {
      const after = markers.findIndex((item, i) => item.coda && i > index);
      const target = after >= 0 ? after : markers.findIndex(item => item.coda);
      if (target >= 0) { codaJumped = true; index = target; continue; }
      diagnostics.push('To Coda has no coda; playback continued.');
    }
    if (!endingSkipped && jumped && marker.fine) break;
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
  if (Array.from(doc.getElementsByTagName('*')).some(el => el.localName === 'pedal')) diagnostics.push('Pedal marks are engraved but pedal sustain is not synthesized.');
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
  const count = score.parts[0]?.measures.length || 0;
  const offsets = scoreOffsets(score);
  const points = tempoPoints(full, offsets, diagnostics);
  const initialBpm = tempoAt(points, 0);
  const requestedBpm = Number.isFinite(options.bpm) && options.bpm > 0 ? options.bpm : initialBpm;
  const tempoScale = requestedBpm / initialBpm;
  const xml = options.musicXml || documentXml(score) || documentXml(full);
  const marks = sourceNoteMarks(xml, diagnostics);
  const markFor = (note: { sourceId?: string; pitches: (Pitch & { sourceId?: string })[] }) => [note.sourceId, ...note.pitches.map(p => p.sourceId)].map(id => id ? marks.get(id) : undefined).find((item): item is NoteMark => Boolean(item));
  const dynamicGroups = dynamicPoints(full, offsets);
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
    const times = [0];
    for (let i = 1; i < boundaries.length; i++) {
      const bpm = tempoAt(points, offset + boundaries[i - 1] + EPS) * tempoScale;
      times.push(times[i - 1] + (boundaries[i] - boundaries[i - 1]) * 60 / bpm);
    }
    const baseAt = (beat: number) => {
      const limited = Math.max(0, Math.min(length, beat));
      let segment = boundaries.length - 2;
      for (let i = 0; i < boundaries.length - 1; i++) if (limited < boundaries[i + 1] - EPS) { segment = i; break; }
      return elapsed + times[segment] + (limited - boundaries[segment]) * 60 / (tempoAt(points, offset + boundaries[segment] + EPS) * tempoScale);
    };
    const secondsPerBeat = (beat: number) => 60 / (tempoAt(points, offset + beat + EPS) * tempoScale);
    // Fermatas hold the music: time is inserted where the shortest held note of
    // each fermata onset ends, so later notes wait instead of overlapping.
    const fermataStarts = new Map<string, { start: number; duration: number }>();
    for (const part of full.parts) for (const note of part.measures[measureIndex]?.notes || []) {
      if (note.grace || note.duration <= 0 || !markFor(note)?.fermata) continue;
      const key = note.start.toFixed(6);
      const old = fermataStarts.get(key);
      if (!old || note.duration < old.duration) fermataStarts.set(key, { start: note.start, duration: note.duration });
    }
    const holdMap = new Map<string, { beat: number; seconds: number }>();
    for (const { start, duration } of fermataStarts.values()) {
      const beat = Math.min(length, start + duration);
      const seconds = (baseAt(beat) - baseAt(start)) * FERMATA_HOLD;
      const key = beat.toFixed(6);
      holdMap.set(key, { beat, seconds: Math.max(seconds, holdMap.get(key)?.seconds || 0) });
    }
    const holds = [...holdMap.values()].sort((a, b) => a.beat - b.beat);
    const heldBefore = (beat: number, inclusive: boolean) => holds.reduce((sum, hold) => sum + (hold.beat < beat - EPS || (inclusive && hold.beat <= beat + EPS) ? hold.seconds : 0), 0);
    const secondsAt = (beat: number) => baseAt(beat) + heldBefore(beat, true);

    const jumpedHere = previousMeasure >= 0 && measureIndex !== previousMeasure + 1;
    // Ties survive a repeat/D.S. jump only if the target note stops the tie.
    const carried = jumpedHere ? new Map(openTies) : undefined;
    const positionBeats = [...new Set([...boundaries, ...holds.map(hold => hold.beat)].map(beat => beat.toFixed(9)))].map(Number).sort((a, b) => a - b);
    for (const beat of positionBeats) {
      const base = { scoreBeat: offset + beat, measureIndex, occurrence: visit.occurrence, measureBeat: beat, noteId: null, activeNoteIds: [] };
      if (holds.some(hold => Math.abs(hold.beat - beat) < 1e-6)) positions.push({ ...base, seconds: baseAt(beat) + heldBefore(beat, false) });
      positions.push({ ...base, seconds: secondsAt(beat) });
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
      for (const note of measure.notes) {
        if (note.rest || !note.pitches.length) continue;
        if (note.duration <= 0 && !note.grace) continue;
        const voice = note.voice || '1';
        let start: number, end: number;
        if (note.grace) {
          const group = graceGroups.get(`${voice}:${note.start.toFixed(6)}`) || [note.id];
          const n = group.length, i = Math.max(0, group.indexOf(note.id));
          const step = graceBeat(n) * secondsPerBeat(note.start);
          const principal = secondsAt(note.start);
          // Graces on the downbeat delay their principal; others steal from the previous beat.
          if (note.start <= EPS) { start = principal + i * step; end = principal + (i + 1) * step; }
          else { start = Math.max(baseAt(0), principal - (n - i) * step); end = principal - (n - i - 1) * step; }
          end = Math.max(start + .03, end);
        } else {
          const opening = note.start <= EPS ? (graceGroups.get(`${voice}:${note.start.toFixed(6)}`)?.length || 0) : 0;
          start = secondsAt(note.start) + (opening ? opening * graceBeat(opening) * secondsPerBeat(0) : 0);
          end = secondsAt(note.start + note.duration);
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
            id: `${note.id}:${pitchIndex}:${visit.occurrence}`, noteId: note.id,
            pitchId: pitch.sourceId || `${note.id}:${pitchIndex}`, pitchIndex, partId: part.id, voice,
            measureIndex, occurrence: visit.occurrence, scoreBeat: offset + note.start,
            endScoreBeat: offset + note.start + note.duration, startSeconds: start, endSeconds: soundingEnd,
            midi, velocity: Math.max(1, Math.min(127, velocityFor(dynamicList, part.id, offset + note.start, voice) + (pitchMark?.velocityDelta || 0))), visualNoteIds: [note.id],
            visualSegments: [{ noteId: note.id, startSeconds: start, endSeconds: soundingEnd }],
          };
          events.push(event);
          if (pitch.tieStart) openTies.set(tieKey, event);
        });
      }
    }
    if (carried) for (const [key, event] of carried) if (openTies.get(key) === event) openTies.delete(key);
    elapsed = secondsAt(length);
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
  let durationSeconds = elapsed;
  for (const event of events) if (event.endSeconds > durationSeconds) durationSeconds = event.endSeconds;
  return { events, positions, durationSeconds, initialBpm, diagnostics: [...new Set(diagnostics)] };
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
