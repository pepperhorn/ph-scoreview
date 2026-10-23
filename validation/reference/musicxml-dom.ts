// Frozen copy of the DOM-based MusicXML importer as of 74c121a (before Phase 2 of
// docs/specs/large-score-performance.md). It is the oracle for validation/parser-diff.mjs: the streaming reader in
// packages/pepperscore/src/lib/notation/musicxml-source.ts must produce the same Score, an engraving text that parses to the same
// document, the same feature inventory, navigation and playback marks. Do not "fix" this file; it records the old
// behaviour. Served by Vite to the validation page (it needs DOMParser).
import { gmProgramForNumber, gmProgramForVirtualName, instrumentForName, midiPitch, pitch, ucfirst, type BarlineNavigation, type Measure, type MeasureNavigation, type Part, type Score, type ScoreNote, type Transposition } from '../../packages/pepperscore/src/lib/score';
import { attachNavigation, endingNumbers, navigationWord } from '../../packages/pepperscore/src/lib/notation/navigation';
import { linkTabParts } from '../../packages/pepperscore/src/lib/tab/tab-parts';
import { formatFraction, fraction, fromNumber } from '../../packages/pepperscore/src/lib/playback/fraction';

type SourceDiagnostic = { feature: string; status: 'retained' | 'partial' | 'unsupported'; location: string; message: string };

const children = (node: Element, tag: string) => Array.from(node.children).filter(el => el.localName === tag);
const child = (node: Element, tag: string) => children(node, tag)[0];
const value = (node: Element, tag: string) => child(node, tag)?.textContent?.trim() || '';
const number = (node: Element, tag: string, fallback = 0) => { const raw = value(node, tag); return raw !== '' && Number.isFinite(Number(raw)) ? Number(raw) : fallback; };
const parseXml = (text: string) => {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('This file is not valid XML.');
  return doc;
};
const musicXmlTranspose = (node?: Element): Transposition | undefined => {
  if (!node) return undefined;
  const octaves = number(node, 'octave-change');
  return { semitones: number(node, 'chromatic') + octaves * 12, diatonic: child(node, 'diatonic') ? number(node, 'diatonic') + octaves * 7 : undefined };
};
const empty = (index: number, beats: number): Measure => ({ index, beats, notes: [] });
const durationBeats = (dur: string, dots = 0) => ({ longa: 16, breve: 8, '1': 4, '2': 2, '4': 1, '8': .5, '16': .25, '32': .125, '64': .0625, '128': .03125, whole: 4, half: 2, quarter: 1, eighth: .5, '16th': .25, '32nd': .125 }[dur] || 1) * (dots ? 2 - 1 / (2 ** dots) : 1);
const accidental = (alter: number) => alter > 0 ? '♯'.repeat(alter) : '♭'.repeat(-alter);
function musicXmlHarmony(element: Element): string {
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
const normalized = (score: Score): Score => {
  const count = Math.max(...score.parts.map(p => p.measures.length), 0);
  score.parts.forEach(part => {
    part.name = ucfirst(part.name.trim());
    for (let i = part.measures.length; i < count; i++) part.measures.push(empty(i, score.beats * 4 / score.beatType));
    part.measures.forEach(m => { m.notes.sort((a, b) => a.start - b.start); m.beats = Math.max(m.beats, ...m.notes.map(n => n.start + n.duration), 0); });
  });
  if (!count || !score.parts.length) throw new Error('No readable notes or measures were found.');
  return score;
};

const navigationDiagnostics = (messages: string[]): SourceDiagnostic[] => [...new Set(messages)].map(message => ({ feature: 'navigation', status: 'unsupported', location: '/', message }));

function sourceFeatureInventory(text: string): { featureCounts: Record<string, number>; diagnostics: SourceDiagnostic[] } {
  const parsed = new DOMParser().parseFromString(text, 'application/xml');
  if (parsed.querySelector('parsererror')) return { featureCounts: {}, diagnostics: [{ feature: 'xml', status: 'unsupported', location: '/', message: 'Source XML could not be parsed.' }] };
  const names = new Map<string, number>();
  for (const element of Array.from(parsed.getElementsByTagName('*'))) names.set(element.localName, (names.get(element.localName) || 0) + 1);
  const families: Record<string, string[]> = {
    voices: ['voice', 'layer', 'backup', 'forward'], beams: ['beam'], lyrics: ['lyric', 'verse', 'syl'],
    percussion: ['unpitched', 'midi-unpitched', 'notehead'], tuplets: ['time-modification', 'tuplet'],
    navigation: ['repeat', 'ending', 'segno', 'coda'], expression: ['dynamics', 'wedge', 'pedal', 'sound'],
    ornaments: ['ornaments', 'articulations', 'tremolo'], notation: ['slur', 'tie', 'glissando', 'arpeggiate'],
    specialized: ['technical', 'scordatura', 'bend', 'fingering', 'string', 'fret', 'staff-tuning', 'image'],
  };
  const featureCounts = Object.fromEntries(Object.entries(families).map(([family, tags]) => [family, tags.reduce((total, tag) => total + (names.get(tag) || 0), 0)]));
  const diagnostics: SourceDiagnostic[] = [];
  const root = parsed.documentElement;
  if (root.localName === 'score-timewise') diagnostics.push({ feature: 'timewise', status: 'retained', location: '/score-timewise', message: 'Original timewise score retained; a partwise view is used for engraving.' });
  for (const [family, count] of Object.entries(featureCounts)) {
    if (!count) continue;
    diagnostics.push({ feature: family, status: 'retained', location: `/${root.localName}`, message: `${count} source element${count === 1 ? '' : 's'} retained in the original document; engraving and performance require separate verification.` });
  }
  return { featureCounts, diagnostics };
}

/** The root element's name, read past the XML declaration, comments and DOCTYPE without parsing the document. */
function rootElementName(text: string): string | undefined {
  const prolog = /\s*(?:<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE(?:[^[>]|\[[\s\S]*?\])*>)/y;
  let index = 0;
  for (prolog.lastIndex = 0; prolog.exec(text); prolog.lastIndex = index) index = prolog.lastIndex;
  const root = /\s*<([A-Za-z_][\w.:-]*)/y;
  root.lastIndex = index;
  return root.exec(text)?.[1];
}

export function normalizeTimewiseMusicXml(text: string): string {
  // Most files are partwise: skip a whole-document parse unless the root says timewise (parsing then validates it).
  const rootName = rootElementName(text);
  if (rootName && rootName.slice(rootName.indexOf(':') + 1) !== 'score-timewise') return text;
  const document = new DOMParser().parseFromString(text, 'application/xml');
  if (document.querySelector('parsererror')) throw new Error('This file is not valid XML.');
  const source = document.documentElement;
  if (source.localName !== 'score-timewise') return text;
  const ns = source.namespaceURI;
  const output = document.implementation.createDocument(ns, 'score-partwise', null);
  const root = output.documentElement;
  for (const attribute of Array.from(source.attributes)) root.setAttributeNS(attribute.namespaceURI, attribute.name, attribute.value);
  for (const item of Array.from(source.children).filter(item => item.localName !== 'measure')) root.appendChild(output.importNode(item, true));
  const partList = Array.from(source.children).find(item => item.localName === 'part-list');
  const measures = Array.from(source.children).filter(item => item.localName === 'measure');
  const listedIds = Array.from(partList?.children || []).filter(item => item.localName === 'score-part').map(item => item.getAttribute('id')).filter((id): id is string => Boolean(id));
  const ids = [...new Set([...listedIds, ...measures.flatMap(measure => Array.from(measure.children).filter(item => item.localName === 'part').map(item => item.getAttribute('id')).filter((id): id is string => Boolean(id)))])];
  for (const id of ids) {
    const part = output.createElementNS(ns, 'part'); part.setAttribute('id', id);
    for (const [index, measure] of measures.entries()) {
      const converted = output.createElementNS(ns, 'measure');
      for (const attribute of Array.from(measure.attributes)) converted.setAttributeNS(attribute.namespaceURI, attribute.name, attribute.value);
      if (!converted.hasAttribute('number')) converted.setAttribute('number', String(index + 1));
      const sourcePart = Array.from(measure.children).find(item => item.localName === 'part' && item.getAttribute('id') === id);
      for (const item of Array.from(sourcePart?.children || [])) converted.appendChild(output.importNode(item, true));
      part.appendChild(converted);
    }
    root.appendChild(part);
  }
  return new XMLSerializer().serializeToString(output);
}

/**
 * Reader policy for multi-measure rests: every source measure is engraved as its own bar.
 * Verovio's MusicXML import collapses a `<multiple-rest>` span into ONE MEI measure, so the
 * engraved measures would no longer correspond 1:1 with source (and Score) measures and every
 * later note would be looked up in the wrong bar. Dropping the `<multiple-rest>` hint (and a
 * `<measure-style>` left empty by it) makes each bar of the span an ordinary whole-bar rest,
 * which is also what a reader following along with playback wants to see.
 */
function expandMultipleRests(doc: XMLDocument): void {
  const hints = Array.from(doc.getElementsByTagName('*')).filter(element => element.localName === 'multiple-rest');
  for (const hint of hints) {
    const style = hint.parentElement;
    hint.remove();
    if (style?.localName === 'measure-style' && !style.children.length) style.remove();
  }
}

/**
 * Make the MusicXML engraving copy: stable source IDs on every `<note>` (kept when the source has
 * them, generated deterministically when it does not) and multi-measure rests expanded to one bar
 * per source measure. The original source is untouched.
 */
export function identifyMusicXmlNotes(text: string): { text: string; sourceIds: string[] } {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('This file is not valid XML.');
  expandMultipleRests(doc);
  const sourceIds: string[] = [];
  const used = new Set<string>();
  for (const [partIndex, part] of Array.from(doc.documentElement.children).filter(e => e.localName === 'part').entries()) {
    for (const [measureIndex, measure] of Array.from(part.children).filter(e => e.localName === 'measure').entries()) {
      let noteIndex = 0;
      for (const note of Array.from(measure.children).filter(e => e.localName === 'note')) {
        const native = note.getAttribute('id') || note.getAttribute('xml:id') || note.getAttributeNS('http://www.w3.org/XML/1998/namespace', 'id');
        let id = native || `mx_p${partIndex + 1}_m${measureIndex + 1}_n${++noteIndex}`;
        if (native) noteIndex++;
        if (used.has(id)) id = `${id}_${partIndex + 1}_${measureIndex + 1}_${noteIndex}`;
        used.add(id); note.setAttribute('id', id); sourceIds.push(id);
      }
    }
  }
  return { text: new XMLSerializer().serializeToString(doc), sourceIds };
}

const xmlChildren = (el: Element, name: string) => Array.from(el.children).filter(item => item.localName === name);
const first = (el: Element, name: string) => xmlChildren(el, name)[0];
function musicXmlNavigation(root: Element, measureCount: number, diagnostics: string[]): MeasureNavigation[] {
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


export function referenceParseMusicXml(text: string) {
  const engravingText = identifyMusicXmlNotes(normalizeTimewiseMusicXml(text)).text;
  const doc = parseXml(engravingText);
  const root = doc.documentElement;
  if (root.localName !== 'score-partwise') throw new Error('This file is not a MusicXML score.');
  const concertScore = Boolean(child(child(root, 'defaults') || root, 'concert-score'));
  const list = child(root, 'part-list');
  const identification = child(root, 'identification');
  const credits = children(root, 'credit');
  const credit = (type: string) => credits.find(c => children(c, 'credit-type').some(t => t.textContent?.trim().toLowerCase() === type))?.querySelector('credit-words')?.textContent?.trim() || '';
  const creators = children(identification || root, 'creator');
  const movementTitle = value(root, 'movement-title');
  const title = value(child(root, 'work') || root, 'work-title') || movementTitle || credit('title');
  const subtitle = credit('subtitle') || (movementTitle && movementTitle !== title ? movementTitle : '');
  const composer = creators.find(e => e.getAttribute('type') === 'composer')?.textContent?.trim() || credit('composer');
  const otherCredits = creators.filter(e => e.getAttribute('type') !== 'composer').map(e => {
    const name = e.textContent?.trim();
    const type = e.getAttribute('type');
    return name ? `${type ? type[0].toUpperCase() + type.slice(1) + ': ' : ''}${name}` : '';
  }).filter(Boolean);
  const rights = value(identification || root, 'rights');
  if (rights) otherCredits.push(rights);
  const shown = new Set([title, subtitle, composer, ...otherCredits].filter(Boolean).map(s => s.trim()));
  for (const line of credits.flatMap(c => Array.from(c.getElementsByTagName('*')).filter(e => e.localName === 'credit-words').map(e => e.textContent?.trim() || ''))) {
    if (line && !shown.has(line)) { otherCredits.push(line); shown.add(line); }
  }
  const scoreParts = new Map(children(list || root, 'score-part').map(p => [p.getAttribute('id'), p]));
  const names = new Map([...scoreParts].map(([id, p]) => [id, value(p, 'part-name')]));
  let beats = 4, beatType = 4, key = 0, tempo = 100;
  let keyMode: 'major' | 'minor' | undefined;
  let openingMeter = false, openingTempo = false;
  const parts: Part[] = [];
  for (const [partNo, element] of children(root, 'part').entries()) {
    const id = element.getAttribute('id') || `P${partNo + 1}`;
    const name = names.get(id) || `Part ${partNo + 1}`;
    const definition = scoreParts.get(id);
    const scoreInstruments = children(definition || element, 'score-instrument');
    const gmVirtual = scoreInstruments.map(item => child(item, 'virtual-instrument')).map(item => item && gmProgramForVirtualName(value(item, 'virtual-library'), value(item, 'virtual-name'))).find(Boolean);
    const hasOtherVirtual = scoreInstruments.some(item => {
      const library = value(child(item, 'virtual-instrument') || item, 'virtual-library');
      return library && library.toLowerCase().replace(/[^a-z]/g, '') !== 'generalmidi';
    });
    // Drum kits are often exported as program 1 on channel 10; never map them to piano.
    const drumKit = children(definition || element, 'midi-instrument').some(item => number(item, 'midi-channel') === 10)
      || Array.from(element.getElementsByTagName('*')).some(el => el.localName === 'unpitched');
    const midiProgram = !drumKit && !gmVirtual && !hasOtherVirtual ? children(definition || element, 'midi-instrument').map(item => gmProgramForNumber(number(item, 'midi-program', 0))).find(Boolean) : undefined;
    const gm = drumKit ? undefined : gmVirtual || midiProgram;
    const staffMap = new Map<number, Part>();
    let divisions = 1;
    let partKey = key;
    let partKeyMode: 'major' | 'minor' | undefined;
    let partBeats = 4, partBeatType = 4;
    let partClef = '';
    let partTransposition: Transposition = { semitones: 0 };
    const staffTranspositions = new Map<number, Transposition>();
    for (const [index, m] of children(element, 'measure').entries()) {
      let cursor = 0;
      let last: ScoreNote | undefined;
      const harmonyByTime = new Map<number, string>();
      const attrs = child(m, 'attributes');
      const applyAttributes = (attributes: Element) => {
        divisions = number(attributes, 'divisions', divisions);
        const time = child(attributes, 'time');
        if (time) {
          partBeats = number(time, 'beats', partBeats); partBeatType = number(time, 'beat-type', partBeatType);
          if (partNo === 0 && !openingMeter) { beats = partBeats; beatType = partBeatType; openingMeter = true; }
        }
        const k = child(attributes, 'key');
        if (k) { partKey = number(k, 'fifths', partKey); partKeyMode = value(k, 'mode') === 'minor' ? 'minor' : 'major'; if (partNo === 0 && index === 0) { key = partKey; keyMode = partKeyMode; } }
        const clefElement = children(attributes, 'clef').find(c => Number(c.getAttribute('number') || 1) === 1);
        if (clefElement) {
          const sign = value(clefElement, 'sign');
          partClef = sign === 'F' ? 'bass' : sign === 'C' ? number(clefElement, 'line', 3) === 4 ? 'tenor' : 'alto' : sign === 'percussion' ? 'percussion' : sign === 'TAB' ? 'tab' : 'treble';
        }
        const forPart = children(attributes, 'for-part').map(item => musicXmlTranspose(child(item, 'part-transpose'))).find(Boolean);
        if (concertScore && forPart) partTransposition = forPart;
        else for (const item of children(attributes, 'transpose')) {
          const interval = musicXmlTranspose(item)!;
          const staffNumber = Number(item.getAttribute('number'));
          if (staffNumber > 0) staffTranspositions.set(staffNumber, interval);
          else partTransposition = interval;
        }
        staffMap.forEach((part, staff) => {
          const measure = part.measures[index];
          if (!measure) return;
          const clefElement = children(attributes, 'clef').find(c => Number(c.getAttribute('number') || 1) === staff);
          if (clefElement) { const sign = value(clefElement, 'sign'); part.clef = sign === 'F' ? 'bass' : sign === 'C' ? number(clefElement, 'line', 3) === 4 ? 'tenor' : 'alto' : sign === 'percussion' ? 'percussion' : sign === 'TAB' ? 'tab' : 'treble'; }
          measure.key = partKey; if (partKeyMode) measure.keyMode = partKeyMode; measure.clef = part.clef; measure.beatsPerBar = partBeats; measure.beatType = partBeatType;
          measure.nominalBeats = partBeats * 4 / partBeatType;
        });
      };
      if (attrs) applyAttributes(attrs);
      const measureBeats = partBeats * 4 / partBeatType;
      const ensure = (staff: number) => {
        const transposition = staffTranspositions.get(staff) || partTransposition;
        if (!staffMap.has(staff)) {
          const clefEl = attrs && children(attrs, 'clef').find(c => Number(c.getAttribute('number') || 1) === staff);
          const sign = clefEl ? value(clefEl, 'sign') : '';
          const clef = sign === 'F' ? 'bass' : sign === 'C' ? number(clefEl!, 'line', 3) === 4 ? 'tenor' : 'alto' : sign === 'percussion' ? 'percussion' : sign === 'TAB' ? 'tab' : partClef || (/bass/i.test(name) ? 'bass' : 'treble');
          staffMap.set(staff, { id: `${id}-${staff}`, name: staff === 1 ? name : `${name} · ${staff}`, clef, key: partKey, ...(partKeyMode ? { keyMode: partKeyMode } : {}), instrument: drumKit ? 'drum-kit' : gm ? gm.icon as Part['instrument'] : instrumentForName(name), gmProgram: gm?.program, gmSoundfont: gm?.soundfont, pitchBasis: concertScore ? 'concert' : 'written', transposition, measures: Array.from({ length: index }, (_, i) => empty(i, measureBeats)) });
        }
        const p = staffMap.get(staff)!;
        if (!p.measures[index]) p.measures[index] = { ...empty(index, measureBeats), nominalBeats: measureBeats, number: m.getAttribute('number') || String(index + 1), implicit: m.getAttribute('implicit') === 'yes', key: partKey, ...(partKeyMode ? { keyMode: partKeyMode } : {}), clef: p.clef, beatsPerBar: partBeats, beatType: partBeatType };
        p.measures[index].transposition = transposition;
        return p.measures[index];
      };
      staffMap.forEach((_, staff) => ensure(staff));
      for (const item of Array.from(m.children)) {
        if (item.localName === 'attributes') { if (item !== attrs) applyAttributes(item); continue; }
        if (item.localName === 'harmony') {
          const symbol = musicXmlHarmony(item);
          if (symbol) harmonyByTime.set(cursor + number(item, 'offset') / divisions, symbol);
        }
        if (item.localName === 'direction') {
          const sound = child(item, 'sound');
          const metronome = child(item, 'direction-type') && child(child(item, 'direction-type'), 'metronome');
          const metronomeUnit = metronome && value(metronome, 'beat-unit');
          const unitLength = metronomeUnit ? durationBeats(metronomeUnit, metronome ? children(metronome, 'beat-unit-dot').length : 0) : 1;
          const t = Number(sound?.getAttribute('tempo') || (metronome ? value(metronome, 'per-minute') : 0)) * (sound?.hasAttribute('tempo') ? 1 : unitLength);
          if (t > 0 && partNo === 0 && !openingTempo) { tempo = t; openingTempo = true; }
          const dynamics = children(item, 'direction-type').flatMap(type => children(type, 'dynamics')).flatMap(mark => Array.from(mark.children));
          const measure = ensure(number(item, 'staff', 1));
          const start = Math.max(0, cursor + number(item, 'offset') / divisions);
          const symbols = dynamics.map(mark => (mark.localName === 'other-dynamics' ? mark.textContent || '' : mark.localName).trim().toLowerCase()).filter(Boolean);
          const text = children(item, 'direction-type').flatMap(type => children(type, 'words')).map(word => word.textContent?.trim() || '').filter(Boolean).join(' ');
          const wedge = children(item, 'direction-type').flatMap(type => children(type, 'wedge'))[0];
          const soundDynamics = sound?.hasAttribute('dynamics') ? Number(sound.getAttribute('dynamics')) : undefined;
          if (symbols.length || text || wedge || t > 0 || soundDynamics !== undefined) (measure.directions ||= []).push({ start, symbols, text, placement: item.getAttribute('placement') === 'above' ? 'above' : 'below', voice: value(item, 'voice') || undefined, wedge: wedge ? { type: wedge.getAttribute('type') || '', number: wedge.getAttribute('number') || '1' } : undefined, soundDynamics, tempo: t > 0 ? t : undefined });
          for (const symbol of symbols) (measure.dynamics ||= []).push({ start, symbol });
        }
        if (item.localName === 'backup') { cursor = Math.max(0, cursor - number(item, 'duration') / divisions); last = undefined; }
        if (item.localName === 'forward') { cursor += number(item, 'duration') / divisions; last = undefined; }
        if (item.localName !== 'note') continue;
        const staff = number(item, 'staff', 1);
        const measure = ensure(staff);
        const chord = Boolean(child(item, 'chord'));
        const grace = Boolean(child(item, 'grace'));
        const duration = grace ? 0 : child(item, 'duration') ? number(item, 'duration') / divisions : durationBeats(value(item, 'type'), children(item, 'dot').length);
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
        const notePitch = basePitch && !rest ? { ...basePitch, sourceId, accidental: accidentalElement?.textContent?.trim(), cautionary: accidentalElement?.getAttribute('cautionary') === 'yes' || accidentalElement?.getAttribute('parentheses') === 'yes', tieStart: children(item, 'tie').some(t => t.getAttribute('type') === 'start'), tieStop: children(item, 'tie').some(t => t.getAttribute('type') === 'stop') } : undefined;
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
          last = { id: `${id}-${staff}-${index}-${measure.notes.length}`, sourceId, start: onset, duration, pitches: notePitch ? [notePitch] : [], transposition: staffTranspositions.get(staff) || partTransposition, chordSymbol: harmonyByTime.get(onset), rest, dotted: Boolean(child(item, 'dot')), dots: children(item, 'dot').length, writtenType: value(item, 'type') || undefined, voice: value(item, 'voice') || '1', stem: value(item, 'stem') || undefined, grace, tuplet, slurStart: children(notations || item, 'slur').filter(s => s.getAttribute('type') === 'start').map(s => s.getAttribute('number') || '1'), slurStop: children(notations || item, 'slur').filter(s => s.getAttribute('type') === 'stop').map(s => s.getAttribute('number') || '1'), tieStart: notePitch?.tieStart, tieStop: notePitch?.tieStop };
          measure.notes.push(last);
        }
        if (!chord && !grace) cursor += duration;
      }
      for (const part of staffMap.values()) {
        const measure = part.measures[index];
        if (measure?.implicit) measure.beats = Math.max(cursor, ...measure.notes.map(note => note.start + note.duration), 0);
      }
    }
    parts.push(...Array.from(staffMap.values()).sort((a, b) => Number(a.id.split('-').pop()) - Number(b.id.split('-').pop())));
  }
  // Builder-style scores can contain many placeholder instruments with only
  // rests. They obscure the playable staves in the continuous reader. A silent
  // staff is kept only when its directions shape playback: a tempo, or
  // dynamics/wedges that apply to a sounding sibling staff of the same part.
  // Plain words (e.g. a template's "(Easy 3)" label) do not make it playable.
  const sounding = (part: Part) => part.measures.some(measure => measure.notes.some(note => note.pitches.length > 0));
  const sourcePart = (part: Part) => part.id.replace(/-\d+$/, '');
  const soundingSources = new Set(parts.filter(sounding).map(sourcePart));
  const shapesPlayback = (part: Part) => part.measures.some(measure => measure.directions?.some(direction => (direction.tempo ?? 0) > 0
    || (soundingSources.has(sourcePart(part)) && (direction.symbols?.length || direction.wedge || direction.soundDynamics !== undefined))));
  const playableParts = parts.filter(part => sounding(part) || shapesPlayback(part));
  const score = linkTabParts(normalized({ title, subtitle, composer, credits: otherCredits, source: 'MusicXML', tempo, beats, beatType, key, ...(keyMode ? { keyMode } : {}), parts: playableParts.length ? playableParts : parts }));
  // Navigation is read once from the first source part and shared by every staff.
  const navigationNotes: string[] = [];
  attachNavigation(score, musicXmlNavigation(root, score.parts[0].measures.length, navigationNotes));
  return { score, engravingText, inventory: sourceFeatureInventory(text), diagnostics: navigationDiagnostics(navigationNotes) };
}

/** The former timeline's DOM readers of articulation marks and pedals. */
type NoteMark = { durationScale: number; velocityDelta: number; fermata: boolean; silent: boolean };
export function sourceNoteMarks(xml: string | undefined, diagnostics: string[]): Map<string, NoteMark> {
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
export function sourcePedals(xml: string | undefined, diagnostics: string[]): Map<string, PedalChange[]> {
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


/** The former musicXmlTextNavigation. */
export function referenceTextNavigation(xml: string, measureCount: number, diagnostics: string[]): MeasureNavigation[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) { diagnostics.push('MusicXML navigation could not be parsed.'); return Array.from({ length: measureCount }, () => ({})); }
  return musicXmlNavigation(doc.documentElement, measureCount, diagnostics);
}
