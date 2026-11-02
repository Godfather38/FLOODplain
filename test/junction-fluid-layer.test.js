// Synthetic geometry fixture only. No forecast, coverage or visual-acceptance
// claim: this checks that the artwork cannot disagree with the native numbers.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createJunctionPlacement} from '../tools/simulation/junction-placement.js';
import {createJunctionGeography,createJunctionBlobs,junctionBlobTints,imageryTransform,junctionGroundExclusion,JUNCTION_BLOB_DEFAULTS} from '../tools/simulation/junction-fluid-layer.js';
import {refinedDepthColor} from '../tools/simulation/refined-water-source.js';

const R=6378137,rad=Math.PI/180,CENTER=[-111.29459,32.39322];
const UNITS=1/Math.cos(CENTER[1]*rad);
const mercator=([lon,lat])=>({x:lon*rad*R,y:R*Math.log(Math.tan(Math.PI/4+lat*rad/2)),z:0});
const placement=()=>createJunctionPlacement({center:CENTER,baseElevationM:603,project:mercator,
  altitude:m=>m*UNITS,origin:mercator(CENTER),baseM:600});

const SCENE_BOUNDS=[-111.29659,32.39122,-111.29259,32.39522];
const EXTENT={xmin:SCENE_BOUNDS[0],ymin:SCENE_BOUNDS[1],xmax:SCENE_BOUNDS[2],ymax:SCENE_BOUNDS[3]};
const triangle=(y=0)=>new Float32Array([0,y,0, 10,y,-5, -10,y,5]);
const up=()=>new Float32Array([0,1,0, 0,1,0, 0,1,0]);
const baked=()=>({extras:{sourceRun:'SYNTHETIC-NOT-A-FORECAST',center:CENTER,baseElevationNAVD88M:603,
    axes:'glTF x east, y elevation above base, z south',nativeTerrainUnmodified:true},
  triangles:3,
  meshes:[
    {name:'Source terrain',triangleCount:1,vertexCount:3,positions:triangle(0),normals:up(),uv:new Float32Array([0,0,1,0,0,1])},
    {name:'roads',triangleCount:1,vertexCount:3,positions:triangle(0.04),normals:up(),uv:null},
    {name:'markings',triangleCount:1,vertexCount:3,positions:triangle(0.055),normals:up(),uv:null}]});

test('the orthophoto UV transform follows its recorded extent',()=>{
  assert.deepEqual(imageryTransform(SCENE_BOUNDS,EXTENT),[0,0,1,1]);
  const wider=imageryTransform(SCENE_BOUNDS,{xmin:SCENE_BOUNDS[0]-0.004,ymin:SCENE_BOUNDS[1],xmax:SCENE_BOUNDS[2],ymax:SCENE_BOUNDS[3]});
  assert.ok(Math.abs(wider[0]-0.5)<1e-9&&Math.abs(wider[2]-0.5)<1e-9);
  assert.equal(imageryTransform(SCENE_BOUNDS,null),null);
  assert.throws(()=>imageryTransform([0,0,0,0],EXTENT),/Degenerate/);
  assert.throws(()=>imageryTransform(SCENE_BOUNDS,{xmin:1,ymin:1,xmax:0,ymax:2}),/unusable/);
});

test('baked junction geography lands on the source terrain without a vertical lift',()=>{
  const place=placement();
  const geography=createJunctionGeography({baked:baked(),placement:place,baseElevationM:603,sceneBounds:SCENE_BOUNDS});
  assert.deepEqual(geography.group.children.map(m=>m.name),['Source terrain','roads','markings']);
  assert.deepEqual(geography.stats,{groundTriangles:1,roadTriangles:1,markingTriangles:1,otherTriangles:0,imagery:false,triangles:3});
  const [ground,road,marking]=geography.group.children;
  assert.equal(ground.renderOrder,0);
  assert.equal(road.renderOrder,1);
  for(const mesh of geography.group.children){
    assert.equal(mesh.material.polygonOffset,true,'coplanar source terrain is resolved with a depth bias, not a lift');
    assert.ok(mesh.material.polygonOffsetUnits<0);
  }
  const z=i=>ground.geometry.attributes.position.getZ(i);
  assert.ok(Math.abs(z(0)-3*UNITS)<1e-6,'a baked base vertex sits at 603 m NAVD88 in the host frame');
  assert.ok(Math.abs(road.geometry.attributes.position.getZ(0)-3.04*UNITS)<1e-6,'the road keeps the bake’s own 4 cm offset and nothing more');
  assert.ok(Math.abs(marking.geometry.attributes.position.getZ(0)-3.055*UNITS)<1e-6);
  assert.ok(ground.geometry.attributes.uv,'ground keeps its baked UV for the orthophoto');
  assert.equal(ground.material.uniforms.imageryReady.value,0,'no photo means a flat colour, never an invented surface');
  assert.equal(road.material.color.getHexString(),'6f7471');
  assert.equal(marking.userData.inferredClearance,null);
  geography.dispose();
  assert.equal(geography.group.children.length,0);
  geography.dispose();
});

test('a recorded orthophoto is applied only with its transform',()=>{
  const texture=new THREE.Texture();
  const geography=createJunctionGeography({baked:baked(),placement:placement(),baseElevationM:603,sceneBounds:SCENE_BOUNDS,imageryTexture:texture,imageryExtent:EXTENT});
  assert.equal(geography.stats.imagery,true);
  const uniforms=geography.group.children[0].material.uniforms;
  assert.equal(uniforms.imagery.value,texture);
  assert.equal(uniforms.imageryReady.value,1);
  assert.deepEqual(uniforms.imageryTransform.value.toArray(),[0,0,1,1]);
  // The photo is posterised into warm tones rather than pasted on raw, so
  // nothing in it can read as blue water and the depth palette stays loudest.
  assert.ok(uniforms.bands.value>=3&&uniforms.bands.value<=8,'luminance is quantised into a few cartoon bands');
  assert.ok(uniforms.chroma.value>0&&uniforms.chroma.value<0.8,'the photo is shifted onto the warm ramp, never reproduced at full colour');
  assert.ok(uniforms.feather.value>0,'the patch edge dissolves instead of ending in a rectangle');
  assert.ok(uniforms.shadowColor.value.b<uniforms.shadowColor.value.r,'the ground ramp is warm, never blue');
  assert.ok(uniforms.lightColor.value.b<uniforms.lightColor.value.r);
  geography.dispose();
});

test('the junction triangle budget is enforced before any allocation',()=>{
  const over={...baked(),triangles:99999};
  assert.throws(()=>createJunctionGeography({baked:over,placement:placement(),baseElevationM:603,sceneBounds:SCENE_BOUNDS}),/exceeds the junction budget/);
  assert.throws(()=>createJunctionGeography({baked:{meshes:[]},placement:placement(),baseElevationM:603,sceneBounds:SCENE_BOUNDS}),/parsed baked junction asset/);
  assert.throws(()=>createJunctionGeography({baked:baked(),baseElevationM:603,sceneBounds:SCENE_BOUNDS}),/placement/);
});

test('blob colour is the native cell depth through the existing quantitative palette',()=>{
  const tints=junctionBlobTints(new Int32Array([0,1,2,-1]),[0.5,null,4.2],4);
  const shallow=refinedDepthColor(0.5),deep=refinedDepthColor(4.2),missing=refinedDepthColor(NaN);
  assert.deepEqual([...tints.slice(0,3)],[shallow.r,shallow.g,shallow.b].map(Math.fround));
  assert.deepEqual([...tints.slice(3,6)],[missing.r,missing.g,missing.b].map(Math.fround),'a null native depth is the missing grey, never shallow blue');
  assert.deepEqual([...tints.slice(6,9)],[deep.r,deep.g,deep.b].map(Math.fround));
  assert.deepEqual([...tints.slice(9,12)],[missing.r,missing.g,missing.b].map(Math.fround),'a particle outside native support is grey');
});

test('blobs carry native positions and a direction streak on a readable subset',()=>{
  const place=placement();
  const blobs=createJunctionBlobs({placement:place,maxParticles:4,options:{streakStride:2}});
  blobs.setViewScale(1.5);
  const positions=new Float32Array([0,0,604, 20,-10,605, -30,40,603.5, 5,5,604.2]);
  const velocities=new Float32Array([0.001,0,0, 0,-0.002,0, 0,0,0, 0.3,0.4,0]);
  const stats=blobs.update({positions,velocities,cellIndices:new Int32Array([0,0,1,0]),depthM:[0.5,null],count:4,radiusMetres:0.3});
  assert.equal(blobs.blobs.geometry.instanceCount,4);
  assert.equal(stats.count,4);
  // Real instanced spheres, as upstream drew particles — not flat stickers.
  assert.equal(stats.sphereTriangles,20,'a detail-0 icosahedron is 20 triangles');
  assert.equal(stats.blobTriangles,80);
  assert.ok(stats.sphereTriangles*2048<=48000,'a full 2,048-particle budget stays affordable');
  assert.match(stats.rendering,/instanced spheres/);
  assert.match(stats.rendering,/not restored/,'the upstream post passes the map renderer owns are named, not faked');
  assert.equal(blobs.blobs.material.depthWrite,true,'spheres write depth so overlapping particles fuse');
  const offset=blobs.blobs.geometry.getAttribute('blobOffset');
  const expected=place.toLocal([20,-10,605]);
  assert.equal(offset.array[3],Math.fround(expected[0]));
  assert.equal(offset.array[4],Math.fround(expected[1]));
  assert.equal(offset.array[5],Math.fround(expected[2]));
  // Direction is a unit vector, so a millimetre-per-second drift still points.
  const direction=blobs.blobs.geometry.getAttribute('blobDirection').array;
  assert.ok(Math.abs(Math.hypot(direction[0],direction[1],direction[2])-1)<1e-5,'a 1 mm/s drift still yields a full-length direction');
  assert.ok(direction[0]>0.99,'east drift points east');
  assert.ok(direction[4]<-0.99,'south drift points south');
  assert.equal(Math.hypot(direction[6],direction[7],direction[8]),0,'a still particle has no direction');
  // Streaks are a fixed screen length on every second particle here.
  assert.equal(stats.streakSegments,2);
  assert.equal(blobs.trails.geometry.drawRange.count,4);
  const trail=blobs.trails.geometry.getAttribute('position').array;
  const metres=u=>u/place.horizontalUnitsPerMetre;
  const length=i=>metres(Math.hypot(trail[i*6+3]-trail[i*6],trail[i*6+4]-trail[i*6+1],trail[i*6+5]-trail[i*6+2]));
  const expectedStreakM=JUNCTION_BLOB_DEFAULTS.directionStreakPx*1.5;
  assert.ok(Math.abs(length(0)-expectedStreakM)<1e-2,'the streak is a fixed drawing length, not a speed');
  assert.equal(length(1),0,'a still particle draws no streak');
  const alpha=blobs.trails.geometry.getAttribute('trailAlpha').array;
  assert.equal(alpha[0],0);assert.ok(alpha[1]>0);assert.equal(alpha[3],0,'the still particle’s streak is fully transparent');
  blobs.dispose();
  assert.throws(()=>blobs.update({count:1,positions}),/disposed/);
});

test('blob size has a screen floor so the water is never subpixel',()=>{
  const place=placement();
  const blobs=createJunctionBlobs({placement:place,maxParticles:2});
  const feed=()=>blobs.update({positions:new Float32Array([0,0,604,1,1,604]),velocities:new Float32Array(6),
    cellIndices:new Int32Array([0,0]),depthM:[1],count:2,radiusMetres:0.43});
  // The physical radius that made the first build invisible. At this zoom the
  // metre cap binds before the pixel floor: truthfulness about wet extent wins,
  // and the blob is still several pixels wide instead of half of one.
  blobs.setViewScale(1.5);
  let stats=feed();
  assert.equal(stats.physicalRadiusMetres,0.43);
  assert.equal(stats.radiusMetres,JUNCTION_BLOB_DEFAULTS.maxRadiusMetres,'the metre cap bounds the drawn cloud at this zoom');
  assert.ok(stats.screenRadiusPx>=2.5,'a 0.43 m blob at 1.5 m/px must still be drawn several pixels wide, not half a pixel');
  assert.ok(stats.screenRadiusPx<JUNCTION_BLOB_DEFAULTS.minScreenRadiusPx+1e-6,'the cap, not the floor, is what limits it here');
  assert.ok(stats.radiusMetres>stats.physicalRadiusMetres,'the display size is larger than the physical radius, and says so');
  assert.equal(stats.sizing.includes('display size'),true);
  assert.ok(stats.radiusMetres<12.5,'a blob never spans a whole native source cell');
  // stats is the live object, so take the number before the view changes.
  const cappedRadiusM=stats.radiusMetres;
  // Zooming in shrinks metres per pixel; the drawn size follows and stays bounded.
  blobs.setViewScale(0.2);
  assert.ok(blobs.stats.screenRadiusPx>=JUNCTION_BLOB_DEFAULTS.minScreenRadiusPx-1e-6);
  assert.ok(blobs.stats.radiusMetres<cappedRadiusM/3,'at close zoom the blob shrinks back toward its physical size');
  // Zoomed far out, the metre cap stops the cloud claiming a huge wet extent.
  blobs.setViewScale(40);
  assert.equal(blobs.stats.radiusMetres,JUNCTION_BLOB_DEFAULTS.maxRadiusMetres);
  blobs.dispose();
});

test('the host ground exclusion is inset inside the baked patch',()=>{
  const place=placement();
  const box=junctionGroundExclusion({placement:place,sceneBounds:SCENE_BOUNDS,baseElevationM:603,insetMetres:10});
  const a=place.projectExact([SCENE_BOUNDS[0],SCENE_BOUNDS[1],603]),b=place.projectExact([SCENE_BOUNDS[2],SCENE_BOUNDS[3],603]);
  const inset=place.metresToUnits(10);
  assert.ok(Math.abs(box.xmin-(Math.min(a[0],b[0])+inset))<1e-9);
  assert.ok(Math.abs(box.ymax-(Math.max(a[1],b[1])-inset))<1e-9);
  assert.ok(box.xmax>box.xmin&&box.ymax>box.ymin);
  assert.ok(box.xmin>Math.min(a[0],b[0]),'the hole stays inside the patch so no gap can open at the rim');
  assert.throws(()=>junctionGroundExclusion({placement:place,sceneBounds:SCENE_BOUNDS,baseElevationM:603,insetMetres:9999}),/larger than the junction/);
  assert.throws(()=>junctionGroundExclusion({sceneBounds:SCENE_BOUNDS,baseElevationM:603}),/placement/);
  assert.throws(()=>junctionGroundExclusion({placement:place,baseElevationM:603}),/scene bounds/);
});

test('reduced motion keeps depth legible while stopping travel and jiggle',()=>{
  const place=placement();
  const blobs=createJunctionBlobs({placement:place,maxParticles:2});
  blobs.setReducedMotion(true);
  const stats=blobs.update({positions:new Float32Array([0,0,604,1,1,604]),velocities:new Float32Array([1,0,0,1,0,0]),
    cellIndices:new Int32Array([0,0]),depthM:[0.5],count:2,radiusMetres:0.3,moving:false});
  assert.equal(stats.count,2,'the blobs still show where the water is');
  assert.equal(stats.streakSegments,0);
  assert.equal(blobs.trails.visible,false);
  assert.equal(blobs.blobs.material.uniforms.wobble.value,0);
  blobs.setReducedMotion(false);
  assert.equal(blobs.blobs.material.uniforms.wobble.value,JUNCTION_BLOB_DEFAULTS.wobble);
  blobs.dispose();
});

test('an empty or oversized particle set is handled explicitly',()=>{
  const place=placement();
  assert.throws(()=>createJunctionBlobs({placement:place,maxParticles:0}),/1-4096/);
  assert.throws(()=>createJunctionBlobs({placement:place,maxParticles:9000}),/1-4096/);
  assert.throws(()=>createJunctionBlobs({}),/placement/);
  const blobs=createJunctionBlobs({placement:place,maxParticles:2});
  const stats=blobs.update({count:0});
  assert.equal(stats.count,0);
  assert.equal(blobs.blobs.geometry.instanceCount,0);
  assert.equal(blobs.trails.geometry.drawRange.count,0);
  assert.throws(()=>blobs.update({count:2,positions:new Float32Array(3)}),/shorter than the declared count/);
  blobs.update({positions:new Float32Array(30),velocities:new Float32Array(30),cellIndices:new Int32Array(10),depthM:[1],count:10,radiusMetres:0.3});
  assert.equal(blobs.count,2,'the declared capacity caps the instance count');
  blobs.dispose();
});
