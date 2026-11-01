import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { drainage, simulate, syntheticRain, validateRain, gridIdentity } from '../public/simulation/model.js';
import { importMrmsCsv } from '../public/simulation/radar.js';
const terrain = (z=[4,3,2,1]) => ({schemaVersion:1,rows:2,cols:2,cellSizeM:100,horizontalCRS:'EPSG:4326',verticalUnits:'m',crossingCell:3,cells:z.map((elevationM,i)=>({elevationM,lat:32.44-Math.floor(i/2)*.0009,lon:-111.30+(i%2)*.00106}))});
const rain = (t, rate=60) => ({schemaVersion:1,kind:'synthetic',source:'unit test fixture',units:'mm/h',grid:gridIdentity(t),frames:[{start:'2026-07-01T00:00:00Z',durationMinutes:10,rates:t.cells.map(()=>rate)}]});
test('D8 chooses steepest descent, accumulates and delineates local crossing',()=>{
 const d=drainage(terrain());assert.equal(d.downstream[3],-2);assert.equal(d.accumulation[3],4);assert.deepEqual(d.contributes,[true,true,true,true]);
});
test('rainfall volume has correct units and all water is accounted for',()=>{
 const t=terrain(),r=simulate(t,rain(t),{infiltrationMmH:0,travelMinutes:1});
 assert.ok(Math.abs(r.totals.rainfallM3-400)<1e-8);assert.ok(Math.abs(r.totals.residualM3)<1e-8);assert.ok(r.totals.storedM3<1e-6);assert.ok(r.series.every(s=>s.storageM3.every(x=>x>=0)));
});
test('dry and fully infiltrated rain produce no runoff',()=>{
 const t=terrain();for(const [rate,loss] of [[0,0],[10,20]]){const r=simulate(t,rain(t,rate),{infiltrationMmH:loss});assert.equal(r.totals.boundaryOutflowM3,0);assert.equal(r.totals.storedM3,0);}
});
test('internal depression retains water without fictitious outlet',()=>{
 const t={...terrain(),rows:3,cols:3,crossingCell:4,cells:[9,8,9,8,0,8,9,8,9].map((elevationM)=>({elevationM,lat:32,lon:-111}))};
 const r=simulate(t,rain(t),{infiltrationMmH:0,travelMinutes:1});assert.equal(r.network.downstream[4],-1);assert.equal(r.totals.boundaryOutflowM3,0);assert.ok(Math.abs(r.totals.storedM3-900)<1e-7);
});
test('longer routing time delays outlet peak; zero-loss inflow scales linearly',()=>{
 const t=terrain(),fast=simulate(t,rain(t),{infiltrationMmH:0,travelMinutes:1}),slow=simulate(t,rain(t),{infiltrationMmH:0,travelMinutes:15}),double=simulate(t,rain(t),{infiltrationMmH:0,travelMinutes:1,multiplier:2});
 // Outlet release includes the crossing reservoir delay. Inflow includes local
 // instantaneous rainfall excess, whose peak need not shift when routing changes.
 const peak=r=>r.series.reduce((a,b)=>a.crossingOutflowM3s>b.crossingOutflowM3s?a:b);
 assert.ok(peak(slow).minute>peak(fast).minute);
 fast.series.forEach((s,i)=>assert.ok(Math.abs(double.series[i].crossingM3s-2*s.crossingM3s)<1e-9));
});
test('crossing inflow equals local excess plus upstream releases; outlet obeys reservoir equation',()=>{
 const t=terrain(),r=simulate(t,rain(t),{infiltrationMmH:0,travelMinutes:8,tailMinutes:0});
 const alpha=1-Math.exp(-1/8),local=10; // 60 mm/h * 1/60 h * 10,000 m² / 1000
 const upstream=r.network.downstream.filter(j=>j===t.crossingCell).length;
 assert.ok(Math.abs(r.series[0].crossingM3s-(local+upstream*local*alpha)/60)<1e-12);
 assert.ok(Math.abs(r.series[0].crossingOutflowM3s-local*alpha/60)<1e-12);
 let previous=0;
 for(const s of r.series){assert.ok(Math.abs(s.storageM3[t.crossingCell]-previous-60*(s.crossingM3s-s.crossingOutflowM3s))<1e-10);previous=s.storageM3[t.crossingCell];}
});
test('missing rain, mismatched grid, overlaps, gaps and wrong units rejected',()=>{
 const t=terrain();for(const mutate of [r=>r.frames[0].rates[0]=null,r=>r.frames[0].rates[0]=-1,r=>r.grid[0][0]=0,r=>r.units='mm',r=>r.frames.push({...r.frames[0]}),r=>r.frames.push({...r.frames[0],start:'2026-07-01T00:12:00Z'})]){const r=rain(t);mutate(r);assert.throws(()=>validateRain(r,t));}
});
test('invalid parameters and terrain fail explicitly',()=>{
 const t=terrain();assert.throws(()=>simulate(t,rain(t),{travelMinutes:0}));assert.throws(()=>simulate(t,rain(t),{multiplier:NaN}));t.cells[0].elevationM=null;assert.throws(()=>drainage(t));
});
const csv=(t, field='PrecipRate',rate=12,time='2026-07-01 00:00:00')=>t.cells.map(c=>`"${time}","${time}","${field}","surface",${c.lon+360},${c.lat},${rate}`).join('\n');
test('MRMS importer maps 0–360 longitude, preserves UTC and two-minute units',()=>{
 const t=terrain(),r=importMrmsCsv(csv(t),t,'https://mrms.ncep.noaa.gov/data/');assert.equal(r.kind,'radar-estimate');assert.equal(r.frames[0].durationMinutes,2);assert.deepEqual(r.frames[0].rates,[12,12,12,12]);assert.equal(r.frames[0].start,'2026-07-01T00:00:00.000Z');
});
test('MRMS importer rejects wrong product, missing values, gaps, duplicate and distant pixels',()=>{
 const t=terrain(),source='https://mrms.ncep.noaa.gov/data/';
 for(const input of [csv(t,'RadarOnly_QPE_01H'),csv(t,'PrecipRate',-3),csv(t)+'\n'+csv(t),csv(t)+'\n'+csv(t,'PrecipRate',12,'2026-07-01 00:04:00'),csv({...t,cells:t.cells.map(c=>({...c,lat:0}))})])assert.throws(()=>importMrmsCsv(input,t,source));
});
test('recorded USGS terrain and synthetic replay are finite and conservative',()=>{
 const t=JSON.parse(readFileSync(new URL('../public/simulation/data/terrain.json',import.meta.url),'utf8'));
 assert.equal(t.kind,'usgs-epqs');assert.equal(t.cells.length,81);assert.ok(t.cells.every(c=>c.raw && c.sourceUrl.startsWith('https://epqs.nationalmap.gov/')));
 const r=simulate(t,syntheticRain(t));assert.ok(Math.abs(r.totals.residualM3)<1e-6);assert.equal(r.series.length,210);assert.ok(r.series.every(s=>Number.isFinite(s.crossingM3s)));
});
