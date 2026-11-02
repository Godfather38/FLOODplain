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
 const page=read('public/preview/geo3d/index.html'),main=read('public/preview/geo3d/src/main.js');
 assert.match(page,/id="simulation-ack"[\s\S]*This water is simulated[\s\S]*turn around, don't drown[\s\S]*id="simulation-ack-ok"/);
 assert.match(main,/simulation-ack-ok'\)\.onclick/);
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
