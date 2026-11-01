import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import {FORECAST_STATIONS} from '../public/inundation/forecast-stations.js';
import {createForecastProvider,normalizeForecast,normalizeReachForecast} from '../public/inundation/forecast-provider.js';
import {computeExtent,createInundationLayer,decodeJunction,estimateFromFlow,estimateFromForecast,missingCoverageResult,stageForFlow} from '../public/inundation/hand-inundation.js';
const text=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const data=n=>JSON.parse(text('public/inundation/data/'+n));
const coverage=data('coverage.json'),supported=coverage.points.filter(p=>p.status==='supported');
const load=row=>decodeJunction(data(row.file));
const crossingsAt=JSON.parse(text('public/data/crossings.geojson')).features;
const trico=load(supported.find(p=>p.road==='West Trico Marana Road'));
const metadata=data('nwps-scta3-metadata.json'),series=data('nwps-scta3-stageflow.json'),now=Date.parse('2026-11-01T07:22:17Z');
const forecast=()=>normalizeForecast(metadata,series,{now,siteId:'SCTA3'});
const nwmJunction=load(supported.find(p=>p.forecast.kind==='nwm_reach'));
const VERDICT=/passable|impassable|\bsafe\b|unsafe|road is|can cross|cannot cross|drivable|turn around/i;

test('every crossing has exactly one recorded outcome',()=>{
 const keys=new Set(crossingsAt.map(f=>f.geometry.coordinates.map(n=>n.toFixed(5)).join()));
 assert.equal(coverage.points.length,keys.size);
 assert.equal(new Set(coverage.points.map(p=>p.id)).size,keys.size);
 assert.equal(coverage.points.length,Object.values(coverage.counts).reduce((a,b)=>a+b));
 for(const p of coverage.points){assert.ok(p.evidence);assert.ok(keys.has([p.lon,p.lat].map(n=>n.toFixed(5)).join()));assert.equal(p.status==='supported',Boolean(p.file));}
 const files=readdirSync(new URL('../public/inundation/data/',import.meta.url)).filter(f=>!f.startsWith('nwps-')&&f.endsWith('.json')&&f!=='coverage.json').sort();
 assert.deepEqual(files,supported.map(p=>p.file).sort());
});

test('every supported crossing keeps the NOAA grid and passes its checks',()=>{
 for(const row of supported){
  const raw=data(row.file),j=decodeJunction(raw);
  const hash=createHash('sha256').update(Buffer.from(raw.grid.handCm,'base64')).update(Buffer.from(raw.grid.catchment,'base64')).digest('hex');
  assert.equal(hash,raw.grid.sha256,row.id);
  assert.ok(j.reach.crossingDistanceM<=coverage.maxReachDistanceM,row.id);
  assert.ok(j.verification.validHandFractionOfReachCells>=.95,row.id);
  if(j.crossing.water&&j.reach.name)assert.equal(j.reach.name.toLowerCase(),j.crossing.water.toLowerCase(),row.id);
  assert.doesNotMatch(j.reach.name,/aqueduct/i,row.id);
  if(j.forecast.kind==='gauge'){assert.equal(j.reach.featureId,FORECAST_STATIONS[j.forecast.station].reachId);assert.ok(j.gauge.alongChannelKm<=10);}
  else{assert.equal(j.forecast.reachId,j.reach.featureId);assert.equal(data(`nwm/${j.reach.featureId}.json`).response.reach.reachId,j.reach.featureId);}
 }
});

test('browser extent matches the area worked out on NOAA\'s own grid',()=>{
 for(const row of supported){
  const j=load(row);
  for(const [flow,area] of Object.entries(j.verification.nativeGridWetAreaM2)){
   const got=computeExtent(j,Number(flow));
   if(!got)continue; // Above a curve's top: the app gives no extent there.
   assert.ok(Math.abs(got.wetAreaM2-area)<=Math.max(.02*area,5000),`${row.id} at ${flow}: ${got.wetAreaM2} vs ${area}`);
  }
 }
});

test('rating lookup interpolates and never goes past the curve',()=>{
 const curve={stageM:[0,1,2],dischargeM3s:[0,10,30]};
 assert.equal(stageForFlow(curve,5),.5);assert.equal(stageForFlow(curve,20),1.5);assert.equal(stageForFlow(curve,30),2);
 assert.equal(stageForFlow(curve,31),null);assert.equal(stageForFlow(curve,-1),null);assert.equal(stageForFlow(curve,NaN),null);
 assert.equal(stageForFlow({stageM:[0,1,2],dischargeM3s:[0,0,10]},0),0);
});

test('more flow never shrinks the extent, zero flow shows nothing, and cells without data are never wet',()=>{
 let last=0;
 for(const flow of [1,10,100,1000,10000]){const e=computeExtent(trico,flow);assert.ok(e.wetCells>=last);last=e.wetCells;
  for(let i=0;i<e.mask.length;i++)if(trico.catchment[i]===trico.grid.catchmentNone||trico.handCm[i]===trico.grid.handNodata)assert.equal(e.mask[i],0);}
 assert.equal(computeExtent(trico,0).wetCells,0);
 assert.match(estimateFromFlow(trico,0,{now}).reason,/zero/);
 const r=estimateFromFlow(trico,1e9,{now});assert.equal(r.status,'beyond_rating');assert.equal(r.extent,undefined);
});

test('gauge forecast connects through the matching reach',()=>{
 const f=forecast(),r=estimateFromForecast(trico,f,{now});
 assert.equal(r.status,'ok');assert.equal(r.source,'forecast');assert.equal(r.flowM3s,f.peak.flowM3s);assert.ok(r.extent.wetCells>0);
 const later=f.points.at(-1);assert.equal(estimateFromForecast(trico,f,{now,time:later.time}).flowM3s,later.flowM3s);
 assert.equal(estimateFromForecast(trico,f,{now,time:'2000-01-01T00:00:00Z'}).status,'insufficient_data');
 assert.equal(estimateFromForecast({...trico,reach:{...trico.reach,featureId:'1'}},f,{now}).status,'unsupported');
});

test('recorded model forecast is read strictly and labeled as a model',()=>{
 const id=nwmJunction.forecast.reachId,saved=data(`nwm/${id}.json`),at=Date.parse(saved.recordedAt);
 const f=normalizeReachForecast(saved.response,{now:at,reachId:id});assert.equal(f.status,'ok');assert.equal(f.nwmReachId,id);
 const r=estimateFromForecast(nwmJunction,f,{now:at});assert.equal(r.status,'ok');
 assert.match(r.labels.estimatedExtent,/National Water Model/);assert.match(r.labels.uncertainty,/not a gauge reading/);
 assert.equal(normalizeReachForecast(saved.response,{now:at,reachId:'1'}).status,'unsupported');
 for(const change of [x=>x.shortRange.series.data[0].flow=null,x=>x.shortRange.series.data[0].flow=-1,x=>x.shortRange.series.data[0].validTime='2026-11-01T06:00:00',x=>x.shortRange.series.referenceTime='soon']){const bad=structuredClone(saved.response);change(bad);assert.equal(normalizeReachForecast(bad,{now:at,reachId:id}).status,'insufficient_data');}
 const empty=structuredClone(saved.response);empty.shortRange={};assert.equal(normalizeReachForecast(empty,{now:at,reachId:id}).status,'no_forecast');
 const units=structuredClone(saved.response);units.shortRange.series.units='gallons';assert.equal(normalizeReachForecast(units,{now:at,reachId:id}).status,'unsupported');
 assert.equal(normalizeReachForecast(saved.response,{now:at+10*86400000,reachId:id}).status,'expired');
});

test('old forecasts are marked, and unusable forecasts give no extent',()=>{
 const stale=normalizeForecast(metadata,series,{now:now+24*3600000,siteId:'SCTA3'}),a=estimateFromForecast(trico,stale,{now:now+24*3600000});
 assert.equal(a.status,'stale');assert.ok(a.extent);assert.match(a.reason,/old forecast/);
 const expired=normalizeForecast(metadata,series,{now:now+10*86400000,siteId:'SCTA3'}),b=estimateFromForecast(trico,expired,{now:now+10*86400000});
 assert.equal(b.status,'expired');assert.equal(b.extent,undefined);assert.equal(b.masks,undefined);
});

const localFetch=(fail=()=>false)=>async url=>{
 const u=String(url);
 if(fail(u))throw Error('offline');
 if(u.startsWith('file:')||u.includes('/inundation/data/')){const name=u.split('/inundation/data/')[1];return{ok:true,json:async()=>data(name)};}
 return{ok:true,json:async()=>u.endsWith('stageflow')?series:metadata};
};

test('layer is opt-in, labels gaps, and shows no extent on failed refresh',async()=>{
 let noaa=0;const fetchImpl=localFetch(u=>{if(u.includes('api.water.noaa.gov'))noaa++;return false;});
 const id=supported.find(p=>p.road==='West Trico Marana Road').id;
 assert.equal((await createInundationLayer({fetchImpl}).inundation({junctionId:id})).status,'disabled');assert.equal(noaa,0);
 assert.equal((await createForecastProvider({fetchImpl}).predict({kind:'gauge',station:'SCTA3'})).status,'disabled');assert.equal(noaa,0);
 const layer=createInundationLayer({enabled:true,fetchImpl,clock:()=>now});
 assert.equal((await layer.inundation({junctionId:'nowhere'})).status,'unsupported');
 const gap=coverage.points.find(p=>p.status!=='supported'),missing=await layer.inundation({junctionId:gap.id});
 assert.equal(missing.status,'missing_coverage');assert.equal(missing.extent,undefined);assert.equal(noaa,0);
 const r=await layer.inundation({junctionId:id});assert.equal(r.status,'ok');assert.ok(r.extent.wetCells>0);
 const down=createInundationLayer({enabled:true,fetchImpl:localFetch(u=>u.includes('api.water.noaa.gov')),clock:()=>now});
 const off=await down.inundation({junctionId:id});assert.equal(off.status,'unavailable');assert.equal(off.extent,undefined);
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
 for(const row of coverage.points.filter(p=>p.status!=='supported')){
  const r=missingCoverageResult(row);
  assert.match(r.labels.missingCoverage,/^Missing coverage: /);assert.ok(r.labels.estimatedExtent&&r.labels.sourceAge&&r.labels.uncertainty);assert.equal(r.extent,undefined);
 }
});

test('nothing says whether a road can be used',()=>{
 const {masks,limitations,...shown}=estimateFromForecast(trico,forecast(),{now});
 assert.doesNotMatch(JSON.stringify(shown),VERDICT);
 for(const field of ['passable','passability','roadStatus','roadWet','wetAtCrossing','verdict'])assert.equal(field in shown,false);
 for(const row of coverage.points)assert.doesNotMatch(JSON.stringify(missingCoverageResult(row)),VERDICT);
 for(const file of ['public/inundation/index.html','public/inundation/app.js','public/inundation/hand-inundation.js','public/inundation/forecast-provider.js'])assert.doesNotMatch(text(file).replace(/^\/\/.*$/gm,'').replace('No passability, closure or bridge condition is inferred.',''),VERDICT,file);
});

test('app links to the layer, and the doc matches the coverage file',()=>{
 assert.match(text('public/index.html'),/href="inundation\/index.html"/);
 const doc=text('docs/HAND-INUNDATION.md');
 for(const [status,count] of Object.entries(coverage.counts))assert.match(doc,new RegExp(`\`${status}\` \\| ${count} `),status);
 for(const p of coverage.points)assert.ok(doc.includes(p.id),p.id);
});

test('tool and app agree on station identities',()=>{
 const tool=text('tools/hand/hand_tool.py');
 for(const [id,s] of Object.entries(FORECAST_STATIONS))assert.ok(tool.includes(`'${id}': {'usgsId': '${s.usgsId}', 'reachId': '${s.reachId}'}`),id);
});
