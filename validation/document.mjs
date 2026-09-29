import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright-core';
import { strToU8, zipSync } from 'fflate';

const port = 4387;
const server = spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(port)], { cwd: new URL('..', import.meta.url), stdio: 'ignore' });
let browser;
try {
  let baseUrl;
  for (let attempt = 0; attempt < 50; attempt++) {
    for (const candidate of [process.env.DOCUMENT_URL, `http://127.0.0.1:${port}`, 'http://127.0.0.1:4324', 'http://127.0.0.1:4321'].filter(Boolean)) {
      try { const response = await fetch(`${candidate}/`); if (response.ok) { baseUrl = candidate; break; } } catch { /* startup */ }
    }
    if (baseUrl) break;
    await delay(200);
  }
  assert.ok(baseUrl, 'Astro dev server started');
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.goto(`${baseUrl}/`);
  const xml = `<?xml version="1.0"?><score-timewise version="4.0"><work><work-title>Source retained</work-title></work><part-list><score-part id="P1"><part-name>Drum</part-name></score-part></part-list><measure number="0" implicit="yes"><part id="P1"><attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>percussion</sign></clef></attributes><note><unpitched><display-step>C</display-step><display-octave>5</display-octave></unpitched><duration>2</duration><type>eighth</type><voice>1</voice><lyric><text>tap</text></lyric></note><backup><duration>2</duration></backup><note><rest/><duration>2</duration><voice>2</voice><type>eighth</type></note></part></measure></score-timewise>`;
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
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
