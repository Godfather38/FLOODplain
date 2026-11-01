import test from 'node:test';
import assert from 'node:assert/strict';
import {fuseRoutes,handEvidence} from '../public/simulation/route-fusion.js';
const now=Date.parse('2026-11-01T10:00:00Z');
const route=(id,level='ok',checks=[{src:'river',level:'ok'}])=>({id,name:id,level,minutes:10,points:[{id:'sc-sanders',checks}]});
test('fusion excludes official closure, never clears danger or absent observations',()=>{
 const r=fuseRoutes({now,rated:[route('closed','danger',[{src:'county',level:'danger',why:'County says CLOSED'}]),route('danger','danger'),route('missing','ok',[{src:'none',level:'ok'}])]},[],{now});
 assert.equal(r.recommendation,null);assert.equal(r.routes.find(x=>x.id==='closed').excluded,true);assert.equal(r.routes.find(x=>x.id==='missing').level,'unknown');
 assert.equal(fuseRoutes({now:now-86400000,rated:[route('danger','danger')]},[],{now}).routes[0].level,'danger');
});
test('current HAND concern raises original rules, while historical/stale scenarios cannot',()=>{
 const e=handEvidence({kind:'hand_inundation_estimate',junctionId:'sanders-santa-cruz',source:'forecast',status:'ok',flowTime:new Date(now+3600000).toISOString(),asOf:new Date(now).toISOString(),extent:{wetCells:1},provenance:{source:'NOAA'}});
 const snapshot={now,rated:[route('one')]};const current=fuseRoutes(snapshot,[e],{now});assert.equal(current.routes[0].level,'caution');assert.equal(current.routes[0].conflicts,true);
 for(const change of [{mode:'scenario'},{status:'stale'},{validAt:'2014-09-09T07:00:00Z'}])assert.equal(fuseRoutes(snapshot,[{...e,...change}],{now}).routes[0].level,'ok');
 assert.equal(fuseRoutes({...snapshot,now:now-86400000},[e],{now}).recommendation,null);
});
