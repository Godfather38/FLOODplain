import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeCompactQuadtree} from '../public/simulation/quadtree-output.js';
test('compact native float32 preserves negative and missing values and derives area-specific depth',()=>{
 const h=new TextEncoder().encode(JSON.stringify({format:'floodplain-columns-v1',metadata:{time:'2026-11-01T17:00:00Z'},columns:{nativeVolumeM3:{type:'f',offset:0,count:3},waterSurfaceM:{type:'f',offset:12,count:3}}}));
 const b=new ArrayBuffer(4+h.length+24),v=new DataView(b);v.setUint32(0,h.length,true);new Uint8Array(b,4,h.length).set(h);
 [-.125,2,NaN,500,501,NaN].forEach((x,i)=>v.setFloat32(4+h.length+i*4,x,true));
 const result=decodeCompactQuadtree(b,{cells:[{areaM2:1},{areaM2:4},{areaM2:8}]});
 assert.deepEqual(result.nativeVolumeM3,[-.125,2,null]);assert.deepEqual(result.depthM,[0,.5,null]);assert.deepEqual(result.waterSurfaceM,[500,501,null]);
 assert.throws(()=>decodeCompactQuadtree(b),/requires matching geometry/);
 v.setUint32(0,0xffffffff,true);assert.throws(()=>decodeCompactQuadtree(b),/Invalid compact header/);
});
