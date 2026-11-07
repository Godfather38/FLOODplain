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
function liveSetup(src = SRC) {
  const clock = { now };
  let batches = 0;
  const gas = makeGas(clock, src, reqs => {
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
function crossExpiryOnSecondClockRead(clock) {
  let value = now + 4 * 60000 - 1, reads = 0;
  Object.defineProperty(clock, 'now', {
    get() { if (++reads === 2) value += 2; return value; },
    set(next) { value = next; },
  });
}
test('a verdict expiring between cache selection and tick validation is refreshed, not reported malformed', () => {
  const {gas, clock, batches} = liveSetup();
  gas.cache.set('verdicts', JSON.stringify(cachedVerdicts()));
  gas.cache.set('roadforecast', JSON.stringify({forecastVersion: 2}));
  crossExpiryOnSecondClockRead(clock);
  gas.api.tick();
  assert.equal(gas.mails.length, 0);
  assert.equal(batches(), 1);
  assert.equal(gas.api.computeVerdict_('avra').at, new Date(clock.now).toISOString());
});
test('a failed boundary refresh still produces a compute incident', () => {
  const {gas, clock} = setup();
  gas.cache.set('verdicts', JSON.stringify(cachedVerdicts()));
  gas.cache.set('roadforecast', JSON.stringify({forecastVersion: 2}));
  crossExpiryOnSecondClockRead(clock);
  gas.api.tick();
  assert.equal(gas.mails.length, 1);
  assert.match(gas.mails[0].body, /Assessment computation failed/);
  assert.ok(JSON.parse(gas.props.get('ownerHealth:compute')).reason);
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
test('mail releases the shared lock and preserves interleaved newer observations',()=>{
  const {gas,clock}=setup();const initial={id:'x',reason:'Stale',expected:'Reading',crossings:'Sanders'};gas.api.noteOwnerHealth_([initial],now);
  clock.onMail=()=>{
    assert.equal(gas.api.noteOwnerHealth_([{...initial,reason:'Unavailable'}],now+1), true);
    assert.equal(gas.api.ownerHealthWatch_(now+1), false, 'the delivery lease prevents concurrent emails');
  };
  gas.api.ownerHealthWatch_(now);clock.onMail=null;
  gas.api.noteOwnerHealth_([initial],now);
  const state=JSON.parse(gas.props.get('ownerHealth:x'));assert.equal(state.reason,'Unavailable');assert.equal(state.delivered,'Stale');gas.api.ownerHealthWatch_(now+1);assert.equal(gas.mails.length,2);assert.match(gas.mails[1].body,/Unavailable/);
});

function scheduled(gas) {
  gas.props.set('TWILIO_APPROVED', 'yes');
  gas.props.set('TWILIO_SID', 'mock-sid');
  gas.props.set('TWILIO_TOKEN', 'mock-token');
  gas.props.set('TWILIO_FROM', '+15205550000');
  gas.api.sheet_().appendRow(['5205550123', '19:00', 'all', 'all', true, '', 0, '', new Date(now), '', '', 0, '', 'avra']);
  assert.equal(gas.post({action: 'push', topic: 'washwatch-test1234', times: ['19:00'], days: 'all', mode: 'all', area: 'avra'}).ok, true);
}
const issue = {id: 'compute', reason: 'Failed', expected: 'Evaluation', crossings: 'All'};
test('busy or failing health locks do not abort assessment, caching, texts or pushes', () => {
  for (const failure of ['lockBusy', 'lockFailure']) {
    const {gas, clock, batches} = liveSetup();
    scheduled(gas);
    clock[failure] = true;
    gas.locks.length = 0;
    assert.doesNotThrow(() => gas.api.tick());
    assert.equal(batches(), 1);
    assert.equal(gas.sent.length, 1);
    assert.equal(gas.fetches.filter(f => f.url.includes('ntfy.sh')).length, 1);
    assert.ok(gas.cache.has('verdicts'));
    assert.ok(gas.cache.has('roadforecast'));
    assert.equal(gas.mails.length, 0);
    assert.ok(gas.logs.some(x => /owner-observation/.test(x)));
    assert.ok(gas.locks.every(x => x.method === 'tryLock' && x.ms <= 100));
  }
});
test('a compute failure and busy report lock still deliver scheduled fallback alerts', () => {
  const {gas, clock} = setup();
  scheduled(gas);
  clock.lockBusy = true;
  assert.doesNotThrow(() => gas.api.tick());
  assert.equal(gas.sent.length, 1);
  assert.match(gas.sent[0].body, /couldn't get fresh data/);
  assert.equal(gas.fetches.filter(f => f.url.includes('ntfy.sh')).length, 1);
  assert.ok(gas.logs.some(x => /compute: Error: network/.test(x)));
});
test('owner and legacy health persistence failures cannot turn successful computation into a failure', () => {
  const {gas, clock, batches} = liveSetup();
  scheduled(gas);
  clock.onPropertyWrite = key => { if (key.startsWith('ownerHealth') || key === 'health') throw Error('Properties quota exceeded'); };
  assert.doesNotThrow(() => gas.api.tick());
  assert.equal(batches(), 1);
  assert.equal(gas.sent.length, 1);
  assert.ok(gas.cache.has('verdicts'));
  assert.ok(gas.logs.some(x => /owner-observation: Error: Properties quota exceeded/.test(x)));
  assert.ok(gas.logs.some(x => /legacy-health: Error: Properties quota exceeded/.test(x)));
});
test('a diagnostic validator exception cannot stop the evaluator', () => {
  const {gas} = liveSetup(SRC+'\nfunction expectedInputHealth_(){throw TypeError("diagnostic bug");}');
  assert.ok(gas.api.computeVerdict_('avra'));
  assert.match(gas.logs.join('\n'), /input-validation: TypeError: diagnostic bug/);
  assert.equal(JSON.parse(gas.props.get('ownerHealth:compute')).reason, '');
});
test('owner email runs after scheduled delivery and its failure cannot abort the tick', () => {
  const {gas, clock} = liveSetup();
  scheduled(gas);
  gas.api.noteOwnerHealth_([{...issue, id: 'x'}], now);
  clock.onMail = () => {
    assert.equal(gas.sent.length, 1, 'text sent before owner mail');
    assert.equal(gas.fetches.filter(f => f.url.includes('ntfy.sh')).length, 1);
  };
  clock.mailFailure = true;
  assert.doesNotThrow(() => gas.api.tick());
  assert.equal(JSON.parse(gas.props.get('ownerHealth:x')).attempts, 1);
  assert.equal(gas.props.has('ownerHealthDelivery'), false);
  assert.match(gas.logs.join('\n'), /owner-delivery: Error: mail unavailable/);
});
test('failed verdict persistence never reports compute recovery', () => {
  const {gas, clock} = liveSetup();
  gas.api.noteOwnerHealth_([issue], now);
  gas.api.ownerHealthWatch_(now);
  clock.onCacheWrite = key => { if (key === 'verdicts') throw Error('Cache quota exceeded'); };
  gas.api.tick();
  assert.ok(JSON.parse(gas.props.get('ownerHealth:compute')).reason);
  assert.ok(gas.mails.every(m => !m.body.includes('RECOVERED')));
});
test('failure to persist this tick compute failure cannot announce a stale recovery', () => {
  const {gas, clock} = setup();
  gas.api.noteOwnerHealth_([issue], now);
  gas.api.ownerHealthWatch_(now);
  gas.api.noteOwnerHealth_([{...issue, reason: ''}], now);
  clock.onPropertyWrite = key => { if (key === 'ownerHealth:compute') throw Error('state unavailable'); };
  gas.api.tick();
  assert.equal(gas.mails.length, 1);
  assert.doesNotMatch(gas.mails[0].body, /RECOVERED/);
});
test('compute diagnostics preserve exception type and code location but scrub secrets and private data', () => {
  const {gas} = setup();
  gas.props.set('TWILIO_TOKEN', 'configured-private-value');
  gas.props.set('USGS_API_KEY', 'configured-key');
  const err = new TypeError('Cannot read features; configured-private-value configured-key https://example.com/private?api_key=leak owner@private.test +1 (520) 555-0123 token="another secret" Authorization: Bearer abc123');
  err.stack = 'TypeError: omitted\n at computeVerdicts_ (https://private/path:123:4)';
  const detail = gas.api.ownerErrorDiagnostic_(err);
  assert.match(detail, /TypeError: Cannot read features/);
  assert.match(detail, /\[computeVerdicts_:123\]/);
  assert.doesNotMatch(detail, /configured-private-value|configured-key|example.com|private.test|555-0123|another secret|abc123|https:/);
  const payload = gas.api.ownerErrorDiagnostic_(new Error('HTTP failure response: {"secret":"private body"}'));
  assert.doesNotMatch(payload, /private body|secret/);
  assert.ok(gas.api.ownerErrorDiagnostic_(new Error('x'.repeat(1000))).length < 400);
  gas.api.tick();
  assert.match(JSON.parse(gas.props.get('ownerHealth:compute')).diagnostic, /Error: network/);
  assert.match(gas.mails[0].body, /Diagnostic: Error: network/);
});
test('changing diagnostic detail updates the private record without emailing the same incident twice', () => {
  const {gas, clock} = setup();
  gas.api.noteOwnerHealth_([{...issue, diagnostic: 'Error: first'}], now);
  gas.api.ownerHealthWatch_(now);
  clock.now++;
  gas.api.noteOwnerHealth_([{...issue, diagnostic: 'Error: second'}], clock.now);
  gas.api.ownerHealthWatch_(clock.now);
  assert.equal(gas.mails.length, 1);
  assert.equal(JSON.parse(gas.props.get('ownerHealth:compute')).diagnostic, 'Error: second');
});
test('recovery arriving during an email is retained and follows the delivered problem', () => {
  const {gas, clock} = setup();
  gas.api.noteOwnerHealth_([issue], now);
  clock.onMail = () => gas.api.noteOwnerHealth_([{...issue, reason: ''}], now+1);
  gas.api.ownerHealthWatch_(now);
  clock.onMail = null;
  const state = JSON.parse(gas.props.get('ownerHealth:compute'));
  assert.equal(state.reason, '');
  assert.equal(state.checked, now+1);
  assert.equal(state.delivered, 'Failed');
  gas.api.ownerHealthWatch_(now+1);
  assert.equal(gas.mails.length, 2);
  assert.match(gas.mails[1].body, /RECOVERED/);
});
test('delivery finalization contention is bounded and an expired lease allows retry', () => {
  const {gas, clock} = setup();
  gas.api.noteOwnerHealth_([issue], now);
  clock.onMail = () => { clock.lockBusy = true; };
  assert.equal(gas.api.ownerHealthWatch_(now), true);
  assert.equal(gas.mails.length, 1);
  assert.equal(JSON.parse(gas.props.get('ownerHealth:compute')).delivered, undefined);
  assert.ok(gas.props.has('ownerHealthDelivery'));
  clock.onMail = null;
  clock.lockBusy = false;
  assert.equal(gas.api.ownerHealthWatch_(now+9*60000), false);
  assert.equal(gas.mails.length, 1);
  assert.equal(gas.api.ownerHealthWatch_(now+10*60000), true);
  assert.equal(gas.mails.length, 2, 'uncertain acceptance may retry, never claim exactly-once delivery');
  assert.equal(JSON.parse(gas.props.get('ownerHealth:compute')).attempts, 2);
  assert.equal(gas.props.has('ownerHealthDelivery'), false);
});
test('public feed computation survives busy locks and malformed private health state', () => {
  for (const failure of ['busy', 'corrupt']) {
    const {gas, clock} = liveSetup();
    if (failure === 'busy') clock.lockBusy = true;
    else gas.props.set('ownerHealthIds', '{');
    const feed = gas.api.doGet({parameter: {feed: 'all'}});
    assert.ok(feed.usgs);
    assert.ok(feed.alert);
    assert.ok(gas.cache.has('verdicts'));
    assert.doesNotMatch(JSON.stringify(feed), /ownerHealth|Diagnostic|Script lock/);
  }
});
test('an already-handled minute still retries pending owner delivery without repeating subscriber sends', () => {
  const {gas, clock} = liveSetup();
  scheduled(gas);
  gas.api.tick();
  gas.api.noteOwnerHealth_([{...issue, id: 'x'}], now);
  gas.api.tick();
  assert.equal(gas.sent.length, 1);
  assert.equal(gas.mails.length, 1);
  assert.match(gas.mails[0].body, /PROBLEM: x/);
});
