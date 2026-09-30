import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright-core';
import { strToU8, zipSync } from 'fflate';

// A private Vite server (like validation/performance.mjs): Astro 7 keeps one
// background dev server per project, which survives this script and can serve
// outdated optimized dependencies to later runs.
const port = 43982;
const server = spawn('node', ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: new URL('..', import.meta.url), stdio: 'ignore' });
const pagePath = '/validation/performance.html';
let browser;
try {
  let baseUrl;
  for (let attempt = 0; attempt < 50; attempt++) {
    for (const candidate of [process.env.DOCUMENT_URL, `http://127.0.0.1:${port}`].filter(Boolean)) {
      try { const response = await fetch(`${candidate}${pagePath}`); if (response.ok) { baseUrl = candidate; break; } } catch { /* startup */ }
    }
    if (baseUrl) break;
    await delay(200);
  }
  assert.ok(baseUrl, 'Vite dev server started');
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.goto(`${baseUrl}${pagePath}`);
  const xml = `<?xml version="1.0"?><score-timewise version="4.0"><work><work-title>Source retained</work-title></work><part-list><score-part id="P1"><part-name>Drum</part-name></score-part></part-list><measure number="0" implicit="yes"><part id="P1"><attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>percussion</sign></clef></attributes><note><unpitched><display-step>C</display-step><display-octave>5</display-octave></unpitched><duration>2</duration><type>eighth</type><voice>1</voice><lyric><text>tap</text></lyric></note><backup><duration>2</duration></backup><note><rest/><duration>2</duration><voice>2</voice><type>eighth</type></note></part></measure></score-timewise>`;
  // M7: an archive whose other members would inflate hugely, and a percent-encoded rootfile path.
  const zeros = new Uint8Array(9_000_000);
  const oversizedZeros = new Uint8Array(130 * 1024 * 1024);
  const encodedArchive = zipSync({ 'META-INF/container.xml': strToU8('<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="My%20Score.musicxml" media-type="application/vnd.recordare.musicxml+xml"/></rootfiles></container>'), 'My Score.musicxml': strToU8(xml), 'padding.xml': zeros });
  const oversizedArchive = zipSync({ 'META-INF/container.xml': strToU8('<?xml version="1.0"?><container><rootfiles><rootfile full-path="big.musicxml"/></rootfiles></container>'), 'big.musicxml': oversizedZeros });
  const archive = zipSync({ 'META-INF/container.xml': strToU8('<?xml version="1.0"?><container><rootfiles><rootfile full-path="score.musicxml"/></rootfiles></container>'), 'score.musicxml': strToU8(xml) });
  const actual = await page.evaluate(async ({ xml, archive }) => {
    const { parseMusicXml, parseMei, parseAbc, importFile, parseMidi } = await import('/src/lib/import.ts');
    const { scoreToMei } = await import('/src/lib/notation/document.ts');
    const source = parseMusicXml(xml);
    const mxl = await importFile(new File([new Uint8Array(archive)], 'score.mxl'));
    const abc = await parseAbc('X:1\nT:Voices\nM:4/4\nL:1/8\nK:C\nC D E F|');
    const mei = parseMei('<?xml version="1.0"?><mei xmlns="http://www.music-encoding.org/ns/mei"><music><body><mdiv><score><scoreDef meter.count="4" meter.unit="4"><staffGrp><staffDef n="1" label="Voice"/></staffGrp></scoreDef><section><measure n="1"><staff n="1"><layer><note xml:id="a1" pname="c" oct="4" dur="4"/></layer></staff></measure></section></score></mdiv></body></music></mei>');
    const adapted = scoreToMei(abc);
    return {
      xmlSame: source.document.originalText === xml,
      xmlFormat: source.document.engravingFormat,
      timewiseConverted: source.document.engravingText.includes('score-partwise'),
      percussion: source.parts[0].measures[0].notes.some(n => n.pitches.length),
      voiceCount: new Set(source.parts[0].measures[0].notes.map(n => n.voice)).size,
      sourceMapped: Object.keys(source.document.identity.sourceIdToNoteId).length,
      mxlFormat: mxl.document.format,
      mxlHash: mxl.document.sha256,
      mxlBytesSame: Array.from(mxl.document.readOriginalBytes()).join(',') === archive.join(','),
      abcMei: abc.document.engravingFormat === 'mei' && adapted.includes('<mei'),
      abcIds: Object.keys(abc.document.identity.sourceIdToNoteId).length,
      meiSame: mei.document.originalText === mei.document.engravingText,
      meiId: mei.document.identity.sourceIdToNoteId.a1,
    };
  }, { xml, archive: Array.from(archive) });
  const review = await page.evaluate(async ({ encodedArchive, oversizedArchive }) => {
    const { parseMusicXml, parseMei, importFile } = await import('/src/lib/import.ts');
    const { readFileState } = await import('/src/lib/file-state.ts');
    // H2: channel-10 drum kits exported as program 1 are drum kits, not piano.
    const drum = parseMusicXml('<?xml version="1.0"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Kit</part-name><score-instrument id="P1-I36"><instrument-name>Bass Drum 1</instrument-name></score-instrument><midi-instrument id="P1-I36"><midi-channel>10</midi-channel><midi-program>1</midi-program><midi-unpitched>37</midi-unpitched></midi-instrument></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>percussion</sign></clef></attributes><note><unpitched><display-step>F</display-step><display-octave>4</display-octave></unpitched><duration>4</duration><instrument id="P1-I36"/><voice>1</voice><type>whole</type></note></measure></part></score-partwise>');
    // H5: MEI keySig/meterSig elements, accid.ges, <accid> children, measure state and a later scoreDef change.
    const mei = parseMei('<?xml version="1.0"?><mei xmlns="http://www.music-encoding.org/ns/mei" meiversion="5.0"><music><body><mdiv><score><scoreDef><staffGrp><staffDef n="1" lines="5"><clef shape="G" line="2"/><keySig sig="2s"/><meterSig count="3" unit="4"/></staffDef></staffGrp></scoreDef><section>'
      + '<measure n="1"><staff n="1"><layer n="1"><note pname="f" oct="4" dur="4"/><note pname="c" oct="4" dur="4"><accid accid="n"/></note><note pname="g" oct="4" dur="4" accid="s"/></layer></staff></measure>'
      + '<measure n="2"><staff n="1"><layer n="1"><note pname="g" oct="4" dur="4" accid="s"/><note pname="g" oct="4" dur="4"/><note pname="c" oct="4" dur="4" accid.ges="n"/></layer></staff></measure>'
      + '<scoreDef key.sig="1f" meter.count="2" meter.unit="4"/>'
      + '<measure n="3"><staff n="1"><layer n="1"><note pname="b" oct="4" dur="4"/><note pname="f" oct="4" dur="4"/></layer></staff></measure></section></score></mdiv></body></music></mei>');
    // M4: an out-of-range saved tempo is clamped instead of discarding the whole state.
    const source = { name: 'cut-time.musicxml', size: 1, sha256: 'f'.repeat(64), format: 'musicxml' };
    localStorage.setItem(`scoreflow-file-v1:${source.sha256}`, JSON.stringify({ version: 1, source, settings: { mode: 'portrait', notationFont: 'Bravura', barsPerLine: 'auto', overlap: 0, names: true, chordSymbols: true, inferChordSymbols: false, counts: false, subdivisions: false, bpm: 320, zoom: 1 }, parts: {} }));
    const saved = readFileState(source);
    localStorage.removeItem(`scoreflow-file-v1:${source.sha256}`);
    const encoded = await importFile(new File([new Uint8Array(encodedArchive)], 'encoded.mxl'));
    // Files above the old 8 MB cap open; only files above the 64 MB cap are refused, with their size.
    const padded = (await (await fetch('/validation/fixtures/expressive.musicxml')).text()).replace('<part-list>', `<!--${'x'.repeat(12 * 1024 * 1024)}--><part-list>`);
    const largeTitle = (await importFile(new File([padded], 'large.musicxml'))).parts.length;
    let tooLarge = '';
    try { await importFile(new File([new Uint8Array(65 * 1024 * 1024)], 'huge.musicxml')); } catch (error) { tooLarge = error.message; }
    let oversized = '';
    try { await importFile(new File([new Uint8Array(oversizedArchive)], 'big.mxl')); } catch (error) { oversized = error.message; }
    // N: ABC navigation is engraved through the MEI adapter (repeat barlines, volta endings, segno/coda, D.C./D.S./Fine).
    const { parseAbc } = await import('/src/lib/import.ts');
    const { scoreToMei } = await import('/src/lib/notation/document.ts');
    const repeats = await parseAbc('X:1\nM:4/4\nL:1/4\nK:C\n|:C4|[1D4:|[2E4|]\n');
    const jumps = await parseAbc('X:1\nM:4/4\nL:1/4\nK:C\nC4|!segno!D4|"^To Coda"E4|"^Fine"F4|"^D.S. al Coda"G4|!coda!A4|]\n');
    const both = await parseAbc('X:1\nM:4/4\nL:1/4\nK:C\n|:C4::D4:|\n');
    const repeatMei = scoreToMei(repeats), jumpMei = scoreToMei(jumps), bothMei = scoreToMei(both);
    const meiNav = parseMei('<?xml version="1.0"?><mei xmlns="http://www.music-encoding.org/ns/mei"><music><body><mdiv><score><scoreDef meter.count="4" meter.unit="4"><staffGrp><staffDef n="1"/></staffGrp></scoreDef><section><measure n="7a" left="rptstart"><staff n="1"><layer><note pname="c" oct="4" dur="1"/></layer></staff><repeatMark func="segno" tstamp="1" staff="1"/></measure><ending n="1-2"><measure n="8" right="rptend"><staff n="1"><layer><note pname="d" oct="4" dur="1"/></layer></staff></measure></ending></section></score></mdiv></body></music></mei>');
    return {
      abcRepeatMei: [/<measure n="1" left="rptstart">/.test(repeatMei), /<ending n="1" label="1\."><measure n="2" right="rptend">/.test(repeatMei), /<ending n="2" label="2\."><measure n="3">/.test(repeatMei)],
      abcJumpMei: ['<repeatMark func="segno"', '<repeatMark func="coda"', '>To Coda</dir>', '>Fine</dir>', '>D.S. al Coda</dir>'].map(text => jumpMei.includes(text)),
      abcBothMei: /<measure n="1" left="rptstart" right="rptboth">.*<measure n="2" right="rptend">/.test(bothMei) && !/<measure n="2" left=/.test(bothMei),
      abcChordText: jumps.parts[0].measures.map(m => m.notes[0].chordSymbol ?? '').join('|'),
      meiNavigation: JSON.stringify(meiNav.parts[0].measures.map(m => [m.number, m.navigation])),
      drumInstrument: drum.parts[0].instrument, drumSoundfont: drum.parts[0].gmSoundfont ?? null, drumMidi: drum.parts[0].measures[0].notes[0].pitches[0].midi,
      meiMeter: `${mei.beats}/${mei.beatType}`, meiBeats: mei.parts[0].measures.map(m => m.beats).join(),
      meiMidi: mei.parts[0].measures.flatMap(m => m.notes.map(n => n.pitches[0].midi)).join(),
      savedBpm: saved?.settings.bpm ?? null,
      largeParts: largeTitle, tooLarge, encodedTitle: encoded.title, encodedNotes: encoded.parts[0].measures[0].notes.length, oversized,
    };
  }, { encodedArchive: Array.from(encodedArchive), oversizedArchive: Array.from(oversizedArchive) });
  assert.equal(review.drumInstrument, 'drum-kit');
  assert.equal(review.drumSoundfont, null);
  assert.equal(review.drumMidi, 36);
  assert.equal(review.meiMeter, '3/4');
  assert.equal(review.meiBeats, '3,3,2');
  assert.equal(review.meiMidi, '66,60,68,68,68,60,70,65');
  assert.equal(review.savedBpm, 240);
  assert.deepEqual(review.abcRepeatMei, [true, true, true], 'ABC repeats/endings engrave as MEI rptstart/rptend and <ending>');
  assert.deepEqual(review.abcJumpMei, [true, true, true, true, true], 'ABC segno/coda/To Coda/Fine/D.S. engrave as MEI repeatMark/dir');
  assert.equal(review.abcBothMei, true, 'ABC :: engraves as one rptboth barline');
  assert.equal(review.abcChordText, '|||||', 'ABC navigation text is not engraved as chord symbols');
  assert.equal(review.meiNavigation, JSON.stringify([['7a', { repeatStart: true, segno: true }], ['8', { repeatEnd: true, endings: [1, 2] }]]), 'MEI navigation and measure labels');
  assert.equal(review.encodedTitle, 'Source retained');
  assert.ok(review.encodedNotes >= 1);
  assert.ok(review.largeParts > 0, 'A 12 MB MusicXML file opens');
  assert.match(review.tooLarge, /65 MB; scores up to 64 MB can be opened/);
  assert.match(review.oversized, /130 MB uncompressed; the limit is 128 MB/);
  assert.equal(actual.xmlSame, true);
  assert.equal(actual.xmlFormat, 'musicxml');
  assert.equal(actual.timewiseConverted, true);
  assert.equal(actual.percussion, true);
  assert.equal(actual.voiceCount, 2);
  assert.ok(actual.sourceMapped >= 2);
  assert.equal(actual.mxlFormat, 'mxl');
  assert.match(actual.mxlHash, /^[0-9a-f]{64}$/);
  assert.equal(actual.mxlBytesSame, true);
  assert.equal(actual.abcMei, true);
  assert.ok(actual.abcIds > 0);
  assert.equal(actual.meiSame, true);
  assert.equal(actual.meiId, '1-0-0');
  console.log('Document import: timewise, MXL source bytes and hash, percussion, voices, ABC adapter and MEI identity passed');
  console.log('Document review regressions: drum kit program, MEI accidentals/key/meter changes, saved BPM clamp, MXL encoded path and size bound, ABC/MEI navigation engraving passed');
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
