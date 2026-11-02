import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {loadRoadReplay,ROAD_REPLAY,roadStationReading,roadRibbons,selectRoadTiles} from '../public/simulation/road-replay-source.js';
import {decodeRoadHeights} from '../public/simulation/road-heights.js';
import {ROAD_TILE_BOUNDS,ROAD_TILE_SOURCE} from '../public/simulation/road-tile-bounds.js';
import {roadReplayURL} from '../public/simulation/road-replay.js';
import {createMapState} from '../public/simulation/map-state.js';
const base=new URL('https://app.invalid/simulation/'),requests=[];
const fetchImpl=async url=>{const u=new URL(url);requests.push(u.pathname);return new Response(readFileSync('public'+u.pathname));};
const real=loadRoadReplay({base,fetchImpl});
test('checked compact replay binds all 57 times without loading whole-domain water',async()=>{
 const s=await real;assert.equal(s.times.length,57);assert.equal(s.times[20],'2026-11-01T22:00:00Z');
 assert.equal(s.frame(20).runId,ROAD_REPLAY.runId);assert.equal(s.frame(20).sourceSha256,ROAD_REPLAY.modelManifestSha256);
 assert.ok(!requests.some(p=>/geometry.bin|frame-\d+\.bin|stretches.geojson/.test(p)));
 assert.throws(()=>s.frame(0,{runId:'other'}),/source mismatch/);assert.throws(()=>s.frame(0,{sourceSha256:'bad'}),/source mismatch/);
 assert.throws(()=>s.frame(57),/out of range/);
});
test('sparse index, outside model, null and absence have separate conservative meanings',()=>{
 const f={times:['one'],stationFace:[1,1,-1,2,3,4],aboveRoadM:(frame,k)=>[.25,null,-.1][k]};
 const sparse=new Map([[4,0],[3,1],[5,2]]),station={elevationM:600,flags:0};
 assert.equal(roadStationReading(f,sparse,0,4,station).aboveRoadM,.25);
 assert.equal(roadStationReading(f,sparse,0,2,station).status,'outside_model');
 assert.equal(roadStationReading(f,sparse,0,3,station).status,'unknown_frame');
 assert.equal(roadStationReading(f,sparse,0,0,station).status,'no_exceedance_recorded');
 assert.equal(roadStationReading(f,sparse,0,5,station).status,'below_threshold');
 assert.equal(roadStationReading(f,sparse,0,4,{...station,elevationM:null}).status,'unknown_height');
 assert.throws(()=>roadStationReading(f,sparse,0,9,station),/out of range/);
});
test('threshold remains 3 cm and selected frames do not use peak-union geometry',async()=>{
 assert.equal(ROAD_REPLAY.thresholdM,.03);const s=await real,lines=await s.loadTile('routes.bin.gz');
 const counts=s.times.map((_,i)=>lines.reduce((n,l)=>n+l.stations.filter((_,k)=>s.frame(i).readStation(l,k).status==='above_road').length,0));
 assert.ok(new Set(counts).size>1);assert.ok(Math.max(...counts)>0);
 assert.equal(lines.length,244);assert.equal(lines.reduce((n,l)=>n+l.stations.length,0),66485);
 assert.ok(lines.every(l=>l.id.startsWith('routes.bin.gz:')));
});
test('ribbons do not bridge unknown samples and retain isolated wet points',()=>{
 const stations=[0,1,2,3,4].map(i=>({lon:-111+i*.00001,lat:32,stationM:i,elevationM:i===2?590:600,flags:0}));
 const status=['above_road','above_road','unknown_frame','above_road','unknown_frame'];
 const f={readStation:(_,i)=>({status:status[i],aboveRoadM:status[i]==='above_road'?.1:null})};
 const ribbons=roadRibbons({id:'tile:0',stations},f,{spacingM:100});
 assert.equal(ribbons.segments.filter(r=>r.status==='above_road').length,1);
 assert.deepEqual(ribbons.segments.find(r=>r.status==='above_road').coordinates,stations.slice(0,2).map(s=>[s.lon,s.lat]));
 assert.equal(ribbons.points.length,1);assert.deepEqual(ribbons.points[0].coordinate,[stations[3].lon,32]);
});
test('road simplification preserves dip and elevated bridge samples without ground draping',()=>{
 const stations=[610,609,605,609,615,615].map((z,i)=>({lon:-111+i*.00001,lat:32,stationM:i,elevationM:z,flags:i>=4?1:0}));
 const frame={readStation:()=>({status:'above_road',aboveRoadM:.1})};
 const out=roadRibbons({id:'tile:1',stations},frame,{spacingM:100});
 assert.ok(out.segments.some(s=>s.elevationsM.includes(605)));assert.ok(out.segments.some(s=>s.flags===1&&s.elevationsM.every(z=>z===615)));
});
test('actual tile bounds enclose all geometry rather than only line centroids',async()=>{
 const s=await real;assert.equal(ROAD_TILE_SOURCE,ROAD_REPLAY.roadManifestSha256);
 for(const file of s.manifest.files){const raw=gunzipSync(readFileSync('public/simulation/data/road-heights/'+file.path));const decoded=decodeRoadHeights(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength));const b=ROAD_TILE_BOUNDS[file.path];
  for(const line of decoded.lines)for(const p of line.stations)assert.ok(p.lon>=b[0]&&p.lon<=b[2]&&p.lat>=b[1]&&p.lat<=b[3]);}
 assert.deepEqual(selectRoadTiles(s.manifest,ROAD_TILE_BOUNDS,[-111.3,32.39,-111.29,32.4],false).map(f=>f.path),['routes.bin.gz']);
});
test('corrupt compressed road data and manifests are rejected',async()=>{
 for(const suffix of ['manifest.json','frames.bin.gz']){
  const corrupt=async url=>{const bytes=Buffer.from(readFileSync('public'+new URL(url).pathname));if(String(url).endsWith(suffix))bytes[10]^=1;return new Response(bytes);};
  await assert.rejects(()=>loadRoadReplay({base,fetchImpl:corrupt}),/checksum/);
 }
});
test('Return to live removes frozen selectors and road mode is explicitly opt-in',()=>{
 const live=new URL(roadReplayURL('https://example.com/?case=roads&replay=x&time=old&view=3d#/map',false));
 assert.equal(live.searchParams.get('live'),'1');for(const key of ['case','replay','time','view'])assert.equal(live.searchParams.has(key),false);
 const replay=new URL(roadReplayURL(live.href));assert.equal(replay.searchParams.get('case'),'roads');assert.equal(replay.searchParams.has('live'),false);
 const source=readFileSync('public/simulation/map-layers.js','utf8');assert.match(source,/if\(new URLSearchParams\(location.search\).get\('case'\)==='roads'\)return mountRoadReplay/);
 assert.match(source,/Live conditions map\. Frozen model replays are opt-in/);
 const ui=readFileSync('public/simulation/road-replay.js','utf8');assert.match(ui,/data-3d disabled/);assert.doesNotMatch(ui,/createGeographicView|stretches\.geojson|localStorage/);
});
test('shared displayed state carries run, time and immutable source hash',()=>{
 const state=createMapState();state.setDataset({runId:ROAD_REPLAY.runId,frameTimes:['2026-11-01T22:00:00Z'],artifactSha256:ROAD_REPLAY.modelManifestSha256});
 const id=state.request({model:'2d',index:0});state.acknowledge({requestId:id,time:'2026-11-01T22:00:00Z',model:'2d'});
 assert.equal(state.snapshot().displayed.artifactSha256,ROAD_REPLAY.modelManifestSha256);
});
