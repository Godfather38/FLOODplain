// Synthetic compatibility fixture only. No forecast/coverage claim or public asset.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createRefinedWater,validateRefinedTerrain,validateRefinedFrame,refinedDepthColor,validateWaterSupport} from '../tools/simulation/refined-water-source.js';
import {DEPTH_COLORS,DEPTH_CUTS} from '../tools/simulation/voxel-water-source.js';

test('3D native-depth color is continuous at existing quantitative palette stops',()=>{
  const distance=(a,b)=>Math.hypot(a.r-b.r,a.g-b.g,a.b-b.b);
  DEPTH_CUTS.forEach((stop,i)=>{
    assert.ok(distance(refinedDepthColor(stop),new THREE.Color(DEPTH_COLORS[i]))<1e-12,'existing key color preserved at its depth stop');
    assert.ok(distance(refinedDepthColor(stop-1e-6),refinedDepthColor(stop+1e-6))<1e-4,'tiny native-depth change must not cause a visible class jump');
  });
  assert.ok(distance(refinedDepthColor(.15),refinedDepthColor(.25))>.01,'distinct values within an old class retain quantitative variation');
});

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
  const before=view.water.geometry.attributes.position.array.slice(),colors=view.water.geometry.attributes.color.array.slice(),ids=[...view.ids],info=view.cellInfo(1);
  for(const seconds of [0,1.5,30,3600]){view.animate(seconds);assert.deepEqual(view.water.geometry.attributes.position.array,before,'surface lighting cannot change water height or clipped shoreline');assert.deepEqual(view.water.geometry.attributes.color.array,colors,'native depth tint attributes remain unchanged');assert.deepEqual(view.ids,ids);assert.deepEqual(view.cellInfo(1),info);assert.equal(view.pick(ray),1);}
  view.dispose();
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

function colorsAt(view,x,y,face){const positions=view.water.geometry.attributes.position.array,colors=view.water.geometry.attributes.color.array,result=[];for(let t=0;t<view.ids.length;t++)if(view.ids[t]===face)for(let v=0;v<3;v++){const k=t*9+v*3;if(Math.abs(positions[k]-x)<.001&&Math.abs(positions[k+1]-y)<.001)result.push([...colors.slice(k,k+3)]);}return result;}
test('shared tint joins wet edges without changing source depths or crossing dry/missing barriers',()=>{
  const f=fixture(),view=create(f);view.setDetail([0,1]);view.update(f.frame);const a=colorsAt(view,100,0,0),b=colorsAt(view,100,0,1);assert.ok(a.length&&b.length);assert.deepEqual(a[0],b[0],'connected wet faces share their display tint');assert.equal(view.cellInfo(0).depthM,1);assert.equal(view.cellInfo(1).depthM,2);
  for(const missing of [false,true]){view.update({...f.frame,depthM:[1,missing?null:0],nativeVolumeM3:[10000,missing?null:0]});const expected=refinedDepthColor(1);assert.deepEqual(colorsAt(view,100,0,0)[0],Array.from(new Float32Array([expected.r,expected.g,expected.b])),'dry or missing neighbour contributes no color');}
  view.dispose();
});
test('a particle overlay stops the native sheet hiding the water it measures, and restores',()=>{
  const f=fixture(),view=create(f);view.setDetail([0,1]);view.update(f.frame);
  const material=view.water.material,heights=view.water.geometry.attributes.position.array.slice();
  const colors=view.water.geometry.attributes.color.array.slice(),ids=[...view.ids];
  assert.equal(material.depthWrite,true,'the default 3D water behaviour is unchanged');
  assert.equal(view.particleOverlay,false);
  assert.equal(view.setParticleOverlay(true),true,'the previous state is returned so a caller can restore it');
  assert.equal(material.depthWrite,false);
  assert.equal(material.depthTest,true,'terrain must still hide water behind a ridge');
  assert.equal(view.particleOverlay,true);
  assert.equal(material.transparent,true);
  // Native heights, clipped shoreline, tints and picking cannot move.
  assert.deepEqual(view.water.geometry.attributes.position.array,heights);
  assert.deepEqual(view.water.geometry.attributes.color.array,colors);
  assert.deepEqual(view.ids,ids);
  assert.equal(view.pick(new THREE.Raycaster(new THREE.Vector3(125,25,10),new THREE.Vector3(0,0,-1))),1);
  view.setParticleOverlay(false);
  assert.equal(material.depthWrite,true);
  assert.equal(view.particleOverlay,false);
  view.update(f.frame);assert.deepEqual(view.water.geometry.attributes.position.array,heights);
  view.dispose();
});
test('point-only wet contact never joins tint components across a domain gap',()=>{
  const f=fixture();f.geometry.rings[1]=[[.001,.001],[.001,.0015],[.0015,.0015],[.0015,.001]];f.terrain.vertices=[[0,0,0],[.001,0,0],[.001,.001,0],[0,.001,0],[.0015,.001,0],[.0015,.0015,0],[.001,.0015,0]];f.terrain.triangles=[[0,1,2],[0,2,3],[2,4,5],[2,5,6]];f.terrain.triangleFaceId=['9007199254740993','9007199254740993','face-small','face-small'];f.geometry.rings[0]=[[0,0],[0,.001],[.001,.001],[.001,0]];
  const view=create(f);view.setDetail([0,1]);view.update(f.frame);assert.notDeepEqual(colorsAt(view,100,100,0)[0],colorsAt(view,100,100,1)[0]);view.dispose();
});
test('wet native faces separated by a dry terrain ridge do not exchange display tints',()=>{
  const f=fixture();f.terrain.vertices[1][2]=3;f.terrain.vertices[2][2]=3;const view=create(f);view.setDetail([0,1]);view.update(f.frame);assert.ok(view.water.count>0);
  const colors=view.water.geometry.attributes.color.array;for(let t=0;t<view.ids.length;t++){const color=refinedDepthColor(f.frame.depthM[view.ids[t]]),expected=Array.from(new Float32Array([color.r,color.g,color.b]));for(let v=0;v<3;v++)assert.deepEqual(Array.from(colors.slice(t*9+v*3,t*9+v*3+3)),expected);}
  view.dispose();
});
function overviewFixture(){const f=fixture(),encode=a=>({type:a.constructor.name,base64:Buffer.from(a.buffer).toString('base64')});const support={kind:'native_face_water_support',runId:f.manifest.runId,geometrySha256:f.manifest.geometry.sha256,verticalDatum:'NAVD88',faceOrder:'geometry.cells-order',faceCount:2,byteOrder:'little-endian',encoding:{boundaryElevationM:encode(new Float32Array([0,0,0,2,0,0,0,0,0])),faceVertexOffsets:encode(new Uint32Array([0,5,9])),faceTriangleOffsets:encode(new Uint32Array([0,3,5])),localTriangleIndices:encode(new Uint8Array([0,1,2,0,2,3,0,3,4,0,1,2,0,2,3]))}};f.terrain={kind:'native_face_water_support',runId:f.manifest.runId,geometrySha256:f.manifest.geometry.sha256,verticalDatum:'NAVD88',overviewMode:true,waterSupport:support,overviewGround:{kind:'native_domain_terrain_overview',runId:f.manifest.runId,geometrySha256:f.manifest.geometry.sha256,verticalDatum:'NAVD88',vertices:f.terrain.vertices,triangles:f.terrain.triangles,samplingM:100,coverage:{exactNativeDomain:true}}};return f;}
test('overview ground has no fake face IDs; global native support retains exact wet-face values and clipping',()=>{
  const f=overviewFixture(),view=createRefinedWater({loaded:{manifest:f.manifest},geometry:f.geometry,terrain:f.terrain,origin:new THREE.Vector3(),project:([x,y])=>new THREE.Vector3(x*1e5,y*1e5,0),altitude:m=>m,geometryBudget:100,waterGeometryBudget:20});view.setDetail([0,1]);view.update(f.frame);assert.equal(view.water.count,7);assert.equal(view.land.count,5);assert.equal(view.detailStats.omittedWetFaces,0);assert.equal(view.detailStats.overviewMode,true);assert.equal(view.cellInfo(1).nativeFaceId,'face-small');assert.equal(view.pick(new THREE.Raycaster(new THREE.Vector3(125,25,10),new THREE.Vector3(0,0,-1))),1);
  const array=view.water.geometry.attributes.position.array;view.clearFrame();view.update(f.frame);assert.equal(view.water.geometry.attributes.position.array,array,'same immutable frame/extent reuses geometry allocation');assert.equal(view.water.count,7);view.dispose();
  assert.throws(()=>validateWaterSupport(f.manifest,f.geometry,{...f.terrain.waterSupport,faceOrder:'guessed'}),/order/);
  const limited=createRefinedWater({loaded:{manifest:f.manifest},geometry:f.geometry,terrain:f.terrain,origin:new THREE.Vector3(),project:([x,y])=>new THREE.Vector3(x*1e5,y*1e5,0),altitude:m=>m,waterGeometryBudget:6});limited.setDetail([0,1]);limited.update(f.frame);
  // Budget overflow must never SILENTLY publish a partial wet map. It used to
  // satisfy that by publishing no water at all, which made the modelled water
  // vanish from the 3D map and read as dry ground. It now falls back to the
  // coarser native full-cell product, and the obligation is that the fallback
  // announces itself: a different product name, its own counts, and the
  // budget-limited flag still set.
  assert.ok(limited.water.count>0,'budget overflow must keep showing the water it can, not erase it');
  assert.equal(limited.detailStats.budgetLimited,true);
  assert.equal(limited.detailStats.waterProduct,'native-cell','the coarser product is named, never passed off as the resolved footprint');
  assert.ok(limited.detailStats.waterFallback,'the fallback reports itself');
  assert.equal(limited.detailStats.waterFallback.kind,'native-cell');
  assert.ok(limited.detailStats.waterFallback.cellsDrawn>0,'and says how many wet cells it drew');
  assert.match(limited.detailStats.waterFallback.meaning,/not a resolved wet extent/);
  assert.equal(limited.detailStats.waterFallback.cellsDrawn+limited.detailStats.waterFallback.cellsOmitted,2,
    'every wet cell is either drawn or counted as omitted');
  assert.ok(limited.water.count<=6,'and it still respects the budget it was given');
  assert.equal(limited.land.count,5);limited.dispose();
});
