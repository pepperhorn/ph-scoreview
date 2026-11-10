import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const root=process.argv[2], out=path.dirname(new URL(import.meta.url).pathname);
const {default:createModule}=await import(pathToFileURL(`${root}/node_modules/verovio/dist/verovio-module.mjs`));
const {VerovioToolkit}=await import(pathToFileURL(`${root}/node_modules/verovio/dist/verovio.mjs`));
const {chromium}=await import(pathToFileURL(`${root}/node_modules/playwright-core/index.mjs`));
const toolkit=new VerovioToolkit(await createModule());
const report=[];
// Each string, two simultaneous strings, dense eighths and a rest.
const events=[[[1,'L2']],[[2,'H1']],[[3,'L2']],[[4,'H1']],[[1,'L2'],[2,'H1']],[[3,'L2']],[[4,'H1']],null];
const modes=[
 ['within-loc','place="within"',true,'note'],
 ['within-aligned-offsets','place="within"',true,'note'],
 ['within-small','place="within" fontsize="8pt" fontweight="normal"',true,'note'],
 ['within-rend','place="within"',true,'note'],
 ['within-offsets','place="within"',true,'note'],
 ['above-note','place="above"',false,'note'],
 ['below-note','place="below"',false,'note'],
 ['default-note','',false,'note'],
 ['within-note','place="within"',false,'note'],
 ['above-group','place="above"',false,'group'],
 ['hidden-placeholder','place="above"',true,'note'],
 ['offset-hidden','place="above" vo="-7"',true,'note'],
 ['below-offset-hidden','place="below" vo="7"',true,'note'],
];
for(const [mode,attrs,hidden,anchor] of modes){
 const bars=[0,1].map(bar=>{
 let layer='', controls='';
 for(let j=0;j<4;j++){
 const index=bar*4+j, notes=events[index];
 if(!notes){layer+='<rest dur="8"/>';continue;}
 layer+=`<tabGrp xml:id="t${index}" dur="8"><tabDurSym/>${notes.map(([course,label],n)=>{
 const id=`n${index}-${n}`;
 const extra=mode==='within-loc'?` loc="${(4-course)*2}"`:mode==='within-aligned-offsets'?` vo="${(4-course)*2-3}"`:mode==='within-offsets'?` vo="${(4-course)*2}"`:'';
 const text=['within-rend','within-offsets','within-loc','within-aligned-offsets'].includes(mode)?`<rend fontsize="8pt" fontweight="normal">${label}</rend>`:label;
 controls+=`<fing xml:id="f${index}-${n}" staff="1" startid="#${anchor==='group'?`t${index}`:id}" ${attrs}${extra}>${text}</fing>`;
 return `<note xml:id="${id}" tab.course="${course}" tab.fret="${label.slice(1)}"${hidden?' visible="false"':''}/>`;
 }).join('')}</tabGrp>`;
 }
 return `<measure n="${bar+1}"><staff n="1"><layer n="1">${layer}</layer></staff>${controls}</measure>`;
 }).join('');
 const mei=`<mei xmlns="http://www.music-encoding.org/ns/mei" meiversion="5.0"><meiHead><fileDesc><titleStmt><title>fing probe</title></titleStmt><pubStmt/></fileDesc></meiHead><music><body><mdiv><score><scoreDef meter.count="2" meter.unit="4"><staffGrp><staffDef n="1" lines="4" notationtype="tab.guitar"><clef shape="TAB" line="3"/><tuning><course n="1" pname="e" oct="5"/><course n="2" pname="a" oct="4"/><course n="3" pname="d" oct="4"/><course n="4" pname="g" oct="3"/></tuning></staffDef></staffGrp></scoreDef><section>${bars}</section></score></mdiv></body></music></mei>`;
 fs.writeFileSync(`${out}/${mode}.mei`,mei);
 toolkit.resetOptions();toolkit.setOptions({pageWidth:1800,pageHeight:900,adjustPageHeight:true,scale:60,breaks:'none',svgViewBox:true});
 const loaded=toolkit.loadData(mei);if(!loaded)throw Error(mode);
 const svg=toolkit.renderToSVG(1);fs.writeFileSync(`${out}/${mode}.svg`,svg);
 fs.writeFileSync(`${out}/${mode}-roundtrip.mei`,toolkit.getMEI());
 report.push({mode,version:toolkit.getVersion(),log:toolkit.getLog(),fings:(svg.match(/class="fing"/g)||[]).length});
}
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1400,height:900},deviceScaleFactor:2});
for(const {mode} of report){
 await page.setContent(`<html><body style="margin:0;background:white">${fs.readFileSync(`${out}/${mode}.svg`,'utf8')}</body></html>`);
 await page.locator('svg').first().screenshot({path:`${out}/${mode}.png`});
 // Compare native fing text baseline with its note glyph baseline.
 const geometry=await page.evaluate(()=>Array.from(document.querySelectorAll('g.fing')).map(g=>{
 const text=g.querySelector('text'), id=g.id.replace(/^f/,'n');
 const note=document.getElementById(id)?.querySelector('text');
 return {id:g.id,label:g.textContent.trim(),fingY:text?.getAttribute('y'),noteY:note?.getAttribute('y')??null};
 }));
 report.find(r=>r.mode===mode).geometry=geometry;
}
await browser.close();
fs.writeFileSync(`${out}/report.json`,JSON.stringify(report,null,2));
console.log(report);
