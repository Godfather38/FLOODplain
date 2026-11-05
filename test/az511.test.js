import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeAZ511, createAZ511Adapter} from '../worker/az511.js';
import {az511Events} from '../worker/fixtures/az511.js';
import {createWorker} from '../worker/index.js';
const now = Date.parse('2026-11-04T20:00:00-07:00');
const env = {PUBLIC_LIVE:'true', AZ511_ENABLED:'true', AZ511_API_KEY:'synthetic-test-key'};

test('Arizona fixtures distinguish future ramp/frontage, ongoing mainline and expired events', () => {
  const events = normalizeAZ511(az511Events, now);
  assert.deepEqual(events.map(e=>e.timingStatus), ['scheduled','scheduled','active','ended']);
  assert.deepEqual(events.map(e=>e.scope), ['ramp','frontage','mainline','unknown']);
  assert.equal(events[0].start, Date.parse('2026-11-16T01:00:00Z'));
  assert.equal(events[0].stop, Date.parse('2026-11-17T13:00:00Z'));
  assert.equal(events[0].description, az511Events[0].Description);
  assert.equal(events[0].source, 'AZ511');
  assert.equal(events[0].link, 'https://www.az511.com/');
});
test('Arizona start inclusive/end exclusive, including UTC date rollover', () => {
  const row = az511Events[0];
  for (const [time, status] of [['2026-11-16T00:59:59Z','scheduled'],['2026-11-16T01:00:00Z','active'],['2026-11-17T12:59:59Z','active'],['2026-11-17T13:00:00Z','ended']])
    assert.equal(normalizeAZ511([row],Date.parse(time))[0].timingStatus,status);
  const summer={...row, StartDate:Date.parse('2026-07-01T18:00:00-07:00')/1000, PlannedEndDate:Date.parse('2026-07-02T06:00:00-07:00')/1000};
  assert.equal(normalizeAZ511([summer],Date.parse('2026-07-02T01:00:00Z'))[0].timingStatus,'active');
});
test('missing, invalid, reversed, millisecond and string dates never claim active', () => {
  for (const value of [null,undefined,0,-1,'1790000000',now,NaN]) {
    const e=normalizeAZ511([{...az511Events[2],StartDate:value}],now)[0];
    assert.equal(e.timingStatus,'unknown'); assert.equal(e.timingUnknown,true);
  }
  assert.equal(normalizeAZ511([{...az511Events[2],PlannedEndDate:1}],now)[0].timingStatus,'unknown');
});
test('recurrence is retained but never treated as continuous activity', () => {
  const row={...az511Events[2], Recurrence:'night work', RecurrenceSchedules:'undocumented schedule'};
  const e=normalizeAZ511([row],now)[0];
  assert.equal(e.timingStatus,'unknown'); assert.equal(e.timingUnknown,true);
  assert.equal(e.dailyStart,null); assert.equal(e.recurrenceSchedules,row.RecurrenceSchedules);
  assert.equal(normalizeAZ511([{...row,RecurrenceSchedules:{unexpected:true}}],now)[0].timingUnknown,true);
});
test('full closure is strict, unknown scope stays unknown, malformed envelope fails', () => {
  assert.equal(normalizeAZ511([{ID:9,IsFullClosure:'true'}],now)[0].closed,false);
  assert.equal(normalizeAZ511([{ID:9,RoadwayName:'I-10'}],now)[0].scope,'unknown');
  for(const rows of [{events:[]},null,[null],[{ID:'9'}]]) assert.throws(()=>normalizeAZ511(rows,now));
});
test('disabled or missing secret never fetches', async () => {
  const load=createAZ511Adapter({fetcher:()=>{throw Error('unexpected fetch');}});
  assert.equal((await load()).status,'disabled');
  assert.equal((await load({...env,PUBLIC_LIVE:'false'})).status,'disabled');
  assert.equal((await load({...env,AZ511_API_KEY:''})).status,'unconfigured');
});
test('documented fixed endpoint, query key, redirect rejection and cache reclassification', async () => {
  let calls=0, time=az511Events[0].StartDate*1000-1000;
  const load=createAZ511Adapter({clock:()=>time,fetcher:async(url,options)=>{
    calls++; const u=new URL(url);
    assert.equal(u.origin+u.pathname,'https://az511.com/api/v2/get/event');
    assert.equal(u.searchParams.get('key'),env.AZ511_API_KEY);
    assert.equal(u.searchParams.get('format'),'json'); assert.equal(options.redirect,'error');
    return Response.json(az511Events);
  }});
  const first=await load(env); assert.equal(first.events[0].timingStatus,'scheduled');
  time+=2000;
  const second=await load(env); assert.equal(second.events[0].timingStatus,'active');
  assert.equal(second.fetchedAt,first.fetchedAt); assert.equal(calls,1);
  assert.ok(!JSON.stringify(second).includes(env.AZ511_API_KEY));
  time+=60000; await load(env); assert.equal(calls,2);
});
test('failed responses remain unavailable, redact exceptions, throttle retries', async () => {
  for(const fetcher of [async()=>{throw Error(env.AZ511_API_KEY);},async()=>new Response('denied',{status:429}),async()=>Response.json({error:'bad'}),async()=>new Response('not json')]) {
    let calls=0;
    const load=createAZ511Adapter({clock:()=>now,fetcher:async(...args)=>{calls++;return fetcher(...args);}});
    assert.deepEqual(await load(env),{status:'unavailable',events:null});
    assert.deepEqual(await load(env),{status:'unavailable',events:null}); assert.equal(calls,1);
  }
});
test('simultaneous reads coalesce; valid empty upstream stays successful', async () => {
  let calls=0;
  const load=createAZ511Adapter({clock:()=>now,fetcher:async()=>{calls++;return Response.json([]);}});
  const results=await Promise.all([load(env),load(env)]);
  assert.equal(calls,1); assert.deepEqual(results[0],{status:'ok',events:[],fetchedAt:now});
});
test('Worker diagnostic feed uses adapter but mutations and scheduled sends stay disabled',async()=>{
  const w=createWorker({clock:()=>now,fetcher:async()=>Response.json(az511Events)});
  const request=new Request('http://localhost/?feed=az511');
  assert.equal((await(await w.fetch(request)).json()).status,'disabled');
  assert.equal((await(await w.fetch(request,env)).json()).events[0].timingStatus,'scheduled');
  assert.equal((await w.fetch(new Request(request,{method:'POST'}),env)).status,405);
  assert.deepEqual(w.scheduled(),{disabled:true});
});
