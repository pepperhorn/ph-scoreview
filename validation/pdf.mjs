// T1 spike: exercise the real dedicated worker through a dynamic import. No UI or PDF composer yet.
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium, firefox, webkit } from 'playwright-core';
import { root } from './serve-dist.mjs';

const server = await createServer({ configFile: false, root, server: { host: '127.0.0.1', port: 0 },
  plugins: [{ name: 'pdf-spike-page', configureServer(server) {
    server.middlewares.use('/pdf-spike', (_req, res) => { res.setHeader('Content-Type','text/html'); res.end('<!doctype html><title>PDF spike</title>'); });
  } }] });
await server.listen();
const engine = process.env.BROWSER || 'chromium';
const browser = await ({ chromium, firefox, webkit }[engine]).launch({ headless: true, ...(engine === 'chromium' ? { args: ['--no-sandbox'] } : {}) });
try {
  const page = await browser.newPage();
  page.on('console', msg => console.log('browser:', msg.text()));
  page.on('pageerror', error => console.log('browser error:', error.message));
  page.on('requestfailed', req => console.log('request failed:', req.url(), req.failure()));
  page.setDefaultTimeout(60000);
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/pdf-spike`);
  const result = await page.evaluate(async () => {
    const { engravePages } = await import('/packages/pepperscore/src/lib/pdf/engrave.ts');
    const files = { module: new URL('/node_modules/verovio/dist/verovio-module.mjs', location.href).href,
      toolkit: new URL('/node_modules/verovio/dist/verovio.mjs', location.href).href };
    const fixture = (bars, staves = 1) => `<mei xmlns="http://www.music-encoding.org/ns/mei" meiversion="5.0"><meiHead><fileDesc><titleStmt><title>PDF fixture</title></titleStmt><pubStmt/></fileDesc></meiHead><music><body><mdiv><score><scoreDef meter.count="4" meter.unit="4"><staffGrp>${Array.from({length:staves},(_,s)=>`<staffDef n="${s+1}" lines="5" clef.shape="G" clef.line="2"/>`).join('')}</staffGrp></scoreDef><section>${bars.map((notes,i)=>`<measure xml:id="bar${i}" n="${i+1}">${Array.from({length:staves},(_,s)=>`<staff n="${s+1}"><layer n="1">${Array.from({length:notes},(_,j)=>`<note pname="${['c','d','e','f','g','a','b'][j%7]}" oct="4" dur="${notes === 40 ? 32 : notes}"/>`).join('')}</layer></staff>`).join('')}</measure>`).join('')}</section></score></mdiv></body></music></mei>`;
    const run = (data, paper='a4',maxBars=4,view) => engravePages({data,view},{paper,maxBars,files},new AbortController().signal);
    const counts = [4,4,4,4,40,4,4,4,4,4,4,4,4];
    const data = fixture(counts);
    console.log('Starting A4');
    const a4 = await run(data); console.log('A4 done');
    const a3 = await run(data,'a3'); console.log('A3 done');
    const parse = result => result.pages.map(svg => {
      const doc = new DOMParser().parseFromString(svg,'image/svg+xml');
      const vb = doc.documentElement.viewBox.baseVal;
      const element = document.importNode(doc.documentElement,true);
      document.body.append(element);
      const bounds = element.getBoundingClientRect();
      const inside = [...element.querySelectorAll('g.staff')].every(staff => {
        const box = staff.getBoundingClientRect();
        return box.left >= bounds.left-2 && box.right <= bounds.right+2 && box.top >= bounds.top-2 && box.bottom <= bounds.bottom+2;
      });
      element.remove();
      return {inside,width:vb.width,height:vb.height,systems:[...doc.querySelectorAll('g.system')].map(g=>g.querySelectorAll('g.measure').length)};
    });
    const many = await run(fixture(Array(80).fill(4)));
    const tall = await run(fixture([4,4],30));
    const single = await run(fixture([4]));
    const empty = await run(fixture([]));
    const pickup = await run(fixture([128,4,4,4,4]));
    const hidden = await run(fixture([4,4],2),'a4',4,{breakEvery:0,hiddenStaves:['2'],chordSymbols:false});
    const controller = new AbortController();
    const cancelled = engravePages({data},{paper:'a4',maxBars:4,files},controller.signal).then(()=>false,error=>error.name==='AbortError');
    controller.abort();
    const already = new AbortController(); already.abort();
    const preCancelled = await engravePages({data},{paper:'a4',maxBars:4,files},already.signal).then(()=>false,error=>error.name==='AbortError');
    return { a4:{lines:a4.lines,pages:parse(a4),shrunk:a4.shrunk},a3:{lines:a3.lines,pages:parse(a3)},
      many:{pages:parse(many),lines:many.lines},tall:{shrunk:tall.shrunk,pages:parse(tall)},
      single:single.pages.length,empty:empty.pages.length,pickup:{pages:parse(pickup),count:pickup.pages.length},
      hidden:hidden.pages.reduce((sum,svg)=>sum+new DOMParser().parseFromString(svg,'image/svg+xml').querySelectorAll('g.staff').length,0) === 2,cancelled:await cancelled,preCancelled };
  });
  console.log(JSON.stringify(result));
  assert.deepEqual(result.a4.lines.map(line=>line.count),[4,1,4,4], 'dense bar shortens only its own A4 line');
  assert.ok(result.a3.lines.length <= result.a4.lines.length,'A3 never needs more lines');
  assert.equal(result.a4.shrunk,false);
  assert.ok(result.many.pages.length > 1,'real page height paginates');
  assert.equal(result.many.pages.flatMap(p=>p.systems).reduce((a,b)=>a+b,0),80,'all measures survive pagination');
  assert.ok([...result.a4.pages,...result.a3.pages,...result.many.pages,...result.tall.pages].every(p=>p.inside),'staves fit inside every page');
  assert.equal(result.tall.shrunk,true,'over-height system triggers documented scale fallback');
  assert.equal(result.single,1); assert.equal(result.empty,1); assert.ok(result.pickup.count>=1);
  assert.equal(result.cancelled,true); assert.equal(result.preCancelled,true); assert.equal(result.hidden,true);
  console.log(`PDF page model spike passed (${engine}): A4 ${result.a4.lines.length} lines; A3 ${result.a3.lines.length}; ${result.many.pages.length} pages for 80 bars.`);
} finally { await browser.close(); await server.close(); }
