// Layout stability and explicit bars per line, with real (non-overlay) scrollbars. Playwright's Chromium hides scrollbars
// by default (--hide-scrollbars), which hid a re-engrave loop: a viewport's own vertical scrollbar appearing narrowed it,
// the width change re-engraved the score smaller, the scrollbar went away, and so on. Pages: /embed-test (full reader in
// a 600px box, minimal snippets) and /embed-layout (1100px-wide snippets with Auto and explicit bars per line, a full
// reader in a fixed-height box). Runs against the build. BROWSER=chromium|firefox|webkit.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, firefox, webkit } from 'playwright-core';
import { root, serveDist } from './serve-dist.mjs';

const engine = process.env.BROWSER || 'chromium';
const launcher = { chromium, firefox, webkit }[engine];
if (!launcher) throw new Error(`BROWSER must be chromium, firefox or webkit (got "${engine}")`);
const server = await serveDist();
// Chromium: keep its scrollbars (classic, space-taking ones in headless Linux), as on Windows desktop browsers.
const browser = await launcher.launch({ headless: true, ...(engine === 'chromium' ? { args: ['--no-sandbox'], ignoreDefaultArgs: ['--hide-scrollbars'] } : {}) });
const sounds = join(root, 'packages/pepperscore-sounds-complete');
const SETTLE_MS = 3000;
const WINDOW_MS = 5000;

async function open(path) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.route(/poppins/i, route => route.abort());
  await context.route('**/custom-assets/**', async route => {
    const file = decodeURIComponent(new URL(route.request().url()).pathname.replace(/^\/custom-assets\//, ''));
    if (file === 'pack.json') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ pack: 'core', fluidr3: [] }) });
    try { return route.fulfill({ status: 200, body: await readFile(join(sounds, file)) }); } catch { return route.fulfill({ status: 404, body: '' }); }
  });
  await context.route('**/embed-sounds/*.json', route => route.fulfill({ status: 404, body: '' }));
  // Count every .score-system block inserted under each reader root (a re-engrave replaces them all).
  await context.addInitScript(() => {
    window.__insertions = new Map();
    new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) {
        const blocks = node.nodeType !== 1 ? [] : node.matches?.('.score-system') ? [node] : [...node.querySelectorAll?.('.score-system') || []];
        for (const block of blocks) {
          const owner = block.closest('.pepperscore');
          const key = owner ? [...owner.classList].find(name => name !== 'pepperscore' && !name.startsWith('ps-')) || 'root' : 'detached';
          window.__insertions.set(key, (window.__insertions.get(key) || 0) + 1);
        }
      }
    }).observe(document, { childList: true, subtree: true });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${server.url}${path}`);
  return { context, page, errors };
}
const rendered = (page, selector) => page.waitForFunction(selector => { const element = document.querySelector(selector); return element && element.querySelector('.score-system svg') && !element.querySelector('.score-loading'); }, selector, { timeout: 60000 });
const insertions = page => page.evaluate(() => Object.fromEntries(window.__insertions));

/** No reader on the page inserts system blocks over WINDOW_MS once it has settled. */
async function assertStable(page, label) {
  await page.waitForTimeout(SETTLE_MS);
  const before = await insertions(page);
  await page.waitForTimeout(WINDOW_MS);
  const after = await insertions(page);
  assert.deepEqual(after, before, `${label}: readers kept re-engraving (system insertions ${JSON.stringify(before)} -> ${JSON.stringify(after)})`);
}

try {
  // 0. The browser really shows space-taking scrollbars (otherwise this suite proves nothing on Chromium).
  if (engine === 'chromium') {
    const { context, page } = await open('/embed-layout');
    const gutter = await page.evaluate(() => { const probe = document.createElement('div'); probe.style.cssText = 'width:100px;height:100px;overflow:scroll;position:absolute'; document.body.append(probe); const size = probe.offsetWidth - probe.clientWidth; probe.remove(); return size; });
    assert.ok(gutter > 0, `Chromium runs with classic scrollbars (gutter ${gutter}px)`);
    await context.close();
  }

  // 1. /embed-test: the full reader and the minimal snippets settle.
  {
    const { context, page, errors } = await open('/embed-test');
    for (const selector of ['.pepperscore.embed-full', '.pepperscore.embed-a', '.pepperscore.embed-b', '.pepperscore.embed-none']) await rendered(page, selector);
    await assertStable(page, '/embed-test');
    assert.deepEqual(errors, []);
    await context.close();
  }

  // 2. /embed-layout: wide natural-height snippets and the fixed-height full reader settle, and explicit bars per line
  // decide the stave size in Vertical view.
  {
    const { context, page, errors } = await open('/embed-layout');
    const roots = ['auto', 'bars4', 'bars2', 'bars8', 'bars2-zoom', 'header', 'full'].map(name => `.pepperscore.layout-${name}`);
    for (const selector of roots) await rendered(page, selector);
    await assertStable(page, '/embed-layout');

    const shape = name => page.evaluate(selector => {
      const root = document.querySelector(selector);
      const viewport = root.querySelector('.score-viewport');
      const systems = [...root.querySelectorAll('.score-staves > .score-system')];
      return {
        bars: systems.map(block => block.querySelectorAll('g.measure').length),
        widths: systems.map(block => block.getBoundingClientRect().width),
        viewport: viewport.clientWidth,
        scale: Number(getComputedStyle(root.querySelector('.score-content')).getPropertyValue('--stave-scale')),
        verticalScrollbar: viewport.offsetWidth - viewport.clientWidth - viewport.clientLeft * 2,
        scrolls: viewport.scrollHeight > viewport.clientHeight + 1,
      };
    }, `.pepperscore.layout-${name}`);
    const four = await shape('bars4'), two = await shape('bars2'), eight = await shape('bars8'), zoomed = await shape('bars2-zoom'), auto = await shape('auto');
    const detail = JSON.stringify({ four, two, eight, zoomed, auto });
    assert.deepEqual(four.bars, [4, 4], `barsPerLine 4 on 8 bars: two systems of four (${detail})`);
    assert.deepEqual(two.bars, [2, 2, 2, 2], `barsPerLine 2 on 8 bars: four systems of two (${detail})`);
    assert.deepEqual(eight.bars, [8, 8], `barsPerLine 8 on 16 bars: two systems of eight (${detail})`);
    assert.ok(two.scale > four.scale * 1.3, `barsPerLine 2 draws larger staves than barsPerLine 4 (${detail})`);
    assert.ok(four.scale > eight.scale * 1.3, `barsPerLine 4 draws larger staves than barsPerLine 8 (${detail})`);
    // Explicit bars per line fill the width (systems are width-fitted, not narrow and centred).
    for (const [name, item] of Object.entries({ four, two, eight })) for (const width of item.widths) assert.ok(width >= item.viewport * .8, `${name}: systems fill the width (${detail})`);
    // An explicit zoom keeps the zoom; bars per line only sets the breaks.
    assert.deepEqual(zoomed.bars, [2, 2, 2, 2], `barsPerLine 2 with zoom 0.6: four systems of two (${detail})`);
    assert.ok(Math.abs(zoomed.scale - .6) < .02, `barsPerLine 2 with zoom 0.6 keeps the zoom (${detail})`);
    // A natural-height snippet follows its content: no vertical scrollbar of its own.
    for (const [name, item] of Object.entries({ four, two, eight, zoomed, auto })) assert.ok(!item.scrolls && item.verticalScrollbar <= 0, `${name}: a natural-height snippet does not scroll vertically (${detail})`);
    // chrome="minimal" with a header: the compact play button sits above the sticky header, not under it.
    const hit = await page.evaluate(() => { const button = document.querySelector('.layout-header .ps-compact-play'); button.scrollIntoView({ block: 'center' }); const r = button.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return button.contains(top); });
    assert.ok(hit, 'the compact play button is on top of the minimal header');
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log(`Layout validation passed (${engine})`);
} finally {
  await browser.close();
  await server.close();
}
