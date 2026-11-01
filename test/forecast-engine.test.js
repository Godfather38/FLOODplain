import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeForecast,createForecastEngine} from '../public/simulation/forecast-engine.js';
const read=n=>JSON.parse(readFileSync(new URL('../public/simulation/data/'+n,import.meta.url),'utf8'));
const metadata=read('nwps-scta3-metadata.json'),series=read('nwps-scta3-stageflow.json'),now=Date.parse('2026-11-01T07:00:00Z');
test('real NOAA response converts kcfs, selects future peak, preserves provider context without fabricated accuracy',()=>{
 const r=normalizeForecast(metadata,series,{now});assert.equal(r.status,'ok');assert.ok(Math.abs(r.points[0].flowM3s-.0301*1000*.028316846592)<1e-12);assert.equal(r.peak.flowM3s,Math.max(...r.points.map(p=>p.flowM3s)));assert.equal(r.uncertainty.plusMinus,null);assert.equal(r.providerContext.inundationEnabled,false);assert.equal(r.providerContext.categories.minor.stage,14);
});
test('unsupported identities, missing values, stale and expired forecasts fail explicitly',()=>{
 assert.equal(normalizeForecast({...metadata,lid:'wrong'},series,{now}).status,'unsupported');
 const bad=structuredClone(series);bad.forecast.data[0].secondary=null;assert.equal(normalizeForecast(metadata,bad,{now}).status,'insufficient_data');
 assert.equal(normalizeForecast(metadata,series,{now:now+24*3600000}).status,'stale');
 assert.equal(normalizeForecast(metadata,series,{now:now+10*86400000}).status,'expired');
});
test('engine is opt-in, caches response, and marks failed refresh unavailable instead of silently serving live',async()=>{
 let calls=0,fail=false;const fetchImpl=async url=>{calls++;if(fail)throw Error('offline');return {ok:true,json:async()=>url.endsWith('stageflow')?series:metadata};};
 assert.equal((await createForecastEngine({fetchImpl}).predict()).status,'disabled');assert.equal(calls,0);
 const e=createForecastEngine({enabled:true,fetchImpl,clock:()=>now});assert.equal((await e.predict()).status,'ok');assert.equal(calls,2);assert.equal((await e.predict()).delivery,'cache');assert.equal(calls,2);
 fail=true;const r=await e.predict({force:true});assert.equal(r.status,'unavailable');assert.equal(r.delivery,'cached_after_error');assert.ok(r.points.length);
 assert.equal((await e.predict({siteId:'other'})).status,'unsupported');
});
