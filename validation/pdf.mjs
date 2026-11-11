// Exercise the isolated engraving worker and vector PDF composer through dynamic imports.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../packages/pepperscore/package.json', import.meta.url));
const { PDFDocument, PDFName, decodePDFRawStream } = require('pdf-lib');
import { createServer } from 'vite';
import { chromium, firefox, webkit } from 'playwright-core';
import { root, serveDist } from './serve-dist.mjs';

// Raster parity is a required gate, including on CI. Fail before starting Vite/browser.
try { execFileSync('pdftoppm', ['-v'], { stdio: 'pipe' }); }
catch (error) {
  if (error.code === 'ENOENT') {
    throw new Error('Poppler required for pitch raster parity: install poppler-utils (pdftoppm).');
  }
  throw error;
}

const server = await createServer({ configFile: false, root, optimizeDeps: { include: ['jspdf', 'svg2pdf.js', 'abcjs', '@tonejs/midi', 'fflate'] }, server: { host: '127.0.0.1', port: 0 },
  plugins: [{ name: 'pdf-spike-page', configureServer(server) {
    server.middlewares.use('/pdf-spike', (_req, res) => { res.setHeader('Content-Type','text/html'); res.end('<!doctype html><title>PDF spike</title>'); });
  } }] });
await server.listen();
const engine = process.env.BROWSER || 'chromium';
const browser = await ({ chromium, firefox, webkit }[engine]).launch({ headless: true, ...(engine === 'chromium' ? { args: ['--no-sandbox'] } : {}) });
try {
  await assertPdfOverlay(browser);
  if (process.env.PDF_OVERLAY_ONLY) { await browser.close(); await server.close(); process.exit(0); }
  const page = await browser.newPage();
  page.on('console', msg => console.log('browser:', msg.text()));
  page.on('pageerror', error => console.log('browser error:', error.message));
  page.on('requestfailed', req => console.log('request failed:', req.url(), req.failure()));
  page.setDefaultTimeout(60000);
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/pdf-spike`);
  await page.addStyleTag({content:readFileSync(join(root,'packages/pepperscore/dist/style.css'),'utf8').replace(/@import[^;]+;/g,'')});
  await assertPitchRasterParity(browser,page.url());
  if (!process.env.PITCH_PARITY_ONLY) {
  const composition = await page.evaluate(async () => {
    const { composePdf } = await import('/packages/pepperscore/src/lib/pdf/compose.ts');
    const { exportScore } = await import('/packages/pepperscore/src/lib/pdf/export.ts');
    const { parseAbc } = await import('/packages/pepperscore/src/lib/import.ts');
    const signal = new AbortController().signal;
    // Real-page unit ratio: 10 SVG units/mm, plus a half-scale presentation-attribute case.
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2100 2970"><text x="120" y="200" font-size="50">PDF fixture</text><g class="notehead" fill="#f04a38" stroke="#000000" stroke-width="0.4"><circle cx="230" cy="330" r="16"/><path d="M 500 300 L 550 300 L 550 340 Z"/></g><text x="230" y="330" style="font-family:Poppins,sans-serif;font-weight:600;font-size:20px;fill:white;stroke:rgba(0,0,0,0.35);stroke-width:3;paint-order:stroke;text-anchor:middle;dominant-baseline:central">C</text><g transform="translate(300 0) scale(0.5)"><circle cx="460" cy="660" r="16" fill="#f04a38"/><text x="460" y="660" font-family="Poppins" font-weight="600" font-size="20" fill="white" stroke="rgba(0,0,0,0.35)" stroke-width="3" paint-order="stroke" text-anchor="middle" dominant-baseline="central">G</text></g></svg>';
    const files = [];
    for (const paper of ['a4','a3','letter','legal']) {
      const blob = await composePdf([svg,svg], {paper,title:'PDF fixture'}, signal);
      files.push({paper,bytes:Array.from(new Uint8Array(await blob.arrayBuffer()))});
    }
    const abc = 'X:1\nT:Export title\nC:Composer\nM:4/4\nL:1/4\nK:C\n' + Array(80).fill('[CEG] D E F |').join(' ');
    const score = await parseAbc(abc);
    const runtime = { module: new URL('/node_modules/verovio/dist/verovio-module.mjs', location.href).href, toolkit: new URL('/node_modules/verovio/dist/verovio.mjs', location.href).href };
    const blob = await exportScore({ input:{data:score.document.engravingText}, options:{paper:'a4',maxBars:4,files:runtime},score,annotations:{showNames:true,showCounts:true,showChordSymbols:true,inferChordSymbols:true} }, signal);
    const accidentalScore = await parseAbc('X:1\nT:Accidentals\nM:4/4\nL:1/4\nK:C\n[^FA^c] [_Bdf] [DFA]4 |');
    const accidentalBlob = await exportScore({input:{data:accidentalScore.document.engravingText},score:accidentalScore,options:{paper:'a4',maxBars:4,files:runtime},annotations:{showChordSymbols:true,inferChordSymbols:true}},signal);
    const { engravePages } = await import('/packages/pepperscore/src/lib/pdf/engrave.ts');
    const { annotationBox, annotationLayout } = await import('/packages/pepperscore/src/lib/render.ts');
    const geometryScore = await parseAbc('X:1\nT:Geometry\nM:4/4\nL:1/4\nK:C\n' + Array(8).fill('G A B c |').join(' '));
    geometryScore.title = '';
    const geometrySettings = {showNames:true,showCounts:true};
    const layout = annotationLayout(geometryScore.parts,geometrySettings);
    const geometryInput = {data:geometryScore.document.engravingText};
    const geometryOptions = {paper:'a4',maxBars:4,files:runtime};
    const geometryBlob = await exportScore({input:geometryInput,score:geometryScore,options:geometryOptions,annotations:geometrySettings},signal);
    const engraved = await engravePages(geometryInput,{...geometryOptions,spacingStaff:layout.spacingStaff,annotationRoom:layout.laneHeight},signal);
    const geometrySvg = new DOMParser().parseFromString(engraved.pages[0],'image/svg+xml').documentElement;
    document.body.appendChild(geometrySvg);
    const { annotatePage: paintAnnotations } = await import('/packages/pepperscore/src/lib/pdf/annotations.ts');
    paintAnnotations(geometrySvg,geometryScore,geometrySettings);
    const mm = 210 / geometrySvg.viewBox.baseVal.width;
    const rect = element => { const b=annotationBox(element,geometrySvg); return {x:b.x*mm,y:b.y*mm,width:b.width*mm,height:b.height*mm}; };
    const expected = {lines:Array.from(geometrySvg.querySelectorAll('g.staff > path')).slice(0,5).map(rect),head:rect(geometrySvg.querySelector('.notehead')),label:rect(geometrySvg.querySelector('.note-label'))};
    geometrySvg.remove();
    const { CRF_PITCH_COLOURS } = await import('/packages/pepperscore/src/lib/skin.ts');
    const { pitchColourStyle, resolvePitchColours } = await import('/packages/pepperscore/src/lib/pitch-colours.ts');
    const { renderScore } = await import('/packages/pepperscore/src/lib/render.ts');
    const pitchScore = await parseAbc('X:1\nM:4/4\nL:1/4\nK:C\n[CE] D F G |'); pitchScore.title='';
    const reader = document.createElement('div');reader.className='pepperscore';reader.setAttribute('data-ps-pitch-colours','');
    Object.entries(pitchColourStyle(CRF_PITCH_COLOURS)).forEach(([k,v])=>reader.style.setProperty(k,v));
    const canvas=document.createElement('div');canvas.style.width='1000px';reader.append(canvas);document.body.append(reader);
    const {setVerovioBaseUrl}=await import('/packages/pepperscore/src/lib/verovio-runtime.ts');setVerovioBaseUrl('/node_modules/verovio/dist/');
    const screen=await renderScore(canvas,pitchScore,'portrait',false,false,false,4,false,false,700,1);
    const screenColours=Array.from(canvas.querySelectorAll('.notehead[data-pitch]'),head=>({pitch:head.dataset.pitch,fill:getComputedStyle(head).fill,stroke:getComputedStyle(head).stroke}));
    const pitchPaint=resolvePitchColours(reader);
    screen.dispose();reader.remove();
    const pitchBlob=await exportScore({input:{data:pitchScore.document.engravingText},score:pitchScore,options:geometryOptions,pitchColours:pitchPaint},signal);
    const pitchPages=await engravePages({data:pitchScore.document.engravingText},geometryOptions,signal);
    const pitchSvg=new DOMParser().parseFromString(pitchPages.pages[0],'image/svg+xml').documentElement;document.body.append(pitchSvg);
    const {paintPitchColours}=await import('/packages/pepperscore/src/lib/pdf/annotations.ts');paintPitchColours(pitchSvg,pitchScore,pitchPaint);
    // ABC has no per-pitch source ids and preserves source order. Explicit identities,
    // when supplied (e.g. MusicXML/MEI), must win over array order.
    const {tagPitchColours}=await import('/packages/pepperscore/src/lib/pitch-colours.ts');
    const firstEvent=pitchScore.parts[0].measures[0].notes[0];
    const chord=pitchSvg.querySelector('.chord');const before=Array.from(chord.querySelectorAll('.notehead'),h=>h.dataset.pitch);
    const identified=firstEvent.pitches.map((pitch,index)=>({...pitch,sourceId:chord.querySelectorAll('.notehead')[index].closest('.note').id}));
    tagPitchColours(chord,{...firstEvent,pitches:identified.reverse()},pitchScore.parts[0]);
    if(JSON.stringify(before)!==JSON.stringify(Array.from(chord.querySelectorAll('.notehead'),h=>h.dataset.pitch)))throw Error('Chord source identities lost');
    for(const kind of ['percussion','tab']){
      const clone=chord.cloneNode(true);clone.querySelectorAll('[data-pitch]').forEach(h=>h.removeAttribute('data-pitch'));
      tagPitchColours(clone,firstEvent,{clef:kind});if(clone.querySelector('[data-pitch]'))throw Error(kind+' must remain uncoloured');
    }
    const pitchRatio=210/pitchSvg.viewBox.baseVal.width;
    const pitchHeads=Array.from(pitchSvg.querySelectorAll('.notehead[data-pitch]'),head=>{const b=annotationBox(head,pitchSvg);return {pitch:head.dataset.pitch,fill:getComputedStyle(head).fill,stroke:getComputedStyle(head).stroke,box:{x:b.x*pitchRatio,y:b.y*pitchRatio,width:b.width*pitchRatio,height:b.height*pitchRatio}};});
    pitchSvg.remove();

    const { scoreForView } = await import('/packages/pepperscore/src/lib/transpose.ts');
    const { planStaves } = await import('/packages/pepperscore/src/lib/render.ts');
    const { scanBaseline } = await import('/packages/pepperscore/src/lib/notation/mei-view.ts');
    const twoParts = await parseAbc('X:1\nT:View snapshot\nM:4/4\nL:1/4\n%%score (one two)\nV:one clef=treble\nV:two clef=bass\nK:C\n[V:one] [CEG]4 |\n[V:two] C,4 |\nw: Hiddenword');
    const viewScore = scoreForView(twoParts, 'written', 2);
    const plan = planStaves(scanBaseline(twoParts.document.engravingText),viewScore,new Set([viewScore.parts[1].id]));
    const viewBlob = await exportScore({input:{data:twoParts.document.engravingText,view:{breakEvery:0,hiddenStaves:plan.hiddenStaves,chordSymbols:true,spelling:plan.spelling}},score:viewScore,tabStaves:plan.tabStaves,options:{paper:'a4',maxBars:4,files:runtime},annotations:{showNames:true,showCounts:true,inferChordSymbols:true,showChordSymbols:true}},signal);
    const { annotatePage } = await import('/packages/pepperscore/src/lib/pdf/annotations.ts');
    const tabSvg = new DOMParser().parseFromString('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><g class="system"><g class="measure"><g class="staff" data-n="1"><path d="M 10 20 L 190 20"/><path d="M 10 30 L 190 30"/><path d="M 10 40 L 190 40"/><path d="M 10 50 L 190 50"/><path d="M 10 60 L 190 60"/><path d="M 10 70 L 190 70"/><g class="tabGrp" id="imported-tab"><rect x="30" y="20" width="10" height="10"/></g></g><g class="staff" data-n="2"><path d="M 10 100 L 190 100"/></g><g class="dir"><rect x="50" y="72" width="5" height="5"/></g></g></g></svg>','image/svg+xml').documentElement;
    document.body.appendChild(tabSvg);
    const event = twoParts.parts[0].measures[0].notes[0];
    annotatePage(tabSvg,twoParts,{showNames:true},undefined,new Map([[event.id,{...event,id:'imported-tab',sourceId:'imported-tab',pitches:[]}]]),new Set(['1']));
    const tabAliasWorked = tabSvg.querySelectorAll('.note-label').length === event.pitches.length;
    const tabLaneWorked = tabSvg.querySelector('.note-label').getAttribute('y') === '96.0';
    tabSvg.remove();
    let unsupported = false;
    try { await composePdf([svg.replace('PDF fixture','漢字')],{paper:'a4'},signal); } catch (error) { unsupported = error.message.includes('no glyph'); }
    const cancelled = new AbortController(); cancelled.abort();
    let aborted = false;
    try { await composePdf([svg],{paper:'a4'},cancelled.signal); } catch (error) { aborted = error.name === 'AbortError'; }
    return {pitch:{bytes:Array.from(new Uint8Array(await pitchBlob.arrayBuffer())),heads:pitchHeads,screen:screenColours,ratio:pitchRatio},files,tabLaneWorked,geometry:{bytes:Array.from(new Uint8Array(await geometryBlob.arrayBuffer())),expected},accidentals:Array.from(new Uint8Array(await accidentalBlob.arrayBuffer())),tabAliasWorked,viewed:Array.from(new Uint8Array(await viewBlob.arrayBuffer())),exported:Array.from(new Uint8Array(await blob.arrayBuffer())),unsupported,aborted};
  });
  if (process.env.PDF_ARTIFACTS) {
    mkdirSync(process.env.PDF_ARTIFACTS,{recursive:true});
    writeFileSync(join(process.env.PDF_ARTIFACTS,'composition.json'),JSON.stringify(composition));
    writeFileSync(join(process.env.PDF_ARTIFACTS,'geometry.pdf'),Buffer.from(composition.geometry.bytes));
    writeFileSync(join(process.env.PDF_ARTIFACTS,'house.pdf'),Buffer.from(composition.files[0].bytes));
  }
  const multiply = (a,b) => [a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];
  const parsePdf = async bytes => {
    const doc = await PDFDocument.load(Uint8Array.from(bytes));
    const texts = [], operators = [], runs = [], segments = [], curves = [], forms = [];
    for (const page of doc.getPages()) {
      const fonts = page.node.Resources().lookup(PDFName.of('Font')), mappings = new Map(), fontNames = new Map(), semibold = new Map();
      for (const key of fonts.keys()) {
        const font = fonts.lookup(key), unicode = font.lookup(PDFName.of('ToUnicode')), mapping = new Map();
        fontNames.set(key.asString().slice(1),font.get(PDFName.of('BaseFont')).asString());
        if (unicode) {
          const descendant = font.lookup(PDFName.of('DescendantFonts')).lookup(0);
          const fontFile=descendant.lookup(PDFName.of('FontDescriptor')).lookup(PDFName.of('FontFile2'));
          assert.ok(fontFile, 'TrueType font is embedded');
          semibold.set(key.asString().slice(1),Buffer.from(decodePDFRawStream(fontFile).decode()).includes(Buffer.from('Poppins-SemiBold','utf16le').swap16()));
          const cmap = new TextDecoder().decode(decodePDFRawStream(unicode).decode());
          for (const match of cmap.matchAll(/<([0-9a-f]{4})>\s*<([0-9a-f]{4})>/gi)) mapping.set(match[1].toLowerCase(),String.fromCharCode(parseInt(match[2],16)));
          mappings.set(key.asString().slice(1),mapping);
        }
      }
      const contents = page.node.Contents();
      const streams = typeof contents.size === 'function' ? Array.from({length:contents.size()},(_,i)=>contents.lookup(i)) : [contents];
      let state = {ctm:[1,0,0,1,0,0],font:'',size:0,tm:[1,0,0,1,0,0],mode:0,gs:'',fill:'',stroke:'',width:0}, stack=[], point;
      for (const content of streams) {
        const stream = new TextDecoder().decode(decodePDFRawStream(content).decode()); operators.push(stream);
        for (const line of stream.split('\n').map(line=>line.trim())) {
          const parts = line.split(/\s+/), op=parts.at(-1), numbers=parts.slice(0,-1).map(Number);
          if (op==='q') stack.push({...state,ctm:[...state.ctm]});
          if (op==='Q') state=stack.pop()||state;
          if (op==='cm') state.ctm=multiply(state.ctm,numbers);
          if (op==='Tf') {state.font=parts[0].slice(1);state.size=numbers[1];}
          if (op==='Tm') state.tm=numbers;
          if (op==='Tr') state.mode=numbers[0];
          if (op==='gs') state.gs=parts[0].slice(1);
          if (['rg','g'].includes(op)) state.fill=line;
          if (['RG','G'].includes(op)) state.stroke=line;
          if (op==='w') state.width=numbers[0];
          const transform = ([x,y]) => [state.ctm[0]*x+state.ctm[2]*y+state.ctm[4],state.ctm[1]*x+state.ctm[3]*y+state.ctm[5]];
          if (op==='m') point=transform(numbers);
          if (op==='Do') {
            const form=page.node.Resources().lookup(PDFName.of('XObject')).lookup(PDFName.of(parts[0].slice(1)));
            const bbox=form.dict.lookup(PDFName.of('BBox')).asArray().map(value=>value.asNumber());
            const matrixEntry=form.dict.lookup(PDFName.of('Matrix'));
            const matrix=multiply(state.ctm,matrixEntry ? matrixEntry.asArray().map(value=>value.asNumber()) : [1,0,0,1,0,0]);
            const corners=[[bbox[0],bbox[1]],[bbox[2],bbox[3]]].map(([x,y])=>[matrix[0]*x+matrix[2]*y+matrix[4],matrix[1]*x+matrix[3]*y+matrix[5]]);
            forms.push(corners);
            let local=matrix, saved=[], start;
            for (const command of new TextDecoder().decode(decodePDFRawStream(form).decode()).split('\n')) {
              const tokens=command.trim().split(/\s+/), operation=tokens.at(-1), values=tokens.slice(0,-1).map(Number);
              if(operation==='q') saved.push(local);
              if(operation==='Q') local=saved.pop()||local;
              if(operation==='cm') local=multiply(local,values);
              const map=([x,y])=>[local[0]*x+local[2]*y+local[4],local[1]*x+local[3]*y+local[5]];
              if(operation==='m') start=map(values);
              if(operation==='c') {const points=[start,...[0,2,4].map(i=>map(values.slice(i,i+2)))].filter(Boolean);curves.push(points);start=points.at(-1);}
            }
          }
          if (op==='c') {const points=[point,...[0,2,4].map(index=>transform(numbers.slice(index,index+2)))].filter(Boolean);curves.push(points);point=points.at(-1);}
          if (op==='l') {const end=transform(numbers);if(point) segments.push({from:point,to:end});point=end;}
          if (op==='Tj') {
            assert.ok(mappings.has(state.font),`used text font ${state.font} is embedded`);
            const match=/<([0-9a-f]+)>\s*Tj/i.exec(line);
            if (!match) continue;
            assert.ok(mappings.has(state.font),`used text font ${state.font} is embedded`);
            const text=(match[1].match(/.{4}/g)||[]).map(code=>mappings.get(state.font).get(code.toLowerCase())||'').join('');
            texts.push(text); runs.push({...state,text,semibold:semibold.get(state.font),fontName:fontNames.get(state.font),matrix:multiply(state.ctm,state.tm)});
          }
        }
      }
    }
    return {doc,text:texts.join(' '),operators:operators.join('\n'),runs,segments,curves,forms};
  };
  for (const file of composition.files) {
    const parsed = await parsePdf(file.bytes);
    assert.equal(parsed.doc.getPageCount(),2);
    const size = {a4:[210,297],a3:[297,420],letter:[215.9,279.4],legal:[215.9,355.6]}[file.paper];
    for (const page of parsed.doc.getPages()) {
      assert.ok(Math.abs(page.getWidth()*25.4/72-size[0])<0.001);
      assert.ok(Math.abs(page.getHeight()*25.4/72-size[1])<0.001);
    }
    assert.ok(parsed.text.includes('PDF fixture'), 'selectable title from embedded font');
    assert.match(parsed.operators,/0\.94[0-9]* 0\.29[0-9]* 0\.22[0-9]* rg/, 'RGB pitch fill survives composition');
    assert.match(parsed.operators,/ l/, 'vector paths survive composition');
  }
  const exported = await parsePdf(composition.exported);
  assert.ok(exported.doc.getPageCount()>1);
  assert.ok(exported.text.includes('Export title') && exported.text.includes('Composer'));
  assert.match(exported.text, /G E C 1 C D 2 E 3 F 4/, 'complete note-name and beat sequence, independent of metadata/page numbers');
  const accidentalPdf = await parsePdf(composition.accidentals);
  assert.match(accidentalPdf.text.replace(/ /g,''),/F♯m.*B♭/, 'inferred sharp and flat chord runs remain selectable');
  const house = (await parsePdf(composition.files[0].bytes)).runs.filter(run=>run.text==='C').slice(0,3);
  assert.equal(house.length,3,'house note text has three passes');
  assert.deepEqual(house.map(run=>run.mode),[1,1,0],'stroke-only outline and shadow, then solid fill');
  // The checked-in Poppins SemiBold C and G advance by 768/1000 em.
  const knownAdvance=0.768;
  assert.ok(house.every(run=>run.fontName.includes('Poppins') && run.semibold && run.size===house[0].size), 'all passes use embedded Poppins SemiBold at identical size');
  assert.deepEqual(house[0].matrix,house[2].matrix,'outline/fill share exactly one text matrix');
  assert.ok(Math.abs(house[1].matrix[4]-house[2].matrix[4])<0.001);
  const mmPerPoint=25.4/72;
  const checkPaintScale = (passes, expectedScale, centerX) => {
    assert.equal(passes.length,3);
    const fill=passes[2], outline=passes[0], shadow=passes[1];
    const glyphScale=Math.hypot(fill.matrix[0],fill.matrix[1])*mmPerPoint;
    assert.ok(Math.abs(glyphScale-expectedScale)<0.0001,'text follows page and element SVG scales');
    const strokeMM=run=>run.width*Math.hypot(run.ctm[0],run.ctm[1])*mmPerPoint;
    assert.ok(Math.abs(strokeMM(outline)-3*glyphScale)<0.001,'effective outline is 3 SVG units in page mm');
    assert.ok(Math.abs(strokeMM(shadow)-3*glyphScale)<0.001,'shadow stroke follows glyph scale');
    assert.ok(Math.abs(strokeMM(outline)/(fill.size*glyphScale)-3/20)<0.001,'outline/glyph-em ratio stays 3/20');
    const shadowMM=Math.hypot(shadow.matrix[4]-fill.matrix[4],shadow.matrix[5]-fill.matrix[5])*mmPerPoint;
    assert.ok(Math.abs(shadowMM-0.5*glyphScale)<0.001,'shadow displacement is 0.5 SVG units in page mm');
    assert.ok(Math.abs((fill.matrix[4]+fill.matrix[0]*fill.size*knownAdvance/2)*mmPerPoint-centerX)<0.01,'glyph advance remains centred');
    assert.ok(passes.every(run=>run.semibold && run.size===20),'all scaled passes retain embedded SemiBold');
    assert.deepEqual(outline.matrix,fill.matrix);
  };
  checkPaintScale(house,0.1,23);
  const housePdf=await parsePdf(composition.files[0].bytes);
  checkPaintScale(housePdf.runs.filter(run=>run.text==='G').slice(0,3),0.05,53);
  assert.ok(Math.abs(297-house[2].matrix[5]*mmPerPoint-33.75)<0.1,'central baseline offset follows the non-unit SVG scale');
  assert.match(house[2].fill,/1[.0]* g|1[.0]* 1[.0]* 1[.0]* rg/,'solid white fill');
  const houseResources=housePdf.doc.getPages()[0].node.Resources();
  const outlineGs=houseResources.lookup(PDFName.of('ExtGState')).lookup(PDFName.of(house[0].gs));
  assert.ok(Math.abs(outlineGs.lookup(PDFName.of('CA')).asNumber()-0.35)<0.001,'outline alpha is 35%');
  const rootRun=accidentalPdf.runs.find(run=>run.text==='F');
  const sharpRun=accidentalPdf.runs.find(run=>run.text==='♯');
  const suffixRun=accidentalPdf.runs.find(run=>run.text==='m');
  assert.ok(Math.abs(sharpRun.size/rootRun.size-1.4)<0.01,'inferred accidentals are full-height at 1.4x');
  assert.ok(sharpRun.matrix[5]>rootRun.matrix[5],'inferred accidental is raised');
  assert.ok(Math.abs(suffixRun.matrix[5]-rootRun.matrix[5])<0.01,'following chord suffix returns to its baseline');
  const geometry=await parsePdf(composition.geometry.bytes), expected=composition.geometry.expected;
  const staffSegments=geometry.segments.filter(segment=>Math.abs(segment.from[1]-segment.to[1])<0.01 && Math.abs(segment.to[0]-segment.from[0])*mmPerPoint>10 && 297-segment.from[1]*mmPerPoint>=expected.lines[0].y-0.1 && 297-segment.from[1]*mmPerPoint<=expected.lines[4].y+0.1);
  assert.ok(staffSegments.length>=5,'PDF contains full-size horizontal staff paths');
  const staffYs=[...new Set(staffSegments.map(segment=>Math.round(segment.from[1]*mmPerPoint*100)/100))].sort((a,b)=>a-b);
  assert.ok(Math.abs(staffYs[4]-staffYs[0]-6.5)<0.1,'PDF staff is physically 6.5 mm tall');
  const left=Math.min(...staffSegments.flatMap(segment=>[segment.from[0],segment.to[0]]))*mmPerPoint;
  const right=Math.max(...staffSegments.flatMap(segment=>[segment.from[0],segment.to[0]]))*mmPerPoint;
  assert.ok(left>=11.8 && left<=12.3 && right>195 && right<=198.3,`staff spans printable page: ${left}–${right} mm`);
  const headPoints=geometry.curves.flat().map(([x,y])=>[x*mmPerPoint,297-y*mmPerPoint]).filter(([x,y])=>x>=expected.head.x-0.3 && x<=expected.head.x+expected.head.width+0.3 && y>=expected.head.y-0.3 && y<=expected.head.y+expected.head.height+0.3);
  assert.ok(headPoints.length>=4,'known notehead drawing occupies their expected content coordinates');
  assert.ok(Math.abs(Math.max(...headPoints.map(p=>p[0]))-Math.min(...headPoints.map(p=>p[0]))-expected.head.width)<0.15,'known notehead retains expected physical width');
  assert.ok(Math.abs(Math.max(...headPoints.map(p=>p[1]))-Math.min(...headPoints.map(p=>p[1]))-expected.head.height)<0.15,'known notehead retains expected physical height');
  const nameRun=geometry.runs.find(run=>run.text==='G' && run.semibold);
  assert.ok(nameRun,'first note name has its own embedded text run');
  const nameX=(nameRun.matrix[4]+nameRun.matrix[0]*nameRun.size*knownAdvance/2)*mmPerPoint;
  // The raster below checks glyph ink; the portable fallback also checks label baseline
  // below the matching note and a text origin within one glyph width of its centre.
  assert.ok(297-nameRun.matrix[5]*mmPerPoint>expected.head.y+expected.head.height);
  assert.ok(Math.abs(nameX-expected.head.x-expected.head.width/2)<0.1,'name remains under its own note');
  // Raster geometry supplements the content-stream checks; Poppler was required up front.
  assert.notEqual(composition.pitch.ratio,1);

  const directory=mkdtempSync(join(tmpdir(),'pepperscore-pdf-r1-'));
  try {
    const input=join(directory,'geometry.pdf');writeFileSync(input,Buffer.from(composition.geometry.bytes));
    execFileSync('pdftoppm',['-f','1','-singlefile','-r','144',input,join(directory,'page')],{stdio:'pipe'});
    const ppm=readFileSync(join(directory,'page.ppm'));
    const header=/^P6\s+(\d+)\s+(\d+)\s+255\s/.exec(ppm.subarray(0,80).toString());assert.ok(header);
    const width=Number(header[1]),height=Number(header[2]),pixels=ppm.subarray(header[0].length),scale=144/25.4;
    const ink=(x,y)=>{const i=(y*width+x)*3;return pixels[i]<180||pixels[i+1]<180||pixels[i+2]<180;};
    const coverage=box=>{let count=0,total=0;for(let y=Math.max(0,Math.floor(box.y*scale));y<Math.min(height,Math.ceil((box.y+box.height)*scale));y++)for(let x=Math.max(0,Math.floor(box.x*scale));x<Math.min(width,Math.ceil((box.x+box.width)*scale));x++){total++;if(ink(x,y))count++;}return count/Math.max(1,total);};
    for (const line of expected.lines) assert.ok(coverage({x:line.x,y:line.y-0.2,width:186,height:0.4})>0.12,'raster staff line occupies expected content coordinates');
    assert.ok(coverage(expected.head)>0.2,'known notehead is present at full size');
    assert.ok(coverage(expected.label)>0.03,'note name is under its own note in the raster');
    assert.ok(expected.label.y>expected.head.y && Math.abs(expected.label.x+expected.label.width/2-expected.head.x-expected.head.width/2)<0.1,'name is centred below its note');
    console.log('Poppler raster: staff width/6.5 mm height, known notehead and aligned note-name ink passed.');
  } finally {rmSync(directory,{recursive:true,force:true});}
  const viewed = await parsePdf(composition.viewed);
  assert.ok(viewed.text.includes('D') && viewed.text.includes('F') && viewed.text.includes('A'), 'annotation pitches follow transposed snapshot');
  assert.ok(!viewed.text.includes('Hiddenword'), 'hidden part lyrics are excluded');
  assert.equal(composition.unsupported,true); assert.equal(composition.aborted,true); assert.equal(composition.tabAliasWorked,true); assert.equal(composition.tabLaneWorked,true,'sixth TAB line and below-staff direction determine the lane');
  console.log('Vector composition passed: four exact paper sizes, embedded/selectable text, RGB paths, multipage annotated export, unsupported glyph error, cancellation.');
  if (!process.env.PDF_COMPOSITION_ONLY) {
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
    // Reviewer r1 regressions. Independently lay out the returned plan without justification:
    // checking the final, justified SVG cannot reveal Verovio's silent spacing compression.
    const { buildViewMei } = await import('/packages/pepperscore/src/lib/notation/mei-view.ts');
    const { pageGeometry } = await import('/packages/pepperscore/src/lib/pdf/paper.ts');
    const [wasm, api] = await Promise.all([import(files.module),import(files.toolkit)]);
    const module = await wasm.default(); api.enableLogToBuffer(1,module);
    const toolkit = new api.VerovioToolkit(module);
    const head = '<mei xmlns="http://www.music-encoding.org/ns/mei" meiversion="5.0"><meiHead><fileDesc><titleStmt><title>t</title></titleStmt><pubStmt/></fileDesc></meiHead><music><body><mdiv><score>';
    const P = ['c','d','e','f','g','a','b'];
    const notes = (n, dur, acc) => Array.from({ length: n }, (_, j) => `<note pname="${P[(j*3)%7]}" oct="${4 + (j%2)}" dur="${dur}"${acc ? ` accid="${['s','f','n','ss'][j%4]}"` : ''}/>`).join('');
    const mrestTop = `${head}<scoreDef meter.count="4" meter.unit="4"><staffGrp><staffDef n="1" lines="5" clef.shape="G" clef.line="2"/><staffDef n="2" lines="5" clef.shape="F" clef.line="4"/></staffGrp></scoreDef><section>${Array.from({length:24},(_,i)=>`<measure n="${i+1}"><staff n="1"><layer n="1"><mRest/></layer></staff><staff n="2"><layer n="1">${notes(16,16,true)}</layer></staff></measure>`).join('')}</section></score></mdiv></body></music></mei>`;
    const keyChanges = `${head}<scoreDef meter.count="4" meter.unit="4" key.sig="7s"><staffGrp><staffDef n="1" lines="5" clef.shape="G" clef.line="2"/></staffGrp></scoreDef><section>${Array.from({length:24},(_,i)=>`${i>0&&i%2===0?`<scoreDef key.sig="${i%4?'7f':'7s'}"/>`:''}<measure n="${i+1}"><staff n="1"><layer n="1">${notes(8,8)}</layer></staff></measure>`).join('')}</section></score></mdiv></body></music></mei>`;
    // r2: identical bars must not lose a bar on line 0 by counting its opening prefix twice.
    const uniformNotes = Array.from({length:8},(_,j)=>`<note pname="${P[(j*3)%7]}" oct="${4+(j%2)}" dur="8" accid="${['s','f','n'][j%3]}"/>`).join('');
    const uniform = `${head}<scoreDef meter.count="4" meter.unit="4"><staffGrp><staffDef n="1" lines="5" clef.shape="G" clef.line="2"/></staffGrp></scoreDef><section>${Array.from({length:16},(_,i)=>`<measure n="${i+1}"><staff n="1"><layer n="1">${uniformNotes}</layer></staff></measure>`).join('')}</section></score></mdiv></body></music></mei>`;
    const regressions = [];
    try {
      for (const [name,source] of [['mrestTop',mrestTop],['alternatingKeys',keyChanges],['uniform',uniform]]) {
        for (const paper of (name==='uniform' ? ['a4','a3','letter'] : ['a4','a3'])) for (const maxBars of (name==='uniform' ? [4] : [4,12])) {
          const rendered = await run(source,paper,maxBars);
          const geometry = pageGeometry(paper,1);
          toolkit.resetOptions(); toolkit.setOptions({breaks:'none',header:'none',footer:'none',xmlIdChecksum:true,font:'Bravura',fontFallback:'Bravura',smuflTextFont:'none'});
          toolkit.loadData(source);
          const baseline = toolkit.getMEI();
          toolkit.resetOptions(); toolkit.setOptions({font:'Bravura',fontFallback:'Bravura',smuflTextFont:'none',breaks:'encoded',noJustification:true,svgViewBox:true,svgBoundingBoxes:true,scale:100,
            pageWidth:geometry.pageWidth,pageHeight:geometry.pageHeight,pageMarginLeft:geometry.margin,pageMarginRight:geometry.margin,
            pageMarginTop:geometry.margin,pageMarginBottom:geometry.margin,adjustPageHeight:false,adjustPageWidth:false,header:'none',footer:'none'});
          toolkit.loadData(buildViewMei(baseline,{breakEvery:0,breakBefore:rendered.lines.map(line=>line.start),hiddenStaves:[],chordSymbols:true}));
          const fills = [];
          for (let i=1;i<=toolkit.getPageCount();i++) {
            const svgDoc = new DOMParser().parseFromString(toolkit.renderToSVG(i),'image/svg+xml');
            for (const system of svgDoc.querySelectorAll('g.system:not(.bounding-box)')) {
              // Staff barlines and glyph boxes across ALL staves, in Verovio's 1/10-unit coordinates.
              let right = 0;
              for (const path of system.querySelectorAll('g.staff > path')) {
                const match = /^M([\d.-]+) ([\d.-]+) L([\d.-]+) ([\d.-]+)$/.exec(path.getAttribute('d') || '');
                if (match && match[2]===match[4]) right = Math.max(right,Number(match[3]));
              }
              for (const rect of system.querySelectorAll('g.staff > g.staff.bounding-box > rect')) right = Math.max(right,Number(rect.getAttribute('x'))+Number(rect.getAttribute('width')));
              fills.push(right/10/geometry.capacity);
            }
          }
          regressions.push({name,paper,maxBars,fills,counts:rendered.lines.map(line=>line.count)});
        }
      }
    } finally { toolkit.destroy(); }
    const controller = new AbortController();
    const cancelled = engravePages({data},{paper:'a4',maxBars:4,files},controller.signal).then(()=>false,error=>error.name==='AbortError');
    controller.abort();
    const already = new AbortController(); already.abort();
    const preCancelled = await engravePages({data},{paper:'a4',maxBars:4,files},already.signal).then(()=>false,error=>error.name==='AbortError');
    return { regressions, a4:{lines:a4.lines,pages:parse(a4),shrunk:a4.shrunk},a3:{lines:a3.lines,pages:parse(a3)},
      many:{pages:parse(many),lines:many.lines},tall:{shrunk:tall.shrunk,pages:parse(tall)},
      single:single.pages.length,empty:empty.pages.length,pickup:{pages:parse(pickup),count:pickup.pages.length},
      hidden:hidden.pages.reduce((sum,svg)=>sum+new DOMParser().parseFromString(svg,'image/svg+xml').querySelectorAll('g.staff').length,0) === 2,cancelled:await cancelled,preCancelled };
  });
  console.log(JSON.stringify(result));
  for (const test of result.regressions) {
    assert.ok(test.fills.length===test.counts.length && test.fills.every(fill=>fill<=1.001), `${test.name} ${test.paper}/${test.maxBars}: every natural line fits (${test.fills})`);
  }
  for (const test of result.regressions.filter(test=>test.name==='uniform')) {
    assert.deepEqual(test.counts,[4,4,4,4],`uniform ${test.paper}/4: the opening prefix is counted once`);
  }
  assert.ok(result.regressions.find(test=>test.name==='uniform' && test.paper==='a3').counts.length <= result.regressions.find(test=>test.name==='uniform' && test.paper==='a4').counts.length, 'uniform: A3 never adds lines');
  for (const name of ['mrestTop','alternatingKeys']) for (const maxBars of [4,12]) {
    const a4 = result.regressions.find(test=>test.name===name && test.paper==='a4' && test.maxBars===maxBars);
    const a3 = result.regressions.find(test=>test.name===name && test.paper==='a3' && test.maxBars===maxBars);
    assert.ok(a3.counts.length<=a4.counts.length,`${name}/${maxBars}: A3 never adds lines`);
  }
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
}
}
} finally { await browser.close(); await server.close(); }

/** Compare actual Chromium screen pixels with Poppler pixels from the composed PDF. */
async function assertPitchRasterParity(browser, url) {
  const screen = await browser.newPage({viewport:{width:3300,height:2400},deviceScaleFactor:4});
  const directory=mkdtempSync(join(tmpdir(),'pitch-parity-'));
  try {
    await screen.goto(url);
    await screen.addStyleTag({content:readFileSync(join(root,'packages/pepperscore/dist/style.css'),'utf8').replace(/@import[^;]+;/g,'')});
    for(const variant of ['default','host']) {
      const fixture=await screen.evaluate(async variant=>{
        const {parseAbc}=await import('/packages/pepperscore/src/lib/import.ts');
        const {engravePages}=await import('/packages/pepperscore/src/lib/pdf/engrave.ts');
        const {exportScore}=await import('/packages/pepperscore/src/lib/pdf/export.ts');
        const {findAnnotationNote,annotationBox}=await import('/packages/pepperscore/src/lib/render.ts');
        const {tagPitchColours,pitchColourStyle,resolvePitchColours}=await import('/packages/pepperscore/src/lib/pitch-colours.ts');
        const {CRF_PITCH_COLOURS}=await import('/packages/pepperscore/src/lib/skin.ts');
        const score=await parseAbc('X:1\nM:4/4\nL:1/4\nK:C\n[CE] D F G |');score.title='';
        const options={paper:variant==='host'?'a3':'a4',maxBars:4,files:{module:new URL('/node_modules/verovio/dist/verovio-module.mjs',location.href).href,toolkit:new URL('/node_modules/verovio/dist/verovio.mjs',location.href).href}};
        const signal=new AbortController().signal;
        const pages=await engravePages({data:score.document.engravingText},options,signal);
        const svg=new DOMParser().parseFromString(pages.pages[0],'image/svg+xml').documentElement;
        document.body.replaceChildren();document.body.style.cssText='margin:0;background:white';
        const reader=document.createElement('div');reader.className='pepperscore';reader.setAttribute('data-ps-pitch-colours','');reader.style.cssText='width:3000px;background:white';
        Object.entries(pitchColourStyle(CRF_PITCH_COLOURS)).forEach(([key,value])=>reader.style.setProperty(key,value));
        if(variant==='host'){
          reader.style.setProperty('--host-outline','rgba(20,80,140,.5)');reader.style.setProperty('--ps-pitch-outline','var(--host-outline)');
          reader.style.setProperty('--host-pitch','#d45b91');reader.style.setProperty('--ps-pitch-c','var(--host-pitch)');
        }
        svg.style.cssText='display:block;width:3000px;height:auto';reader.append(svg);document.body.append(reader);
        const byId=new Map(Array.from(svg.querySelectorAll('[id]'),element=>[element.id,element]));
        for(const part of score.parts)for(const measure of part.measures)for(const event of measure.notes){const element=findAnnotationNote(byId,score,event);if(element)tagPitchColours(element,event,part);}
        reader.removeAttribute('data-ps-pitch-colours');
        const childrenBefore=reader.childElementCount;
        let inactiveRejected=false;
        try { resolvePitchColours(reader); } catch(error) { inactiveRejected=/Pitch colours must be active/.test(error.message); }
        if(!inactiveRejected || reader.childElementCount!==childrenBefore)throw Error('Inactive pitch snapshot must fail before adding a probe');
        reader.setAttribute('data-ps-pitch-colours','');
        const paint=resolvePitchColours(reader);
        const paperWidth=variant==='host'?297:210,ratio=paperWidth/svg.viewBox.baseVal.width;
        const heads=Array.from(svg.querySelectorAll('.notehead[data-pitch]'),(head,index)=>{
          head.setAttribute('data-raster-head',String(index));
          const b=annotationBox(head,svg),r=head.getBoundingClientRect();
          return {pitch:head.dataset.pitch,fill:paint.palette[head.dataset.pitch],screen:{x:r.x,y:r.y,width:r.width,height:r.height},pdf:{x:b.x*ratio,y:b.y*ratio,width:b.width*ratio,height:b.height*ratio}};
        });
        const blob=await exportScore({input:{data:score.document.engravingText},score,options,pitchColours:paint},signal);
        return {bytes:Array.from(new Uint8Array(await blob.arrayBuffer())),heads,ratio,paint};
      },variant);
      assert.notEqual(fixture.ratio,1);
      const input=join(directory,variant+'.pdf');writeFileSync(input,Buffer.from(fixture.bytes));
      if(process.env.PDF_ARTIFACTS){mkdirSync(process.env.PDF_ARTIFACTS,{recursive:true});writeFileSync(join(process.env.PDF_ARTIFACTS,'pitch-'+variant+'.pdf'),Buffer.from(fixture.bytes));}
      const factor=1200/25.4;
      const originX=Math.floor((Math.min(...fixture.heads.map(h=>h.pdf.x))-1)*factor);
      const originY=Math.floor((Math.min(...fixture.heads.map(h=>h.pdf.y))-1)*factor);
      const cropWidth=Math.ceil((Math.max(...fixture.heads.map(h=>h.pdf.x+h.pdf.width))+1)*factor)-originX;
      const cropHeight=Math.ceil((Math.max(...fixture.heads.map(h=>h.pdf.y+h.pdf.height))+1)*factor)-originY;
      execFileSync('pdftoppm',['-f','1','-singlefile','-r','1200','-x',String(originX),'-y',String(originY),'-W',String(cropWidth),'-H',String(cropHeight),input,join(directory,variant)],{stdio:'pipe'});
      const data=readFileSync(join(directory,variant+'.ppm'));
      const h=/^P6\s+(\d+)\s+(\d+)\s+255\s/.exec(data.subarray(0,80).toString());assert.ok(h);
      const pdf={width:Number(h[1]),height:Number(h[2]),pixels:data.subarray(h[0].length),channels:3};
      for(const head of fixture.heads){
        const b=head.screen,pad=4;
        const png=await screen.screenshot({clip:{x:b.x-pad,y:b.y-pad,width:b.width+2*pad,height:b.height+2*pad},animations:'disabled'});
        const image=await screen.evaluate(async bytes=>{
          const bitmap=await createImageBitmap(new Blob([new Uint8Array(bytes)],{type:'image/png'}));
          const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;
          const context=canvas.getContext('2d');context.drawImage(bitmap,0,0);return {width:canvas.width,height:canvas.height,pixels:Array.from(context.getImageData(0,0,canvas.width,canvas.height).data),channels:4};
        },Array.from(png));
        const rgb=head.fill.match(/[\d.]+/g).slice(0,3).map(Number);
        const screenMeasure=outlineProfile(image,{x:pad*4,y:pad*4,width:b.width*4,height:b.height*4},rgb);
        const pdfMeasure=outlineProfile(pdf,{x:head.pdf.x*factor-originX,y:head.pdf.y*factor-originY,width:head.pdf.width*factor,height:head.pdf.height*factor},rgb);
        assert.ok(screenMeasure.rows>5 && pdfMeasure.rows>5,`${variant} ${head.pitch}: enough edge rows outside staff/stem ink`);
        for(let channel=0;channel<3;channel++)assert.ok(Math.abs(screenMeasure.colour[channel]-pdfMeasure.colour[channel])<=18,`${variant} ${head.pitch}: outline colour screen=${screenMeasure.colour} PDF=${pdfMeasure.colour}`);
        assert.ok(Math.abs(screenMeasure.ratio-pdfMeasure.ratio)<.012 && pdfMeasure.ratio<screenMeasure.ratio*1.5,`${variant} ${head.pitch}: outline/head width screen=${screenMeasure.ratio} PDF=${pdfMeasure.ratio}`);
        if(variant==='default')for(const c of pdfMeasure.colour)assert.ok(Math.abs(c-89)<=18,`${head.pitch}: default outline is composited 65% black, not opaque black (${pdfMeasure.colour})`);
        console.log(`Pitch raster ${variant} ${head.pitch}: screen ${screenMeasure.colour} / ${screenMeasure.ratio.toFixed(4)}, PDF ${pdfMeasure.colour} / ${pdfMeasure.ratio.toFixed(4)}`);
      }
    }
  } finally {await screen.close();rmSync(directory,{recursive:true,force:true});}
}
function outlineProfile(image,box,fill) {
  const pixel=(x,y)=>Array.from(image.pixels.slice((y*image.width+x)*image.channels,(y*image.width+x)*image.channels+3));
  const widths=[],colours=[];
  for(let y=Math.ceil(box.y+box.height*.12);y<box.y+box.height*.88;y++){
    const matches=[];
    for(let x=Math.floor(box.x);x<box.x+box.width;x++)if(pixel(x,y).every((c,k)=>Math.abs(c-fill[k])<12))matches.push(x);
    if(matches.length<box.width*.35)continue;
    const start=matches[0];let edge=start-1,ink=[];
    while(edge>=box.x-box.width*.15 && pixel(edge,y).some(c=>c<230)){ink.push(pixel(edge,y));edge--;}
    if(!ink.length || edge<box.x-box.width*.15)continue; // staff line or another glyph
    widths.push((start-edge-1)/box.width);
    colours.push(...ink);
  }
  const median=a=>a.sort((a,b)=>a-b)[Math.floor(a.length/2)];
  const histogram=new Map();for(const c of colours){const key=c.join(',');histogram.set(key,(histogram.get(key)||0)+1);}
  const mode=[...histogram].sort((a,b)=>b[1]-a[1])[0]?.[0].split(',').map(Number)||[];
  return {rows:widths.length,ratio:median(widths),colour:mode};
}


async function assertPdfOverlay(browser) {
  // The source maps identify modules, so minification cannot hide an eager engine import.
  const initial = new Set();
  function visit(file) {
    if (initial.has(file)) return;
    initial.add(file);
    const code = readFileSync(join(root,'packages/pepperscore/dist',file),'utf8');
    const map = JSON.parse(readFileSync(join(root,'packages/pepperscore/dist',`${file}.map`),'utf8'));
    assert.ok(!map.sources.some(source => /\/lib\/pdf\/|PdfOverlay\.tsx/.test(source)), `${file} initial graph contains no PDF modules`);
    for (const match of code.matchAll(/(?:from\s*|import\s*)["']\.\/([^"']+\.js)["']/g)) visit(match[1]);
  }
  visit('index.js');
  const worker = readdirSync(join(root,'packages/pepperscore/dist/assets')).find(file => /^engrave\.worker-.*\.js$/.test(file));
  assert.ok(worker, 'package emits separate PDF worker');
  assert.ok(!readFileSync(join(root,'packages/pepperscore/dist/assets',worker),'utf8').includes('vrvToolkit_constructor'), 'PDF worker does not bundle upstream Verovio');
  const host = await serveDist();
  const page = await browser.newPage({ viewport: { width: 1000, height: 850 }, acceptDownloads: true });
  try {
    page.setDefaultTimeout(60000);
    await page.addInitScript(() => {
      window.__pdfWorkers = [];
      const nativeFetch = window.fetch;
      window.fetch = function(input, options) {
        if (window.__pdfFailFonts && /^(data:)|\.ttf/.test(String(input))) return Promise.reject(new TypeError('Synthetic PDF font network failure'));
        return nativeFetch.call(this, input, options);
      };
      const NativeWorker = window.Worker;
      window.Worker = class extends NativeWorker {
        constructor(url, options) { super(url, options); this.record = { url: String(url), terminated: false }; window.__pdfWorkers.push(this.record); this.addEventListener('message', event => { this.record.result = event.data.value; }); }
        postMessage(message, ...options) { this.record.message = message; return super.postMessage(message, ...options); }
        terminate() { this.record.terminated = true; return super.terminate(); }
      };
    });
    await page.goto(`${host.url}/embed-skin?pdf`);
    const full = page.locator('.skin-reader'), minimal = page.locator('.skin-minimal');
    await full.locator('.score-system svg').first().waitFor();
    await page.evaluate(() => window.__skin.setControls({ pdf: false }));
    assert.equal(await full.locator('.pdf-trigger').count(), 0);
    assert.ok(!host.requests.some(path => /PdfOverlay|export-|engrave[.-]|jspdf|svg2pdf|Poppins.*ttf/.test(path)), 'disabled/unused PDF loads no PDF chunks');
    await page.evaluate(() => window.__skin.setControls({ pdf: true }));
    await minimal.locator('.pdf-trigger').waitFor();
    await page.evaluate(() => {
      window.__skin.setSkin({ bar: ['pdf', 'play', 'options'] });
      window.__skin.setAbc('X:1\nT:Skin fixture\nM:4/4\nL:1/4\nQ:1/4=30\nK:C\n' + Array(48).fill('C D E F |').join(' '));
    });
    await page.waitForFunction(() => document.querySelectorAll('.skin-reader .score-system').length >= 8 && !document.querySelector('.skin-reader .score-loading'));
    await full.locator('.score-viewport').evaluate(el => { el.scrollTop = 150; });
    const before = await full.locator('.score-viewport').evaluate(el => ({ scroll: el.scrollTop, svg: el.querySelector('svg')?.outerHTML }));
    const workers = []; page.on('worker', worker => workers.push(worker));
    await full.locator('.pdf-trigger').click();
    const dialog = full.getByRole('dialog', { name: 'Export PDF' });
    await dialog.waitFor();
    assert.equal(await dialog.getByLabel('Paper size').inputValue(), 'a4');
    assert.equal(await dialog.getByLabel('Bars per line').inputValue(), '4');
    assert.ok(before.scroll > 0, 'nonzero reader scroll is exercised');
    await dialog.getByRole('button', { name: 'Save', exact: true }).focus();
    await page.keyboard.press('Tab');
    assert.equal(await dialog.getByLabel('Paper size').evaluate(el => el === document.activeElement), true, 'focus wraps');
    await dialog.getByLabel('Paper size').selectOption('a3');
    await dialog.getByLabel('Bars per line').fill('2');
    await page.waitForFunction(() => !document.querySelector('.pdf-fit')?.textContent.includes('Checking'));
    assert.match(await dialog.getByRole('status').innerText(), /fewer than 2 bars on A3/);
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await full.locator('.pdf-trigger').click();
    assert.equal(await dialog.getByLabel('Paper size').inputValue(), 'a3');
    assert.equal(await dialog.getByLabel('Bars per line').inputValue(), '4');
    const downloadPromise = page.waitForEvent('download');
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    const download = await downloadPromise;
    assert.equal(download.suggestedFilename(), 'skin-fixture.pdf');
    const bytes = readFileSync(await download.path());
    const pdf = await PDFDocument.load(bytes);
    assert.ok(Math.abs(pdf.getPage(0).getWidth() * 25.4 / 72 - 297) < .001, 'remembered A3 used in actual bytes');
    await dialog.waitFor({state:'detached'});
    const after = await full.locator('.score-viewport').evaluate(el => ({ scroll: el.scrollTop, svg: el.querySelector('svg')?.outerHTML }));
    assert.deepEqual(after, before, 'export leaves engraving and scroll intact');
    assert.ok(host.requests.some(path => /engrave\.worker-.*\.js/.test(path)), 'host copies and serves PDF worker URL');
    assert.ok(workers.some(worker => /engrave/.test(worker.url())), 'separate PDF worker emitted and reached');
    assert.ok(await page.evaluate(() => window.__pdfWorkers.filter(w => /engrave/.test(w.url)).every(w => w.terminated)), 'completed/cancelled measurement and export workers terminated');
    // A live transport must keep advancing while export does its separate engraving.
    await full.getByRole('button', {name:'Play score',exact:true}).click();
    await page.waitForFunction(() => window.__skin.time > .1);
    const playback = await page.evaluate(() => ({time:window.__skin.time,stops:window.__skin.stops,renders:window.__skin.renders}));
    await full.locator('.pdf-trigger').click();
    const playingDownload = page.waitForEvent('download');
    await dialog.getByRole('button', {name:'Save',exact:true}).click();
    await playingDownload;
    const continued = await page.evaluate(() => ({time:window.__skin.time,stops:window.__skin.stops,renders:window.__skin.renders}));
    assert.ok(continued.time > playback.time && continued.stops === playback.stops && continued.renders === playback.renders, 'export preserves active playback and engraving');
    await full.getByRole('button', {name:'Pause playback',exact:true}).click();
    // Cancel a Save while its real worker is alive; no download follows.
    let unexpectedDownloads = 0; const onDownload = () => unexpectedDownloads++;
    page.on('download', onDownload);
    await full.locator('.pdf-trigger').click();
    await dialog.getByRole('button', {name:'Save',exact:true}).click();
    await page.waitForFunction(() => window.__pdfWorkers.some(w => /engrave/.test(w.url) && !w.terminated));
    await dialog.getByRole('button', {name:'Cancel',exact:true}).click();
    await page.waitForFunction(() => window.__pdfWorkers.filter(w => /engrave/.test(w.url)).every(w => w.terminated));
    assert.equal(unexpectedDownloads, 0, 'cancelled Save never downloads');
    page.off('download', onDownload);
    // A real font fetch failure is retryable without resetting the overlay.
    await page.evaluate(() => { window.__pdfFailFonts = true; });
    await full.locator('.pdf-trigger').click();
    await dialog.getByRole('button', {name:'Save',exact:true}).click();
    await dialog.getByRole('alert').waitFor();
    assert.equal(await dialog.getByRole('button', {name:'Save',exact:true}).isEnabled(), true);
    await page.evaluate(() => { window.__pdfFailFonts = false; });
    const retryDownload = page.waitForEvent('download');
    await dialog.getByRole('button', {name:'Save',exact:true}).click();
    await retryDownload;
    // Dense-bar fitting is reported from the real separate engraving worker.
    await page.evaluate(() => window.__skin.setAbc('X:1\nT:Dense\nM:4/4\nL:1/4\nK:C\n' + Array(4).fill('C4 |').join(' ') + Array(64).fill('C/16').join(' ') + ' | ' + Array(8).fill('C4 |').join(' ')));
    await page.waitForFunction(() => document.querySelector('.skin-reader h1')?.textContent.includes('Dense') && !document.querySelector('.skin-reader .score-loading'));
    await full.locator('.pdf-trigger').click();
    await dialog.getByLabel('Paper size').selectOption('a4');
    await page.waitForFunction(() => /\d+ lines? will/.test(document.querySelector('.pdf-fit')?.textContent ?? ''));
    const fitText = await dialog.getByRole('status').innerText();
    assert.equal(Number.parseInt(fitText), 1, 'exactly the dense line reports fewer bars');
    const denseCounts = await page.evaluate(() => window.__pdfWorkers.filter(w => /engrave/.test(w.url) && w.result).at(-1).result.lines.map(line => line.count));
    assert.deepEqual(denseCounts, [4,1,4,4], 'surrounding sparse lines retain four bars');
    await dialog.getByRole('button', {name:'Cancel',exact:true}).click();
    await page.evaluate(() => window.__skin.setSettings({semitones:2}));
    await page.waitForFunction(() => !document.querySelector('.skin-reader .score-loading'));
    await full.locator('.pdf-trigger').click();
    const snapshotDownload = page.waitForEvent('download');
    await dialog.getByRole('button', {name:'Save',exact:true}).click();
    await page.waitForFunction(() => window.__pdfWorkers.some(w => /engrave/.test(w.url) && !w.terminated));
    await page.evaluate(() => window.__skin.setSettings({semitones:5}));
    await snapshotDownload;
    const captured = await page.evaluate(() => window.__pdfWorkers.filter(w => /engrave/.test(w.url)).at(-1).message.input.view.spelling.semitones);
    assert.equal(captured, 2, 'Save snapshot retains the pitch view despite a later host change');
    await page.evaluate(() => window.__skin.setAbc('X:1\nM:4/4\nL:1/4\nK:C\nC D E F |'));
    await page.waitForFunction(() => document.querySelectorAll('.skin-reader .score-system').length === 1 && !document.querySelector('.skin-reader .score-loading'));
    await full.locator('.pdf-trigger').click();
    const untitledDownload = page.waitForEvent('download');
    await dialog.getByRole('button', {name:'Save',exact:true}).click();
    assert.equal((await untitledDownload).suggestedFilename(), 'score.pdf');
    await page.setViewportSize({ width: 390, height: 850 });
    await full.locator('.pdf-trigger').click();
    const box = await dialog.boundingBox(), rootBox = await full.boundingBox();
    assert.ok(box.x >= rootBox.x && box.x + box.width <= rootBox.x + rootBox.width + 1, 'phone overlay contained');
    const handleBox = await full.locator('.drawer-handle').boundingBox();
    assert.ok(await page.evaluate(box => document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)?.classList.contains('pdf-backdrop'), handleBox), 'PDF backdrop intercepts the Options handle on phone');
    await page.keyboard.press('Escape');
    assert.equal(await dialog.count(), 0);
    await page.reload();
    await full.locator('.score-system svg').first().waitFor();
    await page.evaluate(() => { window.__skin.setSkin({bar:['pdf']}); window.__skin.setControls({pdf:true}); });
    await full.locator('.pdf-trigger').click();
    assert.equal(await dialog.getByLabel('Paper size').inputValue(), 'a4', 'paper survives reload');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    const chunkPage = await browser.newPage();
    chunkPage.setDefaultTimeout(60000);
    try {
      await chunkPage.goto(`${host.url}/embed-skin`);
      await chunkPage.locator('.skin-reader .score-system svg').first().waitFor();
      await chunkPage.evaluate(() => window.__skin.setSkin({bar:['pdf']}));
      await chunkPage.route('**/*PdfOverlay*.js', route => route.abort());
      await chunkPage.locator('.skin-reader .pdf-trigger').click();
      const failedDialog = chunkPage.locator('.skin-reader').getByRole('dialog',{name:'Export PDF'});
      await failedDialog.getByRole('alert').waitFor();
      await chunkPage.unroute('**/*PdfOverlay*.js');
      await Promise.all([chunkPage.waitForEvent('load'), failedDialog.getByRole('button',{name:'Reload page',exact:true}).click()]);
      await chunkPage.locator('.skin-reader .score-system svg').first().waitFor();
      await chunkPage.evaluate(() => window.__skin.setSkin({bar:['pdf']}));
      await chunkPage.locator('.skin-reader .pdf-trigger').click();
      await failedDialog.getByLabel('Paper size').waitFor();
      await failedDialog.getByRole('button',{name:'Cancel',exact:true}).click();
    } finally { await chunkPage.close(); }
    const sandboxPage = await browser.newPage();
    sandboxPage.setDefaultTimeout(60000);
    try {
      await sandboxPage.goto(host.url);
      await sandboxPage.setContent(`<iframe sandbox="allow-scripts allow-same-origin" src="${host.url}/embed-skin" style="width:1000px;height:850px"></iframe>`);
      const frame = sandboxPage.frameLocator('iframe');
      await frame.locator('.skin-reader .score-system svg').first().waitFor();
      await sandboxPage.frames()[1].evaluate(() => window.__skin.setSkin({bar:['pdf']}));
      await frame.locator('.skin-reader .pdf-trigger').click();
      const sandboxDialog = frame.locator('.skin-reader').getByRole('dialog',{name:'Export PDF'});
      await sandboxDialog.getByRole('button',{name:'Save',exact:true}).click();
      await sandboxDialog.getByRole('alert').waitFor();
      assert.match(await sandboxDialog.getByRole('alert').innerText(), /Downloads are blocked/);
      await sandboxDialog.getByRole('button',{name:'Cancel',exact:true}).click();
    } finally { await sandboxPage.close(); }
    console.log('PDF overlay: availability, lazy chunks, defaults, focus trap, fit, remembered paper, local bars, actual download, separate worker, unchanged reader and phone containment passed');
  } finally { await page.close(); await host.close(); }
}
