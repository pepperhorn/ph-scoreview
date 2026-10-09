// Large-score guardrails (docs/specs/large-score-performance.md, Phase 3): the reopen-last-file offer, the
// out-of-memory message with its retry, and the large-file notice. Runs against the built app (`npm run build`).
//
// The large-file notice is triggered with a small fixture by lowering the byte threshold through
// localStorage['scoreflow-large-file-bytes'] (see LARGE_FILE_BYTES_OVERRIDE_KEY in packages/pepperscore/src/lib/large-file.ts). The
// out-of-memory path uses the runtime's test hook localStorage['scoreflow-simulate-oom'] (packages/pepperscore/src/lib/verovio-runtime.ts),
// which fails the next Verovio probe or render once.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox, webkit } from 'playwright-core';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = resolve(root, 'apps/reader/dist');
const engine = process.env.BROWSER || 'chromium';
const launcher = { chromium, firefox, webkit }[engine];
if (!launcher) throw new Error(`BROWSER must be chromium, firefox or webkit (got "${engine}")`);
if (!process.env.READER_URL && !existsSync(resolve(dist, 'index.html'))) throw new Error('apps/reader/dist/index.html is missing: run `npm run build` before validation/guardrails.mjs');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.wasm': 'application/wasm' };
const server = createServer(async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  const path = resolve(dist, `.${pathname === '/' ? '/index.html' : pathname}`);
  if (!path.startsWith(`${dist}${sep}`)) { response.writeHead(403).end(); return; }
  try { response.writeHead(200, { 'content-type': mime[extname(path)] || 'application/octet-stream' }).end(await readFile(path)); }
  catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = process.env.READER_URL || `http://127.0.0.1:${server.address().port}`;
const browser = await launcher.launch({ headless: true, ...(engine === 'chromium' ? { args: ['--no-sandbox'] } : {}) });
const fixture = resolve(root, 'validation/fixtures/ensemble.musicxml');
const FIXTURE_TITLE = 'Migration ensemble';
const SAMPLE_TITLE = 'A little room to play';

const painted = page => page.waitForFunction(() => !document.querySelector('.score-loading') && document.querySelector('.score-system svg') && !document.querySelector('.score-content').getAnimations().length, null, { timeout: 30000 });
const title = page => page.evaluate(() => document.querySelector('.score-meta h1')?.textContent ?? null);
const noToast = async page => assert.equal(await page.locator('.toast').count(), 0, (await page.locator('.toast').allTextContents()).join(' | '));
/** The remembered file's info record, read straight from IndexedDB (null when there is none). */
const storedInfo = page => page.evaluate(() => new Promise(resolve => {
  const request = indexedDB.open('scoreflow-last-file', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('last-file');
  request.onerror = () => resolve(null);
  request.onsuccess = () => {
    const db = request.result;
    const get = db.transaction('last-file', 'readonly').objectStore('last-file').get('info');
    get.onsuccess = () => { db.close(); resolve(get.result ?? null); };
    get.onerror = () => { db.close(); resolve(null); };
  };
}));
const waitStored = async (page, present) => {
  for (let attempt = 0; attempt < 100; attempt++) {
    const info = await storedInfo(page);
    if (Boolean(info) === present) return info;
    await page.waitForTimeout(100);
  }
  throw new Error(`The last opened file was ${present ? 'never stored' : 'never forgotten'}`);
};

try {
  // 1. Reopen after reload: offered, never auto-opened; Reopen opens it; Not now hides it for the session; Forget deletes it.
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(url);
    await painted(page);
    assert.equal(await page.locator('.reopen-banner').count(), 0, 'No reopen offer before any file was opened');
    assert.equal(await page.locator('.forget-last-file').count(), 0, 'No forget button before any file was opened');
    await page.locator('input[type=file]').setInputFiles(fixture);
    await page.waitForFunction(t => document.querySelector('.score-meta h1')?.textContent === t, FIXTURE_TITLE, { timeout: 30000 });
    await painted(page);
    const info = await waitStored(page, true);
    assert.equal(info.name, 'ensemble.musicxml');
    assert.ok(info.size > 0 && Number.isFinite(info.savedAt), `Stored info: ${JSON.stringify(info)}`);

    await page.reload();
    const banner = page.locator('.reopen-banner');
    await banner.waitFor({ timeout: 15000 });
    await painted(page);
    assert.equal(await page.locator('.reopen-banner-text').textContent(), 'Reopen ensemble.musicxml?');
    assert.equal(await banner.getAttribute('role'), 'status');
    assert.match(await page.locator('.reopen-banner-privacy').textContent(), /only on this device/i, 'The offer says the file stays on this device');
    assert.equal(await title(page), SAMPLE_TITLE, 'The remembered file is not opened automatically');
    await page.waitForTimeout(500);
    assert.equal(await title(page), SAMPLE_TITLE, 'Still the sample after a moment');
    await page.getByRole('button', { name: 'Reopen ensemble.musicxml', exact: true }).click();
    await page.waitForFunction(t => document.querySelector('.score-meta h1')?.textContent === t, FIXTURE_TITLE, { timeout: 30000 });
    await painted(page);
    assert.equal(await banner.count(), 0, 'The offer is gone once the score opens');
    await noToast(page);

    // Not now: hidden for this tab's session (a reload keeps it hidden) while the file stays remembered.
    await page.reload();
    await banner.waitFor({ timeout: 15000 });
    await page.getByRole('button', { name: 'Not now', exact: true }).click();
    assert.equal(await banner.count(), 0, 'Not now hides the offer');
    await page.reload();
    await painted(page);
    await page.waitForTimeout(800);
    assert.equal(await banner.count(), 0, 'Not now lasts for the session');
    await page.getByRole('button', { name: 'Options', exact: true }).click();
    const forgetButton = page.getByRole('button', { name: 'Forget last opened file', exact: true });
    await forgetButton.waitFor();
    assert.match(await forgetButton.getAttribute('title'), /only on this device/i, 'The forget button explains where the file is kept');
    await page.locator('button[aria-label="Close options"]').click();

    // A new tab (new session) offers it again; Forget deletes it for good.
    const tab = await context.newPage();
    tab.on('pageerror', e => errors.push(e.message));
    await tab.goto(url);
    const tabBanner = tab.locator('.reopen-banner');
    await tabBanner.waitFor({ timeout: 15000 });
    await tab.getByRole('button', { name: 'Forget ensemble.musicxml', exact: true }).click();
    assert.equal(await tabBanner.count(), 0, 'Forget hides the offer');
    await waitStored(tab, false);
    await tab.reload();
    await painted(tab);
    await tab.waitForTimeout(800);
    assert.equal(await tabBanner.count(), 0, 'A forgotten file is not offered after a reload');
    assert.equal(await title(tab), SAMPLE_TITLE);
    await tab.getByRole('button', { name: 'Options', exact: true }).click();
    await tab.locator('.bottom-drawer.open').waitFor();
    assert.equal(await tab.locator('.forget-last-file').count(), 0, 'No forget button once forgotten');
    await tab.locator('button[aria-label="Close options"]').click();

    // The drawer button forgets too.
    await tab.locator('input[type=file]').setInputFiles(fixture);
    await tab.waitForFunction(t => document.querySelector('.score-meta h1')?.textContent === t, FIXTURE_TITLE, { timeout: 30000 });
    await waitStored(tab, true);
    await tab.getByRole('button', { name: 'Options', exact: true }).click();
    await tab.getByRole('button', { name: 'Forget last opened file', exact: true }).click();
    await waitStored(tab, false);
    assert.equal(await tab.locator('.forget-last-file').count(), 0, 'The drawer button goes once forgotten');
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`${engine}: reopen last file after reload passed`);
  }

  // 2. Out of memory: a clear message with guidance and a retry at a smaller chunk size, which paints the score.
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(url);
    await painted(page);
    await page.evaluate(() => localStorage.setItem('scoreflow-simulate-oom', '1'));
    await page.locator('input[type=file]').setInputFiles(fixture);
    const toast = page.locator('.toast');
    await toast.waitFor({ timeout: 30000 });
    assert.equal(await toast.getAttribute('role'), 'alert');
    const text = await page.locator('.toast-text').textContent();
    assert.match(text, /ran out of memory/i, `The alert says the renderer ran out of memory: ${text}`);
    assert.match(text, /Close other tabs, or try again with smaller sections\./, 'The alert says what to do');
    const retry = page.getByRole('button', { name: 'Try again with smaller sections', exact: true });
    assert.equal(await retry.count(), 1, 'The alert offers a retry');
    assert.equal(await page.evaluate(() => localStorage.getItem('scoreflow-simulate-oom')), null, 'The simulated failure fired once');
    await retry.click();
    await painted(page);
    await page.waitForFunction(t => document.querySelector('.score-meta h1')?.textContent === t, FIXTURE_TITLE, { timeout: 30000 });
    await noToast(page);
    assert.ok(await page.locator('.score-system svg .note').count() > 0, 'The retry paints the score');
    // A non-memory error keeps the plain toast, without the retry.
    await page.locator('input[type=file]').setInputFiles({ name: 'bad.xml', mimeType: 'application/xml', buffer: Buffer.from('<broken') });
    await toast.waitFor();
    assert.equal(await page.locator('.oom-retry-button').count(), 0, 'Other errors have no smaller-sections retry');
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`${engine}: out-of-memory message and retry passed`);
  }

  // 3. Large-file notice: shown (non-blocking) with an expected wait while a large file opens, gone once it paints.
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    // The notice can be brief on a fast machine: record every one that appears.
    await page.addInitScript(() => {
      window.__largeNotices = [];
      new MutationObserver(() => {
        const notice = document.querySelector('.large-file-notice');
        if (notice && !window.__largeNotices.some(seen => seen.text === notice.textContent)) window.__largeNotices.push({ text: notice.textContent, role: notice.getAttribute('role'), dismiss: !!notice.querySelector('button[aria-label="Dismiss large score notice"]') });
      }).observe(document, { childList: true, subtree: true, characterData: true });
    });
    await page.goto(url);
    await painted(page);
    // Below the threshold: no notice.
    await page.locator('input[type=file]').setInputFiles(fixture);
    await page.waitForFunction(t => document.querySelector('.score-meta h1')?.textContent === t, FIXTURE_TITLE, { timeout: 30000 });
    await painted(page);
    assert.deepEqual(await page.evaluate(() => window.__largeNotices), [], 'A small file gets no large-score notice');
    // Lower the threshold below the fixture's size: the same file is now "large".
    await page.evaluate(() => localStorage.setItem('scoreflow-large-file-bytes', '1000'));
    await page.getByRole('button', { name: 'Options', exact: true }).click();
    await page.getByRole('button', { name: 'Open sample score' }).click();
    await page.waitForFunction(t => document.querySelector('.score-meta h1')?.textContent === t, SAMPLE_TITLE, { timeout: 30000 });
    await painted(page);
    await page.locator('input[type=file]').setInputFiles(fixture);
    await page.waitForFunction(t => document.querySelector('.score-meta h1')?.textContent === t, FIXTURE_TITLE, { timeout: 30000 });
    await painted(page);
    const seen = await page.evaluate(() => window.__largeNotices);
    assert.equal(seen.length, 1, `One large-score notice: ${JSON.stringify(seen)}`);
    assert.match(seen[0].text, /^Large score \(\d+(\.\d)? MB\)\. Opening may take about \d+(–\d+)? seconds? on this device\.$/, `Notice text: ${seen[0].text}`);
    assert.equal(seen[0].role, 'status', 'The notice is a status, not an alert');
    assert.ok(seen[0].dismiss, 'The notice can be dismissed');
    assert.equal(await page.locator('.large-file-notice').count(), 0, 'The notice clears once the score paints');
    await noToast(page);
    // A failure while the notice is up replaces it with the error.
    await page.getByRole('button', { name: 'Options', exact: true }).click();
    await page.getByRole('button', { name: 'Open sample score' }).click();
    await page.waitForFunction(t => document.querySelector('.score-meta h1')?.textContent === t, SAMPLE_TITLE, { timeout: 30000 });
    await painted(page);
    await page.evaluate(() => localStorage.setItem('scoreflow-simulate-oom', '1'));
    await page.locator('input[type=file]').setInputFiles(fixture);
    // The simulated failure keeps the notice up until the draw fails, then the error replaces it.
    await page.locator('.toast').waitFor({ timeout: 30000 });
    assert.equal(await page.locator('.large-file-notice').count(), 0, 'An error clears the notice');
    await page.locator('.toast .oom-retry-button').click();
    await painted(page);
    await noToast(page);
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`${engine}: large-file notice passed`);
  }
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
