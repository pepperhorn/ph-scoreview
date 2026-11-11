import { webkit } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { dist } from '../serve-dist.mjs';
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.json': 'application/json', '.mjs': 'text/javascript' };
let fail = true, hits = 0;
const server = createServer(async (req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (/PdfOverlay/.test(p)) { hits++; if (fail) { res.writeHead(503).end(); return; } }
  let path = resolve(dist, '.' + (p === '/' ? '/index.html' : p));
  if (!extname(path)) path = resolve(path, 'index.html');
  try { res.writeHead(200, { 'content-type': mime[extname(path)] || 'application/octet-stream' }).end(await readFile(path)); } catch { res.writeHead(404).end(); }
});
await new Promise(d => server.listen(0, '127.0.0.1', d));
const url = `http://127.0.0.1:${server.address().port}`;
const browser = await webkit.launch({ headless: true });
const page = await browser.newPage(); page.setDefaultTimeout(8000);
await page.route(/_astro\/dist\..*\.js$/, async route => { const r = await route.fetch(); let b = await r.text(); b = b.replace("()=>{e&&ft(`PDF options could not load", "err=>{console.log('IMPORTFAIL', String(err), err&&err.name);e&&ft(`PDF options could not load"); await route.fulfill({ response: r, body: b }); });
page.on('console', m => console.log('console:', m.text()));
const open = async () => { await page.locator('.skin-reader .score-system svg').first().waitFor(); await page.evaluate(() => window.__skin.setSkin({bar:['pdf']})); await page.locator('.skin-reader .pdf-trigger').click();
  try { await page.getByLabel('Paper size').waitFor({timeout:4000}); return 'OK'; } catch { return 'FAIL'; } };
await page.goto(`${url}/embed-skin`);
console.log('first', await open(), 'hits', hits);
fail = false;
const step = async (name, fn) => { await fn(); console.log(name, await open(), 'hits', hits); };
await step('reload1', () => page.reload());
for (let n=1;n<=3;n++) { await page.locator('.pdf-cancel').click(); await page.locator('.skin-reader .pdf-trigger').click(); try { await page.getByLabel('Paper size').waitFor({timeout:4000}); console.log('retry', n, 'OK hits', hits); break; } catch { console.log('retry', n, 'FAIL hits', hits); } }
process.exit(0);
