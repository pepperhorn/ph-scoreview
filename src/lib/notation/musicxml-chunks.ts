/**
 * Measure-range slices of a partwise MusicXML engraving text, for chunked engraving of long scores
 * (docs/specs/large-score-performance.md, Phase 3). Verovio's MusicXML import grows super-linearly with the measure
 * count and its WASM heap is capped at 2 GiB, so a long score is engraved as small documents of a few systems each,
 * cut from the source text instead of importing the whole score.
 *
 * `indexMusicXml` scans the text once (string level, no DOM; it runs in the Verovio worker) for the offsets of every
 * part's measures, their `<attributes>` blocks, lyric density and the measures each span (slur, wedge, octave shift,
 * pedal, bracket, dashes, tuplet, glissando, slide, ending, beam) starts and stops in. `sliceMusicXml` builds a valid
 * score of a measure range from it:
 * - the header (identification, defaults, part-list) is kept; credits only in a slice that starts at the first measure;
 * - each part's prevailing attributes before the range (divisions, key, time, staves, part symbol, instruments, clefs,
 *   staff details, transposition) are carried into its first measure; the carried time signature is not printed;
 * - every measure gets a stable ID (`measureId(index)`), so the engraving maps 1:1 to the Score in every slice.
 *
 * `planChunk` chooses the measure range of the document that engraves a system: whole systems of `bars` measures,
 * plus overlap measures before and after (enough for the spans that cross the chunk's edges, capped), which are laid
 * out on their own pages and not drawn. A span crossing a chunk edge is therefore engraved as Verovio engraves it at a
 * system break in the whole score.
 */

export type SpanReach = { start: number; end: number };
type PartIndex = {
  /** The `<part ...>` start tag. */
  open: string;
  /** Start and end offsets of each measure (end exclusive), two numbers per measure. */
  measures: number[];
  /** Raw `<attributes>` blocks by measure index, in order. */
  attributes: { measure: number; block: string }[];
};
export type ChunkIndex = {
  text: string;
  /** Text before the first part (declaration, header, part-list). */
  head: string;
  /** Text after the last part (the root end tag). */
  tail: string;
  parts: PartIndex[];
  /** Measures in the first part (the Score's measure count). */
  measureCount: number;
  /** Most lyric syllables per lyric line in any one part-measure (the MEI baseline's lyric density, per part). */
  lyricDensity: number;
  /** Spans that end in a later measure than they start in, by start measure. */
  spans: SpanReach[];
};

/** The engraving ID of the measure at a zero-based Score index, in every slice. */
export const measureId = (index: number) => `reader-m${index + 1}`;

const ATTRIBUTE_VALUE = `(?:[^>"']|"[^"]*"|'[^']*')*`;
/**
 * Tokens the index needs. Comments, CDATA and processing instructions are matched first so their contents are skipped.
 * Element names are unprefixed: a namespace-prefixed MusicXML file does not index (and is engraved whole).
 */
const TOKEN = new RegExp(`<!--[\\s\\S]*?-->|<!\\[CDATA\\[[\\s\\S]*?\\]\\]>|<\\?[\\s\\S]*?\\?>|<(/?)(part|measure|attributes|lyric|slur|wedge|octave-shift|pedal|bracket|dashes|tuplet|glissando|slide|ending|beam)(?=[\\s/>])(${ATTRIBUTE_VALUE})>`, 'g');
const attributePatterns = new Map<string, RegExp>();
function attribute(attributes: string, name: string): string | undefined {
  if (!attributes.includes(name)) return undefined;
  let pattern = attributePatterns.get(name);
  if (!pattern) attributePatterns.set(name, pattern = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`));
  const match = pattern.exec(attributes);
  return match ? match[1] ?? match[2] : undefined;
}
/** Span element types that open or close a span. */
const OPENS = new Set(['start', 'up', 'down', 'crescendo', 'diminuendo']);

/** Index a partwise MusicXML text, or return undefined when it is not one this module can slice. */
export function indexMusicXml(text: string): ChunkIndex | undefined {
  const root = /<score-partwise[\s>]/.exec(text);
  const partList = text.indexOf('</part-list>');
  if (!root || partList < 0) return undefined;
  const parts: PartIndex[] = [];
  const spans: SpanReach[] = [];
  const open = new Map<string, number>();
  let head = '';
  let part: PartIndex | undefined;
  let measureStart = -1;
  let measure = -1;
  let lyrics = 0; let lines = new Set<string>(); let lyricDensity = 0;
  let partEnd = -1;
  TOKEN.lastIndex = partList;
  for (let match = TOKEN.exec(text); match; match = TOKEN.exec(text)) {
    const name = match[2];
    if (!name) continue;
    const closing = match[1] === '/';
    const attributes = match[3] || '';
    const selfClosing = attributes.endsWith('/');
    if (name === 'part') {
      if (closing) {
        if (!part || measureStart >= 0) return undefined;
        part = undefined; partEnd = match.index + match[0].length;
      } else {
        if (part || selfClosing) return undefined;
        if (!parts.length) head = text.slice(0, match.index);
        part = { open: match[0], measures: [], attributes: [] };
        parts.push(part); measure = -1;
      }
      continue;
    }
    if (!part) continue;
    if (name === 'measure') {
      if (closing) {
        if (measureStart < 0) return undefined;
        part.measures.push(measureStart, match.index + match[0].length);
        measureStart = -1;
        if (lyrics) lyricDensity = Math.max(lyricDensity, Math.ceil(lyrics / Math.max(1, lines.size)));
      } else {
        if (measureStart >= 0) return undefined;
        measure++;
        lyrics = 0; lines = new Set();
        if (selfClosing) part.measures.push(match.index, match.index + match[0].length);
        else measureStart = match.index;
      }
      continue;
    }
    if (measureStart < 0 || closing) continue;
    if (name === 'attributes') {
      if (selfClosing) continue;
      const end = text.indexOf('</attributes>', match.index);
      if (end < 0) return undefined;
      const blockEnd = end + '</attributes>'.length;
      part.attributes.push({ measure, block: text.slice(match.index, blockEnd) });
      TOKEN.lastIndex = blockEnd;
      continue;
    }
    if (name === 'lyric') { lyrics++; lines.add(attribute(attributes, 'number') || '1'); continue; }
    let kind: 'open' | 'close' | undefined;
    if (name === 'beam') {
      const value = /^\s*(begin|end)\b/.exec(text.slice(TOKEN.lastIndex, TOKEN.lastIndex + 16))?.[1];
      kind = value === 'begin' ? 'open' : value === 'end' ? 'close' : undefined;
    } else {
      const type = attribute(attributes, 'type') || '';
      kind = OPENS.has(type) ? 'open' : type === 'stop' || (name === 'ending' && type === 'discontinue') ? 'close' : undefined;
    }
    if (!kind) continue;
    const key = `${parts.length}:${name}:${name === 'ending' ? '' : attribute(attributes, 'number') || '1'}`;
    if (kind === 'open') open.set(key, measure);
    else {
      const start = open.get(key);
      if (start !== undefined) { open.delete(key); if (measure > start) spans.push({ start, end: measure }); }
    }
  }
  if (!parts.length || part || measureStart >= 0) return undefined;
  const measureCount = parts[0].measures.length / 2;
  if (!measureCount) return undefined;
  spans.sort((a, b) => a.start - b.start);
  return { text, head, tail: text.slice(partEnd), parts, measureCount, lyricDensity, spans };
}

/** Attribute children kept when carrying a part's state into a slice, in MusicXML schema order. */
const CARRIED = ['divisions', 'key', 'time', 'staves', 'part-symbol', 'instruments', 'clef', 'staff-details', 'transpose', 'for-part'];
const CHILD = new RegExp(`<(${CARRIED.join('|')})(?=[\\s/>])(${ATTRIBUTE_VALUE})>`, 'g');

/** A part's prevailing attributes at the start of `measure`, as one `<attributes>` block (empty when there are none). */
function carriedAttributes(part: PartIndex, measure: number): string {
  const state = new Map<string, string>();
  for (const { measure: at, block } of part.attributes) {
    if (at >= measure) break;
    CHILD.lastIndex = 0;
    for (let match = CHILD.exec(block); match; match = CHILD.exec(block)) {
      const [tag, name, attributes] = match;
      let element = tag;
      if (!attributes.endsWith('/')) {
        const close = block.indexOf(`</${name}>`, CHILD.lastIndex);
        if (close < 0) continue;
        element = block.slice(match.index, close + name.length + 3);
        CHILD.lastIndex = close + name.length + 3;
      }
      const number = attribute(attributes, 'number');
      // An element without a staff number applies to every staff: it replaces any per-staff ones.
      if (number === undefined) for (const key of [...state.keys()]) if (key.startsWith(`${name}#`)) state.delete(key);
      state.set(`${name}#${number ?? ''}`, element);
    }
  }
  if (!state.size) return '';
  const children: string[] = [];
  for (const name of CARRIED) for (const [key, element] of state) {
    if (!key.startsWith(`${name}#`)) continue;
    // The meter in force is carried for timing only: a new system does not reprint it (a real change still does).
    children.push(name === 'time' ? element.replace(/^<time\b((?:[^>"']|"[^"]*"|'[^']*')*)/, (_, rest: string) => `<time print-object="no"${rest.replace(/\sprint-object\s*=\s*(?:"[^"]*"|'[^']*')/, '')}`) : element);
  }
  return `<attributes>${children.join('')}</attributes>`;
}

/** A measure's text with its stable ID, and (first measure of a slice) the carried attributes. */
function measureText(index: ChunkIndex, part: PartIndex, measure: number, carried: string): string {
  const start = part.measures[measure * 2], end = part.measures[measure * 2 + 1];
  const text = index.text.slice(start, end);
  const tagEnd = /^<measure\b(?:[^>"']|"[^"]*"|'[^']*')*>/.exec(text)![0].length;
  let tag = text.slice(0, tagEnd);
  const id = ` id="${measureId(measure)}"`;
  tag = /\sid\s*=\s*(?:"[^"]*"|'[^']*')/.test(tag) ? tag.replace(/\sid\s*=\s*(?:"[^"]*"|'[^']*')/, id) : tag.replace(/\s*(\/?)>$/, `${id}$1>`);
  if (tag.endsWith('/>')) return carried ? `${tag.slice(0, -2)}>${carried}</measure>` : tag;
  return tag + carried + text.slice(tagEnd);
}

/** A complete partwise score of measures `[from, to)` (zero-based Score indices). */
export function sliceMusicXml(index: ChunkIndex, from: number, to: number): string {
  const out: string[] = [from > 0 ? index.head.replace(/<credit\b[\s\S]*?<\/credit>/g, '') : index.head];
  for (const part of index.parts) {
    out.push(part.open);
    const last = Math.min(to, part.measures.length / 2);
    for (let measure = from; measure < last; measure++) out.push(measureText(index, part, measure, measure === from && from > 0 ? carriedAttributes(part, from) : ''));
    out.push('</part>');
  }
  out.push(index.tail);
  return out.join('');
}

/** Overlap measures are capped: a span reaching further across a chunk edge is drawn open at that edge. */
export const MAX_OVERLAP_MEASURES = 16;
/** Measures before `boundary` that the spans crossing it start in (at least one, so ties from the previous measure end). */
export function leadFor(index: ChunkIndex, boundary: number): number {
  let earliest = boundary - 1;
  for (const span of index.spans) {
    if (span.start >= boundary) break;
    if (span.end >= boundary) earliest = Math.min(earliest, span.start);
  }
  return Math.max(0, Math.min(boundary, MAX_OVERLAP_MEASURES, boundary - earliest));
}
/** Measures from `boundary` on that the spans crossing it end in (at least one, so ties into the next measure end). */
export function tailFor(index: ChunkIndex, boundary: number): number {
  let farthest = boundary;
  for (const span of index.spans) {
    if (span.start >= boundary) break;
    if (span.end >= boundary) farthest = Math.max(farthest, span.end);
  }
  return Math.max(0, Math.min(index.measureCount - boundary, MAX_OVERLAP_MEASURES, farthest - boundary + 1));
}

export type ChunkPlan = {
  /** The document's measure range `[from, to)`. */
  from: number; to: number;
  /** The systems (zero-based, global) it engraves for display: `[firstSystem, endSystem)`. */
  firstSystem: number; endSystem: number;
  /** Page of the document (one-based) that holds `firstSystem`; later systems follow one page each. */
  firstPage: number;
};

/**
 * The document that engraves `system` when systems have `bars` measures (0: one system of the whole score) and a chunk
 * holds about `budget` staff-measures of `staves` staves. Page breaks fall on every multiple of `bars` (global measure
 * index), so overlap measures before and after the chunk's systems are laid out on pages of their own.
 */
export function planChunk(index: ChunkIndex, system: number, bars: number, staves: number, budget: number): ChunkPlan {
  const total = index.measureCount;
  if (bars <= 0) return { from: 0, to: total, firstSystem: 0, endSystem: 1, firstPage: 1 };
  const systems = Math.ceil(total / bars);
  const perChunk = Math.max(1, Math.floor(budget / Math.max(1, staves * bars)));
  const chunk = Math.floor(Math.max(0, Math.min(systems - 1, system)) / perChunk);
  const firstSystem = chunk * perChunk, endSystem = Math.min(systems, firstSystem + perChunk);
  const coreFrom = firstSystem * bars, coreTo = Math.min(total, endSystem * bars);
  const lead = leadFor(index, coreFrom), tail = coreTo < total ? tailFor(index, coreTo) : 0;
  const from = coreFrom - lead;
  // Pages before the core: the lead measures split at multiples of `bars` (the first one may be partial).
  const firstPage = lead ? Math.ceil(coreFrom / bars) - Math.floor(from / bars) + 1 : 1;
  return { from, to: coreTo + tail, firstSystem, endSystem, firstPage };
}
