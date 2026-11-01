// Synthetic display semantics only; never hydraulic data or inferred resolution.
import test from 'node:test';import assert from 'node:assert/strict';
import {buildNativeOverview,mercatorY} from '../tools/simulation/refined-overview-source.js';
const extent={xmin:0,ymin:0,xmax:4,ymax:4},north=mercatorY(4),south=mercatorY(0);
const lat=y=>(2*Math.atan(Math.exp(north-y/4*(north-south)))-Math.PI/2)*180/Math.PI;
const ring=(x,y,w=1,h=1)=>[[lat(y),x],[lat(y),x+w],[lat(y+h),x+w],[lat(y+h),x]];
const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-5,`${actual} ~= ${expected}`);
test('SYNTHETIC: overview max-depth, fractional coverage, missing, dry and holes stay distinct',async()=>{
 const geometry={rings:[ring(0,0),ring(1,0,.5),ring(1.5,0,.5),ring(2,0),ring(3,0),ring(1,1,.5),ring(1.5,1,.5)]};
 const frame={depthM:[.2,1,4,null,0,null,2]};
 const d=await buildNativeOverview({geometry,frame,visible:[0,1,2,3,4,5,6],extent,width:16,height:16,yieldWork:async()=>{}});
 assert.equal(d.width,4);assert.equal(d.height,4);assert.equal(d.projection,'EPSG:3857');
 close(d.coverage[0],1);close(d.wet[0],1);close(d.maximum[0],.2);
 close(d.coverage[1],1);close(d.wet[1],1);assert.equal(d.maximum[1],4,'maximum contributor, not mean or fabricated fine-grid depth');
 close(d.coverage[2],1);close(d.missing[2],1);assert.equal(d.wet[2],0);assert.ok(d.rgba[2*4+3]>0,'missing coverage is visibly distinct');
 close(d.coverage[3],1);assert.equal(d.wet[3],0);assert.equal(d.missing[3],0);assert.equal(d.rgba[3*4+3],0,'dry support remains transparent');
 assert.equal(d.coverage[4],0);assert.equal(d.rgba[4*4+3],0,'uncovered hole does not gain wet support');
 close(d.coverage[5],1);close(d.wet[5],.5);close(d.missing[5],.5);assert.equal(d.maximum[5],2);assert.ok(d.rgba[5*4+3]>0);
 assert.equal(d.stats.visibleFaces,7);assert.equal(d.stats.pixels,16);
});
test('SYNTHETIC: overview is screen bounded and cancellable',async()=>{
 const d=await buildNativeOverview({geometry:{rings:[]},frame:{depthM:[]},visible:[],extent,width:10000,height:10000,yieldWork:async()=>{}});assert.equal(d.width,256);assert.equal(d.height,256);
 const controller=new AbortController();controller.abort();await assert.rejects(buildNativeOverview({geometry:{rings:[ring(0,0)]},frame:{depthM:[1]},visible:[0],extent,width:16,height:16,signal:controller.signal}),{name:'AbortError'});
 const mid=new AbortController();await assert.rejects(buildNativeOverview({geometry:{rings:[ring(0,0)]},frame:{depthM:[1]},visible:Array(5000).fill(0),extent,width:16,height:16,signal:mid.signal,yieldWork:async()=>mid.abort()}),{name:'AbortError'});
});
