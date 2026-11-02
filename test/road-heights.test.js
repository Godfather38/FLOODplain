import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {decodeRoadHeights,decodeRoadFlood,ROAD_FLAGS} from '../public/simulation/road-heights.js';

const dir=new URL('../public/simulation/data/road-heights/',import.meta.url);
const open=async p=>{const b=gunzipSync(await readFile(new URL(p,dir)));return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);};
const nearest=(lines,lon,lat)=>lines.flatMap(l=>l.stations).reduce((a,s)=>(s.lon-lon)**2+(s.lat-lat)**2<(a.lon-lon)**2+(a.lat-lat)**2?s:a);

test('route stations carry measured heights and bridge decks',async()=>{
  const {lines}=decodeRoadHeights(await open('routes.bin.gz')),routes=lines.filter(l=>l.kind==='route');
  assert.equal(new Set(routes.map(l=>l.routeId)).size,8);
  assert.ok(lines.some(l=>l.kind==='freeway'&&l.name==='I-10'));
  const trico=nearest(routes,-111.27983,32.453719),santaCruz=nearest(routes,-111.146289,32.40251),brawley=nearest(routes,-111.29459,32.39322);
  assert.ok(trico.flags&ROAD_FLAGS.deckLidar);assert.ok(Math.abs(trico.elevationM-590.85)<0.1);
  assert.ok(santaCruz.flags&ROAD_FLAGS.deckLidar);assert.ok(Math.abs(santaCruz.elevationM-635.05)<0.3);
  // Brawley is an at-grade dip: terrain height, no deck.
  assert.equal(brawley.flags&(ROAD_FLAGS.deckLidar|ROAD_FLAGS.deckApproach),0);assert.ok(Math.abs(brawley.elevationM-606.26)<0.1);
});
test('missing heights decode as null, never zero',async()=>{
  const {lines}=decodeRoadHeights(await open('routes.bin.gz')),stations=lines.flatMap(l=>l.stations);
  assert.ok(stations.every(s=>s.elevationM===null||s.elevationM>500));
  assert.ok(stations.every(s=>s.elevationM!==null||s.flags&ROAD_FLAGS.noTerrain));
});
test('flood frames bind to the model run and keep outside-model stations unknown',async()=>{
  const run='refined-full-41344983607',f=decodeRoadFlood(await open(`flood/${run}/frames.bin.gz`));
  assert.equal(f.runId,run);assert.equal(f.times.length,57);
  assert.ok(f.stationFace.includes(-1));
  const summary=JSON.parse(await readFile(new URL(`flood/${run}/summary.json`,dir)));
  assert.equal(summary.stations,f.stationFace.length);
  const values=f.everAboveStations.map((_,k)=>f.aboveRoadM(40,k)).filter(v=>v!==null);
  assert.ok(values.length>0&&values.every(Number.isFinite));
});
test('no stretch is reported on a road outside the model',async()=>{
  const geo=JSON.parse(await readFile(new URL('flood/refined-full-41344983607/stretches.geojson',dir)));
  assert.ok(geo.features.length>0);
  assert.ok(geo.features.every(x=>['fine','coarse'].includes(x.properties.faceSupport)&&x.properties.peakAboveRoadM>=0.03));
});

test('road package hashes bind to the exact UTF-8 LF JSON and compressed bytes',async()=>{
  const jsonBytes=async path=>{
    const bytes=await readFile(new URL(path,dir));
    assert.equal(bytes.includes(13),false,`${path} must use LF, including on Windows`);
    assert.equal(bytes.at(-1),10,`${path} must end with LF`);
    const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    return {bytes,value};
  };
  const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
  const {bytes:manifestBytes,value:manifest}=await jsonBytes('manifest.json');
  const {bytes:structureBytes}=await jsonBytes(manifest.structures.path);
  assert.equal(sha256(structureBytes),manifest.structures.sha256,'structures hash');
  for(const file of manifest.files){
    const bytes=await readFile(new URL(file.path,dir));
    assert.equal(bytes.length,file.bytes,`${file.path} byte count`);
    assert.equal(sha256(bytes),file.sha256,`${file.path} compressed-byte hash`);
  }
  const run='refined-full-41344983607',base=`flood/${run}/`;
  const {value:summary}=await jsonBytes(base+'summary.json');
  assert.equal(summary.runId,run);
  assert.equal(sha256(manifestBytes),summary.roadManifestSha256,'road manifest hash');
  const {bytes:stretchesBytes}=await jsonBytes(base+summary.stretchesFile.path);
  assert.equal(sha256(stretchesBytes),summary.stretchesFile.sha256,'stretches hash');
  const frames=await readFile(new URL(base+summary.frames.path,dir));
  assert.equal(frames.length,summary.frames.bytes,'flood frames byte count');
  assert.equal(sha256(frames),summary.frames.sha256,'flood frames compressed-byte hash');
  const modelManifest=await readFile(new URL('../refined-full-compact-41344983607/manifest.json',dir));
  assert.equal(sha256(modelManifest),summary.packageManifestSha256,'model manifest hash');
});
