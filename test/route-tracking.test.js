import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {routeInventory,coverageText} from '../public/simulation/route-tracking.js';
import {adaptRecentGauge,trackingState} from '../public/simulation/scene-data-contract.js';
const inventory=JSON.parse(readFileSync(new URL('../public/simulation/data/scene-contract/inventory.json',import.meta.url)));
test('route inventory selects exact route and crossing identities only',()=>{
 const {entries}=routeInventory(inventory,'avra');assert.ok(entries.some(e=>e.id==='brawley-dip'));assert.ok(entries.every(e=>e.routeIds.includes('avra')));
 assert.equal(routeInventory(inventory,'avra','losrobles-bridge').entries.length,0);
 assert.deepEqual(routeInventory(inventory,'avra','brawley-dip').entries.map(e=>e.id),['brawley-dip']);
 assert.equal(routeInventory(inventory,'missing').entries.length,0);
});
test('frozen refined membership, uncovered and awaiting output are distinct from clearance',()=>{
 const now='2026-11-03T00:00:00Z';
 assert.match(coverageText(inventory.entries.find(e=>e.id==='brawley-dip'),now),/expired/);
 assert.match(coverageText(inventory.entries.find(e=>e.model.status==='outside_coverage'),now),/Outside/);
 assert.match(coverageText({model:{status:'not_yet_assessed',resultStatus:'awaiting_verified_output'}},now),/Awaiting/);
 const assessment={score:5,closure:'closed'};const state=trackingState(inventory.entries[0],{now,assessment});assert.equal(state.risk,assessment);assert.equal(state.clearance,null);
});
test('recent gauge adapter keeps source clock and requires distinct times for trend',()=>{
 const now='2026-11-03T00:00:00Z',record={retrievedAt:Date.parse(now),points:[{time:'2026-11-01T00:00:00Z',cfs:10,quality:'Provisional'}]};
 let result=adaptRecentGauge(record,now);assert.equal(result.summary.status,'stale');assert.equal(result.summary.trend,'unknown');assert.equal(result.points[0].quality,'Provisional');
 record.points.push({time:'2026-11-02T23:00:00Z',cfs:20});result=adaptRecentGauge(record,now);assert.equal(result.summary.trend,'rising');assert.equal(result.summary.observedAt,'2026-11-02T23:00:00Z');
});
