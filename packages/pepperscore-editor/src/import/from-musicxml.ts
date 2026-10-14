import { fullMeasureRest, restEvent } from '../model/create';
import { BASE_TICKS, ticksToDurations } from '../model/durations';
import { newId } from '../model/ids';
import { beamIssue, checkInvariants } from '../model/invariants';
import { eventStarts, sequenceFor, sequenceTicks } from '../model/query';
import { DocumentSchema, type Document, type Event, type GlobalMeasure, type Part, type PartMeasure } from '../model/schema';
import { DropLog, barTicksAt, child, childText, closeEnding, readMeasure, type Dropped, type PartReader } from './measure-reader';
import { parseXmlTree, type XmlElement } from './xml-stream';

export type { Dropped } from './measure-reader';

const STAFF_LIMIT = 4;

/**
 * Reads partwise MusicXML into an editor document. Features the model cannot hold
 * are counted in `dropped` per `P<part>/m<measure>`. The result is normalized so
 * that importing its compiled MusicXML gives the same document again (ids are
 * assigned from positions). Scores over `maxStaves` (default 4) are refused.
 */
export function importMusicXml(text: string, { maxStaves = STAFF_LIMIT }: { maxStaves?: number } = {}): { document: Document; dropped: Dropped[] } {
  const root = parseXmlTree(text);
  if (root.localName === 'score-timewise') throw new Error('Only partwise MusicXML is supported.');
  if (root.localName !== 'score-partwise') throw new Error('This is not a MusicXML score.');

  const scoreParts = new Map<string, XmlElement>();
  const partList = child(root, 'part-list');
  for (const sp of partList?.children ?? []) if (sp.localName === 'score-part') scoreParts.set(sp.getAttribute('id') ?? '', sp);
  const partEls = root.children.filter((c) => c.localName === 'part');
  const staves = partEls.map((p) => Math.max(1, ...p.descendants().filter((e) => e.localName === 'staves').map((e) => Number(e.textContent) || 1)));
  if (staves.some((s) => s > 2)) throw new Error('Parts with more than 2 staves are not supported.');
  if (staves.reduce((a, b) => a + b, 0) > maxStaves) throw new Error(`Editing is limited to ${maxStaves} staves.`);

  const title = childText(child(root, 'work') ?? root, 'work-title') ?? childText(root, 'movement-title');
  const composer = child(root, 'identification')?.children.find((c) => c.localName === 'creator' && c.getAttribute('type') === 'composer')?.textContent;
  const doc: Document = {
    global: { measures: [] },
    parts: [],
    layouts: [],
    style: {},
    meta: { ...(title !== undefined ? { title } : {}), ...(composer !== undefined ? { composer } : {}) },
  };
  const drop = new DropLog();

  partEls.forEach((partEl, partIndex) => {
    const part = newPart(scoreParts.get(partEl.getAttribute('id') ?? ''), staves[partIndex] as 1 | 2);
    doc.parts.push(part);
    const reader: PartReader = {
      doc, drop, partIndex, part, divisions: 1, voices: new Map(), ties: new Map(), slurs: new Map(), slurStops: new Map(), wedges: new Map(),
    };
    partEl.children.filter((c) => c.localName === 'measure').forEach((measureEl, index) => {
      while (doc.global.measures.length <= index) doc.global.measures.push({ id: `m${doc.global.measures.length + 1}` });
      readMeasure(reader, measureEl, index);
    });
    closeEnding(reader, false);
    for (const pending of reader.ties.values()) for (const { location } of pending) drop.add('tie', location);
    for (const open of reader.slurs.values()) for (const { location } of open) drop.add('slur', location);
  });
  doc.layouts.push({ id: 'L1', name: 'Full score', kind: 'score', transposing: true, parts: doc.parts.map((p) => ({ partId: p.id })), overrides: {} });

  normalize(doc, drop);
  const parsed = DocumentSchema.safeParse(doc);
  if (!parsed.success) throw new Error(`Import produced an invalid document: ${parsed.error.issues[0].path.join('.')} ${parsed.error.issues[0].message}`);
  const errors = checkInvariants(doc, { maxStaves });
  if (errors.length) throw new Error(`Import produced an invalid document: ${errors[0]}`);
  return { document: doc, dropped: drop.list() };
}

function newPart(scorePart: XmlElement | undefined, staves: 1 | 2): Part {
  const midi = scorePart && child(scorePart, 'midi-instrument');
  const program = Number(midi && childText(midi, 'midi-program'));
  const channel = Number(midi && childText(midi, 'midi-channel'));
  const abbreviation = scorePart && childText(scorePart, 'part-abbreviation');
  return {
    id: newId(),
    name: (scorePart && child(scorePart, 'part-name')?.textContent) ?? '',
    ...(abbreviation !== undefined ? { abbreviation } : {}),
    instrument: {
      gmProgram: Number.isInteger(program) && program >= 1 && program <= 128 ? program : 1,
      ...(Number.isInteger(channel) && channel >= 1 && channel <= 16 ? { midiChannel: channel } : {}),
    },
    staves,
    clefs: staves === 2 ? ['treble', 'bass'] : ['treble'],
    measures: [],
  };
}

/** Pads, orders, validates and renumbers the walked document so it is valid and a compile/import fixed point. */
function normalize(doc: Document, drop: DropLog): void {
  const globals = doc.global.measures;
  if (globals.length) {
    globals[0].time ??= { count: 4, unit: 4 };
    globals[0].key ??= { fifths: 0 };
  }
  doc.parts.forEach((part, pi) => {
    while (part.measures.length < globals.length) part.measures.push({ id: newId(), sequences: [], beams: [], directions: [] });
    part.measures.forEach((pm, mi) => {
      const barTicks = barTicksAt(doc, mi);
      const location = `P${pi + 1}/m${mi + 1}`;
      padSequences(part, pm, barTicks);
      for (const d of pm.directions) {
        d.anchor.tick = Math.min(d.anchor.tick, barTicks);
        if (d.kind === 'wedge' && d.endTick < 0) d.endTick = barTicks;
      }
      pm.directions = pm.directions.map((d, i) => ({ d, i })).sort((a, b) => a.d.anchor.tick - b.d.anchor.tick || a.i - b.i).map(({ d }) => d);
      pm.beams = pm.beams.filter((beam) => {
        if (!beamIssue(pm, beam, barTicks)) return true;
        drop.add('beam', location);
        return false;
      });
      const position = new Map(pm.sequences.flatMap((seq) => eventStarts(seq, barTicks).map((s) => s.event.id)).map((id, i) => [id, i]));
      pm.beams.sort((a, b) => position.get(a.events[0])! - position.get(b.events[0])!);
    });
    validateTies(doc, part, pi, drop);
    canonicalSlurs(doc, part);
  });
  repairNavigation(globals, drop);
  renumber(doc);
}

/** Every staff gets a voice 1; every sequence is filled to the bar with rests; sequences sort by staff and voice. */
function padSequences(part: Part, pm: PartMeasure, barTicks: number): void {
  for (let staff = 1; staff <= part.staves; staff++) {
    if (!sequenceFor(pm, staff, 1)) pm.sequences.push({ id: newId(), staff, voice: 1, content: [] });
  }
  for (const seq of pm.sequences) {
    if (!seq.content.length) {
      seq.content.push(fullMeasureRest());
      continue;
    }
    const missing = Math.floor((barTicks - sequenceTicks(seq, barTicks) + 0.5) / BASE_TICKS['32nd']) * BASE_TICKS['32nd'];
    if (missing > 0) for (const d of ticksToDurations(missing)) seq.content.push(restEvent(d));
  }
  pm.sequences.sort((a, b) => a.staff - b.staff || a.voice - b.voice);
}

/** Drops ties whose target is not an equal pitch in the next event of the same voice (the model's tie invariant). */
function validateTies(doc: Document, part: Part, pi: number, drop: DropLog): void {
  part.measures.forEach((pm, mi) => {
    for (const seq of pm.sequences) {
      const starts = eventStarts(seq, barTicksAt(doc, mi));
      starts.forEach(({ event }, i) => {
        for (const note of event.notes ?? []) {
          if (!note.tie) continue;
          let next: Event | undefined = starts[i + 1]?.event;
          if (!next && mi + 1 < part.measures.length) {
            const following = sequenceFor(part.measures[mi + 1], seq.staff, seq.voice);
            next = following ? eventStarts(following, barTicksAt(doc, mi + 1))[0]?.event : undefined;
          }
          const target = next?.notes?.find((n) => n.id === note.tie!.target);
          const p = note.pitch;
          if (!target || target.pitch.step !== p.step || target.pitch.octave !== p.octave || target.pitch.alter !== p.alter) {
            delete note.tie;
            drop.add('tie', `P${pi + 1}/m${mi + 1}`);
          }
        }
      });
    }
  });
}

/**
 * Slurs as the compiler writes them: each starts on the earlier event in writing
 * order (bar, staff, voice, time), and an event's slurs sort by their target.
 */
function canonicalSlurs(doc: Document, part: Part): void {
  const order = new Map<string, number>();
  const events: Event[] = [];
  part.measures.forEach((pm, mi) => {
    for (const seq of pm.sequences) for (const { event } of eventStarts(seq, barTicksAt(doc, mi))) {
      order.set(event.id, order.size);
      events.push(event);
    }
  });
  const slurs: { from: Event; to: Event; side?: 'up' | 'down' }[] = [];
  for (const event of events) {
    for (const slur of event.slurs ?? []) {
      const at = order.get(slur.target);
      if (at === undefined || slur.target === event.id) continue;
      const target = events[at];
      const forward = order.get(event.id)! <= at;
      slurs.push({ from: forward ? event : target, to: forward ? target : event, ...(slur.side ? { side: slur.side } : {}) });
    }
    delete event.slurs;
  }
  slurs.sort((a, b) => order.get(a.from.id)! - order.get(b.from.id)! || order.get(a.to.id)! - order.get(b.to.id)!);
  for (const { from, to, side } of slurs) (from.slurs ??= []).push({ id: newId(), target: to.id, ...(side ? { side } : {}) });
}

/**
 * Makes navigation satisfy the model's invariants: an ending without a repeat
 * start repeats from the bar after the previous repeat end (or bar 1); jumps
 * whose marks are missing lose their target; a Fine nothing jumps to is dropped.
 */
function repairNavigation(globals: GlobalMeasure[], drop: DropLog): void {
  globals.forEach((g, i) => {
    if (!g.ending) return;
    for (let j = i; j >= 0; j--) {
      if (globals[j].repeatStart) return;
      if (j < i && globals[j].repeatEnd && !globals[j].ending) {
        globals[j + 1].repeatStart = true;
        return;
      }
    }
    globals[0].repeatStart = true;
  });
  const hasCodaMarks = globals.some((g) => g.toCoda) && globals.some((g) => g.coda);
  const hasSegno = globals.some((g) => g.segno);
  globals.forEach((g, i) => {
    if (!g.jump) return;
    if (g.jump.target === 'coda' && !hasCodaMarks) {
      g.jump = { ...g.jump, target: 'end' };
      drop.add('al Coda', `P1/m${i + 1}`);
    }
    if (g.jump.type === 'ds' && !hasSegno) {
      g.jump = { ...g.jump, type: 'dc' };
      drop.add('D.S. without segno', `P1/m${i + 1}`);
    }
  });
  if (!globals.some((g) => g.jump?.target === 'fine')) {
    globals.forEach((g, i) => {
      if (!g.fine) return;
      delete g.fine;
      drop.add('Fine', `P1/m${i + 1}`);
    });
  }
}

/** Ids from positions, so the same music always gets the same ids; references follow. */
function renumber(doc: Document): void {
  const events = new Map<string, string>();
  const notes = new Map<string, string>();
  doc.parts.forEach((part, pi) => {
    const partId = `P${pi + 1}`;
    for (const layout of doc.layouts) for (const lp of layout.parts) if (lp.partId === part.id) lp.partId = partId;
    part.id = partId;
    part.measures.forEach((pm, mi) => {
      pm.id = `${partId}m${mi + 1}`;
      for (const seq of pm.sequences) {
        seq.id = `${pm.id}s${seq.staff}v${seq.voice}`;
        let k = 0;
        const name = (event: Event) => {
          const id = `${seq.id}e${++k}`;
          events.set(event.id, id);
          event.id = id;
          event.notes?.forEach((note, j) => {
            notes.set(note.id, `${id}n${j + 1}`);
            note.id = `${id}n${j + 1}`;
          });
        };
        for (const item of seq.content) {
          if (item.type === 'tuplet') {
            item.id = `${seq.id}t${++k}`;
            item.content.forEach(name);
          } else name(item);
        }
      }
      pm.beams.forEach((beam, i) => { beam.id = `${pm.id}b${i + 1}`; });
      pm.directions.forEach((d, i) => { d.id = `${pm.id}d${i + 1}`; });
    });
  });
  for (const part of doc.parts) for (const pm of part.measures) {
    for (const beam of pm.beams) beam.events = beam.events.map((id) => events.get(id) ?? id);
    for (const seq of pm.sequences) for (const { event } of eventStarts(seq)) {
      event.slurs?.forEach((slur, i) => {
        slur.id = `${event.id}s${i + 1}`;
        slur.target = events.get(slur.target) ?? slur.target;
      });
      for (const note of event.notes ?? []) if (note.tie) note.tie = { target: notes.get(note.tie.target) ?? note.tie.target };
    }
  }
}
