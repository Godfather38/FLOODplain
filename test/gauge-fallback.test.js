import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadGaugeReadings } from '../public/gauge-feed.js';
import { parseContinuous } from '../public/logic.js';
const now=Date.parse('2026-11-01T06:00:00Z');
const raw=(value=0,time=now-60000)=>({features:[{properties:{parameter_code:'00060',time:new Date(time).toISOString(),value:String(value)}}]});
const setup=(responses,saved={})=>{
 const values=new Map(Object.entries(saved));const calls=[];
 return {calls,values,options:{now,proxyUrl:'proxy',directUrl:s=>s,parse:parseContinuous,store:{get:k=>values.get(k),set:(k,v)=>values.set(k,v)},fetchJson:async url=>{calls.push(url);const r=responses[url];if(r instanceof Error)throw r;return r;}}};
};
test('partial proxy recovers only missing gauges and caches successful shared readings',async()=>{
 const s=setup({proxy:{series:{a:raw(4)}},b:raw(5)});
 const r=await loadGaugeReadings(['a','b'],s.options);
 assert.deepEqual(r.series.map(x=>x['00060'][0].v),[4,5]);assert.deepEqual(s.calls,['proxy','b']);
 assert.deepEqual(s.values.get('usgs:a').json,raw(4));
});
test('proxy outage reuses recent cache without extra upstream calls',async()=>{
 const s=setup({proxy:Error('offline')},{'usgs:a':{at:now-1000,json:raw(7)}});
 const r=await loadGaugeReadings(['a'],s.options);assert.equal(r.series[0]['00060'][0].v,7);assert.deepEqual(s.calls,['proxy']);
});
test('429 and malformed gauge data retain old observations without renewing their timestamps',async()=>{
 const old=raw(8,now-86400000),saved={at:now-3600000,json:old};
 const s=setup({proxy:{series:{a:{features:{bad:true}}}},a:Object.assign(Error('rate limited'),{status:429})},{'usgs:a':saved});
 const r=await loadGaugeReadings(['a'],s.options);assert.equal(r.busy,true);assert.equal(r.series[0]['00060'][0].t,now-86400000);assert.deepEqual(s.values.get('usgs:a'),saved);
});
test('an older service response cannot replace a newer cached observation',async()=>{
 const saved={at:now-1000,json:raw(9)};const s=setup({proxy:{series:{a:raw(1,now-3600000)}}},{'usgs:a':saved});
 const r=await loadGaugeReadings(['a'],s.options);assert.equal(r.series[0]['00060'][0].v,9);assert.deepEqual(s.values.get('usgs:a'),saved);
});
