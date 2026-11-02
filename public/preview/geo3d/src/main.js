import {TRIAL} from '../../coastal-lowcost/src/trial-config.js';
import * as THREE from 'three/webgpu';
import {GRID} from '../../coastal-lowcost/src/coast.js?v=1.3.0';
import {makeNoiseTexture} from '../../coastal-lowcost/src/noise.js?v=1.3.0';
import {createShading} from '../../coastal-lowcost/src/shading.js?v=1.3.0';
import {FrameProfile,summarize} from '../../coastal-lowcost/src/performance.js?v=1.3.0';
import {SCENE,fineGrid} from './scene-config.js';
import {sceneHeights,sampleHeights} from './elevation.js';
import {loadSceneData} from './data-source.js';
import {coarseBed,pickChannels,carveFine} from './channels.js';
import {visibleRoadRuns,ribbonMesh} from './roads.js';
const $=id=>document.getElementById(id);
const params=new URLSearchParams(location.search),profile=new FrameProfile();
const diagnostics={ready:false,errors:[],frameTimes:[],backend:null,buffer:null,interpolationHoldFrames:0};
let renderer,worker,shaders,paused=false,simTime=0,previousTime=0,renderClock=0,pending=null,last=performance.now(),source=null,roadCount=0;
const fail=error=>{diagnostics.ready=false;diagnostics.errors.push(String(error?.stack||error));renderer?.setAnimationLoop(null);$('loading').hidden=true;$('error').hidden=false;$('error-detail').textContent=String(error?.message||error);};
window.addEventListener('error',e=>fail(e.error||e.message));window.addEventListener('unhandledrejection',e=>fail(e.reason));
const makeField=()=>{const t=new THREE.DataTexture(new Float32Array(GRID.nx*GRID.nz*4),GRID.nx,GRID.nz,THREE.RGBAFormat,THREE.FloatType);t.minFilter=t.magFilter=THREE.LinearFilter;t.needsUpdate=true;return t;};
const fields={surface:makeField(),previous:makeField(),material:makeField(),previousMaterial:makeField(),flow:makeField(),previousFlow:makeField()};
function resize(){
 const w=innerWidth,h=innerHeight,landscape=w>=h;
 // The buffer limits the demo ran with on the owner's Pixel 8 and mini PC.
 const ratio=Math.min(devicePixelRatio,TRIAL.dprCap,(landscape?TRIAL.bufferLong:TRIAL.bufferShort)/w,(landscape?TRIAL.bufferShort:TRIAL.bufferLong)/h);
 renderer.setPixelRatio(ratio);renderer.setSize(w,h);diagnostics.buffer=[renderer.domElement.width,renderer.domElement.height];
}
// sideways/down rows hang a skirt off the edge, so the terrain reads as a solid block.
function terrainGeometry(fine,heights,floor){
 const nx=fine.nx+2,nz=fine.nz+2,positions=new Float32Array(nx*nz*3),indices=new Uint32Array((nx-1)*(nz-1)*6);
 let w=0;
 for(let j=0;j<nz;j++)for(let i=0;i<nx;i++){
  const a=Math.max(0,Math.min(fine.nx-1,i-1)),b=Math.max(0,Math.min(fine.nz-1,j-1)),k=(j*nx+i)*3,skirt=i===0||j===0||i===nx-1||j===nz-1;
  positions[k]=fine.x0+a*fine.dx;positions[k+1]=skirt?floor:heights[b*fine.nx+a];positions[k+2]=fine.z0+b*fine.dz;
  if(i<nx-1&&j<nz-1){const p=j*nx+i,q=p+1,r=p+nx,s=r+1;indices[w++]=p;indices[w++]=r;indices[w++]=q;indices[w++]=q;indices[w++]=r;indices[w++]=s;}
 }
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(positions,3));g.setIndex(new THREE.BufferAttribute(indices,1));g.computeVertexNormals();return g;
}
function waterGeometry(fine,heights){
 const positions=new Float32Array(fine.nx*fine.nz*3),indices=new Uint32Array((fine.nx-1)*(fine.nz-1)*6);
 let w=0;
 for(let j=0;j<fine.nz;j++)for(let i=0;i<fine.nx;i++){
  const k=(j*fine.nx+i)*3;positions[k]=fine.x0+i*fine.dx;positions[k+2]=fine.z0+j*fine.dz;
  if(i<fine.nx-1&&j<fine.nz-1){const p=j*fine.nx+i,q=p+1,r=p+fine.nx,s=r+1;indices[w++]=p;indices[w++]=r;indices[w++]=q;indices[w++]=q;indices[w++]=r;indices[w++]=s;}
 }
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(positions,3));g.setAttribute('sandHeight',new THREE.BufferAttribute(heights,1));g.setIndex(new THREE.BufferAttribute(indices,1));g.computeBoundingSphere();return g;
}
function buildScene(scene,fine,heights,runs,roadHeights){
 let top=-Infinity;for(const h of heights)top=Math.max(top,h);
 const terrain=new THREE.Mesh(terrainGeometry(fine,heights,0),shaders.sand);terrain.receiveShadow=terrain.castShadow=true;scene.add(terrain);
 const water=new THREE.Mesh(waterGeometry(fine,heights),shaders.water);water.frustumCulled=false;water.renderOrder=3;scene.add(water);
 // Roads follow the uncut land: the invented channels must not suggest a road floods.
 const {positions,indices}=ribbonMesh(runs,(x,z)=>sampleHeights(roadHeights,fine,x,z));
 const roadGeometry=new THREE.BufferGeometry();roadGeometry.setAttribute('position',new THREE.BufferAttribute(positions,3));roadGeometry.setIndex(new THREE.BufferAttribute(indices,1));roadGeometry.computeBoundingSphere();
 const roads=new THREE.Mesh(roadGeometry,new THREE.MeshBasicNodeMaterial({color:'#2d2c2b',side:THREE.DoubleSide}));roads.renderOrder=2;scene.add(roads);
 const sky=new THREE.Mesh(new THREE.SphereGeometry(4200,32,16),shaders.skyMaterial);sky.renderOrder=-100;sky.frustumCulled=false;scene.add(sky);
 const light=shaders.sunLight,V=SCENE.visible,center=new THREE.Vector3((V.x0+V.x1)/2,top/2,(V.z0+V.z1)/2);
 shaders.U.sun.value.set(-.40,.62,-.46).normalize();
 light.color.set('#fff4e0');light.intensity=2.3;light.target.position.copy(center);light.position.copy(shaders.U.sun.value).multiplyScalar(130).add(center);
 // The land does not move, so one shadow render serves the whole session.
 light.shadow.autoUpdate=false;light.shadow.needsUpdate=true;light.shadow.mapSize.set(1024,1024);
 Object.assign(light.shadow.camera,{left:-75,right:75,top:75,bottom:-75,near:10,far:280});light.shadow.bias=-.0006;light.shadow.normalBias=.08;
 scene.add(light,light.target,new THREE.HemisphereLight('#c4dce9','#908470',1.25));
 scene.fog=new THREE.FogExp2('#b4c5cb',.00064);
 return center;
}
class OrbitView{
 constructor(camera,element,target){
  Object.assign(this,{camera,target,yaw:-2.35,pitch:.62,distance:82,pointers:new Map()});
  element.addEventListener('pointerdown',e=>{element.setPointerCapture(e.pointerId);this.pointers.set(e.pointerId,[e.clientX,e.clientY]);this.spread=null;});
  element.addEventListener('pointermove',e=>{
   const was=this.pointers.get(e.pointerId);if(!was)return;
   this.pointers.set(e.pointerId,[e.clientX,e.clientY]);
   if(this.pointers.size===1){this.yaw-=(e.clientX-was[0])*.005;this.pitch=Math.max(.14,Math.min(1.45,this.pitch+(e.clientY-was[1])*.004));}
   else{const [a,b]=[...this.pointers.values()],spread=Math.hypot(a[0]-b[0],a[1]-b[1]);if(this.spread)this.zoom(this.spread/spread);this.spread=spread;}
  });
  for(const name of ['pointerup','pointercancel'])element.addEventListener(name,e=>{this.pointers.delete(e.pointerId);this.spread=null;});
  element.addEventListener('wheel',e=>{e.preventDefault();this.zoom(Math.exp(Math.max(-100,Math.min(100,e.deltaY))*.0015));},{passive:false});
  this.apply();
 }
 zoom(factor){this.distance=Math.max(14,Math.min(150,this.distance*factor));this.apply();}
 apply(){
  const c=Math.cos(this.pitch);
  this.camera.position.set(this.target.x+Math.sin(this.yaw)*c*this.distance,this.target.y+Math.sin(this.pitch)*this.distance,this.target.z+Math.cos(this.yaw)*c*this.distance);
  this.camera.lookAt(this.target);
 }
 update(){this.apply();}
}
function recycle(p){worker.postMessage({type:'recycle',surface:p.surface,material:p.material,flow:p.flow},[p.surface.buffer,p.material.buffer,p.flow.buffer]);}
function install(data,initial=false){
 const recycled={};
 for(const [key,previous] of [['surface','previous'],['material','previousMaterial'],['flow','previousFlow']]){
  if(initial){fields[key].image.data=data[key];fields[previous].image.data=data[key];fields[key].needsUpdate=fields[previous].needsUpdate=true;}
  else{const spare=fields[previous],old=spare.image.data;fields[previous]=fields[key];fields[key]=spare;spare.image.data=data[key];spare.needsUpdate=true;if(old!==fields[previous].image.data)recycled[key]=old;}
 }
 shaders.bindFields();
 if(recycled.surface&&recycled.material&&recycled.flow)recycle(recycled);
 previousTime=initial?data.time:simTime;simTime=data.time;
 if(initial)renderClock=data.time-.06;
 shaders.U.alpha.value=initial?1:0;shaders.U.time.value=previousTime;
 if(data.metrics)diagnostics.metrics=data.metrics;
 if(data.profile)diagnostics.worker=data.profile;
}
function setPause(value){paused=value;worker?.postMessage({type:'pause',value});if(!value)last=performance.now();}
function refreshPanel(){
 const stats=summarize(diagnostics.frameTimes.slice(-300)),m=diagnostics.worker;
 $('metrics').textContent=[
  `${GRID.nx} × ${GRID.nz} solver · ${diagnostics.backend} · buffer ${(diagnostics.buffer||[]).join(' × ')}`,
  stats?`${(1000/stats.mean).toFixed(1)} FPS · frame p50/p95 ${stats.p50.toFixed(1)} / ${stats.p95.toFixed(1)} ms`:'Waiting for frames…',
  m?`Solver step ${m.stepMeanMs.toFixed(2)} ms · packets ${m.publishHz.toFixed(1)}/20 Hz · warm-up ${(m.warmupMs/1000).toFixed(2)} s`:'',
  `${renderer.info.render.triangles.toLocaleString()} triangles · ${renderer.info.render.drawCalls??renderer.info.render.calls} draw calls · ${roadCount} road pieces`,
 ].filter(Boolean).join('\n');
 $('measure').disabled=!diagnostics.ready||!!profile.run;
}
async function measure(){
 if(paused)setPause(false);
 $('measure').disabled=true;$('report').textContent='Measuring for 30 seconds. Keep this tab in front and leave the view still.';$('report-box').open=true;
 const result=await profile.measure(30,()=>window.geo3d.snapshot());
 result.label='FLOODplain geographic 3D prototype';delete result.proposedGate;diagnostics.benchmark=result;
 $('report').textContent=JSON.stringify(result,null,1);refreshPanel();
}
function frame(now){
 const at=performance.now(),actualMs=now-last;last=now;
 if(!paused){
  renderClock+=actualMs/1000;
  if(pending&&renderClock>=simTime){const next=pending;pending=null;install(next);}
  const alpha=Math.max(0,Math.min(1,(renderClock-previousTime)/Math.max(1e-6,simTime-previousTime)));
  if(alpha>=1)diagnostics.interpolationHoldFrames++;
  shaders.U.alpha.value=alpha;shaders.U.time.value=previousTime+(simTime-previousTime)*alpha;
 }
 window.geo3d.view.update();window.geo3d.camera.updateMatrixWorld();shaders.updateCamera(window.geo3d.camera);
 renderer.render(window.geo3d.scene,window.geo3d.camera);
 profile.record(actualMs,performance.now()-at,renderer);
 diagnostics.frameTimes.push(actualMs);if(diagnostics.frameTimes.length>1200)diagnostics.frameTimes.shift();
}
async function init(){
 if(TRIAL.effects!=='toon'||GRID.nx!==24||GRID.nz!==40)throw new Error('This page must run the Tiny Toon preset.');
 $('progress-text').textContent='Requesting elevation and roads';
 const data=await loadSceneData();source=data.source;
 $('source').textContent=source.label;$('source').dataset.mode=source.mode;
 const fine=fineGrid(),raw=sceneHeights(data.metres),channels=pickChannels(coarseBed(raw,fine,GRID,sampleHeights),GRID),heights=carveFine(raw,fine,channels.lines);
 const runs=visibleRoadRuns(data.routes);roadCount=runs.length;
 if(!runs.length)throw new Error('No production route crosses this area');
 // WebGL 2 is the path the Tiny Toon demo was tried on; ?webgpu=1 opts in to the other.
 renderer=new THREE.WebGPURenderer({antialias:false,forceWebGL:!params.has('webgpu'),powerPreference:'high-performance'});
 resize();renderer.toneMapping=THREE.NeutralToneMapping;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFShadowMap;
 await renderer.init();diagnostics.backend=renderer.backend.isWebGPUBackend?'WebGPU':'WebGL 2';
 $('viewport').appendChild(renderer.domElement);
 const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(50,innerWidth/innerHeight,.5,5000);
 shaders=createShading(makeNoiseTexture(),fields);
 const center=buildScene(scene,fine,heights,runs,raw),view=new OrbitView(camera,renderer.domElement,center);
 window.geo3d={diagnostics,scene,camera,renderer,view,fields,channels,setPause,measure,snapshot:()=>({ready:diagnostics.ready,source,time:simTime,renderTime:shaders.U.time.value,interpolationHoldFrames:diagnostics.interpolationHoldFrames,backend:diagnostics.backend,buffer:diagnostics.buffer,worker:diagnostics.worker,metrics:diagnostics.metrics,errors:diagnostics.errors})};
 window.addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();resize();});
 document.addEventListener('visibilitychange',()=>setPause(document.hidden));
 $('progress-text').textContent='Starting the water simulation';
 worker=new Worker(new URL('./worker.js',import.meta.url),{type:'module'});
 worker.onerror=e=>fail(e.message);
 worker.onmessage=async ({data:message})=>{
  if(message.type==='progress'){$('progress').style.width=`${message.value*100}%`;return;}
  if(message.type==='ready'){
   install(message,true);view.apply();camera.updateMatrixWorld();shaders.updateCamera(camera);
   await renderer.compileAsync(scene,camera);renderer.render(scene,camera);
   diagnostics.ready=true;$('loading').hidden=true;last=performance.now();renderer.setAnimationLoop(frame);
   worker.postMessage({type:'pause',value:document.hidden});paused=document.hidden;
   setInterval(refreshPanel,1000);refreshPanel();
   if(params.has('autobench'))setTimeout(measure,2000);
   return;
  }
  if(pending)recycle(pending);
  pending=message;
 };
 worker.postMessage({type:'init',grid:{...GRID},bed:channels.bed,sources:channels.sources});
}
// One acknowledgement, then out of the way. Blocked storage just means asking again.
const ACK_KEY='geo3d-simulation-ack';
const acknowledged=()=>{try{return localStorage.getItem(ACK_KEY)==='1';}catch{return false;}};
$('simulation-ack').hidden=acknowledged();
$('simulation-ack-ok').onclick=()=>{$('simulation-ack').hidden=true;try{localStorage.setItem(ACK_KEY,'1');}catch{}};
$('measure').onclick=()=>measure().catch(fail);
$('panel').addEventListener('pointerdown',e=>e.stopPropagation());
// On a phone the open panel would cover most of the scene.
if(innerWidth<700)$('panel').querySelector('details').open=false;
init().catch(fail);
