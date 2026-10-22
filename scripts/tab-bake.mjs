#!/usr/bin/env node
// Make MusicXML scores TAB-ready ahead of time (docs/specs/guitar-tab.md, "Preprocessing").
//
//   node scripts/tab-bake.mjs <in.musicxml|.mxl|dir> [-o out] [--out-dir dir] [--tuning name|40,45,50,55,59,64]
//        [--capo n] [--parts P1,P2|guitar|all] [--add-tab-staff] [--overwrite-existing] [--dry-run]
//
// Runs the reader's fingering solver (packages/pepperscore/src/lib/tab/fret-assign.ts, loaded through Node's type
// stripping, so Node 22.18+ or 23.6+) over each target part and writes `<notations><technical><string>/<fret>` onto
// its notes. The reader treats those as fixed fingerings. `--add-tab-staff` also adds a TAB staff to the part (a
// second staff with a TAB clef, `<staff-details>` tuning and a copy of the notes), the layout Guitar Pro and MuseScore
// export, which the reader shows as an imported TAB staff.
//
// The file is edited in place as text: every byte outside the inserted or changed elements is kept (XML declaration,
// DOCTYPE, comments, whitespace, attribute quoting). Exported `bakeMusicXml` is used by validation/tab-bake.mjs.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { assignFrets, STANDARD_TUNING } from '../packages/pepperscore/src/lib/tab/fret-assign.ts';

/** Open-string MIDI pitches, low to high. */
export const TUNINGS = {
  standard: STANDARD_TUNING,
  drop_d: [38, 45, 50, 55, 59, 64],
  half_step_down: [39, 44, 49, 54, 58, 63],
  open_g: [38, 43, 50, 55, 59, 62],
  open_d: [38, 45, 50, 54, 57, 62],
  dadgad: [38, 45, 50, 55, 57, 62],
};
const TAB_SUFFIX = '-tabstaff';
const EPS = 1e-6;

// --- A position-keeping XML tree ---------------------------------------------------------------------------------------

/**
 * Elements of `src` with their offsets: `start` (at `<`), `openEnd` (after the start tag's `>`), `closeStart` (at
 * `</`, = openEnd when self-closing) and `end`. Comments, CDATA, processing instructions and the DOCTYPE are skipped.
 */
export function parseXml(src) {
  const root = { name: '#root', start: 0, openEnd: 0, closeStart: src.length, end: src.length, children: [], parent: null, tag: '' };
  let current = root;
  let i = 0;
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt < 0) break;
    if (src.startsWith('<!--', lt)) { i = end(src.indexOf('-->', lt + 4), 3); continue; }
    if (src.startsWith('<![CDATA[', lt)) { i = end(src.indexOf(']]>', lt + 9), 3); continue; }
    if (src.startsWith('<?', lt)) { i = end(src.indexOf('?>', lt + 2), 2); continue; }
    if (src.startsWith('<!', lt)) { // DOCTYPE, possibly with an internal subset
      let depth = 0, j = lt + 2;
      for (; j < src.length; j++) {
        const c = src[j];
        if (c === '"' || c === "'") { j = src.indexOf(c, j + 1); if (j < 0) j = src.length; continue; }
        if (c === '[') depth++;
        else if (c === ']') depth--;
        else if (c === '>' && depth <= 0) break;
      }
      i = j + 1; continue;
    }
    // A tag: find its `>` outside quotes.
    let j = lt + 1, quote = '';
    for (; j < src.length; j++) {
      const c = src[j];
      if (quote) { if (c === quote) quote = ''; continue; }
      if (c === '"' || c === "'") quote = c;
      else if (c === '>') break;
    }
    if (j >= src.length) throw new Error(`Unterminated tag at offset ${lt}`);
    const tag = src.slice(lt, j + 1);
    if (tag[1] === '/') {
      const name = tag.slice(2, -1).trim();
      if (current.name !== name) throw new Error(`Mismatched </${name}> at offset ${lt} (open: <${current.name}>)`);
      current.closeStart = lt; current.end = j + 1;
      current = current.parent;
    } else {
      const name = /^<([^\s/>]+)/.exec(tag)[1];
      const selfClosing = tag.endsWith('/>');
      const el = { name, start: lt, openEnd: j + 1, closeStart: j + 1, end: j + 1, children: [], parent: current, tag, selfClosing };
      current.children.push(el);
      if (!selfClosing) current = el;
    }
    i = j + 1;
  }
  if (current !== root) throw new Error(`Unclosed <${current.name}>`);
  return root;

  function end(at, length) { if (at < 0) throw new Error('Unterminated markup'); return at + length; }
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = text => text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (match, code) => code[0] === '#'
  ? String.fromCodePoint(code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : Number(code.slice(1)))
  : ENTITIES[code] ?? match);
const child = (el, name) => el?.children.find(c => c.name === name);
const childrenOf = (el, name) => el ? el.children.filter(c => c.name === name) : [];
/** Text content of an element (markup inside it removed). */
const textOf = (src, el) => el ? decode(src.slice(el.openEnd, el.closeStart).replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]*>/g, '')).trim() : '';
const attr = (el, name) => {
  const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(el?.tag ?? '');
  return match ? decode(match[1] ?? match[2]) : null;
};
const numberOf = (src, el) => { const value = Number(textOf(src, el)); return el && Number.isFinite(value) ? value : undefined; };
const descendants = (el, name, out = []) => { for (const c of el.children) { if (c.name === name) out.push(c); descendants(c, name, out); } return out; };

/** Text edits on `src`: insertions (`del` 0) and replacements, applied back to front. */
class Edits {
  constructor() { this.list = []; }
  insert(pos, text) { this.list.push({ pos, del: 0, text, seq: this.list.length }); }
  replace(from, to, text) { this.list.push({ pos: from, del: to - from, text, seq: this.list.length }); }
  /** Remove an element and the whitespace before it. */
  remove(src, el) { let from = el.start; while (from > 0 && /\s/.test(src[from - 1])) from--; this.replace(from, el.end, ''); }
  /** Apply the edits that fall within [from, to) to that slice of `src`. */
  apply(src, from = 0, to = src.length) {
    const edits = this.list.filter(e => e.pos >= from && e.pos + e.del <= to && (e.del > 0 || e.pos < to || to === src.length))
      .map(e => ({ ...e }));
    // An insertion inside a removed range (before a removed element, after the whitespace removed with it) moves to
    // the start of that range.
    for (const e of edits) if (!e.del) for (const r of edits) if (r.del && e.pos > r.pos && e.pos < r.pos + r.del) e.pos = r.pos;
    edits.sort((a, b) => b.pos - a.pos || (b.del > 0) - (a.del > 0) || b.seq - a.seq);
    let out = src.slice(from, to);
    for (const e of edits) out = out.slice(0, e.pos - from) + e.text + out.slice(e.pos - from + e.del);
    return out;
  }
}

/** Whitespace before an element (its indentation in pretty-printed files, '' in compact ones). */
const indentOf = (src, el) => { let from = el.start; while (from > 0 && /[ \t\r\n]/.test(src[from - 1])) from--; return src.slice(from, el.start); };
/** Insert `text` as a child of `parent`: before its first child named in `before`, else as its last child. */
function insertChild(edits, src, parent, text, before = []) {
  const anchor = parent.children.find(c => before.includes(c.name));
  const sample = parent.children[0];
  const indent = sample ? indentOf(src, sample) : '';
  if (anchor) edits.insert(anchor.start, text + indent);
  else if (parent.selfClosing) edits.replace(parent.start, parent.end, `${parent.tag.replace(/\s*\/>$/, '>')}${text}</${parent.name}>`);
  else edits.insert(parent.children.length ? parent.children.at(-1).end : parent.closeStart, indent + text); // before the closing tag's indentation
}
const setText = (edits, el, text) => {
  if (el.selfClosing) edits.replace(el.start, el.end, `<${el.name}${el.tag.slice(1 + el.name.length).replace(/\s*\/>$/, '')}>${text}</${el.name}>`);
  else edits.replace(el.openEnd, el.closeStart, text);
};

// --- MusicXML reading --------------------------------------------------------------------------------------------------

const STEP_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const PITCH_SPELLING = [['C'], ['C', 1], ['D'], ['E', -1], ['E'], ['F'], ['F', 1], ['G'], ['A', -1], ['A'], ['B', -1], ['B']];

/** Part-list info per part ID: name, instrument names and the first MIDI program. */
function partInfo(src, scoreEl) {
  const info = new Map();
  for (const sp of descendants(child(scoreEl, 'part-list') ?? { children: [] }, 'score-part')) {
    const id = attr(sp, 'id');
    const instruments = childrenOf(sp, 'score-instrument').flatMap(si => [textOf(src, child(si, 'instrument-name')), textOf(src, child(si, 'instrument-sound'))]).filter(Boolean);
    const program = descendants(sp, 'midi-program').map(el => numberOf(src, el)).find(n => n !== undefined);
    info.set(id, { id, name: textOf(src, child(sp, 'part-name')), instruments, program });
  }
  return info;
}

/** The reader's guitar test (tab/tab-parts.ts isGuitarPart): GM 25-32, or "guitar" (not bass) in a name. */
const isGuitar = info => (info.program !== undefined && info.program >= 25 && info.program <= 32)
  || [info.name, ...info.instruments].some(name => /guitar/i.test(name) && !/bass/i.test(name));

/**
 * Walk one part in document order: every note with its staff, voice, onset and duration in quarter notes, sounding
 * MIDI pitch (written pitch + `<transpose>`), grace/cue/chord/rest flags, ties and existing string/fret.
 */
function readPart(src, partEl) {
  const notes = [];
  const measures = [];
  let divisions = 1, transpose = new Map(), measureStart = 0;
  let maxVoice = 0, staves = 1, hasTab = false;
  const staffDetails = [];
  for (const [measureIndex, measure] of childrenOf(partEl, 'measure').entries()) {
    let cursor = 0, maxCursor = 0, lastOnset = 0;
    const record = { el: measure, number: attr(measure, 'number') ?? String(measureIndex + 1), index: measureIndex, items: [], divisionsChangedMidMeasure: false };
    measures.push(record);
    let seenTimed = false;
    for (const el of measure.children) {
      if (el.name === 'attributes') {
        const div = numberOf(src, child(el, 'divisions'));
        if (div && div > 0) { if (seenTimed && div !== divisions) record.divisionsChangedMidMeasure = true; divisions = div; }
        const st = numberOf(src, child(el, 'staves')); if (st) staves = st;
        for (const tr of childrenOf(el, 'transpose')) {
          const semi = (numberOf(src, child(tr, 'chromatic')) ?? 0) + 12 * (numberOf(src, child(tr, 'octave-change')) ?? 0);
          const n = attr(tr, 'number');
          if (n) transpose.set(n, semi); else transpose = new Map([['*', semi]]);
        }
        for (const clef of childrenOf(el, 'clef')) if (textOf(src, child(clef, 'sign')).toUpperCase() === 'TAB') hasTab = true;
        staffDetails.push(...childrenOf(el, 'staff-details'));
        continue;
      }
      if (el.name === 'backup') { cursor -= numberOf(src, child(el, 'duration')) ?? 0; if (cursor < 0) cursor = 0; record.items.push(el); continue; }
      if (el.name === 'forward') { cursor += numberOf(src, child(el, 'duration')) ?? 0; maxCursor = Math.max(maxCursor, cursor); seenTimed = true; record.items.push(el); continue; }
      if (el.name !== 'note') continue;
      seenTimed = true;
      record.items.push(el);
      const grace = !!child(el, 'grace'), cue = !!child(el, 'cue'), chord = !!child(el, 'chord'), rest = !!child(el, 'rest');
      const duration = grace ? 0 : numberOf(src, child(el, 'duration')) ?? 0;
      const onsetDiv = chord ? lastOnset : cursor;
      if (!chord) { lastOnset = cursor; cursor += duration; maxCursor = Math.max(maxCursor, cursor); }
      const staff = textOf(src, child(el, 'staff')) || '1';
      const voice = Number(textOf(src, child(el, 'voice')));
      if (Number.isFinite(voice)) maxVoice = Math.max(maxVoice, voice);
      const pitchEl = child(el, 'pitch');
      let midi = null;
      if (pitchEl) {
        const step = STEP_PC[textOf(src, child(pitchEl, 'step')).toUpperCase()];
        const octave = numberOf(src, child(pitchEl, 'octave'));
        if (step !== undefined && octave !== undefined) {
          midi = 12 * (octave + 1) + step + Math.round(numberOf(src, child(pitchEl, 'alter')) ?? 0)
            + (transpose.get(staff) ?? transpose.get('*') ?? 0);
        }
      }
      const notations = childrenOf(el, 'notations');
      const ties = [...childrenOf(el, 'tie'), ...notations.flatMap(n => childrenOf(n, 'tied'))].map(t => attr(t, 'type'));
      const technical = notations.flatMap(n => childrenOf(n, 'technical'));
      const stringEl = technical.map(t => child(t, 'string')).find(Boolean), fretEl = technical.map(t => child(t, 'fret')).find(Boolean);
      const string = numberOf(src, stringEl), fret = numberOf(src, fretEl);
      notes.push({
        el, measure: record, staff, voice: Number.isFinite(voice) ? voice : null,
        onset: measureStart + onsetDiv / divisions, dur: duration / divisions,
        midi, grace, cue, chord, rest,
        tieStart: ties.includes('start') || ties.includes('continue'), tieStop: ties.includes('stop') || ties.includes('continue'),
        existing: Number.isInteger(string) && Number.isInteger(fret) ? { string, fret } : null,
      });
    }
    measureStart += maxCursor / divisions;
  }
  return { notes, measures, maxVoice, staves, hasTab, staffDetails };
}

/** Tuning and capo written in a part's own `<staff-details>` (staff 1 or unnumbered), if any. */
function partTuning(src, staffDetails) {
  const details = staffDetails.find(sd => (attr(sd, 'number') ?? '1') === '1' && childrenOf(sd, 'staff-tuning').length);
  const capoEl = staffDetails.map(sd => child(sd, 'capo')).find(Boolean);
  let tuning;
  if (details) {
    const lines = childrenOf(details, 'staff-tuning').map(st => {
      const step = STEP_PC[textOf(src, child(st, 'tuning-step')).toUpperCase()];
      const octave = numberOf(src, child(st, 'tuning-octave'));
      return { line: Number(attr(st, 'line')), midi: step === undefined || octave === undefined ? NaN : 12 * (octave + 1) + step + Math.round(numberOf(src, child(st, 'tuning-alter')) ?? 0) };
    }).sort((a, b) => a.line - b.line);
    if (lines.length && lines.every(l => Number.isFinite(l.midi))) tuning = lines.map(l => l.midi);
  }
  return { tuning, capo: numberOf(src, capoEl) };
}

// --- Solving ---------------------------------------------------------------------------------------------------------------

/**
 * Fingerings for one staff's notes: events in time order across voices (notes starting together form one event,
 * a unison across voices is fingered once), grace and cue notes skipped, tie continuations take the fingering of
 * the note they continue (whose duration they extend). Returns Map<note, FretResult>.
 */
function solveStaff(staffNotes, options) {
  const sounding = staffNotes.filter(n => n.midi !== null && !n.grace && !n.cue && !n.rest);
  const ordered = sounding.map((note, order) => ({ note, order })).sort((a, b) => a.note.onset - b.note.onset || a.order - b.order).map(x => x.note);
  const open = new Map();
  const rootOf = new Map();
  const extend = new Map();
  const roots = [];
  for (const note of ordered) {
    const from = note.tieStop ? open.get(note.midi) : undefined;
    if (from) { rootOf.set(note, from); extend.set(from, (extend.get(from) ?? 0) + note.dur); }
    else roots.push(note);
    if (note.tieStart) open.set(note.midi, from ?? note);
    else if (from) open.delete(note.midi);
  }
  const events = [];
  const owners = [];
  const aliasOf = new Map();
  for (const note of roots) {
    const last = events.at(-1);
    if (last && Math.abs(last.onset - note.onset) < EPS) {
      const owner = owners.at(-1);
      const twin = owner.find(other => other.midi === note.midi);
      if (twin) { aliasOf.set(note, twin); continue; }
      owner.push(note);
      last.pitches.push(note.midi);
    } else {
      events.push({ onset: note.onset, pitches: [note.midi] });
      owners.push([note]);
    }
  }
  for (const [index, event] of events.entries()) {
    event.durations = owners[index].map(note => note.dur + (extend.get(note) ?? 0));
    event.fixed = owners[index].map(note => (options.overwrite ? undefined : note.existing ?? undefined));
  }
  const results = assignFrets(events, { tuning: options.tuning, capo: options.capo });
  const out = new Map();
  results.forEach((row, index) => row.forEach((result, at) => out.set(owners[index][at], result)));
  for (const [note, twin] of aliasOf) out.set(note, out.get(twin));
  for (const note of ordered) if (rootOf.has(note)) out.set(note, out.get(rootOf.get(note)) ?? out.get(aliasOf.get(rootOf.get(note))));
  return out;
}

// --- Writing ---------------------------------------------------------------------------------------------------------------

/** Edits writing `<string>`/`<fret>` into a note's `<notations><technical>` (merged with what is there). */
function technicalEdits(edits, src, noteEl, string, fret) {
  const notations = childrenOf(noteEl, 'notations');
  const technical = notations.flatMap(n => childrenOf(n, 'technical'))[0];
  const pair = `<string>${string}</string><fret>${fret}</fret>`;
  if (technical) {
    const stringEl = child(technical, 'string'), fretEl = child(technical, 'fret');
    if (stringEl && fretEl) {
      if (textOf(src, stringEl) !== String(string)) setText(edits, stringEl, String(string));
      if (textOf(src, fretEl) !== String(fret)) setText(edits, fretEl, String(fret));
      return;
    }
    if (stringEl) setText(edits, stringEl, String(string));
    if (fretEl) setText(edits, fretEl, String(fret));
    const missing = `${stringEl ? '' : `<string>${string}</string>`}${fretEl ? '' : `<fret>${fret}</fret>`}`;
    insertChild(edits, src, technical, missing);
    return;
  }
  if (notations.length) { insertChild(edits, src, notations[0], `<technical>${pair}</technical>`); return; }
  insertChild(edits, src, noteEl, `<notations><technical>${pair}</technical></notations>`, ['lyric', 'play', 'listen']);
}

/** Elements of `<note>` that come after `<staff>` (MusicXML sequence order). */
const AFTER_STAFF = ['beam', 'notations', 'lyric', 'play', 'listen'];
const AFTER_VOICE = ['type', 'dot', 'accidental', 'time-modification', 'stem', 'notehead', 'notehead-text', 'staff', ...AFTER_STAFF];
/** Note children not copied onto the TAB staff. */
const DROPPED_ON_TAB = new Set(['stem', 'accidental', 'notehead-text', 'lyric', 'play', 'listen']);

/** The TAB staff copy of a note, rest, backup or forward (as text), given the edits already planned on it. */
function tabCopy(src, el, note, tabStaff, voiceOffset, plannedEdits) {
  const local = new Edits();
  if (el.name === 'backup') return src.slice(el.start, el.end);
  if (note && (note.grace)) return null;
  if (note?.cue) {
    // A cue note is not played: keep its time with a forward (chord cue notes add nothing).
    if (note.chord) return null;
    const voice = note.voice !== null ? `<voice>${note.voice + voiceOffset}</voice>` : '';
    return `<forward><duration>${textOf(src, child(el, 'duration'))}</duration>${voice}<staff>${tabStaff}</staff></forward>`;
  }
  // IDs stay unique.
  const idMatch = /(\sid\s*=\s*)(["'])([^"']*)\2/.exec(el.tag);
  if (idMatch) local.replace(el.start, el.openEnd, el.tag.replace(idMatch[0], `${idMatch[1]}${idMatch[2]}${idMatch[3]}${TAB_SUFFIX}${idMatch[2]}`));
  const voiceEl = child(el, 'voice');
  if (voiceEl && Number.isFinite(Number(textOf(src, voiceEl)))) setText(local, voiceEl, String(Number(textOf(src, voiceEl)) + voiceOffset));
  const staffEl = child(el, 'staff');
  if (staffEl) setText(local, staffEl, String(tabStaff));
  else insertChild(local, src, el, `<staff>${tabStaff}</staff>`, el.name === 'forward' ? [] : AFTER_STAFF);
  if (el.name === 'note') {
    for (const c of el.children) if (DROPPED_ON_TAB.has(c.name)) local.remove(src, c);
    // Notations: only ties and string/fret go onto the TAB staff (slurs, tuplets, articulations stay on the notation).
    for (const notations of childrenOf(el, 'notations')) for (const c of notations.children) {
      if (c.name === 'tied') continue;
      if (c.name !== 'technical') { local.remove(src, c); continue; }
      for (const t of c.children) if (t.name !== 'string' && t.name !== 'fret') local.remove(src, t);
    }
  }
  // The planned string/fret edits of this note come after the local ones at a shared position.
  for (const e of plannedEdits.list) if (e.pos >= el.start && e.pos + e.del <= el.end) local.list.push({ ...e, seq: local.list.length });
  return local.apply(src, el.start, el.end);
}

function stepAlterOctave(midi) {
  const [step, alter] = PITCH_SPELLING[((midi % 12) + 12) % 12];
  return `<tuning-step>${step}</tuning-step>${alter ? `<tuning-alter>${alter}</tuning-alter>` : ''}<tuning-octave>${Math.floor(midi / 12) - 1}</tuning-octave>`;
}

/** Edits adding TAB staff `tabStaff` to a one-staff part: attributes, unnumbered staff-details, note copies. */
function addTabStaff(edits, src, part, read, results, options) {
  const tabStaff = read.staves + 1;
  const measures = read.measures;
  const first = measures[0];
  if (!first) return false;
  const tuning = options.tuning;
  const details = `<staff-details number="${tabStaff}"><staff-lines>${tuning.length}</staff-lines>${tuning.map((midi, i) => `<staff-tuning line="${i + 1}">${stepAlterOctave(midi)}</staff-tuning>`).join('')}${options.capo ? `<capo>${options.capo}</capo>` : ''}</staff-details>`;
  const clef = `<clef number="${tabStaff}"><sign>TAB</sign><line>5</line></clef>`;
  const attributes = child(first.el, 'attributes');
  if (attributes) {
    const staves = child(attributes, 'staves');
    if (staves) setText(edits, staves, String(tabStaff));
    else insertChild(edits, src, attributes, `<staves>${tabStaff}</staves>`, ['part-symbol', 'instruments', 'clef', 'staff-details', 'transpose', 'for-part', 'directive', 'measure-style']);
    insertChild(edits, src, attributes, clef, ['staff-details', 'transpose', 'for-part', 'directive', 'measure-style']);
    insertChild(edits, src, attributes, details, ['transpose', 'for-part', 'directive', 'measure-style']);
  } else {
    insertChild(edits, src, first.el, `<attributes><staves>${tabStaff}</staves>${clef}${details}</attributes>`, ['note', 'backup', 'forward']);
  }
  // Staff details without a number apply to every staff: pin them to the notation staff.
  for (const sd of read.staffDetails) if (attr(sd, 'number') === null) edits.insert(sd.start + '<staff-details'.length, ' number="1"');

  const byEl = new Map(read.notes.map(note => [note.el, note]));
  const voiceOffset = Math.max(4, read.maxVoice);
  for (const measure of measures) {
    if (!measure.items.length) continue;
    // Divisions at the end of the measure apply to every copied duration: a change inside the measure would skew it.
    if (measure.divisionsChangedMidMeasure) options.warnings.push(`${part.id} m${measure.number}: divisions change inside the measure; TAB staff copy may be mistimed`);
    let cursor = 0;
    for (const el of measure.items) {
      const duration = el.name === 'note' && (child(el, 'grace') || child(el, 'chord')) ? 0 : Number(textOf(src, child(el, 'duration'))) || 0;
      cursor = el.name === 'backup' ? Math.max(0, cursor - duration) : cursor + duration;
    }
    const indent = indentOf(src, measure.items[0]);
    const copies = measure.items.map(el => tabCopy(src, el, byEl.get(el), tabStaff, voiceOffset, edits)).filter(text => text !== null);
    const text = (cursor > 0 ? [`<backup><duration>${cursor}</duration></backup>`] : []).concat(copies).map(t => indent + t).join('');
    edits.insert(measure.items.at(-1).end, text);
  }
  return true;
}

// --- The bake ------------------------------------------------------------------------------------------------------------

export function parseTuning(value) {
  if (value === undefined || value === null || value === '') return undefined;
  if (Array.isArray(value)) return value;
  const named = TUNINGS[String(value).toLowerCase().replace(/-/g, '_')];
  if (named) return [...named];
  const list = String(value).split(',').map(s => Number(s.trim()));
  if (list.length >= 1 && list.length <= 12 && list.every(n => Number.isInteger(n) && n >= 0 && n <= 127)) return list;
  throw new Error(`Unknown tuning "${value}": use ${Object.keys(TUNINGS).join(', ')} or MIDI pitches low to high (40,45,50,55,59,64)`);
}

/**
 * Bake string/fret fingerings into a score-partwise MusicXML string.
 * options: { tuning?: number[], capo?: number, parts?: 'guitar'|'all'|string[], addTabStaff?, overwrite? }
 * Returns { xml, changed, parts: [{ id, name, tuning, capo, assigned, kept, folded, unplayable: [{measure, midi}], tabStaff, skipped? }], warnings }.
 */
export function bakeMusicXml(xml, options = {}) {
  const doc = parseXml(xml);
  const scoreEl = doc.children.find(el => el.name.startsWith('score-'));
  if (!scoreEl) throw new Error('Not a MusicXML document');
  if (scoreEl.name !== 'score-partwise') throw new Error(`${scoreEl.name} is not supported (convert to score-partwise)`);
  const info = partInfo(xml, scoreEl);
  const edits = new Edits();
  const warnings = [];
  const report = [];
  const selector = options.parts ?? 'guitar';
  for (const partEl of childrenOf(scoreEl, 'part')) {
    const id = attr(partEl, 'id');
    const part = info.get(id) ?? { id, name: id, instruments: [], program: undefined };
    const listed = Array.isArray(selector) ? selector.includes(id) : selector === 'all' || (selector === 'guitar' && isGuitar(part));
    if (!listed) continue;
    const read = readPart(xml, partEl);
    const entry = { id, name: part.name, assigned: 0, kept: 0, folded: 0, unplayable: [], tabStaff: false };
    report.push(entry);
    if (!read.notes.some(note => note.midi !== null)) { entry.skipped = 'no pitched notes'; continue; }
    if (read.hasTab && !options.overwrite) { entry.skipped = 'already has a TAB staff (use --overwrite-existing)'; continue; }
    const own = partTuning(xml, read.staffDetails);
    const tuning = options.tuning ?? own.tuning ?? [...STANDARD_TUNING];
    const capo = options.capo ?? own.capo ?? 0;
    Object.assign(entry, { tuning, capo });
    const results = new Map();
    for (const staff of new Set(read.notes.map(note => note.staff))) {
      for (const [note, result] of solveStaff(read.notes.filter(n => n.staff === staff), { tuning, capo, overwrite: options.overwrite })) results.set(note, result);
    }
    for (const note of read.notes) {
      const result = results.get(note);
      if (!result) continue;
      if (note.existing && !options.overwrite) { entry.kept++; continue; }
      if ('unplayable' in result) { entry.unplayable.push({ measure: note.measure.number, midi: note.midi }); continue; }
      if (note.existing && note.existing.string === result.string && note.existing.fret === result.fret) { entry.kept++; continue; }
      technicalEdits(edits, xml, note.el, result.string, result.fret);
      entry.assigned++;
      if (result.shifted) entry.folded++;
    }
    if (options.addTabStaff && !read.hasTab) {
      if (read.staves !== 1) warnings.push(`${id}: has ${read.staves} staves; a TAB staff is only added to one-staff parts`);
      else entry.tabStaff = addTabStaff(edits, xml, part, read, results, { tuning, capo, warnings });
    }
  }
  const out = edits.list.length ? edits.apply(xml) : xml;
  return { xml: out, changed: out !== xml, parts: report, warnings };
}

// --- Files -------------------------------------------------------------------------------------------------------------------

/** Read a .musicxml/.xml/.mxl file: { xml, write(xml) → bytes } keeping the encoding and the archive. */
export function readScore(path) {
  const bytes = readFileSync(path);
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const files = unzipSync(new Uint8Array(bytes));
    const container = files['META-INF/container.xml'] ? strFromU8(files['META-INF/container.xml']) : '';
    const rootPath = /<rootfile\b[^>]*\bfull-path\s*=\s*["']([^"']+)["']/.exec(container)?.[1]
      ?? Object.keys(files).find(name => !name.startsWith('META-INF/') && /\.(musicxml|xml)$/i.test(name));
    if (!rootPath || !files[rootPath]) throw new Error('No score in the .mxl archive');
    const text = decodeText(files[rootPath]);
    return {
      xml: text.xml, archive: true,
      write: (xml, asXml) => {
        if (asXml) return text.encode(xml);
        const out = {};
        // mimetype first and stored, as the MusicXML container format asks.
        if (files.mimetype) out.mimetype = [files.mimetype, { level: 0 }];
        for (const [name, data] of Object.entries(files)) if (name !== 'mimetype') out[name] = name === rootPath ? text.encode(xml) : data;
        return zipSync(out, { level: 6 });
      },
    };
  }
  const text = decodeText(bytes);
  return { xml: text.xml, archive: false, write: xml => text.encode(xml) };
}

function decodeText(bytes) {
  const u8 = new Uint8Array(bytes);
  if (u8[0] === 0xff && u8[1] === 0xfe) {
    const xml = new TextDecoder('utf-16le').decode(u8.subarray(2));
    return { xml, encode: s => { const b = Buffer.from(s, 'utf16le'); return Buffer.concat([Buffer.from([0xff, 0xfe]), b]); } };
  }
  if (u8[0] === 0xfe && u8[1] === 0xff) {
    const xml = new TextDecoder('utf-16be').decode(u8.subarray(2));
    return { xml, encode: s => { const b = Buffer.from(s, 'utf16le'); b.swap16(); return Buffer.concat([Buffer.from([0xfe, 0xff]), b]); } };
  }
  const bom = u8[0] === 0xef && u8[1] === 0xbb && u8[2] === 0xbf;
  const xml = strFromU8(bom ? u8.subarray(3) : u8);
  return { xml, encode: s => (bom ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(strToU8(s))]) : Buffer.from(strToU8(s))) };
}

const shortPath = path => { const rel = relative(process.cwd(), path); return rel && !rel.startsWith('..') ? rel : path; };
const SCORE_EXT = /\.(musicxml|xml|mxl)$/i;
function listScores(dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...listScores(path));
    else if (SCORE_EXT.test(name)) out.push(path);
  }
  return out;
}

const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const noteName = midi => `${NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;

function summarize(file, result, written) {
  const lines = [`${file}${written ? ` -> ${written}` : ''}`];
  if (!result.parts.length) lines.push('  no target parts');
  for (const p of result.parts) {
    if (p.skipped) { lines.push(`  ${p.id} "${p.name}": skipped, ${p.skipped}`); continue; }
    const tuning = p.tuning.map(noteName).join(' ');
    lines.push(`  ${p.id} "${p.name}" [${tuning}${p.capo ? `, capo ${p.capo}` : ''}]: ${p.assigned} assigned, ${p.kept} kept, ${p.folded} folded, ${p.unplayable.length} unplayable${p.tabStaff ? ', TAB staff added' : ''}`);
    if (p.unplayable.length) lines.push(`    unplayable: ${p.unplayable.slice(0, 20).map(u => `m${u.measure} ${u.midi === null ? '?' : noteName(u.midi)}`).join(', ')}${p.unplayable.length > 20 ? ', …' : ''}`);
  }
  for (const w of result.warnings) lines.push(`  warning: ${w}`);
  return lines.join('\n');
}

const USAGE = `Usage: node scripts/tab-bake.mjs <in.musicxml|in.mxl|dir> [options]
  -o, --out <file>        output file (default: <name>.tab.<ext> next to the input; .musicxml/.xml output from .mxl unzips)
  --out-dir <dir>         output directory (needed for a directory input; keeps relative paths)
  --tuning <t>            standard | drop_d | half_step_down | open_g | open_d | dadgad | MIDI low→high (40,45,50,55,59,64)
                          (default: the part's own <staff-tuning>, else standard)
  --capo <n>              capo fret, frets are written relative to it (default: the part's <capo>, else 0)
  --parts <p>             guitar (default) | all | comma-separated part IDs
  --add-tab-staff         add a TAB staff (second staff) to each processed one-staff part
  --overwrite-existing    re-solve notes that already have string/fret and process parts that already have a TAB staff
  --dry-run               report only, write nothing`;

export async function main(argv = process.argv.slice(2)) {
  const { values, positionals } = parseArgs({
    args: argv, allowPositionals: true,
    options: {
      out: { type: 'string', short: 'o' }, 'out-dir': { type: 'string' }, tuning: { type: 'string' }, capo: { type: 'string' },
      parts: { type: 'string' }, 'add-tab-staff': { type: 'boolean' }, 'overwrite-existing': { type: 'boolean' },
      'dry-run': { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help || positionals.length !== 1) { console.log(USAGE); return values.help ? 0 : 2; }
  const capo = values.capo === undefined ? undefined : Number(values.capo);
  if (capo !== undefined && !(Number.isInteger(capo) && capo >= 0 && capo <= 24)) throw new Error(`--capo must be 0-24 (got ${values.capo})`);
  const parts = values.parts === undefined || values.parts === 'guitar' ? 'guitar' : values.parts === 'all' ? 'all' : values.parts.split(',').map(s => s.trim()).filter(Boolean);
  const options = { tuning: parseTuning(values.tuning), capo, parts, addTabStaff: !!values['add-tab-staff'], overwrite: !!values['overwrite-existing'] };
  const input = resolve(positionals[0]);
  if (!existsSync(input)) throw new Error(`No such file or directory: ${positionals[0]}`);
  const isDir = statSync(input).isDirectory();
  if (isDir && values.out) throw new Error('-o is for a single file; use --out-dir for a directory');
  if (isDir && !values['out-dir'] && !values['dry-run']) throw new Error('A directory input needs --out-dir (or --dry-run)');
  const files = isDir ? listScores(input) : [input];
  let failed = 0;
  const totals = { files: 0, parts: 0, assigned: 0, folded: 0, unplayable: 0 };
  for (const file of files) {
    const shown = shortPath(file);
    try {
      const score = readScore(file);
      if (isDir && !/<score-partwise\b|<score-timewise\b/.test(score.xml.slice(0, 4096))) continue;
      const result = bakeMusicXml(score.xml, options);
      let target = null;
      if (values.out) target = resolve(values.out);
      else if (values['out-dir']) target = resolve(values['out-dir'], isDir ? relative(input, file) : basename(file));
      else target = join(dirname(file), `${basename(file, extname(file))}.tab${extname(file)}`);
      if (!values['dry-run']) {
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, score.write(result.xml, score.archive && !/\.mxl$/i.test(target)));
      }
      console.log(summarize(shown, result, values['dry-run'] ? null : shortPath(target)));
      totals.files++;
      for (const p of result.parts) if (!p.skipped) { totals.parts++; totals.assigned += p.assigned; totals.folded += p.folded; totals.unplayable += p.unplayable.length; }
    } catch (error) {
      failed++;
      console.error(`${shown}: ${error.message}`);
    }
  }
  if (files.length > 1) console.log(`Total: ${totals.files} files, ${totals.parts} parts, ${totals.assigned} notes assigned, ${totals.folded} folded, ${totals.unplayable} unplayable${failed ? `, ${failed} failed` : ''}`);
  return failed ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(code => { process.exitCode = code; }, error => { console.error(error.message); process.exitCode = 1; });
}
