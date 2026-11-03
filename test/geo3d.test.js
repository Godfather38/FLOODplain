import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync,readFileSync,readdirSync} from 'node:fs';
import {resolveDataMode} from '../public/preview/geo3d/src/data-source.js';
import {fineGrid} from '../public/preview/geo3d/src/scene-config.js';
import {sceneHeights,sampleHeights} from '../public/preview/geo3d/src/elevation.js';
import {coarseBed,drainage,pickChannels,carveFine} from '../public/preview/geo3d/src/channels.js';
import {visibleRoadRuns,ribbonMesh} from '../public/preview/geo3d/src/roads.js';
import {ChannelSimulation} from '../public/preview/geo3d/src/channel-sim.js';
import {gunzipSync} from 'node:zlib';
import * as utm from '../public/preview/geo3d/src/utm.js';
import {toUtm,fromUtm} from '../public/preview/geo3d/src/utm.js';
import {GRID as SFINCS_GRID,makeSampler,parseFrames} from '../public/preview/geo3d/src/run-data.js';
import {buildHeights,groundSampler,levelGrid,shareGrid,levelSampler,modelCells,toWorld,worldToUtm,W as HW,H as HH} from '../public/preview/geo3d/src/world/heights.js';
import {lodFor as chunkLod,LODS as CHUNK_LODS} from '../public/preview/geo3d/src/world/detail.js';
import {mapWaterColour} from '../public/preview/geo3d/src/world/paint.js';
import {crossingStory,statusAt,COVER_M} from '../public/preview/geo3d/src/world/crossing-story.js';
import {parseRain,rainAt} from '../public/preview/geo3d/src/world/rain-data.js';
import {parseRoadHeights} from '../public/preview/geo3d/src/road-heights.js';
import {GRID_PRESETS} from '../public/preview/coastal-lowcost/src/trial-config.js';

const url=path=>new URL(`../${path}`,import.meta.url);
const read=path=>readFileSync(url(path),'utf8');
const GRID=GRID_PRESETS.tiny;
const snapshot=JSON.parse(read('dev/geo3d-snapshots/gates-pass.json'));
const metres=new Float32Array(Uint8Array.from(Buffer.from(snapshot.metres,'base64')).buffer);
const fine=fineGrid(),raw=sceneHeights(metres),channels=pickChannels(coarseBed(raw,fine,GRID,sampleHeights),GRID);
const walk=dir=>readdirSync(url(dir),{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(`${dir}/${e.name}`):[`${dir}/${e.name}`]);

test('only a local development address can select a snapshot', () => {
 assert.deepEqual(resolveDataMode('http://127.0.0.1:4173/preview/geo3d/?devSnapshot=gates-pass'),{mode:'dev-snapshot',name:'gates-pass'});
 assert.deepEqual(resolveDataMode('http://localhost:4173/?devSnapshot=gates-pass').mode,'dev-snapshot');
 for(const href of ['https://floodplain.duckdns.org/preview/geo3d/?devSnapshot=gates-pass','https://godfather38.github.io/FLOODplain/preview/geo3d/?devSnapshot=gates-pass','http://192.168.1.20:4173/preview/geo3d/?devSnapshot=gates-pass','https://localhost.example.com/?devSnapshot=gates-pass','http://127.0.0.1:4173/preview/geo3d/','http://127.0.0.1:4173/?devSnapshot=../../secret'])
  assert.deepEqual(resolveDataMode(href),{mode:'live'},href);
});

test('live mode has no fallback and snapshots stay out of the published folder', () => {
 const source=read('public/preview/geo3d/src/data-source.js');
 assert.doesNotMatch(source,/catch/,'a failed live request must surface as an error');
 assert.ok(existsSync(url('dev/geo3d-snapshots/gates-pass.json')));
 const published=walk('public/preview/geo3d');
 assert.ok(!published.some(p=>/snapshot/i.test(p.split('/').pop())),'no snapshot files under public/');
 assert.ok(!published.some(p=>p.endsWith('.json')),'the prototype publishes no data files of its own');
 for(const file of walk('public').filter(p=>/\.(js|html)$/.test(p)&&!p.includes('/coastal-lowcost/vendor/')&&!p.endsWith('geo3d/src/data-source.js')))assert.doesNotMatch(read(file),/__dev\/|geo3d-snapshots/,file);
});

test('the demo is byte-identical to the pinned commit and keeps opaque water', () => {
 const sums=read('public/preview/coastal-lowcost/SHA256SUMS').trim().split('\n').map(line=>line.trim().split(/\s+/));
 // Only the demo files the scene uses are kept. The checksum list is the demo's full list.
 const kept=sums.filter(([,file])=>existsSync(url(`public/preview/coastal-lowcost/${file}`)));
 for(const file of ['LICENSE','UPSTREAM.json','src/simulation.js','src/surface.js','src/coast.js','src/shading.js','vendor/three.core.js','vendor/three.webgpu.js'])assert.ok(kept.some(([,f])=>f===file),file);
 // A Windows checkout may hold CRLF line endings; the hashes are of the LF files.
 for(const [hash,file] of kept)assert.equal(createHash('sha256').update(read(`public/preview/coastal-lowcost/${file}`).replaceAll('\r\n','\n')).digest('hex'),hash,file);
 const main=read('public/preview/geo3d/src/main.js'),page=read('public/preview/geo3d/index.html');
 assert.match(page,/searchParams\.set\('preset','tiny-toon'\)/);
 assert.match(main,/TRIAL\.effects!=='toon'\|\|GRID\.nx!==24\|\|GRID\.nz!==40/);
 assert.match(main,/coastal-lowcost\/src\/shading\.js/);
});

test('a dismissible acknowledgement and the page text say the water is simulated', () => {
 const page=read('public/preview/geo3d/index.html'),map=read('public/preview/geo3d/world.html');
 assert.match(page,/id="simulation-ack"[\s\S]*This water is simulated[\s\S]*turn around, don't drown[\s\S]*id="simulation-ack-ok"/);
 assert.match(map,/id="simulation-ack"[\s\S]*This water is from a saved run[\s\S]*turn around, don't drown[\s\S]*id="simulation-ack-ok"/);
 for(const script of ['main.js','world/main.js'])assert.match(read(`public/preview/geo3d/src/${script}`),/mountAcknowledgement\(\)/,script);
 assert.match(read('public/preview/geo3d/src/acknowledge.js'),/button\.onclick/);
 assert.doesNotMatch(page,/simulation-(tag|banner)/,'no permanent label on screen');
 assert.match(page,/<title>FLOODplain 3D simulation<\/title>/);
 assert.match(page,/The water is simulated/);
 assert.match(read('public/preview/geo3d/src/data-source.js'),/Water: simulated\./);
});

test('the live app does not load the prototype', () => {
 for(const file of ['public/index.html','public/app.js','public/live-map.js','public/config.js'])assert.doesNotMatch(read(file),/geo3d|coastal-lowcost/,file);
});

test('drainage gives every cell a route to the edge', () => {
 const {nx,nz}=GRID,bed=new Float32Array(nx*nz).map((_,k)=>5+Math.sin(k*1.7)*3);
 const {receiver,filled}=drainage(bed,GRID);
 for(let k=0;k<nx*nz;k++){
  let c=k,hops=0;
  while(receiver[c]>=0){assert.ok(filled[receiver[c]]<filled[c]);c=receiver[c];assert.ok(++hops<=nx*nz);}
  const i=c%nx,j=(c-i)/nx;assert.ok(i===0||j===0||i===nx-1||j===nz-1);
 }
});

test('the terrain has pronounced relief and production roads cross it', () => {
 assert.ok(Math.max(...raw)-Math.min(...raw)>=8,`relief ${Math.max(...raw)-Math.min(...raw)}`);
 const runs=visibleRoadRuns(snapshot.routes);assert.ok(runs.length>0);
 const {positions,indices}=ribbonMesh(runs,(x,z)=>sampleHeights(raw,fine,x,z));
 assert.ok(positions.every(Number.isFinite));assert.ok(indices.length>100);assert.ok(Math.max(...indices)<positions.length/3);
});

test('the channels stay in budget and water visibly flows along them', () => {
 assert.equal(GRID.nx*GRID.nz,960);
 assert.ok(fine.nx*fine.nz<179010,'visible mesh stays under the demo mesh that was tried on the Pixel 8');
 const carved=carveFine(raw,fine,channels.lines);assert.equal(carved.length,raw.length);
 const sim=new ChannelSimulation(GRID,channels.bed,channels.sources);
 for(let i=0;i<3600;i++)sim.step(1/60);
 const m=sim.metrics();
 assert.equal(m.nonfinite,0);
 assert.ok(sim.h.every(h=>h>=0));
 const main=channels.paths[0].cells,wet=main.filter(k=>sim.h[k]>.02).length;
 assert.ok(wet/main.length>=.8,`wet ${wet}/${main.length} of the main channel`);
 const speed=main.map(k=>Math.hypot(sim.u[k],sim.v[k])).sort((a,b)=>a-b)[main.length>>1];
 assert.ok(speed>.5,`median channel speed ${speed}`);
 assert.ok(m.wetCells<960*.35,`water stays in channels: ${m.wetCells} wet cells`);
 const volume=m.volume;for(let i=0;i<1800;i++)sim.step(1/60);
 assert.ok(sim.metrics().volume<volume*1.6,'volume levels off rather than filling the map');
});

test('the water keeps moving instead of settling into a still picture', () => {
 const sim=new ChannelSimulation(GRID,channels.bed,channels.sources);
 for(let i=0;i<3600;i++)sim.step(1/60);
 const main=channels.paths[0].cells,grab=()=>main.map(k=>[sim.h[k],sim.foam[k]]);
 let moved=Infinity,foamed=Infinity;
 // Checked long after warm-up and at several moments: never a frozen stretch.
 for(let round=0;round<6;round++){
  const a=grab();for(let i=0;i<120;i++)sim.step(1/60);const b=grab();
  moved=Math.min(moved,Math.max(...a.map((p,q)=>Math.abs(p[0]-b[q][0]))));
  foamed=Math.min(foamed,a.reduce((s,p,q)=>s+Math.abs(p[1]-b[q][1]),0)/a.length);
 }
 assert.ok(moved>.03,`depth change over 2 s: ${moved}`);
 assert.ok(foamed>.005,`foam change over 2 s: ${foamed}`);
});

// The saved SFINCS run from Test flood mode's package, read the way the 3D page reads it.
const RUN='public/simulation/data/';
const display=JSON.parse(gunzipSync(readFileSync(url(RUN+'frozen-terrain-display.json.gz'))));
const runCells=JSON.parse(gunzipSync(readFileSync(url(RUN+'frozen-20261101-nwm13z-41327417204.json.gz')))).cells;
const sfTerrainBytes=gunzipSync(readFileSync(url(RUN+'frozen-voxel-terrain.f32.gz')));
const sfData={vertices:display.vertices,terrain:new Float32Array(sfTerrainBytes.buffer,sfTerrainBytes.byteOffset,sfTerrainBytes.byteLength/4)};
const sfSampler=makeSampler(sfData),sfFrames=parseFrames(display);

test('model cells land exactly where the SFINCS grid puts them', () => {
 for(const k of [0,9000,20000,29684]){
  const u=toUtm(runCells[k].lon,runCells[k].lat),v=display.vertices[k];
  assert.ok(Math.abs(u.e-(SFINCS_GRID.x0+v[0]))<.05&&Math.abs(u.n-(SFINCS_GRID.y0+v[1]))<.05,'cell '+k);
  const back=fromUtm(u.e,u.n);assert.ok(Math.abs(back.lon-runCells[k].lon)<1e-7&&Math.abs(back.lat-runCells[k].lat)<1e-7);
 }
});

test('ground is the 10 m lidar the model used, and nothing is invented outside it', () => {
 const k=20000,v=display.vertices[k],e=SFINCS_GRID.x0+v[4]*100,n=SFINCS_GRID.y0+v[3]*100;
 assert.equal(sfSampler.ground(e+5,n+5),sfData.terrain[k*100],'a subcell centre returns its own lidar sample');
 const mean=Array.from(sfData.terrain.subarray(k*100,k*100+100)).reduce((a,b)=>a+b,0)/100;
 assert.ok(Math.abs(mean-v[2])<.01,'the 10 m samples average to the cell terrain the model reports');
 assert.ok(Number.isNaN(sfSampler.ground(SFINCS_GRID.x0-5000,SFINCS_GRID.y0-5000)),'outside the case: unknown, not made up');
});


test('one height field holds the model lidar exactly, with public elevation only where the model has no cell', async () => {
 const {heights,filled}=await buildHeights(sfData,{fill:async()=>new Float32Array((SFINCS_GRID.mmax+1)*(SFINCS_GRID.nmax+1)).fill(700)});
 assert.equal(filled,HW*HH-sfData.vertices.length*100,'only empty corners are filled');
 for(const k of [0,15000,29684]){const v=sfData.vertices[k];assert.equal(heights[(v[3]*10+3)*HW+v[4]*10+7],sfData.terrain[k*100+3*10+7],'cell '+k);}
 const ground=groundSampler(heights),k=12000,v=sfData.vertices[k],[x,z]=toWorld(SFINCS_GRID.x0+v[4]*100+5,SFINCS_GRID.y0+v[3]*100+5);
 assert.ok(Math.abs(ground(x,z)-sfData.terrain[k*100])<1e-3,'the CPU sampler reads the same field the shader does');
 const back=worldToUtm(x,z);assert.ok(Math.abs(back.e-(SFINCS_GRID.x0+v[4]*100+5))<1e-6&&Math.abs(back.n-(SFINCS_GRID.y0+v[3]*100+5))<1e-6);
});

test('water levels come straight from the saved frames, and missing stays missing', () => {
 const grid=levelGrid(sfFrames[8],sfData.vertices);
 for(const k of [100,9000,20000]){const v=sfData.vertices[k],z=sfFrames[8].surface[k];assert.equal(grid[v[3]*SFINCS_GRID.mmax+v[4]],Number.isNaN(z)?-1e5:Math.fround(z));}
 const missing=sfData.vertices.findIndex((_,i)=>Number.isNaN(sfFrames[0].surface[i])),v=sfData.vertices[missing];
 assert.equal(levelGrid(sfFrames[0],sfData.vertices)[v[3]*SFINCS_GRID.mmax+v[4]],-1e5,'unknown is far below ground, never water');
 assert.equal(grid.filter(z=>z>-1e4).length,sfFrames[8].surface.filter(z=>!Number.isNaN(z)).length);
});

test('detail changes with distance, with a margin so it does not flip back and forth', () => {
 assert.deepEqual([chunkLod(0),chunkLod(3000),chunkLod(9000),chunkLod(50000)],[0,1,2,3]);
 assert.equal(chunkLod(CHUNK_LODS[0].reach*1.1,0),0,'moving away keeps the finer detail a little longer');
 assert.equal(chunkLod(CHUNK_LODS[0].reach*1.1,1),1,'coming closer switches at the reach');
});

test('blue means model water: map water areas are painted as beds', () => {
 assert.equal(mapWaterColour({class:'river'}),'#eadcbd');
 assert.equal(mapWaterColour({class:'lake',intermittent:1}),'#eadcbd');
 for(const c of [mapWaterColour({class:'river'}),mapWaterColour({class:'lake'})]){const [r,g,b]=[1,3,5].map(i=>parseInt(c.slice(i,i+2),16));assert.ok(b-r<20,c+' is not a water blue');}
});

test('the 3D world uses no invented geometry and one shared height field', () => {
 const files=['main.js','surface.js','chunks.js','detail.js','structures.js','paint.js','heights.js','tiles.js'].map(f=>read('public/preview/geo3d/src/world/'+f)).join('\n');
 assert.match(read('public/preview/geo3d/world.html'),/src\/world\/main\.js/);
 assert.doesNotMatch(files,/channels\.js|network\.js|water-window\.js|channel-sim\.js|plantSpots|carveField|carveFine|cutAt|withWander|maplibre/);
 assert.match(read('public/preview/geo3d/src/world/chunks.js'),/brunnel==='bridge'/,'bridges only where the map says bridge');
 for(const f of ['map.html','src/run-map.js','src/run-water.js','src/roads-3d.js','vendor/maplibre'])assert.ok(!existsSync(url('public/preview/geo3d/'+f)),f);
});

test('the zoomed-out wet share summarises the same frame, cell by cell', () => {
 const share=shareGrid(sfFrames[12],sfData,.05),known=share.filter(s=>s>=0);
 assert.ok(known.every(s=>s<=1)&&known.some(s=>s>0)&&known.some(s=>s===0));
 const missing=sfData.vertices.findIndex((_,i)=>Number.isNaN(sfFrames[0].surface[i])),v=sfData.vertices[missing];
 assert.ok(shareGrid(sfFrames[0],sfData,.05)[v[3]*SFINCS_GRID.mmax+v[4]]<0,'a cell with no level has no share, not zero');
});

test('crossings count as modelled only where the model has a cell', () => {
 const inside=modelCells(sfData.vertices),v=sfData.vertices[0],cell=(n,m)=>toWorld(SFINCS_GRID.x0+(m+.5)*SFINCS_GRID.dx,SFINCS_GRID.y0+(n+.5)*SFINCS_GRID.dx);
 assert.ok(inside(...cell(v[3],v[4])));
 const active=new Set(sfData.vertices.map(q=>q[3]*SFINCS_GRID.mmax+q[4]));let gap=0;while(active.has(gap))gap++;
 assert.ok(!inside(...cell(Math.floor(gap/SFINCS_GRID.mmax),gap%SFINCS_GRID.mmax)),'an inactive cell inside the rectangle is not modelled');
 assert.ok(!inside(...toWorld(SFINCS_GRID.x0-500,SFINCS_GRID.y0-500)));
});

test('a crossing sheet compares the road height with the model water, hour by hour', () => {
 const world=(lon,lat)=>[lon,lat],ground=()=>600,frames=[{time:'a'},{time:'b'},{time:'c'}];
 const samplers=[()=>599,()=>600.5,()=>NaN].map(f=>f);
 const base={world,ground,inside:()=>true,frames,samplers,measured:[]};
 const dip=crossingStory({lon:0,lat:0,kind:'dip'},base);
 assert.equal(dip.road.m,600);assert.match(dip.road.source,/lidar/);
 assert.deepEqual([0,1,2].map(i=>statusAt(dip,i)),['clear','over','unknown']);
 assert.equal(dip.coveredHours,1);assert.equal(dip.unknownHours,1);assert.equal(dip.peak.water,600.5);
 const bridge=crossingStory({lon:0,lat:0,kind:'bridge'},base);
 assert.equal(bridge.road.m,null,'bare-earth lidar under a bridge is the channel, not the deck');
 assert.equal(statusAt(bridge,1),'unmeasured');
 const surveyed=crossingStory({lon:0,lat:0,kind:'bridge'},{...base,measured:[{lon:30,lat:0,roadM:610,deck:true}]});
 assert.equal(surveyed.road.m,610);assert.ok(surveyed.road.measured);assert.equal(statusAt(surveyed,1),'clear');
 assert.equal(crossingStory({lon:0,lat:0,kind:'bridge'},{...base,measured:[{lon:500,lat:0,roadM:610}]}).road.m,null,'a survey point far away does not count');
 assert.equal(statusAt(crossingStory({lon:0,lat:0,kind:'dip'},{...base,inside:()=>false}),0),'outside');
 assert.ok(COVER_M>0);
});

test('surveyed road heights read their place from the point id', () => {
 const pts=parseRoadHeights(JSON.parse(read('public/inundation/road-heights.json')));
 assert.ok(pts.length>0);
 for(const p of pts){assert.ok(p.lat>32&&p.lat<33&&p.lon<-110&&p.lon>-112,p.id);assert.ok(Number.isFinite(p.roadM),p.id);}
});

test('rain comes from the run rainfall grid, and only where and when it has rain', () => {
 const ctx=JSON.parse(read('public/simulation/data/frozen-map-context.json')),rain=parseRain(ctx);
 assert.ok(rain.frames.length>0);
 const f=rain.frames[0],g=ctx.rainfall.frames[0].precipMmH,mid=(f.start+f.end)/2;
 assert.ok(Math.abs(rainAt(rain,mid,rain.cols[3],rain.rows[4])-g[4][3])<1e-9,'on a grid point it is that value');
 assert.equal(rainAt(rain,f.start-1,rain.cols[3],rain.rows[4]),0,'before the first hour');
 assert.equal(rainAt(rain,mid,rain.cols[0]-1,rain.rows[0]),0,'outside the grid');
 assert.equal(parseRain({}),null);
});

test('the 19Z run has its own rainfall input, on its UTM grid, for its saved hours', () => {
 const r=JSON.parse(read('public/simulation/data/sfincs-current-coarse-20261101-19z-41350254061-map/rainfall.json')),rain=parseRain(r);
 assert.equal(r.source.sha256,'119e6302e578932c4a811f0ba73d5b0ba915e82ec8903a6db718549a38745ef4','the precip_2d.nc the run recorded');
 assert.ok(rain.utm);assert.equal(r.frames[0].start,'2026-11-01T22:00:00Z');assert.equal(r.frames.at(-1).end,'2026-11-02T12:00:00Z');
 const f=rain.frames.find(q=>q.start===Date.parse('2026-11-02T07:00:00Z')),g=f.grid,mid=f.start+1800e3;
 const {fromUtm}=utm,ll=fromUtm(r.x[5],r.y[7]);
 assert.ok(Math.abs(rainAt(rain,mid,ll.lon,ll.lat)-g[7][5])<1e-3,'a grid point gives its own value');
 assert.ok(Math.max(...g.flat())>5,'the Nov 2 07Z burst is there');
});

test('every run on the 3D map has its water frames and rain, and the stress run says what it is', () => {
 const main=read('public/preview/geo3d/src/world/main.js'),files=[...main.matchAll(/(?:display|rain):'([^']+)'/g)].map(m=>m[1]);
 assert.ok(files.length>=6);
 for(const f of files)assert.ok(existsSync(url('public/simulation/data/'+f)),f);
 const stress=JSON.parse(gunzipSync(readFileSync(url('public/simulation/data/sfincs-stress-storm-41633261576-map/frozen-terrain-display.json.gz'))));
 assert.equal(stress.waterFrames.length,15);assert.equal(stress.vertices.length,sfData.vertices.length);assert.match(stress.scenario,/not a forecast/);
 const rain=JSON.parse(read('public/simulation/data/sfincs-stress-storm-41633261576-map/rainfall.json'));
 assert.equal(Math.max(...rain.frames.flatMap(f=>f.precipMmH.flat())),55.88,'the Atlas 14 100-year peak hour, 2.20 in');
 assert.match(main,/what-if run of the same model, not a forecast/);
});

test('crossings use the lidar road surface and bridge decks from the road-height package', async () => {
 const {decodeRoadHeights,roadPackage}=await import('../public/preview/geo3d/src/road-package.js');
 const b=gunzipSync(readFileSync(url('public/simulation/data/road-heights/routes.bin.gz')));
 const manifest=JSON.parse(read('public/simulation/data/road-heights/manifest.json'));
 assert.equal(createHash('sha256').update(readFileSync(url('public/simulation/data/road-heights/routes.bin.gz'))).digest('hex'),manifest.files[0].sha256);
 const world=(lon,lat)=>{const u=toUtm(lon,lat);return toWorld(u.e,u.n);};
 const roads=roadPackage(decodeRoadHeights(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)),JSON.parse(read('public/simulation/data/road-heights/structures.json')),world);
 assert.ok(roads.stations.length>20000);
 const {FAILURE_POINTS}=await import('../public/config.js'),fp=id=>FAILURE_POINTS.find(p=>p.id===id);
 const base={world,ground:()=>500,inside:()=>true,frames:[{time:'a'}],samplers:[()=>600]};
 // Lidar deck points, as the road-heights branch documents: Avra 635.05 m, Trico-Marana 590.85 m.
 assert.equal(crossingStory(fp('sc-avra'),{...base,roads}).road.m,635.05);
 assert.ok(Math.abs(crossingStory(fp('sc-trico-marana'),{...base,roads}).road.m-590.85)<.01);
 const dip=crossingStory(fp('pr-picture-rocks-wash'),{...base,roads});
 assert.match(dip.road.source,/Lowest road surface/);assert.ok(!dip.road.deck);
 assert.ok(Math.abs(dip.road.m-718.05)<.1,'the bottom of the dip');
});

test('the live run is the newest published run, refused when stale, never swapped for an old one in silence', () => {
 const main=read('public/preview/geo3d/src/world/main.js');
 assert.match(main,/raw\.githubusercontent\.com\/Godfather38\/FLOODplain\/live-model\/live\//);
 assert.match(main,/LIVE_MAX_AGE_H=3/);
 assert.match(main,/if\(!\(age<=LIVE_MAX_AGE_H\)\)throw/);
 assert.match(main,/No live model run to show: /,'a saved run shown instead says why');
});

test('live ratings on the 3D map come from the app\'s own feeds and rating code', () => {
 const live=read('public/preview/geo3d/src/live-conditions.js');
 for(const fn of ['rateFailurePoint','riskScore','rateRoutes','routeScore','loadGaugeReadings'])assert.match(live,new RegExp(fn));
 assert.doesNotMatch(live,/simulation\/data|frozen|snapshot/i,'no saved data in live ratings');
});
