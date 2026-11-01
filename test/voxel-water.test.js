import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {gunzipSync} from 'node:zlib';import * as THREE from 'three';
import {createVoxelWater,validateVoxelData} from '../tools/simulation/voxel-water-source.js';
const dir=new URL('../public/simulation/data/',import.meta.url),read=name=>JSON.parse(readFileSync(new URL(name,dir))),gz=name=>JSON.parse(gunzipSync(readFileSync(new URL(name,dir))));
const manifest=read('current-sfincs-manifest.json'),run=gz(manifest.artifact.path.replace('data/','')),terrain=gz('frozen-terrain-display.json.gz'),footprints=gz('frozen-cell-footprints.json.gz');
const raw=gunzipSync(readFileSync(new URL('frozen-voxel-terrain.f32.gz',dir))),detail=new Float32Array(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength));
test('all 15 native frames and 2,968,500 retained terrain samples match source',()=>{
  const frames=validateVoxelData({manifest,run},terrain,footprints);assert.equal(frames.size,15);assert.equal(run.cells.length,29685);assert.equal(detail.length,2968500);assert.ok(detail.every(Number.isFinite));
  assert.throws(()=>validateVoxelData({manifest,run},{...terrain,sourceSha256:'wrong'},footprints),/match/);
});
test('geometry uses independent native zs; animation cannot alter heights; null and zero retained',()=>{
  const origin=new THREE.Vector3();const view=createVoxelWater({loaded:{manifest,run},terrain,footprints,detail,origin,project:([x,y])=>new THREE.Vector3(x*100000,y*100000,0),altitude:m=>m});
  for(const frame of run.frames){view.update(frame);const native=terrain.waterFrames.find(f=>f.time===frame.time);
    for(let k=0;k<view.ids.length;k++){const i=view.ids[k],z=view.water.instanceMatrix.array[k*16+14];assert.ok(Math.abs(z-(native.surfaceM[i]-view.baseM))<.001);}
  }
  const frame=run.frames[10];view.update(frame);const before=view.water.instanceMatrix.array.slice();view.animate(123);assert.deepEqual(view.water.instanceMatrix.array,before);
  const i=view.ids[0];view.select(i);view.update(run.frames[11]);assert.equal(view.selected,i);assert.equal(view.cellInfo(i).time,run.frames[11].time);
  const zero=frame.depthM.findIndex(v=>v===0),missing=frame.depthM.findIndex(v=>v===null);view.update(frame);if(zero>=0)assert.equal(view.cellInfo(zero).depthM,0);if(missing>=0)assert.equal(view.cellInfo(missing).depthM,null);
  assert.throws(()=>view.update({...frame,time:'missing'}),/unavailable/);assert.equal(view.water.count,0);
  const lod=view.setDetail([0,1],10);assert.equal(lod.instances,200);assert.equal(lod.resolutionM,10);
  const hd=read('voxel-detail-1m.json'),hb=gunzipSync(readFileSync(new URL('voxel-detail-1m.f32.gz',dir)));
  const hv=new Float32Array(hb.buffer.slice(hb.byteOffset,hb.byteOffset+hb.byteLength));view.setHighDetail({metadata:hd,values:hv});
  const close=view.setDetail([9344],100);assert.equal(close.resolutionM,1);assert.equal(close.instances,10000);
  view.setDetail([9344],1);view.update(frame);assert.equal(view.overviewWater.count,1,'coarse terrain must not hide a wet native cell');
  view.setDetail([9344],10);view.update(frame);assert.equal(view.overviewWater.count,0,'fine terrain uses actual surface intersection');
  view.update(frame);view.setViewMode('flat');assert.equal(view.land.visible,false);assert.equal(view.water.instanceMatrix.array[14],0);
  view.setViewMode('3d');assert.equal(view.land.visible,true);assert.notEqual(view.water.instanceMatrix.array[14],0);
  view.update(frame,'off');assert.equal(view.water.visible,false);assert.equal(view.land.visible,true);
  view.dispose();view.dispose();assert.throws(()=>view.update(frame),/disposed/);
});
