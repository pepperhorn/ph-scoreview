import { createDocument } from './model/create';
import type { Document, Event, Note, Pitch } from './model/schema';

const pitch = (step: Pitch['step'], octave: number): Pitch => ({ step, octave, alter: 0 });
const quarter = (id: string, noteId: string, p: Pitch): Event => ({
  id, type: 'event', duration: { base: 'quarter', dots: 0 }, notes: [{ id: noteId, pitch: p }],
});

/** Flute, one 4/4 bar: C5 D5 quarters (events e1, e2; notes n1, n2) and a half rest (e3). */
export function helloDoc(): Document {
  const doc = createDocument({ meta: { title: 'Hello' }, parts: [{ name: 'Flute', clef: 'treble', gmProgram: 74 }], measures: 1 });
  doc.parts[0].measures[0].sequences[0].content = [
    quarter('e1', 'n1', pitch('C', 5)),
    quarter('e2', 'n2', pitch('D', 5)),
    { id: 'e3', type: 'event', duration: { base: 'half', dots: 0 }, rest: true },
  ];
  return doc;
}

/** Flute, one 4/4 bar: C4 D4 E4 quarters (events e1-e3; notes n1-n3) and a quarter rest (e4). */
export function threeQuarterNotesDoc(): Document {
  const doc = createDocument({ parts: [{ name: 'Flute', clef: 'treble', gmProgram: 74 }], measures: 1 });
  doc.parts[0].measures[0].sequences[0].content = [
    quarter('e1', 'n1', pitch('C', 4)),
    quarter('e2', 'n2', pitch('D', 4)),
    quarter('e3', 'n3', pitch('E', 4)),
    { id: 'e4', type: 'event', duration: { base: 'quarter', dots: 0 }, rest: true },
  ];
  return doc;
}

/**
 * Replaces the random ids `createDocument` assigns (global and part measures,
 * parts, sequences, full-measure rests, layouts) with fixed ones so compiled
 * output and fixtures are deterministic. Global measure i becomes `m<i+1>`.
 */
export function fixedIds(doc: Document): Document {
  doc.global.measures.forEach((g, i) => { g.id = `m${i + 1}`; });
  doc.parts.forEach((part, pi) => {
    const partId = `p${pi + 1}`;
    doc.layouts.forEach((layout) => layout.parts.forEach((lp) => { if (lp.partId === part.id) lp.partId = partId; }));
    part.id = partId;
    part.measures.forEach((pm, mi) => {
      pm.id = `${partId}m${mi + 1}`;
      pm.sequences.forEach((seq) => {
        seq.id = `${pm.id}s${seq.staff}v${seq.voice}`;
        seq.content.forEach((item, ci) => { if (item.type === 'event' && item.fullMeasure) item.id = `${seq.id}r${ci + 1}`; });
      });
    });
  });
  doc.layouts.forEach((layout, li) => { layout.id = `layout${li + 1}`; });
  return doc;
}

const note = (id: string, step: Pitch['step'], octave: number, extra: Partial<Note> = {}): Note => ({ id, pitch: pitch(step, octave), ...extra });
const ev = (id: string, base: Event['duration']['base'], notes: Note[], extra: Partial<Event> = {}): Event => ({
  id, type: 'event', duration: { base, dots: 0 }, notes, ...extra,
});
const rest = (id: string, base: Event['duration']['base']): Event => ({ id, type: 'event', duration: { base, dots: 0 }, rest: true });

/**
 * Piano (2 staves), two 4/4 bars. Staff 1 voice 1: C5 D5 E5 F5 eighths (beam b1)
 * and G5 half tied (n5 -> n6) into bar 2's G5 half, then a half rest; staff 1
 * voice 2: E4 / D4 wholes; staff 2: C3 G2 halves / C3 whole. A cresc wedge
 * (w1) spans the first two beats of bar 1 on staff 1.
 */
export function twoVoicePianoDoc(): Document {
  const doc = fixedIds(createDocument({ meta: { title: 'Two Voices' }, parts: [{ name: 'Piano', clef: 'treble', gmProgram: 1, staves: 2 }], measures: 2 }));
  const [m1, m2] = doc.parts[0].measures;
  const up = { stem: 'up' as const }, down = { stem: 'down' as const };
  m1.sequences = [
    { id: 's1', staff: 1, voice: 1, content: [
      ev('e1', 'eighth', [note('n1', 'C', 5)], up), ev('e2', 'eighth', [note('n2', 'D', 5)], up),
      ev('e3', 'eighth', [note('n3', 'E', 5)], up), ev('e4', 'eighth', [note('n4', 'F', 5)], up),
      ev('e5', 'half', [note('n5', 'G', 5, { tie: { target: 'n6' } })], up),
    ] },
    { id: 's2', staff: 1, voice: 2, content: [ev('e10', 'whole', [note('n10', 'E', 4)], down)] },
    { id: 's3', staff: 2, voice: 1, content: [ev('e20', 'half', [note('n20', 'C', 3)]), ev('e21', 'half', [note('n21', 'G', 2)])] },
  ];
  m1.beams = [{ id: 'b1', events: ['e1', 'e2', 'e3', 'e4'] }];
  m1.directions = [{ kind: 'wedge', id: 'w1', anchor: { measureId: 'm1', tick: 0, staff: 1 }, placement: 'below', shape: 'cresc', endTick: 1920 }];
  m2.sequences = [
    { id: 's4', staff: 1, voice: 1, content: [ev('e6', 'half', [note('n6', 'G', 5)], up), rest('e7', 'half')] },
    { id: 's5', staff: 1, voice: 2, content: [ev('e11', 'whole', [note('n11', 'D', 4)], down)] },
    { id: 's6', staff: 2, voice: 1, content: [ev('e22', 'whole', [note('n22', 'C', 3)])] },
  ];
  return doc;
}

/**
 * Flute, two 4/4 bars in G major covering the compiler's note features.
 * Bar 1: C5+E5 chord (staccato, slur sl1 to e4, mf), a 3:2 eighth triplet
 * D5 E5 F-natural5 (beam b2), F5 eighth + G5 A5 16ths (beam b1), B5 quarter
 * tied into bar 2 (accent); cresc wedge w1 from tick 960 to 2880.
 * Bar 2: B5 quarter (fermata), dotted-eighth C#6 + 16th D-natural6
 * (cautionary; beam b3), half rest; italic text "dolce" offset (1, -2).
 */
export function featuresDoc(): Document {
  const doc = fixedIds(createDocument({ meta: { title: 'Features', composer: 'Test & Co' }, parts: [{ name: 'Flute', clef: 'treble', gmProgram: 74 }], measures: 2, key: { fifths: 1 } }));
  const [m1, m2] = doc.parts[0].measures;
  m1.sequences[0].content = [
    ev('e1', 'quarter', [note('n1', 'C', 5), note('n2', 'E', 5)], { articulations: ['staccato'], slurs: [{ id: 'sl1', target: 'e4' }] }),
    { id: 't1', type: 'tuplet', outer: { multiple: 3, base: 'eighth' }, inner: { multiple: 2, base: 'eighth' }, bracket: true, content: [
      ev('e2', 'eighth', [note('n3', 'D', 5)]), ev('e3', 'eighth', [note('n4', 'E', 5)]), ev('e4', 'eighth', [note('n5', 'F', 5)]),
    ] },
    ev('e5', 'eighth', [note('n6', 'F', 5)]), ev('e6', '16th', [note('n7', 'G', 5)]), ev('e7', '16th', [note('n8', 'A', 5)]),
    ev('e8', 'quarter', [note('n9', 'B', 5, { tie: { target: 'n10' } })], { articulations: ['accent'] }),
  ];
  m1.beams = [{ id: 'b2', events: ['e2', 'e3', 'e4'] }, { id: 'b1', events: ['e5', 'e6', 'e7'] }];
  m1.directions = [
    { kind: 'dynamic', id: 'd1', anchor: { measureId: 'm1', tick: 0, staff: 1 }, placement: 'below', value: 'mf' },
    { kind: 'wedge', id: 'w1', anchor: { measureId: 'm1', tick: 960, staff: 1 }, placement: 'below', shape: 'cresc', endTick: 2880 },
  ];
  m2.sequences[0].content = [
    ev('e9', 'quarter', [note('n10', 'B', 5)], { articulations: ['fermata'] }),
    { id: 'e10', type: 'event', duration: { base: 'eighth', dots: 1 }, notes: [{ id: 'n11', pitch: { step: 'C', octave: 6, alter: 1 } }] },
    ev('e11', '16th', [note('n12', 'D', 6, { accidental: 'cautionary' })]),
    rest('e12', 'half'),
  ];
  m2.beams = [{ id: 'b3', events: ['e10', 'e11'] }];
  m2.directions = [{ kind: 'text', id: 'x1', anchor: { measureId: 'm2', tick: 0, staff: 1 }, placement: 'above', offset: { x: 1, y: -2 }, text: 'dolce', style: 'expression' }];
  return doc;
}

/**
 * Flute, six 4/4 bars of full-measure rests: segno (1), repeat start (2),
 * first ending with repeat end (3), second ending + To Coda (4), D.S. al Coda
 * (5), coda (6) with a final barline.
 */
export function navigationDoc(): Document {
  const doc = fixedIds(createDocument({ meta: { title: 'Roadmap' }, parts: [{ name: 'Fl', clef: 'treble', gmProgram: 74 }], measures: 6 }));
  const g = doc.global.measures;
  g[0].segno = true; g[0].tempo = { bpm: 96, unit: 'quarter', text: 'Andante' }; g[0].rehearsal = 'A';
  g[1].repeatStart = true;
  g[2].ending = { numbers: [1] }; g[2].repeatEnd = {};
  g[3].ending = { numbers: [2] }; g[3].toCoda = true;
  g[4].jump = { type: 'ds', target: 'coda' }; g[4].barline = 'double';
  g[5].coda = true; g[5].barline = 'final';
  return doc;
}
