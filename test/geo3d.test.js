import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync,readFileSync,readdirSync} from 'node:fs';
import {resolveDataMode} from '../public/preview/geo3d/src/data-source.js';
import {fineGrid} from '../public/preview/geo3d/src/scene-config.js';
import {sceneHeights,sampleHeights} from '../public/preview/geo3d/src/elevation.js';
import {coarseBed,drainage,pickChannels,carveFine,ribbonMask,channelsFromLines} from '../public/preview/geo3d/src/channels.js';
import {drainageNetwork,withWander,carveField,sampleField,streamChains} from '../public/preview/geo3d/src/network.js';
import {visibleRoadRuns,ribbonMesh} from '../public/preview/geo3d/src/roads.js';
import {ChannelSimulation} from '../public/preview/geo3d/src/channel-sim.js';
import {chooseWindow} from '../public/preview/geo3d/src/water-window.js';
import {buildRoadMesh,parseRoadHeights,anchorLift,roadCovered} from '../public/preview/geo3d/src/roads-3d.js';
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
 const page=read('public/preview/geo3d/index.html'),map=read('public/preview/geo3d/map.html');
 for(const html of [page,map])assert.match(html,/id="simulation-ack"[\s\S]*This water is simulated[\s\S]*turn around, don't drown[\s\S]*id="simulation-ack-ok"/);
 for(const script of ['main.js','map-layer.js'])assert.match(read(`public/preview/geo3d/src/${script}`),/mountAcknowledgement\(\)/,script);
 assert.match(read('public/preview/geo3d/src/acknowledge.js'),/button\.onclick/);
 assert.doesNotMatch(page,/simulation-(tag|banner)/,'no permanent label on screen');
 assert.match(page,/<title>FLOODplain 3D simulation<\/title>/);
 assert.match(page,/The water is simulated/);
 assert.match(read('public/preview/geo3d/src/data-source.js'),/Water: simulated\./);
});

test('on the map layer the water stays in its channel and keeps moving', () => {
 const map=pickChannels(coarseBed(raw,fine,GRID,sampleHeights),GRID,2,{carve:0,minDrop:.005,confine:true,towards:{x:19,z:-32.5}});
 const sim=new ChannelSimulation(GRID,map.bed,map.sources);
 for(let i=0;i<3600;i++)sim.step(1/60);
 assert.equal(sim.metrics().nonfinite,0);
 assert.ok(sim.metrics().wetCells<960*.2,`wet cells ${sim.metrics().wetCells}`);
 const cells=map.paths[0].cells,before=cells.map(k=>sim.h[k]);
 for(let i=0;i<120;i++)sim.step(1/60);
 assert.ok(Math.max(...cells.map((k,q)=>Math.abs(sim.h[k]-before[q])))>.02,'depth changes over 2 s');
 const mask=ribbonMask(raw,fine,map.lines);
 assert.ok(mask.every(Number.isFinite));
 assert.ok(mask.filter((m,k)=>m<raw[k]+1).length<mask.length*.6,'water is clipped to a ribbon');
});

test('the drainage network finds a valley and cuts channels along it', () => {
 const w=120,h=120,metres=new Float32Array(w*h);
 // A valley running down the middle of a slope, with a pit that must not trap the flow.
 for(let j=0;j<h;j++)for(let i=0;i<w;i++)metres[j*w+i]=500-j*.5+Math.abs(i-60)*.8;
 metres[60*w+60]-=25;
 const net=drainageNetwork(metres,w,h),cuts=carveField(net),chains=streamChains(net,()=>true);
 assert.ok(net.area[(h-1)*w+60]>2000,'the valley collects the slope');
 assert.ok(chains.length>0);
 const columns=chains[0].cells.map(k=>k%w);
 assert.ok(Math.max(...columns.map(c=>Math.abs(c-60)))<=2,'the channel follows the valley floor');
 assert.ok(cuts[100*w+60]>=5,'the valley floor is cut');
 assert.equal(cuts[100*w+5],0,'the hillside is left alone');
 for(let k=0;k<w*h;k++)if(net.receiver[k]>=0)assert.ok(net.filled[net.receiver[k]]<net.filled[k]);
 assert.equal(sampleField(cuts,w,h,-1,5),0);
 // Ground that rises along the channel gets cut deeper, so the floor still runs downhill.
 const bumpy=Float32Array.from(metres);for(let i=50;i<=70;i++)bumpy[85*w+i]+=20;
 const floors=carveField(net,bumpy);
 assert.ok(floors[85*w+60]>cuts[85*w+60]+5,'the rise is cut through');
 const a=withWander(metres,w,h),b=withWander(metres,w,h);
 assert.deepEqual(a,b,'the wander is the same on every load');
 assert.ok(a.some((v,k)=>v!==metres[k])&&Math.max(...a.map((v,k)=>Math.abs(v-metres[k])))<=10,'it stays small');
});

test('solver channels connect edge to edge, with banks everywhere else', () => {
 const line=[];for(let q=0;q<=20;q++)line.push({x:-5+q*2,z:-70+q*4,level:12-q*.1});
 const {bed,sources}=channelsFromLines([line],raw,fine,GRID,sampleHeights,[2000]);
 assert.ok(sources.length>=1);
 const sim=new ChannelSimulation(GRID,bed,sources);
 for(let i=0;i<3600;i++)sim.step(1/60);
 const m=sim.metrics();
 assert.equal(m.nonfinite,0);assert.ok(m.wetCells>10,`wet ${m.wetCells}`);assert.ok(m.wetCells<960*.45,`wet ${m.wetCells}`);
});

test('measured road heights decide whether water covers a road', () => {
 const anchors=parseRoadHeights(JSON.parse(read('public/inundation/road-heights.json')));
 assert.ok(anchors.length>=5,`${anchors.length} measured crossings`);
 for(const a of anchors){assert.ok(a.lat>32&&a.lat<33&&a.lon<-110&&a.lon>-112,a.id);assert.ok(Number.isFinite(a.aboveBedM),a.id);}
 const low=anchors.find(a=>a.id==='west-avra-valley-road-32-39322-111-29459'),deck=anchors.find(a=>a.id==='west-avra-valley-road-32-40256-111-14614');
 assert.equal(low.lat,32.39322);assert.equal(low.lon,-111.29459);assert.equal(low.aboveBedM,.3);assert.equal(deck.deck,true);
 assert.equal(roadCovered(low.aboveBedM,1),true,'a dip 0.3 m above the bed goes under 1 m of water');
 assert.equal(roadCovered(deck.aboveBedM,1),false,'a deck 8 m up stays dry');
 assert.equal(anchorLift(0,0,[{x:0,y:0,aboveBedM:3,deck:false}],2),6,'at-grade heights apply at the map exaggeration');
 assert.equal(anchorLift(0,0,[{x:0,y:0,aboveBedM:3,deck:true}],2),0,'a deck is not lifted as ground');
 assert.equal(anchorLift(500,0,[{x:0,y:0,aboveBedM:3,deck:false}],2),0);
});

test('road models have thickness, and bridges span the ground below them', () => {
 const valley=(x)=>100-Math.max(0,60-Math.abs(x-200));
 const road=buildRoadMesh([{cls:'motorway',bridge:false,points:[[0,0],[400,0]]}],(x)=>valley(x));
 const bridge=buildRoadMesh([{cls:'primary',bridge:true,points:[[0,0],[400,0]]}],(x)=>valley(x));
 const zs=m=>{const z=[];for(let i=2;i<m.positions.length;i+=3)z.push(m.positions[i]);return z;};
 assert.ok(Math.min(...zs(road))<75,'an ordinary road follows the ground down');
 const tops=[];for(let i=0;i<bridge.positions.length;i+=3)if(Math.abs(bridge.positions[i]-200)<40)tops.push(bridge.positions[i+2]);
 assert.ok(Math.max(...tops)>=100,'the deck stays up at the abutment height');
 assert.ok(Math.min(...zs(bridge))<85,'piers reach down to the ground under the deck');
 assert.ok(Math.max(...road.indices)<road.positions.length/3);
 assert.equal(buildRoadMesh([{cls:'minor',points:[[0,0],[10,0]]}],()=>null).positions.length,0,'no terrain yet means no road yet');
});

test('the water window stays in the area and follows crossings', () => {
 const crossings=[{lat:32.33,lon:-111.2,name:'A'},{lat:32.43,lon:-111.28,name:'B'}];
 assert.equal(chooseWindow({lat:32.33,lon:-111.2,zoom:9},crossings,null).action,'hide');
 assert.equal(chooseWindow({lat:33.4,lon:-112,zoom:13},crossings,null).action,'hide');
 const first=chooseWindow({lat:32.331,lon:-111.201,zoom:13},crossings,null);
 assert.equal(first.action,'move');assert.equal(first.target.name,'A');
 assert.equal(chooseWindow({lat:32.332,lon:-111.202,zoom:13},crossings,first.target).action,'stay');
 assert.equal(chooseWindow({lat:32.43,lon:-111.28,zoom:13},crossings,first.target).target.name,'B');
 const far=chooseWindow({lat:32.25,lon:-111,zoom:13},crossings,null);
 assert.equal(far.action,'move');assert.equal(far.target.name,'');
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
