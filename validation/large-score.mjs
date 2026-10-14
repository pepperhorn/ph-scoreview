// Large-score reading (docs/specs/large-score-performance.md, Phase 1): a generated ~5 MB, 30-part orchestral
// MusicXML paints its first system within budget, keeps only the systems near the viewport drawn, draws the last
// system and releases the first when scrolled to the end, and highlights playback in a system drawn on demand.
// Runs against the built dist (npm run build). BROWSER=chromium|firefox|webkit (memory is checked on Chromium).
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { chromium, firefox, webkit } from 'playwright-core';
import { orchestral } from './synthetic.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = resolve(root, 'apps/reader/dist');
const engine = process.env.BROWSER || 'chromium';
const launcher = { chromium, firefox, webkit }[engine];
if (!launcher) throw new Error(`BROWSER must be chromium, firefox or webkit (got "${engine}")`);
if (!existsSync(resolve(dist, 'index.html'))) throw new Error('apps/reader/dist/index.html is missing: run `npm run build` before validation/large-score.mjs');
/**
 * Budgets: first paint measured at 6.9-9.9 s locally (desktop Chromium, 12-core WSL2), x 1.5. Shared CI runners are
 * slower, so CI doubles it; LARGE_SCORE_BUDGET_SCALE overrides.
 */
const budgetScale = Number(process.env.LARGE_SCORE_BUDGET_SCALE || (process.env.CI ? 2 : 1));
const FIRST_PAINT_MS = 15000 * budgetScale;
const MAX_DRAWN_SYSTEMS = 8;
const MAX_HEAP_MB = 400;
/**
 * Phase 3: the score is engraved in chunks, so Verovio's WASM heap stays small (about 130-200 MB here; a whole import
 * of this score grew it past 300 MB, and 32 MB scores reached the 2 GiB cap). Reported by the runtime, any browser.
 */
const MAX_WASM_HEAP_MB = 512;
/** Phase 2: reading the file (hash, parse, Score transfer) must not block the main thread; Chromium reports long tasks. */
const IMPORT_LONG_TASK_MS = 200 * budgetScale;
const MEASURES = 150;
const xml = orchestral(30, MEASURES);
// Chosen from disk: Playwright sets a path through the browser, while a buffer is decoded by a script in the page,
// which would be a main-thread long task of the harness's own.
const xmlPath = join(mkdtempSync(join(tmpdir(), 'large-score-')), 'synthetic-symphony.musicxml');
writeFileSync(xmlPath, xml);
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.json': 'application/json' };
const server = createServer(async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  const path = resolve(dist, `.${pathname === '/' ? '/index.html' : pathname}`);
  if (!path.startsWith(`${dist}${sep}`)) { response.writeHead(403).end(); return; }
  try { response.writeHead(200, { 'content-type': mime[extname(path)] || 'application/octet-stream' }).end(await readFile(path)); }
  catch { response.writeHead(404).end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const url = `http://127.0.0.1:${server.address().port}`;
const browser = await launcher.launch({ headless: true, ...(engine === 'chromium' ? { args: ['--no-sandbox', '--enable-precise-memory-info'] } : {}) });
const started = Date.now();
try {
  // A short desktop viewport keeps "near the viewport" to a few systems; one bar per line makes later systems
  // reachable by playback within seconds. Playback is silent and wall-clock (an AudioContext that never resumes).
  const context = await browser.newContext({ viewport: { width: 1280, height: 640 } });
  await context.route(/poppins/i, route => route.abort());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('scoreflow-prefs', JSON.stringify({ barsPerLine: 1 }));
    Object.defineProperty(AudioContext.prototype, 'state', { configurable: true, get: () => 'suspended' });
    AudioContext.prototype.resume = () => new Promise(() => {});
  });
  const settled = () => page.waitForFunction(() => !document.querySelector('.score-loading') && document.querySelector('.score-system svg') && !document.querySelector('.score-content').getAnimations().length, null, { timeout: 120000 });
  await page.goto(url);
  await settled();

  // Long tasks from choosing the file until the score is shown (its title renders): the import, done in a worker.
  await page.evaluate(() => {
    const w = window;
    w.__longTasks = [];
    w.__importStart = performance.now();
    if (PerformanceObserver.supportedEntryTypes?.includes('longtask')) new PerformanceObserver(list => { for (const entry of list.getEntries()) w.__longTasks.push({ start: Math.round(entry.startTime), duration: Math.round(entry.duration) }); }).observe({ type: 'longtask' });
    else w.__longTasks = null;
    new MutationObserver((_, observer) => { if (document.querySelector('.score-meta h1')?.textContent === 'Synthetic Symphony') { w.__shownAt = performance.now(); observer.disconnect(); } }).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
  const t0 = Date.now();
  await page.locator('input[type=file]').first().setInputFiles(xmlPath);
  await page.waitForFunction(() => document.querySelector('.score-meta h1')?.textContent === 'Synthetic Symphony' && !document.querySelector('.score-loading') && document.querySelector('.score-system svg'), null, { timeout: 120000 });
  const firstPaint = Date.now() - t0;
  await settled();
  const state = () => page.evaluate(() => {
    const systems = [...document.querySelectorAll('.score-staves > .score-system')];
    const view = document.querySelector('.score-viewport');
    return { systems: systems.length, drawn: systems.flatMap((system, index) => system.querySelector(':scope > svg') ? [index] : []), scrollTop: view.scrollTop, scrollHeight: view.scrollHeight, clientHeight: view.clientHeight,
      heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null };
  });
  const imported = await page.evaluate(() => ({ tasks: window.__longTasks, start: window.__importStart, shown: window.__shownAt }));
  const importTasks = imported.tasks?.filter(task => task.start >= imported.start && task.start < imported.shown) ?? null;
  const initial = await state();
  console.log(`${engine}: ${(xml.length / 1e6).toFixed(1)} MB, ${MEASURES} measures x 30 parts: first paint ${firstPaint} ms, ${initial.systems} systems, drawn ${JSON.stringify(initial.drawn)}, heap ${initial.heapMB} MB`);
  if (importTasks) {
    console.log(`${engine}: import shown after ${Math.round(imported.shown - imported.start)} ms; main-thread long tasks during import: ${JSON.stringify(importTasks.map(task => task.duration))}`);
    assert.ok(importTasks.every(task => task.duration <= IMPORT_LONG_TASK_MS), `No main-thread task over ${IMPORT_LONG_TASK_MS} ms while the score imports (${JSON.stringify(importTasks)})`);
  }
  assert.ok(firstPaint <= FIRST_PAINT_MS, `First system paints within ${FIRST_PAINT_MS} ms (took ${firstPaint} ms)`);
  assert.equal(initial.systems, MEASURES, 'One placeholder or system block per line (one bar per line)');
  assert.ok(initial.drawn.includes(0), 'The first system is drawn');
  assert.ok(initial.drawn.length <= MAX_DRAWN_SYSTEMS, `Only systems near the viewport are drawn (${initial.drawn.length})`);
  if (initial.heapMB !== null) assert.ok(initial.heapMB <= MAX_HEAP_MB, `JS heap stays under ${MAX_HEAP_MB} MB (${initial.heapMB} MB)`);
  const blankPlaceholders = await page.evaluate(() => [...document.querySelectorAll('.score-system.is-pending')].every(block => parseFloat(block.style.height) > 0 && parseFloat(block.style.width) > 0));
  assert.ok(blankPlaceholders, 'Placeholders reserve the laid-out size of their systems');

  // Chunked engraving: a system deep in the score draws on demand from its own chunk, with the Score's measure (one bar
  // per line: system k holds bar k + 1) under its stable chunk measure ID, and its notes mapped.
  const middle = Math.floor(MEASURES / 2) + 3;
  await page.evaluate(index => document.querySelector(`.score-staves > .score-system[data-system="${index}"]`).scrollIntoView({ block: 'center' }), middle);
  await page.waitForFunction(index => document.querySelector(`.score-staves > .score-system[data-system="${index}"] > svg`), middle, { timeout: 120000 });
  const deep = await page.evaluate(index => {
    const block = document.querySelector(`.score-staves > .score-system[data-system="${index}"]`);
    return { firstMeasure: block.dataset.firstMeasure, measureIds: [...block.querySelectorAll('g.measure')].map(measure => measure.id), notes: block.querySelectorAll('.reader-note').length };
  }, middle);
  assert.deepEqual({ firstMeasure: deep.firstMeasure, measureIds: deep.measureIds }, { firstMeasure: String(middle + 1), measureIds: [`reader-m${middle + 1}`] }, `A system deep in the score engraves its own bar from a chunk (${JSON.stringify(deep)})`);
  assert.ok(deep.notes > 0, 'Notes of a system deep in the score are mapped');

  // Scroll to the end: the last system is drawn and the first is released.
  await page.evaluate(() => { const view = document.querySelector('.score-viewport'); view.scrollTop = view.scrollHeight; });
  await page.waitForFunction(() => { const systems = document.querySelectorAll('.score-staves > .score-system'); return systems[systems.length - 1].querySelector(':scope > svg') && !systems[0].querySelector(':scope > svg'); }, null, { timeout: 120000 });
  const end = await state();
  assert.ok(end.drawn.includes(end.systems - 1), 'The last system is drawn at the end');
  assert.ok(!end.drawn.includes(0), 'The first system is released far from the viewport');
  assert.ok(end.drawn.length <= MAX_DRAWN_SYSTEMS, `Drawn systems stay bounded after scrolling (${end.drawn.length})`);
  // The last system's notes are mapped (geometry is computed for systems as they are drawn).
  assert.ok(await page.evaluate(() => { const systems = document.querySelectorAll('.score-staves > .score-system'); return systems[systems.length - 1].querySelectorAll('.reader-note').length > 0; }), 'Notes of a system drawn on demand are mapped');
  const wasmHeapMB = await page.evaluate(() => window.__scoreflowVerovioHeapPeak ? Math.round(window.__scoreflowVerovioHeapPeak / 2 ** 20) : null);
  console.log(`${engine}: Verovio WASM heap peak ${wasmHeapMB} MB after drawing the first, a middle and the last systems`);
  assert.ok(wasmHeapMB !== null && wasmHeapMB <= MAX_WASM_HEAP_MB, `Verovio's WASM heap stays under ${MAX_WASM_HEAP_MB} MB (${wasmHeapMB} MB)`);

  // Back at the top, play fast: the playhead reaches a system that was not drawn at first paint and highlights it.
  await page.evaluate(() => { document.querySelector('.score-viewport').scrollTop = 0; });
  await page.waitForFunction(() => document.querySelector('.score-staves > .score-system:first-child > svg'), null, { timeout: 60000 });
  await page.locator('.bpm-control input').fill('240');
  const target = Math.max(...initial.drawn) + 1;
  await page.getByRole('button', { name: 'Play score', exact: true }).click();
  await page.waitForFunction(index => document.querySelector(`.score-staves > .score-system[data-system="${index}"] .reader-note.is-playing`), target, { timeout: 60000 });
  const highlighted = await page.evaluate(index => ({ line: !!document.querySelector(`.score-staves > .score-system[data-system="${index}"] .playback-line`), playing: document.querySelectorAll('.reader-note.is-playing').length }), target);
  assert.ok(highlighted.playing > 0, 'A note is highlighted in a system drawn on demand');
  await page.getByRole('button', { name: 'Pause playback', exact: true }).click();
  assert.deepEqual(errors, []);
  await context.close();
  console.log(`${engine}: large score virtualized systems, on-demand drawing, release and playback highlight passed (${((Date.now() - started) / 1000).toFixed(1)} s)`);

  // Opening other scores while a large one draws systems on demand: the old score's renders are superseded (its
  // baseline is gone once the worker is recycled for the next import) and must stop, not retry in a tight loop that
  // starves the event loop. The page stays responsive and the last-opened score renders.
  {
    const switching = await browser.newContext({ viewport: { width: 1280, height: 640 } });
    await switching.route(/poppins/i, route => route.abort());
    const tab = await switching.newPage();
    const switchErrors = [];
    tab.on('pageerror', error => switchErrors.push(error.message));
    await tab.addInitScript(() => localStorage.setItem('scoreflow-prefs', JSON.stringify({ barsPerLine: 1 })));
    await tab.goto(url);
    await tab.waitForFunction(() => !document.querySelector('.score-loading') && document.querySelector('.score-system svg'), null, { timeout: 120000 });
    const input = tab.locator('input[type=file]').first();
    await input.setInputFiles({ name: 'first.musicxml', mimeType: 'application/xml', buffer: Buffer.from(xml) });
    await tab.waitForFunction(() => document.querySelector('.score-meta h1')?.textContent === 'Synthetic Symphony' && !document.querySelector('.score-loading') && document.querySelector('.score-system svg'), null, { timeout: 120000 });
    // Keep the first score drawing nearby systems while the next ones import.
    const scrollAlong = () => tab.evaluate(() => { const view = document.querySelector('.score-viewport'); view.scrollTop += view.clientHeight * 3; });
    await scrollAlong();
    await input.setInputFiles({ name: 'second.musicxml', mimeType: 'application/xml', buffer: Buffer.from(xml.replace('Synthetic Symphony', 'Second Symphony')) });
    await scrollAlong();
    await new Promise(done => setTimeout(done, 400));
    await scrollAlong();
    await input.setInputFiles(resolve(root, 'validation/fixtures/ensemble.musicxml'));
    // A timer must fire promptly the whole time (a microtask retry loop would block it, and page.evaluate with it).
    const deadline = Date.now() + 120000;
    let worstLag = 0;
    for (;;) {
      const lag = await Promise.race([
        tab.evaluate(() => new Promise(done => { const at = performance.now(); setTimeout(() => done(performance.now() - at), 0); })),
        new Promise(done => setTimeout(() => done(Infinity), 5000)),
      ]);
      worstLag = Math.max(worstLag, lag);
      assert.ok(lag < 1000, `The page stays responsive while scores switch (a timer waited ${lag} ms)`);
      const shown = await tab.evaluate(() => document.querySelector('.score-meta h1')?.textContent === 'Migration ensemble' && !document.querySelector('.score-loading') && !!document.querySelector('.score-system svg'));
      if (shown) break;
      assert.ok(Date.now() < deadline, 'The last-opened score renders');
      await new Promise(done => setTimeout(done, 250));
    }
    assert.deepEqual(switchErrors, []);
    await switching.close();
    console.log(`${engine}: opening scores while a large one draws stays responsive (worst timer lag ${Math.round(worstLag)} ms) passed`);
  }

  // Endless zoom on a long score keeps the reading position: the zoom anchor's chunk is drawn before the re-layout
  // resolves (and an undrawn anchor falls back to layout geometry).
  {
    const long = (() => {
      const parts = Array.from({ length: 5 }, (_, index) => `P${index + 1}`);
      const measure = number => `<measure number="${number}">${number === 1 ? '<attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>' : ''}${['C', 'E', 'G', 'B'].map(step => `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type></note>`).join('')}</measure>`;
      return `<?xml version="1.0"?><score-partwise version="4.0"><work><work-title>Long Endless</work-title></work><part-list>${parts.map(id => `<score-part id="${id}"><part-name>Staff ${id.slice(1)}</part-name></score-part>`).join('')}</part-list>${parts.map(id => `<part id="${id}">${Array.from({ length: 400 }, (_, index) => measure(index + 1)).join('')}</part>`).join('')}</score-partwise>`;
    })();
    const endless = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await endless.route(/poppins/i, route => route.abort());
    const tab = await endless.newPage();
    const endlessErrors = [];
    tab.on('pageerror', error => endlessErrors.push(error.message));
    await tab.addInitScript(() => localStorage.setItem('scoreflow-prefs', JSON.stringify({ mode: 'landscape' })));
    await tab.goto(url);
    const ready = () => tab.waitForFunction(() => !document.querySelector('.score-loading') && document.querySelector('.score-system svg') && !document.querySelector('.score-content').getAnimations().length, null, { timeout: 120000 });
    await ready();
    await tab.locator('input[type=file]').first().setInputFiles({ name: 'long.musicxml', mimeType: 'application/xml', buffer: Buffer.from(long) });
    await tab.waitForFunction(() => document.querySelector('.score-meta h1')?.textContent === 'Long Endless', null, { timeout: 120000 });
    await ready();
    // Measure 300 (index 299) is in the third 120-bar chunk: bring that chunk in, then centre the measure.
    const target = '.reader-note[data-note-id^="P1-1-299-"]';
    const centre = () => tab.evaluate(selector => {
      const view = document.querySelector('.score-viewport');
      const note = document.querySelector(selector);
      if (!note) { const block = document.querySelector('.score-system[data-system="2"]'); view.scrollLeft += block.getBoundingClientRect().left - view.getBoundingClientRect().left + block.getBoundingClientRect().width / 2 - view.clientWidth / 2; return false; }
      const rect = note.getBoundingClientRect(), box = view.getBoundingClientRect();
      view.scrollLeft += rect.left + rect.width / 2 - (box.left + box.width / 2);
      return true;
    }, target);
    for (let attempt = 0; attempt < 40 && !(await centre()); attempt++) await new Promise(done => setTimeout(done, 250));
    await tab.waitForFunction(selector => document.querySelector(selector), target, { timeout: 60000 });
    await centre();
    const inView = () => tab.evaluate(selector => {
      const note = document.querySelector(selector), view = document.querySelector('.score-viewport').getBoundingClientRect();
      const rect = note?.getBoundingClientRect();
      return { found: !!note, x: rect ? rect.left + rect.width / 2 : null, left: view.left, right: view.right, scrollLeft: document.querySelector('.score-viewport').scrollLeft };
    }, target);
    const before = await inView();
    assert.ok(before.found && before.x >= before.left && before.x <= before.right, `Measure 300 is in view before zooming (${JSON.stringify(before)})`);
    const committed = await tab.evaluate(() => document.querySelector('.score-content').dataset.staveScale);
    await tab.getByRole('slider', { name: 'Stave scale', exact: true }).fill('1.2');
    await tab.waitForFunction(previous => document.querySelector('.score-content').dataset.staveScale !== previous, committed, { timeout: 60000 });
    await ready();
    // Nearby chunks draw on demand; a lost reading position leaves measure 300 far away and undrawn.
    await tab.waitForFunction(selector => document.querySelector(selector), target, { timeout: 20000 }).catch(() => {});
    const after = await inView();
    assert.ok(after.found && after.x >= after.left && after.x <= after.right, `Measure 300 stays in view after an Endless zoom (${JSON.stringify(after)})`);
    assert.deepEqual(endlessErrors, []);
    await endless.close();
    console.log(`${engine}: Endless zoom on a long virtualized score keeps the reading position passed`);
  }
} finally {
  await browser.close();
  server.close();
}
