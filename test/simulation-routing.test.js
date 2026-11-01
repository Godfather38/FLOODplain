import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routeGauge } from '../public/simulation/routing.js';
const input=(q)=>({units:'m3/s',points:q.map((valueM3s,i)=>({time:new Date(Date.UTC(2020,0,1,0,i*15)).toISOString(),valueM3s}))});
test('routing conserves steady input and has analytical step response',()=>{
 const steady=routeGauge(input([3,3,3,3]),{lagMinutes:15,kMinutes:30});assert.ok(steady.points.every(p=>p.valueM3s===3));
 const step=routeGauge(input([0,10,10,10]),{lagMinutes:0,kMinutes:30});assert.equal(step.points[1].valueM3s,0);assert.ok(Math.abs(step.points[2].valueM3s-10*(1-Math.exp(-.5)))<1e-12);assert.ok(Math.abs(step.points[3].valueM3s-10*(1-Math.exp(-1)))<1e-12);
});
test('pure lag shifts by actual time and never reads downstream values',()=>{
 const r=routeGauge(input([1,2,4,2,1]),{lagMinutes:15,kMinutes:0});assert.deepEqual(r.points.map(p=>p.valueM3s),[1,1,2,4,2]);
});
test('routing rejects large gaps, invalid parameters and time reversal',()=>{
 const t=input([0,1,2]);t.points[2].time='2020-01-01T01:00:00Z';assert.throws(()=>routeGauge(t,{lagMinutes:0,kMinutes:1}));assert.throws(()=>routeGauge(input([0,1]),{lagMinutes:-1,kMinutes:1}));assert.throws(()=>routeGauge({...input([0,1]),points:input([0,1]).points.reverse()},{lagMinutes:0,kMinutes:1}));
});
