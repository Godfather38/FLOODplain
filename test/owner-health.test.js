import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {makeGas} from './gas-mock.js';
import {USGS_SITES,RAIN_GAUGES} from '../public/config.js';
const out=join(mkdtempSync(join(tmpdir(),'owner-')),'bundle.gs');
execFileSync(process.execPath,['tools/build_gas.mjs'],{env:{...process.env,GAS_OUT:out}});
const SRC=readFileSync(out,'utf8'), now=Date.parse('2026-11-03T02:00:00Z');
function setup(src=SRC){const clock={now}; const gas=makeGas(clock,src,()=>{throw Error('network');});return {clock,gas};}
function healthy(){return {usgs:Object.fromEntries(Object.keys(USGS_SITES).map(id=>[id,{features:[{properties:{parameter_code:'00060',value:0,time:new Date(now).toISOString()}}]}])),rain:{data:Object.keys(RAIN_GAUGES).map(site=>({site,last_rpt:'2026-11-02T19:00:00',rain:Array(9).fill(0)}))},stream:{data:[{site:'6443',last_rpt:'2026-11-02T19:00:00',flow:0}]},closures:{features:[]},nws:{features:[]},tvClosures:{d:[]},tvWork:{d:{}}};}
test('incomplete county record stays an incident until its actual status returns', () => {
  const { gas } = setup();
  const raw = healthy();
  raw.closures = JSON.parse(readFileSync(new URL('./fixtures/county-incomplete-2026-11-05.json', import.meta.url)));
  const cycle = () => { gas.api.noteOwnerHealth_(gas.api.expectedInputHealth_(raw, now), now); gas.api.ownerHealthWatch_(now); };
  cycle(); cycle();
  assert.equal(gas.mails.length, 1);
  assert.match(gas.mails[0].body, /W Gates Pass Rd: missing Status/);
  assert.doesNotMatch(gas.mails[0].body, /RECOVERED/);
  raw.closures.features[0].attributes.Status = 'Open'; cycle();
  assert.equal(gas.mails.length, 2);
  assert.match(gas.mails[1].body, /RECOVERED/);
});
test('configured inventory healthy with no pavement sensor, bridge model or local gauge; empty event lists valid',()=>{const {gas}=setup();const rows=gas.api.expectedInputHealth_(healthy(),now);assert.equal(rows.length,20);assert.ok(rows.every(r=>!r.reason));gas.api.noteOwnerHealth_(rows,now);gas.api.ownerHealthWatch_(now);assert.equal(gas.mails.length,0);assert.ok(rows.find(r=>r.id==='usgs:09486500').crossings.includes('Sanders'));});
test('partial outage, stale, malformed 200, incomplete rain, future time and empty measurements detected',()=>{const {gas}=setup();for(const mutation of [r=>r.usgs['09486500']=null,r=>r.usgs['09486500']={features:[]},r=>r.usgs['09486500'].features[0].properties.value='',r=>r.usgs['09486500'].features[0].properties.time='2026-11-01T00:00:00Z',r=>r.usgs['09486500'].features[0].properties.time='2027-01-01T00:00:00Z']){const raw=healthy();mutation(raw);const bad=gas.api.expectedInputHealth_(raw,now).filter(r=>r.reason);assert.equal(bad.length,1);assert.equal(bad[0].id,'usgs:09486500');}const raw=healthy();raw.rain.data[0].rain[4]=null;raw.stream={};raw.nws={};raw.tvWork=null;assert.equal(gas.api.expectedInputHealth_(raw,now).filter(r=>r.reason).length,4);});
test('stable issue deduplicates, meaningful change alerts, recovery only after validated input',()=>{const {gas,clock}=setup();const raw=healthy();raw.usgs['09486500']=null;const cycle=()=>{gas.api.noteOwnerHealth_(gas.api.expectedInputHealth_(raw,clock.now),clock.now);gas.api.ownerHealthWatch_(clock.now);};cycle();cycle();assert.equal(gas.mails.length,1);assert.equal(gas.mails[0].to,'owner@example.com');assert.match(gas.mails[0].body,/Expected:.*Cortaro/);assert.match(gas.mails[0].body,/Sanders/);raw.usgs['09486500']={features:[]};cycle();assert.equal(gas.mails.length,2);cycle();assert.equal(gas.mails.length,2);raw.usgs=healthy().usgs;cycle();assert.equal(gas.mails.length,3);assert.match(gas.mails[2].body,/RECOVERED/);cycle();assert.equal(gas.mails.length,3);assert.equal(gas.fetches.length,0);});
test('send failure retries bounded at five, no false delivery, recovery without delivered problem is silent',()=>{const {gas,clock}=setup();const issue={id:'compute',reason:'Failed',expected:'Evaluation',crossings:'All'};gas.api.noteOwnerHealth_([issue],clock.now);clock.mailFailure=true;for(let i=0;i<8;i++){try{gas.api.ownerHealthWatch_(clock.now);}catch{}clock.now+=3600000;}let s=JSON.parse(gas.props.get('ownerHealth:compute'));assert.equal(s.attempts,5);assert.equal(s.delivered,undefined);clock.mailFailure=false;gas.api.ownerHealthWatch_(clock.now);assert.equal(gas.mails.length,0);gas.api.noteOwnerHealth_([{...issue,reason:''}],clock.now);gas.api.ownerHealthWatch_(clock.now);assert.equal(gas.mails.length,0);});
test('successful retry delivers once and old successful observation cannot recover',()=>{const {gas,clock}=setup();const r={id:'x',reason:'Unavailable',expected:'Reading',crossings:'Sanders'};gas.api.noteOwnerHealth_([r],clock.now);clock.mailFailure=true;assert.throws(()=>gas.api.ownerHealthWatch_(clock.now));clock.mailFailure=false;gas.api.ownerHealthWatch_(clock.now);assert.equal(gas.mails.length,0);clock.now+=120000;gas.api.ownerHealthWatch_(clock.now);assert.equal(gas.mails.length,1);gas.api.noteOwnerHealth_([{...r,reason:''}],clock.now);clock.now+=360000;gas.api.ownerHealthWatch_(clock.now);assert.equal(gas.mails.length,1);});
test('compute exceptions notify without subscribers and independently of closure errors',()=>{const {gas}=setup(SRC+'\nfunction closureWatch_(){throw Error("closure");}');gas.api.tick();assert.equal(gas.mails.length,1);assert.match(gas.mails[0].body,/Assessment computation failed/);gas.api.tick();assert.equal(gas.mails.length,1);assert.equal(gas.fetches.filter(f=>f.url.includes('ntfy')).length,0);});

test('all-empty/malformed 200 measurements alert, event emptiness stays healthy',()=>{const {gas}=setup();const raw=healthy();for(const id of Object.keys(raw.usgs))raw.usgs[id]={features:[]};raw.rain={data:[]};raw.stream={data:[]};const issues=gas.api.expectedInputHealth_(raw,now).filter(r=>r.reason);assert.equal(issues.length,16);assert.ok(issues.every(r=>/^(usgs|rain|stream):/.test(r.id)));});
test('failed current computation prevents pending source recovery',()=>{const {gas}=setup();const r={id:'x',reason:'Unavailable',expected:'Reading',crossings:'Sanders'};gas.api.noteOwnerHealth_([r],now);gas.api.ownerHealthWatch_(now);gas.api.noteOwnerHealth_([{...r,reason:''},{id:'compute',reason:'Failed',expected:'Evaluation',crossings:'All'}],now);gas.api.ownerHealthWatch_(now);assert.equal(gas.mails.length,2);assert.doesNotMatch(gas.mails[1].body,/RECOVERED/);});
test('healthy input diagnostics still send when closure monitor throws',()=>{const {gas}=setup(SRC+'\nfunction closureWatch_(){throw Error("closure");}');gas.cache.set('verdicts','{}');gas.api.noteOwnerHealth_([{id:'rain:6110',reason:'Stale reading',expected:'Rain',crossings:'Brawley'}],now);gas.api.tick();assert.equal(gas.mails.length,1);assert.match(gas.mails[0].body,/rain:6110/);});

function cachedVerdicts(){return Object.fromEntries(['avra','picture-rocks'].map(id=>[id,{at:new Date(now).toISOString(),text:'Estimate',sms:'Estimate',spoken:'Estimate',title:'Estimate',off:false,closed:[],closuresKnown:true}]));}
function liveSetup() {
  const clock = { now };
  let batches = 0;
  const gas = makeGas(clock, SRC, reqs => {
    batches++;
    const raw = healthy();
    return reqs.map(({url}) => {
      const site = /USGS-(\d+)/.exec(url)?.[1];
      const body = site ? raw.usgs[site] : url.includes('arcgis') ? raw.closures
        : url.includes('currain') ? raw.rain : url.includes('currentstream') ? raw.stream
        : url.includes('weather.gov') ? raw.nws : url.includes('GetConstructionEvents') ? raw.tvWork : raw.tvClosures;
      return {getResponseCode: () => 200, getContentText: () => JSON.stringify(body)};
    });
  });
  return {gas, clock, batches: () => batches};
}
test('expired assessment still in the cache refreshes immediately without an outage email', () => {
  const {gas, clock, batches} = liveSetup();
  gas.cache.set('verdicts', JSON.stringify(cachedVerdicts()));
  // The timestamp is captured before evaluation; CacheService TTL starts later,
  // on cache.put. At this boundary the cached entry can still exist but be stale.
  clock.now += 4 * 60000 + 1;
  gas.api.tick();
  assert.equal(batches(), 1);
  assert.equal(gas.mails.length, 0);
  assert.equal(gas.api.computeVerdict_('avra').at, new Date(clock.now).toISOString());
  assert.equal(batches(), 1, 'reuse the refreshed answer within the same tick');
});
test('invalid cached assessments are rebuilt rather than served or left until expiry', () => {
  for (const cache of ['null', '{', '{}', JSON.stringify({avra:cachedVerdicts().avra})]) {
    const {gas, batches} = liveSetup();
    gas.cache.set('verdicts', cache);
    const v = gas.api.computeVerdict_('avra');
    assert.equal(v.at, new Date(now).toISOString());
    assert.equal(batches(), 1);
    assert.equal(JSON.parse(gas.props.get('ownerHealth:compute')).reason, '');
  }
});
test('a stale cache with a failed refresh still alerts and never returns stale results', () => {
  const {gas, clock} = setup();
  gas.cache.set('verdicts', JSON.stringify(cachedVerdicts()));
  clock.now += 4 * 60000 + 1;
  assert.throws(() => gas.api.computeVerdict_('avra'), /network/);
  gas.api.tick();
  assert.equal(gas.mails.length, 1);
  assert.match(gas.mails[0].body, /PROBLEM: compute/);
  assert.ok(JSON.parse(gas.props.get('ownerHealth:compute')).reason);
});
test('missing engine and null all-area result produce actionable compute incidents',()=>{
  for(const [suffix,pattern] of [['\nevaluate=undefined;',/engine unavailable/],['\nfunction computeVerdicts_(){return null;}',/output is missing/]]){
    const {gas}=setup(SRC+suffix);gas.cache.set('verdicts',JSON.stringify(cachedVerdicts()));gas.api.tick();assert.equal(gas.mails.length,1);assert.match(gas.mails[0].body,pattern);
  }
});
test('failed refresh of invalid cached verdicts alerts; valid cache cannot recover an incident',()=>{
  const {gas}=setup();for(const cache of ['null','{','{}',JSON.stringify({avra:cachedVerdicts().avra})]){gas.cache.set('verdicts',cache);gas.api.tick();assert.ok(JSON.parse(gas.props.get('ownerHealth:compute')).reason);}
  const count=gas.mails.length;gas.cache.set('verdicts',JSON.stringify(cachedVerdicts()));gas.api.tick();assert.equal(gas.mails.length,count);assert.ok(JSON.parse(gas.props.get('ownerHealth:compute')).reason);assert.ok(gas.mails.every(m=>!m.body.includes('RECOVERED')));
});
test('null evaluator output cannot mark computation recovered',()=>{
  const clock={now};const gas=makeGas(clock,SRC+'\nevaluate=()=>null;',reqs=>reqs.map(()=>({getResponseCode:()=>200,getContentText:()=>JSON.stringify({features:[],data:[],d:[]})})));gas.api.tick();assert.match(gas.mails[0].body,/Assessment output is missing/);assert.ok(JSON.parse(gas.props.get('ownerHealth:compute')).reason);
});
test('stale observation timestamp and age appear without changing deduplication',()=>{
  const {gas,clock}=setup();const raw=healthy();raw.usgs['09486500'].features[0].properties.time='2026-11-01T00:00:00Z';
  const cycle=()=>{gas.api.noteOwnerHealth_(gas.api.expectedInputHealth_(raw,clock.now),clock.now);gas.api.ownerHealthWatch_(clock.now);};cycle();assert.match(gas.mails[0].body,/Last observation: 2026-11-01T00:00:00.000Z/);assert.match(gas.mails[0].body,/Observation age at check: 3000 minutes/);clock.now+=60000;cycle();assert.equal(gas.mails.length,1);assert.equal(JSON.parse(gas.props.get('ownerHealth:usgs:09486500')).ageMinutes,3001);
});
test('observation writer waits for delivery lock and newer state survives; older check is ignored',()=>{
  const {gas,clock}=setup();const initial={id:'x',reason:'Stale',expected:'Reading',crossings:'Sanders'};gas.api.noteOwnerHealth_([initial],now);
  clock.onMail=()=>assert.throws(()=>gas.api.noteOwnerHealth_([{...initial,reason:'Unavailable'}],now+1),/lock held/);
  gas.api.ownerHealthWatch_(now);clock.onMail=null;
  gas.api.noteOwnerHealth_([{...initial,reason:'Unavailable'}],now+1);
  gas.api.noteOwnerHealth_([initial],now);
  const state=JSON.parse(gas.props.get('ownerHealth:x'));assert.equal(state.reason,'Unavailable');assert.equal(state.delivered,'Stale');gas.api.ownerHealthWatch_(now+1);assert.equal(gas.mails.length,2);assert.match(gas.mails[1].body,/Unavailable/);
});
