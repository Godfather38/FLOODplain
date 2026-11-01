import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {FAILURE_POINTS} from '../public/config.js';
import {riskScore} from '../public/logic.js';
import {CALM_WITH_FLOW,applyHand,handCheck,loadHand,matchFailurePoints} from '../public/hand-model.js';
const text=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const coverage=JSON.parse(text('public/inundation/data/coverage.json'));
const byFp=matchFailurePoints(FAILURE_POINTS,coverage.points),now=Date.parse('2026-11-01T08:00:00Z');
const forecastCfs=(cfs,time='2026-11-01T12:00:00Z')=>{const p={flowM3s:cfs*0.028316846592,time};return{status:'ok',issueAgeHours:2,peak:p,points:[p]};};
const point=(level,why='rain')=>({level,why,checks:[{src:'rain-local',level,why}]});
const VERDICT=/passable|impassable|\bsafe\b|unsafe|can cross|cannot cross|drivable|turn around/i;

test('owner-named crossings are in and too-far crossings are out',()=>{
 const at=(lon,lat)=>coverage.points.find(p=>p.lon===lon&&(lat===undefined||p.lat===lat));
 assert.equal(at(-111.23395,32.43484).status,'supported');assert.match(at(-111.23395,32.43484).name,/Santa Cruz River/);
 assert.equal(at(-111.14714).status,'supported');assert.match(at(-111.14714).name,/Santa Cruz River/);
 assert.equal(at(-111.24501).status,'supported');assert.match(at(-111.24501).name,/Los Robles Wash/);
 for(const lon of [-111.26095,-111.27659])assert.equal(at(lon).status,'too_far');
 for(const p of coverage.points.filter(p=>p.status==='supported')){assert.ok(p.nearestReach.distanceM<=310,p.id);assert.notEqual(p.confidence.band,'Weak match');}
 for(const p of coverage.points.filter(p=>p.status==='supported'))assert.doesNotMatch(p.name,/aqueduct/i,p.id);
});

test('rated crossings are matched to the HAND rows at their own location',()=>{
 assert.equal(byFp['sc-trico-marana'].status,'supported');assert.equal(byFp['sc-trico-marana'].forecast.station,'SCTA3');
 assert.equal(byFp['clayton-dip'].status,'supported');assert.equal(byFp['elpaso-dip'].status,'too_far');
 assert.equal(byFp['pr-yuma-mine'].status,'supported');assert.match(byFp['pr-yuma-mine'].name,/Yuma Mine Wash/);assert.equal(byFp['pr-sandario-ina'],undefined);
});

test('modeled water outranks a calm outlook and is named on the card',()=>{
 const check=handCheck(byFp['sc-trico-marana'],forecastCfs(5000),now);
 assert.equal(check.level,'watch');assert.equal(check.raise,true);
 const r={'sc-trico-marana':point('ok','no rain')};applyHand(r,{checks:{'sc-trico-marana':check}});
 assert.equal(r['sc-trico-marana'].level,'watch');assert.match(r['sc-trico-marana'].why,/^HAND model/);assert.equal(r['sc-trico-marana'].checks[0].src,'hand');
 assert.equal(riskScore(r['sc-trico-marana']),2);
});

test('HAND never overrides a gauge that answered, and only raises when the gauge has not',()=>{
 const check=handCheck(byFp['sc-trico-marana'],forecastCfs(5000),now);assert.equal(check.raise,true);
 for(const src of ['river'])for(const level of ['ok','watch']){
  const r={x:{level,why:'gauge',checks:[{src,level,why:'gauge'}]}};applyHand(r,{checks:{x:check}});
  assert.equal(r.x.level,level);assert.equal(r.x.why,'gauge');assert.equal(r.x.checks[0].src,'hand');
 }
 const remote={x:{level:'ok',why:'far',checks:[{src:'wash',level:'ok',why:'far'}]}};applyHand(remote,{checks:{x:check}});assert.equal(remote.x.level,'watch','a remote wash gauge does not block HAND');
 const down={x:{level:'ok',why:'none',checks:[{src:'river',level:'unknown',why:'unreachable'}]}};applyHand(down,{checks:{x:check}});assert.equal(down.x.level,'watch');
});

test('HAND adds exactly 1 point to the engine rating and never reaches 5',()=>{
 const check=handCheck(byFp['sc-trico-marana'],forecastCfs(5000),now);
 for(const [level,before,after] of [['ok',1,2],['watch',2,3],['caution',3,4]]){
  const r={x:point(level)};assert.equal(riskScore(r.x),before);applyHand(r,{checks:{x:check}});assert.equal(riskScore(r.x),after,level);assert.equal(r.x.checks[1].src,'rain-local');
 }
 const d={x:point('danger')};applyHand(d,{checks:{x:check}});assert.equal(riskScore(d.x),5);
 const twice={x:point('caution')};twice.x.checks.push({src:'wash',level:'caution',why:'w'});applyHand(twice,{checks:{x:check}});assert.equal(riskScore(twice.x),4);
});

test('a wash adds half a point and leaves the level alone; the Santa Cruz adds a whole one',()=>{
 const wash=handCheck(byFp['brawley-dip'],forecastCfs(5000),now);assert.equal(wash.points,0.5);
 const r={x:point('ok','rain')};applyHand(r,{checks:{x:wash}});assert.equal(r.x.level,'ok');assert.equal(r.x.handAdd,0.5);assert.equal(r.x.why,'rain');
 assert.equal(handCheck(byFp['sc-avra'],forecastCfs(5000),now).points,1);
 assert.match(text('public/app.js'),/s \+ \(p\.handAdd \?\? 0\)/);
});

test('a zero or low model flow never lowers or hides a rain caution, and is not called dry',()=>{
 const check=handCheck(byFp['sc-trico-marana'],forecastCfs(0),now);assert.equal(check.raise,false);assert.notEqual(check.level,'ok');assert.match(check.why,/doesn't mean dry/i);
 for(const level of ['watch','caution','danger','ok','unknown']){
  const r={x:point(level)};applyHand(r,{checks:{x:check}});
  assert.equal(r.x.level,level);assert.equal(r.x.why,'rain');assert.equal(r.x.checks.length,2);assert.equal(r.x.checks[1].src,'rain-local');
 }
 const big=handCheck(byFp['sc-trico-marana'],forecastCfs(843),now),d={x:point('danger')};applyHand(d,{checks:{x:big}});assert.equal(d.x.level,'danger');assert.equal(d.x.why,'rain');
});

test('a possible match can only reach watch, and unusable forecasts raise nothing',()=>{
 const possibleGauge={...byFp['sc-trico-marana'],confidence:{...byFp['sc-trico-marana'].confidence,band:'Possible match'}};assert.equal(handCheck(possibleGauge,forecastCfs(5000),now).raise,false);
 for(const row of Object.values(byFp).filter(p=>p.forecast?.kind==='nwm_reach')){const c=handCheck(row,forecastCfs(5000),now);assert.notEqual(c.level,'caution',row.id);if(row.confidence.band!=='Likely match')assert.equal(c.raise,false,row.id);}
 assert.equal(handCheck(byFp['sc-avra'],forecastCfs(5000),now).level,'watch');assert.equal(handCheck(byFp['brawley-dip'],forecastCfs(5000),now).level,'watch');
 for(const f of [{status:'unavailable',reason:'down'},{status:'expired',reason:'old'},undefined]){const c=handCheck(byFp['sc-trico-marana'],f,now);assert.equal(c.raise,false);}
 const stale=handCheck(byFp['sc-trico-marana'],{...forecastCfs(5000),status:'stale'},now);assert.equal(stale.raise,false);assert.match(stale.why,/old forecast/);
 const off=handCheck(byFp['elpaso-dip'],undefined,now);assert.equal(off.raise,false);assert.match(off.detail,/^Missing coverage/);
});

test('only the next 24 hours count, and the time is shown',()=>{
 const row=byFp['sc-trico-marana'],far=forecastCfs(5000,'2026-11-03T15:00:00Z');
 const c=handCheck(row,far,now);assert.equal(c.raise,false);assert.match(c.why,/next 24 hours/);
 const small=forecastCfs(100,'2026-11-01T12:00:00Z');
 const mixed=handCheck(row,{...far,points:[small.peak,far.peak]},now);assert.equal(mixed.raise,false);assert.match(mixed.why,/100 cfs/);
 const near=handCheck(row,forecastCfs(5000),now);assert.equal(near.level,'watch');assert.match(near.why,/5,000 cfs forecast for Sun 5 AM/);
 assert.equal(handCheck(row,forecastCfs(5000,'2026-11-02T07:59:00Z'),now).raise,true);
});

test('a calm crossing does not say nothing points to water when HAND forecasts flow',()=>{
 const row=byFp['sc-trico-marana'],some=handCheck(row,forecastCfs(400),now),none=handCheck(row,forecastCfs(0),now);
 assert.equal(some.raise,false);assert.equal(some.some,true);assert.equal(none.some,false);
 const r={x:point('ok','no rain')};applyHand(r,{checks:{x:some}});assert.equal(r.x.checks[0].some,true);assert.equal(r.x.level,'ok');
 assert.match(text('public/app.js'),/p\.level === 'ok' && p\.checks\[0\]\?\.some \? handModel\.CALM_WITH_FLOW/);
 assert.doesNotMatch(CALM_WITH_FLOW,VERDICT);
});

test('an open source row resets when the HAND row appears or goes',()=>{
 assert.match(text('public/app.js'),/Boolean\(data\.hand\) !== Boolean\(hand\)\) openSource = null/);
});

test('labels stay with every estimate, with no road verdict',()=>{
 const seen=Object.values(byFp).map(row=>handCheck(row,forecastCfs(1000),now));
 for(const c of seen)assert.doesNotMatch(c.why+c.detail,VERDICT);
 const d=handCheck(byFp['sc-trico-marana'],forecastCfs(1000),now).detail;
 for(const needed of [/not a probability/,/Source age: NOAA HAND files from 2024-08-17/,/Uncertainty: not measured/,/not depth on a road/,/gauge forecast/])assert.match(d,needed);
 assert.match(handCheck(byFp['sc-ina'],forecastCfs(100),now).detail,/modeled National Water Model flow/);
});

test('app reaches HAND through its own layer, and service files do not import it',async()=>{
 const app=text('public/app.js');
 assert.match(app,/handModel\?\.applyHand\(fpResults, d\.hand\)/);
 assert.match(app,/import\('\.\/hand-model\.js\?v=dev'\)/);assert.doesNotMatch(app,/^import .*hand-model/m);assert.doesNotMatch(app.slice(app.indexOf('async function gather'),app.indexOf('// ---------------- state')),/[Hh]and/);
 for(const f of ['public/engine.js','public/logic.js','public/config.js','apps-script/Code.gs'])assert.doesNotMatch(text(f),/hand-model/,f);
 const calls=[];const fetchImpl=async url=>{const u=String(url);calls.push(u);
  if(u.includes('coverage.json'))return{ok:true,json:async()=>coverage};
  throw Error('offline');};
 const hand=await loadHand(FAILURE_POINTS,{fetchImpl,clock:()=>now});
 assert.equal(hand.checks['sc-trico-marana'].raise,false);assert.match(hand.checks['sc-trico-marana'].why,/no forecast flow/);
 const junkReply=async url=>String(url).includes('coverage.json')?{ok:true,json:async()=>coverage}:{ok:true,json:async()=>({nonsense:true,shortRange:{series:{units:'ft\u00b3/s',data:'x',referenceTime:'y'}}})};
 const junk=await loadHand(FAILURE_POINTS,{fetchImpl:junkReply,clock:()=>now});
 for(const c of Object.values(junk.checks))assert.equal(c.raise,false);
 const partial=await loadHand(FAILURE_POINTS,{clock:()=>now,fetchImpl:async url=>{const u=String(url);if(u.includes('coverage.json'))return{ok:true,json:async()=>coverage};if(u.includes('/gauges/'))throw Error('down');return{ok:false,status:500};}});
 for(const c of Object.values(partial.checks))assert.equal(c.raise,false);
 await assert.rejects(loadHand(FAILURE_POINTS,{fetchImpl:async()=>({ok:true,json:async()=>({oops:1})}),clock:()=>now}));
 const r={x:point('caution','rain')};applyHand(r,null);assert.equal(r.x.level,'caution');assert.equal(r.x.checks.length,1);
});
