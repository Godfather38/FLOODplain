// Synthetic compatibility fixture only. No forecast/coverage claim or public asset.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createRefinedWater,validateRefinedTerrain,validateRefinedFrame} from '../tools/simulation/refined-water-source.js';

function fixture(){
  const sha='a'.repeat(64),time='2026-11-01T17:15:00Z';
  const manifest={kind:'quadtree_output_package',status:'complete',runId:'SYNTHETIC-NOT-A-FORECAST',geometry:{sha256:sha},frames:[{time},{time:'2026-11-01T18:00:00Z'}],provenance:{verticalDatum:'NAVD88',negativeVolumeDisplayToleranceM3:0}};
  const geometry={runId:manifest.runId,geometryKind:'native_quadtree_faces',cells:[{nativeFaceId:'9007199254740993',areaM2:10000,resolutionM:100,lon:.0005,lat:.0005},{nativeFaceId:'face-small',areaM2:2500,resolutionM:50,lon:.00125,lat:.00025}],rings:[[[0,0],[0,.001],[.0005,.001],[.001,.001],[.001,0]],[[0,.001],[0,.0015],[.0005,.0015],[.0005,.001]]]};
  const terrain={kind:'native_face_triangle_terrain',runId:manifest.runId,geometrySha256:sha,verticalDatum:'NAVD88',displayResolutionM:10,
    vertices:[[0,0,0],[.001,0,0],[.001,.0005,0],[.001,.001,2],[0,.001,0],[.0015,0,0],[.0015,.0005,0]],
    triangles:[[0,1,2],[0,2,3],[0,3,4],[1,5,6],[1,6,2]],triangleFaceId:['9007199254740993','9007199254740993','9007199254740993','face-small','face-small']};
  const frame={runId:manifest.runId,geometrySha256:sha,time,depthM:[1,2],nativeVolumeM3:[10000,5000],waterSurfaceM:[1,2]};
  return {manifest,geometry,terrain,frame};
}
function create(f,geometryBudget=100){return createRefinedWater({loaded:{manifest:f.manifest},geometry:f.geometry,terrain:f.terrain,geometryBudget,origin:new THREE.Vector3(),project:([x,y])=>new THREE.Vector3(x*1e5,y*1e5,0),altitude:m=>m});}

test('synthetic unequal native areas, hanging edge and exact string IDs survive geometry/picking',()=>{
  const f=fixture(),view=create(f);const detail=view.setDetail([0,1]);assert.equal(detail.triangles,5);assert.equal(detail.omittedFaces,0);view.update(f.frame);
  assert.equal(view.water.count,7,'two partly submerged triangles are clipped into four water triangles, not full face caps');
  assert.equal(view.cellInfo(0).nativeFaceId,'9007199254740993');assert.equal(view.cellInfo(1).areaM2,2500);assert.equal(view.cellInfo(1).nativeVolumeM3,5000);assert.equal(view.cellInfo(1).depthM,2);assert.equal(view.cellInfo(1).surfaceM,2);assert.equal(view.cellInfo(0).row,undefined);
  for(let i=0;i<view.ids.length;i++)for(let j=0;j<3;j++)assert.ok(Math.abs(view.water.geometry.attributes.position.array[i*9+j*3+2]-(f.frame.waterSurfaceM[view.ids[i]]-view.baseM))<.00002);
  view.select(0);assert.equal(view.group.children[2].geometry.drawRange.count,10,'five-edge footprint selection is not truncated to four');
  const ray=new THREE.Raycaster(new THREE.Vector3(125,25,10),new THREE.Vector3(0,0,-1));assert.equal(view.pick(ray),1);
  const before=view.water.geometry.attributes.position.array.slice();view.animate(30);assert.deepEqual(view.water.geometry.attributes.position.array,before,'animation cannot change native water height');view.dispose();
});

test('synthetic source bindings reject old terrain, equal-length wrong IDs and out-of-face triangles',()=>{
  const f=fixture();for(const patch of [{runId:'old-run'},{geometrySha256:'b'.repeat(64)},{verticalDatum:'OTHER'},{kind:'legacy-100m-blocks'}])assert.throws(()=>validateRefinedTerrain(f.manifest,f.geometry,{...f.terrain,...patch}));
  assert.throws(()=>validateRefinedTerrain(f.manifest,f.geometry,{...f.terrain,triangleFaceId:f.terrain.triangleFaceId.map(()=> 'not-the-native-id')}),/face ID/);
  assert.throws(()=>validateRefinedTerrain(f.manifest,f.geometry,{...f.terrain,triangleFaceId:['face-small',...f.terrain.triangleFaceId.slice(1)]}),/outside/);
  assert.throws(()=>validateRefinedFrame(f.manifest,f.geometry,{...f.frame,depthM:[1,5000/10000]}),/actual polygon area/);
  assert.throws(()=>validateRefinedFrame(f.manifest,f.geometry,{...f.frame,nativeVolumeM3:[-1,5000],depthM:[0,2]}),/actual polygon area/);
});

test('synthetic missing surfaces, zero depth, whole-face LOD and lazy subhourly frames remain explicit',()=>{
  const f=fixture(),view=create(f,3);const result=view.setDetail([0,1]);assert.equal(result.omittedFaces,1);assert.equal(result.visibleFaces,1);assert.equal(result.triangles,3);view.update(f.frame);assert.ok(view.ids.every(i=>i===0));
  view.update({...f.frame,depthM:[0,null],nativeVolumeM3:[0,null],waterSurfaceM:[null,2]});assert.equal(view.water.count,0);assert.equal(view.cellInfo(0).depthM,0);assert.equal(view.cellInfo(1).depthM,null);assert.equal(view.cellInfo(0).surfaceM,null);
  view.update({...f.frame,time:'2026-11-01T18:00:00Z'});assert.equal(view.frame.time,'2026-11-01T18:00:00Z');assert.throws(()=>view.update({...f.frame,time:'2026-11-01T17:30:00Z'}),/time/);assert.equal(view.water.count,0);assert.equal(view.frame,null);
  view.update(f.frame);view.select(0);view.clearFrame();assert.equal(view.water.count,0);assert.equal(view.water.geometry.drawRange.count,0);assert.equal(view.frame,null);assert.equal(view.group.children[2].visible,false);assert.equal(view.land.count,3);
  view.dispose();view.dispose();assert.throws(()=>view.update(f.frame),/disposed/);
});
