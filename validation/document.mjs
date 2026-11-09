import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright-core';
import { strToU8, zipSync } from 'fflate';
import createVerovioModule from 'verovio/wasm';
import { VerovioToolkit } from 'verovio/esm';
import toneMidi from '@tonejs/midi';

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
    const { parseMusicXml, parseMei, parseAbc, importFile, parseMidi } = await import('/packages/pepperscore/src/lib/import.ts');
    const { scoreToMei } = await import('/packages/pepperscore/src/lib/notation/document.ts');
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
    const { parseMusicXml, parseMei, importFile } = await import('/packages/pepperscore/src/lib/import.ts');
    const { readFileState } = await import('/packages/pepperscore/src/lib/file-state.ts');
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
    const { parseAbc } = await import('/packages/pepperscore/src/lib/import.ts');
    const { scoreToMei } = await import('/packages/pepperscore/src/lib/notation/document.ts');
    const repeats = await parseAbc('X:1\nM:4/4\nL:1/4\nK:C\n|:C4|[1D4:|[2E4|]\n');
    const jumps = await parseAbc('X:1\nM:4/4\nL:1/4\nK:C\nC4|!segno!D4|"^To Coda"E4|"^Fine"F4|"^D.S. al Coda"G4|!coda!A4|]\n');
    const both = await parseAbc('X:1\nM:4/4\nL:1/4\nK:C\n|:C4::D4:|\n');
    const repeatMei = scoreToMei(repeats), jumpMei = scoreToMei(jumps), bothMei = scoreToMei(both);
    const meiNav = parseMei('<?xml version="1.0"?><mei xmlns="http://www.music-encoding.org/ns/mei"><music><body><mdiv><score><scoreDef meter.count="4" meter.unit="4"><staffGrp><staffDef n="1"/></staffGrp></scoreDef><section><measure n="7a" left="rptstart"><staff n="1"><layer><note pname="c" oct="4" dur="1"/></layer></staff><repeatMark func="segno" tstamp="1" staff="1"/></measure><ending n="1-2"><measure n="8" right="rptend"><staff n="1"><layer><note pname="d" oct="4" dur="1"/></layer></staff></measure></ending></section></score></mdiv></body></music></mei>');
    return {
      abcRepeatMei: [/<measure n="1" left="rptstart">/.test(repeatMei), /<ending n="1" label="1\."><measure n="2" right="rptend">/.test(repeatMei), /<ending n="2" label="2\."><measure n="3" right="end">/.test(repeatMei)],
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
  // ID-less MusicXML (typical of notation-program exports): the engraving copy gets deterministic note IDs and
  // expanded multi-measure rests; the original text stays byte-identical; ID'd sources keep their own IDs.
  const idless = await page.evaluate(async () => {
    const { importFile } = await import('/packages/pepperscore/src/lib/import.ts');
    const text = await (await fetch('/validation/fixtures/idless-sibelius.musicxml')).text();
    const score = await importFile(new File([text], 'idless.musicxml'));
    const engraving = new DOMParser().parseFromString(score.document.engravingText, 'application/xml');
    const notes = [...engraving.getElementsByTagName('note')];
    const events = score.parts[0].measures.flatMap(measure => measure.notes);
    const expressiveText = await (await fetch('/validation/fixtures/expressive.musicxml')).text();
    const expressive = await importFile(new File([expressiveText], 'expressive.musicxml'));
    const expressiveIds = [...new DOMParser().parseFromString(expressiveText, 'application/xml').getElementsByTagName('note')].map(note => note.getAttribute('id'));
    const expressiveEngraved = [...new DOMParser().parseFromString(expressive.document.engravingText, 'application/xml').getElementsByTagName('note')].map(note => note.getAttribute('id'));
    return {
      originalSame: score.document.originalText === text,
      bytesSame: new TextDecoder().decode(score.document.readOriginalBytes()) === text,
      sourceHasIds: /<note[^>]*\sid=/.test(text), sourceMultiRest: text.includes('<multiple-rest>'),
      engravedIds: notes.map(note => note.getAttribute('id')),
      engravedMultiRest: engraving.getElementsByTagName('multiple-rest').length,
      engravedMeasureStyle: engraving.getElementsByTagName('measure-style').length,
      measures: score.parts[0].measures.length,
      eventSourceIds: events.map(event => [event.id, event.sourceId ?? null, event.pitches.map(pitch => pitch.sourceId)]),
      identity: score.document.identity.noteIdToSourceId,
      expressiveKept: JSON.stringify(expressiveIds) === JSON.stringify(expressiveEngraved),
    };
  });
  assert.equal(idless.originalSame, true, 'ID-less MusicXML original text is byte-identical');
  assert.equal(idless.bytesSame, true, 'ID-less MusicXML original bytes are untouched');
  assert.equal(idless.sourceHasIds, false, 'Fixture has no note IDs');
  assert.equal(idless.sourceMultiRest, true, 'Fixture has a multi-measure rest');
  assert.deepEqual(idless.engravedIds, ['mx_p1_m3_n1', 'mx_p1_m3_n2', 'mx_p1_m3_n3', 'mx_p1_m4_n1', 'mx_p1_m4_n2', 'mx_p1_m4_n3', 'mx_p1_m4_n4', 'mx_p1_m4_n5', 'mx_p1_m5_n1', 'mx_p1_m5_n2'], 'Every engraved <note> gets a deterministic ID');
  assert.equal(idless.engravedMultiRest, 0, 'Multi-measure rests are expanded in the engraving copy');
  assert.equal(idless.engravedMeasureStyle, 0, 'An emptied <measure-style> is removed');
  assert.equal(idless.measures, 5, 'Every source measure is a Score measure');
  assert.deepEqual(idless.eventSourceIds, [
    ['P1-1-2-0', 'mx_p1_m3_n1', ['mx_p1_m3_n1']], ['P1-1-2-1', 'mx_p1_m3_n2', ['mx_p1_m3_n2']], ['P1-1-2-2', 'mx_p1_m3_n3', ['mx_p1_m3_n3']],
    // Measure events are ordered by onset: the voice-2 whole note shares beat 1 with the tied G3.
    ['P1-1-3-0', 'mx_p1_m4_n1', ['mx_p1_m4_n1']], ['P1-1-3-3', 'mx_p1_m4_n5', ['mx_p1_m4_n5']], ['P1-1-3-1', 'mx_p1_m4_n2', ['mx_p1_m4_n2', 'mx_p1_m4_n3']], ['P1-1-3-2', 'mx_p1_m4_n4', []],
    ['P1-1-4-0', 'mx_p1_m5_n1', ['mx_p1_m5_n1']], ['P1-1-4-1', 'mx_p1_m5_n2', ['mx_p1_m5_n2']],
  ], 'Events and chord pitches carry the injected source IDs');
  assert.equal(idless.identity['P1-1-3-1'], 'mx_p1_m4_n2', 'Identity maps a chord to its first source note');
  assert.equal(idless.expressiveKept, true, 'Sources with note IDs keep them unchanged');
  // Imports that fail or are superseded never leave a rejected promise unhandled, even when the caller (like the
  // Reader) stops at the source and never awaits the score.
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  const unhandled = await page.evaluate(async () => {
    const { importScoreFile, importMusicXmlText } = await import('/packages/pepperscore/src/lib/import.ts');
    const rejections = [];
    const listen = event => rejections.push(String(event.reason?.message || event.reason));
    window.addEventListener('unhandledrejection', listen);
    const fixture = await (await fetch('/validation/fixtures/expressive.musicxml')).text();
    const large = fixture.replace('<part-list>', `<!--${'x'.repeat(8 * 1024 * 1024)}--><part-list>`);
    // A large import superseded before its hash arrives, then one superseded after it; the caller awaits only sources.
    const first = importScoreFile(new File([large], 'first.musicxml'));
    const second = importScoreFile(new File([large], 'second.musicxml'));
    await first.source.catch(() => {});
    await second.source.catch(() => {});
    const third = importScoreFile(new File([fixture], 'third.musicxml'));
    await third.score;
    // An unreadable file: the source arrives, the score fails, and nobody awaits it.
    const broken = importScoreFile(new File(['<score-partwise><part-list></part></score-partwise>'], 'broken.musicxml'));
    await broken.source;
    const text = importMusicXmlText('<not-xml');
    await text.source.catch(() => {});
    await new Promise(resolve => setTimeout(resolve, 1500));
    window.removeEventListener('unhandledrejection', listen);
    return rejections;
  });
  assert.deepEqual(unhandled, [], 'Failed or superseded imports leave no unhandled rejection');
  assert.deepEqual(pageErrors, [], 'Failed or superseded imports raise no page error');
  console.log('Document import: superseded and failed imports leave no unhandled rejection passed');
  // The worker's string MEI view transform (no DOMParser in workers) matches the reader's former DOM transform.
  const meiView = await page.evaluate(async () => {
    const { buildViewMei, scanBaseline } = await import('/packages/pepperscore/src/lib/notation/mei-view.ts');
    const { scoreToMei } = await import('/packages/pepperscore/src/lib/notation/document.ts');
    const { exampleScore } = await import('/packages/pepperscore/src/lib/score.ts');
    const MEI = 'http://www.music-encoding.org/ns/mei';
    const XML = 'http://www.w3.org/XML/1998/namespace';
    const parse = text => new DOMParser().parseFromString(text, 'application/xml');
    const nodes = (root, name) => Array.from(root.getElementsByTagNameNS(MEI, name));
    const xmlIdOf = element => element.getAttributeNS(XML, 'id') || element.getAttribute('xml:id') || '';
    // Reference: the DOM transform render.ts used before Phase 1 (viewMei + hideStaves).
    const reference = (baseline, breakEvery, hidden, chords) => {
      const doc = parse(baseline);
      const measures = nodes(doc, 'measure');
      for (const head of nodes(doc, 'meiHead')) head.remove();
      if (!chords) for (const harmony of nodes(doc, 'harm')) harmony.remove();
      for (const label of [...nodes(doc, 'label'), ...nodes(doc, 'labelAbbr')]) label.remove();
      for (const definition of [...nodes(doc, 'staffDef'), ...nodes(doc, 'staffGrp')]) { definition.removeAttribute('label'); definition.removeAttribute('label.abbr'); }
      for (const item of [...nodes(doc, 'sb'), ...nodes(doc, 'pb'), ...nodes(doc, 'pgHead'), ...nodes(doc, 'pgFoot')]) item.remove();
      // A break before an ending's (or section's) first measure goes before the ending, so it is not split across lines.
      const breakTarget = element => {
        let target = element;
        while (['ending', 'section'].includes(target.parentNode.localName) && target.parentNode.firstElementChild === target) target = target.parentNode;
        return target;
      };
      if (breakEvery > 0) for (let index = breakEvery; index < measures.length; index += breakEvery) { const target = breakTarget(measures[index]); target.parentNode.insertBefore(doc.createElementNS(MEI, 'pb'), target); }
      if (hidden.size) {
        const removed = new Set();
        const drop = element => { for (const item of [element, ...element.getElementsByTagName('*')]) { const id = xmlIdOf(item); if (id) removed.add(id); } element.remove(); };
        for (const element of [...nodes(doc, 'staffDef'), ...nodes(doc, 'staff')]) if (hidden.has(element.getAttribute('n') || '') && doc.contains(element)) drop(element);
        const all = Array.from(doc.getElementsByTagNameNS(MEI, '*'));
        for (const element of all) {
          if (!doc.contains(element) || !element.hasAttribute('staff')) continue;
          const tokens = (element.getAttribute('staff') || '').split(/\s+/).filter(Boolean);
          const kept = tokens.filter(token => !hidden.has(token));
          if (!kept.length && tokens.length) drop(element); else if (kept.length !== tokens.length) element.setAttribute('staff', kept.join(' '));
        }
        const refersToRemoved = value => !!value && value.split(/\s+/).some(token => removed.has(token.replace(/^#/, '')));
        for (const element of all) {
          if (!doc.contains(element)) continue;
          if (refersToRemoved(element.getAttribute('startid')) || refersToRemoved(element.getAttribute('endid'))) { drop(element); continue; }
          const plist = element.getAttribute('plist');
          if (plist && refersToRemoved(plist)) { const kept = plist.split(/\s+/).filter(token => !removed.has(token.replace(/^#/, ''))); if (kept.length) element.setAttribute('plist', kept.join(' ')); else drop(element); }
        }
        for (const group of nodes(doc, 'staffGrp').reverse()) if (doc.contains(group) && !nodes(group, 'staffDef').length) group.remove();
      }
      return doc;
    };
    // Structural equality: element names, attribute sets and trimmed text, in order.
    const shape = node => node.nodeType === 1
      ? [node.localName, [...node.attributes].map(a => `${a.name}=${a.value}`).sort().join(' '), [...node.childNodes].filter(child => child.nodeType === 1 || (child.nodeType === 3 && child.textContent.trim())).map(shape)]
      : node.textContent.trim();
    const same = (a, b) => JSON.stringify(shape(a.documentElement)) === JSON.stringify(shape(b.documentElement));
    const crafted = `<?xml version="1.0" encoding="UTF-8"?>
<mei xmlns="http://www.music-encoding.org/ns/mei" meiversion="5.0"><meiHead><fileDesc><titleStmt><title>T</title></titleStmt></fileDesc></meiHead>
<music><body><mdiv><score><scoreDef xml:id="sd"><pgHead><rend>Title</rend></pgHead><staffGrp xml:id="all">
  <staffGrp xml:id="P1" label="Piano" symbol="brace"><staffDef xml:id="s1" n="1" lines="5"><label>RH</label></staffDef><staffDef xml:id="s2" n="2" lines="5" label.abbr="LH"/></staffGrp>
  <staffDef xml:id="P2" n="3" lines="5" label="Flute"><labelAbbr>Fl.</labelAbbr></staffDef>
</staffGrp></scoreDef>
<section><pb/><measure xml:id="m1" n="1"><staff n="1"><layer n="1"><note xml:id="a1" pname="c" oct="4" dur="4"><verse n="1"><syl>la</syl></verse></note><note xml:id="a2" pname="d" oct="4" dur="4"><verse n="1"><syl>la</syl></verse><verse n="2"><syl>lo</syl></verse></note></layer></staff>
<staff n="2"><layer n="1"><note xml:id="b1" pname="c" oct="3" dur="2"/></layer></staff><staff n="3"><layer n="1"><note xml:id="c1" pname="g" oct="5" dur="2"/></layer></staff>
<slur xml:id="sl1" startid="#b1" endid="#b2"/><slur xml:id="sl2" startid="#a1" endid="#a2"/><hairpin xml:id="h1" staff="1 3" form="cres" tstamp="1" tstamp2="0m+3"/><dynam xml:id="d1" staff="2" tstamp="1">p</dynam>
<arpeg xml:id="ar1" plist="#a1 #b1"/><arpeg xml:id="ar2" plist="#b1"/><harm xml:id="hm1" staff="1" tstamp="1">C7</harm><fermata xml:id="f1" startid="#sl1"/></measure>
<sb/><ending xml:id="e1" n="1"><measure xml:id="m2" n="2"><staff n="1"><layer n="1"><note xml:id="a3" pname="e" oct="4" dur="1"/></layer></staff><staff n="2"><layer n="1"><note xml:id="b2" pname="c" oct="3" dur="1"/></layer></staff><staff n="3"><layer n="1"><mRest xml:id="c2"/></layer></staff></measure></ending>
<scoreDef xml:id="sd2"><staffGrp><staffDef n="2" xml:id="s2b" clef.shape="F" clef.line="4"/></staffGrp></scoreDef>
<measure xml:id="m3" n="3"><staff n="1"><layer n="1"><note xml:id="a4" pname="f" oct="4" dur="1"/></layer></staff><staff n="2"><layer n="1"><note xml:id="b3" pname="c" oct="3" dur="1"/></layer></staff><staff n="3"><layer n="1"><note xml:id="c3" pname="g" oct="5" dur="1"/></layer></staff><harm staff="3" tstamp="1">G</harm></measure>
<measure xml:id="m4" n="4"><staff n="1"><layer n="1"><note xml:id="a5" pname="g" oct="4" dur="1"/></layer></staff><staff n="2"><layer n="1"><note xml:id="b4" pname="c" oct="3" dur="1"/></layer></staff><staff n="3"><layer n="1"><note xml:id="c4" pname="g" oct="5" dur="1"/></layer></staff></measure>
</section></score></mdiv></body></music></mei>`;
    const sample = scoreToMei(exampleScore());
    const failures = [];
    let cases = 0;
    for (const [name, baseline] of [['crafted', crafted], ['sample', sample]]) {
      for (const breakEvery of [0, 1, 2]) for (const hidden of [[], ['2'], ['1', '2'], ['3']]) for (const chords of [true, false]) {
        cases++;
        const expected = reference(baseline, breakEvery, new Set(hidden), chords);
        const actual = parse(buildViewMei(baseline, { breakEvery, hiddenStaves: hidden, chordSymbols: chords }));
        if (actual.querySelector('parsererror') || !same(expected, actual)) failures.push(`${name} break=${breakEvery} hidden=${hidden} chords=${chords}`);
      }
      // A first-measures document keeps the first measures and closes every open element.
      const limited = parse(buildViewMei(baseline, { breakEvery: 2, hiddenStaves: [], chordSymbols: true }, 2));
      if (limited.querySelector('parsererror') || nodes(limited, 'measure').length !== 2) failures.push(`${name} limit`);
      // Chord symbol size: regular leaves the view unchanged; another size wraps each harmony's text in a sized rend.
      const plain = buildViewMei(baseline, { breakEvery: 2, hiddenStaves: [], chordSymbols: true });
      if (buildViewMei(baseline, { breakEvery: 2, hiddenStaves: [], chordSymbols: true, harmSize: 100 }) !== plain) failures.push(`${name} harmSize 100 changes the view`);
      if (buildViewMei(baseline, { breakEvery: 2, hiddenStaves: [], chordSymbols: false, harmSize: 145 }) !== buildViewMei(baseline, { breakEvery: 2, hiddenStaves: [], chordSymbols: false })) failures.push(`${name} harmSize without chord symbols`);
      for (const limit of [Infinity, 1, 2]) {
        const sized = parse(buildViewMei(baseline, { breakEvery: 2, hiddenStaves: [], chordSymbols: true, harmSize: 145 }, limit));
        const reference = parse(buildViewMei(baseline, { breakEvery: 2, hiddenStaves: [], chordSymbols: true }, limit));
        const harms = nodes(sized, 'harm');
        if (sized.querySelector('parsererror') || nodes(sized, 'measure').length !== nodes(reference, 'measure').length || harms.length !== nodes(reference, 'harm').length) failures.push(`${name} harmSize limit=${limit} structure`);
        if (harms.some((harm, index) => harm.children.length !== 1 || harm.children[0].localName !== 'rend' || harm.children[0].getAttribute('fontsize') !== '145%' || harm.textContent !== nodes(reference, 'harm')[index].textContent)) failures.push(`${name} harmSize limit=${limit} rend`);
      }
    }
    const doc = parse(crafted);
    const info = scanBaseline(crafted);
    const expectedInfo = {
      measureIds: nodes(doc, 'measure').map(xmlIdOf),
      staffDefs: nodes(nodes(doc, 'scoreDef')[0], 'staffDef').map(def => ({ n: def.getAttribute('n'), id: xmlIdOf(def) })),
      groups: nodes(nodes(doc, 'scoreDef')[0], 'staffGrp').map(group => ({ id: xmlIdOf(group), staves: [...group.children].filter(child => child.localName === 'staffDef').map(def => ({ n: def.getAttribute('n'), id: xmlIdOf(def) })) })),
    };
    return { cases, failures, info: JSON.stringify({ measureIds: info.measureIds, staffDefs: info.staffDefs, groups: info.groups }), expectedInfo: JSON.stringify(expectedInfo), lyricDensity: info.lyricDensity };
  });
  assert.deepEqual(meiView.failures, [], `MEI view transform differs from the DOM reference in ${meiView.failures.length}/${meiView.cases} cases`);
  assert.equal(meiView.info, meiView.expectedInfo, 'Baseline scan reads measures, staff definitions and groups like the DOM');
  assert.equal(meiView.lyricDensity, 2, 'Lyric density counts syllables per staff-measure and verse line');
  console.log(`Document import: worker MEI view transform matches the DOM reference in ${meiView.cases} cases passed`);
  // Percussion in the ABC/MIDI adapter: drum parts are unpitched MEI notes placed by staff position (@loc, GM drum map
  // for MIDI, written position for ABC), so Verovio's transpose never moves them; the Score model keeps its MIDI pitches.
  const midi = new toneMidi.Midi();
  midi.header.setTempo(120);
  const kit = midi.addTrack();
  kit.channel = 9;
  kit.name = 'Kit';
  // Kick + closed hi-hat together, snare + hi-hat, then crash, ride bell, pedal hi-hat and an unmapped sound (Vibraslap).
  for (const [time, note] of [[0, 36], [0, 42], [0.5, 38], [0.5, 42], [1, 49], [1.5, 53], [2, 44], [2.5, 58]]) kit.addNote({ midi: note, time, duration: 0.25 });
  const lead = midi.addTrack();
  lead.name = 'Lead';
  lead.addNote({ midi: 60, time: 0, duration: 0.5 });
  const drums = await page.evaluate(async midiBytes => {
    const { parseMidi, parseAbc } = await import('/packages/pepperscore/src/lib/import.ts');
    const fromMidi = await parseMidi(new Uint8Array(midiBytes).buffer);
    const fromAbc = await parseAbc('X:1\nT:Kit\nM:4/4\nL:1/8\nV:1 clef=perc name="Drums"\nV:2 clef=treble name="Tune"\nK:D\n[V:1] F2 c2 [Fg]2 ^c2|\n[V:2] D E F G A B c d|\n');
    const summary = score => {
      const mei = score.document.engravingText;
      const doc = new DOMParser().parseFromString(mei, 'application/xml');
      const ids = new Set([...doc.getElementsByTagName('*')].map(element => element.getAttribute('xml:id')).filter(Boolean));
      const staves = score.parts.map((part, index) => {
        const notes = [...doc.getElementsByTagName('staff')].filter(staff => staff.getAttribute('n') === String(index + 1)).flatMap(staff => [...staff.getElementsByTagName('note')]);
        return {
          clef: part.clef, instrument: part.instrument,
          staffDef: [...doc.getElementsByTagName('staffDef')][index].getAttribute('clef.shape'),
          notes: notes.map(note => [note.getAttribute('loc'), note.getAttribute('pname'), note.getAttribute('oct'), note.getAttribute('head.shape'), note.getAttribute('accid'), note.getAttribute('accid.ges')]),
          midi: part.measures.flatMap(measure => measure.notes.flatMap(note => note.pitches.map(pitch => pitch.midi))),
        };
      });
      const missing = Object.values(score.document.identity.noteIdToSourceId).filter(id => !ids.has(id));
      return { mei, staves, missing, mapped: Object.keys(score.document.identity.noteIdToSourceId).length };
    };
    return { midi: summary(fromMidi), abc: summary(fromAbc) };
  }, Array.from(midi.toArray()));
  const [kitStaff, leadStaff] = drums.midi.staves;
  assert.equal(kitStaff.clef, 'percussion');
  assert.equal(kitStaff.staffDef, 'perc');
  assert.deepEqual(kitStaff.notes.map(([loc, , , head]) => [loc, head]), [['1', null], ['9', 'x'], ['5', null], ['9', 'x'], ['10', 'x'], ['8', 'diamond'], ['-1', 'x'], ['7', 'diamond']], 'MIDI drums: kick F4, hi-hat G5 x, snare C5, crash A5 x, ride bell F5 diamond, pedal hi-hat D4 x, others E5 diamond');
  assert.ok(kitStaff.notes.every(([, pname, oct, , accid, ges]) => !pname && !oct && !accid && !ges), 'MIDI drum notes are unpitched (no pname/oct/accidentals)');
  assert.deepEqual(kitStaff.midi, [36, 42, 38, 42, 49, 53, 44, 58], 'MIDI drum playback pitches are unchanged');
  assert.ok(leadStaff.notes.every(([loc, pname]) => !loc && pname), 'Pitched MIDI parts stay pitched');
  assert.deepEqual(drums.midi.missing, [], 'Every MIDI note ID is an MEI element ID');
  const [abcKit, abcTune] = drums.abc.staves;
  assert.equal(abcKit.clef, 'percussion', 'ABC clef=perc is a percussion part');
  assert.equal(abcKit.instrument, 'drum-kit');
  assert.equal(abcKit.staffDef, 'perc');
  assert.deepEqual(abcKit.notes.map(([loc, pname, , head, accid]) => [loc, pname, head, accid]), [['1', null, null, null], ['5', null, null, null], ['1', null, null, null], ['9', null, null, null], ['5', null, null, null]], 'ABC percussion is placed by written staff position');
  assert.deepEqual(abcKit.midi, [66, 73, 66, 79, 73], 'ABC percussion playback pitches are unchanged');
  assert.equal(abcTune.clef, 'treble');
  assert.ok(abcTune.notes.every(([loc, pname]) => !loc && pname), 'ABC pitched voices stay pitched');
  assert.deepEqual(drums.abc.missing, [], 'Every ABC note ID is an MEI element ID');
  // Verovio's transpose moves the pitched staves and leaves the unpitched ones where they are.
  const toolkit = new VerovioToolkit(await createVerovioModule());
  const transposed = (mei, interval) => {
    toolkit.setOptions({ transpose: interval, xmlIdChecksum: false });
    toolkit.loadData(mei);
    const doc = toolkit.getMEI();
    return [...doc.matchAll(/<staff [^>]*n="(\d+)"[^>]*>(.*?)<\/staff>/gs)].reduce((staves, [, n, body]) => {
      (staves[n] ||= []).push(...[...body.matchAll(/<note [^>]*>/g)].map(([tag]) => ['xml:id', 'loc', 'pname', 'oct', 'head.shape'].map(name => (new RegExp(`\\s${name.replace('.', '\\.')}="([^"]*)"`).exec(tag) || [])[1] ?? 'null').join(' ')));
      return staves;
    }, {});
  };
  for (const [label, summary] of [['MIDI', drums.midi], ['ABC', drums.abc]]) {
    const plain = transposed(summary.mei, '');
    const up = transposed(summary.mei, '+M2');
    assert.deepEqual(up['1'], plain['1'], `${label}: transposing +M2 leaves percussion notes unchanged`);
    assert.ok(plain['1'].every(note => note.split(' ')[1] !== 'null' && note.split(' ')[2] === 'null'), `${label}: Verovio reads percussion notes as unpitched`);
    assert.notDeepEqual(up['2'], plain['2'], `${label}: transposing +M2 moves the pitched staff`);
  }
  console.log('Document import: MIDI and ABC percussion engrave as unpitched notes that transposition leaves in place passed');

  // Phase 3 chunk slices: prevailing attributes are carried (per staff, the meter unprinted), credits only in the first
  // slice, stable measure IDs, span-aware overlaps, page-aligned plans; non-partwise or prefixed sources do not index.
  const chunks = await page.evaluate(async () => {
    const { indexMusicXml, sliceMusicXml, planChunk, leadFor, tailFor, measureId } = await import('/packages/pepperscore/src/lib/notation/musicxml-chunks.ts');
    const { parseMusicXml } = await import('/packages/pepperscore/src/lib/import.ts');
    const measure = (n, extra = '', id = '') => `<measure number="${n}"${id ? ` id="${id}"` : ''}>${extra}<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>whole</type><staff>1</staff></note><backup><duration>4</duration></backup><note><pitch><step>C</step><octave>3</octave></pitch><duration>4</duration><voice>5</voice><type>whole</type><staff>2</staff></note></measure>`;
    const measures = Array.from({ length: 12 }, (_, index) => {
      const n = index + 1;
      const extra = n === 1 ? '<attributes><divisions>1</divisions><key><fifths>-3</fifths></key><time print-object="yes"><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes><direction><direction-type><wedge type="crescendo"/></direction-type></direction>'
        : n === 3 ? '<attributes><key number="2"><fifths>2</fifths></key><clef number="2"><sign>G</sign><line>2</line></clef></attributes>'
        : n === 5 ? '<attributes><key><fifths>1</fifths></key></attributes><direction><direction-type><wedge type="stop"/></direction-type></direction>'
        : n === 6 ? '<notations><slur type="start"/></notations>' : '';
      return measure(n, extra, n === 2 ? 'source-id' : '');
    });
    const xml = `<?xml version="1.0"?><!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd"><score-partwise version="4.0"><work><work-title>Slices</work-title></work><credit page="1"><credit-words>Title credit</credit-words></credit><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><!-- <measure number="x"> in a comment --><![CDATA[ <measure> ]]>${measures.join('')}</part></score-partwise>`;
    const index = indexMusicXml(xml);
    const slice = sliceMusicXml(index, 6, 9);
    const first = sliceMusicXml(index, 0, 2);
    const carried = /<measure number="7" id="reader-m7">(<attributes>.*?<\/attributes>)/.exec(slice)?.[1];
    const read = parseMusicXml(slice);
    return {
      measureCount: index.measureCount, spans: index.spans, carried,
      credits: [first.includes('<credit '), slice.includes('<credit ')],
      ids: [...slice.matchAll(/<measure\b[^>]*\bid="([^"]*)"/g)].map(match => match[1]),
      firstIds: [...first.matchAll(/<measure\b[^>]*\bid="([^"]*)"/g)].map(match => match[1]),
      sliceMeasures: read.parts[0].measures.length, sliceKey: read.key,
      lead: [leadFor(index, 0), leadFor(index, 2), leadFor(index, 4), leadFor(index, 8)],
      tail: [tailFor(index, 2), tailFor(index, 4), tailFor(index, 8), tailFor(index, 11)],
      plans: [planChunk(index, 0, 2, 2, 8), planChunk(index, 3, 2, 2, 8), planChunk(index, 5, 2, 2, 8), planChunk(index, 0, 0, 2, 8)],
      measureId: measureId(0),
      rejected: [indexMusicXml('<score-timewise><part-list/></score-timewise>'), indexMusicXml('<mx:score-partwise xmlns:mx="x"><mx:part-list/></mx:score-partwise>'), indexMusicXml('<score-partwise><part-list></part-list><part id="P1"><measure number="1"></part></score-partwise>')],
    };
  });
  assert.equal(chunks.measureCount, 12, 'Index counts measures, skipping comments and CDATA');
  assert.deepEqual(chunks.spans, [{ start: 0, end: 4 }], 'A hairpin over five bars is a span; an unterminated slur is not');
  assert.equal(chunks.carried, '<attributes><divisions>1</divisions><key>' + '<fifths>1</fifths></key><time print-object="no"><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>G</sign><line>2</line></clef></attributes>',
    'Carried attributes: latest divisions, a key for all staves replaces a per-staff key, the meter unprinted, staves and per-staff clefs');
  assert.deepEqual(chunks.credits, [true, false], 'Credits only in the first slice');
  assert.deepEqual(chunks.ids, ['reader-m7', 'reader-m8', 'reader-m9'], 'Slice measures get stable IDs');
  assert.deepEqual(chunks.firstIds, ['reader-m1', 'reader-m2'], 'A source measure ID is replaced by the stable one');
  assert.equal(chunks.sliceMeasures, 3);
  assert.equal(chunks.sliceKey, 1, 'The slice reads with the carried key');
  assert.deepEqual(chunks.lead, [0, 2, 4, 1], 'Lead overlap reaches back to the start of spans crossing the boundary (at least one bar)');
  assert.deepEqual(chunks.tail, [3, 1, 1, 1], 'Tail overlap reaches the end of spans crossing the boundary (at least one bar)');
  assert.deepEqual(chunks.plans, [
    { from: 0, to: 5, firstSystem: 0, endSystem: 2, firstPage: 1 },
    { from: 0, to: 9, firstSystem: 2, endSystem: 4, firstPage: 3 },
    { from: 7, to: 12, firstSystem: 4, endSystem: 6, firstPage: 2 },
    { from: 0, to: 12, firstSystem: 0, endSystem: 1, firstPage: 1 },
  ], 'Chunk plans: whole systems plus overlap pages, page-aligned');
  assert.equal(chunks.measureId, 'reader-m1');
  assert.deepEqual(chunks.rejected, [null, null, null].map(() => undefined), 'Timewise, prefixed and malformed sources are not indexed');
  console.log('Document import: MusicXML chunk slices, carried attributes, overlaps and plans passed');
  console.log('Document import: ID-less MusicXML identity and multi-measure rest expansion passed');
  console.log('Document import: timewise, MXL source bytes and hash, percussion, voices, ABC adapter and MEI identity passed');
  console.log('Document review regressions: drum kit program, MEI accidentals/key/meter changes, saved BPM clamp, MXL encoded path and size bound, ABC/MEI navigation engraving passed');
  // Verovio channels (one per reader): an out-of-memory failure fails the rest of its own channel's requests (the same
  // layout would fail again) while other channels' requests retry on the fresh worker, even when the failure repeats;
  // a closed channel is never brought back by a late request.
  const channels = await page.evaluate(async () => {
    const runtime = await import('/packages/pepperscore/src/lib/verovio-runtime.ts');
    const { importMusicXmlText } = await import('/packages/pepperscore/src/lib/import.ts');
    const text = async name => (await fetch(`/validation/fixtures/${name}.musicxml`)).text();
    const a = runtime.openVerovioChannel(), b = runtime.openVerovioChannel();
    const docA = (await importMusicXmlText(await text('ensemble'), 'A', a).score).document;
    const docB = (await importMusicXmlText(await text('expressive'), 'B', b).score).document;
    await runtime.prepareVerovio(docA, a);
    await runtime.prepareVerovio(docB, b);
    const view = { breakEvery: 2, hiddenStaves: [], chordSymbols: false };
    const options = { breaks: 'encoded', pageWidth: 1600, pageHeight: 60000, adjustPageHeight: true, scale: 100, xmlIdChecksum: true };
    const outcome = promise => promise.then(() => 'ok', error => error.code || error.message);
    // A fails three times in a row; its second request is queued behind the first, and so is B's.
    localStorage.setItem('scoreflow-simulate-oom', '3');
    const ticketA = runtime.nextRenderTicket();
    const pending = [runtime.renderVerovioPages(docA, a, ticketA, view, options, [1]), runtime.renderVerovioPages(docA, a, ticketA, view, options, [2]), runtime.renderVerovioPages(docB, b, runtime.nextRenderTicket(), view, options, [1])];
    const results = await Promise.all(pending.map(outcome));
    runtime.closeVerovioChannel(b);
    const late = await outcome(runtime.prepareVerovio(docB, b));
    const open = globalThis.__pepperscoreVerovioChannels;
    runtime.closeVerovioChannel(a);
    return { results, late, open, afterAll: globalThis.__pepperscoreVerovioChannels };
  });
  assert.deepEqual(channels, { results: ['oom', 'oom', 'ok'], late: 'superseded', open: 1, afterAll: 0 }, JSON.stringify(channels));
  console.log('Verovio channels: an out-of-memory failure stays in its channel, other channels retry, closed channels stay closed passed');
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
