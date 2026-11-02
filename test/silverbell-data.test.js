import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {loadSilverbellData} from '../public/simulation/silverbell-data.js';
import {modelFreshness,trackingState,validateScene} from '../public/simulation/scene-data-contract.js';
const read=p=>JSON.parse(fs.readFileSync(p));
const scene=read('public/simulation/data/scene-contract/silverbell-point-scene.json');
const inventory=read('public/simulation/data/scene-contract/inventory.json');
test('actual two-point series agrees with expected peaks and retains raw quantities',()=>{
 assert.equal(validateScene(scene),scene);assert.equal(scene.frames.length,57);assert.equal(scene.cells.length,2);
 assert.deepEqual(scene.cells.map(c=>c.nativeFaceId),['358178','323310']);
 assert.deepEqual(scene.cells.map((_,i)=>Math.max(...scene.frames.map(f=>f.depthM[i]))),[0.07172018432617187,0.004687054061889648]);
 for(const f of scene.frames)for(let i=0;i<2;i++)assert.equal(f.depthM[i],Math.max(0,f.nativeVolumeM3[i])/scene.cells[i].areaM2);
 assert.ok(Math.max(...scene.frames.map(f=>f.waterSurfaceM[1]))<scene.cells[1].roadProfileTerrainNAVD88M);
 assert.equal(scene.terrainAvailability.status,'unavailable');assert.equal(scene.extent.status,'unavailable');assert.deepEqual(scene.terrain,[]);
 assert.equal(scene.flow.velocityMps,null);
});
test('completed output is not automatically current; original validity expires',()=>{
 const entry=inventory.entries.find(e=>e.model.runId===scene.runId);
 const before=modelFreshness(entry.model,'2026-11-01T16:00:00Z');assert.equal(before.temporalStatus,'not_yet_valid');
 const within=modelFreshness(entry.model,'2026-11-02T06:00:00Z');assert.equal(within.temporalStatus,'within_original_valid_window');assert.equal(within.currentWeather,false);assert.equal(within.sourceIssueAgeMs.NWM,17*3600000);
 const after=trackingState(entry,{now:'2026-11-02T08:00:00Z'});assert.equal(after.state,'stale');assert.equal(after.freshness.temporalStatus,'expired');assert.equal(after.freshness.currentWeather,false);
 assert.throws(()=>modelFreshness(entry.model,undefined));
 assert.equal(read('public/simulation/data/scene-contract/uncovered.json').awaitingResults.length,0);
});
test('opt-in consumer loads its own geometry and lazily verifies a native frame',async()=>{
 const requests=[];
 const fetchImpl=async url=>{requests.push(new URL(url).pathname);return new Response(fs.readFileSync(path.join('public',new URL(url).pathname)),{status:200});};
 const loaded=await loadSilverbellData({base:'https://example.invalid/simulation/',now:'2026-11-02T08:00:00Z',fetchImpl});
 assert.equal(loaded.geometry.cells.length,480227);assert.equal(loaded.geometry.runId,scene.runId);assert.equal(loaded.freshness.temporalStatus,'expired');
 assert.equal(requests.length,3);assert.equal(loaded.terrain.status,'unavailable');
 const frame=await loaded.readFrame(0);assert.equal(requests.length,4);assert.equal(frame.runId,scene.runId);
 for(let i=0;i<2;i++){const index=loaded.geometry.cells.findIndex(c=>c.nativeFaceId===scene.cells[i].nativeFaceId);assert.equal(frame.waterSurfaceM[index],scene.frames[0].waterSurfaceM[i]);assert.equal(frame.depthM[index],scene.frames[0].depthM[i]);}
 await assert.rejects(()=>loaded.readFrame(-1),/index/);
 const wrong=async url=>{if(new URL(url).pathname.endsWith('frame-1.bin.gz'))return new Response(fs.readFileSync('public/simulation/data/refined-full-compact-41344983607/frame-1.bin.gz'));return fetchImpl(url);};
 const readQuadtreeArtifact=(await import('../public/simulation/quadtree-output.js')).readQuadtreeArtifact;
 await assert.rejects(()=>readQuadtreeArtifact(new URL('https://example.invalid/simulation/data/silverbell-full-41370039087/compact/manifest.json'),loaded.manifest.frames[1],{fetchImpl:wrong,geometry:loaded.geometry}),/checksum/);
});
