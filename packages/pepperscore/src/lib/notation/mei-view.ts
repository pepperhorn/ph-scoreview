/**
 * String-level reads and transforms of Verovio's MEI output, for the Verovio worker (which has no DOMParser).
 * One regex pass tokenizes tags; text between tags is copied untouched. The input is well-formed XML from
 * Verovio's own serializer (`getMEI`), so a tag never contains an unquoted `>` and there is no DTD.
 *
 * These mirror the DOM transforms the reader used before (see docs/specs/large-score-performance.md), so the
 * main thread never parses a full score's MEI: `scanBaseline` reads structure once per import and `buildViewMei`
 * makes the engraving view (breaks, hidden staves, chord symbols) inside the worker.
 */

import type { SpellingSpec } from './mei-spelling';
import type { TabSpec } from './mei-tab';

/** A start tag, end tag or self-closing tag; comments, processing instructions, CDATA and DOCTYPE match without a name. */
const TAG = /<(?:!--[\s\S]*?--|\?[\s\S]*?\?|!\[CDATA\[[\s\S]*?\]\]|!DOCTYPE[^>]*|(\/?)([A-Za-z_][\w.:-]*)((?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'))?)*)\s*(\/?))>/g;

const attributePatterns = new Map<string, RegExp>();
function attributePattern(name: string): RegExp {
  let pattern = attributePatterns.get(name);
  if (!pattern) {
    pattern = new RegExp(`\\s${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`);
    attributePatterns.set(name, pattern);
  }
  return pattern;
}
/** An attribute's raw (still escaped) value from a tag's attribute text; IDs, numbers and staff lists need no unescaping. */
export function attributeOf(attributes: string, name: string): string | null {
  if (!attributes.includes(name)) return null;
  const match = attributePattern(name).exec(attributes);
  return match ? (match[1] ?? match[2] ?? '') : null;
}
function withoutAttribute(tag: string, name: string): string {
  return tag.replace(attributePattern(name), '');
}
function withAttribute(tag: string, name: string, value: string): string {
  return tag.replace(attributePattern(name), ` ${name}="${value}"`);
}
const localName = (name: string) => name.slice(name.indexOf(':') + 1);
const idOf = (attributes: string) => attributeOf(attributes, 'xml:id') || '';
const tokensOf = (value: string | null) => (value || '').split(/\s+/).filter(Boolean);
const reference = (token: string) => token.replace(/^#/, '');

export type Visitor = (tag: { closing: boolean; name: string; attributes: string; selfClosing: boolean; index: number; length: number }) => boolean | void;
/** Visit every element tag in order; returning `true` stops the scan. */
export function scan(text: string, visit: Visitor): void {
  TAG.lastIndex = 0;
  for (let match = TAG.exec(text); match; match = TAG.exec(text)) {
    if (!match[2]) continue;
    if (visit({ closing: match[1] === '/', name: localName(match[2]), attributes: match[3] || '', selfClosing: match[4] === '/', index: match.index, length: match[0].length })) return;
  }
}

export type StaffDefInfo = { n: string; id: string };
/** A `staffGrp` of the first score definition and its direct `staffDef` children, in order. */
export type StaffGroupInfo = { id: string; staves: StaffDefInfo[] };
export type BaselineInfo = {
  /** Every measure's `xml:id`, in document order (the Score's measure order). */
  measureIds: string[];
  /** Most lyric syllables in any one staff-measure (per verse line). */
  lyricDensity: number;
  /** Every `staffDef` of the first score definition, in document order. */
  staffDefs: StaffDefInfo[];
  groups: StaffGroupInfo[];
  /**
   * The score is engraved in chunks (a long MusicXML score, Phase 3): measure IDs are `musicxml-chunks` `measureId`s
   * and lyric density is read from the MusicXML. Absent for a whole-document baseline.
   */
  chunked?: boolean;
};

/** Structure the reader needs from an imported MEI baseline, in one pass. */
export function scanBaseline(mei: string): BaselineInfo {
  const measureIds: string[] = [];
  const staffDefs: StaffDefInfo[] = [];
  const groups: StaffGroupInfo[] = [];
  const stack: string[] = [];
  const groupStack: number[] = [];
  let scoreDefDepth = -1; let scoreDefDone = false;
  let inStaff = false; let verses = 0; let lines = new Set<string>(); let lyricDensity = 0;
  scan(mei, ({ closing, name, attributes, selfClosing }) => {
    if (closing) {
      stack.pop();
      if (name === 'staff' && inStaff) {
        inStaff = false;
        if (verses) lyricDensity = Math.max(lyricDensity, Math.ceil(verses / lines.size));
      } else if (scoreDefDepth >= 0) {
        if (name === 'staffGrp') groupStack.pop();
        if (name === 'scoreDef' && stack.length === scoreDefDepth) { scoreDefDepth = -1; scoreDefDone = true; }
      }
      return;
    }
    if (name === 'measure') measureIds.push(idOf(attributes));
    else if (name === 'staff' && !selfClosing) { inStaff = true; verses = 0; lines = new Set(); }
    else if (name === 'verse' && inStaff) { verses++; lines.add(attributeOf(attributes, 'n') || '1'); }
    else if (name === 'scoreDef' && !scoreDefDone && scoreDefDepth < 0) {
      if (selfClosing) scoreDefDone = true; else scoreDefDepth = stack.length;
    } else if (scoreDefDepth >= 0) {
      if (name === 'staffGrp') {
        groups.push({ id: idOf(attributes), staves: [] });
        if (!selfClosing) groupStack.push(groups.length - 1);
      } else if (name === 'staffDef') {
        const staff = { n: attributeOf(attributes, 'n') || '', id: idOf(attributes) };
        staffDefs.push(staff);
        if (stack.at(-1) === 'staffGrp' && groupStack.length) groups[groupStack.at(-1)!].staves.push(staff);
      }
    }
    if (!selfClosing) stack.push(name);
  });
  return { measureIds, lyricDensity, staffDefs, groups };
}

export type ViewSpec = {
  /** Insert a page break before every `breakEvery`-th measure (0: none). Existing sb/pb are always removed. */
  breakEvery: number;
  /** Staff numbers (`@n`) to remove, with their staff-bound control events and spans into removed content. */
  hiddenStaves: string[];
  /** Keep `<harm>` chord symbols. */
  chordSymbols: boolean;
  /** Chord symbol text size in percent (the reader's annotation size); omitted or 100 leaves `<harm>` as encoded. */
  harmSize?: number;
  /**
   * Transposition, key flip and spelling (mei-spelling.ts), applied to the baseline before the view is built. The
   * worker transposes with Verovio's `transpose` / `transposeToSoundingPitch` and respells; the view itself is then
   * loaded untransposed.
   */
  spelling?: SpellingSpec;
  /**
   * Guitar TAB staves to add after spelling (notation/mei-tab.ts), and staff-bound text to move onto them. Hidden
   * notation staves (TAB view) and unused imported TAB staves are in `hiddenStaves`.
   */
  tab?: TabSpec;
};

/** Elements the reader view never engraves: the header (React shows metadata), labels (staff controls show names) and encoded breaks. */
const ALWAYS_DROPPED = new Set(['meiHead', 'label', 'labelAbbr', 'sb', 'pb', 'pgHead', 'pgFoot']);

/** Pass 1 for hidden staves: IDs inside removed staves and staff-bound events, and the `staffGrp`s (by ordinal) left without a staffDef. */
function hiddenContent(mei: string, hidden: Set<string>): { removed: Set<string>; emptyGroups: Set<number> } {
  const removed = new Set<string>();
  const survivors: number[] = [];
  const openGroups: number[] = [];
  let skip = 0;
  scan(mei, ({ closing, name, attributes, selfClosing }) => {
    if (closing) {
      if (skip) skip--;
      else if (name === 'staffGrp') openGroups.pop();
      return;
    }
    const ordinal = name === 'staffGrp' ? survivors.push(0) - 1 : -1;
    if (skip) {
      const id = idOf(attributes); if (id) removed.add(id);
      if (!selfClosing) skip++;
      return;
    }
    let drop = (name === 'staffDef' || name === 'staff') && hidden.has(attributeOf(attributes, 'n') || '');
    if (!drop) {
      const staves = tokensOf(attributeOf(attributes, 'staff'));
      drop = staves.length > 0 && staves.every(token => hidden.has(token));
    }
    if (drop) {
      const id = idOf(attributes); if (id) removed.add(id);
      if (!selfClosing) skip = 1;
      return;
    }
    if (name === 'staffDef') for (const group of openGroups) survivors[group]++;
    if (ordinal >= 0 && !selfClosing) openGroups.push(ordinal);
  });
  return { removed, emptyGroups: new Set(survivors.flatMap((count, index) => count ? [] : [index])) };
}

/**
 * The reader's engraving view of a baseline: no header, labels or encoded breaks; a page break every `breakEvery`
 * measures; chord symbols only when shown; hidden staves pruned with everything that would dangle. With
 * `measureLimit`, the output stops after that many measures and closes the open elements, a small document for the
 * first system (spans into later measures are left dangling, as Verovio tolerates). `breakOffset` is the Score index
 * of the document's first measure (a chunk of a long score): breaks fall where they fall in the whole score.
 */
export function buildViewMei(mei: string, spec: ViewSpec, measureLimit = Infinity, breakOffset = 0): string {
  const hidden = new Set(spec.hiddenStaves);
  const { removed, emptyGroups } = hidden.size ? hiddenContent(mei, hidden) : { removed: new Set<string>(), emptyGroups: new Set<number>() };
  const refersToRemoved = (value: string | null) => removed.size > 0 && tokensOf(value).some(token => removed.has(reference(token)));
  const out: string[] = [];
  const open: string[] = [];
  let last = 0; let skip = 0; let groupOrdinal = 0; let measureIndex = 0; let measuresClosed = 0; let stoppedAt = -1;
  // Where in `out` the run of `<ending>`/`<section>` start tags right before the next measure begins: a page break
  // goes before them, so an ending that starts a line is drawn whole there and not continued from the line before.
  let wrapperStart = -1;
  const closeMeasure = () => ++measuresClosed >= measureLimit;
  // A sized chord symbol's text is wrapped in `<rend fontsize="N%">`, so Verovio sizes and spaces it. Harmonies holding
  // figured bass (`<fb>`, not allowed in `<rend>`) keep their size.
  const harmSize = spec.chordSymbols && spec.harmSize && spec.harmSize !== 100 ? Math.round(spec.harmSize) : 0;
  let harmWraps = 0;
  scan(mei, ({ closing, name, attributes, selfClosing, index, length }) => {
    if (!skip) out.push(mei.slice(last, index));
    last = index + length;
    const tag = mei.slice(index, index + length);
    if (closing) {
      if (skip) { skip--; return; }
      if (name === 'harm' && harmWraps && open.at(-1) === 'rend') { open.pop(); harmWraps--; out.push('</rend>'); }
      open.pop();
      wrapperStart = -1;
      out.push(tag);
      if (name === 'measure' && closeMeasure()) { stoppedAt = last; return true; }
      return;
    }
    const ordinal = name === 'staffGrp' ? groupOrdinal++ : -1;
    if (skip) {
      if (hidden.size) { const id = idOf(attributes); if (id) removed.add(id); }
      if (!selfClosing) skip++;
      return;
    }
    let drop = ALWAYS_DROPPED.has(name) || (name === 'harm' && !spec.chordSymbols);
    let rewritten = tag;
    if (!drop && hidden.size) {
      const staves = tokensOf(attributeOf(attributes, 'staff'));
      const kept = staves.filter(token => !hidden.has(token));
      drop = ((name === 'staffDef' || name === 'staff') && hidden.has(attributeOf(attributes, 'n') || ''))
        || (ordinal >= 0 && emptyGroups.has(ordinal))
        || (staves.length > 0 && !kept.length)
        || refersToRemoved(attributeOf(attributes, 'startid')) || refersToRemoved(attributeOf(attributes, 'endid'));
      if (!drop && kept.length !== staves.length) rewritten = withAttribute(rewritten, 'staff', kept.join(' '));
      const plist = attributeOf(attributes, 'plist');
      if (!drop && plist && refersToRemoved(plist)) {
        const remaining = tokensOf(plist).filter(token => !removed.has(reference(token)));
        if (remaining.length) rewritten = withAttribute(rewritten, 'plist', remaining.join(' ')); else drop = true;
      }
    }
    if (drop) {
      if (hidden.size) { const id = idOf(attributes); if (id) removed.add(id); }
      if (!selfClosing) skip = 1;
      return;
    }
    if (name === 'staffDef' || name === 'staffGrp') rewritten = withoutAttribute(withoutAttribute(rewritten, 'label'), 'label.abbr');
    if (name === 'measure') {
      if (spec.breakEvery > 0 && measureIndex > 0 && (measureIndex + breakOffset) % spec.breakEvery === 0) {
        if (wrapperStart >= 0) out.splice(wrapperStart, 0, '<pb/>'); else out.push('<pb/>');
      }
      measureIndex++;
    }
    if ((name === 'ending' || name === 'section') && !selfClosing) { if (wrapperStart < 0) wrapperStart = out.length; }
    else wrapperStart = -1;
    out.push(rewritten);
    if (!selfClosing) open.push(/^<([^\s/>]+)/.exec(tag)![1]);
    else if (name === 'measure' && closeMeasure()) { stoppedAt = last; return true; }
    if (harmSize && name === 'harm' && !selfClosing) {
      const end = mei.indexOf('</harm>', last);
      // Look for <fb only inside this <harm> (a bounded slice), not to the end of the document for every symbol.
      const figured = end >= 0 ? mei.slice(last, end).includes('<fb') : mei.includes('<fb', last);
      if (!figured) { out.push(`<rend fontsize="${harmSize}%">`); open.push('rend'); harmWraps++; }
    }
  });
  if (stoppedAt < 0) { out.push(mei.slice(last)); return out.join(''); }
  for (let index = open.length - 1; index >= 0; index--) out.push(`</${open[index]}>`);
  return out.join('');
}
