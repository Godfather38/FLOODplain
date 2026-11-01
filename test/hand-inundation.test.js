import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {FORECAST_STATIONS} from '../public/simulation/forecast-stations.js';
import {createForecastEngine,normalizeForecast} from '../public/simulation/forecast-engine.js';
import {computeExtent,decodeJunction,estimateFromFlow,estimateFromForecast,stageForFlow} from '../public/simulation/hand-inundation.js';
const text=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const data=n=>JSON.parse(text('public/simulation/data/'+n));
const index=data('hand/index.json').junctions,coverage=data('hand/coverage.json');
const load=id=>decodeJunction(data(`hand/${id}.json`));
const trico=load('trico-marana-santa-cruz');
const metadata=data('nwps-scta3-metadata.json'),series=data('nwps-scta3-stageflow.json'),now=Date.parse('2026-11-01T07:22:17Z');
const forecast=()=>normalizeForecast(metadata,series,{now,siteId:'SCTA3'});
const VERDICT=/passable|impassable|\bsafe\b|unsafe|road is|can cross|cannot cross|drivable|turn around/i;

test('every built junction keeps the grid NOAA data produced and passes its build checks',()=>{
 assert.ok(Object.keys(index).length>=1);
 for(const id of Object.keys(index)){
  const raw=data(`hand/${id}.json`),j=decodeJunction(raw);
  const hash=createHash('sha256').update(Buffer.from(raw.grid.handCm,'base64')).update(Buffer.from(raw.grid.catchment,'base64')).digest('hex');
  assert.equal(hash,raw.grid.sha256);
  assert.equal(j.reach.featureId,FORECAST_STATIONS[j.station].reachId);
  assert.ok(j.reach.crossingDistanceM<=coverage.maxReachDistanceM);
  assert.equal(j.reach.name.toLowerCase(),j.crossing.water.toLowerCase());
  assert.ok(j.verification.validHandFractionOfReachCells>=.95);
  assert.equal(coverage.points.find(p=>p.lon===j.crossing.lon&&p.lat===j.crossing.lat)?.status,'forecast_linked');
 }
});

test('browser extent stays within 1% of the area worked out on NOAA\'s own grid',()=>{
 for(const id of Object.keys(index)){
  const j=load(id);
  for(const [flow,area] of Object.entries(j.verification.nativeGridWetAreaM2)){
   const got=computeExtent(j,Number(flow)).wetAreaM2;
   assert.ok(Math.abs(got-area)/area<.01,`${id} at ${flow}: ${got} vs ${area}`);
  }
 }
});

test('rating lookup interpolates and never goes past the curve',()=>{
 const curve={stageM:[0,1,2],dischargeM3s:[0,10,30]};
 assert.equal(stageForFlow(curve,5),.5);assert.equal(stageForFlow(curve,20),1.5);assert.equal(stageForFlow(curve,30),2);
 assert.equal(stageForFlow(curve,31),null);assert.equal(stageForFlow(curve,-1),null);assert.equal(stageForFlow(curve,NaN),null);
 assert.equal(stageForFlow({stageM:[0,1,2],dischargeM3s:[0,0,10]},0),0);
});

test('more flow never shrinks the extent, and cells without data are never wet',()=>{
 let last=0;
 for(const flow of [1,10,100,1000,10000]){const e=computeExtent(trico,flow);assert.ok(e.wetCells>=last);last=e.wetCells;
  for(let i=0;i<e.mask.length;i++)if(trico.catchment[i]===trico.grid.catchmentNone||trico.handCm[i]===trico.grid.handNodata)assert.equal(e.mask[i],0);}
 const r=estimateFromFlow(trico,1e9,{now});assert.equal(r.status,'beyond_rating');assert.equal(r.extent,undefined);
});

test('forecast provider connects through the same station and reach',()=>{
 const f=forecast(),r=estimateFromForecast(trico,f,{now});
 assert.equal(r.status,'ok');assert.equal(r.source,'forecast');assert.equal(r.flowM3s,f.peak.flowM3s);assert.equal(r.flowTime,f.peak.time);assert.ok(r.extent.wetCells>0);
 const later=f.points.at(-1),at=estimateFromForecast(trico,f,{now,time:later.time});assert.equal(at.flowM3s,later.flowM3s);
 assert.equal(estimateFromForecast(trico,f,{now,time:'2000-01-01T00:00:00Z'}).status,'insufficient_data');
 assert.equal(estimateFromForecast({...trico,station:'CSCA3'},f,{now}).status,'unsupported');
 assert.equal(estimateFromForecast({...trico,reach:{...trico.reach,featureId:'1'}},f,{now}).status,'unsupported');
});

test('old forecasts are marked, and unusable forecasts give no extent',()=>{
 const stale=normalizeForecast(metadata,series,{now:now+24*3600000,siteId:'SCTA3'}),a=estimateFromForecast(trico,stale,{now:now+24*3600000});
 assert.equal(a.status,'stale');assert.ok(a.extent);assert.match(a.reason,/old forecast/);
 const expired=normalizeForecast(metadata,series,{now:now+10*86400000,siteId:'SCTA3'}),b=estimateFromForecast(trico,expired,{now:now+10*86400000});
 assert.equal(b.status,'expired');assert.equal(b.extent,undefined);assert.equal(b.masks,undefined);
});

test('engine is opt-in, refuses unchecked junctions, and shows no extent on failed refresh',async()=>{
 let calls=0,fail=false;const fetchImpl=async url=>{calls++;if(fail)throw Error('offline');return{ok:true,json:async()=>url.endsWith('stageflow')?series:metadata};};
 const junctionLoader=async id=>id==='trico-marana-santa-cruz'?trico:null;
 assert.equal((await createForecastEngine({fetchImpl,junctionLoader}).inundation({junctionId:'trico-marana-santa-cruz'})).status,'disabled');assert.equal(calls,0);
 const e=createForecastEngine({enabled:true,fetchImpl,junctionLoader,clock:()=>now});
 assert.equal((await e.inundation({junctionId:'los-robles'})).status,'unsupported');assert.equal(calls,0);
 const r=await e.inundation({junctionId:'trico-marana-santa-cruz'});assert.equal(r.status,'ok');assert.ok(r.extent.wetCells>0);
 fail=true;const down=await e.inundation({junctionId:'trico-marana-santa-cruz',force:true});assert.equal(down.status,'unavailable');assert.equal(down.extent,undefined);
 const broken=createForecastEngine({enabled:true,fetchImpl,junctionLoader:async()=>{throw Error('bad file');},clock:()=>now});assert.equal((await broken.inundation({junctionId:'x'})).status,'unavailable');
});

test('all four labels appear on every result, with no invented accuracy',()=>{
 for(const r of [estimateFromFlow(trico,100,{now}),estimateFromFlow(trico,1e9,{now}),estimateFromForecast(trico,forecast(),{now})]){
  assert.match(r.labels.estimatedExtent,/^Estimated extent, not observed water/);
  assert.match(r.labels.sourceAge,/uploaded 2024-08-17, 2\.2 years/);assert.match(r.labels.sourceAge,/no FIM version/);
  assert.match(r.labels.missingCoverage,/No estimate for \d+%/);
  assert.match(r.labels.uncertainty,/Not measured: no ± is available/);assert.match(r.labels.uncertainty,/not calibrated/);
  assert.equal(r.uncertainty.plusMinus,null);
 }
 assert.match(estimateFromFlow(trico,100,{now}).labels.estimatedExtent,/chosen flow, not a forecast/);
 assert.match(estimateFromForecast(trico,forecast(),{now}).labels.sourceAge,/Forecast issued/);
});

test('nothing says whether a road can be used',()=>{
 const {masks,...r}=estimateFromForecast(trico,forecast(),{now});
 const {limitations,...shown}=r;
 assert.doesNotMatch(JSON.stringify(shown),VERDICT);
 for(const field of ['passable','passability','roadStatus','roadWet','wetAtCrossing','verdict','rating'])assert.equal(field in r,false);
 for(const file of ['public/simulation/inundation.html','public/simulation/inundation-app.js','public/simulation/hand-inundation.js'])assert.doesNotMatch(text(file).replace(/^\/\/.*$/gm,'').replace('No passability, closure or bridge condition is inferred.',''),VERDICT,file);
 // The crossing is a location marker only: the extent never reports on that cell.
 assert.doesNotMatch(text('public/simulation/inundation-app.js'),/handAtCrossing/);
});

test('app links to the layer, and the coverage doc lists exactly the built junctions',()=>{
 assert.match(text('public/index.html'),/href="simulation\/inundation.html"/);
 assert.match(text('public/simulation/forecast.html'),/href="inundation.html"/);
 const doc=text('docs/HAND-INUNDATION.md');
 for(const j of Object.values(index))assert.ok(doc.includes(j.name),j.name);
 for(const [status,count] of Object.entries(coverage.counts))assert.match(doc,new RegExp(`\`${status}\` \\| ${count} `));
 assert.equal(coverage.points.length,Object.values(coverage.counts).reduce((a,b)=>a+b));
});

test('tool and app agree on station identities',()=>{
 const tool=text('tools/hand/hand_tool.py');
 for(const [id,s] of Object.entries(FORECAST_STATIONS))assert.ok(tool.includes(`'${id}': {'usgsId': '${s.usgsId}', 'reachId': '${s.reachId}'}`),id);
});
