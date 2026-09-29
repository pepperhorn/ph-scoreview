import type { Score, ScoreNote } from '../score';
import { sha256Hex } from '../file-state';

export type SourceFormat = 'musicxml' | 'mxl' | 'mei' | 'abc' | 'midi' | 'sample';
export type EngravingFormat = 'musicxml' | 'mei';
export type SourceDiagnostic = { feature: string; status: 'retained' | 'partial' | 'unsupported'; location: string; message: string };
export type SourceIdentity = {
  /** Legacy settings key -> source part and staff. */
  staffIdToSource: Record<string, { partId: string; staff: number; sourceId?: string }>;
  /** Source element ID -> existing ScoreNote ID. Several source pitches can share a chord ID. */
  sourceIdToNoteId: Record<string, string>;
  /** Existing ScoreNote ID -> first source note element ID. */
  noteIdToSourceId: Record<string, string>;
};
export type SourceDocument = Readonly<{
  format: SourceFormat;
  engravingFormat: EngravingFormat;
  /** Original XML or ABC text; for MXL this is the extracted score member. */
  originalText?: string;
  /** Direct-import XML/MEI; it may contain IDs or timewise normalization. */
  engravingText: string;
  /** SHA-256 of original file bytes (archive bytes for MXL). */
  sha256?: string;
  filename?: string;
  featureCounts: Readonly<Record<string, number>>;
  diagnostics: readonly SourceDiagnostic[];
  identity: SourceIdentity;
  readOriginalBytes: () => Uint8Array;
}>;

const encoder = new TextEncoder();
const xmlId = (id: string) => `n_${id.replace(/[^A-Za-z0-9_.-]/g, '_')}`;
const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export async function sha256(bytes: Uint8Array): Promise<string> {
  return sha256Hex(bytes);
}

export function sourceFeatureInventory(text: string, format: SourceFormat): { featureCounts: Record<string, number>; diagnostics: SourceDiagnostic[] } {
  if (!['musicxml', 'mxl', 'mei'].includes(format)) return { featureCounts: {}, diagnostics: [] };
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

export function makeSourceDocument(args: {
  format: SourceFormat; engravingFormat: EngravingFormat; originalBytes?: Uint8Array; originalText?: string;
  engravingText: string; filename?: string; sha256?: string; identity?: SourceIdentity;
  diagnostics?: SourceDiagnostic[];
}): SourceDocument {
  const bytes = args.originalBytes?.slice() || encoder.encode(args.originalText || '');
  const inventory = sourceFeatureInventory(args.originalText || args.engravingText, args.format);
  return Object.freeze({
    format: args.format, engravingFormat: args.engravingFormat, originalText: args.originalText,
    engravingText: args.engravingText, filename: args.filename, sha256: args.sha256,
    featureCounts: Object.freeze(inventory.featureCounts), diagnostics: Object.freeze([...inventory.diagnostics, ...(args.diagnostics || [])]),
    identity: args.identity || { staffIdToSource: {}, sourceIdToNoteId: {}, noteIdToSourceId: {} },
    readOriginalBytes: () => bytes.slice(),
  });
}

export function normalizeTimewiseMusicXml(text: string): string {
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

/** Make stable source IDs in an engraving copy. The original source is untouched. */
export function identifyMusicXmlNotes(text: string): { text: string; sourceIds: string[] } {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('This file is not valid XML.');
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

type Segment = { note: ScoreNote; start: number; duration: number; continuation: number };
function durationPieces(beats: number): { beats: number; dur: string; dots?: number }[] {
  const values = [4, 3, 2, 1.5, 1, .75, .5, .375, .25, .1875, .125, .0625];
  const result: { beats: number; dur: string; dots?: number }[] = [];
  let left = Math.round(beats * 64) / 64;
  while (left > 1e-6) {
    const value = values.find(v => v <= left + 1e-6) || .0625;
    const base = [4, 2, 1, .5, .25, .125, .0625].find(v => value === v || value === v * 1.5) || .0625;
    result.push({ beats: value, dur: String(4 / base), dots: value === base * 1.5 ? 1 : undefined });
    left -= value;
  }
  return result;
}
function meiPitch(note: ScoreNote, index: number, continuation: number, dur: string, dots?: number, pieceIndex = 0): string {
  const pitch = note.pitches[index];
  const source = xmlId(note.id) + (note.pitches.length > 1 ? `_p${index + 1}` : '') + (continuation ? `_c${continuation}` : '') + (pieceIndex ? `_s${pieceIndex}` : '');
  const accidental = pitch.alter === 2 ? 'ss' : pitch.alter === -2 ? 'ff' : pitch.alter === 1 ? 's' : pitch.alter === -1 ? 'f' : 'n';
  const tie = continuation ? 'm' : pitch.tieStart && pitch.tieStop ? 'm' : pitch.tieStart ? 'i' : pitch.tieStop ? 't' : undefined;
  return `<note xml:id="${escape(source)}" pname="${escape(pitch.step.toLowerCase())}" oct="${pitch.octave}" ${pitch.alter ? `accid.ges="${accidental}"` : ''} ${pitch.accidental ? `accid="${accidental}"` : ''} ${tie ? `tie="${tie}"` : ''} ${note.pitches.length === 1 ? `dur="${dur}"${dots ? ` dots="${dots}"` : ''}` : ''}/>`;
}
function meiEvent(note: ScoreNote, continuation: number, dur: string, dots?: number, pieceIndex = 0): string {
  if (!note.pitches.length) return `<rest dur="${dur}"${dots ? ` dots="${dots}"` : ''}/>`;
  const lyric = note.lyric && !continuation ? `<verse n="1"><syl>${escape(note.lyric)}</syl></verse>` : '';
  if (note.pitches.length === 1) return meiPitch(note, 0, continuation, dur, dots, pieceIndex).replace('/>', `>${lyric}</note>`);
  return `<chord xml:id="${escape(xmlId(note.id) + (continuation ? `_c${continuation}` : '') + (pieceIndex ? `_s${pieceIndex}` : ''))}" dur="${dur}"${dots ? ` dots="${dots}"` : ''}>${note.pitches.map((_, index) => meiPitch(note, index, continuation, dur, dots, pieceIndex)).join('')}${lyric}</chord>`;
}
function layerXml(segments: Segment[], beats: number): string {
  let cursor = 0;
  const tokens: string[] = [];
  let beaming = false;
  for (const segment of segments.sort((a, b) => a.start - b.start || a.note.id.localeCompare(b.note.id))) {
    const gap = Math.max(0, segment.start - cursor);
    if (gap) tokens.push(...durationPieces(gap).map(piece => `<rest dur="${piece.dur}"${piece.dots ? ` dots="${piece.dots}"` : ''}/>`));
    if (segment.note.beamStart && !beaming) { tokens.push('<beam>'); beaming = true; }
    for (const [pieceIndex, piece] of durationPieces(segment.duration).entries()) tokens.push(meiEvent(segment.note, segment.continuation, piece.dur, piece.dots, pieceIndex));
    if (segment.note.beamEnd && beaming) { tokens.push('</beam>'); beaming = false; }
    cursor = Math.max(cursor, segment.start + segment.duration);
  }
  if (beaming) tokens.push('</beam>');
  if (beats - cursor > 1e-6) tokens.push(...durationPieces(beats - cursor).map(piece => `<rest dur="${piece.dur}"${piece.dots ? ` dots="${piece.dots}"` : ''}/>`));
  return tokens.join('');
}

/** A semantic MEI adapter for the reduced ABC/MIDI/demo model. Never use this for MusicXML or MEI originals. */
export function scoreToMei(score: Score): string {
  const count = Math.max(0, ...score.parts.map(part => part.measures.length));
  const meter = `meter.count="${score.beats}" meter.unit="${score.beatType}"`;
  const key = score.key ? ` key.sig="${Math.abs(score.key)}${score.key > 0 ? 's' : 'f'}"` : ' key.sig="0"';
  const staffDefs = score.parts.map((part, index) => `<staffDef n="${index + 1}" label="${escape(part.name)}" clef.shape="${part.clef === 'bass' ? 'F' : part.clef === 'alto' ? 'C' : part.clef === 'percussion' ? 'perc' : 'G'}" clef.line="${part.clef === 'bass' ? 4 : part.clef === 'alto' ? 3 : 2}"/>`).join('');
  const measures = Array.from({ length: count }, (_, measureIndex) => {
    const staves = score.parts.map((part, staffIndex) => {
      const measure = part.measures[measureIndex];
      const beats = measure?.implicit ? measure.beats : measure?.nominalBeats || score.beats * 4 / score.beatType;
      const incoming: Segment[] = [];
      for (let sourceMeasure = 0; sourceMeasure <= measureIndex; sourceMeasure++) {
        const source = part.measures[sourceMeasure]; if (!source) continue;
        const nominal = source.nominalBeats || score.beats * 4 / score.beatType;
        for (const note of source.notes) {
          const absolute = sourceMeasure * nominal + note.start;
          const measureStart = measureIndex * nominal;
          const overlapStart = Math.max(absolute, measureStart);
          const overlapEnd = Math.min(absolute + note.duration, measureStart + beats);
          if (overlapEnd > overlapStart + 1e-6) incoming.push({ note, start: overlapStart - measureStart, duration: overlapEnd - overlapStart, continuation: sourceMeasure === measureIndex ? 0 : measureIndex - sourceMeasure });
        }
      }
      // Separate overlapping voices while retaining each ABC voice where present.
      const layers: Segment[][] = [];
      const ends: number[] = [];
      for (const segment of incoming.sort((a, b) => a.start - b.start || a.note.id.localeCompare(b.note.id))) {
        const preferred = segment.note.voice ? Number(segment.note.voice) - 1 : -1;
        let layer = preferred >= 0 && ends[preferred] <= segment.start + 1e-6 ? preferred : ends.findIndex(end => end <= segment.start + 1e-6);
        if (layer < 0) layer = ends.length;
        (layers[layer] ||= []).push(segment); ends[layer] = segment.start + segment.duration;
      }
      return `<staff n="${staffIndex + 1}">${(layers.length ? layers : [[]]).map((layer, index) => `<layer n="${index + 1}">${layerXml(layer, beats)}</layer>`).join('')}</staff>`;
    }).join('');
    const harmonies = score.parts.flatMap((part, index) => part.measures[measureIndex]?.notes.filter(note => note.chordSymbol).map(note => `<harm staff="${index + 1}" tstamp="${1 + note.start}" >${escape(note.chordSymbol || '')}</harm>`) || []).join('');
    const tempo = measureIndex === 0 ? `<tempo tstamp="1" midi.bpm="${score.tempo}">${score.tempo}</tempo>` : '';
    return `<measure n="${measureIndex + 1}">${staves}${harmonies}${tempo}</measure>`;
  }).join('');
  return `<?xml version="1.0" encoding="utf-8"?><mei xmlns="http://www.music-encoding.org/ns/mei" meiversion="5.0"><meiHead><fileDesc><titleStmt><title>${escape(score.title)}</title>${score.composer ? `<respStmt><persName role="composer">${escape(score.composer)}</persName></respStmt>` : ''}</titleStmt><pubStmt/></fileDesc></meiHead><music><body><mdiv><score><scoreDef ${meter}${key}><staffGrp>${staffDefs}</staffGrp></scoreDef><section>${measures}</section></score></mdiv></body></music></mei>`;
}

export function identityForScore(score: Score): SourceIdentity {
  const identity: SourceIdentity = { staffIdToSource: {}, sourceIdToNoteId: {}, noteIdToSourceId: {} };
  for (const part of score.parts) {
    const match = /^(.*)-(\d+)$/.exec(part.id);
    identity.staffIdToSource[part.id] = { partId: match?.[1] || part.id, staff: match ? Number(match[2]) : 1 };
    for (const measure of part.measures) for (const note of measure.notes) {
      const sourceIds = [note.sourceId, ...note.pitches.map(p => p.sourceId)].filter((id): id is string => Boolean(id));
      if (!sourceIds.length) sourceIds.push(...(note.pitches.length > 1 ? note.pitches.map((_, index) => `${xmlId(note.id)}_p${index + 1}`) : [xmlId(note.id)]));
      identity.noteIdToSourceId[note.id] = sourceIds[0];
      for (const id of sourceIds) identity.sourceIdToNoteId[id] = note.id;
    }
  }
  return identity;
}
