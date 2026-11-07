import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {decodeRoadHeights} from '../public/preview/geo3d/src/road-package.js';
import {forecastComparison} from '../public/simulation/road-comparison.js';

const root=new URL('../public/simulation/data/road-heights/',import.meta.url);
const read=(path)=>readFileSync(new URL(path,root));
const sha=(bytes)=>createHash('sha256').update(bytes).digest('hex');
const manifest=JSON.parse(read('manifest.json')), source=JSON.parse(read('source.json'));
const repair=source.repairs[0], evidence=JSON.parse(read(repair.path));
const encoded=read('routes.bin.gz'), raw=gunzipSync(encoded);
const pkg=decodeRoadHeights(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength));
const gates=pkg.lines.find(l=>l.kind==='route'&&l.routeId==='pr-gates');

test('app road heights use the exact repaired package used by the live model',()=>{
 const entry=manifest.files.find(f=>f.tier==='routes');
 assert.equal(sha(encoded),'dc8dcf3e5420f623444c534a005e2dbd8225f1ae890edc9baa0b956b233efe99');
 for(const d of [entry,source]){assert.equal(d.sha256,sha(encoded));assert.equal(d.bytes,encoded.length);assert.equal(d.decodedBytes,raw.length);}
 assert.equal(sha(read(entry.source.path)),entry.source.sha256);
 assert.equal(sha(read(repair.path)),repair.sha256);
 assert.equal(sha(readFileSync(new URL('../public/data/routes.geojson',import.meta.url))),evidence.routeGeometry.sha256);
 assert.equal(gates.stations.length,6445);
 assert.ok(gates.stations.every(s=>Number.isFinite(s.elevationM)));
});

test('restoring only the two declared repairs recovers every original package byte',()=>{
 const restored=Buffer.from(raw),size=restored.readUInt32LE(0),header=JSON.parse(restored.subarray(4,4+size));
 const widths={u4:4,i4:4,u1:1,i1:1,i2:2};
 const methods={u4:['readUInt32LE','writeUInt32LE'],i4:['readInt32LE','writeInt32LE'],u1:['readUInt8','writeUInt8'],i1:['readInt8','writeInt8'],i2:['readInt16LE','writeInt16LE']};
 const pos=(name,i)=>4+size+header.columns[name].offset+i*widths[header.columns[name].type];
 const get=(name,i)=>restored[methods[header.columns[name].type][0]](pos(name,i));
 const set=(name,i,value)=>restored[methods[header.columns[name].type][1]](value,pos(name,i));
 for(const s of evidence.stations){
  const a=get('lineStart',s.lineIndex),b=get('lineStart',s.lineIndex+1),i=s.globalIndex;
  assert.equal(a+s.stationIndex,i);assert.equal(header.lines.routeId[s.lineIndex],s.routeId);
  let height=0;for(let j=a;j<=i;j++)height+=get('dZCm',j);
  const delta=s.original.encodedHeightCm-height;
  set('dZCm',i,get('dZCm',i)+delta);if(i+1<b)set('dZCm',i+1,get('dZCm',i+1)-delta);
  for(const key of ['flags','source','lateralDm'])set(key,i,s.original[key]);
 }
 assert.equal(sha(restored),evidence.inputDecodedSha256,'coordinates, metadata, and every other station stay byte-for-byte unchanged');
});

test('the two app heights reproduce from pinned finite USGS pixels, not guessed neighbors',()=>{
 const win=evidence.window,packed=read('repairs/'+win.path),pixels=gunzipSync(packed);
 assert.equal(sha(packed),win.sha256);assert.equal(sha(pixels),win.decodedSha256);
 assert.equal(pixels.length,win.width*win.height*4);
 for(const s of evidence.stations){
  assert.deepEqual(s.samples.map(v=>v.offsetM),[-3,-1.5,0,1.5,3]);
  const heights=s.samples.map(sample=>{
   const [col,row]=sample.pixelCentreCoordinates,c=Math.floor(col),r=Math.floor(row),x=c-win.col,y=r-win.row;
   assert.ok(x>=0&&y>=0&&x+1<win.width&&y+1<win.height);
   const values=[[x,y],[x+1,y],[x,y+1],[x+1,y+1]].map(([xx,yy])=>pixels.readFloatLE((yy*win.width+xx)*4));
   assert.ok(values.every(v=>Number.isFinite(v)&&v!==evidence.source.nodata));
   const [a,b,c0,d]=values,fx=col-c,fy=row-r;
   return (a*(1-fx)+b*fx)*(1-fy)+(c0*(1-fx)+d*fx)*fy;
  }).sort((a,b)=>a-b);
  const station=gates.stations[s.stationIndex];
  assert.equal(station.lon,s.lon);assert.equal(station.lat,s.lat);
  assert.equal(station.elevationM,Math.round(heights[2]*100)/100);
  assert.equal(station.flags,0);
 }
 assert.deepEqual(evidence.stations.map(s=>gates.stations[s.stationIndex].elevationM),[734.59,734.49]);
});

test('current forecasts can compare water with both repaired road stations',()=>{
 for(const s of evidence.stations){
  const p=gates.stations[s.stationIndex],station={lat:p.lat,lon:p.lon,roadM:p.elevationM,deck:false};
  const result=forecastComparison({lat:p.lat,lon:p.lon,maxOver:.1,source:'high_resolution'},[station]);
  assert.equal(result.status,'water');assert.equal(result.roadM,p.elevationM);
  assert.ok(Math.abs(result.waterM-(p.elevationM+.1))<1e-9);
 }
});
