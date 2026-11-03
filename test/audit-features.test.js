import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {countyTime,plainAge,plainWords} from '../public/preferences.js';
import {checkClosures,closureChanges,closureChangeMessage,driveSummary,goodSigns} from '../public/logic.js';
import {sharedForecastPath,sharedForecastFetch} from '../public/hand-model.js';
import {resolveScreen} from '../public/routing.js';

const NOW=Date.parse('2026-11-02T23:00:00Z');
const read=p=>readFileSync(new URL('../public/'+p,import.meta.url),'utf8');

test('county times read as plain ages',()=>{
 assert.equal(countyTime('11/02/26, 10:25'),Date.parse('2026-11-02T17:25:00Z'));
 assert.equal(countyTime('not a time'),null);
 assert.equal(plainAge(NOW-60000,NOW),'just now');assert.equal(plainAge(NOW-3600000,NOW),'1 hour ago');
 assert.equal(plainAge(NOW-3*86400000,NOW),'3 days ago');assert.match(plainAge(Date.parse('2021-07-30T14:00:00Z'),NOW),/^in Jul 2021$/);
 assert.equal(plainAge(null,NOW),null);
 assert.match(plainWords('County says CLOSED: Trico Rd (updated 11/02/26, 10:25)',NOW),/\(updated 5 hours ago\)/);
 assert.equal(plainWords('updated soon',NOW),'updated soon','unreadable stamps stay as written');
});
test('plain words replace jargon on screen',()=>{
 assert.equal(plainWords('HAND model: water',NOW),'Flood model: water');
 assert.equal(plainWords('Road height 2,000.0 ft NAVD88',NOW),'Road height 2,000.0 ft above sea level');
});
test('an old Open is not treated as a good sign, and never changes the level',()=>{
 const old=[{location:'x',status:'Open',updated:'07/30/21, 07:34'}],recent=[{location:'x',status:'Open',updated:'11/01/26, 07:34'}];
 const stale=checkClosures(old,NOW),fresh=checkClosures(recent,NOW);
 assert.equal(stale.level,'ok');assert.equal(stale.staleOpen,true);assert.match(stale.why,/not updated recently/);
 assert.equal(fresh.staleOpen,undefined);assert.equal(checkClosures(old).staleOpen,undefined,'no clock, no judgment');
 const route=(c)=>({points:[{checks:[{src:'county',...c}]}]});
 assert.deepEqual(goodSigns(route(stale),false),[]);
 assert.match(goodSigns(route(fresh),false)[0],/marked Open/);
 const closed=checkClosures([{location:'x',status:'Closed',updated:'07/30/21, 07:34'}],NOW);assert.equal(closed.level,'danger','an old closure still counts');
});
test('closure changes and their message',()=>{
 assert.deepEqual(closureChanges(['a','b'],['b','c']),{closed:['c'],reopened:['a']});
 assert.deepEqual(closureChanges(['a'],['a']),{closed:[],reopened:[]});
 const m=closureChangeMessage({closed:['Trico Rd'],reopened:['Avra Rd']},'https://x');
 assert.match(m,/Road closed: Trico Rd\./);assert.match(m,/No longer listed as closed: Avra Rd\./);assert.doesNotMatch(m,/\bsafe\b/i);
});
test('driver reports summarize the latest and drop after six hours',()=>{
 const reports=[{fp:'a',state:'water',at:NOW-3600000},{fp:'a',state:'clear',at:NOW-60000},{fp:'a',state:'water',at:NOW-7*3600000},{fp:'b',state:'water',at:NOW},{fp:'a',state:'nonsense',at:NOW}];
 assert.deepEqual(driveSummary(reports,'a',NOW),{state:'clear',at:NOW-60000,water:1,clear:1});
 assert.equal(driveSummary(reports,'c',NOW),null);assert.equal(driveSummary(null,'a',NOW),null);
});
test('driver reports stay out of ratings',()=>{
 assert.doesNotMatch(read('logic.js').match(/export function rateFailurePoint[\s\S]*?\r?\n}\r?\n/)[0],/drive/i);
 assert.doesNotMatch(read('engine.js'),/drive/i);
});
test('shared forecasts fall back to NOAA for anything missing',async()=>{
 assert.equal(sharedForecastPath('https://api.water.noaa.gov/nwps/v1/reaches/12/streamflow?series=short_range'),'reaches/12/streamflow');
 assert.equal(sharedForecastPath('https://example.com/x'),null);
 const direct=[];const f=sharedForecastFetch({'gauges/ABC':{from:'shared'}},async(u)=>{direct.push(u);return new Response('{"from":"noaa"}')});
 assert.equal((await (await f('https://api.water.noaa.gov/nwps/v1/gauges/ABC')).json()).from,'shared');
 assert.equal((await (await f('https://api.water.noaa.gov/nwps/v1/gauges/XYZ')).json()).from,'noaa');
 assert.equal(direct.length,1);
 const none=sharedForecastFetch(null,async()=>new Response('{"from":"noaa"}'));
 assert.equal((await (await none('https://api.water.noaa.gov/nwps/v1/gauges/ABC')).json()).from,'noaa');
});
test('closures screen is reachable',()=>{assert.deepEqual(resolveScreen('#/closures',{}),{screen:'closures'})});
test('offline support always prefers the network, and never cuts a slow answer off',()=>{
 const sw=read('sw.js');
 assert.match(sw,/await fetch\(request\)/);assert.doesNotMatch(sw,/abort\(/);assert.match(sw,/simulation\\\/data/);assert.match(sw,/renderer-chunks/);
 assert.match(read('app.js'),/navigator\.serviceWorker\.register\('sw\.js'\)/);
});
test('the preload step lists the whole startup module tree',()=>{
 const dir=mkdtempSync(join(tmpdir(),'preload-'));
 try{
  mkdirSync(join(dir,'sub'));
  writeFileSync(join(dir,'index.html'),'<head></head><script type="module" src="app.js?v=1"></script>');
  writeFileSync(join(dir,'app.js'),"import {a} from './sub/a.js?v=1';\nconst later=()=>import('./lazy.js');");
  writeFileSync(join(dir,'sub/a.js'),"export {b} from './b.js?v=1';");
  writeFileSync(join(dir,'sub/b.js'),'export const b=1;');
  execFileSync(process.execPath,[fileURLToPath(new URL('../tools/add-preloads.mjs',import.meta.url)),dir],{stdio:'pipe'});
  const html=readFileSync(join(dir,'index.html'),'utf8');
  for(const m of ['app.js?v=1','sub/a.js?v=1','sub/b.js?v=1'])assert.ok(html.includes(`<link rel="modulepreload" href="${m}">`),m);
  assert.doesNotMatch(html,/lazy/);
 }finally{rmSync(dir,{recursive:true,force:true})}
});
