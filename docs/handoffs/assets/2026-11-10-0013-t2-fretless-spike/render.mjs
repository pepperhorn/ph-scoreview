import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const root = process.argv[2];
const out = path.dirname(new URL(import.meta.url).pathname);
const {default:createModule}=await import(pathToFileURL(path.join(root,'node_modules/verovio/dist/verovio-module.mjs')));
const {VerovioToolkit}=await import(pathToFileURL(path.join(root,'node_modules/verovio/dist/verovio.mjs')));
const tk=new VerovioToolkit(await createModule());
const cases={
 violin:{tuning:[76,69,62,55],names:['E','A','D','G'],clef:'G',line:2,events:[
 [76,1,0,'',0],[77,1,1,'L',1],[80,1,2,'',1],[84,1,4,'H',1],
 [81,1,1,'',3],[83,1,2,'',3],null,[69,2,0,'',0],
 [[78,1,1,'',1],[73,2,2,'',1]],[88,1,4,'',4],[89,1,4,'H',4],[76,1,0,'',0]]},
 cello:{tuning:[57,50,43,36],names:['A','D','G','C'],clef:'F',line:4,events:[
 [36,4,0,'',0],[37,4,1,'',0.5],[38,4,2,'',0.5],[40,4,4,'',0.5],
 [41,4,1,'',3],[42,4,1,'',3.5],null,[43,3,0,'',0],
 [[59,1,1,'',1],[52,2,1,'',1]],[44,4,1,'',4.5],[68,1,4,'',4.5],[57,1,0,'',0]]}
};
const pitch=m=>{const pc=['c','c','d','e','e','f','f','g','a','a','b','b'][m%12];const acc=[0,1,0,-1,0,0,1,0,-1,0,-1,0][m%12];return `pname="${pc}" oct="${Math.floor(m/12)-1}"${acc?` accid="${acc>0?'s':'f'}"`:''}`};
const pos=p=>({0.5:'½',1:'I',1.5:'I½',2:'II',3:'III',3.5:'III½',4:'IV',4.5:'IV½'})[p];
const reports=[];
for(const [instrument,c] of Object.entries(cases))for(const mode of ['A-literal-tab','B-numeric-tab','C-annotation-lane','D-svg-finger-text']){
 const tab=mode[0]!=='C';
 let previous=0;
 const measures=Array.from({length:3},(_,bar)=>{
 let notation='',tabs='',dirs='';
 for(let beat=0;beat<4;beat++){
 const i=bar*4+beat,e=c.events[i];
 if(!e){notation+='<rest dur="4"/>';tabs+='<rest dur="4"/>';continue;}
 const notes=Array.isArray(e[0])?e:[e];
 notation+=notes.length>1?`<chord dur="4" xml:id="n${i}">${notes.map(n=>`<note ${pitch(n[0])}/>`).join('')}</chord>`:`<note dur="4" xml:id="n${i}" ${pitch(e[0])}/>`;
 tabs+=`<tabGrp dur="4" xml:id="t${i}"><tabDurSym/>${notes.map(n=>`<note tab.course="${n[1]}" tab.fret="${mode[0]==='A'?n[3]+n[2]:n[2]}"/>`).join('')}</tabGrp>`;
 const p=notes[0][4];
 if(tab){
 if(p&&p!==previous){dirs+=`<dir staff="2" startid="#t${i}" place="above">${pos(p)} pos.</dir>`;previous=p;}
 if(mode[0]==='B'&&notes.some(n=>n[3])) dirs+=`<dir staff="2" startid="#t${i}" place="below">${notes.map(n=>n[3]?`${c.names[n[1]-1]}:${n[3]}`:'').filter(Boolean).join(' / ')}</dir>`;
 }else dirs+=`<dir staff="1" startid="#n${i}" place="below">${notes.map(n=>`${c.names[n[1]-1]}:${n[3]}${n[2]}${n[4]?` (${pos(n[4])})`:''}`).join(' / ')}</dir>`;
 }
 return `<measure n="${bar+1}"><staff n="1"><layer n="1">${notation}</layer></staff>${tab?`<staff n="2"><layer n="1">${tabs}</layer></staff>`:''}${dirs}</measure>`;
 }).join('');
 const mei=`<mei xmlns="http://www.music-encoding.org/ns/mei" meiversion="5.0"><meiHead><fileDesc><titleStmt><title>${instrument}: ${mode[0]}</title></titleStmt><pubStmt/></fileDesc></meiHead><music><body><mdiv><score><scoreDef meter.count="4" meter.unit="4"><staffGrp><staffDef n="1" lines="5" clef.shape="${c.clef}" clef.line="${c.line}"/>${tab?`<staffDef n="2" notationtype="tab.guitar" lines="4"><label>${c.names.join(' / ')}</label><clef shape="TAB" line="3"/><tuning>${c.tuning.map((m,i)=>`<course n="${i+1}" ${pitch(m)}/>`).join('')}</tuning></staffDef>`:''}</staffGrp></scoreDef><section>${measures}</section></score></mdiv></body></music></mei>`;
 const name=`${instrument}-${mode}`;
 try {
 fs.writeFileSync(`${out}/${name}.mei`,mei);
 tk.resetOptions();tk.setOptions({pageWidth:2200,pageHeight:1000,scale:55,adjustPageHeight:true,breaks:'none',svgViewBox:true,xmlIdChecksum:true});
 if(!tk.loadData(mei))throw Error(name);
 let svg=tk.renderToSVG(1);
 if(mode[0]==='D'){
   // Scratch-only text substitution using Verovio's laid-out TAB groups.
   // Opaque white stroke expands the line knockout for two-character labels.
   c.events.forEach((event,index)=>{
     if(!event)return;
     const notes=Array.isArray(event[0])?event:[event];
     const start=svg.indexOf(`id="t${index}"`), end=svg.indexOf('</text>',start);
     // All note text in this tabGrp, including a double stop.
     const next=svg.indexOf('class="tabGrp"',start+15);
     const stop=next<0?svg.length:svg.lastIndexOf('<g ',next);
     let group=svg.slice(start,stop), n=0;
     group=group.replace(/<tspan font-size="324px">[0-4]<\/tspan>/g, match=>{
       if(n>=notes.length)return match;
       const note=notes[n++];
       return `<tspan font-size="324px" stroke="white" stroke-width="45" stroke-linejoin="round" paint-order="stroke fill">${note[3]}${note[2]}</tspan>`;
     });
     svg=svg.slice(0,start)+group+svg.slice(stop);
   });
 }
fs.writeFileSync(`${out}/${name}.svg`,svg);
 fs.writeFileSync(`${out}/${name}-roundtrip.mei`,tk.getMEI());
 reports.push({name,pages:tk.getPageCount(),log:tk.getLog(),svgBytes:svg.length});
 } catch(error) { reports.push({name,error:String(error)}); console.error(name,String(error)); }
}
fs.writeFileSync(`${out}/render-report.json`,JSON.stringify({version:tk.getVersion(),reports},null,2));
console.log(reports);
