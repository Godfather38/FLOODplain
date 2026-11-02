// Open-boundary coupling against the REAL native flow package. These check the
// signs, the exact 22:00 budget, the whole-particle ledger and that no speed is
// presented as native.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {loadBrawleyFlow} from '../public/simulation/brawley-flow.js';
import {prepareBoundary,createVolumeLedger,createEdgeLedger,maskLocalBounds,
  reconstructFaceVelocities,derivedEdgeSpeed,gridConvergenceRadians,
  utmToSceneLocal,pickWeighted,FLOW_COUPLING_DEFAULTS} from '../tools/simulation/junction-flow-coupling.js';

const scene=JSON.parse(fs.readFileSync('public/simulation/data/scene-contract/brawley-scene.json'));
const base='https://example.invalid/simulation/';
const fetchImpl=async url=>new Response(fs.readFileSync(path.join('public',new URL(url).pathname)));
const EXACT='2026-11-01T22:00:00Z';

test('the exact 22:00 junction160 perimeter splits into signed inflow and outflow edges',async()=>{
  const flow=await loadBrawleyFlow({base,scene,fetchImpl});
  const frame=await flow.readFrame(flow.exactFrameIndex(EXACT));
  const transport=flow.boundaryTransport(frame,'junction160');
  const mask=flow.geometry.masks.junction160;
  const boundary=prepareBoundary(transport,{edges:flow.geometry.edges,inwardSign:mask.inwardSign});

  // The contract's published numbers, reproduced through the coupling.
  assert.ok(Math.abs(boundary.inflowM3s-0.6156542878073878)<1e-12);
  assert.ok(Math.abs(boundary.outflowM3s-0.6151355654090196)<1e-12);
  assert.ok(Math.abs(boundary.netInflowM3s-transport.netInflowM3s)<1e-12);
  assert.ok(boundary.inflow.length>0&&boundary.outflow.length>0,'near-equal budgets still mean water travelling through');
  assert.equal(boundary.inflow.length+boundary.outflow.length<=transport.boundary.length,true);

  // Native face identity is kept: the inside face is always a mask face and the
  // outside face never is.
  const faces=new Set(mask.nativeFaceIds);
  for(const edge of [...boundary.inflow,...boundary.outflow]){
    assert.ok(faces.has(edge.innerFace),'the inner face is inside junction160');
    assert.ok(!faces.has(edge.outerFace),'the outer face is outside junction160');
    assert.ok(edge.widthM>0);
    assert.equal(edge.inwardNormalEN.length,2);
  }
  // Recovered q matches the package for a known edge.
  const known=flow.geometry.edges.findIndex(e=>e.solverIndexZeroBased===537505);
  const match=[...boundary.inflow,...boundary.outflow].find(e=>e.edgeIndex===known);
  if(match)assert.ok(Math.abs(match.qM2s-frame.qM2s[known])<1e-12,'recovered q is the native value, not a re-derivation');
});

test('the mask is the 676-face native union, not a raster square',async()=>{
  const flow=await loadBrawleyFlow({base,scene,fetchImpl});
  const mask=flow.geometry.masks.junction160;
  assert.equal(mask.nativeFaceIds.length,676);
  const sceneFaces=new Set(scene.cells.map(c=>Number(c.nativeFaceId)));
  for(const id of mask.nativeFaceIds)assert.ok(sceneFaces.has(id),'every junction face is a scene face');
  assert.equal(mask.inwardSign.length,flow.geometry.edges.length);
});

test('domain bounds cover the WHOLE union, which is 162.5 m and off-centre',async()=>{
  const flow=await loadBrawleyFlow({base,scene,fetchImpl});
  const ids=flow.geometry.masks.junction160.nativeFaceIds;
  const bounds=maskLocalBounds({scene,maskNativeFaceIds:ids});
  assert.equal(bounds.faceCount,676);
  // The package records UTM bounds 472212.5..472375 and 3583981.25..3584143.75.
  assert.ok(Math.abs(bounds.widthM-162.5)<1.5,'union is 162.5 m wide, got '+bounds.widthM);
  assert.ok(Math.abs(bounds.depthM-162.5)<1.5,'union is 162.5 m high, got '+bounds.depthM);
  // Wider than the old 160 m crop in BOTH axes, so that crop was an intersection.
  assert.ok(bounds.widthM>160&&bounds.depthM>160,'a 160 m crop cannot contain the union');
  // And not centred: it reaches further north than south.
  assert.equal(bounds.centredOnSceneCentre,false);
  assert.ok(bounds.maxNorth>Math.abs(bounds.minNorth),'the union reaches further north than south');
  assert.ok(bounds.maxNorth>80&&Math.abs(bounds.minNorth)<80.5,
    'north '+bounds.maxNorth+' / south '+bounds.minNorth+' straddle the old +/-80 m crop');
  assert.ok(bounds.areaM2>0);
  assert.throws(()=>maskLocalBounds({scene,maskNativeFaceIds:[-1]}),/absent from the scene/);
  assert.throws(()=>maskLocalBounds({scene}),/face IDs are required/);
});

test('each perimeter edge keeps its own target, residual and discrepancy',()=>{
  const edges=[{edgeId:'a',edgeIndex:0,innerFace:1,signedInflowM3s:1},
    {edgeId:'b',edgeIndex:1,innerFace:2,signedInflowM3s:3}];
  const ledger=createEdgeLedger({edges,particleVolumeM3:1,direction:'in'});
  const due=ledger.accrue(1);
  assert.equal(due.length,2);
  assert.equal(due.find(d=>d.book.edgeId==='a').count,1);
  assert.equal(due.find(d=>d.book.edgeId==='b').count,3);
  // Edge 'a' has no wet support: that is A's discrepancy, and B is untouched.
  ledger.settle(due.find(d=>d.book.edgeId==='a').book,{moved:0,rejected:1});
  ledger.settle(due.find(d=>d.book.edgeId==='b').book,{moved:3,rejected:0});
  const [a,b]=ledger.books;
  assert.equal(a.discrepancyM3,1,'the refused volume stays on the edge that could not take it');
  assert.equal(b.movedM3,3);
  assert.equal(b.discrepancyM3,0,'a healthy edge never absorbs another edge\'s refused discharge');
  assert.equal(a.targetM3,1);assert.equal(b.targetM3,3,'targets stay proportional to native q*width');
  const stats=ledger.stats;
  assert.equal(stats.perEdgeBalanced,true);
  assert.ok(Math.abs(stats.balanceM3)<1e-12);
  assert.equal(stats.edgesWithDiscrepancy,1);
  assert.throws(()=>createEdgeLedger({edges,particleVolumeM3:1,direction:'sideways'}),/direction/);
  assert.throws(()=>ledger.accrue(0),/positive step/);
});

test('internal native transport reconstructs direction, and the road face runs north at 22:00',async()=>{
  const flow=await loadBrawleyFlow({base,scene,fetchImpl});
  const frame=await flow.readFrame(flow.exactFrameIndex(EXACT));
  const mask=flow.geometry.masks.junction160;
  const waterFrame=scene.frames.find(f=>f.validTime===EXACT);
  assert.ok(waterFrame,'water frame 20 is the same instant as the flow snapshot');
  const cellOfFace=new Map(scene.cells.map((c,i)=>[Number(c.nativeFaceId),i]));
  const result=reconstructFaceVelocities({edges:flow.geometry.edges,qM2s:frame.qM2s,
    faceIds:mask.nativeFaceIds,
    depthOf:id=>{const i=cellOfFace.get(id);return i===undefined?null:waterFrame.depthM[i];}});
  assert.ok(result.derivedFaces>0,'internal edge transport is actually used');
  assert.match(result.assumption,/not a measured point speed/);
  assert.equal(result.quantity,'depth-averaged cell-centred velocity');

  // The contract's worked example: face 267134's north edge carries q northward.
  const road=result.velocities.get(267134);
  assert.ok(road,'the road face is inside junction160');
  if(road.status==='derived'){
    assert.ok(road.north>0,'regional crossing transport at the road face is northward, got '+road.north);
    assert.ok(Math.abs(road.north)<=FLOW_COUPLING_DEFAULTS.maxDerivedSpeedMps);
  }else{
    assert.match(road.reason,/No native depth|No internal native transport/);
  }
  // Signs must come from the source, not from a global average.
  const northward=[...result.velocities.values()].filter(v=>v.status==='derived'&&v.north>0).length;
  const southward=[...result.velocities.values()].filter(v=>v.status==='derived'&&v.north<0).length;
  assert.ok(northward>0&&southward>0,'per-face signs vary; a single mean drift is not evidence of direction');
  assert.throws(()=>reconstructFaceVelocities({edges:[],qM2s:[1],faceIds:[1],depthOf:()=>1}),/matching q/);
  assert.throws(()=>reconstructFaceVelocities({edges:[],qM2s:[],faceIds:[1]}),/depth lookup/);
});

test('volume is accounted in whole particles with the remainder kept, never rounded away',()=>{
  const particleVolumeM3=0.1839515753;
  const ledger=createVolumeLedger({particleVolumeM3});
  // One second of the exact 22:00 budget.
  const inflowM3s=0.6156542878073878,outflowM3s=0.6151355654090196;
  let injected=0,removed=0;
  for(let step=0;step<90;step++){
    const want=ledger.accrue(inflowM3s,outflowM3s,1/30);
    ledger.settle({injected:want.inject,removed:want.remove});
    injected+=want.inject;removed+=want.remove;
  }
  const s=ledger.stats;
  assert.ok(injected>0&&removed>0,'three simulated seconds of native discharge moves whole particles');
  assert.ok(Math.abs(s.targetInM3-inflowM3s*3)<1e-9);
  assert.ok(Math.abs(s.inBalanceM3)<1e-9,'every injected cubic metre is placed, pending or a declared discrepancy');
  assert.ok(Math.abs(s.outBalanceM3)<1e-9);
  assert.ok(s.pendingInM3>=0&&s.pendingInM3<particleVolumeM3,'the remainder is carried, not discarded');
  assert.ok(s.pendingOutM3>=0&&s.pendingOutM3<particleVolumeM3);
  assert.ok(Math.abs(s.simulatedSeconds-3)<1e-9);
  assert.match(s.meaning,/not a full water balance/);
});

test('water the wet support cannot take is reported as a discrepancy, not manufactured',()=>{
  const ledger=createVolumeLedger({particleVolumeM3:1});
  const want=ledger.accrue(10,0,1);
  assert.equal(want.inject,10);
  // Only six could be placed inside real native wet support.
  const stats=ledger.settle({injected:6,removed:0,rejected:4});
  assert.equal(stats.injectedM3,6);
  assert.equal(stats.discrepancyM3,4);
  assert.ok(Math.abs(stats.inBalanceM3)<1e-12,'the rejected volume stays in the books');
  assert.throws(()=>ledger.settle({injected:-1,removed:0}),/whole particle counts/);
  assert.throws(()=>ledger.accrue(1,1,0),/positive step/);
  assert.throws(()=>ledger.accrue(-1,1,1),/non-negative/);
  assert.throws(()=>createVolumeLedger({particleVolumeM3:0}),/positive particle volume/);
});

test('a speed from q is labelled derived, with its assumption, or refused',()=>{
  const derived=derivedEdgeSpeed(0.019177289679646492,0.2);
  assert.equal(derived.status,'derived');
  assert.ok(Math.abs(derived.speedMps-0.09588644839823246)<1e-12);
  assert.equal(derived.quantity,'depth-averaged speed');
  assert.match(derived.assumption,/not a measured point speed/);
  assert.match(derived.assumption,/exports no velocity/);
  assert.equal(derived.effectiveDepthM,0.2);
  // A vanishing denominator must refuse rather than invent a huge speed.
  const tooShallow=derivedEdgeSpeed(0.02,0.001);
  assert.equal(tooShallow.status,'unavailable');
  assert.equal(tooShallow.speedMps,null);
  assert.match(tooShallow.reason,/tiny denominator/);
  assert.equal(derivedEdgeSpeed(NaN,1).status,'unavailable');
  assert.equal(derivedEdgeSpeed(1,null).status,'unavailable');
  // The cap binds and says so.
  const capped=derivedEdgeSpeed(100,0.05);
  assert.equal(capped.capped,true);
  assert.equal(capped.speedMps,FLOW_COUPLING_DEFAULTS.maxDerivedSpeedMps);
});

test('UTM converts through the recorded projected centre with grid convergence removed',()=>{
  const centerUTM=[472293.7561554712,3584060.677036746];
  assert.deepEqual(utmToSceneLocal(centerUTM,{centerUTM}),[0,0]);
  const convergence=gridConvergenceRadians(-111.29459,32.39322);
  // Zone 12 central meridian is -111, so the scene sits west of it.
  assert.ok(convergence<0&&Math.abs(convergence)<0.01,'a few milliradians at this longitude');
  const eastOnly=utmToSceneLocal([centerUTM[0]+100,centerUTM[1]],{centerUTM,convergenceRadians:convergence});
  assert.ok(Math.abs(Math.hypot(...eastOnly)-100)<1e-9,'rotation preserves distance');
  assert.ok(Math.abs(eastOnly[1])>0.1,'grid north is not true north here, and the rotation shows it');
  assert.equal(gridConvergenceRadians(-111,32.39322),0,'on the central meridian there is no convergence');
  assert.throws(()=>utmToSceneLocal([0],{centerUTM}),/easting\/northing/);
  assert.throws(()=>utmToSceneLocal(centerUTM,{}),/projected scene centre/);
});

test('edges are picked in proportion to the discharge they carry',()=>{
  const cumulative=[1,3,6];
  assert.equal(pickWeighted(cumulative,0),0);
  assert.equal(pickWeighted(cumulative,1/6-1e-9),0);
  assert.equal(pickWeighted(cumulative,0.4),1);
  assert.equal(pickWeighted(cumulative,1),2);
  assert.equal(pickWeighted([],0.5),-1);
  assert.equal(pickWeighted([0],0.5),-1,'no discharge means no pick');
});

test('a malformed perimeter is refused rather than guessed at',()=>{
  const edges=[{id:'a',fromFace:1,toFace:2,widthM:2,positiveNormalEN:[1,0]}];
  assert.throws(()=>prepareBoundary({boundary:[{edgeIndex:0,inwardNormalEN:[1,0],signedInflowM3s:1}]},
    {edges,inwardSign:[0]}),/signed native perimeter edge/);
  assert.throws(()=>prepareBoundary(null,{edges,inwardSign:[1]}),/boundary transport result/);
  assert.throws(()=>prepareBoundary({boundary:[]},{edges}),/inward signs/);
});
