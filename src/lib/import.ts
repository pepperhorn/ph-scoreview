import { strFromU8, unzipSync } from 'fflate';
import { gmProgramForNumber, gmProgramForVirtualName, instrumentForName, instrumentForProgram, midiPitch, pitch, ucfirst, type BarlineNavigation, type Measure, type MeasureNavigation, type Part, type Score, type ScoreNote, type Transposition } from './score';
import { identifyMusicXmlNotes, identityForScore, makeSourceDocument, normalizeTimewiseMusicXml, scoreToMei, sha256, type SourceDiagnostic } from './notation/document';
import { abcDecorationWord, attachNavigation, endingNumbers, meiNavigation, musicXmlNavigation, navigationWord, resolveCodaSigns, type NavigationWord } from './notation/navigation';
import { formatFraction, fromNumber } from './playback/fraction';

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

export function parseMusicXml(text: string): Score {
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
        if (k) { partKey = number(k, 'fifths', partKey); if (partNo === 0 && index === 0) key = partKey; }
        const clefElement = children(attributes, 'clef').find(c => Number(c.getAttribute('number') || 1) === 1);
        if (clefElement) {
          const sign = value(clefElement, 'sign');
          partClef = sign === 'F' ? 'bass' : sign === 'C' ? number(clefElement, 'line', 3) === 4 ? 'tenor' : 'alto' : sign === 'percussion' ? 'percussion' : 'treble';
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
          if (clefElement) { const sign = value(clefElement, 'sign'); part.clef = sign === 'F' ? 'bass' : sign === 'C' ? number(clefElement, 'line', 3) === 4 ? 'tenor' : 'alto' : sign === 'percussion' ? 'percussion' : 'treble'; }
          measure.key = partKey; measure.clef = part.clef; measure.beatsPerBar = partBeats; measure.beatType = partBeatType;
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
          const clef = sign === 'F' ? 'bass' : sign === 'C' ? number(clefEl!, 'line', 3) === 4 ? 'tenor' : 'alto' : sign === 'percussion' ? 'percussion' : partClef || (/bass/i.test(name) ? 'bass' : 'treble');
          staffMap.set(staff, { id: `${id}-${staff}`, name: staff === 1 ? name : `${name} · ${staff}`, clef, key: partKey, instrument: drumKit ? 'drum-kit' : gm ? gm.icon as Part['instrument'] : instrumentForName(name), gmProgram: gm?.program, gmSoundfont: gm?.soundfont, pitchBasis: concertScore ? 'concert' : 'written', transposition, measures: Array.from({ length: index }, (_, i) => empty(i, measureBeats)) });
        }
        const p = staffMap.get(staff)!;
        if (!p.measures[index]) p.measures[index] = { ...empty(index, measureBeats), nominalBeats: measureBeats, number: m.getAttribute('number') || String(index + 1), implicit: m.getAttribute('implicit') === 'yes', key: partKey, clef: p.clef, beatsPerBar: partBeats, beatType: partBeatType };
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
  const score = normalized({ title, subtitle, composer, credits: otherCredits, source: 'MusicXML', tempo, beats, beatType, key, parts: playableParts.length ? playableParts : parts });
  // Navigation is read once from the first source part and shared by every staff.
  const navigationNotes: string[] = [];
  attachNavigation(score, musicXmlNavigation(root, score.parts[0].measures.length, navigationNotes));
  score.document = makeSourceDocument({ format: 'musicxml', engravingFormat: 'musicxml', originalText: text, engravingText, identity: identityForScore(score), diagnostics: navigationDiagnostics(navigationNotes) });
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
  const defKey = (def: Element) => parseKey(def.getAttribute('key.sig')) ?? parseKey(children(def, 'keySig')[0]?.getAttribute('sig'));
  const defMeter = (def: Element) => {
    const sig = children(def, 'meterSig')[0];
    const count = Number(def.getAttribute('meter.count') || sig?.getAttribute('count'));
    const unit = Number(def.getAttribute('meter.unit') || sig?.getAttribute('unit'));
    return count > 0 && unit > 0 ? { count, unit } : undefined;
  };
  let meterNow: { count: number; unit: number } | undefined;
  let defaultKey: number | undefined;
  const staffKeys = new Map<string, number>();
  const measureState: { count: number; unit: number; keys: Map<string, number>; defaultKey: number }[] = [];
  let openingMeter: { count: number; unit: number } | undefined;
  let openingKey: number | undefined;
  for (const el of everything) {
    if (el.localName === 'scoreDef') {
      const k = defKey(el);
      if (k !== undefined) { defaultKey = k; staffKeys.clear(); }
      meterNow = defMeter(el) || meterNow;
    } else if (el.localName === 'staffDef') {
      const k = defKey(el);
      if (k !== undefined) staffKeys.set(el.getAttribute('n') || '1', k);
      meterNow = defMeter(el) || meterNow;
    } else if (el.localName === 'measure') {
      openingMeter ||= meterNow;
      if (openingKey === undefined) openingKey = staffKeys.values().next().value ?? defaultKey;
      measureState.push({ count: meterNow?.count || 4, unit: meterNow?.unit || 4, keys: new Map(staffKeys), defaultKey: defaultKey || 0 });
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
      const state = measureState[index] || { count: beats, unit: beatType, keys: new Map<string, number>(), defaultKey: key };
      const staffKey = state.keys.get(n) ?? state.defaultKey;
      const out: Measure = { ...empty(index, state.count * 4 / state.unit), nominalBeats: state.count * 4 / state.unit, number: measure.getAttribute('n') || String(index + 1), key: staffKey, beatsPerBar: state.count, beatType: state.unit };
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
  const score = normalized({ title, subtitle, composer, source: 'MEI', tempo: 100, beats, beatType, key, parts });
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
  const keyAccidentals = tune.getKeySignature?.()?.accidentals || [];
  const key = keyAccidentals.length * (keyAccidentals[0]?.acc === 'flat' ? -1 : 1);
  const firstStaff = tune.lines.find((line: any) => line.staff?.length)?.staff || [];
  const parts: Part[] = [];
  const map = new Map<string, Part>();
  for (const [staffIndex, staff] of firstStaff.entries()) for (const [voiceIndex] of (staff as any).voices.entries()) {
    const name = staff.title?.[voiceIndex] || staff.title?.[0] || (voiceIndex ? `Voice ${voiceIndex + 1}` : 'Melody');
    const clef = /bass|cello|trombone/i.test(name) ? 'bass' : staff.voices.length === 1 && staff.clef?.type === 'bass' ? 'bass' : 'treble';
    const part: Part = { id: `abc-${staffIndex}-${voiceIndex}`, name, clef, instrument: instrumentForName(name), measures: [] };
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
  for (const line of tune.lines) for (const [staffIndex, staff] of (line.staff || []).entries()) for (const [voiceIndex, voice] of (staff.voices || []).entries()) {
    const part = map.get(`${staffIndex}-${voiceIndex}`);
    if (!part) continue;
    const leading = part === parts[0];
    let current = part.measures.at(-1);
    if (!current || (current as any).closed) { current = empty(part.measures.length, beats * 4 / beatType); part.measures.push(current); }
    let cursor = current.notes.reduce((max, n) => Math.max(max, n.start + n.duration), 0);
    const accidentalMap = new Map<string, number>();
    // abcjs marks only the first note of a tuplet with its multiplier.
    let triplet: { multiplier: number; remaining: number; actual: number; first: boolean } | undefined;
    for (const item of voice) {
      if (item.el_type === 'bar') {
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
        const fromKey = keyAccidentals.find((a: any) => a.note.toUpperCase() === step);
        const alter = accidentalMap.get(`${step}${octave}`) ?? (fromKey?.acc === 'sharp' ? 1 : fromKey?.acc === 'flat' ? -1 : 0);
        return { ...pitch(step, octave, alter), tieStart: Boolean(p.startTie), tieStop: Boolean(p.endTie) };
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
      const chordSymbol = item.chord?.find((chord: { name?: string; position?: string }) => chord.position !== 'below' && !navigationWord(chord.name || ''))?.name;
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
  const score = normalized({ title: tune.metaText?.title || '', subtitle: tune.lines.find((line: any) => line.subtitle)?.subtitle?.text || '', composer: tune.metaText?.composer || '', source: 'ABC', tempo: Number(tune.metaText?.tempo?.bpm) || 100, beats, beatType, key, parts });
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
  score.document = makeSourceDocument({ format: 'midi', engravingFormat: 'mei', originalBytes: new Uint8Array(buffer), engravingText: scoreToMei(score), identity: identityForScore(score) });
  return score;
}

const MB = 1024 * 1024;
/** Largest score file accepted (MusicXML, MXL, MEI, ABC or MIDI). Orchestral MusicXML routinely runs to tens of MB. */
export const MAX_SCORE_FILE_BYTES = 64 * MB;
/** Uncompressed size limit for an MXL score member; bounds decompression so a small archive cannot inflate without limit. */
export const MXL_MAX_SCORE_BYTES = 128 * MB;
const formatMb = (bytes: number) => `${Math.round(bytes / MB * 10) / 10} MB`;
/**
 * Reads the MusicXML member of an MXL archive without inflating anything else:
 * only META-INF/container.xml and the chosen score are decompressed, each with a
 * declared-size bound (fflate never writes past the declared size).
 */
export function extractMxlScore(bytes: Uint8Array): string {
  const entries: { name: string; originalSize: number }[] = [];
  let listing: Record<string, Uint8Array>;
  try {
    listing = unzipSync(bytes, { filter: file => { entries.push({ name: file.name, originalSize: file.originalSize }); return file.name === 'META-INF/container.xml' && file.originalSize <= 1_000_000; } });
  } catch { throw new Error('This MXL archive could not be opened.'); }
  const container = listing['META-INF/container.xml'];
  let path: string | undefined;
  if (container) {
    let declared: string | null | undefined;
    try { declared = Array.from(parseXml(strFromU8(container)).getElementsByTagName('*')).find(el => el.localName === 'rootfile')?.getAttribute('full-path'); }
    catch { throw new Error('This MXL archive has an unreadable META-INF/container.xml.'); }
    if (declared) {
      try { path = decodeURIComponent(declared.trim()); } catch { path = declared.trim(); }
      path = path.replace(/^\.\//, '');
      if (path.startsWith('/') || path.split(/[\\/]/).includes('..')) throw new Error('This MXL archive declares an unsafe score path.');
      // Some writers percent-encode the path, others store it raw; accept either spelling.
      if (!entries.some(entry => entry.name === path) && entries.some(entry => entry.name === declared!.trim())) path = declared.trim();
    }
  }
  const target = path ? entries.find(entry => entry.name === path) : entries.find(entry => /\.(xml|musicxml)$/i.test(entry.name) && !entry.name.startsWith('META-INF/'));
  if (!target) throw new Error(path ? `This MXL archive does not contain its declared score "${path}".` : 'This MXL archive has no MusicXML score.');
  if (!(target.originalSize <= MXL_MAX_SCORE_BYTES)) throw new Error(`The score inside this MXL archive is ${formatMb(target.originalSize)} uncompressed; the limit is ${formatMb(MXL_MAX_SCORE_BYTES)}.`);
  let files: Record<string, Uint8Array>;
  try { files = unzipSync(bytes, { filter: file => file.name === target.name && file.originalSize <= MXL_MAX_SCORE_BYTES }); }
  catch { throw new Error('The score inside this MXL archive could not be decompressed.'); }
  const entry = files[target.name];
  if (!entry || !entry.length) throw new Error('The score inside this MXL archive is empty.');
  return strFromU8(entry);
}

/**
 * Open a score file. `prepared` passes bytes and a SHA-256 the caller already has (the reader hashes once for the
 * per-score record), so the file is neither read nor hashed twice.
 */
export async function importFile(file: File, prepared?: { bytes: Uint8Array; sha256: string }): Promise<Score> {
  if (file.size > MAX_SCORE_FILE_BYTES) throw new Error(`This file is ${formatMb(file.size)}; scores up to ${formatMb(MAX_SCORE_FILE_BYTES)} can be opened.`);
  const name = file.name.toLowerCase();
  const bytes = prepared?.bytes || new Uint8Array(await file.arrayBuffer());
  const hash = prepared?.sha256 || await sha256(bytes);
  let score: Score;
  // The document is re-wrapped with the file's identity; its inventory and identity carry over (no second parse).
  const rewrap = (score: Score, binary?: Uint8Array, originalText = score.document!.originalText, format = score.document!.format) => {
    const document = score.document!;
    score.document = makeSourceDocument({ format, engravingFormat: document.engravingFormat, originalBytes: binary, originalText, engravingText: document.engravingText, filename: file.name, sha256: hash, identity: document.identity, inventory: { featureCounts: document.featureCounts, diagnostics: document.diagnostics } });
    return score;
  };
  if (/\.(mid|midi)$/.test(name)) score = await parseMidi(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  else if (/\.mxl$/.test(name)) {
    const text = extractMxlScore(bytes);
    return rewrap(parseMusicXml(text), bytes, text, 'mxl');
  } else {
    const text = new TextDecoder().decode(bytes);
    if (/\.(abc|txt)$/.test(name)) score = await parseAbc(text);
    else if (/\.mei$/.test(name)) score = parseMei(text);
    else if (/\.(xml|musicxml)$/.test(name)) score = parseMusicXml(text);
    else throw new Error('Choose a MusicXML, MIDI, MEI, or ABC file.');
    return rewrap(score);
  }
  return rewrap(score, bytes);
}
