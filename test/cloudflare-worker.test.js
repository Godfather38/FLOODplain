import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {createWorker,compute,loadPublic,validAssessments} from '../worker/index.js';
import {healthy,fixtureNow as now} from '../worker/fixtures/healthy.js';
import {expectedInputHealth_} from '../worker/generated/input-health.js';
import {ShadowLedger} from '../worker/ledger.js';
import {AREAS,USGS_SITES} from '../public/config.js';
import {evaluate} from '../public/engine.js';
import routes from '../worker/generated/routes.json' with {type:'json'};
import {makeGas} from './gas-mock.js';

const get=(w,query,env={})=>w.fetch(new Request('http://localhost/?'+query),env);
test('all-area validation preserves fractional numerical ratings and rejects missing assessments',()=>{
  const assessments=Object.fromEntries(AREAS.map(a=>[a.id,{rated:[{score:2.5}]}]));
  assert.equal(validAssessments(assessments),true);
  assessments[AREAS[0].id].rated[0].score=NaN;assert.equal(validAssessments(assessments),false);
  delete assessments[AREAS[0].id];assert.equal(validAssessments(assessments),false);
});
test('healthy fixture feeds match actual Apps Script GET contract',async()=>{
  const out=join(mkdtempSync(join(tmpdir(),'worker-contract-')),'bundle.gs');
  execFileSync(process.execPath,['tools/build_gas.mjs'],{env:{...process.env,GAS_OUT:out}});
  const raw=healthy(),values=[...Object.values(raw.usgs),raw.closures,raw.rain,raw.stream,raw.nws,raw.tvClosures,raw.tvWork];
  const gas=makeGas({now},readFileSync(out,'utf8'),()=>values.map(value=>({getResponseCode:()=>200,getContentText:()=>JSON.stringify(value)})));
  const w=createWorker();
  for(const feed of ['all','usgs','alert','roadevents','health']) assert.deepEqual(await(await get(w,'feed='+feed)).json(),gas.api.doGet({parameter:{feed}}));
});
test('fixture feeds retain consolidated shapes, numeric all-area engine parity, and no network',async()=>{
  const w=createWorker({fetcher:()=>{throw Error('unexpected network')}});
  const all=await (await get(w,'feed=all')).json();
  assert.deepEqual(Object.keys(all),['usgs','alert','roadEvents','drive']);
  for(const [feed,key] of [['usgs','usgs'],['alert','alert'],['roadevents','roadEvents']]) assert.deepEqual(await(await get(w,'feed='+feed)).json(),all[key]);
  assert.deepEqual(all.drive,[]);
  const result=compute(healthy(),now);
  for(const {id} of AREAS) {
    const expected=evaluate({now,...healthy(),alert:all.alert,roadEvents:[],routes},id);
    assert.deepEqual(result.verdicts[id],expected);
    assert.ok(expected.rated.every(r=>Number.isInteger(r.score)));
  }
  assert.equal(result.inputs.length,20);assert.ok(result.inputs.every(r=>!r.reason));
  assert.deepEqual(await(await get(w,'feed=forecasts&paths=gauges/TEST')).json(),{responses:{}});
});
test('no writes, signups, counters or scheduled sends even with misleading env flags',async()=>{
  const w=createWorker({fetcher:()=>{throw Error('network')}});
  for(const action of ['drive','request','report','push','pushstop','signup','confirm','stop','waitlist']) {
    assert.equal((await w.fetch(new Request('http://localhost/',{method:'POST',body:JSON.stringify({action})}),{SEND_ENABLED:'true'})).status,405);
  }
  for(const query of ['hit=1&new=1','fail=rain','action=signup']) assert.equal((await get(w,query)).status,405);
  assert.deepEqual(w.scheduled(),{disabled:true});
});
test('public fetch failures stay unavailable; valid empty lists stay healthy; partial USGS isolated',async()=>{
  let calls=0;
  const raw=await loadPublic(async()=>{calls++;throw Error('offline')});
  assert.equal(calls,Object.keys(USGS_SITES).length+6);
  assert.ok(expectedInputHealth_(raw,now).every(r=>r.reason));
  const w=createWorker({fetcher:async()=>new Response('broken',{status:200}),clock:()=>now});
  const all=await(await get(w,'feed=all',{PUBLIC_LIVE:'true'})).json();
  assert.equal(all.alert,null);assert.equal(all.roadEvents,null);
  const good=healthy();good.usgs[Object.keys(USGS_SITES)[0]]=null;
  assert.equal(compute(good,now).inputs.filter(r=>r.reason).length,1);
  for(const value of ['',null,-1]) {const r=healthy();r.stream.data[0].flow=value;assert.match(compute(r,now).inputs.find(r=>r.id.startsWith('stream:')).reason,/reading/);}
});
test('forecast allowlist prevents arbitrary fetches; deduplicates and bounds paths',async()=>{
  const urls=[];const w=createWorker({fetcher:async u=>{urls.push(u);return Response.json({ok:true})}});
  const r=await(await get(w,'feed=forecasts&paths='+encodeURIComponent('https://evil.test,a/../b,gauges/TEST,gauges/TEST,reaches/123/streamflow'),{PUBLIC_LIVE:'true'})).json();
  assert.equal(urls.length,2);assert.ok(urls.every(u=>u.startsWith('https://api.water.noaa.gov/nwps/v1/')));
  assert.equal(Object.keys(r.responses).length,2);
});
test('generated validator remains exact owner-health source; timestamps remain observation times',()=>{
  const before=readFileSync('worker/generated/input-health.js','utf8');
  execFileSync(process.execPath,['tools/build_worker.mjs']);assert.equal(readFileSync('worker/generated/input-health.js','utf8'),before);
  const raw=healthy();const id=Object.keys(USGS_SITES)[0];raw.usgs[id].features[0].properties.time='2026-11-01T00:00:00Z';
  const s=compute(raw,now).inputs.find(r=>r.id==='usgs:'+id);assert.equal(s.ageMinutes,3000);assert.equal(s.reason,'Stale reading');
});
function ledger(){
  const db=new DatabaseSync(':memory:');
  const storage={sql:{exec:(q,...args)=>({toArray:()=>db.prepare(q).all(...args)})},transactionSync:fn=>{db.exec('BEGIN');try{const v=fn();db.exec('COMMIT');return v;}catch(e){db.exec('ROLLBACK');throw e;}}};
  // Durable SQL exec eagerly executes; mirror it rather than delaying writes until toArray.
  storage.sql.exec=(q,...args)=>{const stmt=db.prepare(q);const rows=stmt.all(...args);return {toArray:()=>rows};};
  return new ShadowLedger({storage});
}
test('transactional SQLite state deduplicates, retries, recovers, ignores older observations and persists',()=>{
  const l=ledger(),r={id:'source',reason:'Stale',observedAt:'2026-11-01',ageMinutes:3000};
  l.update({type:'observe',results:[r],now});
  assert.deepEqual(l.update({type:'mock-delivery',now,success:false}).ids,['source']);
  assert.deepEqual(l.update({type:'mock-delivery',now,success:true}).ids,[]);
  assert.deepEqual(l.update({type:'mock-delivery',now:now+120000,success:true}).ids,['source']);
  assert.deepEqual(l.update({type:'mock-delivery',now:now+180000,success:true}).ids,[]);
  l.update({type:'observe',results:[{...r,reason:''}],now:now+180000});
  l.update({type:'observe',results:[r],now});
  assert.deepEqual(l.update({type:'mock-delivery',now:now+180000,success:true}).ids,['source']);
  l.update({type:'observe',results:[r],now:now+200000});
  for(let i=1;i<=8;i++) l.update({type:'mock-delivery',now:now+i*3600000,success:false});
  assert.equal(l.update({type:'observe',results:[],now}).source.attempts,5);
});
test('budget and dedup reservation commit atomically, Phoenix dates and rollback hold',async()=>{
  const l=ledger();
  const results=await Promise.all(Array.from({length:20},()=>Promise.resolve().then(()=>l.update({type:'reserve',key:'mock-one',limit:2,now}))));
  assert.equal(results.filter(r=>r.reserved).length,1);
  assert.equal(results[0].day,'2026-11-02');
  assert.equal(l.update({type:'reserve',key:'mock-two',limit:2,now}).reserved,true);
  assert.equal(l.update({type:'reserve',key:'mock-three',limit:2,now}).reason,'budget');
  assert.throws(()=>l.update({type:'reserve',key:'real-person',limit:2,now}),/Synthetic/);
});
test('failed compute blocks source recovery; stale recovery cannot be delivered',()=>{
  const l=ledger(),issue={id:'source',reason:'Unavailable'};
  l.update({type:'observe',now,results:[issue]});l.update({type:'mock-delivery',now,success:true});
  l.update({type:'observe',now:now+1,results:[{...issue,reason:''},{id:'compute',reason:'Failed'}]});
  assert.deepEqual(l.update({type:'mock-delivery',now:now+1,success:true}).ids,['compute']);
  l.update({type:'observe',now:now+2,results:[{id:'compute',reason:''}]});
  assert.deepEqual(l.update({type:'mock-delivery',now:now+360000,success:true}).ids,[]);
});
