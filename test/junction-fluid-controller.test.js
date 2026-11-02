// Data-boundary tests for the junction layer. Real repository assets, stubbed
// transport. No solver run, network request, browser or visual-acceptance claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {createJunctionFluidController,loadJunctionAssets,loadJunctionPointer,
  junctionInView,sceneMatchesSource,frameIndexForTime} from '../tools/simulation/junction-fluid-controller.js';

const simulation=new URL('../public/simulation/',import.meta.url);
const bakedDir=new URL('data/brawley-baked/',simulation);
const report=JSON.parse(readFileSync(new URL('bake-report.json',bakedDir),'utf8'));
const provenance=JSON.parse(readFileSync(new URL('imagery-provenance.json',bakedDir),'utf8'));
const glb=readFileSync(new URL('brawley-ground-road.glb',bakedDir));
const BOUNDS=[provenance.extent.xmin,provenance.extent.ymin,provenance.extent.xmax,provenance.extent.ymax];

const scene=(patch={})=>({schema:'floodplain-scene-v1',runId:report.sourceRun,geometrySha256:report.sourceGeometrySha256,
  verticalDatum:'NAVD88',center:report.center,bounds:BOUNDS,cells:[{nativeFaceId:'1'}],
  frames:[{validTime:'2026-11-01T17:00:00Z',depthM:[0.4]},{validTime:'2026-11-01T17:15:00Z',depthM:[0.9]}],
  terrain:[],...patch});
// Two adjacent native faces with rings, so the mask bounds and the perimeter
// edges in the lifecycle test have real geometry to resolve against.
const ring=(dx,dy)=>{const [lon,lat]=report.center,s=0.0005;
  return [[lon+dx*s,lat+dy*s],[lon+(dx+1)*s,lat+dy*s],[lon+(dx+1)*s,lat+(dy+1)*s],[lon+dx*s,lat+(dy+1)*s]];};
const maskedScene=()=>scene({cells:[
  {nativeFaceId:'1',areaM2:156.25,ring:ring(0,0)},
  {nativeFaceId:'2',areaM2:156.25,ring:ring(1,0)}],
  frames:[{validTime:'2026-11-01T17:00:00Z',depthM:[0.4,0.3]},
    {validTime:'2026-11-01T17:15:00Z',depthM:[0.9,0.5]},
    {validTime:'2026-11-01T18:00:00Z',depthM:[0.5,0.4]}]});
const sourceFor=(patch={})=>({manifest:{runId:report.sourceRun,geometry:{sha256:report.sourceGeometrySha256},
  provenance:{verticalDatum:'NAVD88'},...patch}});

function transport({glbBytes=glb,files={}}={}){
  const calls=[];
  return {calls,fetchImpl:async(url)=>{
    const name=String(url).split('/').pop();calls.push(name);
    if(name==='brawley-ground-road.glb')return {ok:true,status:200,
      arrayBuffer:async()=>glbBytes.buffer.slice(glbBytes.byteOffset,glbBytes.byteOffset+glbBytes.byteLength)};
    if(name==='usgs-naip-reference.jpg')return {ok:true,status:200,blob:async()=>({type:'image/jpeg'})};
    const body=files[name]??(name==='bake-report.json'?report:name==='imagery-provenance.json'?provenance:null);
    return body?{ok:true,status:200,json:async()=>body}:{ok:false,status:404};
  }};
}

test('the viewport gate only fires near the prepared junction',()=>{
  const gate=[-111.3,32.39,-111.29,32.4];
  assert.equal(junctionInView(gate,{xmin:-111.295,ymin:32.392,xmax:-111.294,ymax:32.394}),true);
  assert.equal(junctionInView(gate,{xmin:-111.0,ymin:32.39,xmax:-110.9,ymax:32.4}),false);
  assert.equal(junctionInView(gate,{xmin:-111.2,ymin:32.39,xmax:-111.19,ymax:32.4},{padding:0.2}),true);
  assert.equal(junctionInView(null,{xmin:0,ymin:0,xmax:1,ymax:1}),false);
  assert.equal(junctionInView(gate,null),false);
});

test('the junction package is bound to the displayed run, not merely nearby',()=>{
  assert.deepEqual(sceneMatchesSource(scene(),sourceFor()),{matched:true,reason:null});
  assert.match(sceneMatchesSource(scene(),sourceFor({runId:'another-run'})).reason,/belongs to model run/);
  assert.match(sceneMatchesSource(scene(),sourceFor({geometry:{sha256:'b'.repeat(64)}})).reason,/geometry/);
  assert.match(sceneMatchesSource(scene(),sourceFor({provenance:{verticalDatum:'NGVD29'}})).reason,/vertical datums/);
  assert.match(sceneMatchesSource(scene(),null).reason,/No completed native package/);
});

test('a selected time is matched exactly or reported, never approximated',()=>{
  const value=scene();
  assert.equal(frameIndexForTime(value,'2026-11-01T17:15:00Z'),1);
  assert.equal(frameIndexForTime(value,'2026-11-01T17:07:00Z'),-1);
  assert.equal(frameIndexForTime(value,undefined),-1);
  assert.equal(frameIndexForTime(null,'2026-11-01T17:00:00Z'),-1);
});

test('the gate pointer reads only the small bake report',async()=>{
  const {fetchImpl,calls}=transport();
  const pointer=await loadJunctionPointer({base:simulation,fetchImpl});
  assert.deepEqual(calls,['bake-report.json']);
  assert.deepEqual(pointer.center,report.center);
  assert.equal(pointer.sourceRun,report.sourceRun);
  assert.ok(pointer.gateBounds[0]<report.center[0]&&pointer.gateBounds[2]>report.center[0]);
  await assert.rejects(()=>loadJunctionPointer({base:simulation,fetchImpl,gateRadiusDegrees:0}),/gate radius/);
  await assert.rejects(()=>loadJunctionPointer({base:simulation,
    fetchImpl:async()=>({ok:true,json:async()=>({})})}),/no junction centre/);
});

test('baked assets load only with a matching checksum, size and model run',async()=>{
  const loadScene=async()=>({scene:scene(),terrainTiles:[{kind:'native_face_triangle_terrain'}],roads:{features:[]}});
  const {fetchImpl}=transport();
  const assets=await loadJunctionAssets({base:simulation,fetchImpl,loadScene});
  assert.equal(assets.baked.triangles,report.terrainTriangles+report.road.triangles);
  assert.deepEqual(assets.bakedMeta.center,report.center);
  assert.equal(assets.bakedMeta.baseElevationM,report.baseElevationNAVD88M);
  // The orthophoto is presentation only, so a failure to decode it is recorded
  // and the layer still runs on flat ground colour.
  assert.equal(assets.imagery,null);
  assert.equal(typeof assets.imageryError,'string');

  const flipped=Buffer.from(glb);flipped[flipped.length-1]^=0xff;
  await assert.rejects(()=>loadJunctionAssets({base:simulation,loadScene,...transport({glbBytes:flipped})}),/checksum mismatch/);
  await assert.rejects(()=>loadJunctionAssets({base:simulation,loadScene,...transport({glbBytes:Buffer.from(glb).subarray(0,glb.length-4)})}),/byte length/);
  await assert.rejects(()=>loadJunctionAssets({base:simulation,fetchImpl,
    loadScene:async()=>({scene:scene({runId:'another-run'}),terrainTiles:[],roads:null})}),/not bound to this scene/);
  await assert.rejects(()=>loadJunctionAssets({base:simulation,fetchImpl,
    loadScene:async()=>({scene:scene({center:[-111,32]}),terrainTiles:[],roads:null})}),/centre disagrees/);
  await assert.rejects(()=>loadJunctionAssets({base:simulation,loadScene,
    ...transport({files:{'bake-report.json':{...report,sha256:'z'.repeat(64)}}})}),/baked-asset checksum/);
  await assert.rejects(()=>loadJunctionAssets({base:simulation,fetchImpl,importModule:async()=>({})}),/scene loader is unavailable/);
  await assert.rejects(()=>loadJunctionAssets({fetchImpl,loadScene}),/asset base URL/);
});

test('a mismatched run reports plainly and adds nothing to the renderer group',async()=>{
  const element=()=>{const node={children:[],dataset:{},style:{},hidden:false,className:'',textContent:'',
    setAttribute(){},append(...xs){node.children.push(...xs);},replaceChildren(...xs){node.children=xs.slice();},remove(){}};return node;};
  const statuses=[];
  const controller=createJunctionFluidController({base:simulation,document:{createElement:element},container:element(),
    ...transport(),loadScene:async()=>({scene:scene(),terrainTiles:[],roads:null}),
    onStatus:state=>statuses.push(state)});
  controller.setSource(sourceFor({runId:'another-run'}));
  const group=new THREE.Group();
  const view=await controller.activate({group,project:([lon,lat])=>new THREE.Vector3(lon*1e5,lat*1e5,0),
    altitude:m=>m,origin:new THREE.Vector3(),baseM:600});
  assert.equal(view.status,'unavailable');
  assert.match(view.reason,/belongs to model run/);
  assert.equal(group.children.length,0,'nothing is attached when the package does not bind');
  assert.ok(statuses.some(s=>s.status==='loading'),'loading is announced before the verdict');
  assert.ok(statuses.every(s=>s.kind==='junction-fluid'&&s.status!=='error'),'junction trouble never claims the whole map failed');
  assert.equal(controller.inspect().status,'unavailable');
  controller.dispose();
});

// The phone reported "coupled" with no flow time and no ledger. Two causes:
// clearing the binding left the previous status standing, and the asynchronous
// snapshot read had no guard, so a callback belonging to a solver that had
// already been torn down could still declare the layer coupled. Both are state
// machine defects and both are reachable without a browser.
test('a flow binding never outlives the solver, the time or a newer bind',async()=>{
  const element=()=>{const node={children:[],dataset:{},style:{},hidden:false,className:'',textContent:'',
    setAttribute(){},append(...xs){node.children.push(...xs);},replaceChildren(...xs){node.children=xs.slice();},remove(){}};return node;};
  // One native perimeter edge in, one out, over a two-cell scene.
  const hourly=['2026-11-01T17:00:00Z','2026-11-01T18:00:00Z'];
  const flowGeometry={masks:{junction160:{inwardSign:[1,-1],nativeFaceIds:['1','2']}},
    edges:[{id:'in',widthM:6.25,fromFace:'2',toFace:'1',endpointsUTM:null},
      {id:'out',widthM:6.25,fromFace:'1',toFace:'2',endpointsUTM:null}]};
  // Each readFrame hands back a promise the test resolves by hand, so the race
  // is driven rather than waited for.
  const pending=[];
  const flowPackage={manifest:{spatialMasks:{}},geometry:flowGeometry,
    exactFrameIndex:time=>{const i=hourly.indexOf(time);if(i<0)throw Error('no exact snapshot');return i;},
    readFrame:index=>new Promise(resolve=>pending.push({index,resolve})),
    boundaryTransport:()=>({boundary:[
      {edgeIndex:0,signedInflowM3s:0.6,inwardNormalEN:[1,0]},
      {edgeIndex:1,signedInflowM3s:-0.6,inwardNormalEN:[-1,0]}]})};
  const fluidStub=()=>({count:16,radiusM:0.4,positions:new Float32Array(48),velocities:new Float32Array(48),
    nativeCellIndices:new Int32Array(16),active:new Float32Array(16).fill(1),generations:new Int32Array(16),
    stats:{particleVolumeM3:0.2,sourceTime:'2026-11-01T17:00:00Z',steps:0},
    flowStats:null,maskCoverage:null,localBounds:null,field:null,
    initializeFrame(){},step(){},initializeVelocities(){return {seeded:16,unavailable:0,particles:16};},
    applyBoundaryTransport(){return null;},dispose(){}});
  const controller=createJunctionFluidController({base:simulation,document:{createElement:element},container:element(),
    ...transport(),loadScene:async()=>({scene:maskedScene(),terrainTiles:[],roads:null}),
    importModule:async specifier=>String(specifier).endsWith('brawley-flow.js')
      ?{loadBrawleyFlow:async()=>flowPackage}
      :{createJunctionFluid:async()=>fluidStub()},
    onStatus:()=>{}});
  controller.setSource(sourceFor());
  // The layer refuses to attach to an orphaned terrain group, so the stub host
  // has to be in a scene like the real one is.
  const group=new THREE.Group();new THREE.Scene().add(group);
  const activated=await controller.activate({group,project:([lon,lat])=>new THREE.Vector3(lon*1e5,lat*1e5,0),
    altitude:m=>m,origin:new THREE.Vector3(),baseM:600});
  assert.equal(activated.status,'ready','the stubbed layer must build before its flow lifecycle can be judged: '
    +JSON.stringify({reason:activated.reason,flow:controller.inspect().flow,children:group.children.length}));
  const flow=()=>controller.inspect().flow;

  // Activate binds frame 0, which is on the hour. While the snapshot is still
  // being read the status must say so rather than inherit anything.
  assert.equal(flow().status,'binding','a binding in progress is its own state');
  assert.equal(flow().flowTime,null);
  assert.equal(flow().ledger,null);
  const first=pending.shift();
  first.resolve({time:hourly[0],qM2s:[0.1,0.1]});
  await Promise.resolve();await Promise.resolve();await Promise.resolve();
  assert.equal(flow().status,'coupled');
  assert.equal(flow().flowTime,hourly[0]);

  // Move to a quarter-hour frame with no snapshot while a read is outstanding.
  // The late callback must not drag the layer back to "coupled" at a time the
  // user is no longer looking at.
  controller.setFrame(hourly[1]);
  assert.equal(flow().status,'binding');
  const second=pending.shift();
  controller.setFrame('2026-11-01T17:15:00Z');
  assert.equal(flow().status,'no-exact-snapshot','an off-hour frame says so immediately');
  assert.equal(flow().flowTime,null,'and carries no flow time');
  second.resolve({time:hourly[1],qM2s:[0.1,0.1]});
  await Promise.resolve();await Promise.resolve();await Promise.resolve();
  assert.equal(flow().status,'no-exact-snapshot','the superseded read is dropped, not applied');
  assert.equal(flow().flowTime,null);

  // A snapshot that reads back as a different instant is refused outright
  // rather than coupled to the wrong time.
  controller.setFrame(hourly[0]);
  const third=pending.shift();
  third.resolve({time:hourly[1],qM2s:[0.1,0.1]});
  await Promise.resolve();await Promise.resolve();await Promise.resolve();
  assert.equal(flow().status,'no-exact-snapshot','a mismatched snapshot is not substituted');
  assert.match(flow().reason,/no substitution is made/);

  // Tearing the layer down must clear the claim, and a callback belonging to
  // the disposed solver must not resurrect it. This is the phone case.
  controller.setFrame(hourly[1]);
  assert.equal(flow().status,'binding');
  const fourth=pending.shift();
  controller.deactivate();
  assert.notEqual(flow().status,'coupled','teardown drops the coupling claim');
  assert.equal(flow().flowTime,null);
  assert.equal(flow().ledger,null);
  fourth.resolve({time:hourly[1],qM2s:[0.1,0.1]});
  await Promise.resolve();await Promise.resolve();await Promise.resolve();
  assert.notEqual(flow().status,'coupled','a callback from a disposed solver cannot declare a coupling');
  assert.equal(flow().flowTime,null);
  controller.dispose();
});

test('the committed Brawley scene still satisfies every assumption the layer makes',()=>{
  const value=JSON.parse(readFileSync(new URL('data/scene-contract/brawley-scene.json',simulation),'utf8'));
  assert.equal(value.schema,'floodplain-scene-v1');
  assert.equal(value.runId,report.sourceRun);
  assert.equal(value.geometrySha256,report.sourceGeometrySha256);
  assert.equal(value.verticalDatum,'NAVD88');
  assert.equal(value.coordinates.order,'longitude,latitude');
  assert.deepEqual(value.center,report.center);
  assert.ok(value.bounds.every((v,i)=>Math.abs(v-BOUNDS[i])<1e-12),'the baked ground UV maps 1:1 onto the recorded orthophoto extent');
  assert.equal(value.frames.length,57);
  assert.equal(value.cells.length,2628);
  assert.equal(value.flow.status,'unavailable','the layer must not be able to read a velocity that does not exist');
  assert.equal(value.flow.velocityMps,null);
  assert.equal(value.terrain.length,2);
  assert.equal(value.terrainGeometryEquivalence.method,'exact-native-geometry');
  let previous=-Infinity;
  for(const frame of value.frames){
    const time=Date.parse(frame.validTime);
    assert.ok(time>previous);previous=time;
    assert.equal(frame.depthM.length,value.cells.length);
    assert.equal(frame.waterSurfaceM.length,value.cells.length);
  }
  assert.equal(frameIndexForTime(value,'2026-11-01T22:00:00Z'),20,'frame 20 is the checked 445.04 m³ reseed case');
});
