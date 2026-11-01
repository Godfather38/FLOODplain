import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';
import {validateStormFrame,cellAt} from '../public/simulation/storm.js';
const root=new URL('../public/simulation/data/storm-2014/',import.meta.url),read=f=>JSON.parse(readFileSync(new URL(f,root),'utf8'));
test('obsolete palette arrays retain original hashes and interpretation for audit',()=>{
 const m=read('manifest.json');assert.equal(m.hours.length,72);assert.equal(m.quality.availableHours,72);let previous=m.start;
 for(const entry of m.hours){assert.equal(entry.start,previous);previous=entry.end;const bytes=readFileSync(new URL(entry.file,root));assert.equal(createHash('sha256').update(bytes).digest('hex'),entry.sha256);validateStormFrame(m,entry,JSON.parse(bytes));assert.equal(entry.sources[0].httpStatus,200);}
 assert.equal(previous,m.end);const entry=m.hours.find(e=>e.end==='2014-09-08T18:00:00Z'),f=read(entry.file),i=cellAt(m.grid,-111.3,32.47);assert.equal(f.depthMm[i],2.5);assert.equal(cellAt(m.grid,0,0),null);
 const terrain=JSON.parse(readFileSync(new URL('../public/simulation/data/terrain.json',import.meta.url),'utf8')),single=JSON.parse(readFileSync(new URL('../public/simulation/data/rainfall-iem-201409081800-obsolete-palette.json',import.meta.url),'utf8'));
 terrain.cells.forEach((c,j)=>assert.equal(f.depthMm[cellAt(m.grid,c.lon,c.lat)],single.frames[0].rates[j]));
 const bad={...f,depthMm:[-1]};assert.throws(()=>validateStormFrame(m,entry,bad));
});
test('obsolete daily discrepancy is reproducible and explicitly superseded',()=>{
 const m=read('manifest.json'),check=m.dailyCrossChecks[0],daily=read(check.file),hours=m.hours.slice(0,24).map(e=>read(e.file).depthMm),diff=[];
 daily.depthMm.forEach((v,j)=>{if(v!==null&&hours.every(a=>a[j]!==null))diff.push(hours.reduce((s,a)=>s+a[j],0)-v);});
 assert.equal(diff.length,check.comparedCells);assert.ok(Math.abs(diff.reduce((a,b)=>a+b,0)/diff.length-check.meanHourlyMinusDailyMm)<1e-9);assert.equal(Math.max(...diff.map(Math.abs)),104.75);
 const at=cellAt(m.grid,-111.3,32.47);assert.equal(hours.reduce((s,a)=>s+a[at],0),3.75);assert.equal(daily.depthMm[at],17.5);assert.equal(m.quality.forcingReadiness,'obsolete_wrong_historical_palette');
});
test('storm replay renders a real hour and observed discharge without claiming depths',async()=>{
 const html=readFileSync(new URL('../public/simulation/storm.html',import.meta.url),'utf8'),canvas=new Proxy({},{get:()=>()=>{},set:()=>true});
 const el=()=>({textContent:'',innerHTML:'',value:'10',getContext:()=>canvas}),elements=Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(m=>[m[1],el()]));
 const oldDoc=globalThis.document,oldFetch=globalThis.fetch;globalThis.document={getElementById:id=>{assert.ok(elements[id]);return elements[id];}};
 globalThis.fetch=async url=>({ok:true,json:async()=>JSON.parse(readFileSync(new URL('../public/simulation/'+url,import.meta.url),'utf8'))});
 try{await import('../public/simulation/storm-app.js');assert.match(elements['storm-status'].textContent,/no simulated depths/);assert.match(elements['storm-rain'].textContent,/14 mm/);assert.match(elements['storm-observation'].textContent,/Approved/);assert.match(elements['storm-gauge'].innerHTML,/<path/);await elements['storm-next'].onclick();assert.match(elements['storm-time'].textContent,/2014-09-08T19:00:00Z/);}finally{globalThis.document=oldDoc;globalThis.fetch=oldFetch;}
});

test('versioned legacy forcing preserves unknown zeros and changes geometry explicitly',()=>{
 const base=new URL('../public/simulation/data/storm-2014-legacy/',import.meta.url),m=JSON.parse(readFileSync(new URL('manifest.json',base),'utf8'));
 assert.equal(m.grid.west,-111.695);assert.ok(Math.abs(m.grid.north-32.795)<1e-12);assert.equal(m.quality.usableNonzeroCellHours,56378);assert.equal(m.quality.unknownZeroOrMissingCellHours,910654);assert.equal(m.quality.completeHours,0);
 const f=JSON.parse(readFileSync(new URL('hour-201409081800.json',base),'utf8')),at=cellAt(m.grid,-111.3019666667,32.4715888889);assert.equal(f.depthMm[at],14);assert.ok(f.depthMm.includes(null));
 const a=JSON.parse(readFileSync(new URL('../public/simulation/data/rainfall-source-audit.json',import.meta.url),'utf8')),stage=JSON.parse(readFileSync(new URL('../public/simulation/data/stage4-comparison-20140908.json',import.meta.url),'utf8'));
 assert.equal(a.trico.legacyWorldSampling.knownNonzeroIntegerSumMm,15);assert.equal(a.trico.nativeCenterSampling.knownNonzeroIntegerSumMm,18);assert.equal(a.findings.repetition.uniqueRawHashes,72);assert.equal(a.gauges.find(g=>g.stationId==='TUS').gaugeMm,46.736);assert.equal(a.gauges.find(g=>g.stationId==='AVQ').gaugeMm,null);assert.equal(stage.hours.length,24);assert.ok(Math.abs(stage.totalsMm.TUS-41.9)<1e-9);
});
