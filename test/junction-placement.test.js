// Transform contract for the junction layer. The failure this guards against is
// the one the handoff calls out: a private transform that sinks the junction or
// hides native water behind pretty ground.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createJunctionPlacement,bakedPositionsToLocal,bakedNormalsToLocal,METRES_PER_DEGREE_LATITUDE} from '../tools/simulation/junction-placement.js';

const R=6378137,rad=Math.PI/180;
// A real Web Mercator projection, so the bounded tangent-plane check has
// something curved to disagree with.
const mercator=([lon,lat])=>({x:lon*rad*R,y:R*Math.log(Math.tan(Math.PI/4+lat*rad/2)),z:0});
const CENTER=[-111.29459,32.39322];
const UNITS_PER_METRE=1/Math.cos(CENTER[1]*rad);
const origin={x:mercator(CENTER).x-1234,y:mercator(CENTER).y+567,z:89};
const altitude=m=>m*UNITS_PER_METRE+11;
const make=(extra={})=>createJunctionPlacement({center:CENTER,baseElevationM:603,project:mercator,altitude,origin,baseM:600,...extra});

test('the junction shares the host origin, vertical datum and altitude callback',()=>{
  const placement=make();
  assert.equal(placement.elevationToLocalZ(600),altitude(0));
  assert.equal(placement.elevationToLocalZ(603),altitude(3));
  const exact=placement.projectExact([CENTER[0],CENTER[1],603]);
  assert.ok(Math.abs(exact[0]-(mercator(CENTER).x-origin.x))<1e-9);
  assert.ok(Math.abs(exact[1]-(mercator(CENTER).y-origin.y))<1e-9);
  assert.equal(exact[2],altitude(3));
  assert.ok(Math.abs(placement.unitsPerMetre.up-UNITS_PER_METRE)<1e-9);
  assert.ok(Math.abs(placement.horizontalUnitsPerMetre-UNITS_PER_METRE)/UNITS_PER_METRE<1e-3);
});

test('east/north metres round-trip through the declared tangent plane',()=>{
  const placement=make();
  const [lon,lat]=placement.geographicAt([160,-80]);
  assert.ok(Math.abs((lon-CENTER[0])*METRES_PER_DEGREE_LATITUDE*Math.cos(CENTER[1]*rad)-160)<1e-6);
  assert.ok(Math.abs((lat-CENTER[1])*METRES_PER_DEGREE_LATITUDE+80)<1e-6);
  assert.deepEqual(placement.localToGeographic([160,-80,605]),[lon,lat,605]);
});

test('per-step particle linearization is measured against the real projection, not assumed',()=>{
  const placement=make();
  const check=placement.verifyLinearization();
  assert.ok(check.maxDeviationM>=0&&check.maxDeviationM<0.01,'160 m junction linearization stays well under a particle radius');
  assert.deepEqual(check.extentMetres,[160,160]);
  // A grossly larger extent must be rejected rather than quietly drifting.
  assert.throws(()=>placement.verifyLinearization([40000,40000]),/deviates/);
  assert.throws(()=>make({toleranceM:1e-12}).verifyLinearization(),/deviates/);
});

test('a non-linear or broken host altitude callback cannot place absolute elevations',()=>{
  assert.throws(()=>make({altitude:m=>Math.sign(m)*Math.sqrt(Math.abs(m))}),/Non-linear/);
  assert.throws(()=>make({altitude:()=>0}),/vertical scale/);
  assert.throws(()=>make({altitude:()=>NaN}),/vertical scale/);
  assert.throws(()=>make({project:()=>({x:NaN,y:0})}),/non-finite/);
  for(const patch of [{center:[0]},{center:[0,91]},{baseElevationM:null},{baseM:null},{origin:null},{particleExtentMetres:[900,900]}])
    assert.throws(()=>make(patch));
});

test('baked positions convert axis, datum and origin in one pass',()=>{
  const placement=make();
  // One baked triangle: (east, above base, south).
  const positions=new Float32Array([0,0,0, 10,2,-5, -10,4,5]);
  const local=bakedPositionsToLocal(positions,{placement,baseElevationM:603});
  assert.equal(local.length,9);
  assert.equal(local[2],Math.fround(altitude(3)),'a vertex at the base elevation lands at 603 m NAVD88');
  assert.equal(local[5],Math.fround(altitude(5)));
  assert.equal(local[8],Math.fround(altitude(7)));
  const expected=placement.projectExact([...placement.geographicAt([10,5]),605]);
  for(let i=0;i<3;i++)assert.equal(local[3+i],Math.fround(expected[i]),'baked z south becomes north');
  // The exact and linear paths must agree inside the junction.
  const linear=bakedPositionsToLocal(positions,{placement,baseElevationM:603,exact:false});
  for(let i=0;i<9;i++)assert.ok(Math.abs(local[i]-linear[i])<1e-3*Math.abs(placement.horizontalUnitsPerMetre)+1e-9);
  const reused=new Float32Array(9);
  assert.equal(bakedPositionsToLocal(positions,{placement,baseElevationM:603,out:reused}),reused);
  assert.throws(()=>bakedPositionsToLocal(new Float32Array(4),{placement,baseElevationM:603}),/whole XYZ/);
  assert.throws(()=>bakedPositionsToLocal(positions,{placement}),/base elevation/);
});

test('baked normals keep unit length and point upward after the swap',()=>{
  const placement=make();
  const normals=bakedNormalsToLocal(new Float32Array([0,1,0, 0,0,-1]),{placement});
  assert.ok(Math.abs(Math.hypot(normals[0],normals[1],normals[2])-1)<1e-6);
  assert.ok(normals[2]>0.99,'a baked up normal stays up in the host frame');
  assert.ok(normals[4]>0.99,'a baked south-facing normal becomes north-facing');
  assert.throws(()=>bakedNormalsToLocal(new Float32Array(2),{placement}),/whole XYZ/);
});
