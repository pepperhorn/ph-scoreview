import type { BarlineNavigation, MeasureNavigation, Score } from '../score';
import { formatFraction, fraction, fromNumber } from '../playback/fraction';

/**
 * Source-format readers for written navigation (repeats, endings, segno/coda,
 * D.C./D.S., Fine). Every importer fills Measure.navigation with these, and the
 * playback roadmap is built from that one format-neutral shape.
 */
export type NavigationWord = 'daCapo' | 'dalSegno' | 'toCoda' | 'fine' | 'coda' | 'segno';

const xmlChildren = (el: Element, name: string) => Array.from(el.children).filter(item => item.localName === name);
const first = (el: Element, name: string) => xmlChildren(el, name)[0];

/** Volta numbers: "1", "1, 2", "1,3", "1-2", "1." */
export function endingNumbers(value: string | null | undefined): number[] {
  const result = (value || '').replace(/[^\d,\-\s]/g, ' ').split(/[\s,]+/).flatMap(token => {
    const range = /^(\d+)-(\d+)$/.exec(token);
    if (range) return Array.from({ length: Math.max(0, Math.min(16, Number(range[2]) - Number(range[1]) + 1)) }, (_, i) => Number(range[1]) + i);
    const number = Number(token); return Number.isInteger(number) && number > 0 ? [number] : [];
  });
  return [...new Set(result)];
}

/**
 * Navigation meaning of a text direction. Anchored at the start so "both hands"
 * or "Winds" never trigger D.S. and "Coda" inside other words is ignored.
 * ABC decoration names ("D.C.alfine", "D.S.alcoda") use the same spelling.
 */
export function navigationWord(text: string): NavigationWord | undefined {
  const words = text.trim();
  if (/^(?:D\.\s*C\.?|Da\s+Capo)(?![a-z])/i.test(words)) return 'daCapo';
  if (/^(?:D\.\s*S\.?|Dal\s+Segno)(?![a-z])/i.test(words)) return 'dalSegno';
  if (/^to\s*(?:the\s+)?(?:coda|\u{1D10C})/iu.test(words)) return 'toCoda';
  if (/^fine\.?$/i.test(words)) return 'fine';
  if (/^(?:\u{1D10C}\s*)?coda\.?$/iu.test(words) || words === '\u{1D10C}') return 'coda';
  if (/^(?:\u{1D10B}\s*)?segno$/iu.test(words) || words === '\u{1D10B}') return 'segno';
  return undefined;
}

export const isEmptyNavigation = (nav: MeasureNavigation | undefined) => !nav || Object.keys(nav).length === 0;

/** Copies each measure's navigation onto every part, so hiding any part keeps it. */
export function attachNavigation(score: Score, navigation: MeasureNavigation[]) {
  for (const part of score.parts) part.measures.forEach((measure, index) => {
    const nav = navigation[index];
    if (isEmptyNavigation(nav)) delete measure.navigation;
    else measure.navigation = JSON.parse(JSON.stringify(nav));
  });
}

/**
 * Formats that print one coda sign both at the jump ("To Coda") and at the
 * coda itself (MEI repeatMark, ABC !coda!): a sign before the first D.C./D.S.
 * is the jump when another sign follows the D.C./D.S.
 */
export function resolveCodaSigns(navigation: MeasureNavigation[]) {
  const jump = navigation.findIndex(nav => nav.daCapo || nav.dalSegno);
  if (jump < 0 || !navigation.slice(jump + 1).some(nav => nav.coda)) return;
  navigation.forEach((nav, i) => { if (i < jump && nav.coda) { delete nav.coda; nav.toCoda = true; } });
}

/**
 * MusicXML navigation is read from the source, never inferred from SVG.
 * Explicit <sound> attributes are authoritative; when a measure has none,
 * <segno/>/<coda/> glyphs and anchored words ("D.S. al Coda", "To Coda", "Fine")
 * are used. Repeat barlines with location="middle" keep their exact offset.
 */
export function musicXmlNavigation(root: Element, measureCount: number, diagnostics: string[]): MeasureNavigation[] {
  const navigation = Array.from({ length: measureCount }, () => ({} as MeasureNavigation));
  const sourceMeasures = root.localName === 'score-timewise'
    ? xmlChildren(root, 'measure').map(measure => first(measure, 'part') || measure)
    : xmlChildren(first(root, 'part') || root, 'measure');
  const SOUND = ['dacapo', 'dalsegno', 'tocoda', 'fine', 'segno', 'coda'];
  let ending: number[] = [];
  let divisions = 1;
  sourceMeasures.slice(0, measureCount).forEach((measure, i) => {
    const nav = navigation[i];
    // Offsets of middle barlines, in divisions; exact as long as durations are integers.
    let cursor = 0;
    const barlines: BarlineNavigation[] = [];
    for (const item of Array.from(measure.children)) {
      const name = item.localName;
      const duration = Number(first(item, 'duration')?.textContent) || 0;
      if (name === 'attributes') { const d = Number(first(item, 'divisions')?.textContent); if (d > 0) divisions = d; }
      else if (name === 'note') { if (first(item, 'chord')) continue; if (!first(item, 'grace')) cursor += duration; }
      else if (name === 'backup') cursor = Math.max(0, cursor - duration);
      else if (name === 'forward') cursor += duration;
      else if (name === 'barline' && item.getAttribute('location') === 'middle') {
        const repeat = first(item, 'repeat');
        if (!repeat) continue;
        const at = Number.isInteger(cursor) ? fraction(cursor, divisions) : fromNumber(cursor / divisions);
        const beat = formatFraction(at);
        const barline: BarlineNavigation = barlines.find(entry => entry.beat === beat) || { beat };
        if (!barlines.includes(barline)) barlines.push(barline);
        if (repeat.getAttribute('direction') === 'forward') barline.repeatStart = true;
        else if (repeat.getAttribute('direction') === 'backward') { barline.repeatEnd = true; const times = Number(repeat.getAttribute('times')); if (times > 0) barline.repeatTimes = Math.max(2, Math.min(16, times)); }
        if (first(item, 'ending')) diagnostics.push('An ending on a middle barline is not supported; it was ignored.');
      }
    }
    if (barlines.length) nav.barlines = barlines;
    for (const barline of xmlChildren(measure, 'barline')) {
      if (barline.getAttribute('location') === 'middle') continue;
      const end = first(barline, 'ending');
      if (end?.getAttribute('type') === 'start') ending = endingNumbers(end.getAttribute('number'));
      if (end?.getAttribute('type') === 'stop' && barline.getAttribute('location') === 'left') ending = [];
      const repeat = first(barline, 'repeat');
      if (repeat?.getAttribute('direction') === 'forward') nav.repeatStart = true;
      if (repeat?.getAttribute('direction') === 'backward') {
        nav.repeatEnd = true;
        const times = Number(repeat.getAttribute('times'));
        if (times > 0) nav.repeatTimes = Math.max(2, Math.min(16, times));
      }
    }
    if (ending.length) nav.endings = [...ending];
    const directions = xmlChildren(measure, 'direction');
    const sounds = [...xmlChildren(measure, 'sound'), ...directions.flatMap(direction => xmlChildren(direction, 'sound'))];
    const explicit = sounds.some(sound => SOUND.some(name => sound.hasAttribute(name)));
    for (const sound of sounds) {
      if (sound.getAttribute('dacapo') === 'yes') nav.daCapo = true;
      if (sound.hasAttribute('dalsegno')) nav.dalSegno = true;
      if (sound.hasAttribute('tocoda')) nav.toCoda = true;
      if (sound.hasAttribute('fine') && sound.getAttribute('fine') !== 'no') nav.fine = true;
      if (sound.hasAttribute('segno')) nav.segno = true;
      if (sound.hasAttribute('coda')) nav.coda = true;
    }
    let codaGlyph = false;
    if (!explicit) for (const direction of directions) {
      const types = xmlChildren(direction, 'direction-type');
      const words = types.flatMap(type => xmlChildren(type, 'words')).map(item => (item.textContent || '').trim()).filter(Boolean).join(' ').trim();
      const segnoGlyph = types.some(type => first(type, 'segno'));
      const hasCodaGlyph = types.some(type => first(type, 'coda'));
      const word = navigationWord(words);
      if (word === 'daCapo') nav.daCapo = true;
      else if (word === 'dalSegno') nav.dalSegno = true;
      else if (word === 'toCoda' || (hasCodaGlyph && /^to$/i.test(words))) nav.toCoda = true;
      else if (word === 'fine') nav.fine = true;
      else if (word === 'coda' || (hasCodaGlyph && !words)) codaGlyph = true;
      if (segnoGlyph || word === 'segno') nav.segno = true;
    }
    // A coda glyph printed beside "To Coda" marks the jump, not its target.
    if (codaGlyph && !nav.toCoda) nav.coda = true;
    for (const barline of xmlChildren(measure, 'barline')) {
      const end = first(barline, 'ending');
      if (end && ['stop', 'discontinue'].includes(end.getAttribute('type') || '') && barline.getAttribute('location') !== 'left') ending = [];
    }
  });
  return navigation;
}

/** Parses MusicXML text for navigation (used when a caller supplies XML instead of a Score). */
export function musicXmlTextNavigation(xml: string, measureCount: number, diagnostics: string[]): MeasureNavigation[] {
  if (typeof DOMParser === 'undefined') return Array.from({ length: measureCount }, () => ({}));
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) { diagnostics.push('MusicXML navigation could not be parsed.'); return Array.from({ length: measureCount }, () => ({})); }
  return musicXmlNavigation(doc.documentElement, measureCount, diagnostics);
}

/**
 * MEI: measure @left/@right repeat barlines, <ending n> containers,
 * <repeatMark func> and anchored <dir> words. `barlines` are mid-measure
 * <barLine form> offsets found while walking the first layer.
 */
export function meiNavigation(measures: Element[], barlines: Map<number, BarlineNavigation[]>): MeasureNavigation[] {
  const navigation = measures.map(() => ({} as MeasureNavigation));
  const FUNC: Record<string, NavigationWord> = { segno: 'segno', coda: 'coda', fine: 'fine', dacapo: 'daCapo', dalsegno: 'dalSegno' };
  measures.forEach((measure, i) => {
    const nav = navigation[i];
    const left = measure.getAttribute('left'), right = measure.getAttribute('right');
    if (left === 'rptstart' || left === 'rptboth') nav.repeatStart = true;
    if ((left === 'rptend' || left === 'rptboth') && i > 0) navigation[i - 1].repeatEnd = true;
    if (right === 'rptend' || right === 'rptboth') nav.repeatEnd = true;
    if (right === 'rptboth' && i + 1 < navigation.length) navigation[i + 1].repeatStart = true;
    let ancestor = measure.parentElement;
    while (ancestor && ancestor.localName !== 'ending' && ancestor.localName !== 'score') ancestor = ancestor.parentElement;
    if (ancestor?.localName === 'ending') {
      const numbers = endingNumbers(ancestor.getAttribute('n') || ancestor.getAttribute('label'));
      if (numbers.length) nav.endings = numbers;
    }
    const marks = Array.from(measure.children);
    for (const mark of marks) {
      if (mark.localName === 'repeatMark') {
        const text = (mark.textContent || '').trim();
        const word = FUNC[(mark.getAttribute('func') || '').toLowerCase()] || navigationWord(text);
        if (word === 'coda' && navigationWord(text) === 'toCoda') nav.toCoda = true;
        else if (word) nav[word] = true;
      } else if (mark.localName === 'dir') {
        const word = navigationWord(mark.textContent || '');
        if (word) nav[word] = true;
      }
    }
    const inside = barlines.get(i);
    if (inside?.length) nav.barlines = inside;
  });
  resolveCodaSigns(navigation);
  return navigation;
}

/** abcjs decoration names that carry navigation. */
export function abcDecorationWord(decoration: string): NavigationWord | undefined {
  const name = decoration.trim();
  if (name === 'segno') return 'segno';
  if (name === 'coda') return 'coda';
  if (name === 'fine') return 'fine';
  return /^D\.[CS]\./.test(name) ? navigationWord(name) : undefined;
}
