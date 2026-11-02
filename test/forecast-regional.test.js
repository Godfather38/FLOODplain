import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {normalizeForecast,createForecastEngine} from '../public/simulation/forecast-engine.js';
const read=(id,type)=>JSON.parse(readFileSync(new URL(`../public/simulation/data/nwps-${id.toLowerCase()}-${type}.json`,import.meta.url),'utf8'));
const now=Date.parse('2026-11-01T08:00:00Z');
test('three real station forecasts retain identities and explicit absence of inundation',()=>{
 for(const id of ['SCTA3','CSCA3','BWTA3']){const r=normalizeForecast(read(id,'metadata'),read(id,'stageflow'),{now,siteId:id});assert.equal(r.status,'ok');assert.equal(r.siteId,id);assert.equal(r.inundation.status,'unavailable');assert.ok(r.provenance.forecastUrl.includes(id));assert.ok(r.points.length>100);}
 assert.equal(normalizeForecast(read('CSCA3','metadata'),read('CSCA3','stageflow'),{now,siteId:'SCTA3'}).status,'unsupported');
});
test('no forecast, provider sentinel, timezone ambiguity, expiration and future clock are explicit',()=>{
 const m=read('BWTA3','metadata'),raw=read('BWTA3','stageflow');
 const empty=structuredClone(raw);empty.forecast.data=[];const no=normalizeForecast(m,empty,{now});assert.equal(no.status,'no_forecast');assert.equal(no.inundation.status,'unavailable');
 for(const change of [r=>r.forecast.data[0].primary=-999,r=>r.forecast.data[0].secondary=-999,r=>r.forecast.data[0].validTime='2026-10-31T13:00:00',r=>r.forecast.issuedTime='2026-10-31T17:06:00']){const bad=structuredClone(raw);change(bad);assert.equal(normalizeForecast(m,bad,{now}).status,'insufficient_data');}
 assert.equal(normalizeForecast(m,raw,{now,retrievedAt:'2026-11-02T08:00:00Z'}).status,'insufficient_data');
 assert.equal(normalizeForecast(m,raw,{now:now+10*86400000}).status,'expired');
});
test('cache is per station, and backward clock movement forces revalidation',async()=>{
 let at=now,calls=0;const engine=createForecastEngine({enabled:true,clock:()=>at,fetchImpl:async url=>{calls++;const id=url.split('/')[6];return{ok:true,json:async()=>read(id,url.endsWith('/stageflow')?'stageflow':'metadata')};}});
 const a=await engine.predict({siteId:'CSCA3'}),b=await engine.predict({siteId:'BWTA3'});assert.equal(a.siteId,'CSCA3');assert.equal(b.siteId,'BWTA3');assert.equal(calls,4);
 assert.equal((await engine.predict({siteId:'CSCA3'})).delivery,'cache');assert.equal(calls,4);
 at-=60000;assert.equal((await engine.predict({siteId:'CSCA3'})).delivery,'network');assert.equal(calls,6);
});
test('existing app exposes advanced map navigation and retains river forecast details',()=>{
 const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 const layers=readFileSync(new URL('../public/simulation/map-layers.js',import.meta.url),'utf8');
 const shell=readFileSync(new URL('../public/simulation/map-shell.js',import.meta.url),'utf8');
 assert.match(app,/mountFloodLayers\(map/,'existing app must mount the map enhancement');
 assert.match(layers,/mountMapShell\(host,map/,'map enhancement must mount the accessible shell');
 assert.match(shell,/entryNav=document.createElement\('nav'\)/);
 assert.match(shell,/entryNav.setAttribute\('aria-label','Experimental features'\)/);
 assert.match(shell,/advancedLink.href='#\/map'/);
 assert.match(shell,/entryNav.append\(advancedLink\)/);
 assert.match(shell,/forecastLink.href='inundation\/index.html'/);
 assert.match(shell,/forecastLink.textContent='River forecast details'/);
 assert.match(shell,/options.append\(forecastLink\)/,'forecast remains reachable in Map options');
 const target=readFileSync(new URL('../public/inundation/index.html',import.meta.url),'utf8');
 assert.match(target,/<h1>Estimated flood extent<\/h1>/);
 assert.match(target,/id="junction"/);
 assert.match(target,/Use recorded forecast/);
});
test('explicit forecast withdrawal invalidates previously cached curve',async()=>{
 let withdrawn=false;const engine=createForecastEngine({enabled:true,clock:()=>now,fetchImpl:async url=>({ok:true,json:async()=>{const raw=read('SCTA3',url.endsWith('/stageflow')?'stageflow':'metadata');if(withdrawn&&raw.forecast)raw.forecast.data=[];return raw;}})});
 assert.equal((await engine.predict()).status,'ok');withdrawn=true;
 assert.equal((await engine.predict({force:true})).status,'no_forecast');assert.equal((await engine.predict()).status,'no_forecast');
});
