import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {gunzipSync} from 'node:zlib';import * as THREE from 'three';
import {createVoxelWater,validateVoxelData} from '../tools/simulation/voxel-water-source.js';
const dir=new URL('../public/simulation/data/',import.meta.url),read=name=>JSON.parse(readFileSync(new URL(name,dir))),gz=name=>JSON.parse(gunzipSync(readFileSync(new URL(name,dir))));
const manifest=read('retained-sfincs-manifest.json'),run=gz(manifest.artifact.path.replace('data/','')),terrain=gz('frozen-terrain-display.json.gz'),footprints=gz('frozen-cell-footprints.json.gz');
const raw=gunzipSync(readFileSync(new URL('frozen-voxel-terrain.f32.gz',dir))),detail=new Float32Array(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength));
test('all 15 native frames and 2,968,500 retained terrain samples match source',()=>{
  const frames=validateVoxelData({manifest,run},terrain,footprints);assert.equal(frames.size,15);assert.equal(run.cells.length,29685);assert.equal(detail.length,2968500);assert.ok(detail.every(Number.isFinite));
  assert.throws(()=>validateVoxelData({manifest,run},{...terrain,sourceSha256:'wrong'},footprints),/match/);
});
test('continuous mesh clips terrain, keeps source picks and never animates heights',()=>{
 const view=createVoxelWater({loaded:{manifest,run},terrain,footprints,detail,origin:new THREE.Vector3(),project:([x,y])=>new THREE.Vector3(x*100000,y*100000,0),altitude:m=>m});
 const lod=view.setDetail([9344,9508],10);assert.equal(lod.instances,200);assert.equal(lod.resolutionM,10);assert.equal(view.land.isInstancedMesh,undefined);assert.equal(view.land.count,400);
 for(const frame of run.frames){view.update(frame);assert.ok(view.ids.every(i=>[9344,9508].includes(i)));assert.ok(view.water.geometry.attributes.position.array.every(Number.isFinite));}
 const frame=run.frames[10];view.update(frame);assert.ok(view.water.count>0);assert.ok(view.water.count<800,'clipped two-cell surface has bounded triangles');
 const before=view.water.geometry.attributes.position.array.slice();view.animate(123);assert.deepEqual(view.water.geometry.attributes.position.array,before);
 view.select(9344);view.update(run.frames[11]);assert.equal(view.selected,9344);assert.equal(view.cellInfo(9344).time,run.frames[11].time);assert.equal(view.cellInfo(9344).depthM,4.672212151378935);
 const dry={...frame,depthM:frame.depthM.map(()=>0)};view.update(dry);assert.equal(view.water.count,0);assert.equal(view.cellInfo(9344).depthM,0);
 const missing={...frame,depthM:frame.depthM.map(()=>null)};view.update(missing);assert.equal(view.water.count,0);assert.equal(view.cellInfo(9344).depthM,null);
 assert.throws(()=>view.update({...frame,time:'missing'}),/unavailable/);assert.equal(view.water.count,0);
 const hd=read('voxel-detail-1m.json'),hb=gunzipSync(readFileSync(new URL('voxel-detail-1m.f32.gz',dir)));view.setHighDetail({metadata:hd,values:new Float32Array(hb.buffer.slice(hb.byteOffset,hb.byteOffset+hb.byteLength))});assert.equal(view.setDetail([9344],100).resolutionM,1);
 view.update(frame);view.setViewMode('flat');assert.equal(view.land.visible,false);view.setViewMode('3d');assert.equal(view.land.visible,true);view.update(frame,'off');assert.equal(view.water.visible,false);
 view.dispose();view.dispose();assert.throws(()=>view.update(frame),/disposed/);
});

