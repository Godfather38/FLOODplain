import test from 'node:test';
import assert from 'node:assert/strict';
import {recentGauge} from '../public/simulation/recent-readings.js';
test('recent observations reject empty/missing values and preserve provisional quality',async()=>{
 const now=Date.parse('2026-11-01T12:00:00Z');let calls=0;
 const properties={monitoring_location_id:'USGS-09486500',parameter_code:'00060',unit_of_measure:'ft^3/s',time:'2026-11-01T11:45:00Z',approval_status:'Provisional'};
 const fetchJson=async url=>{calls++;assert.match(url,/datetime=/);return {features:[null,'','12'].map(value=>({properties:{...properties,value}}))}};
 const result=await recentGauge('09486500',{now,fetchJson});assert.equal(result.points.length,1);assert.equal(result.points[0].cfs,12);assert.equal(result.points[0].quality,'Provisional');
 await recentGauge('09486500',{now:now+60000,fetchJson});assert.equal(calls,1);
 const failed=await recentGauge('09486500',{now:now+20*60000,fetchJson:async()=>{throw Error('HTTP 429')}});assert.equal(failed.retrievedAt,now);assert.match(failed.refreshError,/429/);
});
