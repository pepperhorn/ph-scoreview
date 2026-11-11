import { webkit } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { dist } from '../serve-dist.mjs';
const mode = process.argv[2]; // drop | 503
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.json': 'application/json', '.mjs': 'text/javascript' };
let fail = true;
const server = createServer(async (req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (/PdfOverlay/.test(p)) { console.log('server got', p, fail ? 'FAILING' : 'serving'); if (fail) { if (mode === 'drop') return req.socket.destroy(); res.writeHead(503).end(); return; } }
  let path = resolve(dist, '.' + (p === '/' ? '/index.html' : p));
  if (!extname(path)) path = resolve(path, 'index.html');
  try { res.writeHead(200, { 'content-type': mime[extname(path)] || 'application/octet-stream' }).end(await readFile(path)); } catch { res.writeHead(404).end(); }
});
await new Promise(d => server.listen(0, '127.0.0.1', d));
const url = `http://127.0.0.1:${server.address().port}`;
const browser = await webkit.launch({ headless: true });
const page = await browser.newPage(); page.setDefaultTimeout(8000);
page.on('console', m => console.log('console:', m.text()));
page.on('request', r => /_astro/.test(r.url()) && console.log('  pwreq', r.url().split('/_astro/')[1]));
await page.addInitScript(() => { window.addEventListener('vite:preloadError', e => console.log('preloadError', String(e.payload))); window.addEventListener('error', e => console.log('errorevent', e.target?.tagName, e.target?.href || e.target?.src || e.message), true); window.addEventListener('unhandledrejection', e => console.log('unhandled', String(e.reason))); });
await page.goto(`${url}/embed-skin`);
await page.locator('.skin-reader .score-system svg').first().waitFor();
await page.evaluate(() => window.__skin.setSkin({bar:['pdf']}));
await page.locator('.skin-reader .pdf-trigger').click();
const dlg = page.locator('.skin-reader').getByRole('dialog',{name:'Export PDF'});
await dlg.getByRole('alert').waitFor(); console.log('alert');
fail = false; console.log('=== now reload'); const t0 = await page.evaluate(()=>performance.timeOrigin); console.log('t0', t0);
await Promise.all([page.waitForEvent('load'), dlg.getByRole('button',{name:'Reload page',exact:true}).click()]);
await page.locator('.skin-reader .score-system svg').first().waitFor();
await page.evaluate(() => window.__skin.setSkin({bar:['pdf']}));
await page.locator('.skin-reader .pdf-trigger').click();
await page.waitForTimeout(2000); console.log('DIALOG:', await page.locator('.pdf-panel').allInnerTexts(), 'docid', await page.evaluate(()=>performance.timeOrigin), 'wasReloaded', (await page.evaluate(()=>performance.timeOrigin)) !== t0);
try { await page.getByLabel('Paper size').waitFor(); console.log(mode,'OK'); } catch { console.log(mode,'FAIL'); }
process.exit(0);
