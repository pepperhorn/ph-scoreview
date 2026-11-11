import { createServer } from 'vite';
import { chromium, firefox, webkit } from 'playwright-core';
import { root } from '../serve-dist.mjs';
import { orchestral } from '../synthetic.mjs';
const measures = Number(process.argv[2] || 150), parts = Number(process.argv[3] || 30);
const server = await createServer({ configFile: false, root, optimizeDeps: { include: ['jspdf', 'svg2pdf.js', 'abcjs', '@tonejs/midi', 'fflate'] }, server: { host: '127.0.0.1', port: 0 },
  plugins: [{ name: 'p', configureServer(s) { s.middlewares.use('/pdf-spike', (_q, r) => { r.setHeader('Content-Type','text/html'); r.end('<!doctype html><title>x</title>'); }); } }] });
await server.listen();
const engine = process.env.BROWSER || 'chromium';
const browser = await ({ chromium, firefox, webkit }[engine]).launch({ headless: true, ...(engine === 'chromium' ? { args: ['--no-sandbox'] } : {}) });
const page = await browser.newPage(); page.setDefaultTimeout(600000);
page.on('console', m => console.log('browser:', m.text()));
await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/pdf-spike`);
const xml = orchestral(parts, measures);
const out = await page.evaluate(async xml => {
  const { parseMusicXml } = await import('/packages/pepperscore/src/lib/import.ts');
  const { exportScore } = await import('/packages/pepperscore/src/lib/pdf/export.ts');
  const files = { module: new URL('/node_modules/verovio/dist/verovio-module.mjs', location.href).href, toolkit: new URL('/node_modules/verovio/dist/verovio.mjs', location.href).href };
  const t0 = performance.now();
  const score = parseMusicXml(xml);
  const parseMs = performance.now() - t0;
  let last = performance.now(), maxGap = 0; const gaps = [];
  const beat = setInterval(() => { const now = performance.now(); const gap = now - last; if (gap > maxGap) maxGap = gap; last = now; }, 10);
  const longTasks = []; try { new PerformanceObserver(l => l.getEntries().forEach(e => longTasks.push(e.duration))).observe({ entryTypes: ['longtask'] }); } catch {}
  const start = performance.now();
  const blob = await exportScore({ input: { data: score.document.engravingText }, options: { paper: 'a4', maxBars: 4, files }, score, annotations: { showNames: true, showCounts: true } }, new AbortController().signal);
  const total = performance.now() - start;
  clearInterval(beat);
  return { parseMs, total, maxGap, longTasks, bytes: blob.size, parts: score.parts.length };
}, xml);
console.log(engine, JSON.stringify(out));
await browser.close(); await server.close(); process.exit(0);
