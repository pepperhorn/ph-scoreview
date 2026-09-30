import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright-core';

// Unit checks for src/lib/score-db.ts (per-score memory) in a real browser, served by a private Vite server.
const port = 43983;
const server = spawn('node', ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: new URL('..', import.meta.url), stdio: 'ignore' });
const pagePath = '/validation/performance.html';
let browser;
try {
  let ready = false;
  for (let attempt = 0; attempt < 60 && !ready; attempt++) {
    try { ready = (await fetch(`http://127.0.0.1:${port}${pagePath}`)).ok; } catch { /* startup */ }
    if (!ready) await delay(200);
  }
  assert.ok(ready, 'Vite dev server started');
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`http://127.0.0.1:${port}${pagePath}`);

  const result = await page.evaluate(async () => {
    const { createScoreDb } = await import('/src/lib/score-db.ts');
    const { textSource } = await import('/src/lib/file-state.ts');
    const settings = { mode: 'portrait', notationFont: 'Bravura', barsPerLine: 'auto', overlap: 1, names: false, chordSymbols: false, inferChordSymbols: false, counts: false, subdivisions: false, annotationFont: 'Sans', bpm: 96, semitones: 0, scorePitch: 'written' };
    const source = hash => ({ name: 'test.musicxml', size: 10, sha256: hash, format: 'musicxml' });
    const state = (hash, lastOpened, zoom = 1.3) => ({ version: 2, source: source(hash), lastOpened, settings, parts: { p1: { visible: true, instrument: 'piano', volume: 80 } }, view: { zoom, zoomDevice: 'desktop' } });
    const hex = n => n.toString(16).padStart(64, '0');
    const out = {};

    // IndexedDB round trip.
    const db = createScoreDb({ dbName: 'scoreflow-test-roundtrip', debounceMs: 0 });
    db.write(state(hex(1), 1000));
    await db.flush();
    const back = await db.read(source(hex(1)));
    out.backend = await db.backend();
    out.roundTrip = back && { version: back.version, zoom: back.view?.zoom, device: back.view?.zoomDevice, volume: back.parts.p1.volume, lastOpened: typeof back.lastOpened };
    out.missing = await db.read(source(hex(99)));
    out.nothingInLocalStorage = !Object.keys(localStorage).some(key => key.includes(hex(1)));

    // localStorage v1 migration: imported on first read, the v1 copy survives until the next successful IndexedDB write.
    const v1 = { version: 1, source: source(hex(2)), settings: { ...settings, zoom: 1.25 }, parts: { p1: { visible: false, instrument: 'bass' } } };
    localStorage.setItem(`scoreflow-file-v1:${hex(2)}`, JSON.stringify(v1));
    const migrating = createScoreDb({ dbName: 'scoreflow-test-migrate', debounceMs: 0, device: () => 'compact' });
    const migrated = await migrating.read(source(hex(2)));
    out.migrated = migrated && { version: migrated.version, zoom: migrated.view?.zoom, device: migrated.view?.zoomDevice, settingsZoom: 'zoom' in migrated.settings, instrument: migrated.parts.p1.instrument, visible: migrated.parts.p1.visible };
    out.v1KeptAfterRead = localStorage.getItem(`scoreflow-file-v1:${hex(2)}`) !== null;
    migrating.write({ ...migrated, lastOpened: 2000 });
    await migrating.flush();
    out.v1RemovedAfterWrite = localStorage.getItem(`scoreflow-file-v1:${hex(2)}`) === null;
    out.migratedStored = (await migrating.read(source(hex(2))))?.view?.zoom;
    // A default v1 zoom (1) carries no view, so the device default applies.
    localStorage.setItem(`scoreflow-file-v1:${hex(3)}`, JSON.stringify({ ...v1, source: source(hex(3)), settings: { ...settings, zoom: 1 } }));
    out.defaultZoomView = (await migrating.read(source(hex(3))))?.view ?? null;
    localStorage.removeItem(`scoreflow-file-v1:${hex(3)}`);

    // IndexedDB that throws: fall back to localStorage silently.
    const broken = createScoreDb({ debounceMs: 0, indexedDB: { open() { throw new Error('blocked'); } } });
    broken.write(state(hex(4), 3000, 1.6));
    await broken.flush();
    out.fallbackBackend = await broken.backend();
    out.fallback = (await broken.read(source(hex(4))))?.view?.zoom ?? null;
    const noStorage = createScoreDb({ debounceMs: 0, indexedDB: null, storage: null });
    noStorage.write(state(hex(5), 1));
    await noStorage.flush();
    out.noStorage = await noStorage.read(source(hex(5)));

    // Eviction keeps the most recently opened records.
    const capped = createScoreDb({ dbName: 'scoreflow-test-evict', debounceMs: 0, maxRecords: 5 });
    for (let i = 0; i < 7; i++) { capped.write(state(hex(100 + i), 10000 + i)); await capped.flush(); }
    out.cappedKeys = (await capped.keys()).sort();
    out.expectedKeys = [102, 103, 104, 105, 106].map(hex).sort();
    const cappedLocal = createScoreDb({ debounceMs: 0, indexedDB: null, maxRecords: 3 });
    for (let i = 0; i < 5; i++) { cappedLocal.write(state(hex(200 + i), 20000 + i)); await cappedLocal.flush(); }
    out.cappedLocalKeys = (await cappedLocal.keys()).sort();
    out.expectedLocalKeys = [202, 203, 204].map(hex).sort();

    // Debounced writes coalesce.
    const debounced = createScoreDb({ dbName: 'scoreflow-test-debounce', debounceMs: 400 });
    debounced.write(state(hex(6), 1, 1.1));
    debounced.write(state(hex(6), 2, 1.2));
    out.beforeFlush = (await debounced.keys()).includes(hex(6));
    out.readYourWrites = (await debounced.read(source(hex(6))))?.view?.zoom;
    await debounced.flush();
    out.afterFlush = (await debounced.read(source(hex(6))))?.view?.zoom;

    // Text source keys: format-prefixed hash of the source text.
    const abc = 'X:1\nK:C\nCDEF|';
    out.abcKey = textSource('abc', abc, 'ABC').sha256;
    out.abcKeyAgain = textSource('abc', abc, 'ABC').sha256;
    out.xmlKey = textSource('musicxml', abc, 'MusicXML').sha256;
    const { exampleScore } = await import('/src/lib/score.ts');
    const { withEngravingDocument } = await import('/src/lib/notation/document.ts');
    const { sampleSource } = await import('/src/lib/score-db.ts');
    out.sampleKey = sampleSource(withEngravingDocument(exampleScore())).sha256;
    return out;
  });

  assert.equal(result.backend, 'indexeddb', 'IndexedDB is the primary store');
  assert.deepEqual(result.roundTrip, { version: 2, zoom: 1.3, device: 'desktop', volume: 80, lastOpened: 'number' }, 'IndexedDB round trip');
  assert.equal(result.missing, null, 'Unknown hash reads as null');
  assert.equal(result.nothingInLocalStorage, true, 'IndexedDB writes do not touch localStorage');
  assert.deepEqual(result.migrated, { version: 2, zoom: 1.25, device: 'compact', settingsZoom: false, instrument: 'double-bass', visible: false }, 'localStorage v1 record migrates to v2');
  assert.equal(result.v1KeptAfterRead, true, 'v1 copy is kept until an IndexedDB write succeeds');
  assert.equal(result.v1RemovedAfterWrite, true, 'v1 copy is removed after the next successful IndexedDB write');
  assert.equal(result.migratedStored, 1.25);
  assert.equal(result.defaultZoomView, null, 'A v1 default zoom migrates to no saved view');
  assert.equal(result.fallbackBackend, 'localstorage', 'Throwing IndexedDB falls back to localStorage');
  assert.equal(result.fallback, 1.6, 'Fallback round trip');
  assert.equal(result.noStorage, null, 'No storage at all is silent');
  assert.deepEqual(result.cappedKeys, result.expectedKeys, 'IndexedDB evicts the oldest records past the cap');
  assert.deepEqual(result.cappedLocalKeys, result.expectedLocalKeys, 'localStorage fallback evicts past the cap');
  assert.equal(result.beforeFlush, false, 'Writes are debounced');
  assert.equal(result.readYourWrites, 1.2, 'Reads see queued writes');
  assert.equal(result.afterFlush, 1.2, 'The latest debounced write wins');
  assert.equal(result.abcKey, result.abcKeyAgain, 'ABC key is stable');
  assert.notEqual(result.abcKey, result.xmlKey, 'Keys carry a format prefix');
  assert.match(result.abcKey, /^[0-9a-f]{64}$/);

  // Keys stay stable across reloads.
  await page.reload();
  const again = await page.evaluate(async () => {
    const { textSource } = await import('/src/lib/file-state.ts');
    const { sampleSource } = await import('/src/lib/score-db.ts');
    const { exampleScore } = await import('/src/lib/score.ts');
    const { withEngravingDocument } = await import('/src/lib/notation/document.ts');
    return { abcKey: textSource('abc', 'X:1\nK:C\nCDEF|', 'ABC').sha256, sampleKey: sampleSource(withEngravingDocument(exampleScore())).sha256 };
  });
  assert.equal(again.abcKey, result.abcKey, 'ABC key is stable across reloads');
  assert.equal(again.sampleKey, result.sampleKey, 'Sample key is stable across reloads');
  console.log('Score memory: IndexedDB round trip, v1 migration, localStorage fallback, eviction, debounce and stable keys passed');
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
