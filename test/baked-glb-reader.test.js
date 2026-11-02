// Reads the repository's real baked junction asset. No network, solver run or
// visual claim: this only proves the container is parsed exactly as baked.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {readBakedGlb,describeBakedExtras,bakedVertexToLocalMetres} from '../tools/simulation/baked-glb-reader.js';

const base=new URL('../public/simulation/data/brawley-baked/',import.meta.url);
const bytes=readFileSync(new URL('brawley-ground-road.glb',base));
const report=JSON.parse(readFileSync(new URL('bake-report.json',base),'utf8'));

test('the committed baked junction GLB still matches its recorded checksum and size',()=>{
  assert.equal(bytes.byteLength,report.bytes);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),report.sha256);
});

test('reader returns the exact baked terrain, road and marking meshes',()=>{
  const baked=readBakedGlb(bytes);
  assert.equal(baked.meshes.length,3);
  assert.deepEqual(baked.meshes.map(m=>m.name),['Source terrain','roads','markings']);
  const [ground,roads,markings]=baked.meshes;
  assert.equal(ground.triangleCount,report.terrainTriangles);
  assert.equal(markings.triangleCount,report.road.markingTriangles);
  assert.equal(roads.triangleCount+markings.triangleCount,report.road.triangles);
  assert.equal(baked.triangles,report.terrainTriangles+report.road.triangles);
  assert.ok(ground.uv,'the baked ground carries the scene-bounds UV used for the orthophoto');
  assert.equal(roads.uv,null,'cartographic road ribbons carry no imagery UV');
  for(const mesh of baked.meshes){
    assert.equal(mesh.positions.length,mesh.vertexCount*3);
    assert.equal(mesh.normals.length,mesh.vertexCount*3);
    assert.ok(mesh.positions.every(Number.isFinite)&&mesh.normals.every(Number.isFinite));
  }
});

test('baked metadata supplies the placement rather than an assumed convention',()=>{
  const meta=describeBakedExtras(readBakedGlb(bytes).extras);
  assert.deepEqual(meta.center,report.center);
  assert.equal(meta.baseElevationM,report.baseElevationNAVD88M);
  assert.equal(meta.sourceRun,report.sourceRun);
  assert.match(meta.axes,/x east/);
  for(const patch of [{center:null},{center:[0]},{baseElevationNAVD88M:null},{axes:'y north'},{nativeTerrainUnmodified:false}])
    assert.throws(()=>describeBakedExtras({...readBakedGlb(bytes).extras,...patch}));
});

test('baked elevations stay absolute NAVD88 after the axis swap',()=>{
  const baked=readBakedGlb(bytes),meta=describeBakedExtras(baked.extras),ground=baked.meshes[0];
  let lowest=Infinity,highest=-Infinity;
  for(let i=0;i<ground.positions.length;i+=3){
    const [east,north,navd88]=bakedVertexToLocalMetres(ground.positions[i],ground.positions[i+1],ground.positions[i+2],meta.baseElevationM);
    assert.ok(Number.isFinite(east)&&Number.isFinite(north));
    lowest=Math.min(lowest,navd88);highest=Math.max(highest,navd88);
  }
  assert.ok(lowest>=meta.baseElevationM,'no baked vertex sits below the recorded base elevation');
  assert.ok(lowest<meta.baseElevationM+1,'the recorded base elevation is the floor of the real terrain');
  assert.ok(highest-lowest>1&&highest-lowest<200,'relief is real source terrain, not exaggerated');
  assert.deepEqual(bakedVertexToLocalMetres(5,2,-7,603),[5,7,605]);
});

test('unexpected containers fail loudly instead of being guessed at',()=>{
  const corrupt=(mutate)=>{const copy=Buffer.from(bytes);mutate(copy);return copy;};
  assert.throws(()=>readBakedGlb(corrupt(c=>c.writeUInt32LE(0,0))),/not a GLB container/);
  assert.throws(()=>readBakedGlb(corrupt(c=>c.writeUInt32LE(3,4))),/glTF 2.0/);
  assert.throws(()=>readBakedGlb(corrupt(c=>c.writeUInt32LE(c.length-4,8))),/Declared GLB length/);
  assert.throws(()=>readBakedGlb(bytes.subarray(0,12)),/too short/);
  const glb=readBakedGlb(bytes);
  assert.ok(glb.triangles>0);
});
