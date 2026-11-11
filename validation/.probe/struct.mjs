import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { root } from '../serve-dist.mjs';
import { orchestral } from '../synthetic.mjs';
const server = await createServer({ configFile: false, root, optimizeDeps: { include: ['jspdf', 'svg2pdf.js', 'abcjs', '@tonejs/midi', 'fflate'] }, server: { host: '127.0.0.1', port: 0 },
  plugins: [{ name: 'p', configureServer(s) { s.middlewares.use('/pdf-spike', (_q, r) => { r.setHeader('Content-Type','text/html'); r.end('<!doctype html><title>x</title>'); }); } }] });
await server.listen();
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage(); page.setDefaultTimeout(600000);
await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/pdf-spike`);
const out = await page.evaluate(async xml => {
  const { parseMusicXml } = await import('/packages/pepperscore/src/lib/import.ts');
  const { engravePages } = await import('/packages/pepperscore/src/lib/pdf/engrave.ts');
  const files = { module: new URL('/node_modules/verovio/dist/verovio-module.mjs', location.href).href, toolkit: new URL('/node_modules/verovio/dist/verovio.mjs', location.href).href };
  const score = parseMusicXml(xml);
  const r = await engravePages({ data: score.document.engravingText }, { paper: 'a4', maxBars: 4, files }, new AbortController().signal);
  const svg = new DOMParser().parseFromString(r.pages[0], 'image/svg+xml').documentElement;
  const lines = [];
  const walk = (el, d) => { const n = el.querySelectorAll('*').length; lines.push('  '.repeat(d) + el.localName + '.' + (el.getAttribute('class')||'') + ' ' + n); if (d < 5 && n > 300) for (const c of el.children) walk(c, d+1); };
  walk(svg, 0);
  return { len: r.pages[0].length, lines: lines.slice(0, 70), pages: r.pages.length };
}, orchestral(30, 8));
console.log(out.len, out.pages); console.log(out.lines.join('\n'));
await browser.close(); await server.close(); process.exit(0);
