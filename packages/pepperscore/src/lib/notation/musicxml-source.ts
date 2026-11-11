import { normalizeOctaveClefs } from './musicxml-octave-clef';
import { gmProgramForNumber, gmProgramForVirtualName, instrumentForName, midiPitch, pitch, ucfirst, type MeasureNavigation, type Measure, type Part, type Score, type ScoreNote, type Transposition } from '../score';
import { attachNavigation, musicXmlNavigationReader } from './navigation';
import { resolveChoirNames } from '../tab/string-instruments';
import { linkTabParts } from '../tab/tab-parts';
import { localNameOf, scanXml, XmlElement, XmlError, XmlTreeBuilder, type XmlAttribute } from './xml-stream';
import type { NoteMark, PedalChange, PlaybackMarks } from '../playback/source-marks';

/**
 * Single-pass MusicXML reader (docs/specs/large-score-performance.md, Phase 2). One streaming pass over the source
 * text produces everything the reader needs, with no DOM, so it runs in a worker:
 *
 * - the Score model (identical to the former DOM importer's, enforced by validation/parser-diff.mjs),
 * - the engraving text: the source with stable note IDs and multi-measure rests expanded, made by splicing the
 *   original text (so it parses to the same document the former DOM edit + XMLSerializer produced),
 * - the source feature inventory, navigation marks, and the playback marks (articulations, fermatas, cue notes,
 *   pedals) the timeline reads.
 *
 * Only `<measure>` subtrees (and the small top-level header elements) are held as light trees, one at a time, so
 * memory stays bounded on very large scores. Timewise scores are first converted to partwise text.
 */

export type SourceDiagnostic = { feature: string; status: 'retained' | 'partial' | 'unsupported'; location: string; message: string };
export type FeatureInventory = { featureCounts: Record<string, number>; diagnostics: SourceDiagnostic[] };
export type MusicXmlRead = {
  /** The Score model, without its source document. */
  score: Score;
  /** Engraving copy: the source with note IDs and expanded multi-measure rests (the source itself when unchanged). */
  engravingText: string;
  inventory: FeatureInventory;
  /** Navigation that could not be honoured. */
  diagnostics: SourceDiagnostic[];
  playback: PlaybackMarks;
};

const FAMILIES: Record<string, string[]> = {
  voices: ['voice', 'layer', 'backup', 'forward'], beams: ['beam'], lyrics: ['lyric', 'verse', 'syl'],
  percussion: ['unpitched', 'midi-unpitched', 'notehead'], tuplets: ['time-modification', 'tuplet'],
  navigation: ['repeat', 'ending', 'segno', 'coda'], expression: ['dynamics', 'wedge', 'pedal', 'sound'],
  ornaments: ['ornaments', 'articulations', 'tremolo'], notation: ['slur', 'tie', 'glissando', 'arpeggiate'],
  specialized: ['technical', 'scordatura', 'bend', 'fingering', 'string', 'fret', 'staff-tuning', 'image'],
};
/** Feature inventory from element counts by local name (see sourceFeatureInventory in document.ts). */
export function inventoryFromCounts(names: Map<string, number>, rootLocalName: string): FeatureInventory {
  const featureCounts = Object.fromEntries(Object.entries(FAMILIES).map(([family, tags]) => [family, tags.reduce((total, tag) => total + (names.get(tag) || 0), 0)]));
  const diagnostics: SourceDiagnostic[] = [];
  if (rootLocalName === 'score-timewise') diagnostics.push({ feature: 'timewise', status: 'retained', location: '/score-timewise', message: 'Original timewise score retained; a partwise view is used for engraving.' });
  for (const [family, count] of Object.entries(featureCounts)) {
    if (!count) continue;
    diagnostics.push({ feature: family, status: 'retained', location: `/${rootLocalName}`, message: `${count} source element${count === 1 ? '' : 's'} retained in the original document; engraving and performance require separate verification.` });
  }
  return { featureCounts, diagnostics };
}
/** Count elements by local name (and find the root) in one pass; throws XmlError when the text is not well-formed. */
export function countElements(text: string): { names: Map<string, number>; root: string } {
  const names = new Map<string, number>();
  const root = scanXml(text, { startElement: name => { const local = localNameOf(name); names.set(local, (names.get(local) || 0) + 1); }, endElement: () => {} });
  return { names, root: localNameOf(root) };
}

const children = (node: XmlElement, tag: string) => node.children.filter(el => el.localName === tag);
const child = (node: XmlElement, tag: string): XmlElement | undefined => { for (const el of node.children) if (el.localName === tag) return el; return undefined; };
const value = (node: XmlElement, tag: string) => child(node, tag)?.textContent?.trim() || '';
const number = (node: XmlElement, tag: string, fallback = 0) => { const raw = value(node, tag); return raw !== '' && Number.isFinite(Number(raw)) ? Number(raw) : fallback; };
const firstDescendant = (node: XmlElement, tag: string): XmlElement | undefined => {
  for (const el of node.children) { if (el.localName === tag) return el; const deep = firstDescendant(el, tag); if (deep) return deep; }
  return undefined;
};
const musicXmlTranspose = (node?: XmlElement): Transposition | undefined => {
  if (!node) return undefined;
  const octaves = number(node, 'octave-change');
  return { semitones: number(node, 'chromatic') + octaves * 12, diatonic: child(node, 'diatonic') ? number(node, 'diatonic') + octaves * 7 : undefined };
};
const empty = (index: number, beats: number): Measure => ({ index, beats, notes: [] });
export const durationBeats = (dur: string, dots = 0) => ({ longa: 16, breve: 8, '1': 4, '2': 2, '4': 1, '8': .5, '16': .25, '32': .125, '64': .0625, '128': .03125, whole: 4, half: 2, quarter: 1, eighth: .5, '16th': .25, '32nd': .125 }[dur] || 1) * (dots ? 2 - 1 / (2 ** dots) : 1);
const accidental = (alter: number) => alter > 0 ? '♯'.repeat(alter) : '♭'.repeat(-alter);
function musicXmlHarmony(element: XmlElement): string {
  const root = child(element, 'root');
  const step = root && value(root, 'root-step');
  if (!step) return '';
  const kinds: Record<string, string> = { major: '', minor: 'm', dominant: '7', 'major-seventh': 'maj7', 'minor-seventh': 'm7', diminished: 'dim', augmented: 'aug', 'half-diminished': 'm7♭5', 'diminished-seventh': 'dim7', 'suspended-fourth': 'sus4', 'suspended-second': 'sus2', 'major-sixth': '6', 'minor-sixth': 'm6', power: '5' };
  const kind = child(element, 'kind');
  const suffix = kind?.getAttribute('text') ?? kinds[kind?.textContent?.trim() || ''] ?? '';
  const bass = child(element, 'bass');
  const bassStep = bass && value(bass, 'bass-step');
  return `${step}${accidental(number(root!, 'root-alter'))}${suffix}${bassStep ? `/${bassStep}${accidental(number(bass!, 'bass-alter'))}` : ''}`;
}
/** Common five-line drum-set staff positions mapped to General MIDI percussion keys. */
const drumPositions: Record<string, number> = { D4: 44, E4: 35, F4: 36, G4: 41, A4: 43, B4: 45, C5: 38, D5: 47, E5: 48, F5: 51, G5: 42, A5: 49, B5: 57, C6: 49 };
const defaultDrumMidi = (step: string, octave: number) => drumPositions[`${step.toUpperCase()}${octave}`] ?? 38;
const clefName = (clefElement: XmlElement) => { const sign = value(clefElement, 'sign'); return sign === 'F' ? 'bass' : sign === 'C' ? number(clefElement, 'line', 3) === 4 ? 'tenor' : 'alto' : sign === 'percussion' ? 'percussion' : sign === 'TAB' ? 'tab' : 'treble'; };

/** Pad every part to the longest, sort notes by onset and fit measure lengths to their content (shared by importers). */
export const normalizedScore = (score: Score): Score => {
  const count = Math.max(...score.parts.map(p => p.measures.length), 0);
  score.parts.forEach(part => {
    part.name = ucfirst(part.name.trim());
    for (let i = part.measures.length; i < count; i++) part.measures.push(empty(i, score.beats * 4 / score.beatType));
    part.measures.forEach(m => { m.notes.sort((a, b) => a.start - b.start); m.beats = Math.max(m.beats, ...m.notes.map(n => n.start + n.duration), 0); });
  });
  if (!count || !score.parts.length) throw new Error('No readable notes or measures were found.');
  return score;
};

/** The root element's name, read past the XML declaration, comments and DOCTYPE without parsing the document. */
export function rootElementName(text: string): string | undefined {
  const prolog = /\s*(?:<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE(?:[^[>]|\[[\s\S]*?\])*>)/y;
  let index = 0;
  for (prolog.lastIndex = 0; prolog.exec(text); prolog.lastIndex = index) index = prolog.lastIndex;
  const root = /\s*<([A-Za-z_][\w.:-]*)/y;
  root.lastIndex = index;
  return root.exec(text)?.[1];
}

const escapeAttribute = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\t/g, '&#9;').replace(/\n/g, '&#10;').replace(/\r/g, '&#13;');
const rawAttributes = (text: string, attributes: XmlAttribute[]) => attributes.map(attribute => ` ${text.slice(attribute.start, attribute.end)}`).join('');
const escapeMarkup = (text: string) => escapeAttribute(text).replace(/'/g, '&apos;');
/**
 * Replace references to internal-subset entities with their (escaped) replacement text, outside comments, CDATA
 * sections and PIs: copied markup must not depend on a DOCTYPE the new document does not carry.
 */
function expandEntities(markup: string, entities: Readonly<Record<string, string>>): string {
  if (markup.indexOf('&') < 0) return markup;
  return markup.split(/(<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>)/).map((piece, index) => index % 2 ? piece
    : piece.replace(/&([^\s&;#]+);/g, (reference, name: string) => Object.prototype.hasOwnProperty.call(entities, name) ? escapeMarkup(entities[name]) : reference)).join('');
}

/**
 * Timewise → partwise, as text: the root's other children, then one <part> per part ID (part-list order, then any
 * found only in measures), each holding every measure's content for that part. Matches the former DOM conversion
 * (element children only; measures without a number get their position).
 */
export function timewiseToPartwise(text: string): { text: string; inventory: FeatureInventory } {
  const names = new Map<string, number>();
  type Measure = { attributes: string; parts: { id: string | null; content: string[] }[] };
  let rootAttributes = '';
  const header: string[] = [];
  const measures: Measure[] = [];
  const listedIds: string[] = [];
  let partListSeen = false, inFirstPartList = false;
  const stack: { local: string; start: number }[] = [];
  let entities: Readonly<Record<string, string>> = {};
  const copy = (markup: string) => expandEntities(markup, entities);
  const root = scanXml(text, {
    doctype: declared => { entities = declared; },
    startElement(name, attributes, start, end, selfClosing) {
      const local = localNameOf(name);
      names.set(local, (names.get(local) || 0) + 1);
      const depth = stack.length;
      if (depth === 0) rootAttributes = copy(rawAttributes(text, attributes));
      else if (depth === 1 && local === 'measure') measures.push({ attributes: copy(rawAttributes(text, attributes)) + (attributes.some(a => a.name === 'number') ? '' : ` number="${measures.length + 1}"`), parts: [] });
      else if (depth === 1 && local === 'part-list' && !partListSeen) { partListSeen = true; inFirstPartList = true; }
      else if (depth === 2 && inFirstPartList && local === 'score-part') { const id = attributes.find(a => a.name === 'id')?.value; if (id) listedIds.push(id); }
      else if (depth === 2 && stack[1].local === 'measure' && local === 'part') measures.at(-1)!.parts.push({ id: attributes.find(a => a.name === 'id')?.value ?? null, content: [] });
      stack.push({ local, start });
      void end; void selfClosing;
    },
    endElement(_name, _start, end) {
      const frame = stack.pop()!;
      const depth = stack.length;
      if (depth === 1 && frame.local !== 'measure') { header.push(copy(text.slice(frame.start, end))); if (frame.local === 'part-list') inFirstPartList = false; }
      else if (depth === 3 && stack[1].local === 'measure' && stack[2].local === 'part') measures.at(-1)!.parts.at(-1)!.content.push(copy(text.slice(frame.start, end)));
    },
  });
  const rootLocal = localNameOf(root);
  if (rootLocal !== 'score-timewise') return { text, inventory: inventoryFromCounts(names, rootLocal) };
  const ids = [...new Set([...listedIds, ...measures.flatMap(measure => measure.parts.map(part => part.id).filter((id): id is string => Boolean(id)))])];
  const out: string[] = [`<score-partwise${rootAttributes}>`, ...header];
  for (const id of ids) {
    out.push(`<part id="${escapeAttribute(id)}">`);
    for (const measure of measures) out.push(`<measure${measure.attributes}>`, ...(measure.parts.find(part => part.id === id)?.content || []), '</measure>');
    out.push('</part>');
  }
  out.push('</score-partwise>');
  return { text: out.join(''), inventory: inventoryFromCounts(names, rootLocal) };
}

type PlaybackCollector = { notes: (element: XmlElement) => void; pedals: { begin(id: string): void; measure(element: XmlElement, index: number): void; end(): void }; result(): PlaybackMarks };
/** Articulation, fermata and cue marks by note ID, and damper-pedal changes by source part (see timeline.ts). */
function playbackCollector(): PlaybackCollector {
  const marks = new Map<string, NoteMark>();
  const markDiagnostics: string[] = [];
  const partPedals: { id: string; changes: PedalChange[]; diagnostics: string[] }[] = [];
  let current: { id: string; changes: PedalChange[]; diagnostics: string[]; divisions: number } | undefined;
  const visitNote = (note: XmlElement) => {
    const id = note.getAttribute('id');
    const notations = child(note, 'notations');
    // Cue notes are engraved for reference only and never sound.
    const silent = Boolean(child(note, 'cue'));
    if (!notations && !silent) return;
    const art = notations && child(notations, 'articulations');
    const names = art ? art.children.map(el => el.localName) : [];
    let durationScale = 1, velocityDelta = 0;
    if (names.includes('staccatissimo')) durationScale = .25;
    else if (names.includes('staccato')) durationScale = .5;
    else if (names.includes('detached-legato')) durationScale = .75;
    else if (names.includes('tenuto')) durationScale = .96;
    if (names.includes('strong-accent')) velocityDelta = 18;
    else if (names.includes('accent')) velocityDelta = 12;
    const fermata = Boolean(notations && child(notations, 'fermata'));
    const meaningful = durationScale !== 1 || velocityDelta || fermata || silent;
    if (id && meaningful) marks.set(id, { durationScale, velocityDelta, fermata, silent });
    else if (!id && meaningful) markDiagnostics.push('Some articulations lack MusicXML note IDs and could not be mapped to sound.');
    if (notations && child(notations, 'ornaments')) markDiagnostics.push('Ornaments are engraved but not synthesized.');
  };
  const walk = (element: XmlElement) => {
    if (element.localName === 'note') visitNote(element);
    for (const item of element.children) walk(item);
  };
  const duration = (el: XmlElement) => Number(child(el, 'duration')?.textContent) || 0;
  return {
    notes: walk,
    pedals: {
      begin(id) { current = { id, changes: [], diagnostics: [], divisions: 1 }; },
      measure(measure, measureIndex) {
        const state = current!;
        const { changes, diagnostics } = state;
        let cursor = 0;
        const damper = (sound: XmlElement | undefined, beat: number) => {
          if (sound?.hasAttribute('sostenuto-pedal')) diagnostics.push('Sostenuto pedal is engraved but not synthesized.');
          const value = sound?.getAttribute('damper-pedal');
          if (value === null || value === undefined) return;
          const down = value === 'yes' || (value !== 'no' && Number(value) > 0);
          changes.push({ measureIndex, beat, kind: down ? 'down' : 'up' });
        };
        for (const item of measure.children) {
          const name = item.localName;
          if (name === 'attributes') { const d = Number(child(item, 'divisions')?.textContent); if (d > 0) state.divisions = d; }
          else if (name === 'note') { if (!child(item, 'chord') && !child(item, 'grace')) cursor += duration(item) / state.divisions; }
          else if (name === 'backup') cursor = Math.max(0, cursor - duration(item) / state.divisions);
          else if (name === 'forward') cursor += duration(item) / state.divisions;
          else if (name === 'sound') damper(item, cursor);
          else if (name === 'direction') {
            const offset = child(item, 'offset');
            const beat = Math.max(0, cursor + (offset?.getAttribute('sound') === 'yes' ? (Number(offset.textContent) || 0) / state.divisions : 0));
            const pedals = children(item, 'direction-type').flatMap(type => children(type, 'pedal'));
            for (const pedal of pedals) {
              const type = pedal.getAttribute('type');
              if (type === 'start' || type === 'resume') changes.push({ measureIndex, beat, kind: 'down' });
              else if (type === 'stop' || type === 'discontinue') changes.push({ measureIndex, beat, kind: 'up' });
              else if (type === 'change') changes.push({ measureIndex, beat, kind: 'change' });
              else if (type === 'sostenuto') diagnostics.push('Sostenuto pedal is engraved but not synthesized.');
            }
            if (pedals.length) { if (child(item, 'sound')?.hasAttribute('sostenuto-pedal')) diagnostics.push('Sostenuto pedal is engraved but not synthesized.'); }
            else damper(child(item, 'sound'), beat);
          }
        }
      },
      end() { if (current) partPedals.push(current); current = undefined; },
    },
    result() {
      // A repeated part ID keeps its first position but the last part's changes (as a Map keyed by ID would).
      const last = new Map<string, number>();
      partPedals.forEach((entry, index) => last.set(entry.id, index));
      const pedals = new Map<string, PedalChange[]>();
      const pedalDiagnostics: string[] = [];
      for (const index of last.values()) {
        const entry = partPedals[index];
        pedalDiagnostics.push(...entry.diagnostics);
        if (entry.changes.length) pedals.set(entry.id, entry.changes);
      }
      return { marks, markDiagnostics, pedals, pedalDiagnostics };
    },
  };
}

/** Thrown when a header element the parts depend on (part-list, defaults, concert-score) follows a part. */
class LateHeader extends Error {}

/**
 * Read a MusicXML document (partwise or timewise text) in one pass. Throws 'This file is not valid XML.' or
 * 'This file is not a MusicXML score.' like the former DOM importer.
 */
export function readMusicXml(text: string): MusicXmlRead {
  const name = rootElementName(text);
  let source = text;
  let inventory: FeatureInventory | undefined;
  if (!name || localNameOf(name) === 'score-timewise') {
    const converted = timewiseToPartwise(text);
    source = converted.text;
    inventory = converted.inventory;
  }
  source = normalizeOctaveClefs(source);
  try { return readPartwise(source, inventory); }
  catch (error) {
    if (!(error instanceof LateHeader)) throw error;
    // An out-of-order header: read it first, then read the document again with it known from the start.
    const prelude = new Map<string, XmlElement>();
    const builder = new XmlTreeBuilder();
    let depth = 0;
    scanXml(source, {
      startElement: (elementName, attributes) => { builder.open(elementName, attributes, depth === 1 && localNameOf(elementName) !== 'part'); depth++; },
      endElement: () => { depth--; const done = builder.close(); if (done && !prelude.has(done.localName)) prelude.set(done.localName, done); },
      text: value => builder.text(value),
    });
    return readPartwise(source, inventory, prelude);
  }
}

type Frame = { local: string; start: number; kind: 'root' | 'top' | 'part' | 'measure' | 'part-other' | 'inner' | 'skip'; captured: boolean; childCount: number; onlyMultiRest: boolean };
type Edit = { start: number; end: number; text: string };

function readPartwise(text: string, timewiseInventory: FeatureInventory | undefined, prelude?: Map<string, XmlElement>): MusicXmlRead {
  const names = new Map<string, number>();
  const stack: Frame[] = [];
  const edits: Edit[] = [];
  const builder = new XmlTreeBuilder();
  const playback = playbackCollector();
  const navigationMeasures: MeasureNavigation[] = [];
  const navigationNotes: string[][] = [];
  const readNavigation = musicXmlNavigationReader();
  let root: XmlElement | undefined;
  let partwise = false;
  let partNo = -1;
  let partsStarted = false;
  // identifyMusicXmlNotes state: IDs in use, and the measure/note counters of the note being read.
  const used = new Set<string>();
  let measureNo = -1, noteIndex = 0;

  // Score state (the former parseMusicXml, restructured per part and per measure).
  let concertScore = false;
  let scoreParts = new Map<string | null, XmlElement>();
  let partNames = new Map<string | null, string>();
  let beats = 4, beatType = 4, key = 0, tempo = 100;
  let keyMode: 'major' | 'minor' | undefined;
  let openingMeter = false, openingTempo = false;
  const parts: Part[] = [];
  type PartState = {
    element: XmlElement; id: string; name: string; definition?: XmlElement; channel10: boolean; unpitched: boolean;
    staffMap: Map<number, Part>; divisions: number; partKey: number; partKeyMode?: 'major' | 'minor'; partBeats: number; partBeatType: number; partClef: string;
    partTransposition: Transposition; staffTranspositions: Map<number, Transposition>;
  };
  let part: PartState | undefined;

  const header = (local: string) => prelude?.get(local) ?? (root && child(root, local));
  const instrumentFields = (state: PartState) => {
    const { definition, element, name } = state;
    const scoreInstruments = children(definition || element, 'score-instrument');
    const gmVirtual = scoreInstruments.map(item => child(item, 'virtual-instrument')).map(item => item && gmProgramForVirtualName(value(item, 'virtual-library'), value(item, 'virtual-name'))).find(Boolean);
    const hasOtherVirtual = scoreInstruments.some(item => {
      const library = value(child(item, 'virtual-instrument') || item, 'virtual-library');
      return library && library.toLowerCase().replace(/[^a-z]/g, '') !== 'generalmidi';
    });
    // Drum kits are often exported as program 1 on channel 10; never map them to piano.
    const drumKit = children(definition || element, 'midi-instrument').some(item => number(item, 'midi-channel') === 10) || state.unpitched;
    const midiProgram = !drumKit && !gmVirtual && !hasOtherVirtual ? children(definition || element, 'midi-instrument').map(item => gmProgramForNumber(number(item, 'midi-program', 0))).find(Boolean) : undefined;
    const gm = drumKit ? undefined : gmVirtual || midiProgram;
    return { instrument: drumKit ? 'drum-kit' : gm ? gm.icon as Part['instrument'] : instrumentForName(name), gmProgram: gm?.program, gmSoundfont: gm?.soundfont };
  };

  const beginPart = (element: XmlElement) => {
    if (!partsStarted) {
      partsStarted = true;
      const defaults = header('defaults');
      concertScore = Boolean(defaults ? child(defaults, 'concert-score') : header('concert-score'));
      const list = header('part-list');
      scoreParts = new Map((list ? children(list, 'score-part') : []).map(p => [p.getAttribute('id'), p]));
      partNames = new Map([...scoreParts].map(([id, p]) => [id, value(p, 'part-name')]));
    }
    partNo++;
    const id = element.getAttribute('id') || `P${partNo + 1}`;
    const definition = scoreParts.get(id);
    part = {
      element, id, name: partNames.get(id) || `Part ${partNo + 1}`, definition, unpitched: false,
      channel10: definition ? children(definition, 'midi-instrument').some(item => number(item, 'midi-channel') === 10) : false,
      staffMap: new Map(), divisions: 1, partKey: key, partBeats: 4, partBeatType: 4, partClef: '',
      partTransposition: { semitones: 0 }, staffTranspositions: new Map(),
    };
    playback.pedals.begin(element.getAttribute('id') || '');
  };

  const readMeasure = (m: XmlElement, index: number) => {
    const state = part!;
    const { id, name, definition, staffMap, staffTranspositions } = state;
    let cursor = 0;
    let last: ScoreNote | undefined;
    const harmonyByTime = new Map<number, string>();
    const attrs = child(m, 'attributes');
    const applyAttributes = (attributes: XmlElement) => {
      state.divisions = number(attributes, 'divisions', state.divisions);
      const time = child(attributes, 'time');
      if (time) {
        state.partBeats = number(time, 'beats', state.partBeats); state.partBeatType = number(time, 'beat-type', state.partBeatType);
        if (partNo === 0 && !openingMeter) { beats = state.partBeats; beatType = state.partBeatType; openingMeter = true; }
      }
      const k = child(attributes, 'key');
      if (k) { state.partKey = number(k, 'fifths', state.partKey); state.partKeyMode = value(k, 'mode') === 'minor' ? 'minor' : 'major'; if (partNo === 0 && index === 0) { key = state.partKey; keyMode = state.partKeyMode; } }
      const clefElement = children(attributes, 'clef').find(c => Number(c.getAttribute('number') || 1) === 1);
      if (clefElement) state.partClef = clefName(clefElement);
      const forPart = children(attributes, 'for-part').map(item => musicXmlTranspose(child(item, 'part-transpose'))).find(Boolean);
      if (concertScore && forPart) state.partTransposition = forPart;
      else for (const item of children(attributes, 'transpose')) {
        const interval = musicXmlTranspose(item)!;
        const staffNumber = Number(item.getAttribute('number'));
        if (staffNumber > 0) staffTranspositions.set(staffNumber, interval);
        else state.partTransposition = interval;
      }
      staffMap.forEach((staffPart, staff) => {
        const measure = staffPart.measures[index];
        if (!measure) return;
        const staffClef = children(attributes, 'clef').find(c => Number(c.getAttribute('number') || 1) === staff);
        if (staffClef) staffPart.clef = clefName(staffClef);
        measure.key = state.partKey; if (state.partKeyMode) measure.keyMode = state.partKeyMode; measure.clef = staffPart.clef; measure.beatsPerBar = state.partBeats; measure.beatType = state.partBeatType;
        measure.nominalBeats = state.partBeats * 4 / state.partBeatType;
      });
    };
    if (attrs) applyAttributes(attrs);
    const measureBeats = state.partBeats * 4 / state.partBeatType;
    const ensure = (staff: number) => {
      const transposition = staffTranspositions.get(staff) || state.partTransposition;
      if (!staffMap.has(staff)) {
        const clefEl = attrs && children(attrs, 'clef').find(c => Number(c.getAttribute('number') || 1) === staff);
        const clef = clefEl ? clefName(clefEl) : state.partClef || (/bass/i.test(name) ? 'bass' : 'treble');
        const provisional = instrumentFields(state);
        staffMap.set(staff, { id: `${id}-${staff}`, sourcePartId: id, name: staff === 1 ? name : `${name} · ${staff}`, clef, key: state.partKey, ...(state.partKeyMode ? { keyMode: state.partKeyMode } : {}), instrument: provisional.instrument, gmProgram: provisional.gmProgram, gmSoundfont: provisional.gmSoundfont, pitchBasis: concertScore ? 'concert' : 'written', transposition, measures: Array.from({ length: index }, (_, i) => empty(i, measureBeats)) });
      }
      const p = staffMap.get(staff)!;
      if (!p.measures[index]) p.measures[index] = { ...empty(index, measureBeats), nominalBeats: measureBeats, number: m.getAttribute('number') || String(index + 1), implicit: m.getAttribute('implicit') === 'yes', key: state.partKey, ...(state.partKeyMode ? { keyMode: state.partKeyMode } : {}), clef: p.clef, beatsPerBar: state.partBeats, beatType: state.partBeatType };
      p.measures[index].transposition = transposition;
      return p.measures[index];
    };
    staffMap.forEach((_, staff) => ensure(staff));
    for (const item of m.children) {
      if (item.localName === 'attributes') { if (item !== attrs) applyAttributes(item); continue; }
      if (item.localName === 'harmony') {
        const symbol = musicXmlHarmony(item);
        if (symbol) harmonyByTime.set(cursor + number(item, 'offset') / state.divisions, symbol);
      }
      if (item.localName === 'direction') {
        const sound = child(item, 'sound');
        const metronome = child(item, 'direction-type') && child(child(item, 'direction-type')!, 'metronome');
        const metronomeUnit = metronome && value(metronome, 'beat-unit');
        const unitLength = metronomeUnit ? durationBeats(metronomeUnit, metronome ? children(metronome, 'beat-unit-dot').length : 0) : 1;
        const t = Number(sound?.getAttribute('tempo') || (metronome ? value(metronome, 'per-minute') : 0)) * (sound?.hasAttribute('tempo') ? 1 : unitLength);
        if (t > 0 && partNo === 0 && !openingTempo) { tempo = t; openingTempo = true; }
        const dynamics = children(item, 'direction-type').flatMap(type => children(type, 'dynamics')).flatMap(mark => mark.children);
        const measure = ensure(number(item, 'staff', 1));
        const start = Math.max(0, cursor + number(item, 'offset') / state.divisions);
        const symbols = dynamics.map(mark => (mark.localName === 'other-dynamics' ? mark.textContent || '' : mark.localName).trim().toLowerCase()).filter(Boolean);
        const text = children(item, 'direction-type').flatMap(type => children(type, 'words')).map(word => word.textContent?.trim() || '').filter(Boolean).join(' ');
        const wedge = children(item, 'direction-type').flatMap(type => children(type, 'wedge'))[0];
        const soundDynamics = sound?.hasAttribute('dynamics') ? Number(sound.getAttribute('dynamics')) : undefined;
        if (symbols.length || text || wedge || t > 0 || soundDynamics !== undefined) (measure.directions ||= []).push({ start, symbols, text, placement: item.getAttribute('placement') === 'above' ? 'above' : 'below', voice: value(item, 'voice') || undefined, wedge: wedge ? { type: wedge.getAttribute('type') || '', number: wedge.getAttribute('number') || '1' } : undefined, soundDynamics, tempo: t > 0 ? t : undefined });
        for (const symbol of symbols) (measure.dynamics ||= []).push({ start, symbol });
      }
      if (item.localName === 'backup') { cursor = Math.max(0, cursor - number(item, 'duration') / state.divisions); last = undefined; }
      if (item.localName === 'forward') { cursor += number(item, 'duration') / state.divisions; last = undefined; }
      if (item.localName !== 'note') continue;
      const staff = number(item, 'staff', 1);
      const measure = ensure(staff);
      const chord = Boolean(child(item, 'chord'));
      const grace = Boolean(child(item, 'grace'));
      const dots = children(item, 'dot').length;
      const duration = grace ? 0 : child(item, 'duration') ? number(item, 'duration') / state.divisions : durationBeats(value(item, 'type'), dots);
      const p = child(item, 'pitch');
      const unpitched = child(item, 'unpitched');
      const rest = Boolean(child(item, 'rest'));
      const primaryBeam = children(item, 'beam').find(beam => Number(beam.getAttribute('number') || 1) === 1)?.textContent?.trim().toLowerCase();
      const beamStart = primaryBeam === 'begin';
      const beamEnd = primaryBeam === 'end';
      const accidentalElement = child(item, 'accidental');
      const sourceId = item.getAttribute('id') || undefined;
      const instrumentId = child(item, 'instrument')?.getAttribute('id');
      const midiInstrument = definition && children(definition, 'midi-instrument').find(instrument => instrument.getAttribute('id') === instrumentId) || definition && children(definition, 'midi-instrument')[0];
      const midiUnpitched = midiInstrument ? number(midiInstrument, 'midi-unpitched', 0) : 0;
      const displayStep = unpitched ? value(unpitched, 'display-step') || 'C' : undefined;
      const displayOctave = unpitched ? number(unpitched, 'display-octave', 4) : undefined;
      const basePitch = p ? pitch(value(p, 'step') || 'C', number(p, 'octave', 4), number(p, 'alter')) : unpitched ? { ...midiPitch(midiUnpitched ? midiUnpitched - 1 : defaultDrumMidi(displayStep!, displayOctave!)), unpitched: true, displayStep, displayOctave } : undefined;
      const ties = children(item, 'tie');
      const notePitch = basePitch && !rest ? { ...basePitch, sourceId, accidental: accidentalElement?.textContent?.trim(), cautionary: accidentalElement?.getAttribute('cautionary') === 'yes' || accidentalElement?.getAttribute('parentheses') === 'yes', tieStart: ties.some(t => t.getAttribute('type') === 'start'), tieStop: ties.some(t => t.getAttribute('type') === 'stop') } : undefined;
      const notations = child(item, 'notations');
      const timeModification = child(item, 'time-modification');
      const tuplets = children(notations || item, 'tuplet');
      const tuplet = timeModification ? { actual: number(timeModification, 'actual-notes', 3), normal: number(timeModification, 'normal-notes', 2), number: tuplets[0]?.getAttribute('number') || '1', start: tuplets.some(t => t.getAttribute('type') === 'start'), stop: tuplets.some(t => t.getAttribute('type') === 'stop') } : undefined;
      // A MusicXML <chord> can contain notes with different durations. Only
      // combine equal-duration pitches; keep the others as concurrent voices.
      const onset = chord && last ? last.start : cursor;
      if (chord && last && notePitch && last.voice === (value(item, 'voice') || '1') && Math.abs(last.duration - duration) < .001) {
        last.pitches.push(notePitch);
        last.beamStart ||= beamStart;
        last.beamEnd ||= beamEnd;
      }
      else {
        const slurs = children(notations || item, 'slur');
        last = { id: `${id}-${staff}-${index}-${measure.notes.length}`, sourceId, start: onset, duration, pitches: notePitch ? [notePitch] : [], transposition: staffTranspositions.get(staff) || state.partTransposition, chordSymbol: harmonyByTime.get(onset), rest, dotted: Boolean(child(item, 'dot')), dots, writtenType: value(item, 'type') || undefined, voice: value(item, 'voice') || '1', stem: value(item, 'stem') || undefined, grace, tuplet, slurStart: slurs.filter(s => s.getAttribute('type') === 'start').map(s => s.getAttribute('number') || '1'), slurStop: slurs.filter(s => s.getAttribute('type') === 'stop').map(s => s.getAttribute('number') || '1'), tieStart: notePitch?.tieStart, tieStop: notePitch?.tieStop };
        measure.notes.push(last);
      }
      if (!chord && !grace) cursor += duration;
    }
    for (const staffPart of staffMap.values()) {
      const measure = staffPart.measures[index];
      if (measure?.implicit) measure.beats = Math.max(cursor, ...measure.notes.map(note => note.start + note.duration), 0);
    }
  };

  const endPart = () => {
    const state = part!;
    // Instrument fields depend on an <unpitched> anywhere in the part, known only now.
    const fields = instrumentFields(state);
    for (const staffPart of state.staffMap.values()) Object.assign(staffPart, fields);
    parts.push(...Array.from(state.staffMap.values()).sort((a, b) => Number(a.id.split('-').pop()) - Number(b.id.split('-').pop())));
    playback.pedals.end();
    part = undefined;
  };

  /** The engraving note ID for a structural <note> (identifyMusicXmlNotes); records the edit that writes it. */
  const identify = (attributes: XmlAttribute[], end: number, selfClosing: boolean): string => {
    const idAttribute = attributes.find(a => a.name === 'id');
    const native = idAttribute?.value || attributes.find(a => a.name === 'xml:id')?.value || '';
    let id = native || `mx_p${partNo + 1}_m${measureNo + 1}_n${++noteIndex}`;
    if (native) noteIndex++;
    if (used.has(id)) id = `${id}_${partNo + 1}_${measureNo + 1}_${noteIndex}`;
    used.add(id);
    if (!idAttribute) edits.push({ start: end - (selfClosing ? 2 : 1), end: end - (selfClosing ? 2 : 1), text: ` id="${escapeAttribute(id)}"` });
    else if (idAttribute.value !== id) edits.push({ start: idAttribute.start, end: idAttribute.end, text: `id="${escapeAttribute(id)}"` });
    return id;
  };

  const completed = (element: XmlElement, kind: Frame['kind']) => {
    playback.notes(element);
    if (kind === 'top') {
      root!.append(element);
      // The parts read part-list and defaults (or a root-level concert-score) when the first part starts.
      if (partsStarted && !prelude && ['part-list', 'defaults', 'concert-score'].includes(element.localName) && child(root!, element.localName) === element) throw new LateHeader();
    } else if (kind === 'measure') {
      readMeasure(element, measureNo);
      playback.pedals.measure(element, measureNo);
      if (partNo === 0) { const notes: string[] = []; navigationMeasures[measureNo] = readNavigation(element, notes); navigationNotes[measureNo] = notes; }
    } else if (kind === 'part-other') part!.element.append(element);
  };

  scanXml(text, {
    startElement(name, attributes, start, end, selfClosing) {
      const local = localNameOf(name);
      if (!timewiseInventory) names.set(local, (names.get(local) || 0) + 1);
      const parent = stack.at(-1);
      if (parent) { parent.childCount++; if (local !== 'multiple-rest') parent.onlyMultiRest = false; }
      let kind: Frame['kind'];
      let element: XmlElement | null = null;
      if (!parent) {
        kind = 'root';
        partwise = local === 'score-partwise';
        root = new XmlElement(name, attributes);
      } else if (!partwise) kind = 'skip';
      else if (parent.kind === 'root') {
        if (local === 'part') {
          kind = 'part'; measureNo = -1;
          beginPart(new XmlElement(name, attributes));
        } else { kind = 'top'; element = builder.open(name, attributes, true); }
      } else if (parent.kind === 'part') {
        if (local === 'measure') { kind = 'measure'; measureNo++; noteIndex = 0; }
        else kind = 'part-other';
        element = builder.open(name, attributes, true);
      } else {
        kind = 'inner';
        element = builder.open(name, attributes, false);
        if (local === 'note' && parent.kind === 'measure') element!.setAttribute('id', identify(attributes, end, selfClosing));
        if (local === 'unpitched' && part) part.unpitched = true;
      }
      stack.push({ local, start, kind, captured: element !== null, childCount: 0, onlyMultiRest: true });
    },
    endElement(_name, _start, end) {
      const frame = stack.pop()!;
      // A removal replaces any edit inside the removed span (nested multi-rests, the hint inside its measure-style).
      if (frame.local === 'multiple-rest' || (frame.local === 'measure-style' && frame.childCount > 0 && frame.onlyMultiRest)) {
        while (edits.length && edits.at(-1)!.start >= frame.start) edits.pop();
        edits.push({ start: frame.start, end, text: '' });
      }
      if (frame.captured) { const done = builder.close(); if (done) completed(done, frame.kind); }
      if (frame.kind === 'part') endPart();
    },
    text: value => builder.text(value),
  });
  if (!partwise) throw new Error('This file is not a MusicXML score.');

  const scoreRoot = root!;
  const credits = children(scoreRoot, 'credit');
  const identification = child(scoreRoot, 'identification');
  const credit = (type: string) => { const match = credits.find(c => children(c, 'credit-type').some(t => t.textContent?.trim().toLowerCase() === type)); return (match && firstDescendant(match, 'credit-words'))?.textContent?.trim() || ''; };
  const creators = children(identification || scoreRoot, 'creator');
  const movementTitle = value(scoreRoot, 'movement-title');
  const title = value(child(scoreRoot, 'work') || scoreRoot, 'work-title') || movementTitle || credit('title');
  const subtitle = credit('subtitle') || (movementTitle && movementTitle !== title ? movementTitle : '');
  const composer = creators.find(e => e.getAttribute('type') === 'composer')?.textContent?.trim() || credit('composer');
  const otherCredits = creators.filter(e => e.getAttribute('type') !== 'composer').map(e => {
    const name = e.textContent?.trim();
    const type = e.getAttribute('type');
    return name ? `${type ? type[0].toUpperCase() + type.slice(1) + ': ' : ''}${name}` : '';
  }).filter(Boolean);
  const rights = value(identification || scoreRoot, 'rights');
  if (rights) otherCredits.push(rights);
  const shown = new Set([title, subtitle, composer, ...otherCredits].filter(Boolean).map(s => s.trim()));
  for (const line of credits.flatMap(c => c.descendants().filter(e => e.localName === 'credit-words').map(e => e.textContent?.trim() || ''))) {
    if (line && !shown.has(line)) { otherCredits.push(line); shown.add(line); }
  }
  // Builder-style scores can contain many placeholder instruments with only
  // rests. They obscure the playable staves in the continuous reader. A silent
  // staff is kept only when its directions shape playback: a tempo, or
  // dynamics/wedges that apply to a sounding sibling staff of the same part.
  // Plain words (e.g. a template's "(Easy 3)" label) do not make it playable.
  const sounding = (p: Part) => p.measures.some(measure => measure.notes.some(note => note.pitches.length > 0));
  const sourcePart = (p: Part) => p.id.replace(/-\d+$/, '');
  const soundingSources = new Set(parts.filter(sounding).map(sourcePart));
  const shapesPlayback = (p: Part) => p.measures.some(measure => measure.directions?.some(direction => (direction.tempo ?? 0) > 0
    || (soundingSources.has(sourcePart(p)) && (direction.symbols?.length || direction.wedge || direction.soundDynamics !== undefined))));
  const playableParts = parts.filter(p => sounding(p) || shapesPlayback(p));
  const score = linkTabParts(normalizedScore({ title, subtitle, composer, credits: otherCredits, source: 'MusicXML', tempo, beats, beatType, key, ...(keyMode ? { keyMode } : {}), parts: playableParts.length ? playableParts : parts }));
  resolveChoirNames(score);
  // Navigation is read once from the first source part and shared by every staff.
  const measureCount = score.parts[0].measures.length;
  const navigation = Array.from({ length: measureCount }, (_, i) => navigationMeasures[i] || {});
  attachNavigation(score, navigation);
  const notes = navigationNotes.slice(0, measureCount).flat();

  let engravingText = text;
  if (edits.length) {
    const pieces: string[] = [];
    let from = 0;
    for (const edit of edits) { pieces.push(text.slice(from, edit.start), edit.text); from = edit.end; }
    pieces.push(text.slice(from));
    engravingText = pieces.join('');
  }
  return {
    score, engravingText,
    inventory: timewiseInventory || inventoryFromCounts(names, localNameOf(scoreRoot.name)),
    diagnostics: [...new Set(notes)].map(message => ({ feature: 'navigation', status: 'unsupported', location: '/', message })),
    playback: playback.result(),
  };
}

/** Playback marks of a MusicXML text (articulations, fermatas, cue notes, pedals); empty when it cannot be read. */
export function readPlaybackMarks(text: string | undefined): PlaybackMarks {
  const collector = playbackCollector();
  if (!text) return collector.result();
  const builder = new XmlTreeBuilder();
  const stack: ('root' | 'part' | 'measure' | 'other')[] = [];
  let timewise = false, measureIndex = -1;
  /** Timewise: part ID → its measures' <part> elements, in order (pedals are per part). */
  const timewiseParts = new Map<string, XmlElement[]>();
  try {
    scanXml(text, {
      startElement(name, attributes) {
        const local = localNameOf(name);
        const parent = stack.at(-1);
        if (!parent) { timewise = local === 'score-timewise'; stack.push('root'); return; }
        if (parent === 'root' && !timewise && local === 'part') { collector.pedals.begin(attributes.find(a => a.name === 'id')?.value || ''); measureIndex = -1; stack.push('part'); return; }
        const measure = parent === 'part' && local === 'measure';
        if (measure) measureIndex++;
        builder.open(name, attributes, parent === 'root' || parent === 'part');
        stack.push(measure ? 'measure' : 'other');
      },
      endElement() {
        const kind = stack.pop()!;
        if (kind === 'root') return;
        if (kind === 'part') { collector.pedals.end(); return; }
        const done = builder.close();
        if (!done) return;
        collector.notes(done);
        if (kind === 'measure') collector.pedals.measure(done, measureIndex);
        else if (timewise && done.localName === 'measure') for (const item of children(done, 'part')) { const id = item.getAttribute('id') || ''; timewiseParts.set(id, [...(timewiseParts.get(id) || []), item]); }
      },
      text: value => builder.text(value),
    });
  } catch (error) {
    if (error instanceof XmlError) return playbackCollector().result();
    throw error;
  }
  return timewise ? timewiseMarks(collector, timewiseParts) : collector.result();
}
function timewiseMarks(collector: PlaybackCollector, parts: Map<string, XmlElement[]>): PlaybackMarks {
  for (const [id, measures] of parts) {
    collector.pedals.begin(id);
    measures.forEach((measure, index) => collector.pedals.measure(measure, index));
    collector.pedals.end();
  }
  return collector.result();
}
