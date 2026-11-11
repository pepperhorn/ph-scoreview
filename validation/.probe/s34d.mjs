import { webkit } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { dist } from '../serve-dist.mjs';
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.json': 'application/json', '.mjs': 'text/javascript' };
let fail = true;
const server = createServer(async (req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (/PdfOverlay/.test(p)) { console.log('server got', req.url, req.headers['cache-control']||'', fail ? 'FAILING' : 'serving'); if (fail) { res.writeHead(503).end(); return; } }
  let path = resolve(dist, '.' + (p === '/' ? '/index.html' : p));
  if (!extname(path)) path = resolve(path, 'index.html');
  try { res.writeHead(200, { 'content-type': mime[extname(path)] || 'application/octet-stream' }).end(await readFile(path)); } catch { res.writeHead(404).end(); }
});
await new Promise(d => server.listen(0, '127.0.0.1', d));
const url = `http://127.0.0.1:${server.address().port}`;
const browser = await webkit.launch({ headless: true });
const page = await browser.newPage(); page.setDefaultTimeout(8000);
await page.goto(`${url}/embed-skin`);
await page.locator('.skin-reader .score-system svg').first().waitFor();
await page.evaluate(() => window.__skin.setSkin({bar:['pdf']}));
await page.locator('.skin-reader .pdf-trigger').click();
await page.locator('.skin-reader').getByRole('alert').waitFor(); console.log('alert');
fail = false;
const u = '/_astro/' + (await page.evaluate(() => performance.getEntriesByType('resource').map(e => e.name).find(n => /PdfOverlay/.test(n)))).split('/_astro/')[1];
await page.reload(); await page.locator('.skin-reader .score-system svg').first().waitFor();
console.log('--- after reload: import same url'); console.log(await page.evaluate(async u => { try { await import(u); return 'ok'; } catch (e) { return String(e); } }, u));
console.log('--- again'); console.log(await page.evaluate(async u => { try { await import(u); return 'ok'; } catch (e) { return String(e); } }, u));
console.log('--- fetch'); console.log(await page.evaluate(async u => { try { return (await fetch(u)).status; } catch (e) { return String(e); } }, u));
console.log('--- import after fetch'); console.log(await page.evaluate(async u => { try { await import(u); return 'ok'; } catch (e) { return String(e); } }, u));
process.exit(0);
