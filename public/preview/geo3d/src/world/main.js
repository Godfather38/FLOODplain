// SFINCS model runs in a 3D world the page owns: one height field, one surface for ground and
// water, the street map painted into it, bridges and buildings standing on it, the run's rain
// falling where its rainfall input says, and the app's routes and crossings on top.
import * as THREE from 'three/webgpu';
import {MapControls} from 'three/addons/controls/MapControls.js';
import {makeNoiseTexture} from '../../../coastal-lowcost/src/noise.js?v=1.3.0';
import * as config from '../../../../config.js';
import {parseFrames} from '../run-data.js';
import {parseRoadHeights} from '../road-heights.js';
import {toUtm,fromUtm} from '../utm.js';
import {buildHeights,groundSampler,levelGrid,shareGrid,levelSampler,modelCells,toWorld,worldToUtm,SIZE_X,SIZE_Z} from './heights.js';
import {createLabels} from './labels.js';
import {loadVectorTile,tileRange} from './tiles.js';
import {createSurface} from './surface.js';
import {createChunks} from './chunks.js';
import {routeOverlay} from './paint.js';
import {parseRain,rainAt,createRain} from './rain.js';
import {createRoutesUI} from './routes-ui.js';
import {mountAcknowledgement} from '../acknowledge.js';
const $=id=>document.getElementById(id);
const DATA='../../../../simulation/data/',E=2,SHOW_DEPTH_M=.05,HOUR_SECONDS=4;
// The saved runs to choose from. Both share the model's grid and terrain.
const RUNS=[
 {id:'13z',label:'Nov 1, 13Z forecast run',note:'Rain shown from this run\'s rainfall input.',display:'frozen-terrain-display.json.gz',rain:'frozen-map-context.json'},
 {id:'19z',label:'Nov 1, 19Z forecast run (more water)',note:'Rain shown from this run\'s rainfall input (HRRR 19Z forecast). Its heaviest rain, Nov 1 9–10 AM MST, fell before the first saved water hour.',display:'sfincs-current-coarse-20261101-19z-41350254061-map/frozen-terrain-display.json.gz',rain:'sfincs-current-coarse-20261101-19z-41350254061-map/rainfall.json'},
 {id:'stress',label:'Stress test: 100-year storm with a record river',note:'A what-if run of the same model, not a forecast: the 19Z run\'s ground conditions, then NOAA Atlas 14\'s 100-year 6-hour storm (2.8 in, 2.2 in in the peak hour) on every cell from 5 PM MST, and the Santa Cruz rising to its 1983 record flow (65,000 cfs) at 10 PM.',display:'sfincs-stress-storm-41633261576-map/frozen-terrain-display.json.gz',rain:'sfincs-stress-storm-41633261576-map/rainfall.json'},
 {id:'extreme',label:'Extreme what-if: 1,000-year storm, twice the record river',note:'A deliberately extreme what-if run of the same model, far beyond anything on record and not a forecast: the 19Z run\'s ground conditions, then NOAA Atlas 14\'s 1,000-year 6-hour storm (4.0 in, 3.0 in in the peak hour) on every cell from 5 PM MST, and the Santa Cruz at twice its 1983 record flow (130,000 cfs) at 10 PM.',display:'sfincs-extreme-storm-41635232621-map/frozen-terrain-display.json.gz',rain:'sfincs-extreme-storm-41635232621-map/rainfall.json'},
];
const diagnostics={ready:false,errors:[],frameTimes:[]};
const fail=error=>{diagnostics.errors.push(String(error?.stack||error));$('error').hidden=false;$('error-detail').textContent=String(error?.message||error);};
window.addEventListener('error',e=>fail(e.error||e.message));window.addEventListener('unhandledrejection',e=>fail(e.reason));
mountAcknowledgement();
const status=text=>{$('window').textContent=text;};
async function fetchMaybeGzip(path){
 const response=await fetch(new URL(path,import.meta.url));
 if(!response.ok)throw new Error(`${path} answered ${response.status}`);
 const bytes=new Uint8Array(await response.arrayBuffer());
 // Some hosts send .gz files already unpacked.
 if(bytes[0]!==0x1f||bytes[1]!==0x8b)return bytes;
 return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
}
const json=async path=>JSON.parse(new TextDecoder().decode(await fetchMaybeGzip(path)));
status('Loading the model terrain');
const terrainBytes=await fetchMaybeGzip(DATA+'frozen-voxel-terrain.f32.gz');
const firstRun=RUNS.find(r=>r.id===new URLSearchParams(location.search).get('run'))??RUNS[0];
const [firstDisplay,routes,measured]=await Promise.all([json(DATA+firstRun.display),fetch(new URL('../../../../data/routes.geojson',import.meta.url)).then(r=>{if(!r.ok)throw new Error('Routes answered '+r.status);return r.json();}),fetch(new URL('../../../../inundation/road-heights.json',import.meta.url)).then(r=>{if(!r.ok)throw new Error('Road heights answered '+r.status);return r.json();}).then(parseRoadHeights)]);
const data={vertices:firstDisplay.vertices,terrain:new Float32Array(terrainBytes.buffer,terrainBytes.byteOffset,terrainBytes.byteLength/4)};
status('Joining the terrain');
const {heights,filled}=await buildHeights(data),ground=groundSampler(heights);
const world=(lon,lat)=>{const u=toUtm(lon,lat);return toWorld(u.e,u.n);};
const toLonLat=(x,z)=>{const u=worldToUtm(x,z);return fromUtm(u.e,u.n);};
const inside=(x,z)=>Math.abs(x)<SIZE_X/2&&Math.abs(z)<SIZE_Z/2;
// A run, prepared for drawing and for the crossing sheets.
async function prepareRun(def,display){
 display??=await json(DATA+def.display);
 const frames=parseFrames(display),levels=frames.map(f=>levelGrid(f,data.vertices));
 return{def,frames,levels,shares:frames.map(f=>shareGrid(f,data,SHOW_DEPTH_M)),samplers:levels.map(levelSampler),measured,rain:def.rain?parseRain(await json(DATA+def.rain)):null};
}
let run=await prepareRun(firstRun,firstDisplay);
const renderer=new THREE.WebGPURenderer({antialias:true,forceWebGL:true,logarithmicDepthBuffer:true,powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.setSize(innerWidth,innerHeight);renderer.toneMapping=THREE.NoToneMapping;
await renderer.init();$('map').appendChild(renderer.domElement);
const scene=new THREE.Scene();scene.background=new THREE.Color('#cfe2ec');scene.fog=new THREE.Fog('#cfe2ec',14000,60000);
const camera=new THREE.PerspectiveCamera(45,innerWidth/innerHeight,2,200000);
const surface=createSurface({heights,levelA:run.levels[0],levelB:run.levels[1],shareA:run.shares[0],shareB:run.shares[1],noise:makeNoiseTexture(),exaggeration:E,showDepth:SHOW_DEPTH_M});
const structureMaterial=new THREE.MeshBasicNodeMaterial({vertexColors:true,side:THREE.DoubleSide});
// The app's routes, painted into the ground; the chosen area's routes stand out.
routeOverlay.lines=routes.features.map(f=>({id:f.properties.id,area:f.properties.area,parts:(f.geometry.type==='MultiLineString'?f.geometry.coordinates:[f.geometry.coordinates]).map(line=>line.map(([lon,lat])=>world(lon,lat)))}));
const chunks=createChunks(scene,surface.make(),{ground,E,structureMaterial});
// Start over the Santa Cruz River at the Avra Valley Road bridge.
const [sx,sz]=world(-111.1462,32.4026),sy=ground(sx,sz)*E;
const controls=new MapControls(camera,renderer.domElement);
controls.target.set(sx,sy,sz);camera.position.set(sx-900,sy+1500,sz+1700);
controls.enableDamping=true;controls.dampingFactor=.08;controls.maxPolarAngle=Math.PI*.46;controls.minDistance=120;controls.maxDistance=60000;controls.zoomToCursor=true;
controls.update();
// The orbit point rides on the ground so turning and zooming stay anchored to the land.
function followGround(){const g=ground(controls.target.x,controls.target.z)*E;if(Number.isFinite(g)){const dy=g-controls.target.y;controls.target.y+=dy;camera.position.y+=dy;}}
let playing=true,clock=0,frameIndex=-1,last=performance.now(),flight=null;
function flyTo(x,z,distance=1600){
 const from={t:controls.target.clone(),c:camera.position.clone()},y=ground(x,z)*E,dir=camera.position.clone().sub(controls.target);dir.setLength(distance);
 flight={start:performance.now(),from,to:{t:new THREE.Vector3(x,y,z),c:new THREE.Vector3(x,y,z).add(dir)}};
}
function flyStep(now){
 if(!flight)return;const k=Math.min(1,(now-flight.start)/1400),e=k*k*(3-2*k);
 controls.target.lerpVectors(flight.from.t,flight.to.t,e);camera.position.lerpVectors(flight.from.c,flight.to.c,e);if(k===1)flight=null;
}
// --- Routes, crossing pins and crossing sheets ---
const appHref=(routeId,id)=>new URL(`../../../../index.html#/r/${routeId}/${id}`,import.meta.url).href;
const modelled=modelCells(data.vertices);
const routesUI=createRoutesUI({root:$('map'),camera,config,routes,world,inside:modelled,ground,E,appHref,flyTo,onRoutes:(area,route)=>{routeOverlay.area=area;routeOverlay.route=route;chunks.repaint();}});
routesUI.setRun(run);
// --- Rain ---
const rain=createRain(scene,{toLonLat,E});
let rainOn=true;
$('rain').onchange=e=>{rainOn=e.target.checked;};
function frameTime(){const i=Math.min(run.frames.length-2,Math.floor(clock));return Date.parse(run.frames[i].time)+(clock-i)*3600e3;}
// --- Time and runs ---
function showFrame(i){
 const next=Math.min(run.frames.length-1,i+1);surface.setLevels(run.levels[i],run.levels[next],run.shares[i],run.shares[next]);frameIndex=i;
 const label=new Date(run.frames[i].time).toLocaleString('en-US',{timeZone:'America/Phoenix',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
 $('time').textContent=`${label} MST`;$('scrub').value=String(i);routesUI.setFrame(i);
}
function describeRun(){$('run-note').textContent=run.def.note;$('rain').disabled=!run.rain;$('scrub').max=String(run.frames.length-1);}
$('run').innerHTML=RUNS.map(r=>`<option value="${r.id}"${r===run.def?' selected':''}>${r.label}</option>`).join('');
$('run').onchange=async e=>{
 const def=RUNS.find(r=>r.id===e.target.value);$('run').disabled=true;status('Loading '+def.label);
 try{run=await prepareRun(def);routesUI.setRun(run);clock=0;frameIndex=-1;describeRun();status(`${def.label}: ${run.frames.length} hours.`);}
 catch(error){fail(error);}finally{$('run').disabled=false;}
};
describeRun();
$('play').onclick=()=>{playing=!playing;$('play').textContent=playing?'Pause':'Play';};
$('scrub').oninput=e=>{playing=false;$('play').textContent='Play';clock=Number(e.target.value);};
addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});
// --- Names, Go to and compass ---
const labels=createLabels($('map'),camera,ground,E),places=[];
for(const fp of config.FAILURE_POINTS){const [x,z]=world(fp.lon,fp.lat);if(modelled(x,z))places.push({name:fp.name,x,z,kind:'Crossing',id:fp.id});}
(async()=>{
 const seen=new Set(),once=key=>{if(seen.has(key))return false;seen.add(key);return true;};
 const tiles=await Promise.all(tileRange(-SIZE_X/2,-SIZE_Z/2,SIZE_X/2,SIZE_Z/2,12,toLonLat).map(t=>loadVectorTile(t).catch(()=>null)));
 const middle=parts=>{const line=parts.reduce((a,b)=>b.length>a.length?b:a,[]);return line[line.length>>1];};
 for(const t of tiles){if(!t)continue;
  for(const f of t.layers.place??[]){const p=f.parts[0]?.[0],name=f.properties.name;if(!p||!name||!inside(...p)||!once('p'+name))continue;const big=['city','town'].includes(f.properties.class);labels.add(name,p[0],p[1],{kind:'place',priority:big?5:4,reach:big?70000:30000,lift:20});places.push({name,x:p[0],z:p[1],kind:'Place'});}
  for(const f of t.layers.transportation_name??[]){const name=f.properties.name,cls=f.properties.class;if(!name||!['motorway','trunk','primary','secondary'].includes(cls))continue;const p=middle(f.parts);if(!p||!inside(...p)||!once('r'+name+Math.round(p[0]/3000)+','+Math.round(p[1]/3000)))continue;labels.add(name,p[0],p[1],{kind:'road',priority:cls==='motorway'?2.5:2,reach:cls==='motorway'?25000:12000});}
  for(const f of t.layers.waterway??[]){const name=f.properties.name;if(!name)continue;const p=middle(f.parts);if(!p||!inside(...p)||!once('w'+name+Math.round(p[0]/4000)+','+Math.round(p[1]/4000)))continue;labels.add(name,p[0],p[1],{kind:'wash',priority:1.5,reach:10000});}
 }
 fillGoTo();
})().catch(e=>console.warn('labels',e));
function fillGoTo(){
 $('goto').innerHTML='<option value="">Go to…</option>'+['Crossing','Place'].map(kind=>`<optgroup label="${kind==='Place'?'Places':'Safety-screen crossings'}">${places.filter(p=>p.kind===kind).sort((a,b)=>a.name.localeCompare(b.name)).map(p=>`<option value="${places.indexOf(p)}">${p.name}</option>`).join('')}</optgroup>`).join('');
}
fillGoTo();
$('goto').onchange=e=>{const p=places[Number(e.target.value)];if(p){flyTo(p.x,p.z,p.kind==='Crossing'?900:1600);if(p.id)routesUI.openDetail(p.id);}e.target.value='';};
// The compass turns the view back to north up, keeping the same distance and tilt.
$('north').onclick=()=>{const t=controls.target,d=camera.position.clone().sub(t),flat=Math.hypot(d.x,d.z);flight={start:performance.now(),from:{t:t.clone(),c:camera.position.clone()},to:{t:t.clone(),c:new THREE.Vector3(t.x,camera.position.y,t.z+flat)}};};
const needle=$('north').querySelector('span');
setInterval(()=>{const d=camera.position.clone().sub(controls.target);needle.style.transform=`rotate(${Math.atan2(-d.x,d.z)*180/Math.PI}deg)`;},100);
// --- The frame loop, started once everything it touches exists ---
showFrame(0);
let rainNow=0;
renderer.setAnimationLoop(()=>{
 const now=performance.now(),dt=Math.max(0,Math.min(200,now-last)),span=run.frames.length-1;last=now;
 if(playing)clock=((clock+dt/1000/HOUR_SECONDS)%span+span)%span;
 const i=Math.min(span-1,Math.floor(clock));if(i!==frameIndex)showFrame(i);
 surface.U.alpha.value=clock-i;surface.U.time.value=now/1000;
 controls.update();followGround();flyStep(now);chunks.update(camera);labels.update();routesUI.update();
 rainNow=rain.update(dt/1000,{rain:run.rain,time:frameTime(),target:controls.target,cameraDistance:camera.position.distanceTo(controls.target),groundAt:ground,enabled:rainOn});
 renderer.render(scene,camera);
 diagnostics.frameTimes.push(dt);if(diagnostics.frameTimes.length>600)diagnostics.frameTimes.shift();
});
diagnostics.ready=true;
status(`${run.def.label}: ${run.frames.length} hours over the model's 10 m lidar terrain.`);
setInterval(()=>{
 const t=diagnostics.frameTimes.slice(-120),s=chunks.stats(),c=toLonLat(controls.target.x,controls.target.z),here=run.rain?rainAt(run.rain,frameTime(),c.lon,c.lat):null;
 $('rain-now').textContent=run.rain?(here>.05?`${here.toFixed(1)} mm/h at the view centre this hour`:'No rain at the view centre this hour'):'';
 if(t.length)$('metrics').textContent=`${(1000/(t.reduce((a,b)=>a+b,0)/t.length)).toFixed(1)} FPS · ${s.painted}/${s.chunks} areas mapped`;
},500);
window.world={renderer,scene,camera,controls,chunks,diagnostics,ground,filled,labels,places,flyTo,routesUI,get run(){return run;},setClock:v=>{playing=false;clock=v;},get frameIndex(){return frameIndex;}};
