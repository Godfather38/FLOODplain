// SFINCS route prediction: whole roads and crossings against the model's water, feeding the route
// ratings. See docs/SFINCS-ROUTE-PREDICTION.md, including why it must not be removed again.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {predictFromGrid,predictFromAllRoute,routeStations,routeAtFrame,routeOutlook,predictionPoint,levelFor,COVER_M,DEEP_M} from '../public/simulation/route-prediction.js';
import {worst,routeScore} from '../public/logic.js';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const H=3600e3,T0=Date.parse('2026-11-05T18:00:00Z');
// One straight route, 20 stations 5 m apart, road at 600 m; each station in its own cell.
function fixture(waterAt){
 const stations=Array.from({length:20},(_,i)=>({lon:-111.2+i*5e-5,lat:32.4,stationM:i*5,elevationM:600,flags:0}));
 const lines=[{kind:'route',routeId:'avra',stations},{kind:'freeway',routeId:null,stations}];
 const times=[T0,T0+H,T0+2*H];
 const surface=times.map((_,k)=>Float32Array.from(stations,(s,i)=>waterAt(k,i)));
 const depth=surface.map(f=>f.map(z=>Math.max(0,z-599.5)));
 return {stations:routeStations(lines),run:{times,surface,depth},cellOf:(lon)=>Math.round((lon+111.2)/5e-5)};
}

test('every station on the route is compared with the water, and only route lines count',()=>{
 const f=fixture((k,i)=>k===2&&i>=8&&i<=11?600.2:599.4);
 assert.deepEqual([...f.stations.keys()],['avra']);
 const pred=predictFromGrid(f.run,f.stations,f.cellOf);
 assert.equal(pred.routes.avra.samples.length,20);
 const dry=routeAtFrame(pred.routes.avra,0);assert.equal(dry.stretches.length,0);assert.equal(dry.maxOver,-Infinity,'a dry cell is no water, not missing');
 const wet=routeAtFrame(pred.routes.avra,2);
 assert.equal(wet.stretches.length,1,'neighbouring stations join one stretch');
 assert.equal(wet.stretches[0].fromM,40);assert.equal(wet.stretches[0].toM,55);
 assert.ok(Math.abs(wet.maxOver-.2)<1e-4);
});

test('the outlook covers the forecast still ahead and only while the run covers now',()=>{
 const pred=predictFromGrid(...(f=>[f.run,f.stations,f.cellOf])(fixture((k,i)=>k===2&&i===5?600.5:599.4)));
 const o=routeOutlook(pred,'avra',T0+10*60e3);
 assert.equal(o.status,'current');assert.equal(o.level,'danger');assert.equal(o.peak.time,T0+2*H);
 assert.equal(routeOutlook(pred,'avra',T0+30*H).status,'not_current');
 assert.equal(routeOutlook(pred,'avra',T0-30*H).status,'not_current');
 assert.equal(routeOutlook(pred,'pr-gates',T0).status,'no_route');
 assert.equal(levelFor(COVER_M/2),'ok');assert.equal(levelFor(COVER_M+.01),'caution');assert.equal(levelFor(DEEP_M),'danger');
});

test('water over the road raises the route rating and a dry forecast never lowers one',()=>{
 const pred=predictFromGrid(...(f=>[f.run,f.stations,f.cellOf])(fixture((k,i)=>k===1&&i===3?600.1:599.4)));
 const o=routeOutlook(pred,'avra',T0),p=predictionPoint('avra',o,'2026-11-05T17:58:00Z');
 assert.equal(p.level,'caution');assert.equal(p.checks[0].src,'sfincs');assert.match(p.why,/^SFINCS model forecast: 0\.3 ft of water over the road/);
 assert.doesNotMatch(p.why,/\bsafe\b/i);
 const route={level:'ok',points:[{level:'ok',checks:[{src:'county',level:'ok'}]},p]};
 assert.equal(worst(route.points.map(x=>x.level)),'caution');assert.equal(routeScore({...route,level:'caution'}),3);
 const dry=predictionPoint('avra',routeOutlook(predictFromGrid(...(f=>[f.run,f.stations,f.cellOf])(fixture(()=>599.4))),'avra',T0));
 assert.equal(dry.level,'ok');assert.equal(worst(['danger',dry.level]),'danger');
});

test('the saved all-route run predicts every route from its low points and lidar road heights',async()=>{
 const pkg=JSON.parse(read('public/simulation/data/all-route-13z/package.json')),points=JSON.parse(read('public/simulation/data/all-route-13z/route-points.json'));
 const {decodeRoadHeights}=await import('../public/preview/geo3d/src/road-package.js');
 const {gunzipSync}=await import('node:zlib');const b=gunzipSync(readFileSync(new URL('../public/simulation/data/road-heights/routes.bin.gz',import.meta.url)));
 const stations=routeStations(decodeRoadHeights(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)).lines);
 const times=pkg.cases[0].frames.map(f=>Date.parse(f.time)),pred=predictFromAllRoute(pkg,points,stations,times);
 for(const id of ['trico','avra','silverbell-north','silverbell-south','pr-ina','pr-twinpeaks','pr-avra','pr-gates'])assert.ok(pred.routes[id].samples.length>5,id);
 assert.equal(routeOutlook(pred,'pr-gates',times[0]).level,'danger','the Nov 1 storm put water over Gates Pass Rd');
});

test('the app counts the forecast in route ratings and the map lists every route',()=>{
 const app=read('public/app.js');
 assert.match(app,/loadLivePrediction/);assert.match(app,/map\(\(r\) => addSfincs\(r, d\)\)/);
 assert.match(app,/level: worst\(\[r\.level, point\.level\]\)/);
 assert.match(read('public/map-app.js'),/routeBoardHtml\(routePred/);
 const doc=read('docs/SFINCS-ROUTE-PREDICTION.md');
 assert.match(doc,/Do not remove/);assert.match(read('CLAUDE.md'),/SFINCS-ROUTE-PREDICTION\.md/);
});

test('the alert service and the app give every route the same SFINCS level from the same water',async()=>{
 const {gunzipSync}=await import('node:zlib');
 const {decodeRoadHeights}=await import('../public/preview/geo3d/src/road-package.js');
 const {toUtm}=await import('../public/preview/geo3d/src/utm.js');
 const {gridCellOf}=await import('../public/simulation/route-prediction.js');
 const {roadForecast}=await import('../public/road-forecast.js');
 const table=JSON.parse(read('public/data/road-cells.json'));
 const disp=JSON.parse(gunzipSync(readFileSync(new URL('../public/simulation/data/frozen-terrain-display.json.gz',import.meta.url))));
 const index=new Map(),bed=disp.vertices.map(v=>v[2]);disp.vertices.forEach((v,i)=>index.set(Math.floor(v[0]/100)*1000+Math.floor(v[1]/100),i));
 const b=gunzipSync(readFileSync(new URL('../public/simulation/data/road-heights/routes.bin.gz',import.meta.url)));
 const stations=routeStations(decodeRoadHeights(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)).lines);
 // Water on every route cell at road height plus a different offset per cell and hour, some dry.
 let seed=7;const rnd=()=>(seed=(seed*16807)%2147483647)/2147483647;
 const times=[0,1,2,3].map(k=>T0+k*H),frames=times.map(t=>({time:new Date(t).toISOString(),surfaceM:new Array(disp.vertices.length).fill(-99999)}));
 Object.values(table.routes).forEach((list,r)=>{const amp=[.1,.3,1][r%3];for(const [cell,roadM] of list)for(const f of frames)if(rnd()<.5)f.surfaceM[cell]=Math.max(roadM,bed[cell])+(rnd()-.6)*amp;});
 const surface=frames.map(f=>Float32Array.from(f.surfaceM)),depth=surface.map(s=>s.map((z,i)=>Math.max(0,z-bed[i])));
 const app=predictFromGrid({times,surface,depth},stations,gridCellOf(index,toUtm));
 const gas=roadForecast(table,{issuedAt:new Date(T0).toISOString()},{frames},T0+60e3);
 assert.equal(gas.status,'ok');
 const levels=new Set();
 for(const id of Object.keys(table.routes)){
  if(!table.routes[id].length)continue;
  const o=routeOutlook(app,id,T0+60e3);
  assert.equal(gas.routes[id].level,o.level,id);levels.add(o.level);
  assert.ok(Math.abs(gas.routes[id].maxOver-o.peak.maxOver)<1e-3,id);
 }
 assert.ok(levels.size>1,'the fixture exercises more than one level');
});
