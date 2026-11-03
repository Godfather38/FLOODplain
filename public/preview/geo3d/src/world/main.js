// The saved SFINCS run in a 3D world the page owns: one height field, one surface for ground
// and water, the street map painted into it, bridges and buildings standing on it.
import * as THREE from 'three/webgpu';
import {MapControls} from 'three/addons/controls/MapControls.js';
import {makeNoiseTexture} from '../../../coastal-lowcost/src/noise.js?v=1.3.0';
import {parseFrames} from '../run-data.js';
import {toUtm} from '../utm.js';
import {buildHeights,groundSampler,levelGrid,shareGrid,toWorld,worldToUtm,SIZE_X,SIZE_Z} from './heights.js';
import {fromUtm} from '../utm.js';
import {createLabels} from './labels.js';
import {loadVectorTile,tileRange} from './tiles.js';
import {createSurface} from './surface.js';
import {createChunks} from './chunks.js';
import {mountAcknowledgement} from '../acknowledge.js';
const $=id=>document.getElementById(id);
const RUN='../../../../simulation/data/',E=2,SHOW_DEPTH_M=.05,HOUR_SECONDS=4;
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
status('Loading the saved SFINCS run and its terrain');
const [displayBytes,terrainBytes]=await Promise.all([fetchMaybeGzip(RUN+'frozen-terrain-display.json.gz'),fetchMaybeGzip(RUN+'frozen-voxel-terrain.f32.gz')]);
const display=JSON.parse(new TextDecoder().decode(displayBytes));
const data={vertices:display.vertices,terrain:new Float32Array(terrainBytes.buffer,terrainBytes.byteOffset,terrainBytes.byteLength/4)};
const frames=parseFrames(display),levels=frames.map(f=>levelGrid(f,data.vertices)),shares=frames.map(f=>shareGrid(f,data,SHOW_DEPTH_M));
status('Joining the terrain');
const {heights,filled}=await buildHeights(data),ground=groundSampler(heights);
const renderer=new THREE.WebGPURenderer({antialias:true,forceWebGL:true,logarithmicDepthBuffer:true,powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.setSize(innerWidth,innerHeight);renderer.toneMapping=THREE.NoToneMapping;
await renderer.init();$('map').appendChild(renderer.domElement);
const scene=new THREE.Scene();scene.background=new THREE.Color('#cfe2ec');scene.fog=new THREE.Fog('#cfe2ec',14000,60000);
const camera=new THREE.PerspectiveCamera(45,innerWidth/innerHeight,2,200000);
const surface=createSurface({heights,levelA:levels[0],levelB:levels[1],shareA:shares[0],shareB:shares[1],noise:makeNoiseTexture(),exaggeration:E,showDepth:SHOW_DEPTH_M});
const structureMaterial=new THREE.MeshBasicNodeMaterial({vertexColors:true,side:THREE.DoubleSide});
const chunks=createChunks(scene,surface.make(),{ground,E,structureMaterial});
// Start over the Santa Cruz River at the I-10 crossing near Rillito.
const start=toUtm(-111.1462,32.4026),[sx,sz]=toWorld(start.e,start.n),sy=ground(sx,sz)*E;
const controls=new MapControls(camera,renderer.domElement);
controls.target.set(sx,sy,sz);camera.position.set(sx-900,sy+1500,sz+1700);
controls.enableDamping=true;controls.dampingFactor=.08;controls.maxPolarAngle=Math.PI*.46;controls.minDistance=120;controls.maxDistance=60000;controls.zoomToCursor=true;
controls.update();
// The orbit point rides on the ground so turning and zooming stay anchored to the land.
function followGround(){const g=ground(controls.target.x,controls.target.z)*E;if(Number.isFinite(g)){const dy=g-controls.target.y;controls.target.y+=dy;camera.position.y+=dy;}}
let playing=true,clock=0,frameIndex=-1,last=performance.now();
function showFrame(i){
 const next=Math.min(frames.length-1,i+1);surface.setLevels(levels[i],levels[next],shares[i],shares[next]);frameIndex=i;
 const label=new Date(frames[i].time).toLocaleString('en-US',{timeZone:'America/Phoenix',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
 $('time').textContent=`${label} MST`;$('scrub').value=String(i);
}
$('scrub').max=String(frames.length-1);
$('play').onclick=()=>{playing=!playing;$('play').textContent=playing?'Pause':'Play';};
$('scrub').oninput=e=>{playing=false;$('play').textContent='Play';clock=Number(e.target.value);};
addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});
showFrame(0);
// Started once everything it touches exists.
const tick=(()=>{
 const now=performance.now(),dt=Math.max(0,Math.min(200,now-last)),span=frames.length-1;last=now;
 if(playing)clock=((clock+dt/1000/HOUR_SECONDS)%span+span)%span;
 const i=Math.min(span-1,Math.floor(clock));if(i!==frameIndex)showFrame(i);
 surface.U.alpha.value=clock-i;surface.U.time.value=now/1000;
 controls.update();followGround();flyStep(now);chunks.update(camera);labels.update();
 renderer.render(scene,camera);
 diagnostics.frameTimes.push(dt);if(diagnostics.frameTimes.length>600)diagnostics.frameTimes.shift();
});
// --- Finding your way: names, crossing pins, a Go to list and a compass ---
const labels=createLabels($('map'),camera,ground,E),places=[];
const toLonLat=(x,z)=>{const u=worldToUtm(x,z);return fromUtm(u.e,u.n);};
const inside=(x,z)=>Math.abs(x)<SIZE_X/2&&Math.abs(z)<SIZE_Z/2;
const crossingsResponse=await fetch(new URL('../../../../data/crossings.geojson',import.meta.url),{cache:'no-store'});
if(!crossingsResponse.ok)throw new Error('Crossings answered '+crossingsResponse.status);
for(const f of (await crossingsResponse.json()).features){
 const [lon,lat]=f.geometry.coordinates,u=toUtm(lon,lat),[x,z]=toWorld(u.e,u.n);if(!inside(x,z))continue;
 const name=`${f.properties.road.replace(/^(North|South|East|West) /,'')} at ${f.properties.water||'a wash'}`;
 labels.add(name,x,z,{kind:'crossing',priority:3,reach:9000});places.push({name,x,z,kind:'Crossing'});
}
(async()=>{
 const seen=new Set(),once=(key)=>{if(seen.has(key))return false;seen.add(key);return true;};
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
 const list=$('goto');list.innerHTML='<option value="">Go to…</option>'+['Place','Crossing'].map(kind=>`<optgroup label="${kind==='Place'?'Places':'Route crossings'}">${places.filter(p=>p.kind===kind).sort((a,b)=>a.name.localeCompare(b.name)).map(p=>`<option value="${places.indexOf(p)}">${p.name}</option>`).join('')}</optgroup>`).join('');
}
fillGoTo();
let flight=null;
function flyTo(x,z,distance=1600){
 const from={t:controls.target.clone(),c:camera.position.clone()},y=ground(x,z)*E,dir=camera.position.clone().sub(controls.target);dir.setLength(distance);
 flight={start:performance.now(),from,to:{t:new THREE.Vector3(x,y,z),c:new THREE.Vector3(x,y,z).add(dir)}};
}
function flyStep(now){
 if(!flight)return;const k=Math.min(1,(now-flight.start)/1400),e=k*k*(3-2*k);
 controls.target.lerpVectors(flight.from.t,flight.to.t,e);camera.position.lerpVectors(flight.from.c,flight.to.c,e);if(k===1)flight=null;
}
$('goto').onchange=e=>{const p=places[Number(e.target.value)];if(p)flyTo(p.x,p.z);e.target.value='';};
// The compass turns the view back to north up, keeping the same distance and tilt.
$('north').onclick=()=>{const t=controls.target,d=camera.position.clone().sub(t),flat=Math.hypot(d.x,d.z);flight={start:performance.now(),from:{t:t.clone(),c:camera.position.clone()},to:{t:t.clone(),c:new THREE.Vector3(t.x,camera.position.y,t.z+flat)}};};
const needle=$('north').querySelector('span');
setInterval(()=>{const d=camera.position.clone().sub(controls.target);needle.style.transform=`rotate(${Math.atan2(-d.x,d.z)*180/Math.PI}deg)`;},100);
renderer.setAnimationLoop(tick);
diagnostics.ready=true;
status(`Saved SFINCS run over ${(data.vertices.length/100).toFixed(0)} km² of the model's 10 m lidar terrain.`);
setInterval(()=>{const t=diagnostics.frameTimes.slice(-120),s=chunks.stats();if(t.length)$('metrics').textContent=`${(1000/(t.reduce((a,b)=>a+b,0)/t.length)).toFixed(1)} FPS · ${s.painted}/${s.chunks} areas mapped · detail ${s.levels.join('/')}`;},1000);
window.world={renderer,scene,camera,controls,chunks,diagnostics,frames,ground,filled,labels,places,flyTo,setClock:v=>{playing=false;clock=v;},get frameIndex(){return frameIndex;}};
