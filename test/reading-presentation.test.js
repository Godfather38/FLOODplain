import test from 'node:test';import assert from 'node:assert/strict';
import {pointReadingSummary,visibleSourceChecks,locationGroupTitle} from '../public/reading-presentation.js';
import {liveCoverage,coverageText,liveGaugeReading} from '../public/simulation/route-tracking.js';
import {rateFailurePoint} from '../public/logic.js';import * as cfg from '../public/config.js';
test('empty locations have no synthetic live-reading announcement but remain unknown',()=>{
 const fp=cfg.FAILURE_POINTS.find(p=>p.id==='elpaso-dip');
 const p=rateFailurePoint(fp,{now:Date.now(),flows:{},closures:null,alert:null,nws:null},cfg);
 assert.equal(p.evidenceAvailable,false);assert.equal(pointReadingSummary(p),'');
 assert.ok(p.checks.some(c=>c.src==='none'));assert.ok(visibleSourceChecks(p).every(c=>c.src!=='none'));
 assert.equal(locationGroupTitle([p],false),'Route locations');
});
test('actual failed, stale, and hazardous source reports remain visible',()=>{
 for(const why of ['Rain gauges unreachable right now','Gauge reading is stale','County says CLOSED']){
  const check={src:'county',why,level:'unknown'},p={why,checks:[check]};
  assert.equal(pointReadingSummary(p),why);assert.deepEqual(visibleSourceChecks(p),[check]);
 }
 assert.equal(liveGaugeReading('USGS-09486520',{flows:{'09486520':{fresh:false,cfs:100}}}),null);
});
test('unmapped tracking locations are quiet; applicable sources still show',()=>{
 const c=liveCoverage({coordinates:[-111,32],gaugeAssociations:[]});assert.equal(coverageText(c),'');
 assert.match(coverageText({...c,gauges:1}),/1 linked gauge/);
 assert.match(coverageText({...c,county:[{}]}),/county barricade/);
 assert.match(coverageText({...c,forecast:true}),/Live forecast/);
});
