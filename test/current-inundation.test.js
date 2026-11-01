import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {gunzipSync} from 'node:zlib';
import {acceptCurrentManifest,acceptCurrentRun,loadCurrentRun,currentSfincsEvidence} from '../public/simulation/current-inundation.js';
const now=Date.parse('2026-11-01T16:00:00Z');
const manifest={schemaVersion:1,kind:'current_inundation_manifest',status:'complete',runId:'test-only-contract',issuedAt:'2026-11-01T15:55:00Z',sourceAsOf:'2026-11-01T15:41:00Z',validFrom:'2026-11-01T16:00:00Z',validTo:'2026-11-02T07:00:00Z',artifact:{path:'data/test-only.json.gz',sha256:'a'.repeat(64)},outputQuantity:{name:'cell_average_depth',units:'m',definition:'Cell volume divided by full cell area'},assumptions:['Contract test only, not a real forecast']};
test('unavailable publication never requests or substitutes a historical artifact',async()=>{let requests=0;const r=await loadCurrentRun({now,fetchImpl:async url=>{requests++;assert.equal(url,'data/current-sfincs-manifest.json');return Response.json({schemaVersion:1,kind:'current_inundation_manifest',status:'unavailable',reason:'Explicit no-publication fixture'})}});assert.equal(requests,1);assert.equal(r.status,'unavailable');assert.equal(r.run,null);assert.deepEqual(currentSfincsEvidence(r,{now}),[])});
test('current manifest checks explicit time, expiry, quantity and artifact path',()=>{assert.equal(acceptCurrentManifest(manifest,{now}).status,'ok');assert.equal(acceptCurrentManifest(manifest,{now:now+86400000}).status,'expired');assert.equal(acceptCurrentManifest({...manifest,issuedAt:'2026-11-03T00:00:00Z'},{now}).status,'insufficient_data');assert.equal(acceptCurrentManifest({...manifest,artifact:{...manifest.artifact,path:'data/../old.json.gz'}},{now}).status,'unsupported');assert.equal(acceptCurrentManifest({...manifest,outputQuantity:{name:'road_depth',units:'m'}},{now}).status,'unsupported')});
test('real historical solver output cannot be republished as current by changing a manifest',async()=>{const raw=JSON.parse(gunzipSync(await readFile(new URL('../public/simulation/data/published-channel-2014.json.gz',import.meta.url))));const r=acceptCurrentRun({...manifest,runId:raw.provenance.runId},raw,{now});assert.equal(r.status,'unsupported');assert.equal(r.run,null)});

test('published frozen2026 output loads as simulated live and never as live ranking',async()=>{
 const m=JSON.parse(await readFile(new URL('../public/simulation/data/current-sfincs-manifest.json',import.meta.url)));
 const raw=JSON.parse(gunzipSync(await readFile(new URL('../public/simulation/'+m.artifact.path,import.meta.url))));
 const clock=Math.max(Date.parse(m.issuedAt),Date.parse(m.validFrom));
 const result=acceptCurrentRun(m,raw,{now:clock});
 assert.equal(result.status,'simulated_live');assert.equal(result.run.frames.length,15);assert.equal(result.run.provenance.executionMode,'simulated_live_frozen_inputs');
 assert.ok(currentSfincsEvidence(result,{now:clock}).every(e=>e.status!=='ok'));
});
