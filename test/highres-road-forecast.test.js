import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { ALL_ROUTE_CASES, highResolutionRoadForecast, mergeRoadForecasts, roadForecast, roadForecastPoint } from '../public/road-forecast.js';
import { loadRoadForecasts } from '../public/simulation/live-road-forecast.js';
import { withRoadForecast, evaluate } from '../public/engine.js';
import { makeGas } from './gas-mock.js';
const NOW = Date.parse('2026-11-06T01:00:00Z'), H = 3600e3;
const iso = (t) => new Date(t).toISOString();
function summary(name = 'gates', depth = .4) {
  return {schemaVersion:1,kind:'live_all_route_road_forecast',executionMode:'live_current_forcing',status:'complete',case:name,
    runId:name+'-live',issuedAt:iso(NOW-15*60000),hrrrCycle:iso(NOW-H),validFrom:iso(NOW-H),validTo:iso(NOW+H),
    times:[iso(NOW-H),iso(NOW),iso(NOW+H)],routes:Object.fromEntries(ALL_ROUTE_CASES[name].map(id=>[id,{
      totalStations:3,mappedStations:3,outsideStations:0,unknownHeightStations:0,
      frames:[0,0,depth].map(peakRoadDepthM=>({peakRoadDepthM,validStations:3,wetStations:peakRoadDepthM>0?1:0,lat:32.23,lon:-111.12,deck:false,coverage:'complete'}))}]))};
}
const coarse = (maxOver=.1) => ({status:'ok',runId:'coarse-live',issuedAt:iso(NOW-10*60000),routes:{'pr-gates':{maxOver,level:maxOver>=.3?'danger':'caution',cells:2,time:NOW+H,lat:32.2,lon:-111.1,deck:false}}});
test('high-resolution owning case supplies current route forecast and ignores earlier peaks',()=>{
  const s=summary();s.routes['pr-gates'].frames[0].peakRoadDepthM=2;
  const f=highResolutionRoadForecast(s,'gates',NOW);
  assert.equal(f.status,'ok');assert.equal(f.routes['pr-gates'].maxOver,.4);assert.equal(f.routes['pr-gates'].time,NOW+H);
  assert.equal(f.routes['pr-gates'].coverage,'complete');
});
test('wrong case, saved replay, incomplete solver and malformed time data are rejected independently',()=>{
  for(const change of [s=>s.case='northern',s=>s.executionMode='saved',s=>s.status='partial',s=>s.times={},s=>s.times[1]='invalid',s=>s.times[1]=s.times[0],s=>s.validTo=iso(NOW+2*H),s=>s.runId='']){
    const s=summary();change(s);assert.equal(highResolutionRoadForecast(s,'gates',NOW).status,'unavailable');
  }
});
test('stale, future-issued and past forecast windows never become current',()=>{
  for(const change of [s=>s.issuedAt=iso(NOW-4*H),s=>s.issuedAt=iso(NOW+H)]){const s=summary();change(s);assert.equal(highResolutionRoadForecast(s,'gates',NOW).status,'stale');}
  assert.equal(highResolutionRoadForecast(summary(),'gates',NOW+H+1).status,'stale');
});
test('null and missing road frames are unknown, never dry',()=>{
  const s=summary();s.routes['pr-gates'].frames.forEach(f=>{f.peakRoadDepthM=null;f.validStations=0;f.coverage='unavailable';});
  const f=mergeRoadForecasts(null,{gates:s},NOW);assert.equal(f.status,'unavailable');assert.equal(f.routes['pr-gates'],undefined);
});
test('complete native dry forecast is valid but does not lower an official closure',()=>{
  const f=mergeRoadForecasts(coarse(.5),{gates:summary('gates',0)},NOW), r=f.routes['pr-gates'];
  assert.equal(r.source,'high_resolution');assert.equal(r.level,'ok');
  assert.equal(withRoadForecast({id:'pr-gates',level:'danger',points:[]},f).level,'danger');
  assert.doesNotMatch(roadForecastPoint('pr-gates',r).why,/\bsafe\b/i);
});
test('partial dry results do not claim the unmodeled road is dry',()=>{
  const s=summary('gates',0);s.routes['pr-gates'].outsideStations=1;s.routes['pr-gates'].mappedStations=2;
  s.routes['pr-gates'].frames.forEach(f=>{f.validStations=2;f.coverage='partial';});
  assert.equal(mergeRoadForecasts(null,{gates:s},NOW).routes['pr-gates'],undefined);
  assert.equal(mergeRoadForecasts(coarse(),{gates:s},NOW).routes['pr-gates'].source,'coarse_fallback');
});
test('partial wet result can raise a rating, discloses its gap and retains stronger coarse evidence',()=>{
  const s=summary();s.routes['pr-gates'].frames[1].peakRoadDepthM=null;
  const f=mergeRoadForecasts(null,{gates:s},NOW);assert.equal(f.routes['pr-gates'].level,'danger');
  assert.match(roadForecastPoint('pr-gates',f.routes['pr-gates']).why,/coverage is incomplete/i);
  assert.equal(mergeRoadForecasts(coarse(.6),{gates:s},NOW).routes['pr-gates'].source,'coarse_fallback');
});
test('each case is independent; only current owning cases replace coarse routes',()=>{
  const north=summary('northern',.2), gates=summary();gates.issuedAt=iso(NOW-8*H);
  const f=mergeRoadForecasts(coarse(),{northern:north,gates},NOW);
  assert.equal(f.routes.trico.source,'high_resolution');assert.equal(f.routes['pr-gates'].source,'coarse_fallback');
  assert.equal(f.routeStatus['pr-ina'].status,'unavailable');
  assert.match(roadForecastPoint('pr-gates',f.routes['pr-gates']).why,/Coarse model fallback/);
});
test('coarse fallback with no cells or only absent values cannot claim road coverage',()=>{
  const t={routes:{'pr-gates':[[0,600,599,-111,32,false]]}},m={issuedAt:iso(NOW)},w={frames:[{time:iso(NOW),surfaceM:[null]},{time:iso(NOW+H),surfaceM:[-99999]}]};
  const f=roadForecast(t,m,w,NOW);assert.equal(f.routes['pr-gates'].cells,0);
  assert.equal(mergeRoadForecasts(f,{},NOW).routes['pr-gates'],undefined);
});
function sources() {
  const table=JSON.parse(readFileSync(new URL('../public/data/road-cells.json',import.meta.url))),manifest={runId:'coarse-live',issuedAt:iso(NOW-10*60000)};
  const n=Math.max(...Object.values(table.routes).flat().map(x=>x[0]))+1;
  const water={frames:[0,1].map(k=>({time:iso(NOW+k*H),surfaceM:Array(n).fill(0)}))};
  return {table,manifest,water,cases:{northern:summary('northern',.15),'picture-rocks':summary('picture-rocks',0),gates:summary('gates',.4)}};
}
function bodyFor(url,s) {
  if(url.includes('road-cells.json'))return s.table;
  const c=/all-route\/([^/]+)\/compact\/road-forecast.json/.exec(url)?.[1];
  if(c)return s.cases[c];
  if(url.includes('/live/manifest.json'))return s.manifest;
  if(url.includes('/live/water.json.gz'))return s.water;
  return {features:[],data:[],d:[]};
}
test('browser loader tolerates a failed case and coarse failure without losing Gates',async()=>{
  const s=sources();const f=await loadRoadForecasts({now:NOW,fetchImpl:async u=>{
    const url=String(u);if(!url.includes('all-route/gates'))return new Response('',{status:503});
    return Response.json(bodyFor(url,s));
  }});
  assert.equal(f.routes['pr-gates'].source,'high_resolution');assert.equal(f.routeStatus.trico.status,'unavailable');
});
test('browser and built Apps Script produce identical selected high-resolution forecasts',async()=>{
  const s=sources();
  const browser=await loadRoadForecasts({now:NOW,fetchImpl:async u=>{const url=String(u),body=bodyFor(url,s);return url.includes('water.json.gz')?new Response(gzipSync(JSON.stringify(body))):Response.json(body);}});
  let batchCount=0;
  const gas=makeGas({now:NOW},readFileSync(new URL('../apps-script/WashWatch.gs',import.meta.url),'utf8'),reqs=>{batchCount++;return reqs.map(({url})=>{
    const body=bodyFor(url,s);return {getResponseCode:()=>200,getContentText:()=>JSON.stringify(body),getBlob:()=>({bytes:gzipSync(JSON.stringify(body)),setContentType(){return this;}})};
  });});
  gas.api.computeVerdict_('picture-rocks');
  const service=JSON.parse(gas.cache.get('roadforecast'));
  assert.deepEqual(service,browser);assert.equal(service.routes['pr-gates'].level,'danger');
  gas.api.computeVerdict_('picture-rocks');assert.equal(batchCount,1,'versioned fresh result is reused');
});

test('route-first startup does not dereference the model module before it loads',()=>{
  const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  assert.match(app,/r\.sfincs\?\.maxOver > sfincsModel\?\.COVER_M/);
  const r={},sfincsModel=null;
  assert.equal(r.sfincs?.maxOver > sfincsModel?.COVER_M,false);
});


test('one available case does not hide missing model coverage in another alert area',()=>{
  const sfincs=mergeRoadForecasts(null,{gates:summary()},NOW);
  const routes=JSON.parse(readFileSync(new URL('../public/data/routes.geojson',import.meta.url))).features;
  const v=evaluate({now:NOW,usgs:{},closures:{features:[]},alert:{rain:[],stream:[]},nws:{features:[]},routes,sfincs},'avra');
  assert.ok(v.missing.includes('flood model'));
  assert.match(v.sms,/flood model/);
});

test('partial tiny positive water stays visible below the warning threshold',()=>{
  const s=summary('gates',.01);s.routes['pr-gates'].outsideStations=1;s.routes['pr-gates'].mappedStations=2;
  s.routes['pr-gates'].frames.forEach(f=>{f.validStations=2;f.coverage='partial';});
  const r=mergeRoadForecasts(null,{gates:s},NOW).routes['pr-gates'];
  assert.equal(r.maxOver,.01);assert.equal(r.level,'ok');assert.equal(r.coverage,'partial');
  assert.match(roadForecastPoint('pr-gates',r).why,/0\.03 ft of modeled water/);
  assert.match(roadForecastPoint('pr-gates',r).why,/coverage is incomplete/);
  s.routes['pr-gates'].frames.forEach(f=>f.peakRoadDepthM=0);
  assert.equal(mergeRoadForecasts(null,{gates:s},NOW).routes['pr-gates'],undefined);
});
