// Bind display-only ground to the completed package; never modify model frames.
import {readFile,writeFile} from 'node:fs/promises';
import {gzipSync,gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root='public/simulation/data/',full=root+'refined-full-compact-41344983607/',terrain=root+'refined-partial-41339621278/';
const hash=b=>createHash('sha256').update(b).digest('hex'),json=async p=>JSON.parse(await readFile(p));
const manifest=await json(full+'manifest.json'),report=await json(terrain+'terrain-water-aware-verification.json');
assert.equal(manifest.status,'complete');assert.equal(manifest.frames.length,57);assert.equal(report.runId,manifest.runId);assert.equal(report.geometrySha256,manifest.geometry.sha256);assert.equal(report.displayThresholdM,.01);
const original=await readFile(terrain+'terrain-index-overview.json.gz'),index=JSON.parse(gunzipSync(original)),levels=[];
for(const output of report.outputs){const a=output.artifact,bytes=await readFile(terrain+a.path);assert.equal(hash(bytes),a.sha256);assert.equal(bytes.length,a.bytes);const ground=JSON.parse(gunzipSync(bytes));
 assert.equal(ground.runId,manifest.runId);assert.equal(ground.geometrySha256,manifest.geometry.sha256);assert.equal(ground.verticalDatum,manifest.provenance.verticalDatum);assert.equal(ground.meshSha256,manifest.provenance.meshSha256);assert.equal(ground.coverage.exactNativeDomain,true);assert.equal(ground.provenance.coverageSymmetricDifferenceM2,0);assert.equal(ground.provenance.nativeCoarseOverlapM2,0);assert.equal(ground.provenance.displayThresholdM,.01);assert.ok(ground.triangles.length<=260000);
 assert.deepEqual(ground.provenance.sourceFrames.map(f=>[f.time,f.path,f.sha256]),manifest.frames.map(f=>[f.time,f.path,f.sha256]));assert.equal(ground.provenance.sourceTerrainIndexSha256,hash(original));
 levels.push({level:levels.length,terrainOnly:true,waterAware:true,samplingM:output.samplingM,triangles:ground.triangles.length,vertices:ground.vertices.length,artifact:a});
}
assert.ok(levels.length);const nextIndex={...index,runId:manifest.runId,geometrySha256:manifest.geometry.sha256,meshSha256:manifest.provenance.meshSha256,overviewLevels:levels,provenance:{...index.provenance,waterAwareGround:{runId:manifest.runId,displayThresholdM:.01,frameCount:57,method:'Retained native terrain beneath every face with displayed water in this completed run; exact coarse remainder outside those faces.'}}};
const indexBytes=gzipSync(JSON.stringify(nextIndex)),artifact={path:'terrain-index-water-aware.json.gz',sha256:hash(indexBytes),bytes:indexBytes.length};
const display={...manifest.terrainDisplay,artifact,note:'Native terrain retained under every face reaching the existing 0.01 m display threshold in any completed frame; coarse dry-display remainder. No water, hydraulic resolution or road-safety tolerance changed.',provenance:{...manifest.terrainDisplay.provenance,waterAwareGround:levels.map(l=>l.artifact)}};
const next=JSON.stringify({...manifest,terrainDisplay:display},null,2)+'\n',pointer=await json(root+'refined-sfincs-publication.json');pointer.sha256=hash(next);
if(process.argv.includes('--write')){await writeFile(terrain+artifact.path,indexBytes);await writeFile(full+'terrain-display.json',JSON.stringify(display,null,2)+'\n');await writeFile(full+'manifest.json',next);await writeFile(root+'refined-sfincs-publication.json',JSON.stringify(pointer,null,2)+'\n');}
console.log(JSON.stringify({written:process.argv.includes('--write'),runId:manifest.runId,artifact,ground:levels,manifestSha256:pointer.sha256},null,2));
