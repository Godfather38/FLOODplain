import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {FAILURE_POINTS} from '../public/config.js';
import {validateScene,gaugeSummary,adaptRecentGauge,trackingState,metersToFeet} from '../public/simulation/scene-data-contract.js';
const base='public/simulation/data/scene-contract/';
const read=p=>JSON.parse(fs.readFileSync(p));
const inventory=read(base+'inventory.json'),scene=read(base+'brawley-scene.json');
test('every original crossing record and route association survives deduplication',()=>{
 const crossings=read('public/data/crossings.geojson');
 crossings.features.forEach((f,i)=>{const e=inventory.entries.find(e=>e.evidence.some(p=>p.sourceRecordIndex===i));assert.ok(e);assert.ok(e.routeIds.includes(f.properties.route));});
 for(const p of FAILURE_POINTS){const e=inventory.entries.find(e=>e.id===p.id);assert.ok(e);for(const r of p.routes)assert.ok(e.routeIds.includes(r));}
 assert.equal(new Set(inventory.entries.map(e=>e.id)).size,inventory.entries.length);
 assert.equal(inventory.entries.filter(e=>e.id==='sc-avra').length,1);
 assert.deepEqual(inventory.entries.find(e=>e.id==='sc-avra').routeIds,['avra','pr-avra','silverbell-south']);
});
test('Silverbell prepared faces never become executed hydraulic results',()=>{
 const e=inventory.entries.filter(e=>e.id.startsWith('silverbell-minimum'));
 assert.equal(e.length,2);for(const p of e){assert.equal(p.model.status,'not_yet_assessed');assert.equal(p.model.runId,'41370039087');assert.equal(p.risk.score,null);}
});
test('Brawley has actual native times, terrain bindings and unavailable velocity',()=>{
 assert.equal(validateScene(scene),scene);assert.equal(scene.frames.length,57);
 assert.equal(scene.frames[0].validTime,'2026-11-01T17:00:00Z');
 assert.equal(scene.frames.at(-1).validTime,'2026-11-02T07:00:00Z');
 assert.ok(scene.frames.some(f=>f.depthM.some(d=>d>0)));
 assert.notDeepEqual(scene.frames[0].waterSurfaceM,scene.frames.at(-1).waterSurfaceM);
 assert.equal(scene.terrainGeometryEquivalence.targetRunId,scene.runId);
 for(const t of scene.terrain)assert.equal(createHash('sha256').update(fs.readFileSync(base+t.path)).digest('hex'),t.sha256);
 assert.throws(()=>validateScene({...scene,flow:{status:'available',velocityMps:1,direction:'north'}}));
 assert.ok(read(base+scene.roads).features.length);
});
test('missing, stale, future and zero readings remain distinct; trends use two times',()=>{
 const now='2026-11-02T07:00:00Z';
 assert.equal(gaugeSummary([],now).status,'missing');
 assert.equal(gaugeSummary([{time:now,valueM3s:null}],now).status,'missing');
 assert.equal(gaugeSummary([{time:'2026-11-03T00:00:00Z',valueM3s:0}],now).status,'missing');
 assert.equal(gaugeSummary([{time:now,valueM3s:0}],now).status,'observation_supported');
 assert.equal(gaugeSummary([{time:now,valueM3s:0}],now).trend,'unknown');
 assert.equal(gaugeSummary([{time:'2026-11-01T00:00:00Z',valueM3s:0}],now).status,'stale');
 assert.equal(gaugeSummary([{time:'2026-11-02T06:00:00Z',valueM3s:1},{time:now,valueM3s:2}],now).trend,'rising');
 assert.equal(gaugeSummary([{time:'2026-11-02T06:00:00Z',valueM3s:2},{time:now,valueM3s:1}],now).trend,'falling');
 const a=adaptRecentGauge({source:'existing-cache',points:[{time:now,cfs:1}]},now);assert.equal(a.points[0].valueM3s,0.028316846592);assert.equal(a.stageToRoadCorrection,null);
});
test('tracking preserves existing closure/score and never provides clearance',()=>{
 const risk={score:4.5,closure:'closed'},e=inventory.entries.find(e=>e.id==='brawley-dip');
 const s=trackingState(e,{now:'2026-11-03T00:00:00Z',assessment:risk});
 assert.equal(s.state,'stale');assert.equal(s.risk,risk);assert.equal(s.clearance,null);
 assert.equal(metersToFeet(null),null);assert.equal(metersToFeet(0.3048),1);
 assert.equal(trackingState({id:'unknown'},{now:'2026-11-02T07:00:00Z'}).state,'not_yet_assessed');
});
