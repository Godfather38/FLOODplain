import test from 'node:test';import assert from 'node:assert/strict';
import {createRefinedRendererSource} from '../tools/simulation/refined-renderer-source.js';
import {syntheticRefinedPackage} from './fixtures/refined-renderer-synthetic.js';
test('SYNTHETIC: exact faces, variable rings/areas, hourly and subhourly lazy frames',async()=>{
 const f=syntheticRefinedPackage(),reads=[];const source=createRefinedRendererSource({...f,readArtifact:async artifact=>{reads.push(artifact.path);return f.frames.find(x=>x.time===artifact.time);}});
 assert.equal(reads.length,0);assert.equal(source.footprints.rings[0].length,5);assert.equal(source.loaded.run.frames[0].depthM,undefined);
 const frame=await source.loadFrame(f.manifest.frames[1]);assert.equal(reads.length,1);assert.equal(source.cellInfo(0,frame).nativeFaceId,'9007199254740997');assert.equal(source.cellInfo(1,frame).depthM,null);assert.equal(source.cellInfo(0,frame).nativeVolumeM3,20000);
 const features=source.flatFeatures(frame,{xmin:-112,ymin:32,xmax:-111,ymax:33});assert.equal(features.length,2);assert.equal(features[1].properties.missing,true);assert.equal(features[0].geometry.coordinates[0].length,5);assert.equal(features[0].properties.nativeFaceId,'9007199254740997');
 await source.loadFrame(f.manifest.frames[0]);await source.loadFrame(f.manifest.frames[2]);assert.equal(source.cachedFrames,2);
 await assert.rejects(source.loadTerrain(),/unavailable/);assert.equal(reads.length,3,'no legacy terrain or extra frames fetched');
 assert.throws(()=>source.validateFrame({...frame,depthM:[7,null]},frame.time),/volume/);assert.throws(()=>source.validateFrame({...frame,geometrySha256:'b'.repeat(64)},frame.time),/identity/);
 source.dispose();await assert.rejects(source.loadFrame(f.frames[0]),/disposed/);
});
test('SYNTHETIC: stale frame never installs, unavailable terrain and large overview fail closed',async()=>{
 const f=syntheticRefinedPackage();let complete;const source=createRefinedRendererSource({...f,maxVisibleFaces:1,readArtifact:artifact=>artifact.time===f.frames[0].time?new Promise(r=>complete=r):Promise.resolve(f.frames[1])});
 const stale=source.loadFrame(f.manifest.frames[0]);const next=await source.loadFrame(f.manifest.frames[1]);complete(f.frames[0]);await assert.rejects(stale,{name:'AbortError'});assert.equal(source.cachedFrames,1);
 assert.throws(()=>source.flatFeatures(next,{xmin:-112,ymin:32,xmax:-111,ymax:33}),/zoom in/);
 source.manifest.terrainDisplay={status:'available',artifact:{path:'terrain.json.gz',sha256:'b'.repeat(64)}};
 await assert.rejects(source.loadTerrain(),/match/);source.dispose();
});
