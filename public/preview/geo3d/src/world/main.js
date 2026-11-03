// The saved SFINCS run in a 3D world the page owns: one height field, one surface for ground
// and water, the street map painted into it, bridges and buildings standing on it.
import * as THREE from 'three/webgpu';
import {MapControls} from 'three/addons/controls/MapControls.js';
import {makeNoiseTexture} from '../../../coastal-lowcost/src/noise.js?v=1.3.0';
import {parseFrames} from '../run-data.js';
import {toUtm} from '../utm.js';
import {buildHeights,groundSampler,levelGrid,toWorld} from './heights.js';
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
const frames=parseFrames(display),levels=frames.map(f=>levelGrid(f,data.vertices));
status('Joining the terrain');
const {heights,filled}=await buildHeights(data),ground=groundSampler(heights);
const renderer=new THREE.WebGPURenderer({antialias:true,forceWebGL:true,logarithmicDepthBuffer:true,powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.setSize(innerWidth,innerHeight);renderer.toneMapping=THREE.NoToneMapping;
await renderer.init();$('map').appendChild(renderer.domElement);
const scene=new THREE.Scene();scene.background=new THREE.Color('#cfe2ec');scene.fog=new THREE.Fog('#cfe2ec',14000,60000);
const camera=new THREE.PerspectiveCamera(45,innerWidth/innerHeight,2,200000);
const surface=createSurface({heights,levelA:levels[0],levelB:levels[1],noise:makeNoiseTexture(),exaggeration:E,showDepth:SHOW_DEPTH_M});
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
 const next=Math.min(frames.length-1,i+1);surface.setLevels(levels[i],levels[next]);frameIndex=i;
 const label=new Date(frames[i].time).toLocaleString('en-US',{timeZone:'America/Phoenix',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
 $('time').textContent=`${label} MST`;$('scrub').value=String(i);
}
$('scrub').max=String(frames.length-1);
$('play').onclick=()=>{playing=!playing;$('play').textContent=playing?'Pause':'Play';};
$('scrub').oninput=e=>{playing=false;$('play').textContent='Play';clock=Number(e.target.value);};
addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});
showFrame(0);
renderer.setAnimationLoop(()=>{
 const now=performance.now(),dt=Math.max(0,Math.min(200,now-last)),span=frames.length-1;last=now;
 if(playing)clock=((clock+dt/1000/HOUR_SECONDS)%span+span)%span;
 const i=Math.min(span-1,Math.floor(clock));if(i!==frameIndex)showFrame(i);
 surface.U.alpha.value=clock-i;surface.U.time.value=now/1000;
 controls.update();followGround();chunks.update(camera);
 renderer.render(scene,camera);
 diagnostics.frameTimes.push(dt);if(diagnostics.frameTimes.length>600)diagnostics.frameTimes.shift();
});
diagnostics.ready=true;
status(`Saved SFINCS run over ${(data.vertices.length/100).toFixed(0)} km² of the model's 10 m lidar terrain.`);
setInterval(()=>{const t=diagnostics.frameTimes.slice(-120),s=chunks.stats();if(t.length)$('metrics').textContent=`${(1000/(t.reduce((a,b)=>a+b,0)/t.length)).toFixed(1)} FPS · ${s.painted}/${s.chunks} areas mapped · detail ${s.levels.join('/')}`;},1000);
window.world={renderer,scene,camera,controls,chunks,diagnostics,frames,ground,filled,setClock:v=>{playing=false;clock=v;},get frameIndex(){return frameIndex;}};
