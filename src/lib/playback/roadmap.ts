import type { MeasureNavigation, Score } from '../score';
import { addFraction, compareFraction, formatFraction, fractionValue, fromNumber, parseFraction, ZERO, type Fraction } from './fraction';

/**
 * A position in the written score: a measure index (not its printed number)
 * and an exact rational quarter-note offset from that measure's start.
 */
export type RoadmapPos = { bar: number; beat: string };
/** One linear stretch of the written score, played from `from` up to (not including) `to`. */
export type RoadmapSegment = { from: RoadmapPos; to: RoadmapPos; ending?: number; pass?: number };
/** The performed order of the written score. JSON-serializable, so a user or saved override can replace it. */
export type Roadmap = { version: 1; segments: RoadmapSegment[] };

/** Caps for user-supplied roadmaps, so a malformed override cannot run away. */
export const ROADMAP_MAX_SEGMENTS = 2048;
const ROADMAP_MAX_REPLAY = 64;

/** A span of one measure between navigation points; repeat barlines inside a bar split it. */
type Unit = {
  bar: number; from: Fraction; to: Fraction;
  repeatStart?: boolean; repeatEnd?: number; repeatInferred?: boolean; endings?: number[];
  segno?: boolean; coda?: boolean; toCoda?: boolean; daCapo?: boolean; dalSegno?: boolean; fine?: boolean;
};

export function measureLengths(score: Score): Fraction[] {
  return (score.parts[0]?.measures || []).map(measure => {
    const beats = Number.isFinite(measure.beats) && measure.beats > 0 ? measure.beats : measure.notes.reduce((max, note) => Math.max(max, note.start + note.duration), 0);
    return fromNumber(Math.max(0, beats));
  });
}

function units(navigation: (MeasureNavigation | undefined)[], lengths: Fraction[], diagnostics: string[]): Unit[] {
  const result: Unit[] = [];
  lengths.forEach((length, bar) => {
    const nav = navigation[bar] || {};
    const cuts = new Map<string, { at: Fraction; start?: boolean; end?: number; inferred?: boolean }>();
    for (const barline of nav.barlines || []) {
      const at = parseFraction(barline.beat);
      if (!at || compareFraction(at, ZERO) < 0 || compareFraction(at, length) > 0) { diagnostics.push(`A repeat barline at beat ${barline.beat} lies outside measure ${bar + 1}; it was ignored.`); continue; }
      const key = formatFraction(at);
      const cut = cuts.get(key) || { at };
      if (barline.repeatStart) cut.start = true;
      if (barline.repeatEnd) { cut.end = barline.repeatTimes || 2; cut.inferred = !barline.repeatTimes; }
      cuts.set(key, cut);
    }
    const inner = [...cuts.values()].filter(cut => compareFraction(cut.at, ZERO) > 0 && compareFraction(cut.at, length) < 0).sort((a, b) => compareFraction(a.at, b.at));
    const atStart = cuts.get('0'), atEnd = cuts.get(formatFraction(length));
    const points = [ZERO, ...inner.map(cut => cut.at), length];
    const first = result.length;
    for (let i = 0; i < points.length - 1; i++) {
      const unit: Unit = { bar, from: points[i], to: points[i + 1] };
      if (nav.endings?.length) unit.endings = [...nav.endings];
      if (i > 0 && inner[i - 1].start) unit.repeatStart = true;
      if (i < inner.length && inner[i].end) { unit.repeatEnd = inner[i].end; unit.repeatInferred = inner[i].inferred; }
      result.push(unit);
    }
    const head = result[first], tail = result[result.length - 1];
    if (nav.repeatStart || atStart?.start) head.repeatStart = true;
    if (nav.repeatEnd) { tail.repeatEnd = Math.max(2, Math.min(16, nav.repeatTimes || 2)); tail.repeatInferred = !nav.repeatTimes; }
    else if (atEnd?.end) { tail.repeatEnd = atEnd.end; tail.repeatInferred = atEnd.inferred; }
    if (nav.segno) head.segno = true;
    if (nav.coda) head.coda = true;
    for (const key of ['toCoda', 'daCapo', 'dalSegno', 'fine'] as const) if (nav[key]) tail[key] = true;
  });
  return result;
}

/** The highest ending number of each consecutive group of volta brackets. */
function lastEndings(list: Unit[]): number[] {
  const result = list.map(() => 0);
  for (let i = 0; i < list.length;) {
    if (!list[i].endings) { i++; continue; }
    let j = i, max = 0;
    while (j < list.length && list[j].endings && (j === i || list[j].bar === list[j - 1].bar || !(list[j].endings!.includes(1) && !list[j - 1].endings!.includes(1)))) { max = Math.max(max, ...list[j].endings!); j++; }
    for (let k = i; k < j; k++) result[k] = max;
    i = j;
  }
  return result;
}

type Visit = { unit: number; pass: number; ending?: number };
/**
 * Expands written navigation into the performed order: repeats (with times),
 * 1st/2nd/nth endings, segno, coda, To Coda, D.C., D.S. and Fine. After a
 * D.C./D.S. repeats are not taken and only the last ending of each group plays.
 */
function traverse(list: Unit[], diagnostics: string[]): Visit[] {
  const visits: Visit[] = [];
  const count = list.length;
  let index = 0, trailingPass = 1, jumped = false, codaJumped = false;
  const repeatStack: { start: number; pass: number }[] = [];
  let steps = 0;
  const limit = Math.max(64, count * 16);
  const segno = list.findIndex(unit => unit.segno);
  const finalEnding = lastEndings(list);
  while (index >= 0 && index < count && steps++ < limit) {
    const unit = list[index];
    if (!unit.endings && index > 0 && list[index - 1].endings) trailingPass = 1;
    if (!jumped && unit.repeatStart && !repeatStack.some(repeat => repeat.start === index)) repeatStack.push({ start: index, pass: 1 });
    const pass = repeatStack.at(-1)?.pass || trailingPass;
    const taken = jumped ? finalEnding[index] : pass;
    const endingSkipped = Boolean(unit.endings?.length && !unit.endings.includes(taken));
    if (!endingSkipped) visits.push({ unit: index, pass: jumped ? 1 : pass, ending: unit.endings?.length ? taken : undefined });
    if (!jumped && unit.repeatEnd) {
      if (!repeatStack.length) repeatStack.push({ start: 0, pass: 1 });
      const repeat = repeatStack.at(-1)!;
      // An unnumbered repeat that closes an ending repeats until the group's last ending.
      const times = unit.repeatInferred && unit.endings?.length ? Math.max(unit.repeatEnd, Math.min(16, finalEnding[index])) : unit.repeatEnd;
      if (!endingSkipped && repeat.pass < times) { repeat.pass++; index = repeat.start; continue; }
      trailingPass = repeat.pass;
      repeatStack.pop();
    }
    if (!endingSkipped && !jumped && (unit.daCapo || unit.dalSegno)) {
      jumped = true; trailingPass = 1; repeatStack.length = 0;
      if (unit.dalSegno && segno < 0) diagnostics.push('D.S. has no segno; restarted from the beginning.');
      index = unit.dalSegno && segno >= 0 ? segno : 0;
      continue;
    }
    if (!endingSkipped && jumped && unit.toCoda && !codaJumped) {
      const after = list.findIndex((item, i) => item.coda && i > index);
      const target = after >= 0 ? after : list.findIndex(item => item.coda);
      if (target >= 0) { codaJumped = true; index = target; continue; }
      diagnostics.push('To Coda has no coda; playback continued.');
    }
    if (!endingSkipped && jumped && unit.fine) break;
    index++;
  }
  if (steps >= limit) diagnostics.push('Playback navigation exceeded its safety limit; the score was truncated.');
  return visits;
}

const pos = (bar: number, beat: Fraction): RoadmapPos => ({ bar, beat: formatFraction(beat) });

/** Builds the roadmap from per-measure navigation and exact measure lengths. */
export function roadmapFromNavigation(navigation: (MeasureNavigation | undefined)[], lengths: Fraction[], diagnostics: string[] = []): Roadmap {
  const list = units(navigation, lengths, diagnostics);
  const segments: RoadmapSegment[] = [];
  let previous = -2;
  for (const visit of traverse(list, diagnostics)) {
    const unit = list[visit.unit];
    const last = segments.at(-1);
    if (last && visit.unit === previous + 1) {
      last.to = pos(unit.bar, unit.to);
      if (visit.ending !== undefined && last.ending === undefined) last.ending = visit.ending;
    } else {
      const segment: RoadmapSegment = { from: pos(unit.bar, unit.from), to: pos(unit.bar, unit.to) };
      if (visit.ending !== undefined) segment.ending = visit.ending;
      if (visit.pass > 1) segment.pass = visit.pass;
      segments.push(segment);
    }
    previous = visit.unit;
  }
  return { version: 1, segments };
}

/** The performed roadmap of a score, from the first part's format-neutral navigation. */
export function buildRoadmap(score: Score, diagnostics: string[] = []): Roadmap {
  return roadmapFromNavigation((score.parts[0]?.measures || []).map(measure => measure.navigation), measureLengths(score), diagnostics);
}

export type ResolvedSegment = { from: { bar: number; beat: Fraction }; to: { bar: number; beat: Fraction } };
/**
 * Checks a (possibly user-supplied) roadmap against the score: positions must
 * lie inside their measures, each segment must run forwards, and the total
 * length is capped. Returns undefined, with a diagnostic, when it is unusable.
 */
export function resolveRoadmap(roadmap: unknown, lengths: Fraction[], diagnostics: string[]): ResolvedSegment[] | undefined {
  const fail = (message: string) => { diagnostics.push(`Roadmap override ignored: ${message}`); return undefined; };
  if (!roadmap || typeof roadmap !== 'object') return fail('not an object.');
  const { version, segments } = roadmap as Partial<Roadmap>;
  if (version !== 1) return fail('unsupported version.');
  if (!Array.isArray(segments)) return fail('segments must be an array.');
  if (segments.length > ROADMAP_MAX_SEGMENTS) return fail(`more than ${ROADMAP_MAX_SEGMENTS} segments.`);
  const starts: Fraction[] = [];
  let total = ZERO;
  lengths.forEach(length => { starts.push(total); total = addFraction(total, length); });
  const absolute = (value: unknown, label: string): { bar: number; beat: Fraction; at: Fraction } | string => {
    if (!value || typeof value !== 'object') return `${label} is not a position.`;
    const { bar, beat } = value as Partial<RoadmapPos>;
    if (!Number.isInteger(bar) || bar! < 0 || bar! >= lengths.length) return `${label} bar ${String(bar)} is out of range.`;
    const offset = parseFraction(beat);
    if (!offset) return `${label} beat ${String(beat)} is not a rational number.`;
    if (compareFraction(offset, ZERO) < 0 || compareFraction(offset, lengths[bar!]) > 0) return `${label} beat ${beat} lies outside measure ${bar! + 1}.`;
    return { bar: bar!, beat: offset, at: addFraction(starts[bar!], offset) };
  };
  const resolved: ResolvedSegment[] = [];
  let performed = 0;
  for (const [i, segment] of segments.entries()) {
    const from = absolute((segment as RoadmapSegment)?.from, `segment ${i + 1} start`);
    const to = absolute((segment as RoadmapSegment)?.to, `segment ${i + 1} end`);
    if (typeof from === 'string') return fail(from);
    if (typeof to === 'string') return fail(to);
    if (compareFraction(from.at, to.at) >= 0) return fail(`segment ${i + 1} does not run forwards.`);
    performed += fractionValue(to.at) - fractionValue(from.at);
    if (performed > ROADMAP_MAX_REPLAY * Math.max(1, fractionValue(total))) return fail('the performed length exceeds the safety limit.');
    resolved.push({ from: { bar: from.bar, beat: from.beat }, to: { bar: to.bar, beat: to.beat } });
  }
  return resolved;
}

