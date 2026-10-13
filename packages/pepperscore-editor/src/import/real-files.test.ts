import { compileToMusicXml } from '../compile/to-musicxml';
import { DocumentSchema } from '../model/schema';
import { importMusicXml } from './from-musicxml';

// Real scores kept locally (both directories are gitignored, so either may be empty in CI).
const VARIATIONS = import.meta.glob<string>('../../../../apps/reader/public/variations/**/*.{musicxml,xml}', { eager: true, query: '?raw', import: 'default' });
const EXAMPLES = import.meta.glob<string>('../../../../examples/**/*.{musicxml,xml}', { eager: true, query: '?raw', import: 'default' });

/** Refusals the importer makes by design; anything else is an import failure. */
const REFUSED = /more than 2 staves|partwise|not a MusicXML score/;

// Every local score is over the 4-staff licence default, so the staff cap is lifted here: the cap is a
// licence check, not an import limitation, and lifting it is what exercises the real files.
test('every local partwise score imports and round-trips without new drops', () => {
  const files = [...Object.entries(VARIATIONS), ...Object.entries(EXAMPLES)];
  const failures: string[] = [];
  for (const [file, text] of files) {
    let first;
    try {
      first = importMusicXml(text, { maxStaves: Infinity });
    } catch (error) {
      if (REFUSED.test(String(error))) continue;
      failures.push(`${file}: ${String(error).slice(0, 200)}`);
      continue;
    }
    try {
      DocumentSchema.parse(first.document);
      const second = importMusicXml(compileToMusicXml(first.document), { maxStaves: Infinity });
      if (second.dropped.length) failures.push(`${file}: re-import dropped ${JSON.stringify(second.dropped)}`);
    } catch (error) {
      failures.push(`${file}: round trip ${String(error).slice(0, 200)}`);
    }
  }
  expect(failures).toEqual([]);
  console.info(`real-files: ${files.length} local scores checked`);
});

const triplet = (step: string, duration: number) =>
  `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>${duration}</duration><voice>1</voice><type>eighth</type>` +
  `<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification></note>`;

test('directions after a triplet with an offset get integer ticks (divisions 256)', () => {
  const xml = `<?xml version="1.0"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Flute</part-name></score-part></part-list>
<part id="P1"><measure number="1">
<attributes><divisions>256</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
${triplet('C', 85)}${triplet('D', 85)}${triplet('E', 86)}
<direction placement="below"><direction-type><dynamics><f/></dynamics></direction-type><offset>85</offset></direction>
<direction placement="below"><direction-type><wedge type="crescendo"/></direction-type><offset>37</offset></direction>
<note><pitch><step>F</step><octave>4</octave></pitch><duration>256</duration><voice>1</voice><type>quarter</type></note>
<direction placement="below"><direction-type><wedge type="stop"/></direction-type><offset>99</offset></direction>
<note><rest/><duration>512</duration><voice>1</voice><type>half</type></note>
</measure></part></score-partwise>`;
  const { document, dropped } = importMusicXml(xml);
  expect(() => DocumentSchema.parse(document)).not.toThrow();
  const directions = document.parts[0].measures[0].directions;
  expect(directions.length).toBe(2);
  for (const d of directions) {
    expect(Number.isInteger(d.anchor.tick)).toBe(true);
    if (d.kind === 'wedge') expect(Number.isInteger(d.endTick)).toBe(true);
  }
  expect(importMusicXml(compileToMusicXml(document)).dropped).toEqual([]);
  expect(dropped).toEqual([]);
});

test('a whole rest filling a 3/4 bar without measure="yes" is a bar rest', () => {
  const xml = `<?xml version="1.0"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
<part id="P1"><measure number="1">
<attributes><divisions>256</divisions><time><beats>3</beats><beat-type>4</beat-type></time></attributes>
<note><rest/><duration>768</duration><voice>1</voice><type>whole</type></note>
</measure></part></score-partwise>`;
  const { document } = importMusicXml(xml);
  expect(document.parts[0].measures[0].sequences[0].content).toEqual([expect.objectContaining({ rest: true, fullMeasure: true })]);
});

const oneBar = (divisions: number, time: string, body: string) => `<?xml version="1.0"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Flute</part-name></score-part></part-list>
<part id="P1"><measure number="1"><attributes><divisions>${divisions}</divisions>${time}</attributes>${body}</measure></part></score-partwise>`;
const FOUR_FOUR = '<time><beats>4</beats><beat-type>4</beat-type></time>';
const shape = (xml: string) => importMusicXml(xml).document.parts[0].measures[0].sequences.map((s) => s.content.map((e) => (e.type === 'event' ? `${e.rest ? 'r' : e.notes![0].pitch.step}:${e.duration.base}` : 'tuplet')));

test('a one-division <forward> gap is a real gap at divisions 1 and 2, not rounding', () => {
  // divisions 1: voice 2 skips one quarter, then a C half and a quarter rest.
  const d1 = oneBar(1, FOUR_FOUR, `<note><rest measure="yes"/><duration>4</duration><voice>1</voice></note><backup><duration>4</duration></backup>
<forward><duration>1</duration><voice>2</voice></forward><note><pitch><step>C</step><octave>5</octave></pitch><duration>2</duration><voice>2</voice><type>half</type></note>`);
  expect(shape(d1)[1].slice(0, 2)).toEqual(['r:quarter', 'C:half']);
  // divisions 2: one division is an eighth.
  const d2 = oneBar(2, FOUR_FOUR, `<forward><duration>1</duration></forward><note><pitch><step>D</step><octave>5</octave></pitch><duration>2</duration><voice>1</voice><type>quarter</type></note>`);
  expect(shape(d2)[0].slice(0, 2)).toEqual(['r:eighth', 'D:quarter']);
});

test('a 3/4 whole rest at divisions 1 is a bar rest', () => {
  const xml = oneBar(1, '<time><beats>3</beats><beat-type>4</beat-type></time>', '<note><rest/><duration>3</duration><voice>1</voice><type>whole</type></note>');
  expect(importMusicXml(xml).document.parts[0].measures[0].sequences[0].content).toEqual([expect.objectContaining({ rest: true, fullMeasure: true })]);
});
