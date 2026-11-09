import { instrumentForName, instrumentForProgram, midiPitch, pitch, type BarlineNavigation, type KeyMode, type Measure, type MeasureNavigation, type Part, type Score, type ScoreNote, type Transposition } from './score';
import { IdentityBuilder, identityForScore, makeSourceDocument, scoreToMei, type SourceDocument } from './notation/document';
import { abcDecorationWord, attachNavigation, endingNumbers, meiNavigation, navigationWord, resolveCodaSigns, type NavigationWord } from './notation/navigation';
import { durationBeats, normalizedScore as normalized, readMusicXml } from './notation/musicxml-source';
import { formatFraction, fromNumber } from './playback/fraction';
import { fileSourceFor, type FileSource } from './file-state';
import { extractMxlScore, formatMb, MAX_SCORE_FILE_BYTES } from './mxl';
import type { ImportReply, ImportRequest } from './import-protocol';
import { registerBaseTimeline, type BaseTimeline } from './playback/timeline';

export { extractMxlScore, MAX_SCORE_FILE_BYTES, MXL_MAX_SCORE_BYTES } from './mxl';

// DOM helpers for MEI, which is read on the main thread (MusicXML is read by the streaming reader, see below).
const children = (node: Element, tag: string) => Array.from(node.children).filter(el => el.localName === tag);
const parseXml = (text: string) => {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('This file is not valid XML.');
  return doc;
};
const empty = (index: number, beats: number): Measure => ({ index, beats, notes: [] });

/**
 * Read MusicXML text on the calling thread (small sources: tests, the musicXml prop fallback). Files are read by the
 * import worker instead (importScoreFile). Both use the same single-pass streaming reader.
 */
export function parseMusicXml(text: string): Score {
  const read = readMusicXml(text);
  const score = read.score;
  score.document = makeSourceDocument({ format: 'musicxml', engravingFormat: 'musicxml', originalText: text, engravingText: read.engravingText, identity: identityForScore(score), inventory: read.inventory, diagnostics: read.diagnostics });
  return score;
}

export function parseMei(text: string): Score {
  const doc = parseXml(text);
  if (doc.documentElement.localName !== 'mei') throw new Error('This file is not an MEI document.');
  const everything = Array.from(doc.getElementsByTagName('*'));
  const all = (tag: string) => everything.filter(e => e.localName === tag);
  // One part per staff number; later staffDefs (score changes) only update state.
  const defs = [...new Map(all('staffDef').map((def, i) => [def.getAttribute('n') || String(i + 1), def])).values()];
  const measures = all('measure');
  // Walk the document in order so later <scoreDef>/<staffDef> key and meter
  // changes (attributes or <keySig>/<meterSig> children) apply from that point.
  const parseKey = (sig: string | null | undefined) => {
    const match = /^(\d+)([sf])$/.exec((sig || '').trim());
    return sig?.trim() === '0' ? 0 : match ? Number(match[1]) * (match[2] === 'f' ? -1 : 1) : undefined;
  };
  const defKey = (def: Element) => parseKey(def.getAttribute('key.sig')) ?? parseKey(def.getAttribute('keysig')) ?? parseKey(children(def, 'keySig')[0]?.getAttribute('sig'));
  // Each key area's mode: a key without one is major (so a change back from minor is major again).
  const defMode = (def: Element): KeyMode => (def.getAttribute('key.mode') || children(def, 'keySig')[0]?.getAttribute('mode')) === 'minor' ? 'minor' : 'major';
  const defMeter = (def: Element) => {
    const sig = children(def, 'meterSig')[0];
    const count = Number(def.getAttribute('meter.count') || sig?.getAttribute('count'));
    const unit = Number(def.getAttribute('meter.unit') || sig?.getAttribute('unit'));
    return count > 0 && unit > 0 ? { count, unit } : undefined;
  };
  let meterNow: { count: number; unit: number } | undefined;
  let defaultKey: number | undefined;
  const staffKeys = new Map<string, number>();
  let defaultMode: KeyMode = 'major';
  const staffModes = new Map<string, KeyMode>();
  const measureState: { count: number; unit: number; keys: Map<string, number>; defaultKey: number; modes: Map<string, KeyMode>; defaultMode: KeyMode }[] = [];
  let openingMeter: { count: number; unit: number } | undefined;
  let openingKey: number | undefined;
  for (const el of everything) {
    if (el.localName === 'scoreDef') {
      const k = defKey(el);
      if (k !== undefined) { defaultKey = k; staffKeys.clear(); defaultMode = defMode(el); staffModes.clear(); }
      meterNow = defMeter(el) || meterNow;
    } else if (el.localName === 'staffDef') {
      const k = defKey(el);
      if (k !== undefined) { staffKeys.set(el.getAttribute('n') || '1', k); staffModes.set(el.getAttribute('n') || '1', defMode(el)); }
      meterNow = defMeter(el) || meterNow;
    } else if (el.localName === 'measure') {
      openingMeter ||= meterNow;
      if (openingKey === undefined) openingKey = staffKeys.values().next().value ?? defaultKey;
      measureState.push({ count: meterNow?.count || 4, unit: meterNow?.unit || 4, keys: new Map(staffKeys), defaultKey: defaultKey || 0, modes: new Map(staffModes), defaultMode });
    }
  }
  const beats = openingMeter?.count || meterNow?.count || 4;
  const beatType = openingMeter?.unit || meterNow?.unit || 4;
  const key = openingKey ?? defaultKey ?? 0;
  const alteredByKey = (fifths: number, step: string) => fifths > 0 ? ('FCGDAEB'.slice(0, fifths).includes(step) ? 1 : 0) : ('BEADGCF'.slice(0, -fifths).includes(step) ? -1 : 0);
  const accidValues: Record<string, number> = { s: 1, f: -1, ss: 2, x: 2, ff: -2, xs: 3, sx: 3, ts: 3, tf: -3, n: 0, nf: -1, ns: 1 };
  /** Repeat <barLine>s inside the first layer of the first staff, by measure index. */
  const innerBarlines = new Map<number, BarlineNavigation[]>();
  const parts: Part[] = defs.map((def, i) => {
    const n = def.getAttribute('n') || String(i + 1);
    const name = def.getAttribute('label') || `Staff ${n}`;
    const sign = def.getAttribute('clef.shape');
    const clef = sign === 'F' ? 'bass' : sign === 'C' ? 'alto' : sign === 'perc' ? 'percussion' : 'treble';
    const transposition: Transposition = { semitones: Number(def.getAttribute('trans.semi')) || 0, diatonic: def.hasAttribute('trans.diat') ? Number(def.getAttribute('trans.diat')) : undefined };
    return { id: n, name, clef, key: measureState[0]?.keys.get(n) ?? measureState[0]?.defaultKey ?? key, instrument: instrumentForName(name), pitchBasis: 'written', transposition, measures: measures.map((measure, index) => {
      const state = measureState[index] || { count: beats, unit: beatType, keys: new Map<string, number>(), defaultKey: key, modes: new Map<string, KeyMode>(), defaultMode: 'major' as KeyMode };
      const staffKey = state.keys.get(n) ?? state.defaultKey;
      const out: Measure = { ...empty(index, state.count * 4 / state.unit), nominalBeats: state.count * 4 / state.unit, number: measure.getAttribute('n') || String(index + 1), key: staffKey, keyMode: state.modes.get(n) ?? state.defaultMode, beatsPerBar: state.count, beatType: state.unit };
      const staff = Array.from(measure.getElementsByTagName('*')).find(e => e.localName === 'staff' && e.getAttribute('n') === n);
      if (!staff) return out;
      // Written accidentals persist for the same step and octave until the barline.
      const written = new Map<string, { time: number; alter: number }[]>();
      const bySourceId = new Map<string, ScoreNote>();
      const sourceId = (el: Element) => el.getAttribute('xml:id') || el.getAttributeNS('http://www.w3.org/XML/1998/namespace', 'id') || undefined;
      const layers = Array.from(staff.children).filter(e => e.localName === 'layer');
      for (const [layerIndex, layer] of (layers.length ? layers : [staff]).entries()) {
        let cursor = 0;
        const walk = (parent: Element, ratio = 1, beam = false, tuplet?: ScoreNote['tuplet']) => {
          const events = Array.from(parent.children).filter(e => ['note', 'chord', 'rest', 'mRest', 'space', 'beam', 'tuplet', 'barLine'].includes(e.localName));
          for (const [eventIndex, el] of events.entries()) {
            const kind = el.localName;
            if (kind === 'barLine') {
              const form = el.getAttribute('form') || '';
              if (i === 0 && layerIndex === 0 && /^rpt(start|end|both)$/.test(form)) {
                const list = innerBarlines.get(index) || [];
                list.push({ beat: formatFraction(fromNumber(cursor)), ...(form !== 'rptend' ? { repeatStart: true } : {}), ...(form !== 'rptstart' ? { repeatEnd: true } : {}) });
                innerBarlines.set(index, list);
              }
              continue;
            }
            if (kind === 'beam') { walk(el, ratio, true, tuplet); continue; }
            if (kind === 'tuplet') {
              const actual = Number(el.getAttribute('num')) || 3, normal = Number(el.getAttribute('numbase')) || 2;
              walk(el, ratio * normal / actual, beam, { actual, normal, number: el.getAttribute('n') || '1', start: true, stop: true });
              continue;
            }
            const grace = el.getAttribute('grace') !== null;
            const duration = grace ? 0 : kind === 'mRest' ? out.beats : durationBeats(el.getAttribute('dur') || '4', Number(el.getAttribute('dots') || 0)) * ratio;
            const noteEls = kind === 'chord' ? Array.from(el.children).filter(e => e.localName === 'note') : kind === 'note' ? [el] : [];
            const pitches = noteEls.map(e => {
              const step = (e.getAttribute('pname') || 'c').toUpperCase();
              const octave = Number(e.getAttribute('oct') || 4);
              const accidChild = children(e, 'accid')[0];
              // MEI precedence: accid.ges > written accid (attribute or <accid>) > measure state > key.
              const gestural = accidValues[e.getAttribute('accid.ges') || accidChild?.getAttribute('accid.ges') || ''];
              const shown = accidValues[e.getAttribute('accid') || accidChild?.getAttribute('accid') || ''];
              const pitchKey = `${step}${octave}`;
              if (shown !== undefined) written.set(pitchKey, [...(written.get(pitchKey) || []), { time: cursor, alter: shown }]);
              const prior = (written.get(pitchKey) || []).filter(entry => entry.time <= cursor + 1e-6).at(-1)?.alter;
              const tie = e.getAttribute('tie') || el.getAttribute('tie') || '';
              return { ...pitch(step, octave, gestural ?? shown ?? prior ?? alteredByKey(staffKey, step)), sourceId: sourceId(e), tieStart: /[im]/.test(tie), tieStop: /[tm]/.test(tie) };
            });
            const lyric = Array.from(el.getElementsByTagName('*')).filter(e => e.localName === 'syl').map(e => e.textContent?.trim() || '').filter(Boolean).join(' ');
            const parsed: ScoreNote = { id: `${n}-${index}-${out.notes.length}`, sourceId: sourceId(el), start: cursor, duration, pitches, rest: !pitches.length, voice: layer.getAttribute('n') || String(layerIndex + 1), beamStart: beam && eventIndex === 0, beamEnd: beam && eventIndex === events.length - 1, grace, tuplet, lyric: lyric || undefined };
            out.notes.push(parsed);
            for (const source of [el, ...noteEls]) { const id = sourceId(source); if (id) bySourceId.set(id, parsed); }
            cursor += duration;
          }
        };
        walk(layer);
      }
      for (const harmony of Array.from(measure.getElementsByTagName('*')).filter(e => e.localName === 'harm')) {
        const targetStaff = harmony.getAttribute('staff');
        if (targetStaff ? !targetStaff.split(/\s+/).includes(n) : i !== 0) continue;
        const symbol = harmony.textContent?.trim();
        if (!symbol) continue;
        const sourceId = harmony.getAttribute('startid')?.replace(/^#/, '');
        const stamp = Number(harmony.getAttribute('tstamp'));
        const targetStart = Number.isFinite(stamp) && stamp >= 1 ? (stamp - 1) * 4 / beatType : 0;
        const target = sourceId && bySourceId.get(sourceId) || out.notes.find(note => note.start >= targetStart - .001);
        if (target) target.chordSymbol = symbol;
      }
      return out;
    }) };
  });
  const titles = all('title');
  const title = (titles.find(e => ['main', 'uniform'].includes(e.getAttribute('type') || '')) || titles[0])?.textContent?.trim() || '';
  const subtitle = titles.find(e => ['subordinate', 'subtitle'].includes(e.getAttribute('type') || ''))?.textContent?.trim() || '';
  const composer = all('composer')[0]?.textContent?.trim() || all('persName').find(e => e.getAttribute('role') === 'composer')?.textContent?.trim() || '';
  // Key mode of the opening key (absent means major), for spelling minor keys' raised degrees.
  const openingDef = all('scoreDef')[0];
  const openingMode = openingDef?.getAttribute('key.mode') || openingDef?.getElementsByTagName('keySig')[0]?.getAttribute('mode');
  const score = normalized({ title, subtitle, composer, source: 'MEI', tempo: 100, beats, beatType, key, ...(openingMode === 'minor' ? { keyMode: 'minor' as const } : {}), parts });
  attachNavigation(score, meiNavigation(measures, innerBarlines));
  score.document = makeSourceDocument({ format: 'mei', engravingFormat: 'mei', originalText: text, engravingText: text, identity: identityForScore(score) });
  return score;
}

export async function parseAbc(text: string): Promise<Score> {
  const { default: abcjs } = await import('abcjs');
  const tune = (abcjs as any).parseOnly(text)[0];
  if (!tune?.lines?.length) throw new Error('No readable ABC tune was found.');
  const meter = tune.getMeterFraction?.() || { num: 4, den: 4 };
  const beats = Number(meter.num) || 4, beatType = Number(meter.den) || 4;
  // abcjs includes cancellation naturals in key changes; only sharps/flats count.
  const keyNumber = (signature: any) => (signature?.accidentals || []).reduce((n: number, a: any) => n + (a.acc === 'sharp' ? 1 : a.acc === 'flat' ? -1 : 0), 0);
  const keyMode = (signature: any): KeyMode => /^m(?:in)?$/i.test(signature?.mode || '') ? 'minor' : 'major';
  const abcClef = (clef: any): string => clef?.type === 'perc' ? 'percussion' : clef?.type === 'alto' && clef.clefPos === 8 ? 'tenor' : clef?.type || 'treble';
  const key = keyNumber(tune.getKeySignature?.());
  const firstStaff = tune.lines.find((line: any) => line.staff?.length)?.staff || [];
  const parts: Part[] = [];
  const map = new Map<string, Part>();
  for (const [staffIndex, staff] of firstStaff.entries()) for (const [voiceIndex] of (staff as any).voices.entries()) {
    const name = staff.title?.[voiceIndex] || staff.title?.[0] || (voiceIndex ? `Voice ${voiceIndex + 1}` : 'Melody');
    const percussion = staff.clef?.type === 'perc';
    const clef = abcClef(staff.clef);
    const part: Part = { id: `abc-${staffIndex}-${voiceIndex}`, name, clef, key: keyNumber(staff.key), keyMode: keyMode(staff.key), instrument: percussion ? 'drum-kit' : instrumentForName(name), measures: [] };
    parts.push(part); map.set(`${staffIndex}-${voiceIndex}`, part);
  }
  // Navigation is read from the first voice: abcjs puts repeat/ending marks on bars
  // (a bar ends one measure and may start the next) and D.C./Fine/segno on notes or bars.
  const nav = (measure: Measure) => (measure.navigation ||= {});
  let pendingStart: MeasureNavigation = {};
  let openEnding: number[] | undefined;
  let lastFilled: Measure | undefined;
  /** Coda signs written on a barline: the measure the barline ends and the one it starts. */
  const barlineCodas: { before: Measure; after?: Measure }[] = [];
  let pendingBarlineCoda: { before: Measure; after?: Measure } | undefined;
  const navigationWords = (item: any): NavigationWord[] => [
    ...(item.decoration || []).map((name: string) => abcDecorationWord(name)),
    ...(item.chord || []).map((chord: { name?: string }) => navigationWord(chord.name || '')),
  ].filter(Boolean);
  const applyWord = (word: NavigationWord, start: MeasureNavigation, end: MeasureNavigation | undefined) => {
    if (word === 'segno' || word === 'coda') start[word] = true;
    else if (end) end[word] = true;
  };
  const accidentalsByPart = new Map<Part, Map<string, number>>();
  for (const line of tune.lines) for (const [staffIndex, staff] of (line.staff || []).entries()) for (const [voiceIndex, voice] of (staff.voices || []).entries()) {
    const part = map.get(`${staffIndex}-${voiceIndex}`);
    if (!part) continue;
    const leading = part === parts[0];
    let current = part.measures.at(-1);
    if (!current || (current as any).closed) { current = empty(part.measures.length, beats * 4 / beatType); part.measures.push(current); }
    let cursor = current.notes.reduce((max, n) => Math.max(max, n.start + n.duration), 0);
    const accidentalMap = accidentalsByPart.get(part) || new Map<string, number>();
    accidentalsByPart.set(part, accidentalMap);
    let activeKey = staff.key || tune.getKeySignature?.();
    let activeClef = abcClef(staff.clef);
    // abcjs marks only the first note of a tuplet with its multiplier.
    let triplet: { multiplier: number; remaining: number; actual: number; first: boolean } | undefined;
    for (const item of voice) {
      if (item.el_type === 'key') { activeKey = item; accidentalMap.clear(); continue; }
      if (item.el_type === 'clef') { activeClef = abcClef(item); continue; }
      if (item.el_type === 'bar') {
        if (current.notes.length) {
          if (item.type === 'bar_thin_thick') current.rightBarline = 'end';
          if (item.type === 'bar_thin_thin') current.rightBarline = 'dbl';
        }
        if (leading) {
          const end = lastFilled && nav(lastFilled);
          if (end && ['bar_right_repeat', 'bar_dbl_repeat'].includes(item.type)) end.repeatEnd = true;
          // A mark on a bar ends the measure before it, except segno/coda, which start the next one.
          for (const word of navigationWords(item)) applyWord(word, pendingStart, end);
          if (lastFilled && navigationWords(item).includes('coda')) barlineCodas.push(pendingBarlineCoda = { before: lastFilled });
          if (item.endEnding) openEnding = undefined;
          if (['bar_left_repeat', 'bar_dbl_repeat'].includes(item.type)) pendingStart.repeatStart = true;
          if (item.startEnding) openEnding = endingNumbers(String(item.startEnding));
        }
        if (current.notes.length) (current as any).closed = true;
        current = empty(part.measures.length, beats * 4 / beatType); part.measures.push(current);
        cursor = 0; accidentalMap.clear(); continue;
      }
      if (item.el_type !== 'note') continue;
      if (!current.notes.length) { current.key = keyNumber(activeKey); current.keyMode = keyMode(activeKey); current.clef = activeClef; }
      if (item.startTriplet && Number(item.tripletMultiplier) > 0) triplet = { multiplier: Number(item.tripletMultiplier), remaining: Number(item.tripletR || item.startTriplet) || 3, actual: Number(item.startTriplet) || 3, first: true };
      const tupletInfo = triplet ? { actual: triplet.actual, normal: Math.max(1, Math.round(triplet.actual * triplet.multiplier)), number: '1', start: triplet.first, stop: Boolean(item.endTriplet) || triplet.remaining <= 1 } : undefined;
      const duration = Number(item.duration || .25) * 4 * (triplet?.multiplier ?? 1);
      if (triplet) { triplet.first = false; triplet.remaining--; if (item.endTriplet || triplet.remaining <= 0) triplet = undefined; }
      const pitches = (item.pitches || []).map((p: any) => {
        const degree = Number(p.pitch || 0);
        const steps = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
        const step = steps[((degree % 7) + 7) % 7];
        const octave = 4 + Math.floor(degree / 7);
        const explicit = ({ sharp: 1, flat: -1, natural: 0, dblsharp: 2, dblflat: -2 } as Record<string, number>)[p.accidental];
        if (explicit !== undefined) accidentalMap.set(`${step}${octave}`, explicit);
        const fromKey = (activeKey?.accidentals || []).find((a: any) => a.note.toUpperCase() === step);
        const alter = accidentalMap.get(`${step}${octave}`) ?? (fromKey?.acc === 'sharp' ? 1 : fromKey?.acc === 'flat' ? -1 : 0);
        // Percussion (clef=perc) is written by staff position: it keeps its written pitch for playback and is engraved
        // unpitched at that position.
        const position = part.clef === 'percussion' ? { unpitched: true, displayStep: step, displayOctave: octave } : {};
        return { ...pitch(step, octave, alter), ...position, ...(explicit !== undefined ? { accidental: p.accidental } : {}), tieStart: Boolean(p.startTie), tieStop: Boolean(p.endTie) };
      });
      if (leading) {
        if (!current.notes.length) {
          Object.assign(nav(current), pendingStart);
          pendingStart = {};
          if (pendingBarlineCoda) { pendingBarlineCoda.after = current; pendingBarlineCoda = undefined; }
          if (openEnding?.length) nav(current).endings = [...openEnding];
        }
        for (const word of navigationWords(item)) applyWord(word, nav(current), nav(current));
        lastFilled = current;
      }
      // Navigation text ("^D.C. al Fine") is a jump instruction, never a chord symbol.
      const chordSymbol = item.chord?.find((chord: { name?: string; position?: string }) => chord.position === 'default' && !navigationWord(chord.name || ''))?.name;
      for (const annotation of item.chord || []) {
        if (annotation.position === 'default' || navigationWord(annotation.name || '')) continue;
        (current.directions ||= []).push({ start: cursor, text: annotation.name, placement: annotation.position === 'below' ? 'below' : 'above' });
      }
      const lyric = item.lyric?.map((syllable: { syllable?: string; divider?: string }) => `${syllable.syllable || ''}${syllable.divider === '-' ? '-' : ''}`).filter(Boolean).join(' ');
      current.notes.push({ id: `abc-${staffIndex}-${voiceIndex}-${current.index}-${current.notes.length}`, start: cursor, duration, pitches, chordSymbol, lyric, beamStart: Boolean(item.startBeam), beamEnd: Boolean(item.endBeam), rest: !pitches.length, dotted: Boolean(item.dots), tuplet: tupletInfo, tieStart: pitches.some((p: { tieStart?: boolean }) => p.tieStart) || undefined, tieStop: pitches.some((p: { tieStop?: boolean }) => p.tieStop) || undefined });
      cursor += duration;
    }
  }
  const nominal = beats * 4 / beatType;
  parts.forEach(part => {
    part.measures = part.measures.filter(m => m.notes.length);
    part.measures.forEach((m, i) => {
      m.index = i;
      m.nominalBeats = nominal;
      // ABC is literal: a pickup, or a bar split by a mid-measure repeat, is only as long as its notes.
      const content = m.notes.reduce((max, note) => Math.max(max, note.start + note.duration), 0);
      if (content > 1e-6 && content < nominal - 1e-6) { m.implicit = true; m.beats = content; }
    });
  });
  const navigation = parts[0]?.measures.map(m => m.navigation || {}) || [];
  const measureIndex = (measure?: Measure) => measure ? parts[0]?.measures.indexOf(measure) ?? -1 : -1;
  const wasToCoda = barlineCodas.map(pair => Boolean(navigation[measureIndex(pair.after)]?.toCoda));
  resolveCodaSigns(navigation);
  // A barline coda sign that became To Coda is the jump at that barline: it ends the measure before it.
  barlineCodas.forEach((pair, i) => {
    const before = measureIndex(pair.before), after = measureIndex(pair.after);
    if (before < 0 || after < 0 || wasToCoda[i] || !navigation[after].toCoda) return;
    delete navigation[after].toCoda;
    navigation[before].toCoda = true;
  });
  const minor = /^m(?:in)?$/i.test(String(tune.getKeySignature?.()?.mode || ''));
  const score = normalized({ ...(minor ? { keyMode: 'minor' as const } : {}), title: tune.metaText?.title || '', subtitle: tune.lines.find((line: any) => line.subtitle)?.subtitle?.text || '', composer: tune.metaText?.composer || '', source: 'ABC', tempo: Number(tune.metaText?.tempo?.bpm) || 100, beats, beatType, key, parts });
  attachNavigation(score, navigation);
  score.document = makeSourceDocument({ format: 'abc', engravingFormat: 'mei', originalText: text, engravingText: scoreToMei(score), identity: identityForScore(score) });
  return score;
}

export async function parseMidi(buffer: ArrayBuffer): Promise<Score> {
  const { default: toneMidi } = await import('@tonejs/midi');
  const { Midi } = toneMidi;
  const midi = new Midi(buffer);
  const beats = midi.header.timeSignatures[0]?.timeSignature[0] || 4;
  const beatType = midi.header.timeSignatures[0]?.timeSignature[1] || 4;
  const tempo = Math.round(midi.header.tempos[0]?.bpm || 120);
  const measureSize = beats * 4 / beatType;
  const ppq = midi.header.ppq;
  const parts: Part[] = midi.tracks.filter(t => t.notes.length).map((track, ti) => {
    const name = track.name || track.instrument.name || `Track ${ti + 1}`;
    const measures: Measure[] = [];
    for (const note of track.notes) {
      const absolute = Math.round(note.ticks / ppq * 4) / 4;
      const duration = Math.max(.25, Math.round(note.durationTicks / ppq * 4) / 4);
      // Notes crossing a barline become tied pieces so measures keep their nominal length.
      let position = absolute, remaining = duration, piece = 0;
      while (remaining > 1e-6) {
        const index = Math.floor(position / measureSize + 1e-9);
        const start = position - index * measureSize;
        const length = Math.min(remaining, measureSize - start);
        while (measures.length <= index) measures.push(empty(measures.length, measureSize));
        const m = measures[index];
        const tieStop = piece > 0, tieStart = remaining - length > 1e-6;
        const sounding = { ...midiPitch(note.midi), ...(tieStart ? { tieStart } : {}), ...(tieStop ? { tieStop } : {}) };
        const chord = m.notes.find(n => Math.abs(n.start - start) < .001 && Math.abs(n.duration - length) < .001);
        if (chord) { chord.pitches.push(sounding); chord.tieStart ||= tieStart || undefined; chord.tieStop ||= tieStop || undefined; }
        else m.notes.push({ id: `midi-${ti}-${index}-${m.notes.length}`, start, duration: length, pitches: [sounding], ...(tieStart ? { tieStart } : {}), ...(tieStop ? { tieStop } : {}) });
        position += length; remaining -= length; piece++;
      }
    }
    return { id: `midi-${ti}`, name, clef: track.instrument.percussion ? 'percussion' : /bass/i.test(name) ? 'bass' : 'treble', instrument: track.instrument.percussion ? 'drum-kit' : instrumentForProgram(track.instrument.number), pitchBasis: 'concert' as const, measures };
  });
  const score = normalized({ title: midi.name || '', source: 'MIDI · quantized', tempo, beats, beatType, key: 0, parts });
  // MIDI has no written accidentals: show one wherever a pitch differs from the one in force on its line (C major, or
  // an earlier accidental in the measure), so a sharp is drawn and not just played.
  for (const part of score.parts) if (part.clef !== 'percussion') for (const measure of part.measures) {
    const inForce = new Map<string, number>();
    for (const note of measure.notes) for (const pitch of note.pitches) {
      const line = `${pitch.step}${pitch.octave}`;
      if (pitch.tieStop || pitch.alter === (inForce.get(line) ?? 0)) continue;
      pitch.accidental = pitch.alter > 0 ? 'sharp' : pitch.alter < 0 ? 'flat' : 'natural';
      inForce.set(line, pitch.alter);
    }
  }
  score.document = makeSourceDocument({ format: 'midi', engravingFormat: 'mei', originalBytes: new Uint8Array(buffer), engravingText: scoreToMei(score), identity: identityForScore(score) });
  return score;
}

/** What the import worker hands back: a parsed score, or the bytes of a format the main thread reads. */
type WorkerResult = { kind: 'score'; score: Score } | { kind: 'bytes'; bytes: Uint8Array };
type ImportJob = { sha256: Promise<string>; size: Promise<number | undefined>; result: Promise<WorkerResult> };
/**
 * Per channel (reader instance), the import whose score is still arriving; a newer import on the same channel stops
 * it. A job past its score finishes its timeline.
 */
const parsing = new Map<number, { worker: Worker; fail: (error: Error) => void }>();

/** A reader unmounted: stop its import still parsing (its score would never be shown). */
export function cancelImports(channel: number): void {
  parsing.get(channel)?.fail(new Error('Import cancelled.'));
}

/**
 * Run one import in a fresh worker (docs/specs/large-score-performance.md, Phase 2). The main thread only assembles
 * the Score from bounded chunks (each message is its own short task) and wraps the transferred bytes; it never
 * parses or hashes the file. The playback timeline arrives after the score and is registered for its document.
 */
function runImport(request: ImportRequest, file: File | undefined, channel: number): ImportJob {
  parsing.get(channel)?.fail(new Error('Superseded import.'));
  const worker = new Worker(new URL('./import.worker.ts', import.meta.url), { type: 'module' });
  let resolveHash!: (sha256: string) => void, resolveResult!: (result: WorkerResult) => void;
  let rejectHash!: (error: Error) => void, rejectResult!: (error: Error) => void;
  const sha256 = new Promise<string>((resolve, reject) => { resolveHash = resolve; rejectHash = reject; });
  const result = new Promise<WorkerResult>((resolve, reject) => { resolveResult = resolve; rejectResult = reject; });
  let timeline: { resolve: (timeline: BaseTimeline) => void; reject: (error: Error) => void; value?: BaseTimeline } | undefined;
  let score: Score | undefined;
  let hash: string | undefined, size: number | undefined;
  const identity = new IdentityBuilder();
  const stop = () => { worker.terminate(); if (parsing.get(channel)?.worker === worker) parsing.delete(channel); };
  const fail = (error: Error) => { stop(); rejectHash(error); rejectResult(error); timeline?.reject(error); };
  parsing.set(channel, { worker, fail });
  worker.onerror = event => { event.preventDefault(); fail(new Error(event.message || 'The score could not be read.')); };
  worker.onmessage = ({ data }: MessageEvent<ImportReply>) => {
    switch (data.kind) {
      case 'source': hash = data.sha256; size = data.size; resolveHash(data.sha256); break;
      case 'bytes': stop(); resolveResult({ kind: 'bytes', bytes: new Uint8Array(data.bytes) }); break;
      case 'head': score = data.score; score.parts.forEach(part => identity.part(part)); break;
      case 'measures': {
        const measures = score!.parts[data.part].measures;
        for (const measure of data.measures) measures.push(measure);
        identity.notes(data.measures);
        break;
      }
      case 'done': {
        if (parsing.get(channel)?.worker === worker) parsing.delete(channel);
        const original = data.original ? new Uint8Array(data.original) : undefined;
        const engraving = data.engraving ? new Uint8Array(data.engraving) : undefined;
        const text = request.kind === 'text' ? request.text : undefined;
        const document: SourceDocument = makeSourceDocument({
          format: data.format, engravingFormat: 'musicxml', originalBytes: original,
          // Files keep bytes only; their texts are decoded on demand (the MXL member is extracted again).
          originalText: text ?? (data.format === 'mxl' ? { bytes: original!, decode: () => extractMxlScore(original!) } : { bytes: original! }),
          engravingText: engraving ? { bytes: engraving } : text ?? { bytes: original! },
          filename: file?.name, sha256: hash, identity: identity.identity, inventory: data.inventory, diagnostics: data.diagnostics,
        });
        score!.document = document;
        const built = new Promise<BaseTimeline>((resolve, reject) => { timeline = { resolve, reject }; });
        // A timeline that never arrives is built on demand instead (baseTimelineFor).
        built.catch(() => {});
        registerBaseTimeline(document, built);
        resolveResult({ kind: 'score', score: score! });
        break;
      }
      case 'timeline': timeline!.value = data.timeline; break;
      case 'timeline-events': {
        const value = timeline!.value!;
        for (const event of data.events) value.events.push(event);
        for (const source of data.eventSources) value.eventSources.push(source);
        break;
      }
      case 'timeline-end': stop(); timeline!.resolve(timeline!.value!); break;
      case 'error': fail(new Error(data.message)); break;
    }
  };
  worker.postMessage(request);
  // Callers may use only one of the two promises.
  sha256.catch(() => {}); result.catch(() => {});
  const sizeKnown = sha256.then(() => size);
  sizeKnown.catch(() => {});
  return { sha256, size: sizeKnown, result };
}

/** An import of a score file: its source identity (available once hashed) and the score. */
export type ScoreImport = { source: Promise<FileSource>; score: Promise<Score> };

/**
 * Open a score file. The import worker reads and hashes it once and reads MusicXML/MXL off the main thread; MEI,
 * ABC and MIDI are small and are read here from the bytes the worker hands back. `channel` is the reader's (see
 * verovio-runtime openVerovioChannel): a newer import only supersedes imports on the same channel.
 */
export function importScoreFile(file: File, channel = 0): ScoreImport {
  if (file.size > MAX_SCORE_FILE_BYTES) {
    const error = Promise.reject(new Error(`This file is ${formatMb(file.size)}; scores up to ${formatMb(MAX_SCORE_FILE_BYTES)} can be opened.`));
    error.catch(() => {});
    return { source: error as Promise<never>, score: error as Promise<never> };
  }
  const job = runImport({ kind: 'file', file }, file, channel);
  const score = job.result.then(async result => {
    if (result.kind === 'score') return result.score;
    return readOnMainThread(file, result.bytes, await job.sha256);
  });
  return handled({ source: job.sha256.then(sha256 => fileSourceFor(file.name, file.size, sha256)), score });
}

/**
 * Callers may stop at either promise (the Reader stops at the source when the import fails or is superseded), so
 * neither may surface as an unhandled rejection; awaiting one still rejects as usual.
 */
function handled(job: ScoreImport): ScoreImport {
  job.source.catch(() => {});
  job.score.catch(() => {});
  return job;
}

/** Open a score file (see importScoreFile). */
export function importFile(file: File): Promise<Score> {
  return importScoreFile(file).score;
}

/**
 * Read MusicXML text the page already holds (the Reader's musicXml prop) in the import worker, which also takes its
 * source identity (the same as file-state.ts textSource, without hashing on the main thread). Superseded only by a
 * newer import on the same `channel`.
 */
export function importMusicXmlText(text: string, name = 'MusicXML', channel = 0): ScoreImport {
  const job = runImport({ kind: 'text', text }, undefined, channel);
  return handled({
    source: job.sha256.then(async sha256 => ({ name, size: (await job.size) ?? 0, sha256, format: 'musicxml' })),
    score: job.result.then(result => { if (result.kind !== 'score') throw new Error('This file is not a MusicXML score.'); return result.score; }),
  });
}

async function readOnMainThread(file: File, bytes: Uint8Array, hash: string): Promise<Score> {
  const name = file.name.toLowerCase();
  // The document is re-wrapped with the file's identity; its inventory and identity carry over (no second parse).
  const rewrap = (score: Score, binary?: Uint8Array) => {
    const document = score.document!;
    score.document = makeSourceDocument({ format: document.format, engravingFormat: document.engravingFormat, originalBytes: binary, originalText: document.originalText, engravingText: document.engravingText, filename: file.name, sha256: hash, identity: document.identity, inventory: { featureCounts: document.featureCounts, diagnostics: document.diagnostics } });
    return score;
  };
  if (/\.(mid|midi)$/.test(name)) return rewrap(await parseMidi(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer), bytes);
  const text = new TextDecoder().decode(bytes);
  if (/\.(abc|txt)$/.test(name)) return rewrap(await parseAbc(text));
  if (/\.mei$/.test(name)) return rewrap(parseMei(text));
  throw new Error('Choose a MusicXML, MIDI, MEI, or ABC file.');
}
