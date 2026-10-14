import { enableLog, enableLogToBuffer, LOG_WARNING, VerovioToolkit } from 'verovio/esm';
import createVerovioModule from 'verovio/wasm';
import { musicXmlTextNavigation } from '../../../pepperscore/src/lib/notation/navigation';
import { createDocument } from '../model/create';
import { parseDocument, type Event, type Note } from '../model/schema';
import { featuresDoc, fixedIds, helloDoc, navigationDoc, twoVoicePianoDoc } from '../test-helpers';
import { compileToMusicXml } from './to-musicxml';

const FIXTURES = import.meta.glob<unknown>('./__fixtures__/*.json', { eager: true, import: 'default' });

/** The `<note …>…</note>` element whose id is `id`. */
function noteXml(xml: string, id: string): string {
  const match = new RegExp(`<note id="${id}">[\\s\\S]*?</note>`).exec(xml);
  if (!match) throw new Error(`no <note id="${id}">`);
  return match[0];
}
/** The n-th (1-based) `<measure>` of the first part. */
function measureXml(xml: string, n: number): string {
  const match = new RegExp(`<measure number="${n}">[\\s\\S]*?</measure>`).exec(xml);
  if (!match) throw new Error(`no measure ${n}`);
  return match[0];
}
const squash = (xml: string) => xml.replace(/>\s+</g, '><');

const flute = () => fixedIds(createDocument({ parts: [{ name: 'Fl', clef: 'treble', gmProgram: 74 }], measures: 1 }));
const quarter = (id: string, notes: Note[], extra: Partial<Event> = {}): Event => ({ id, type: 'event', duration: { base: 'quarter', dots: 0 }, notes, ...extra });

test('hello world compiles', () => {
  const doc = createDocument({ meta: { title: 'Hello' }, parts: [{ name: 'Flute', clef: 'treble', gmProgram: 74 }], measures: 1 });
  const seq = doc.parts[0].measures[0].sequences[0];
  seq.content = [
    { id: 'e1', type: 'event', duration: { base: 'quarter', dots: 0 }, notes: [{ id: 'n1', pitch: { step: 'C', octave: 5, alter: 0 } }] },
    { id: 'e2', type: 'event', duration: { base: 'quarter', dots: 0 }, notes: [{ id: 'n2', pitch: { step: 'D', octave: 5, alter: 0 } }] },
    { id: 'e3', type: 'event', duration: { base: 'half', dots: 0 }, rest: true },
  ];
  const xml = compileToMusicXml(doc);
  expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n')).toBe(true);
  expect(xml).toContain('<score-partwise version="4.0">');
  expect(xml).toContain('<divisions>960</divisions>');
  expect(xml).toMatch(/<note id="n1">\s*<pitch>\s*<step>C<\/step>\s*<octave>5<\/octave>\s*<\/pitch>\s*<duration>960<\/duration>\s*<voice>1<\/voice>\s*<type>quarter<\/type>/);
  expect(xml).toMatch(/<note id="e3">\s*<rest\/>\s*<duration>1920<\/duration>\s*<voice>1<\/voice>\s*<type>half<\/type>/);
  const flat = squash(xml);
  expect(flat).toContain('<work><work-title>Hello</work-title></work>');
  expect(flat).not.toContain('<identification>');
  expect(flat).toContain('<score-part id="P1"><part-name>Flute</part-name><score-instrument id="P1-I1"><instrument-name>Flute</instrument-name></score-instrument><midi-instrument id="P1-I1"><midi-program>74</midi-program></midi-instrument></score-part>');
  expect(flat).toContain('<measure number="1"><attributes><divisions>960</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef number="1"><sign>G</sign><line>2</line></clef></attributes>');
  expect(flat).not.toContain('<staves>');
  expect(flat).not.toContain('<staff>');
});

test('header escapes text and writes the composer', () => {
  const doc = featuresDoc();
  const flat = squash(compileToMusicXml(doc));
  expect(flat).toContain('<identification><creator type="composer">Test &amp; Co</creator></identification>');
  expect(flat).toContain('<key><fifths>1</fifths></key>');
});

test('chords, beams, ties, slurs, articulations, tuplets, dynamics', () => {
  const xml = compileToMusicXml(featuresDoc());
  // Chord: the second note carries <chord/>; notations sit on the first.
  expect(noteXml(xml, 'n1')).not.toContain('<chord/>');
  expect(noteXml(xml, 'n2')).toMatch(/<note id="n2">\s*<chord\/>\s*<pitch>/);
  expect(squash(noteXml(xml, 'n1'))).toContain('<notations><slur type="start" number="1"/><articulations><staccato/></articulations></notations>');
  // Triplet: exact 320-tick members, time-modification, tuplet start/stop, beam.
  const n3 = squash(noteXml(xml, 'n3'));
  expect(n3).toContain('<duration>320</duration>');
  expect(n3).toContain('<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes><normal-type>eighth</normal-type></time-modification>');
  expect(n3).toContain('<beam number="1">begin</beam>');
  expect(n3).toContain('<tuplet type="start" bracket="yes"/>');
  expect(squash(noteXml(xml, 'n4'))).toContain('<beam number="1">continue</beam>');
  const n5 = squash(noteXml(xml, 'n5'));
  expect(n5).toContain('<beam number="1">end</beam>');
  expect(n5).toContain('<slur type="stop" number="1"/>');
  expect(n5).toContain('<tuplet type="stop"/>');
  // F-natural against G major's F#, carried to the next F5 in the bar.
  expect(n5).toContain('<accidental>natural</accidental>');
  expect(noteXml(xml, 'n6')).not.toContain('<accidental>');
  // Secondary beam over the two 16ths.
  expect(squash(noteXml(xml, 'n6'))).toContain('<beam number="1">begin</beam></note>');
  expect(squash(noteXml(xml, 'n7'))).toContain('<beam number="1">continue</beam><beam number="2">begin</beam>');
  expect(squash(noteXml(xml, 'n8'))).toContain('<beam number="1">end</beam><beam number="2">end</beam>');
  // Tie across the barline, accent and fermata.
  const n9 = squash(noteXml(xml, 'n9'));
  expect(n9).toContain('<tie type="start"/>');
  expect(n9).toContain('<notations><tied type="start"/><articulations><accent/></articulations></notations>');
  const n10 = squash(noteXml(xml, 'n10'));
  expect(n10).toContain('<tie type="stop"/>');
  expect(n10).toContain('<notations><tied type="stop"/><fermata/></notations>');
  // Dotted eighth + lone 16th: backward hook; cautionary natural.
  const n11 = squash(noteXml(xml, 'n11'));
  expect(n11).toContain('<duration>720</duration><voice>1</voice><type>eighth</type><dot/><accidental>sharp</accidental>');
  const n12 = squash(noteXml(xml, 'n12'));
  expect(n12).toContain('<accidental cautionary="yes">natural</accidental>');
  expect(n12).toContain('<beam number="1">end</beam><beam number="2">backward hook</beam>');
  // Dynamics and wedge, placed before the events they anchor to.
  const bar1 = squash(measureXml(xml, 1));
  expect(bar1).toContain('<direction placement="below"><direction-type><dynamics><mf/></dynamics></direction-type><sound dynamics="75"/></direction><note id="n1">');
  expect(bar1).toContain('<direction placement="below"><direction-type><wedge type="crescendo" number="1"/></direction-type></direction><note id="n3">');
  expect(bar1).toContain('<direction-type><wedge type="stop" number="1"/></direction-type></direction><note id="n9">');
  // Text direction with style and offset.
  expect(squash(measureXml(xml, 2))).toContain('<direction placement="above"><direction-type><words font-style="italic" relative-x="10" relative-y="-20">dolce</words></direction-type></direction><note id="n10">');
});

test('forward hook on a leading lone 16th, 32nd beams on level 3', () => {
  const doc = flute();
  const n = (id: string): Note[] => [{ id, pitch: { step: 'A', octave: 4, alter: 0 } }];
  doc.parts[0].measures[0].sequences[0].content = [
    { id: 'a', type: 'event', duration: { base: '16th', dots: 0 }, notes: n('na') },
    { id: 'b', type: 'event', duration: { base: 'eighth', dots: 1 }, notes: n('nb') },
    { id: 'c', type: 'event', duration: { base: '32nd', dots: 0 }, notes: n('nc') },
    { id: 'd', type: 'event', duration: { base: '32nd', dots: 0 }, notes: n('nd') },
    { id: 'e', type: 'event', duration: { base: '16th', dots: 0 }, notes: n('ne') },
    { id: 'f', type: 'event', duration: { base: 'eighth', dots: 0 }, notes: n('nf') },
    { id: 'g', type: 'event', duration: { base: 'half', dots: 0 }, rest: true },
  ];
  doc.parts[0].measures[0].beams = [{ id: 'b1', events: ['a', 'b'] }, { id: 'b2', events: ['c', 'd', 'e', 'f'] }];
  const xml = compileToMusicXml(doc);
  expect(squash(noteXml(xml, 'na'))).toContain('<beam number="1">begin</beam><beam number="2">forward hook</beam>');
  expect(squash(noteXml(xml, 'nb'))).toContain('<beam number="1">end</beam></note>');
  expect(squash(noteXml(xml, 'nc'))).toContain('<beam number="1">begin</beam><beam number="2">begin</beam><beam number="3">begin</beam>');
  expect(squash(noteXml(xml, 'nd'))).toContain('<beam number="1">continue</beam><beam number="2">continue</beam><beam number="3">end</beam>');
  expect(squash(noteXml(xml, 'ne'))).toContain('<beam number="1">continue</beam><beam number="2">end</beam></note>');
  expect(squash(noteXml(xml, 'nf'))).toContain('<beam number="1">end</beam></note>');
});

test('overlapping slurs get different numbers', () => {
  const doc = flute();
  const p = (id: string): Note[] => [{ id, pitch: { step: 'G', octave: 4, alter: 0 } }];
  doc.parts[0].measures[0].sequences[0].content = [
    quarter('a', p('na'), { slurs: [{ id: 's1', target: 'c', side: 'up' }] }),
    quarter('b', p('nb'), { slurs: [{ id: 's2', target: 'd' }] }),
    quarter('c', p('nc'), { slurs: [{ id: 's3', target: 'd' }] }),
    quarter('d', p('nd')),
  ];
  const xml = compileToMusicXml(doc);
  expect(noteXml(xml, 'na')).toContain('<slur type="start" number="1" placement="above"/>');
  expect(noteXml(xml, 'nb')).toContain('<slur type="start" number="2"/>');
  expect(noteXml(xml, 'nc')).toMatch(/<slur type="stop" number="1"\/>\s*<slur type="start" number="3"\/>/);
  expect(noteXml(xml, 'nd')).toMatch(/<slur type="stop" number="2"\/>\s*<slur type="stop" number="3"\/>/);
});

test('accidentals follow the key signature and earlier notes in the bar', () => {
  const doc = fixedIds(createDocument({ parts: [{ name: 'Fl', clef: 'treble', gmProgram: 74 }], measures: 2, key: { fifths: 2 } }));
  const e = (id: string, step: Note['pitch']['step'], octave: number, alter: number, accidental?: Note['accidental']): Event =>
    ({ id, type: 'event', duration: { base: 'eighth', dots: 0 }, notes: [{ id: `n${id}`, pitch: { step, octave, alter }, ...(accidental ? { accidental } : {}) }] });
  doc.parts[0].measures[0].sequences[0].content = [
    e('1', 'F', 4, 1), e('2', 'F', 4, 0), e('3', 'F', 4, 0), e('4', 'F', 5, 0),
    e('5', 'C', 5, 1, 'show'), e('6', 'G', 4, 1, 'hide'), e('7', 'G', 4, 1), e('8', 'B', 4, -1),
  ];
  doc.parts[0].measures[1].sequences[0].content = [{ id: 'r', type: 'event', duration: { base: 'eighth', dots: 0 }, notes: [{ id: 'n9', pitch: { step: 'F', octave: 4, alter: 0 } }] }, { id: 'x', type: 'event', duration: { base: 'quarter', dots: 1 }, notes: [{ id: 'n10', pitch: { step: 'B', octave: 4, alter: 0 } }] }, { id: 'h', type: 'event', duration: { base: 'half', dots: 0 }, rest: true }];
  const xml = compileToMusicXml(doc);
  const acc = (id: string) => /<accidental[^>]*>([^<]*)<\/accidental>/.exec(noteXml(xml, id))?.[1];
  expect(['n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'n7', 'n8', 'n9', 'n10'].map(acc))
    .toEqual([undefined, 'natural', undefined, 'natural', 'sharp', undefined, undefined, 'flat', 'natural', undefined]);
  expect(noteXml(xml, 'n8')).toMatch(/<step>B<\/step>\s*<alter>-1<\/alter>\s*<octave>4<\/octave>/);
});

test('tuplet durations are integers that sum to the span', () => {
  const doc = flute();
  const members: Event[] = Array.from({ length: 7 }, (_, i) => ({ id: `t${i}`, type: 'event', duration: { base: '16th', dots: 0 }, notes: [{ id: `nt${i}`, pitch: { step: 'C', octave: 5, alter: 0 } }] }));
  doc.parts[0].measures[0].sequences[0].content = [
    { id: 'sept', type: 'tuplet', outer: { multiple: 7, base: '16th' }, inner: { multiple: 4, base: '16th' }, content: members },
    { id: 'r', type: 'event', duration: { base: 'quarter', dots: 1 }, rest: true },
    { id: 'r2', type: 'event', duration: { base: 'eighth', dots: 0 }, rest: true },
    { id: 'r3', type: 'event', duration: { base: 'half', dots: 0 }, rest: true },
  ];
  const xml = compileToMusicXml(doc);
  const durations = members.map((m) => Number(/<duration>(\d+)<\/duration>/.exec(noteXml(xml, `n${m.id}`))![1]));
  expect(durations).toEqual([137, 137, 137, 137, 137, 137, 138]);
  expect(squash(noteXml(xml, 'nt0'))).toContain('<time-modification><actual-notes>7</actual-notes><normal-notes>4</normal-notes><normal-type>16th</normal-type></time-modification>');
  expect(noteXml(xml, 'r')).toContain('<duration>1440</duration>');
});

test('full-measure rests span the real bar', () => {
  const doc = fixedIds(createDocument({ parts: [{ name: 'Fl', clef: 'treble', gmProgram: 74 }], measures: 1, time: { count: 3, unit: 4 } }));
  const xml = compileToMusicXml(doc);
  const rest = squash(noteXml(xml, 'p1m1s1v1r1'));
  expect(rest).toBe('<note id="p1m1s1v1r1"><rest measure="yes"/><duration>2880</duration><voice>1</voice></note>');
});

test('grace notes have no duration and do not advance time', () => {
  const doc = flute();
  doc.parts[0].measures[0].sequences[0].content = [
    { id: 'g', type: 'event', duration: { base: '16th', dots: 0 }, grace: { slash: true }, notes: [{ id: 'ng', pitch: { step: 'D', octave: 5, alter: 0 } }] },
    { id: 'w', type: 'event', duration: { base: 'whole', dots: 0 }, notes: [{ id: 'nw', pitch: { step: 'C', octave: 5, alter: 0 } }] },
  ];
  doc.parts[0].measures[0].directions = [{ kind: 'dynamic', id: 'd', anchor: { measureId: 'm1', tick: 0, staff: 1 }, value: 'p' }];
  const flat = squash(compileToMusicXml(doc));
  expect(flat).toContain('<note id="ng"><grace slash="yes"/><pitch><step>D</step><octave>5</octave></pitch><voice>1</voice><type>16th</type></note>');
  expect(flat).toContain('<direction><direction-type><dynamics><p/></dynamics></direction-type><sound dynamics="50"/></direction><note id="ng">');
});

test('two staves: voices, staff numbers, backups and clefs', () => {
  const xml = compileToMusicXml(twoVoicePianoDoc());
  const bar1 = squash(measureXml(xml, 1));
  expect(bar1).toContain('<staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef>');
  expect(bar1).toMatch(/<note id="n5">.*<tie type="start"\/><voice>1<\/voice><type>half<\/type><stem>up<\/stem><staff>1<\/staff>/);
  expect(bar1).toContain('</note><backup><duration>3840</duration></backup><note id="n10">');
  expect(bar1).toContain('<voice>2</voice><type>whole</type><stem>down</stem><staff>1</staff>');
  expect(bar1).toMatch(/<note id="n20">.*?<voice>5<\/voice><type>half<\/type><staff>2<\/staff>/);
  expect(bar1).toContain('<direction placement="below"><direction-type><wedge type="crescendo" number="1"/></direction-type><staff>1</staff></direction><note id="n1">');
  expect(bar1).toContain('<direction-type><wedge type="stop" number="1"/></direction-type><staff>1</staff></direction><note id="n5">');
  expect(squash(measureXml(xml, 2))).not.toContain('<attributes>');
});

test('later measures write only changed attributes; mid-bar clefs are dropped with a warning', () => {
  const doc = fixedIds(createDocument({ parts: [{ name: 'Gtr', clef: 'treble8vb', gmProgram: 25 }], measures: 3 }));
  doc.global.measures[1].time = { count: 3, unit: 4 };
  doc.global.measures[2].key = { fifths: -3, mode: 'minor' };
  doc.parts[0].measures[1].clefs = [{ staff: 1, clef: 'bass' }];
  doc.parts[0].measures[2].clefs = [{ staff: 1, clef: 'alto', tick: 960 }, { staff: 1, clef: 'percussion', tick: 0 }];
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const xml = compileToMusicXml(doc);
  expect(warn).toHaveBeenCalledTimes(1);
  expect(warn.mock.calls[0][0]).toMatch(/mid-bar clef/);
  warn.mockRestore();
  expect(squash(measureXml(xml, 1))).toContain('<clef number="1"><sign>G</sign><line>2</line><clef-octave-change>-1</clef-octave-change></clef>');
  expect(squash(measureXml(xml, 2))).toContain('<measure number="2"><attributes><time><beats>3</beats><beat-type>4</beat-type></time><clef number="1"><sign>F</sign><line>4</line></clef></attributes>');
  expect(squash(measureXml(xml, 2))).toContain('<rest measure="yes"/><duration>2880</duration>');
  expect(squash(measureXml(xml, 3))).toContain('<measure number="3"><attributes><key><fifths>-3</fifths><mode>minor</mode></key><clef number="1"><sign>percussion</sign><line>2</line></clef></attributes>');
});

test('layout filters and orders parts', () => {
  const doc = fixedIds(createDocument({ parts: [{ name: 'Flute', clef: 'treble', gmProgram: 74 }, { name: 'Cello', clef: 'bass', gmProgram: 43 }], measures: 1 }));
  doc.layouts.push({ id: 'cello', name: 'Cello part', kind: 'part', transposing: true, parts: [{ partId: 'p2' }], overrides: {} });
  const all = squash(compileToMusicXml(doc));
  expect(all).toContain('<score-part id="P1"><part-name>Flute</part-name>');
  expect(all).toContain('<score-part id="P2"><part-name>Cello</part-name>');
  const part = squash(compileToMusicXml(doc, { layoutId: 'cello' }));
  expect(part).toContain('<score-part id="P1"><part-name>Cello</part-name>');
  expect(part).not.toContain('Flute');
  expect(part).not.toContain('id="P2"');
});

test('barlines, endings and navigation words', () => {
  const doc = navigationDoc();
  doc.global.measures[3].ending = { numbers: [2], open: true };
  doc.global.measures[2].repeatEnd = { times: 2 };
  const xml = compileToMusicXml(doc);
  const m = (n: number) => squash(measureXml(xml, n));
  expect(m(1)).toContain('<direction placement="above"><direction-type><rehearsal>A</rehearsal></direction-type></direction>');
  expect(m(1)).toContain('<direction placement="above"><direction-type><segno/></direction-type><sound segno="segno0"/></direction>');
  expect(m(1)).toContain('<direction placement="above"><direction-type><words font-weight="bold">Andante</words></direction-type><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>96</per-minute></metronome></direction-type><sound tempo="96"/></direction>');
  expect(m(2)).toContain('<measure number="2"><barline location="left"><bar-style>heavy-light</bar-style><repeat direction="forward"/></barline>');
  expect(m(3)).toContain('<barline location="left"><ending number="1" type="start"/></barline>');
  expect(m(3)).toContain('<barline location="right"><bar-style>light-heavy</bar-style><ending number="1" type="stop"/><repeat direction="backward" times="2"/></barline></measure>');
  expect(m(4)).toContain('<barline location="left"><ending number="2" type="start"/></barline>');
  expect(m(4)).toContain('<direction placement="above"><direction-type><words>To Coda</words></direction-type><sound tocoda="coda5"/></direction><barline location="right"><ending number="2" type="discontinue"/></barline></measure>');
  expect(m(5)).toContain('<direction placement="above"><direction-type><words>D.S. al Coda</words></direction-type><sound dalsegno="segno0"/></direction><barline location="right"><bar-style>light-light</bar-style></barline></measure>');
  expect(m(6)).toContain('<direction placement="above"><direction-type><coda/></direction-type><sound coda="coda5"/></direction>');
  expect(m(6)).toContain('<barline location="right"><bar-style>light-heavy</bar-style></barline></measure>');
  // A multi-bar ending starts once and stops once.
  const long = fixedIds(createDocument({ parts: [{ name: 'Fl', clef: 'treble', gmProgram: 74 }], measures: 3 }));
  long.global.measures[0].repeatStart = true;
  long.global.measures[1].ending = { numbers: [1, 2] }; long.global.measures[2].ending = { numbers: [1, 2] }; long.global.measures[2].repeatEnd = {};
  long.global.measures[0].fine = true; long.global.measures[2].jump = { type: 'dc', target: 'fine' };
  const lx = compileToMusicXml(long);
  expect(squash(measureXml(lx, 2))).toContain('<ending number="1,2" type="start"/>');
  expect(squash(measureXml(lx, 2))).not.toContain('type="stop"');
  expect(squash(measureXml(lx, 3))).not.toContain('type="start"');
  expect(squash(measureXml(lx, 3))).toContain('<ending number="1,2" type="stop"/>');
  expect(squash(measureXml(lx, 1))).toContain('<direction placement="above"><direction-type><words>Fine</words></direction-type><sound fine="yes"/></direction>');
  expect(squash(measureXml(lx, 3))).toContain('<words>D.C. al Fine</words></direction-type><sound dacapo="yes"/>');
});

test('viewer navigation reads compiled repeats', () => {
  const doc = createDocument({ parts: [{ name: 'Fl', clef: 'treble', gmProgram: 74 }], measures: 6 });
  const g = doc.global.measures;
  g[0].segno = true; g[1].repeatStart = true; g[2].ending = { numbers: [1] }; g[2].repeatEnd = {}; g[3].ending = { numbers: [2] }; g[3].toCoda = true; g[4].jump = { type: 'ds', target: 'coda' }; g[4].fine = false; g[5].coda = true;
  const diagnostics: string[] = [];
  const nav = musicXmlTextNavigation(compileToMusicXml(doc), 6, diagnostics);
  expect(diagnostics).toEqual([]);
  expect(nav[0].segno).toBe(true); expect(nav[1].repeatStart).toBe(true);
  expect(nav[2]).toMatchObject({ repeatEnd: true, endings: [1] }); expect(nav[3]).toMatchObject({ endings: [2], toCoda: true });
  expect(nav[4].dalSegno).toBe(true); expect(nav[5].coda).toBe(true);
  expect(nav[5].endings).toBeUndefined();
});

test('Verovio loads the compiled score without warnings', async () => {
  const module = await createVerovioModule();
  enableLogToBuffer(true, module);
  enableLog(LOG_WARNING, module);
  const tk = new VerovioToolkit(module);
  for (const doc of [twoVoicePianoDoc(), featuresDoc(), navigationDoc(), helloDoc()]) {
    expect(tk.loadData(compileToMusicXml(doc))).toBeTruthy();
    expect(tk.getPageCount()).toBeGreaterThan(0);
    const svg = tk.renderToSVG(1);
    const firstNote = doc.parts[0].measures[0].sequences[0].content.flatMap((c) => (c.type === 'tuplet' ? c.content : [c]))[0];
    expect(svg).toContain(firstNote.notes?.[0]?.id ?? firstNote.id);
    expect(tk.getLog()).toBe('');
  }
}, 30_000);

test('golden: every fixture', async () => {
  const files = Object.keys(FIXTURES);
  expect(files.length).toBeGreaterThanOrEqual(4);
  for (const file of files) {
    const xml = compileToMusicXml(parseDocument(FIXTURES[file]));
    await expect(xml, file).toMatchFileSnapshot(file.replace(/\.json$/, '.musicxml'));
  }
});

test('a bar without sequences still fills its time and keeps its directions', () => {
  const doc = flute();
  doc.parts[0].measures[0].sequences = [];
  doc.parts[0].measures[0].directions = [{ kind: 'dynamic', id: 'd', anchor: { measureId: 'm1', tick: 960, staff: 1 }, value: 'f' }];
  expect(squash(measureXml(compileToMusicXml(doc), 1))).toContain('<forward><duration>3840</duration><voice>1</voice></forward><direction><direction-type><dynamics><f/></dynamics></direction-type><offset>-2880</offset><sound dynamics="88"/></direction></measure>');
});
