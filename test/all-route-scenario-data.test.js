import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeAllRouteFrame,allRouteDepthAt,allRouteBase,allRouteForcingAt,createQuadPainter,rasterizeUnknown,ALL_ROUTE_DATA} from '../public/simulation/all-route-run.js';
function frame({unknown=[3],extension=true,listed=[2],routeDepth=.125,extra=0,count=unknown.length}={}){
 const L=listed.length,ro=6*L+((-2*L)%4+4)%4,body=new ArrayBuffer(ro+8+4*unknown.length+extra);
 const delta=new Uint32Array(body,0,L);listed.forEach((v,i)=>delta[i]=v-(listed[i-1]??0));new Uint16Array(body,4*L,L).fill(1000);
 new Float32Array(body,ro,1)[0]=routeDepth;new Float32Array(body,ro+4,1)[0]=42;new Uint32Array(body,ro+8,unknown.length).set(unknown);
 const h=new TextEncoder().encode(JSON.stringify({listed:L,routeCells:1,...(extension?{unknownCells:count}:{})})),out=new Uint8Array(8+h.length+body.byteLength);
 out.set([70,80,81,87]);new DataView(out.buffer).setUint32(4,h.length,true);out.set(h,8);out.set(new Uint8Array(body),8+h.length);return out;
}
test('new sparse frames retain unknown separately from known dry and exact route water',()=>{
 const f=decodeAllRouteFrame(frame(),6,new Uint32Array([2]),123);
 assert.equal(allRouteDepthAt(f,2),.125);assert.equal(allRouteDepthAt(f,3),null);assert.equal(allRouteDepthAt(f,4),0);assert.equal(f.routeZs[0],42);assert.equal(f.time,123);
});
test('legacy frames without unknown extension retain their previous decoded values',()=>{
 const f=decodeAllRouteFrame(frame({unknown:[],extension:false}),6,new Uint32Array([2]),0);
 assert.equal(f.unknown.length,0);assert.equal(allRouteDepthAt(f,2),.125);assert.equal(allRouteDepthAt(f,3),0);
});
test('unknown extension rejects malformed counts, lengths, indices and wet overlap',()=>{
 for(const count of [-1,.5,null])assert.throws(()=>decodeAllRouteFrame(frame({count}),6,new Uint32Array([2]),0),/counts/);
 assert.throws(()=>decodeAllRouteFrame(frame({extra:4}),6,new Uint32Array([2]),0),/length/);
 for(const unknown of [[6],[3,3],[4,3]])assert.throws(()=>decodeAllRouteFrame(frame({unknown}),6,new Uint32Array([2]),0),/unknown cell/);
 assert.throws(()=>decodeAllRouteFrame(frame({unknown:[2]}),6,new Uint32Array([2]),0),/also lists water/);
 assert.throws(()=>decodeAllRouteFrame(frame(),6,new Uint32Array([]),0),/counts/);
});
test('saved scenario package selection changes only the data folder',()=>{
 assert.equal(allRouteBase({quad:true}).href,ALL_ROUTE_DATA.href);
 for(const id of ['stress','extreme'])assert.equal(allRouteBase({quad:'all-route-'+id}).href,new URL('../public/simulation/data/all-route-'+id+'/',import.meta.url).href);
});
test('forcing uses exact matching frame time and never changes null or absent input into zero',()=>{
 const time=Date.parse('2026-11-01T17:00:00Z'),pkg={forcing:{frames:[{time:'2026-11-01T17:00:00Z',rainMmH:0,inflowM3s:15},{time:'2026-11-01T17:15:00Z',rainMmH:2,inflowM3s:null}]}};
 assert.deepEqual(allRouteForcingAt(pkg,time),{rainMmH:0,inflowM3s:15});
 assert.deepEqual(allRouteForcingAt(pkg,time+900000),{rainMmH:2,inflowM3s:NaN});
 assert.deepEqual(allRouteForcingAt(pkg,time+1800000),{rainMmH:NaN,inflowM3s:NaN});
 assert.deepEqual(allRouteForcingAt({},time),{rainMmH:NaN,inflowM3s:NaN});
});

test('fractional water painting never interpolates through an unknown endpoint',()=>{
 const wet={listed:new Uint32Array([0]),depth:new Float32Array([1]),unknown:new Uint32Array()},dry={listed:new Uint32Array(),depth:new Float32Array(),unknown:new Uint32Array()},unknown={...dry,unknown:new Uint32Array([0])};
 const c={key:'test',box:new Float32Array([0,0,1,1]),origin:[0,0],byTime:new Map([['a',0],['b',1]]),drawn:[1],flags:[0]};
 let pair=[wet,unknown],rects=0;const run={cases:[c],times:[0,1],iso:['a','b'],peek:(_,i)=>pair[i]},painter=createQuadPainter(run,{colors:['blue'],bandOf:d=>d>0?0:-1});
 const map={getZoom:()=>0,getCenter:()=>({}),latLngToContainerPoint:()=>({x:0,y:0}),project:()=>({x:0,y:0})},ctx={beginPath(){},rect(){rects++},fill(){}};
 const paint=clock=>{rects=0;painter.paint(ctx,map,clock,{x:256,y:256});return rects;};
 assert.equal(paint(0),1);assert.equal(paint(.5),0);assert.equal(paint(1),0);
 pair=[unknown,wet];assert.equal(paint(0),0);assert.equal(paint(.5),0);assert.equal(paint(1),1);
 pair=[dry,wet];assert.equal(paint(.5),1);
});

test('3D unknown mask covers partially intersecting pixels and only the drawn model area',()=>{
 const c={e0:0,n0:0,ix:[0,1],iy:[0,0],lvl:[0,0],drawn:[1,0],flags:[0,1]},frame={unknown:new Uint32Array([0,1])},run={cases:[c],peek:()=>frame};
 const box={e0:0,n0:0,w:12.5,h:6.25,cols:4,rows:2};
 assert.deepEqual([...rasterizeUnknown(run,0,box)],[255,255,0,0,255,255,0,0]);
 frame.unknown=new Uint32Array();assert.ok(rasterizeUnknown(run,0,box).every(x=>x===0));
});

test('scenario input adapters keep real zeros, distinct inlets and missing-time gaps',async()=>{
 const {allRouteInputs,inputAt}=await import('../public/simulation/all-route-forcing.js');
 const {rainAt,rainFrameAt}=await import('../public/preview/geo3d/src/world/rain-data.js');
 const t=Date.parse('2026-11-01T17:00:00Z'),at=h=>new Date(t+h*3600e3).toISOString();
 const samples=[{time:at(0),mmPerHour:0,flowM3s:0},{time:at(1),mmPerHour:10,flowM3s:20}];
 assert.equal(inputAt(samples,t+1800e3,'flowM3s'),10);assert.ok(Number.isNaN(inputAt(samples,t-1,'flowM3s')));assert.ok(Number.isNaN(inputAt(samples,t+3600e3+1,'flowM3s')));
 const inlet={available:true,crs:'EPSG:32612',eastingM:480000,northingM:3590000,label:'Santa Cruz design inlet',samples};
 const pkg={cases:[{key:'northern',label:'Northern',bounds:[[32,-112],[33,-111]]}],forcing:{rain:{samples},inflow:{byCase:{northern:{inlets:[{...inlet,reachId:1},{...inlet,reachId:2},{...inlet,reachId:3,available:false}]}}}}};
 const {rain,inflow}=allRouteInputs(pkg,[t,t+1800e3,t+3600e3,t+7200e3]);
 assert.equal(inflow.length,2);assert.deepEqual(inflow.map(s=>s.reachId),['1','2']);assert.equal(inflow[0].points.get(t),0);assert.equal(inflow[0].points.get(t+1800e3),10);assert.equal(inflow[0].points.has(t+7200e3),false);
 assert.equal(rainAt(rain,t+1800e3,-111.5,32.5),5);assert.ok(Number.isNaN(rainAt(rain,t+7200e3,-111.5,32.5)));assert.ok(Number.isNaN(rainAt(rain,t+1800e3,-110,32.5)));
 assert.deepEqual(rainFrameAt(rain,t+1800e3).grid,[[5,5],[5,5]]);assert.equal(rainFrameAt(rain,t+7200e3),null);
 assert.deepEqual(allRouteInputs({cases:[]},[t]),{rain:null,inflow:[]});
});

test('2D scenario loader retains rain, native inlet and HAND inputs through overlap changes',async()=>{
 const {readFileSync}=await import('node:fs'),{fileURLToPath}=await import('node:url');
 const {loadRun2d,setQuadOrder}=await import('../public/simulation/sim-2d.js');
 const base=new URL('../public/simulation/data/all-route-13z/',import.meta.url),pkg=JSON.parse(readFileSync(new URL('package.json',base)));
 const times=pkg.cases[0].frames.map(f=>f.time),t=Date.parse(times[0]);
 pkg.forcing={frames:times.map(time=>({time,rainMmH:2,inflowM3s:123})),rain:{samples:[{time:times[0],mmPerHour:2},{time:times.at(-1),mmPerHour:2}]},inflow:{byCase:{northern:{inlets:[{available:true,crs:'EPSG:32612',eastingM:480000,northingM:3590000,reachId:'15902363',label:'Santa Cruz design inlet',samples:[{time:times[0],flowM3s:123},{time:times.at(-1),flowM3s:123}]}]}}}};
 const oldFetch=globalThis.fetch;globalThis.fetch=async url=>{const u=new URL(url);assert.match(u.pathname,/all-route-contract-fixture/);u.pathname=u.pathname.replace('all-route-contract-fixture','all-route-13z');return new Response(u.pathname.endsWith('/package.json')?JSON.stringify(pkg):readFileSync(fileURLToPath(u)),{status:200});};
 try{const run=await loadRun2d({id:'stress',quad:'all-route-contract-fixture'});assert.ok(run.rain);assert.equal(run.inflow[0].points.get(t),123);assert.equal(run.riverM3s[0],123);assert.equal(run.series[0].rainMmH,2);setQuadOrder(run,'northern');assert.equal(run.series[0].inflowM3s,123);assert.equal(run.series[0].rainMmH,2);await run.quad.ensure(0);assert.ok(run.quad.peek(run.quad.cases[0],0));}
 finally{globalThis.fetch=oldFetch;}
});
