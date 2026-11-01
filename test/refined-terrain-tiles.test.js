// Synthetic loader contracts; not refined model output.
import test from 'node:test';import assert from 'node:assert/strict';
import {createTerrainTileLoader} from '../tools/simulation/refined-terrain-tiles-source.js';
import {createRefinedWater} from '../tools/simulation/refined-water-source.js';
import * as THREE from 'three';
function fixture(){
 const hash='a'.repeat(64),manifest={kind:'quadtree_output_package',status:'partial',runId:'SYNTHETIC-TERRAIN',geometry:{sha256:hash},provenance:{verticalDatum:'NAVD88'},terrainDisplay:{status:'available',artifact:{path:'terrain-index.json.gz',sha256:'b'.repeat(64)}}};
 const bind={runId:manifest.runId,geometrySha256:hash,verticalDatum:'NAVD88'},assets={},tiles=[];
 for(let i=0;i<3;i++){const levels=[];for(let level=0;level<2;level++){const path=`tile-${i}-${level}.json.gz`,triangles=level?4:2;levels.push({level,triangles,artifact:{path,sha256:(i*2+level+1).toString().repeat(64),bytes:100}});assets[path]={...bind,kind:'native_face_triangle_terrain',tileId:String(i),level,vertices:[[i,0,0],[i+1,0,0],[i+1,1,1],[i,1,0]],triangles:Array.from({length:triangles},(_,k)=>k%2?[0,2,3]:[0,1,2]),triangleFaceId:Array(triangles).fill(String(i))};}tiles.push({id:String(i),bounds:[i,0,i+1,1],levels});}
 assets['terrain-index.json.gz']={...bind,kind:'native_face_terrain_tiles',tiles};return {manifest,assets};
}
const extent={xmin:.01,ymin:.01,xmax:2.99,ymax:.99};
function coarseFixture(){const f=fixture();for(let i=0;i<3;i++){const tile=f.assets['terrain-index.json.gz'].tiles[i],base=f.assets[`tile-${i}-0.json.gz`];
 base.vertices.push([i+.5,.5,.25]);base.triangles=[[0,1,4],[1,2,4],[2,3,4],[3,0,4]];base.triangleFaceId=Array(4).fill(String(i));tile.levels[0].triangles=4;
 const path=`tile-${i}-coarse.json.gz`;f.assets[path]={...base,level:2,coarseFallback:true,triangles:[[0,1,2],[0,2,3]],triangleFaceId:Array(2).fill(String(i))};tile.levels.push({level:2,coarseFallback:true,triangles:2,artifact:{path,sha256:(i+7).toString().repeat(64),bytes:75}});
 }return f;}
test('SYNTHETIC: explicit coarse level preserves coverage before L0 upgrades and reports huge views',async()=>{
 const f=coarseFixture(),reads=[],loader=createTerrainTileLoader({manifest:f.manifest,geometry:{},readArtifact:async a=>{reads.push(a.path);return f.assets[a.path];}});
 const full=await loader.load({extent,zoom:18,budget:6,maxTiles:3});assert.deepEqual(full.stats.levels,[2,2,2]);assert.equal(full.stats.completeVisibleCoverage,true);assert.equal(full.stats.coarseFallbackTiles,3);assert.equal(full.stats.coarseCoverageTriangles,6);assert.equal(full.stats.omittedTiles,0);assert.ok(reads.slice(1).every(p=>p.endsWith('-coarse.json.gz')));
 const improved=await loader.load({extent,center:{x:.1,y:.5},zoom:14,budget:8,maxTiles:3});assert.deepEqual(improved.stats.levels,[0,2,2]);assert.equal(improved.stats.completeVisibleCoverage,true);
 const bounded=await loader.load({extent,zoom:18,budget:4,maxTiles:3});assert.equal(bounded.stats.loadedTiles,2);assert.equal(bounded.stats.omittedTiles,1);assert.equal(bounded.stats.completeVisibleCoverage,false);assert.equal(bounded.stats.coverageLimitedBy,'triangle-budget');loader.dispose();
});
test('SYNTHETIC: only explicit exact compact geometry equivalence accepts immutable source terrain',async()=>{
 const prepare=()=>{const f=fixture(),source=f.manifest.geometry.sha256;f.manifest.geometry.sha256='c'.repeat(64);f.manifest.compactSource={geometry:{sha256:source}};f.manifest.terrainDisplay.geometryEquivalence={method:'exact-native-geometry',runId:f.manifest.runId,sourceGeometrySha256:source,targetGeometrySha256:f.manifest.geometry.sha256,cellCount:3,canonicalSha256:'d'.repeat(64)};return f;};
 const f=prepare(),loader=createTerrainTileLoader({manifest:f.manifest,geometry:{cells:Array(3)},readArtifact:async a=>f.assets[a.path]});const result=await loader.load({extent,zoom:14,maxTiles:1});assert.equal(result.geometrySha256,'c'.repeat(64));assert.equal(result.sourceGeometrySha256,'a'.repeat(64));assert.equal(f.assets['terrain-index.json.gz'].geometrySha256,'a'.repeat(64));loader.dispose();
 for(const change of [e=>e.sourceGeometrySha256='f'.repeat(64),e=>e.targetGeometrySha256='f'.repeat(64),e=>e.method='same-count',e=>e.cellCount=4,e=>e.canonicalSha256='invalid',e=>e.runId='other']){const bad=prepare();change(bad.manifest.terrainDisplay.geometryEquivalence);const denied=createTerrainTileLoader({manifest:bad.manifest,geometry:{cells:Array(3)},readArtifact:async a=>bad.assets[a.path]});await assert.rejects(denied.load({extent}),/mismatch/);denied.dispose();}
});
test('SYNTHETIC: coarse coverage is reserved before nearest-tile detail upgrades',async()=>{
 const f=fixture(),loader=createTerrainTileLoader({manifest:f.manifest,geometry:{},readArtifact:async a=>f.assets[a.path]});
 const allCoarse=await loader.load({extent,center:{x:.1,y:.5},zoom:18,budget:6,maxTiles:3});assert.equal(allCoarse.stats.loadedTiles,3);assert.equal(allCoarse.stats.omittedTiles,0);assert.deepEqual(allCoarse.stats.levels,[0,0,0]);
 const fineNear=await loader.load({extent,center:{x:.1,y:.5},zoom:18,budget:8,maxTiles:3});assert.equal(fineNear.stats.loadedTiles,3);assert.deepEqual(fineNear.stats.levels,[1,0,0]);assert.equal(fineNear.stats.triangles,8);loader.dispose();
});
test('SYNTHETIC: lazy nearest tiles, LOD budgets, stable key and bounded cache',async()=>{
 const f=fixture(),reads=[];const loader=createTerrainTileLoader({manifest:f.manifest,geometry:{},cacheTiles:1,readArtifact:async a=>{reads.push(a.path);return f.assets[a.path];}});assert.equal(reads.length,0);
 const first=await loader.load({extent,center:{x:.1,y:.5},zoom:18,budget:4,maxTiles:2});assert.deepEqual(first.stats.levels,[0,0]);assert.equal(first.stats.loadedTiles,2);assert.equal(first.stats.omittedTiles,1);assert.equal(first.triangleFaceId[0],'0');assert.equal(reads.length,3);
 const same=await loader.load({extent,center:{x:.1,y:.5},zoom:18,budget:4,maxTiles:2});assert.equal(same,first);assert.equal(reads.length,3);assert.equal(same.stats.downloadedBytes,0);
 const second=await loader.load({extent,center:{x:2.9,y:.5},zoom:14,budget:4,maxTiles:2});assert.deepEqual(second.stats.levels,[0,0]);assert.equal(second.triangleFaceId[0],'2');assert.equal(second.triangles.length,4);assert.equal(loader.stats.cachedTiles,1);
 const empty=await loader.load({extent:{xmin:8,ymin:8,xmax:9,ymax:9}});assert.equal(empty.triangles.length,0);assert.equal(empty.stats.loadedTiles,0);loader.dispose();assert.equal(loader.stats.cachedTiles,0);await assert.rejects(loader.load({extent}),/disposed/);
});
test('SYNTHETIC: source binding mismatch and obsolete terrain completion rejected',async()=>{
 const f=fixture();let release;const loader=createTerrainTileLoader({manifest:f.manifest,geometry:{},readArtifact:a=>a.path==='tile-0-0.json.gz'?new Promise(r=>release=r):Promise.resolve(f.assets[a.path])});
 const old=loader.load({extent,center:{x:.1,y:.5},zoom:14,maxTiles:1});while(!release)await new Promise(r=>setTimeout(r,0));const current=await loader.load({extent,center:{x:2.9,y:.5},zoom:14,maxTiles:1});release(f.assets['tile-0-0.json.gz']);await assert.rejects(old,{name:'AbortError'});assert.equal(current.triangleFaceId[0],'2');loader.dispose();
 const wrong=fixture();wrong.assets['tile-1-0.json.gz'].geometrySha256='f'.repeat(64);const reject=createTerrainTileLoader({manifest:wrong.manifest,geometry:{},readArtifact:async a=>wrong.assets[a.path]});await assert.rejects(reject.load({extent,zoom:14,maxTiles:1}),/mismatch/);reject.dispose();
});
test('SYNTHETIC: cancelled index request retries for newer load; single-artifact compatibility',async()=>{
 const f=fixture();let reads=0;const loader=createTerrainTileLoader({manifest:f.manifest,geometry:{},readArtifact:(a,{signal})=>{if(a.path!=='terrain-index.json.gz')return Promise.resolve(f.assets[a.path]);reads++;if(reads>1)return Promise.resolve(f.assets[a.path]);return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('cancelled','AbortError')),{once:true}));}});
 const old=loader.load({extent});const next=loader.load({extent,zoom:14,maxTiles:1});await assert.rejects(old,{name:'AbortError'});assert.equal((await next).stats.loadedTiles,1);assert.equal(reads,2);loader.dispose();
 const single=createTerrainTileLoader({manifest:f.manifest,geometry:{},readArtifact:async()=>f.assets['tile-0-0.json.gz']});assert.equal((await single.load()).kind,'native_face_triangle_terrain');single.dispose();
});
test('SYNTHETIC: partial run and empty streamed selection preserve explicit native picking data',()=>{
 const f=fixture(),time='2026-11-01T17:15:00Z';f.manifest.frames=[{time}];
 const geometry={runId:f.manifest.runId,geometryKind:'native_quadtree_faces',cells:[{nativeFaceId:'0',areaM2:100,resolutionM:10}],rings:[[[0,0],[0,1],[1,1],[1,0]]]};
 const terrain={kind:'native_face_triangle_terrain',runId:f.manifest.runId,geometrySha256:f.manifest.geometry.sha256,verticalDatum:'NAVD88',vertices:[],triangles:[],triangleFaceId:[],tileSelectionKey:''};
 const view=createRefinedWater({loaded:{manifest:f.manifest},geometry,terrain,origin:new THREE.Vector3(),project:([x,y])=>new THREE.Vector3(x,y,0),altitude:z=>z});
 assert.equal(view.setDetail([0]).omittedFaces,1);view.update({runId:f.manifest.runId,geometrySha256:f.manifest.geometry.sha256,time,depthM:[1],nativeVolumeM3:[100],waterSurfaceM:[5]});view.select(0);assert.equal(view.water.count,0);assert.equal(view.cellInfo(0).surfaceM,5);assert.equal(view.cellInfo(0).depthM,1);view.dispose();
});
