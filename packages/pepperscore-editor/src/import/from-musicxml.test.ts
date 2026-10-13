import { compileToMusicXml } from '../compile/to-musicxml';
import { createDocument } from '../model/create';
import { checkInvariants } from '../model/invariants';
import { eventStarts, sequenceTicks } from '../model/query';
import type { Document } from '../model/schema';
import { featuresDoc, helloDoc, navigationDoc, threeQuarterNotesDoc, twoVoicePianoDoc } from '../test-helpers';
import { importMusicXml } from './from-musicxml';

const FIXTURES = import.meta.glob<string>('../../../../validation/fixtures/*.musicxml', { eager: true, query: '?raw', import: 'default' });
function fixture(file: string): string {
  const text = FIXTURES[`../../../../validation/fixtures/${file}.musicxml`];
  if (text === undefined) throw new Error(`missing fixture ${file}`);
  return text;
}
const strip = (d: Document) => JSON.parse(JSON.stringify(d, (k, v) => k === 'id' ? undefined : v));
/** Compiled MusicXML with note ids removed, to compare documents whose ids differ. */
const anonymous = (xml: string) => xml.replace(/ id="[^"]*"/g, '');

test('round trip is a fixed point', () => {
  let imported = 0;
  for (const file of ['ensemble', 'expressive', 'clock-contract', 'idless-sibelius']) {
    const text = fixture(file);
    let first; try { first = importMusicXml(text); } catch (e) { if (/4 staves|partwise/.test(String(e))) continue; throw e; }
    const second = importMusicXml(compileToMusicXml(first.document));
    expect(strip(second.document)).toEqual(strip(first.document));
    imported++;
  }
  expect(imported).toBe(3);
});

test('two voices via backup', () => {
  const xml = compileToMusicXml(twoVoicePianoDoc());
  const { document } = importMusicXml(xml);
  const m0 = document.parts[0].measures[0];
  expect(m0.sequences.map(s => [s.staff, s.voice, sequenceTicks(s)])).toEqual([[1,1,3840],[1,2,3840],[2,1,3840]]);
});

test('reports dropped features', () => {
  const xml = compileToMusicXml(helloDoc()).replace('</note>', '<lyric><text>la</text></lyric></note>');
  expect(importMusicXml(xml).dropped).toEqual([{ feature: 'lyric', count: 1, location: 'P1/m1' }]);
});

test('refuses timewise and >4 staves', () => {
  expect(() => importMusicXml('<score-timewise version="4.0"><part-list/></score-timewise>')).toThrow('Only partwise MusicXML is supported.');
  const five = createDocument({ parts: Array.from({ length: 5 }, (_, i) => ({ name: `P${i}`, clef: 'treble' as const, gmProgram: 1 })), measures: 1 });
  expect(() => importMusicXml(compileToMusicXml(five))).toThrow('Editing is limited to 4 staves.');
  expect(importMusicXml(compileToMusicXml(five), { maxStaves: 5 }).document.parts).toHaveLength(5);
  expect(() => importMusicXml(compileToMusicXml(five), { maxStaves: 3 })).toThrow('Editing is limited to 3 staves.');
  const three = compileToMusicXml(helloDoc()).replace('<divisions>960</divisions>', '<divisions>960</divisions><staves>3</staves>');
  expect(() => importMusicXml(three)).toThrow('Parts with more than 2 staves are not supported.');
});

test('the importer inverts the compiler', () => {
  for (const make of [helloDoc, threeQuarterNotesDoc, featuresDoc, navigationDoc, twoVoicePianoDoc]) {
    const xml = compileToMusicXml(make());
    const { document, dropped } = importMusicXml(xml);
    expect(dropped).toEqual([]);
    expect(checkInvariants(document)).toEqual([]);
    expect(anonymous(compileToMusicXml(document))).toBe(anonymous(xml));
  }
});

test('expressive fixture: tuplet, grace, slur, tie, navigation and what is dropped', () => {
  const { document, dropped } = importMusicXml(fixture('expressive'));
  const [m1, m2, m3, m4] = document.parts[0].measures;
  const [tuplet, grace, long1] = m1.sequences[0].content;
  expect(tuplet).toMatchObject({ type: 'tuplet', outer: { multiple: 3, base: 'eighth' }, inner: { multiple: 2, base: 'eighth' } });
  expect(grace).toMatchObject({ grace: { slash: true }, duration: { base: 'eighth', dots: 0 } });
  expect(long1).toMatchObject({ duration: { base: 'half', dots: 1 } });
  if (tuplet.type !== 'tuplet' || long1.type !== 'event') throw new Error('shape');
  expect(tuplet.content[0].slurs).toEqual([expect.objectContaining({ target: tuplet.content[2].id })]);
  expect(m1.beams).toEqual([expect.objectContaining({ events: tuplet.content.map(e => e.id) })]);
  const long2 = eventStarts(m2.sequences[0], 3840)[0].event;
  expect(long1.notes![0].tie).toEqual({ target: long2.notes![0].id });
  expect(eventStarts(m2.sequences[0], 3840)[1].event.articulations).toEqual(['accent', 'fermata']);
  expect(m1.sequences.map(s => [s.staff, s.voice])).toEqual([[1, 1], [2, 1]]);
  expect(document.parts[0].clefs).toEqual(['treble', 'bass']);
  expect(m1.directions.map(d => d.kind)).toEqual(['dynamic', 'wedge']);
  expect(m1.directions[1]).toMatchObject({ shape: 'cresc', endTick: 0, endMeasureId: document.global.measures[1].id });
  const flat = m3.sequences[0].content.map(e => e.type === 'event' && e.notes?.[0].accidental);
  expect(flat).toEqual([false, 'cautionary', false].map(v => v || undefined));
  expect(m4.sequences[0].content).toHaveLength(1);
  const g = document.global.measures;
  expect(g[0]).toMatchObject({ repeatStart: true, rehearsal: 'A', time: { count: 4, unit: 4 }, key: { fifths: 0 } });
  expect(g[2]).toMatchObject({ time: { count: 3, unit: 4 }, key: { fifths: 2 }, tempo: { bpm: 120, unit: 'quarter' } });
  expect(g[3].repeatEnd).toEqual({ times: 2 });
  expect(dropped).toEqual([
    { feature: 'harmony', count: 1, location: 'P1/m1' },
    { feature: 'lyric', count: 3, location: 'P1/m1' },
    { feature: 'trill-mark', count: 1, location: 'P1/m1' },
    { feature: 'pedal', count: 2, location: 'P1/m2' },
    { feature: 'arpeggiate', count: 1, location: 'P1/m4' },
  ]);
});

test('ID-less export: empty bars, wedge offset, chord, forward, grace', () => {
  const { document, dropped } = importMusicXml(fixture('idless-sibelius'));
  const [m1, m2, m3, m4, m5] = document.parts[0].measures;
  expect(document.parts[0].clefs).toEqual(['bass']);
  for (const pm of [m1, m2]) expect(pm.sequences).toEqual([expect.objectContaining({ content: [expect.objectContaining({ rest: true, fullMeasure: true })] })]);
  expect(m1.directions).toEqual([expect.objectContaining({ kind: 'text', text: 'Opening', placement: 'above' })]);
  expect(document.global.measures[0].tempo).toEqual({ bpm: 150, unit: 'quarter' });
  expect(m3.directions).toEqual([expect.objectContaining({ kind: 'wedge', anchor: expect.objectContaining({ tick: 480 }), endTick: 1920 })]);
  expect(m4.sequences.map(s => [s.voice, eventStarts(s, 3840).map(e => e.event.notes?.length ?? 0)])).toEqual([[1, [1, 2, 0, 0]], [2, [1]]]);
  expect(m5.sequences[0].content.map(e => e.type === 'event' && Boolean(e.grace))).toEqual([true, false]);
  expect(document.global.measures[4].barline).toBe('final');
  expect(dropped.map(d => `${d.feature}@${d.location}`)).toEqual(['measure-style@P1/m1', 'harmony@P1/m3', 'harmony@P1/m4', 'harmony@P1/m5']);
});

test('clock contract: a pickup bar is padded and reported', () => {
  const { document, dropped } = importMusicXml(fixture('clock-contract'));
  expect(document.global.measures.map(g => g.tempo?.bpm)).toEqual([120, undefined, 60, 180]);
  expect(document.parts[0]).toMatchObject({ name: 'Piano', instrument: { gmProgram: 1 }, staves: 1, clefs: ['treble'] });
  expect(sequenceTicks(document.parts[0].measures[0].sequences[0], 3840)).toBe(3840);
  expect(dropped).toEqual([{ feature: 'pickup', count: 1, location: 'P1/m1' }, { feature: 'mid-bar tempo', count: 1, location: 'P1/m4' }]);
});

const score = (measures: string) => `<?xml version="1.0"?><score-partwise><part-list><score-part id="P1"><part-name>X</part-name></score-part></part-list><part id="P1">${measures}</part></score-partwise>`;
const n = (step: string, type: string, extra = '', voice = 1, duration = { quarter: 2, eighth: 1, half: 4 }[type]) =>
  `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>${duration}</duration><voice>${voice}</voice><type>${type}</type>${extra}</note>`;

test('messy input is repaired into a valid fixed point', () => {
  const xml = score(
    `<measure number="1"><attributes><divisions>2</divisions></attributes>`
    + n('C', 'eighth', '<beam number="1">begin</beam>')
    + '<note><grace/><pitch><step>D</step><octave>4</octave></pitch><voice>1</voice><type>16th</type></note>'
    + n('E', 'eighth', '<beam number="1">end</beam><notations><slur type="stop" number="1"/></notations>')
    + n('F', 'half', '<tie type="start"/>')
    + '<backup><duration>6</duration></backup>'
    + n('G', 'quarter', '<notations><slur type="start" number="1" placement="below"/></notations>', 2)
    + '<barline location="right"><ending number="1" type="start"/></barline></measure>'
    + `<measure number="2">${n('A', 'half')}<direction><direction-type><words>Fine</words></direction-type></direction>`
    + '<barline location="right"><bar-style>light-heavy</bar-style><ending number="1" type="stop"/><repeat direction="backward"/></barline></measure>',
  );
  const { document, dropped } = importMusicXml(xml);
  expect(checkInvariants(document)).toEqual([]);
  const [m1, m2] = document.parts[0].measures;
  // The grace note splits the beam, the tie has no stop and Fine has no jump.
  expect(m1.beams).toEqual([]);
  expect(dropped).toEqual([{ feature: 'tie', count: 1, location: 'P1/m1' }, { feature: 'beam', count: 1, location: 'P1/m1' }, { feature: 'Fine', count: 1, location: 'P1/m2' }]);
  // The slur stop came first (voice 1) but the slur starts on the earlier-written event.
  const [c, , e] = eventStarts(m1.sequences[0], 3840).map((s) => s.event);
  expect(c.slurs).toBeUndefined();
  expect(e.slurs).toEqual([{ id: expect.any(String), target: m1.sequences[1].content[0].id, side: 'down' }]);
  expect(m1.sequences.map((s) => [s.staff, s.voice, s.content.length])).toEqual([[1, 1, 5], [1, 2, 2]]);
  expect(m2.sequences[0].content.map((e) => e.type === 'event' && e.rest === true)).toEqual([false, true]);
  // An ending with no forward repeat repeats from bar 1.
  expect(document.global.measures.map((g) => [g.repeatStart, g.ending, g.repeatEnd, g.fine])).toEqual([
    [true, { numbers: [1] }, undefined, undefined], [undefined, { numbers: [1] }, {}, undefined],
  ]);
  const again = importMusicXml(compileToMusicXml(document));
  expect(strip(again.document)).toEqual(strip(document));
  expect(again.dropped).toEqual([]);
});
