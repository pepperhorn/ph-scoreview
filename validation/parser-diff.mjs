// Differential test of the Phase 2 streaming MusicXML reader (src/lib/notation/musicxml-source.ts) against the frozen
// DOM importer it replaced (validation/reference/musicxml-dom.ts), in Chromium:
//   - the Score model is deep-equal (keys, key order, values, undefined-valued keys),
//   - the engraving text parses to the same document (one DOMParser + XMLSerializer round trip of the new text equals
//     the old XMLSerializer output; the new text splices the source instead of re-serializing it),
//   - feature inventory, navigation diagnostics, playback marks (articulations, pedals) and text navigation match,
//   - malformed documents are rejected with the same message.
// Inputs: validation/fixtures, synthetic orchestral scores (including the ~5 MB one validation/large-score.mjs opens),
// the edge cases below, and any extra directories in PARSER_DIFF_DIRS (colon-separated; *.musicxml / *.xml).
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright-core';
import { strToU8, zipSync } from 'fflate';
import { orchestral } from './synthetic.mjs';

const root = new URL('..', import.meta.url);
const port = 43984;
const server = spawn('node', ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: root, stdio: 'ignore' });

const head = (parts = '<score-part id="P1"><part-name>Piano</part-name></score-part>', extra = '') => `<?xml version="1.0" encoding="UTF-8"?>\n<score-partwise version="4.0">${extra}<part-list>${parts}</part-list>`;
const one = (measures, extra = '') => `${head(undefined, extra)}<part id="P1">${measures}</part></score-partwise>`;
const attrs = '<attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>';
const note = (step, octave, duration = 4, extra = '', type = 'quarter') => `<note><pitch><step>${step}</step><octave>${octave}</octave></pitch><duration>${duration}</duration><voice>1</voice><type>${type}</type>${extra}</note>`;

/** Edge cases: [label, text]. */
const cases = [
  ['CRLF, entities, CDATA, comments, PIs', `<?xml version="1.0"?>\r\n<?xml-stylesheet href="x.css"?>\r\n<!-- head -->\r\n<score-partwise version="4.0">\r\n<work><work-title>Rock &amp; Roll &#x2013; &lt;Live&gt;</work-title></work>\r\n<movement-title><![CDATA[Mvt <1>]]></movement-title>\r\n<part-list><score-part id="P1"><part-name>Gu&#105;tar</part-name></score-part></part-list>\r\n<part id="P1"><measure number="1">${attrs}<!-- c --><direction placement="above"><direction-type><words>D.S.\r\nal Coda</words></direction-type></direction>${note('C', 4, 16, '', 'whole')}</measure><measure number="2"><direction><direction-type><words>Fine</words></direction-type></direction>${note('D', 4, 16, '', 'whole')}</measure></part>\r\n</score-partwise>\r\n`],
  ['timewise', `<?xml version="1.0"?><score-timewise version="4.0"><work><work-title>Timewise</work-title></work><part-list><score-part id="P1"><part-name>Drum</part-name></score-part><score-part id="P2"><part-name>Bass</part-name></score-part></part-list><measure number="0" implicit="yes"><part id="P1"><attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>percussion</sign></clef></attributes><note><unpitched><display-step>C</display-step><display-octave>5</display-octave></unpitched><duration>2</duration><type>eighth</type><voice>1</voice></note><backup><duration>2</duration></backup><note><rest/><duration>2</duration><voice>2</voice><type>eighth</type></note></part><part id="P2"><attributes><divisions>4</divisions><clef><sign>F</sign><line>4</line></clef></attributes>${note('C', 3, 2, '', 'eighth')}</part></measure><measure><barline location="left"><repeat direction="forward"/></barline><part id="P2">${note('D', 3, 16, '', 'whole')}</part><part id="P3">${note('E', 3, 16, '', 'whole')}</part></measure></score-timewise>`],
  ['timewise with xmlns and comments', `<score-timewise xmlns:xlink="http://www.w3.org/1999/xlink" version="3.1"><!-- c --><part-list><score-part id="A"><part-name>A</part-name></score-part></part-list><measure number="1" width="200"><part id="A"><!-- inner -->${attrs}${note('C', 4, 16, '<notations><articulations><staccato/></articulations></notations>', 'whole')}</part></measure></score-timewise>`],
  ['multi-measure rests', one(`<measure number="1">${attrs}<attributes><measure-style><multiple-rest>3</multiple-rest></measure-style></attributes><note><rest measure="yes"/><duration>16</duration><voice>1</voice></note></measure><measure number="2"><note><rest measure="yes"/><duration>16</duration><voice>1</voice></note></measure><measure number="3"><attributes><measure-style><multiple-rest>1</multiple-rest><slash type="start"/></measure-style><measure-style>
    <multiple-rest>2</multiple-rest>
    <multiple-rest>2</multiple-rest>
  </measure-style></attributes><note><rest measure="yes"/><duration>16</duration><voice>1</voice></note></measure><measure number="4">${note('C', 4, 16, '', 'whole')}</measure>`)],
  ['note IDs: native, duplicate, xml:id, empty, self-closing', `${head('<score-part id="P1"><part-name>A</part-name></score-part><score-part id="P2"><part-name>B</part-name></score-part>')}<part id="P1"><measure number="1">${attrs}<note id="n1"><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type></note><note xml:id="x1"><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type></note><note id="" xml:id="x2"><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type></note><note id=''><pitch><step>F</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type></note></measure></part><part id="P2"><measure number="1">${attrs}<note id="n1"><pitch><step>G</step><octave>4</octave></pitch><duration>8</duration><voice>1</voice><type>half</type></note><note id="mx_p2_m1_n2" ><pitch><step>A</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type></note><note/><note
    default-x="12"><pitch><step>B</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type></note></measure></part></score-partwise>`],
  ['late part-list and defaults', `<score-partwise><part id="P1"><measure number="1">${attrs}<attributes><transpose><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose><for-part><part-transpose><chromatic>-3</chromatic></part-transpose></for-part></attributes>${note('C', 4, 16, '', 'whole')}</measure></part><part-list><score-part id="P1"><part-name>Late clarinet</part-name><midi-instrument id="I"><midi-program>72</midi-program></midi-instrument></score-part></part-list><defaults><concert-score/></defaults></score-partwise>`],
  ['root-level concert score, no part-list, part without id', `<score-partwise><concert-score/><part><measure>${attrs}<attributes><for-part><part-transpose><chromatic>-2</chromatic><octave-change>-1</octave-change></part-transpose></for-part></attributes>${note('C', 4, 16, '', 'whole')}</measure></part><part><measure>${note('E', 4, 16, '', 'whole')}</measure></part></score-partwise>`],
  ['drums: unpitched after the first measure, channel 10, midi-unpitched', `${head('<score-part id="D"><part-name>Kit</part-name><score-instrument id="D-I36"><instrument-name>Kick</instrument-name></score-instrument><midi-instrument id="D-I36"><midi-channel>9</midi-channel><midi-program>1</midi-program><midi-unpitched>36</midi-unpitched></midi-instrument><midi-instrument id="D-I38"><midi-unpitched>38</midi-unpitched></midi-instrument></score-part><score-part id="K"><part-name>Kit 2</part-name><midi-instrument id="K1"><midi-channel>10</midi-channel><midi-program>1</midi-program></midi-instrument></score-part>')}<part id="D"><measure number="1"><attributes><divisions>1</divisions><clef><sign>percussion</sign></clef></attributes><note><rest/><duration>4</duration><voice>1</voice></note></measure><measure number="2"><note><unpitched><display-step>F</display-step><display-octave>4</display-octave></unpitched><duration>2</duration><instrument id="D-I38"/><voice>1</voice><type>half</type></note><note><unpitched><display-step>E</display-step><display-octave>4</display-octave></unpitched><duration>2</duration><instrument id="D-I36"/><voice>1</voice><type>half</type></note></measure></part><part id="K"><measure number="1"><attributes><divisions>1</divisions></attributes><note><unpitched><display-step>G</display-step><display-octave>5</display-octave></unpitched><duration>4</duration><voice>1</voice></note></measure></part></score-partwise>`],
  ['attribute normalization, quotes, prefixes', `<mx:score-partwise xmlns:mx="urn:x" version='4.0'><mx:part-list><mx:score-part id='P&apos;1'><mx:part-name>Tab\tPart</mx:part-name></mx:score-part></mx:part-list><mx:part id='P&apos;1'><mx:measure number="1&#10;a" implicit="yes"><mx:attributes><mx:divisions>2</mx:divisions></mx:attributes><mx:note id="a
b	c"><mx:pitch><mx:step>G</mx:step><mx:octave>4</mx:octave></mx:pitch><mx:duration>2</mx:duration><mx:type>quarter</mx:type></mx:note></mx:measure></mx:part></mx:score-partwise>`],
  ['internal DTD subset entity', `<?xml version="1.0"?><!DOCTYPE score-partwise [<!ENTITY comp "J. S. Bach"><!ELEMENT x ANY><!ATTLIST x y CDATA "z">]><score-partwise><identification><creator type="composer">&comp;</creator><creator type="lyricist">Anon</creator><rights>© 2026</rights></identification><credit><credit-type>title</credit-type><credit-words>Credited title</credit-words></credit><credit><credit-type>subtitle</credit-type><credit-words>Sub</credit-words><credit-words>More words</credit-words></credit><part-list><score-part id="P1"><part-name>bass voice</part-name></score-part></part-list><part id="P1"><measure>${note('C', 3, 4)}</measure></part></score-partwise>`],
  ['piano: staves, backup, clef change, transposition per staff, pickup', `${head('<score-part id="P1"><part-name>Piano</part-name><score-instrument id="P1-I1"><instrument-name>Piano</instrument-name><virtual-instrument><virtual-library>General MIDI</virtual-library><virtual-name>Bright Acoustic Piano</virtual-name></virtual-instrument></score-instrument></score-part>')}<part id="P1"><measure number="0" implicit="yes"><attributes><divisions>2</divisions><key><fifths>-2</fifths></key><time><beats>3</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef><transpose number="2"><chromatic>-12</chromatic></transpose></attributes>${note('B', 4, 2, '<staff>1</staff>')}<backup><duration>2</duration></backup><note><pitch><step>B</step><alter>-1</alter><octave>2</octave></pitch><duration>2</duration><voice>2</voice><type>quarter</type><staff>2</staff></note></measure><measure number="1"><attributes><clef number="2"><sign>C</sign><line>4</line></clef></attributes><note><pitch><step>C</step><octave>5</octave></pitch><duration>6</duration><voice>1</voice><type>half</type><dot/><staff>1</staff></note><note><chord/><pitch><step>E</step><octave>5</octave></pitch><duration>6</duration><voice>1</voice><type>half</type><dot/><staff>1</staff></note><note><chord/><pitch><step>G</step><octave>5</octave></pitch><duration>2</duration><voice>1</voice><type>quarter</type><staff>1</staff></note><backup><duration>6</duration></backup><forward><duration>2</duration></forward><note><pitch><step>D</step><octave>3</octave></pitch><duration>4</duration><voice>2</voice><type>half</type><staff>2</staff></note></measure></part></score-partwise>`],
  ['expression: harmony, metronome, dynamics, wedges, sound', one(`<measure number="1">${attrs}<harmony><root><root-step>F</root-step><root-alter>1</root-alter></root><kind text="m7b5">half-diminished</kind><bass><bass-step>C</bass-step></bass></harmony><direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><beat-unit-dot/><per-minute>60</per-minute></metronome></direction-type><voice>1</voice><staff>1</staff></direction><direction><direction-type><dynamics><mf/><other-dynamics> SFP </other-dynamics></dynamics></direction-type><offset>2</offset></direction><direction><direction-type><wedge type="crescendo" number="2"/></direction-type><sound dynamics="80"/></direction><direction><direction-type><words>(Easy 3)</words></direction-type></direction><harmony><root><root-step>G</root-step></root><kind>dominant</kind><offset>4</offset></harmony>${note('C', 4)}${note('D', 4)}<direction><sound tempo="132"/></direction>${note('E', 4, 8, '', 'half')}</measure>`)],
  ['notation: tuplets, grace, chords, ties, slurs, beams, rest-only part', `${head('<score-part id="P1"><part-name>Violin</part-name></score-part><score-part id="P2"><part-name>Placeholder</part-name></score-part><score-part id="P3"><part-name>Tempo only</part-name></score-part>')}<part id="P1"><measure number="1">${attrs}<note><grace slash="yes"/><pitch><step>D</step><octave>5</octave></pitch><voice>1</voice><type>eighth</type></note><note><pitch><step>C</step><octave>5</octave></pitch><duration>2</duration><tie type="start"/><voice>1</voice><type>eighth</type><time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification><beam number="1">begin</beam><beam number="2">begin</beam><notations><tied type="start"/><tuplet type="start" number="2"/><slur type="start" number="1"/></notations></note><note><pitch><step>C</step><octave>5</octave></pitch><duration>2</duration><tie type="stop"/><tie type="start"/><voice>1</voice><type>eighth</type><time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification><beam number="1">continue</beam></note><note><pitch><step>E</step><octave>5</octave></pitch><duration>2</duration><tie type="stop"/><voice>1</voice><type>eighth</type><time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification><beam number="1">end</beam><notations><tuplet type="stop"/><slur type="stop"/></notations></note><note><pitch><step>F</step><alter>1</alter><octave>4</octave></pitch><duration>8</duration><voice>1</voice><type>half</type><accidental cautionary="yes">sharp</accidental><stem>up</stem></note><note><rest/><type>quarter</type><voice>1</voice></note></measure></part><part id="P2"><measure number="1">${attrs}<note><rest measure="yes"/><duration>16</duration><voice>1</voice></note></measure></part><part id="P3"><measure number="1">${attrs}<direction><sound tempo="90"/></direction><note><rest measure="yes"/><duration>16</duration><voice>1</voice></note></measure></part></score-partwise>`],
  ['navigation: repeats, endings, segno/coda, middle barlines', one(`<measure number="1">${attrs}<barline location="left"><repeat direction="forward"/></barline><direction><direction-type><segno/></direction-type></direction>${note('C', 4, 8, '', 'half')}<barline location="middle"><repeat direction="backward" times="3"/><ending number="1" type="start"/></barline>${note('D', 4, 8, '', 'half')}</measure><measure number="2"><barline location="left"><ending number="1, 2" type="start"/></barline>${note('E', 4, 16, '', 'whole')}<barline location="right"><ending number="1, 2" type="stop"/><repeat direction="backward"/></barline></measure><measure number="3"><barline location="left"><ending number="3" type="start"/></barline><direction><direction-type><words>To Coda</words><coda/></direction-type></direction>${note('F', 4, 16, '', 'whole')}<barline location="right"><ending number="3" type="discontinue"/></barline></measure><measure number="4"><direction><sound dalsegno="segno" fine="no"/></direction><direction><direction-type><coda/></direction-type></direction>${note('G', 4, 16, '', 'whole')}</measure><measure number="5"><direction><direction-type><words>D.C. al Fine</words></direction-type></direction>${note('A', 4, 16, '', 'whole')}</measure>`)],
  ['playback marks: articulations, fermata, cue, ornaments, pedals', `${head('<score-part id="P1"><part-name>Piano</part-name></score-part><score-part id="P2"><part-name>Flute</part-name></score-part>')}<part id="P1"><measure number="1">${attrs}<direction><direction-type><pedal type="start"/></direction-type><offset sound="yes">2</offset></direction>${note('C', 4, 4, '<notations><articulations><staccato/><accent/></articulations></notations>')}<sound damper-pedal="40"/>${note('D', 4, 4, '<notations><fermata/></notations>')}<direction><direction-type><pedal type="change"/></direction-type><sound sostenuto-pedal="yes"/></direction><note><cue/><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice></note><direction><direction-type><words>x</words></direction-type><sound damper-pedal="no" sostenuto-pedal="yes"/></direction>${note('F', 4, 4, '<notations><ornaments><trill-mark/></ornaments><articulations><tenuto/><strong-accent/></articulations></notations>')}</measure></part><part id="P2"><measure number="1">${attrs}<direction><direction-type><pedal type="sostenuto"/></direction-type></direction>${note('G', 5, 16, '<notations><articulations><staccatissimo/></articulations></notations>', 'whole')}</measure></part><part id="P1"><measure><direction><direction-type><pedal type="stop"/></direction-type></direction>${note('A', 4, 16, '', 'whole')}</measure></part></score-partwise>`],
  ['whitespace-heavy indented export', orchestral(3, 4).replace(/<\/note>/g, '</note>\n\n   ')],
  ['UTF-8 names and BOM-less unicode', one(`<measure number="1">${attrs}<direction><direction-type><words>𝄋 Segno — ü</words></direction-type></direction>${note('C', 4, 16, '<lyric><text>Ñandú</text></lyric>', 'whole')}</measure>`, '<work><work-title>Ünïcödé 𝄞</work-title></work>')],
];
/** Malformed or non-score documents: [label, text]; both readers must reject them with the same message. */
const rejected = [
  ['mismatched tags', '<score-partwise><part-list></part></score-partwise>'],
  ['unclosed root', '<score-partwise><part-list></part-list>'],
  ['duplicate attribute', '<score-partwise version="1" version="2"/>'],
  ['undefined entity', one(`<measure>${note('C', 4)}<direction><direction-type><words>a&nbsp;b</words></direction-type></direction></measure>`)],
  ['"<" in an attribute', '<score-partwise version="<"/>'],
  ['text after the root', '<score-partwise/>trailing'],
  ['two roots', '<score-partwise/><score-partwise/>'],
  ['"--" in a comment', '<score-partwise><!-- a -- b --></score-partwise>'],
  ['bad character reference', '<score-partwise><work><work-title>&#0;</work-title></work></score-partwise>'],
  ['control character', '<score-partwise><work><work-title>\u0001</work-title></work></score-partwise>'],
  ['no whitespace between attributes', '<score-partwise a="1"b="2"/>'],
  ['unquoted attribute', '<score-partwise a=1/>'],
  ['misplaced XML declaration', ' <?xml version="1.0"?><score-partwise/>'],
  ['not a score', '<?xml version="1.0"?><mei xmlns="http://www.music-encoding.org/ns/mei"/>'],
  ['empty partwise', '<score-partwise/>'],
  ['bare ampersand', one(`<measure>${note('C', 4)}<direction><direction-type><words>Rock & Roll</words></direction-type></direction></measure>`)],
];

const inputs = [];
for (const name of readdirSync(new URL('fixtures/', import.meta.url)).filter(name => /\.(musicxml|xml)$/.test(name))) inputs.push([`fixture ${name}`, readFileSync(new URL(`fixtures/${name}`, import.meta.url), 'utf8')]);
for (const dir of (process.env.PARSER_DIFF_DIRS || '').split(':').filter(Boolean)) {
  for (const name of readdirSync(dir).filter(name => /\.(musicxml|xml)$/.test(name))) inputs.push([`${dir}/${name}`, readFileSync(join(dir, name), 'utf8')]);
}
inputs.push(['synthetic orchestral 30x12', orchestral(30, 12)], ['synthetic orchestral 30x150 (~5 MB)', orchestral(30, 150)]);
inputs.push(...cases.map(([label, text]) => [`case ${label}`, text]));

let browser;
let failures = 0;
try {
  let ready = false;
  for (let attempt = 0; attempt < 100 && !ready; attempt++) {
    try { ready = (await fetch(`http://127.0.0.1:${port}/validation/performance.html`)).ok; } catch { await delay(200); }
  }
  assert.ok(ready, 'Vite dev server started');
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || chromium.executablePath(), headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}/validation/performance.html`);
  await page.evaluate(async () => {
    const reference = await import('/validation/reference/musicxml-dom.ts');
    const streaming = await import('/src/lib/notation/musicxml-source.ts');
    const navigation = await import('/src/lib/notation/navigation.ts');
    /** First difference between two values (keys in order, undefined-valued keys, Object.is), or ''. */
    const diff = (a, b, path = '$') => {
      if (Object.is(a, b)) return '';
      if (a instanceof Map && b instanceof Map) return diff([...a], [...b], `${path}<map>`);
      if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return `${path}: ${JSON.stringify(a)?.slice(0, 160)} !== ${JSON.stringify(b)?.slice(0, 160)}`;
      if (Array.isArray(a) !== Array.isArray(b)) return `${path}: array/object mismatch`;
      const ka = Object.keys(a), kb = Object.keys(b);
      if (ka.join('\u0000') !== kb.join('\u0000')) return `${path}: keys [${ka}] !== [${kb}]`;
      for (const key of ka) { const found = diff(a[key], b[key], `${path}.${key}`); if (found) return found; }
      return '';
    };
    const roundTrip = text => new XMLSerializer().serializeToString(new DOMParser().parseFromString(text, 'application/xml'));
    window.compareMusicXml = text => {
      let old, next, oldError = '', nextError = '';
      try { old = reference.referenceParseMusicXml(text); } catch (error) { oldError = error.message; }
      try { next = streaming.readMusicXml(text); } catch (error) { nextError = error.message; }
      if (oldError || nextError) return { rejected: true, oldError, nextError, problems: oldError === nextError ? [] : [`errors differ: "${oldError}" vs "${nextError}"`] };
      const problems = [];
      const check = (label, a, b) => { const found = diff(a, b); if (found) problems.push(`${label} ${found}`); };
      check('score', old.score, next.score);
      if (roundTrip(next.engravingText) !== old.engravingText) {
        const a = old.engravingText, b = roundTrip(next.engravingText);
        let at = 0; while (at < a.length && a[at] === b[at]) at++;
        problems.push(`engraving differs at ${at}: ${JSON.stringify(a.slice(Math.max(0, at - 60), at + 80))} vs ${JSON.stringify(b.slice(Math.max(0, at - 60), at + 80))}`);
      }
      check('inventory', old.inventory, next.inventory);
      check('diagnostics', old.diagnostics, next.diagnostics);
      // Playback marks: the former timeline read them from the engraving text with DOMParser.
      const markDiagnostics = [], pedalDiagnostics = [];
      check('marks', reference.sourceNoteMarks(old.engravingText, markDiagnostics), next.playback.marks);
      check('mark diagnostics', markDiagnostics, next.playback.markDiagnostics);
      check('pedals', reference.sourcePedals(old.engravingText, pedalDiagnostics), next.playback.pedals);
      check('pedal diagnostics', pedalDiagnostics, next.playback.pedalDiagnostics);
      // The standalone readers (for a caller's own MusicXML) over the original text.
      const original = streaming.readPlaybackMarks(text), originalMarks = [], originalPedals = [];
      check('source marks', reference.sourceNoteMarks(text, originalMarks), original.marks);
      check('source pedals', reference.sourcePedals(text, originalPedals), original.pedals);
      check('source mark diagnostics', [originalMarks, originalPedals], [original.markDiagnostics, original.pedalDiagnostics]);
      const count = old.score.parts[0].measures.length + 1, oldNav = [], newNav = [];
      check('text navigation', [reference.referenceTextNavigation(text, count, oldNav), oldNav], [navigation.musicXmlTextNavigation(text, count, newNav), newNav]);
      return { rejected: false, problems, edited: next.engravingText !== text, notes: old.score.parts.reduce((sum, part) => sum + part.measures.reduce((n, m) => n + m.notes.length, 0), 0) };
    };
  });
  const run = async (label, text, expectRejected) => {
    const result = await page.evaluate(text => window.compareMusicXml(text), text);
    const bad = result.problems.length || (expectRejected !== undefined && result.rejected !== expectRejected);
    if (bad) failures++;
    console.log(`${bad ? 'FAIL' : 'ok  '} ${label}${result.rejected ? ` (rejected: ${result.oldError})` : ` (${result.notes} notes${result.edited ? ', engraving edited' : ''})`}`);
    for (const problem of result.problems) console.log(`     ${problem}`);
    if (expectRejected !== undefined && result.rejected !== expectRejected) console.log(`     expected ${expectRejected ? 'a rejection' : 'a score'}`);
  };
  for (const [label, text] of inputs) await run(label, text, label.startsWith('case ') || label.startsWith('fixture ') || label.startsWith('synthetic') ? false : undefined);
  for (const [label, text] of rejected) await run(`rejects ${label}`, text, true);

  // The import worker (file → hash, chunked Score, bytes, timeline) delivers what the same reader gives on the main
  // thread: the Score, document, identity, hash, and the timeline the main thread would build.
  const workerCases = [...inputs.filter(([label]) => label.startsWith('fixture ') || label.startsWith('synthetic')), ...cases.filter(([label]) => /timewise|multi-measure|pedals/.test(label)).map(([label, text]) => [`case ${label}`, text])];
  for (const [label, text] of workerCases) {
    const result = await page.evaluate(async ({ text, mxl }) => {
      const { importScoreFile, importMusicXmlText, parseMusicXml } = await import('/src/lib/import.ts');
      const { sha256Hex, textSource } = await import('/src/lib/file-state.ts');
      const { buildBaseTimeline, registeredBaseTimeline } = await import('/src/lib/playback/timeline.ts');
      const problems = [];
      const diff = (a, b, path = '$') => {
        if (Object.is(a, b)) return '';
        if (a instanceof Map && b instanceof Map) return diff([...a], [...b], `${path}<map>`);
        if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return `${path}: ${JSON.stringify(a)?.slice(0, 160)} !== ${JSON.stringify(b)?.slice(0, 160)}`;
        const ka = Object.keys(a), kb = Object.keys(b);
        if (ka.join('\u0000') !== kb.join('\u0000')) return `${path}: keys [${ka}] !== [${kb}]`;
        for (const key of ka) { const found = diff(a[key], b[key], `${path}.${key}`); if (found) return found; }
        return '';
      };
      const check = (label, a, b) => { const found = diff(a, b); if (found) problems.push(`${label} ${found}`); };
      const expected = parseMusicXml(text);
      const bytes = new TextEncoder().encode(text);
      const files = [new File([bytes], 'score.musicxml')];
      if (mxl) files.push(new File([new Uint8Array(mxl)], 'score.mxl'));
      for (const file of files) {
        const job = importScoreFile(file);
        const [source, score] = await Promise.all([job.source, job.score]);
        const fileBytes = new Uint8Array(await file.arrayBuffer());
        if (source.sha256 !== sha256Hex(fileBytes)) problems.push(`${file.name}: hash ${source.sha256} differs`);
        const { document, ...rest } = score, { document: expectedDocument, ...expectedRest } = expected;
        check(`${file.name} score`, rest, expectedRest);
        check(`${file.name} document`, { engravingText: document.engravingText, originalText: document.originalText, featureCounts: document.featureCounts, diagnostics: document.diagnostics, identity: document.identity },
          { engravingText: expectedDocument.engravingText, originalText: expectedDocument.originalText, featureCounts: expectedDocument.featureCounts, diagnostics: expectedDocument.diagnostics, identity: expectedDocument.identity });
        if (diff(Array.from(document.readOriginalBytes()), Array.from(fileBytes))) problems.push(`${file.name}: original bytes differ`);
        if (new TextDecoder().decode(document.engravingBytes()) !== expectedDocument.engravingText) problems.push(`${file.name}: engraving bytes differ`);
        check(`${file.name} timeline`, await registeredBaseTimeline(document), buildBaseTimeline(expected));
      }
      const prop = importMusicXmlText(text);
      const [propSource, propScore] = await Promise.all([prop.source, prop.score]);
      check('text source', propSource, textSource('musicxml', text, 'MusicXML'));
      check('text score', { ...propScore, document: undefined }, { ...expected, document: undefined });
      if (propScore.document.engravingText !== expected.document.engravingText) problems.push('text engraving differs');
      return problems;
    }, { text, mxl: label.startsWith('synthetic orchestral 30x150') ? null : Array.from(zipSync({ 'META-INF/container.xml': strToU8('<container><rootfiles><rootfile full-path="s.musicxml"/></rootfiles></container>'), 's.musicxml': strToU8(text) })) });
    if (result.length) failures++;
    console.log(`${result.length ? 'FAIL' : 'ok  '} worker import ${label}`);
    for (const problem of result) console.log(`     ${problem}`);
  }
} finally {
  await browser?.close();
  server.kill();
}
if (failures) { console.error(`${failures} parser differences`); process.exit(1); }
console.log('Streaming MusicXML reader matches the DOM importer');
