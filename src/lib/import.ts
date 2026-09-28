import { strFromU8, unzipSync } from 'fflate';
import { gmProgramForNumber, gmProgramForVirtualName, instrumentForName, instrumentForProgram, midiPitch, pitch, ucfirst, type Measure, type Part, type Score, type ScoreNote, type Transposition } from './score';

const children = (node: Element, tag: string) => Array.from(node.children).filter(el => el.localName === tag);
const child = (node: Element, tag: string) => children(node, tag)[0];
const value = (node: Element, tag: string) => child(node, tag)?.textContent?.trim() || '';
const number = (node: Element, tag: string, fallback = 0) => Number(value(node, tag)) || fallback;
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

export function parseMusicXml(text: string): Score {
  const doc = parseXml(text);
  let root = doc.documentElement;
  if (root.localName === 'score-timewise') {
    const partwise = doc.createElement('score-partwise');
    for (const e of Array.from(root.children).filter(e => e.localName !== 'measure')) partwise.appendChild(e.cloneNode(true));
    const ids = children(child(root, 'part-list') || root, 'score-part').map(e => e.getAttribute('id') || '');
    for (const id of ids) {
      const part = doc.createElement('part'); part.setAttribute('id', id);
      for (const m of children(root, 'measure')) {
        const inner = children(m, 'part').find(e => e.getAttribute('id') === id);
        const measure = doc.createElement('measure');
        measure.setAttribute('number', m.getAttribute('number') || String(part.children.length + 1));
        for (const item of Array.from(inner?.children || [])) measure.appendChild(item.cloneNode(true));
        part.appendChild(measure);
      }
      partwise.appendChild(part);
    }
    root = partwise;
  }
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
    const midiProgram = !gmVirtual && !hasOtherVirtual ? children(definition || element, 'midi-instrument').map(item => gmProgramForNumber(number(item, 'midi-program', 0))).find(Boolean) : undefined;
    const gm = gmVirtual || midiProgram;
    const staffMap = new Map<number, Part>();
    let divisions = 1;
    let partKey = key;
    let partTransposition: Transposition = { semitones: 0 };
    const staffTranspositions = new Map<number, Transposition>();
    for (const [index, m] of children(element, 'measure').entries()) {
      let cursor = 0;
      let last: ScoreNote | undefined;
      const harmonyByTime = new Map<number, string>();
      const attrs = child(m, 'attributes');
      if (attrs) {
        divisions = number(attrs, 'divisions', divisions);
        const time = child(attrs, 'time');
        if (time) { beats = number(time, 'beats', beats); beatType = number(time, 'beat-type', beatType); }
        const k = child(attrs, 'key');
        if (k) {
          partKey = number(k, 'fifths', partKey);
          if (partNo === 0) key = partKey;
        }
        const forPart = children(attrs, 'for-part').map(item => musicXmlTranspose(child(item, 'part-transpose'))).find(Boolean);
        if (concertScore && forPart) partTransposition = forPart;
        else for (const item of children(attrs, 'transpose')) {
          const interval = musicXmlTranspose(item)!;
          const staffNumber = Number(item.getAttribute('number'));
          if (staffNumber > 0) staffTranspositions.set(staffNumber, interval);
          else partTransposition = interval;
        }
      }
      const measureBeats = beats * 4 / beatType;
      const ensure = (staff: number) => {
        const transposition = staffTranspositions.get(staff) || partTransposition;
        if (!staffMap.has(staff)) {
          const clefEl = attrs && children(attrs, 'clef').find(c => Number(c.getAttribute('number') || 1) === staff);
          const sign = clefEl ? value(clefEl, 'sign') : '';
          const clef = sign === 'F' ? 'bass' : sign === 'C' ? 'alto' : sign === 'percussion' ? 'percussion' : /bass/i.test(name) ? 'bass' : 'treble';
          staffMap.set(staff, { id: `${id}-${staff}`, name: staff === 1 ? name : `${name} · ${staff}`, clef, key: partKey, instrument: gm ? gm.icon as Part['instrument'] : instrumentForName(name), gmProgram: gm?.program, gmSoundfont: gm?.soundfont, pitchBasis: concertScore ? 'concert' : 'written', transposition, measures: Array.from({ length: index }, (_, i) => empty(i, measureBeats)) });
        }
        const p = staffMap.get(staff)!;
        if (!p.measures[index]) p.measures[index] = empty(index, measureBeats);
        p.measures[index].transposition = transposition;
        return p.measures[index];
      };
      staffMap.forEach((_, staff) => ensure(staff));
      for (const item of Array.from(m.children)) {
        if (item.localName === 'harmony') {
          const symbol = musicXmlHarmony(item);
          if (symbol) harmonyByTime.set(cursor + number(item, 'offset') / divisions, symbol);
        }
        if (item.localName === 'direction') {
          const sound = child(item, 'sound');
          const metronome = child(item, 'direction-type') && child(child(item, 'direction-type'), 'metronome');
          const t = Number(sound?.getAttribute('tempo') || (metronome ? value(metronome, 'per-minute') : 0));
          if (t > 0) tempo = t;
          const dynamics = children(item, 'direction-type').flatMap(type => children(type, 'dynamics')).flatMap(mark => Array.from(mark.children));
          if (dynamics.length) {
            const measure = ensure(number(item, 'staff', 1));
            const start = Math.max(0, Math.min(measureBeats, cursor + number(item, 'offset') / divisions));
            for (const mark of dynamics) {
              const symbol = (mark.localName === 'other-dynamics' ? mark.textContent || '' : mark.localName).trim().toLowerCase();
              if (symbol) (measure.dynamics ||= []).push({ start, symbol });
            }
          }
        }
        if (item.localName === 'backup') { cursor = Math.max(0, cursor - number(item, 'duration') / divisions); last = undefined; }
        if (item.localName === 'forward') { cursor += number(item, 'duration') / divisions; last = undefined; }
        if (item.localName !== 'note') continue;
        const staff = number(item, 'staff', 1);
        const measure = ensure(staff);
        const chord = Boolean(child(item, 'chord'));
        const duration = number(item, 'duration') / divisions || durationBeats(value(item, 'type'), children(item, 'dot').length);
        const p = child(item, 'pitch');
        const rest = Boolean(child(item, 'rest'));
        const primaryBeam = children(item, 'beam').find(beam => Number(beam.getAttribute('number') || 1) === 1)?.textContent?.trim().toLowerCase();
        const beamStart = primaryBeam === 'begin';
        const beamEnd = primaryBeam === 'end';
        const notePitch = p && !rest ? pitch(value(p, 'step') || 'C', number(p, 'octave', 4), number(p, 'alter')) : undefined;
        // A MusicXML <chord> can contain notes with different durations. Only
        // combine equal-duration pitches; keep the others as concurrent voices.
        const onset = chord && last ? last.start : cursor;
        if (chord && last && notePitch && Math.abs(last.duration - duration) < .001) {
          last.pitches.push(notePitch);
          last.beamStart ||= beamStart;
          last.beamEnd ||= beamEnd;
        }
        else {
          last = { id: `${id}-${staff}-${index}-${measure.notes.length}`, start: onset, duration, pitches: notePitch ? [notePitch] : [], chordSymbol: harmonyByTime.get(onset), rest, dotted: Boolean(child(item, 'dot')), beamStart, beamEnd, tieStart: children(item, 'tie').some(t => t.getAttribute('type') === 'start'), tieStop: children(item, 'tie').some(t => t.getAttribute('type') === 'stop') };
          measure.notes.push(last);
        }
        if (!chord) cursor += duration;
      }
    }
    parts.push(...Array.from(staffMap.values()).sort((a, b) => Number(a.id.split('-').pop()) - Number(b.id.split('-').pop())));
  }
  // Builder-style scores can contain many placeholder instruments with only
  // rests. They obscure the playable staves in the continuous reader.
  const playableParts = parts.filter(part => part.measures.some(measure => measure.notes.some(note => note.pitches.length > 0)));
  return normalized({ title, subtitle, composer, credits: otherCredits, source: 'MusicXML', tempo, beats, beatType, key, parts: playableParts.length ? playableParts : parts });
}

export function parseMei(text: string): Score {
  const doc = parseXml(text);
  if (doc.documentElement.localName !== 'mei') throw new Error('This file is not an MEI document.');
  const all = (tag: string) => Array.from(doc.getElementsByTagName('*')).filter(e => e.localName === tag);
  const defs = all('staffDef');
  const measures = all('measure');
  const meter = all('scoreDef')[0];
  const beats = Number(meter?.getAttribute('meter.count')) || 4;
  const beatType = Number(meter?.getAttribute('meter.unit')) || 4;
  const keySig = meter?.getAttribute('key.sig') || '';
  const key = Number(keySig.replace(/[^0-9]/g, '')) * (keySig.includes('f') ? -1 : 1) || 0;
  const alteredByKey = (step: string) => key > 0 ? ('FCGDAEB'.slice(0, key).includes(step) ? 1 : 0) : ('BEADGCF'.slice(0, -key).includes(step) ? -1 : 0);
  const parts: Part[] = defs.map((def, i) => {
    const n = def.getAttribute('n') || String(i + 1);
    const name = def.getAttribute('label') || `Staff ${n}`;
    const sign = def.getAttribute('clef.shape');
    const clef = sign === 'F' ? 'bass' : sign === 'C' ? 'alto' : sign === 'perc' ? 'percussion' : 'treble';
    const transposition: Transposition = { semitones: Number(def.getAttribute('trans.semi')) || 0, diatonic: def.hasAttribute('trans.diat') ? Number(def.getAttribute('trans.diat')) : undefined };
    return { id: n, name, clef, instrument: instrumentForName(name), pitchBasis: 'written', transposition, measures: measures.map((measure, index) => {
      const out = empty(index, beats * 4 / beatType);
      const staff = Array.from(measure.getElementsByTagName('*')).find(e => e.localName === 'staff' && e.getAttribute('n') === n);
      if (!staff) return out;
      const layer = Array.from(staff.children).find(e => e.localName === 'layer') || staff;
      const bySourceId = new Map<string, ScoreNote>();
      let cursor = 0;
      for (const el of Array.from(layer.children)) {
        const kind = el.localName;
        if (!['note', 'chord', 'rest', 'mRest'].includes(kind)) continue;
        const duration = kind === 'mRest' ? out.beats : durationBeats(el.getAttribute('dur') || '4', Number(el.getAttribute('dots') || 0));
        const noteEls = kind === 'chord' ? Array.from(el.children).filter(e => e.localName === 'note') : kind === 'note' ? [el] : [];
        const pitches = noteEls.map(e => {
          const step = (e.getAttribute('pname') || 'c').toUpperCase();
          const explicit = ({ s: 1, f: -1, ss: 2, ff: -2, n: 0 } as Record<string, number>)[e.getAttribute('accid') || ''];
          return pitch(step, Number(e.getAttribute('oct') || 4), explicit ?? alteredByKey(step));
        });
        const parsed: ScoreNote = { id: `${n}-${index}-${out.notes.length}`, start: cursor, duration, pitches, rest: !pitches.length };
        out.notes.push(parsed);
        for (const source of [el, ...noteEls]) {
          const sourceId = source.getAttribute('xml:id') || source.getAttributeNS('http://www.w3.org/XML/1998/namespace', 'id');
          if (sourceId) bySourceId.set(sourceId, parsed);
        }
        cursor += duration;
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
  return normalized({ title, subtitle, composer, source: 'MEI', tempo: 100, beats, beatType, key, parts });
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
  for (const line of tune.lines) for (const [staffIndex, staff] of (line.staff || []).entries()) for (const [voiceIndex, voice] of (staff.voices || []).entries()) {
    const part = map.get(`${staffIndex}-${voiceIndex}`);
    if (!part) continue;
    let current = part.measures.at(-1);
    if (!current || (current as any).closed) { current = empty(part.measures.length, beats * 4 / beatType); part.measures.push(current); }
    let cursor = current.notes.reduce((max, n) => Math.max(max, n.start + n.duration), 0);
    const accidentalMap = new Map<string, number>();
    for (const item of voice) {
      if (item.el_type === 'bar') {
        if (current.notes.length) (current as any).closed = true;
        current = empty(part.measures.length, beats * 4 / beatType); part.measures.push(current);
        cursor = 0; accidentalMap.clear(); continue;
      }
      if (item.el_type !== 'note') continue;
      const duration = Number(item.duration || .25) * 4;
      const pitches = (item.pitches || []).map((p: any) => {
        const degree = Number(p.pitch || 0);
        const steps = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
        const step = steps[((degree % 7) + 7) % 7];
        const octave = 4 + Math.floor(degree / 7);
        const explicit = ({ sharp: 1, flat: -1, natural: 0, dblsharp: 2, dblflat: -2 } as Record<string, number>)[p.accidental];
        if (explicit !== undefined) accidentalMap.set(`${step}${octave}`, explicit);
        const fromKey = keyAccidentals.find((a: any) => a.note.toUpperCase() === step);
        const alter = accidentalMap.get(`${step}${octave}`) ?? (fromKey?.acc === 'sharp' ? 1 : fromKey?.acc === 'flat' ? -1 : 0);
        return pitch(step, octave, alter);
      });
      const chordSymbol = item.chord?.find((chord: { name?: string; position?: string }) => chord.position !== 'below')?.name;
      const lyric = item.lyric?.map((syllable: { syllable?: string; divider?: string }) => `${syllable.syllable || ''}${syllable.divider === '-' ? '-' : ''}`).filter(Boolean).join(' ');
      current.notes.push({ id: `abc-${staffIndex}-${voiceIndex}-${current.index}-${current.notes.length}`, start: cursor, duration, pitches, chordSymbol, lyric, beamStart: Boolean(item.startBeam), beamEnd: Boolean(item.endBeam), rest: !pitches.length, dotted: Boolean(item.dots) });
      cursor += duration;
    }
  }
  parts.forEach(part => { part.measures = part.measures.filter(m => m.notes.length); part.measures.forEach((m, i) => m.index = i); });
  return normalized({ title: tune.metaText?.title || '', subtitle: tune.lines.find((line: any) => line.subtitle)?.subtitle?.text || '', composer: tune.metaText?.composer || '', source: 'ABC', tempo: Number(tune.metaText?.tempo?.bpm) || 100, beats, beatType, key, parts });
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
      const index = Math.floor(absolute / measureSize);
      while (measures.length <= index) measures.push(empty(measures.length, measureSize));
      const m = measures[index], start = absolute - index * measureSize;
      const chord = m.notes.find(n => Math.abs(n.start - start) < .001 && Math.abs(n.duration - duration) < .001);
      if (chord) chord.pitches.push(midiPitch(note.midi));
      else m.notes.push({ id: `midi-${ti}-${index}-${m.notes.length}`, start, duration, pitches: [midiPitch(note.midi)] });
    }
    return { id: `midi-${ti}`, name, clef: track.instrument.percussion ? 'percussion' : /bass/i.test(name) ? 'bass' : 'treble', instrument: track.instrument.percussion ? 'drum-kit' : instrumentForProgram(track.instrument.number), pitchBasis: 'concert' as const, measures };
  });
  return normalized({ title: midi.name || '', source: 'MIDI · quantized', tempo, beats, beatType, key: 0, parts });
}

export async function importFile(file: File): Promise<Score> {
  if (file.size > 8_000_000) throw new Error('Please choose a file smaller than 8 MB.');
  const name = file.name.toLowerCase();
  if (/\.(mid|midi)$/.test(name)) return parseMidi(await file.arrayBuffer());
  if (/\.mxl$/.test(name)) {
    const files = unzipSync(new Uint8Array(await file.arrayBuffer()));
    const container = files['META-INF/container.xml'];
    const path = container && parseXml(strFromU8(container)).querySelector('rootfile')?.getAttribute('full-path');
    const entry = path ? files[path] : Object.entries(files).find(([key]) => /\.xml$/.test(key) && !key.startsWith('META-INF/'))?.[1];
    if (!entry || entry.length > 8_000_000) throw new Error('This MXL archive has no readable score.');
    return parseMusicXml(strFromU8(entry));
  }
  const text = await file.text();
  if (/\.(abc|txt)$/.test(name)) return parseAbc(text);
  if (/\.mei$/.test(name)) return parseMei(text);
  if (/\.(xml|musicxml)$/.test(name)) return parseMusicXml(text);
  throw new Error('Choose a MusicXML, MIDI, MEI, or ABC file.');
}
