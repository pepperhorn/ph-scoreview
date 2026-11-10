// Exercise the isolated engraving worker and vector PDF composer through dynamic imports.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../packages/pepperscore/package.json', import.meta.url));
const { PDFDocument, PDFName, decodePDFRawStream } = require('pdf-lib');
import { createServer } from 'vite';
import { chromium, firefox, webkit } from 'playwright-core';
import { root } from './serve-dist.mjs';

const server = await createServer({ configFile: false, root, optimizeDeps: { include: ['jspdf', 'svg2pdf.js', 'abcjs', '@tonejs/midi', 'fflate'] }, server: { host: '127.0.0.1', port: 0 },
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
  await page.addStyleTag({content:readFileSync(join(root,'packages/pepperscore/dist/style.css'),'utf8').replace(/@import[^;]+;/g,'')});
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
    const { pitchColourStyle } = await import('/packages/pepperscore/src/lib/pitch-colours.ts');
    const { renderScore } = await import('/packages/pepperscore/src/lib/render.ts');
    const pitchScore = await parseAbc('X:1\nM:4/4\nL:1/4\nK:C\n[CE] D F G |'); pitchScore.title='';
    const reader = document.createElement('div');reader.className='pepperscore';reader.setAttribute('data-ps-pitch-colours','');
    Object.entries(pitchColourStyle(CRF_PITCH_COLOURS)).forEach(([k,v])=>reader.style.setProperty(k,v));
    const canvas=document.createElement('div');canvas.style.width='1000px';reader.append(canvas);document.body.append(reader);
    const {setVerovioBaseUrl}=await import('/packages/pepperscore/src/lib/verovio-runtime.ts');setVerovioBaseUrl('/node_modules/verovio/dist/');
    const screen=await renderScore(canvas,pitchScore,'portrait',false,false,false,4,false,false,700,1);
    const screenColours=Array.from(canvas.querySelectorAll('.notehead[data-pitch]'),head=>({pitch:head.dataset.pitch,fill:getComputedStyle(head).fill,stroke:getComputedStyle(head).stroke}));
    screen.dispose();reader.remove();
    const pitchBlob=await exportScore({input:{data:pitchScore.document.engravingText},score:pitchScore,options:geometryOptions,pitchColours:CRF_PITCH_COLOURS},signal);
    const pitchPages=await engravePages({data:pitchScore.document.engravingText},geometryOptions,signal);
    const pitchSvg=new DOMParser().parseFromString(pitchPages.pages[0],'image/svg+xml').documentElement;document.body.append(pitchSvg);
    const {paintPitchColours}=await import('/packages/pepperscore/src/lib/pdf/annotations.ts');paintPitchColours(pitchSvg,pitchScore,CRF_PITCH_COLOURS);
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
    pitchSvg.querySelectorAll('.notehead[data-pitch]').forEach(head=>head.style.stroke='none');
    const noOutline=await composePdf([new XMLSerializer().serializeToString(pitchSvg)],{paper:'a4'},signal);pitchSvg.remove();

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
    return {pitch:{noOutline:Array.from(new Uint8Array(await noOutline.arrayBuffer())),bytes:Array.from(new Uint8Array(await pitchBlob.arrayBuffer())),heads:pitchHeads,screen:screenColours,ratio:pitchRatio},files,tabLaneWorked,geometry:{bytes:Array.from(new Uint8Array(await geometryBlob.arrayBuffer())),expected},accidentals:Array.from(new Uint8Array(await accidentalBlob.arrayBuffer())),tabAliasWorked,viewed:Array.from(new Uint8Array(await viewBlob.arrayBuffer())),exported:Array.from(new Uint8Array(await blob.arrayBuffer())),unsupported,aborted};
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
  // Actually rasterize the exported first page when Poppler is installed. The content-stream
  // geometry above is the portable fallback; it also catches nested transform regressions.
  assert.notEqual(composition.pitch.ratio,1);
  assert.deepEqual(composition.pitch.heads.map(({pitch,fill,stroke})=>({pitch,fill,stroke})),composition.pitch.screen,'real reader and PDF page paint match');
  const directory=mkdtempSync(join(tmpdir(),'pepperscore-pdf-r1-'));
  try {
    const input=join(directory,'geometry.pdf');writeFileSync(input,Buffer.from(composition.geometry.bytes));
    let available=true;try {execFileSync('pdftoppm',['-v'],{stdio:'pipe'});} catch(error) {if(error.code==='ENOENT') available=false;else throw error;}
    if (available) {
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
      const pitchInput=join(directory,'pitch.pdf');writeFileSync(pitchInput,Buffer.from(composition.pitch.bytes));
      execFileSync('pdftoppm',['-f','1','-singlefile','-r','288',pitchInput,join(directory,'pitch')],{stdio:'pipe'});
      const data=readFileSync(join(directory,'pitch.ppm'));const h=/^P6\s+(\d+)\s+(\d+)\s+255\s/.exec(data.subarray(0,80).toString());assert.ok(h);
      const plainInput=join(directory,'plain.pdf');writeFileSync(plainInput,Buffer.from(composition.pitch.noOutline));
      execFileSync('pdftoppm',['-f','1','-singlefile','-r','288',plainInput,join(directory,'plain')],{stdio:'pipe'});
      const plainData=readFileSync(join(directory,'plain.ppm'));const plainHeader=/^P6\s+(\d+)\s+(\d+)\s+255\s/.exec(plainData.subarray(0,80).toString());assert.ok(plainHeader);
      const plain=plainData.subarray(plainHeader[0].length);
      const w=Number(h[1]),px=data.subarray(h[0].length),factor=288/25.4;
      for(const head of composition.pitch.heads){
        const rgb=head.fill.match(/\d+/g).map(Number);let colour=0,dark=0,outline=0;
        const b=head.box;
        for(let y=Math.floor((b.y-.3)*factor);y<Math.ceil((b.y+b.height+.3)*factor);y++)for(let x=Math.floor((b.x-.3)*factor);x<Math.ceil((b.x+b.width+.3)*factor);x++){
          const i=(y*w+x)*3;
          if(rgb.every((c,k)=>Math.abs(c-px[i+k])<12))colour++;
          if(px[i]<130&&px[i+1]<130&&px[i+2]<130)dark++;
          if(plain[i]+plain[i+1]+plain[i+2]-(px[i]+px[i+1]+px[i+2])>60)outline++;
        }
        assert.ok(colour>5,`${head.pitch}: raster contains screen colour`);assert.ok(dark>2,`${head.pitch}: raster contains dark outline`);assert.ok(outline>2,`${head.pitch}: outline darkens pixels versus the same real page without outlines`);
      }
      console.log('Pitch PDF: real-page reader colours and outlined raster heads match at non-unit scale');
      console.log('Poppler raster: staff width/6.5 mm height, known notehead and aligned note-name ink passed.');
    } else console.log('Poppler unavailable: PDF content-stream transform geometry passed.');
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
} finally { await browser.close(); await server.close(); }
