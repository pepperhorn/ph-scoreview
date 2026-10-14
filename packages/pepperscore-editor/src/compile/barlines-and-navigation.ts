import { BASE_TICKS, TICKS_PER_QUARTER } from '../model/durations';
import type { Document, GlobalMeasure } from '../model/schema';
import { el, leaf } from './xml';

/** Global-measure barlines and navigation (repeats, endings, segno/coda, jumps, tempo, rehearsal marks) as MusicXML. */

const BAR_STYLE: Record<NonNullable<GlobalMeasure['barline']>, string | undefined> = {
  regular: undefined, double: 'light-light', final: 'light-heavy', dashed: 'dashed', invisible: 'none',
};
const JUMP_WORDS = {
  dc: { fine: 'D.C. al Fine', coda: 'D.C. al Coda', end: 'D.C.' },
  ds: { fine: 'D.S. al Fine', coda: 'D.S. al Coda', end: 'D.S.' },
} as const;

/** An ending spans consecutive bars with identical numbers. */
function sameEnding(a: GlobalMeasure['ending'], b: GlobalMeasure['ending']): boolean {
  return a !== undefined && b !== undefined && a.numbers.join(',') === b.numbers.join(',');
}

export function writeLeftBarline(doc: Document, index: number): string | undefined {
  const g = doc.global.measures[index];
  const endingStart = g.ending !== undefined && !sameEnding(doc.global.measures[index - 1]?.ending, g.ending);
  if (!g.repeatStart && !endingStart) return undefined;
  return el('barline', { location: 'left' }, [
    g.repeatStart && leaf('bar-style', 'heavy-light'),
    endingStart && leaf('ending', undefined, { number: g.ending!.numbers.join(','), type: 'start' }),
    g.repeatStart && leaf('repeat', undefined, { direction: 'forward' }),
  ]);
}

export function writeRightBarline(doc: Document, index: number): string | undefined {
  const g = doc.global.measures[index];
  const endingStop = g.ending !== undefined && !sameEnding(g.ending, doc.global.measures[index + 1]?.ending);
  const style = g.repeatEnd ? 'light-heavy' : BAR_STYLE[g.barline ?? 'regular'];
  if (!style && !endingStop && !g.repeatEnd) return undefined;
  return el('barline', { location: 'right' }, [
    style && leaf('bar-style', style),
    endingStop && leaf('ending', undefined, { number: g.ending!.numbers.join(','), type: g.ending!.open ? 'discontinue' : 'stop' }),
    g.repeatEnd && leaf('repeat', undefined, { direction: 'backward', times: g.repeatEnd.times }),
  ]);
}

function navDirection(types: string[], sound?: Record<string, string | number>): string {
  return el('direction', { placement: 'above' }, [
    ...types.map((type) => el('direction-type', undefined, [type])),
    sound && leaf('sound', undefined, sound),
  ]);
}

/** Index of the first measure flagged `key` after `index`, else the first anywhere. */
function nextMark(doc: Document, index: number, key: 'coda'): number {
  const measures = doc.global.measures;
  const after = measures.findIndex((m, i) => i > index && m[key]);
  return after >= 0 ? after : measures.findIndex((m) => m[key]);
}

/** Index of the last segno at or before `index`, else the first anywhere. */
function previousSegno(doc: Document, index: number): number {
  const measures = doc.global.measures;
  for (let i = index; i >= 0; i--) if (measures[i].segno) return i;
  return measures.findIndex((m) => m.segno);
}

/**
 * Global directions of measure `index`: at the bar start rehearsal mark, segno,
 * coda and tempo; at the bar end To Coda, Fine and D.C./D.S. jumps. Sound
 * values name marks by measure index (`segno0`, `coda5`).
 */
export function writeNavigation(doc: Document, index: number, at: 'start' | 'end'): string[] {
  const g = doc.global.measures[index];
  const out: string[] = [];
  if (at === 'start') {
    if (g.rehearsal !== undefined) out.push(navDirection([leaf('rehearsal', g.rehearsal)]));
    if (g.segno) out.push(navDirection([leaf('segno')], { segno: `segno${index}` }));
    if (g.coda) out.push(navDirection([leaf('coda')], { coda: `coda${index}` }));
    if (g.tempo) {
      const quarterBpm = Number(((g.tempo.bpm * BASE_TICKS[g.tempo.unit]) / TICKS_PER_QUARTER).toFixed(3));
      out.push(navDirection([
        ...(g.tempo.text !== undefined ? [leaf('words', g.tempo.text, { 'font-weight': 'bold' })] : []),
        el('metronome', undefined, [leaf('beat-unit', g.tempo.unit), leaf('per-minute', g.tempo.bpm)]),
      ], { tempo: quarterBpm }));
    }
    return out;
  }
  if (g.toCoda) {
    const coda = nextMark(doc, index, 'coda');
    out.push(navDirection([leaf('words', 'To Coda')], coda >= 0 ? { tocoda: `coda${coda}` } : undefined));
  }
  if (g.fine) out.push(navDirection([leaf('words', 'Fine')], { fine: 'yes' }));
  if (g.jump) {
    const words = leaf('words', JUMP_WORDS[g.jump.type][g.jump.target]);
    const segno = previousSegno(doc, index);
    const sound: Record<string, string> | undefined = g.jump.type === 'dc' ? { dacapo: 'yes' } : segno >= 0 ? { dalsegno: `segno${segno}` } : undefined;
    out.push(navDirection([words], sound));
  }
  return out;
}
