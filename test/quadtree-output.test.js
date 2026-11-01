import test from 'node:test';import assert from 'node:assert/strict';
import {acceptQuadtreeGeometry,acceptQuadtreeFrame} from '../public/simulation/quadtree-output.js';
test('synthetic variable-area package preserves native depth and rejects frame swaps',()=>{
 const time='2026-11-01T17:00:00Z',m={kind:'quadtree_output_package',status:'complete',runId:'synthetic-code-check',resolution:{cellCount:2},geometry:{sha256:'abc'},frames:[{time}]};
 const g={runId:m.runId,geometryKind:'native_quadtree_faces',cells:[{nativeFaceId:'9',lon:-111,lat:32,areaM2:10000},{nativeFaceId:'2',lon:-111,lat:32,areaM2:625}],rings:Array.from({length:2},()=>[[32,-111],[32,-110.99],[32.01,-110.99],[32.01,-111]])};
 acceptQuadtreeGeometry(m,g);const f={runId:m.runId,geometrySha256:'abc',time,depthM:[1,1],nativeVolumeM3:[10000,625],waterSurfaceM:[600,null]};
 assert.equal(acceptQuadtreeFrame(m,g,f,time),f);
 assert.throws(()=>acceptQuadtreeFrame(m,g,{...f,depthM:[1,.0625]},time),/actual cell area/);
 assert.throws(()=>acceptQuadtreeFrame(m,g,{...f,geometrySha256:'other'},time),/mismatch/);
 assert.throws(()=>acceptQuadtreeFrame(m,g,{...f,nativeVolumeM3:[null,625]},time),/actual cell area/);
});
