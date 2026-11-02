import {TRIAL,PRESETS} from './trial-config.js';
import * as THREE from 'three/webgpu';
import {GRID} from './coast.js?v=1.3.0';
import {makeNoiseTexture} from './noise.js?v=1.3.0';
import {createShading} from './shading.js?v=1.3.0';
import {buildWorld} from './world.js?v=1.3.0';
import {ShoreCamera,VIEWS} from './camera.js?v=1.3.0';
import {ContactSpray,sampleField} from './spray.js?v=1.3.0';
import {isInterfaceEvent} from './navigation.js?v=1.3.0';
import {FrameProfile,summarize} from './performance.js?v=1.3.0';
import {registerAgentTools} from './agent-tools.js?v=1.3.0';
const profile=new FrameProfile();
const $=id=>document.getElementById(id);
const fallbackURL=new URL(location.href);fallbackURL.searchParams.set('webgl','1');$('webgl-fallback').href=fallbackURL.href;
const diagnostics={ready:false,revision:THREE.REVISION,errors:[],metrics:null,frameTimes:[],backend:null,rendererName:'unknown',trial:TRIAL,interpolationHoldFrames:0};
function fail(error){diagnostics.ready=false;diagnostics.errors.push(String(error?.stack||error));$('loading').hidden=true;$('error').hidden=false;$('error-text').textContent='This experience needs a browser with WebGPU or WebGL 2. Try the alternate renderer below, or open it in a recent desktop browser.';$('error-detail').textContent=String(error?.message||error);}
window.addEventListener('error',e=>{diagnostics.errors.push(e.message);if(!diagnostics.ready)fail(e.error||e.message);});window.addEventListener('unhandledrejection',e=>fail(e.reason));
let renderer,worker,world,shaders,navigation,camera,spray,paused=false,last=performance.now(),busy=false,accumulator=0,simTime=36,previousTime=36,packetAt=0,frameCount=0,currentQuality='balanced',pending=null,pauseAt=0,renderClock=36-.06;
let previousConditions={strength:1,wind:0,tide:0},currentConditions={...previousConditions};
let backgroundRunning=false;
document.addEventListener('visibilitychange',()=>{if(document.hidden){backgroundRunning=!paused;setPause(true);}else if(backgroundRunning){backgroundRunning=false;setPause(false);}});
const bootAt=performance.now();
const scene=new THREE.Scene();
const makeField=()=>{const t=new THREE.DataTexture(new Float32Array(GRID.nx*GRID.nz*4),GRID.nx,GRID.nz,THREE.RGBAFormat,THREE.FloatType);t.minFilter=t.magFilter=THREE.LinearFilter;t.needsUpdate=true;return t;};
const fields={surface:makeField(),previous:makeField(),material:makeField(),previousMaterial:makeField(),flow:makeField(),previousFlow:makeField()};
const qa=document.createElement('output');qa.id='qa-state';qa.hidden=true;document.body.appendChild(qa);
function setPause(value){value=!!value;if(value===paused)return;if(value!==paused){if(value)pauseAt=performance.now();else{packetAt+=performance.now()-pauseAt;last=performance.now();}}paused=value;$('pause').setAttribute('aria-label',paused?'Resume simulation':'Pause simulation');$('pause').title=paused?'Resume · Space':'Pause · Space';$('pause-icon').innerHTML=paused?'<path d="M8 5l11 7-11 7z"/>':'<path d="M8 5v14M16 5v14"/>';worker?.postMessage({type:'pause',value:paused});}
function setView(name){navigation.setView(name);$('view').value=name;$('cinematic').setAttribute('aria-pressed','false');return (navigation.transition?.duration||0)*1000;}
function toggleUI(){const hidden=$('interface').hidden;$('interface').hidden=!hidden;$('restore-ui').hidden=hidden;$('touch-pad').style.visibility=hidden?'':'hidden';}
function configure(value){worker.postMessage({type:'configure',value});}
function setLighting(mode){
 const s={afternoon:{sun:[-.84,.46,-.25],color:'#fff0d7',intensity:2.2,ambient:1.2,cloud:.04,exposure:1},daylight:{sun:[-.40,.78,-.46],color:'#fff9eb',intensity:2.4,ambient:1.35,cloud:0,exposure:1},overcast:{sun:[-.36,.55,-.79],color:'#e9f0f2',intensity:.5,ambient:1.7,cloud:.91,exposure:1}}[mode];
 shaders.U.sun.value.set(...s.sun).normalize();shaders.U.sunColor.value.set(s.color);shaders.U.overcast.value=s.cloud;world.light.position.copy(shaders.U.sun.value).multiplyScalar(90).add(world.light.target.position);world.light.color.set(s.color);world.light.shadow.needsUpdate=true;world.light.userData.baseIntensity=s.intensity;world.hemi.userData.baseIntensity=s.ambient;world.light.intensity=s.intensity*(1-shaders.U.clouds.value*.18);world.hemi.intensity=s.ambient*(1+shaders.U.clouds.value*.10);renderer.toneMappingExposure=s.exposure;$('lighting').value=mode;
}
function setClouds(value){shaders.U.clouds.value=value;$('clouds').value=value;$('clouds-value').textContent=Math.round(value*100)+'%';world.light.intensity=(world.light.userData.baseIntensity??2.2)*(1-value*.18);world.hemi.intensity=(world.hemi.userData.baseIntensity??1.2)*(1+value*.10);}
function resizeRenderer(){
 const w=innerWidth,h=innerHeight,landscape=w>=h;
 // Identical buffer policy for every case: isolate solver and reflection costs.
 const cap=Math.min(devicePixelRatio,TRIAL.dprCap,(landscape?TRIAL.bufferLong:TRIAL.bufferShort)/w,(landscape?TRIAL.bufferShort:TRIAL.bufferLong)/h);
 renderer.setPixelRatio(cap);renderer.setSize(w,h);
 diagnostics.viewport=[w,h];diagnostics.buffer=[renderer.domElement.width,renderer.domElement.height];diagnostics.effectiveDpr=cap;
}
function setQuality(q){
 currentQuality=q;resizeRenderer();
 if(shaders.mirror)shaders.mirror.reflector.resolutionScale={low:.35,balanced:.6,high:.85}[q];
 world.pebbles.visible=q!=='low';world.light.shadow.needsUpdate=true;$('quality').value=q;
}
function refreshTrialMetrics(){
 if(!window.saltreach)return;
 const snap=window.saltreach.snapshot(),stats=summarize(diagnostics.frameTimes.slice(-300));
 const m=diagnostics.worker;
 $('trial-live').textContent=[
  `${TRIAL.grid.nx} × ${TRIAL.grid.nz} = ${(TRIAL.grid.nx*TRIAL.grid.nz).toLocaleString()} physics samples · ${TRIAL.effects==='toon'?'opaque cartoon / no refraction':TRIAL.effects==='cheap'?'analytic sky reflection':'planar + sky reflection'}`,
  TRIAL.effects==='toon'?'WIP cartoon variant · browser/GPU visual verification pending':'',
  `${diagnostics.backend||'starting'} · ${diagnostics.rendererName} · buffer ${(diagnostics.buffer||[]).join(' × ')} · viewport ${(diagnostics.viewport||[]).join(' × ')}`,
  stats?`Rolling FPS ${(1000/stats.mean).toFixed(1)} · frame p50/p95/p99 ${[stats.p50,stats.p95,stats.p99].map(x=>x.toFixed(1)).join(' / ')} ms · >100 ms ${stats.over100ms}/${diagnostics.frameTimes.slice(-300).length}`:'Waiting for the first rendered frames…',
  m?`Solver ${m.kernel} (no Wasm) · step ${m.stepMeanMs?.toFixed(2)??'—'} ms · pack ${m.packMs?.toFixed(2)} ms · packets ${m.publishHz?.toFixed(1)}/20 Hz · pool ${m.allocatedPackets}/3`:'Warming the deterministic 36-second sea…',
  m?`Warm-up ${(m.warmupMs/1000).toFixed(2)} s / ${m.warmupSteps} steps · startup ${((diagnostics.startupMilliseconds||0)/1000).toFixed(2)} s · worker debt ${m.debtMs.toFixed(1)} ms`:'',
  `Simulation ${snap.time.toFixed(2)} s · render ${snap.renderTime.toFixed(2)} s · interpolation holds ${diagnostics.interpolationHoldFrames}`,
  performance.memory?`JS heap ${(performance.memory.usedJSHeapSize/1048576).toFixed(1)} MiB · available system memory unavailable`:'Memory reporting unavailable in this browser',
 ].filter(Boolean).join('\n');
 $('measure-trial').disabled=!diagnostics.ready||!!profile.run;
}
async function measureTrial(){
 if(!diagnostics.ready||profile.run)return;
 if(paused)setPause(false);
 $('measure-trial').disabled=true;$('benchmark-report').hidden=false;$('benchmark-report').parentElement.open=true;$('benchmark-report').textContent='Measuring stationary 30-second window. Keep this tab foregrounded.';
 try{
  const result=await profile.measure(30,()=>window.saltreach.snapshot());
  $('benchmark-report').textContent=JSON.stringify(result,null,2);
  diagnostics.benchmark=result;
 }catch(error){$('benchmark-report').textContent=String(error);}
 refreshTrialMetrics();
}
function bindTrialUI(){
 $('trial-preset').innerHTML=Object.entries(PRESETS).map(([id,p])=>`<option value="${id}">${p.label}</option>`).join('');$('trial-preset').value=TRIAL.id;
 $('trial-preset').onchange=e=>{const url=new URL(location.href);url.searchParams.set('preset',e.target.value);location.assign(url);};
 $('reload-trial').onclick=()=>location.reload();$('measure-trial').onclick=measureTrial;
 $('trial-panel').addEventListener('pointerdown',e=>e.stopPropagation());$('trial-panel').addEventListener('wheel',e=>e.stopPropagation(),{passive:true});$('trial-panel').addEventListener('keydown',e=>e.stopPropagation());
 setInterval(refreshTrialMetrics,1000);
}
function bindUI(){
 $('pause').onclick=()=>setPause(!paused);$('view').onchange=e=>setView(e.target.value);
 $('cinematic').onclick=()=>{if(navigation.cinematic){setView('ocean');}else{navigation.setView('ocean');$('view').value='ocean';navigation.cinematic=true;navigation.cinemaStart=performance.now()/1000+(navigation.transition?.duration||0);}$('cinematic').setAttribute('aria-pressed',String(navigation.cinematic));};
 $('settings-toggle').onclick=()=>{$('settings').hidden=!$('settings').hidden;$('settings-toggle').setAttribute('aria-expanded',String(!$('settings').hidden));$('help').hidden=true;};$('close-settings').onclick=()=>{$('settings').hidden=true;$('settings-toggle').setAttribute('aria-expanded','false');$('settings-toggle').focus();};
 $('help-toggle').onclick=()=>{$('help').hidden=!$('help').hidden;$('settings').hidden=true;$('settings-toggle').setAttribute('aria-expanded','false');};$('close-help').onclick=()=>{$('help').hidden=true;$('help-toggle').focus();};
 $('hide-ui').onclick=$('restore-ui').onclick=toggleUI;
 $('strength').oninput=e=>{const v=+e.target.value;configure({strength:v});$('strength-value').textContent=v<.8?'Gentle':v>1.25?'Lively':'Moderate';};
 $('wind').oninput=e=>{const v=+e.target.value;configure({wind:v});$('wind-value').textContent=v===0?'Onshore':`${Math.abs(v)}° ${v<0?'left':'right'}`;};
 $('tide').oninput=e=>{const v=+e.target.value;configure({tide:v});$('tide-value').textContent=Math.abs(v)<.01?'Mean':`${v>0?'+':''}${v.toFixed(2)} m`;};
 $('clouds').oninput=e=>setClouds(+e.target.value);$('lighting').onchange=e=>{setLighting(e.target.value);if(e.target.value==='overcast')setClouds(.95);};$('quality').onchange=e=>setQuality(e.target.value);
 window.addEventListener('keydown',e=>{if(isInterfaceEvent(e))return;if(e.code==='Space'){e.preventDefault();setPause(!paused);}if(e.code==='KeyH')toggleUI();if(e.code==='KeyC'){const keys=Object.keys(VIEWS);setView(keys[(keys.indexOf(navigation.view)+1)%keys.length]);}if(e.code==='Escape'){$('settings').hidden=$('help').hidden=true;}});
 $('interface').addEventListener('keydown',e=>{if(e.key==='Escape'&&e.target.tagName!=='SELECT'){const settings=!$('settings').hidden;$('settings').hidden=$('help').hidden=true;$('settings-toggle').setAttribute('aria-expanded','false');(settings?$('settings-toggle'):$('help-toggle')).focus();}e.stopPropagation();});$('interface').addEventListener('wheel',e=>e.stopPropagation(),{passive:true});$('interface').addEventListener('pointerdown',e=>e.stopPropagation());
 const keyMap={forward:'KeyW',back:'KeyS',left:'KeyA',right:'KeyD'};document.querySelectorAll('[data-move]').forEach(b=>{b.onpointerdown=e=>{e.preventDefault();b.setPointerCapture(e.pointerId);navigation.keys.add(keyMap[b.dataset.move]);navigation.transition=null;navigation.cinematic=false;};b.onpointerup=b.onpointercancel=()=>navigation.keys.delete(keyMap[b.dataset.move]);});
 window.addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();resizeRenderer();});
}
async function init(){
 try{
  if(THREE.REVISION!=='185')throw new Error('The packaged renderer must be Three.js r185.');
  renderer=new THREE.WebGPURenderer({antialias:false,trackTimestamp:new URLSearchParams(location.search).has('gpu'),forceWebGL:new URLSearchParams(location.search).has('webgl'),powerPreference:'high-performance'});
  resizeRenderer();renderer.toneMapping=THREE.NeutralToneMapping;renderer.toneMappingExposure=1;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFShadowMap;
  await renderer.init();diagnostics.backend=renderer.backend.isWebGPUBackend?'WebGPU':'WebGL2';
  const gl=renderer.backend.gl;
  if(gl){const ext=gl.getExtension('WEBGL_debug_renderer_info');diagnostics.rendererName=ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);}
  else diagnostics.rendererName=renderer.backend.device?.adapterInfo?.description||'WebGPU adapter identity unavailable';
  renderer.backend.device?.addEventListener('uncapturederror',e=>{renderer.setAnimationLoop(null);fail(e.error);});
  $('viewport').appendChild(renderer.domElement);
  camera=new THREE.PerspectiveCamera(57,innerWidth/innerHeight,.18,5000);
  shaders=createShading(makeNoiseTexture(),fields);world=buildWorld(scene,shaders);spray=new ContactSpray(scene,shaders);navigation=new ShoreCamera(camera,renderer.domElement);renderer.domElement.tabIndex=0;renderer.domElement.setAttribute('aria-label','Coastal scene. Drag to look and use W A S D to move.');navigation.update(.016,0);setLighting('afternoon');bindUI();
  const workerURL=new URL('./worker.js',import.meta.url);workerURL.searchParams.set('preset',TRIAL.id);worker=new Worker(workerURL,{type:'module'});
  worker.onerror=e=>fail(e.message);
  worker.onmessage=async ({data})=>{
   if(data.type==='progress'){$('progress').style.width=`${10+data.value*70}%`;return;}
   busy=false;
   if(data.type==='ready'||data.type==='qa-frame'){if(pending)recyclePacket(pending);pending=null;installPacket(data,true);}
   else{if(pending)recyclePacket(pending);pending=data;return;}
   if(data.type==='ready'){
    camera.updateMatrixWorld();shaders.updateCamera(camera);$('loading-text').textContent='Resolving light and water';$('progress').style.width='92%';
    try{await renderer.compileAsync(scene,camera);renderer.render(scene,camera);diagnostics.ready=true;diagnostics.startupMilliseconds=performance.now()-bootAt;$('loading').hidden=true;last=performance.now();renderer.setAnimationLoop(frame);worker.postMessage({type:'pause',value:paused});refreshTrialMetrics();if(new URLSearchParams(location.search).has('autobench'))setTimeout(measureTrial,2000);}catch(e){fail(e);}
   }
  };
  worker.postMessage({type:'init',profile:!!profile});
  window.saltreach={diagnostics,scene,camera,renderer,fields,get paused(){return paused;},get time(){return simTime;},get quality(){return currentQuality;},setPause,setView,configure,setLighting,setClouds,setQuality,viewpoints:VIEWS,snapshot:()=>({trial:TRIAL,rendererName:diagnostics.rendererName,buffer:diagnostics.buffer,viewport:diagnostics.viewport,effectiveDpr:diagnostics.effectiveDpr,interpolationHoldFrames:diagnostics.interpolationHoldFrames,ready:diagnostics.ready,revision:diagnostics.revision,backend:diagnostics.backend,time:simTime,paused,quality:currentQuality,view:navigation.view,position:camera.position.toArray(),conditions:{strength:shaders.U.strength.value,wind:shaders.U.wind.value,tide:shaders.U.tide.value,lighting:$('lighting').value,clouds:shaders.U.clouds.value},renderTime:shaders.U.time.value,alpha:shaders.U.alpha.value,sprayEmitted:spray.totalEmitted,rockWetReach:world.rocks[0].userData.wetReach,simulationLag:Math.max(0,renderClock-simTime),worker:diagnostics.worker,metrics:diagnostics.metrics,errors:diagnostics.errors})};
  registerAgentTools({measure:profile?seconds=>profile.measure(seconds,()=>window.saltreach.snapshot()):null,read:()=>({...window.saltreach.snapshot(),benchmark:profile?.last,benchmarkRunning:!!profile?.run,performance:qa.textContent?JSON.parse(qa.textContent):null}),view:setView,pause:setPause,configure:input=>{for(const k of ['strength','wind','tide'])if(input[k]!==undefined){$(k).value=input[k];$(k).oninput({target:$(k)});}if(input.lighting){setLighting(input.lighting);if(input.lighting==='overcast'&&input.clouds===undefined)setClouds(.95);}if(input.clouds!==undefined)setClouds(input.clouds);if(input.quality)setQuality(input.quality);}});
 }catch(e){fail(e);}
}
function recyclePacket(p){worker.postMessage({type:'recycle',surface:p.surface,material:p.material,flow:p.flow},[p.surface.buffer,p.material.buffer,p.flow.buffer]);}
function installPacket(data,initial=false){
 if([data.surface,data.material,data.flow].some(a=>!(a instanceof Float32Array)||a.length!==GRID.nx*GRID.nz*4))throw new Error('Worker packet/grid mismatch');
 if(initial&&diagnostics.ready){
  const a={surface:fields.surface.image.data,material:fields.material.image.data,flow:fields.flow.image.data};
  const b={surface:fields.previous.image.data,material:fields.previousMaterial.image.data,flow:fields.previousFlow.image.data};
  recyclePacket(a);if(b.surface!==a.surface)recyclePacket(b);
 }
 const recycled={};
 for(const [key,previous] of [['surface','previous'],['material','previousMaterial'],['flow','previousFlow']]){
  if(initial){fields[key].image.data=data[key];fields[previous].image.data=data[key];fields[key].needsUpdate=fields[previous].needsUpdate=true;}
  else{const spare=fields[previous],old=spare.image.data;fields[previous]=fields[key];fields[key]=spare;spare.image.data=data[key];spare.needsUpdate=true;if(old!==fields[previous].image.data)recycled[key]=old;}
 }
 shaders.bindFields();
 if(recycled.surface&&recycled.material&&recycled.flow)worker.postMessage({type:'recycle',...recycled},[recycled.surface.buffer,recycled.material.buffer,recycled.flow.buffer]);
 previousTime=initial?data.time:simTime;simTime=data.time;packetAt=performance.now();if(initial)renderClock=data.time-.06;
 previousConditions=initial?{...data.state}:currentConditions;currentConditions={...data.state};
 shaders.U.alpha.value=initial?1:0;shaders.U.time.value=previousTime;
 if(initial){for(const key of ['strength','wind','tide'])shaders.U[key].value=data.state[key];if(shaders.mirror)shaders.mirror.target.position.y=data.state.tide;}
 if(data.metrics)diagnostics.metrics=data.metrics;
 if(data.profile)diagnostics.worker=data.profile;
 if(!initial)spray.arrival(data);
 for(const mesh of world.rocks){const r=mesh.userData.rock,level=sampleField(data.surface,r.x+r.rx*1.16,r.z);const old=mesh.userData.wetReach,reach=Math.max(old-.008*Math.max(0,simTime-previousTime),level+.07);mesh.userData.previousReach=old;mesh.userData.wetReach=reach;}
}
function frame(now){
 const frameStart=performance.now();
 const actualMs=now-last,dt=Math.min(.06,actualMs/1000);last=now;
 if(!paused){
  // Interpolate on simulation time, not from each packet's arrival. Restarting
  // the interval on delivery discards fractional time and slows the sea at 60 Hz.
  renderClock+=actualMs/1000;
  if(pending&&renderClock>=simTime){const next=pending;pending=null;installPacket(next);}
  const alpha=Math.max(0,Math.min(1,(renderClock-previousTime)/Math.max(1e-6,simTime-previousTime)));
  if(alpha>=1)diagnostics.interpolationHoldFrames++;
  shaders.U.alpha.value=alpha;shaders.U.time.value=previousTime+(simTime-previousTime)*alpha;
  for(const key of ['strength','wind','tide'])shaders.U[key].value=previousConditions[key]+(currentConditions[key]-previousConditions[key])*alpha;
  if(shaders.mirror)shaders.mirror.target.position.y=shaders.U.tide.value;
  for(const mesh of world.rocks){const a=mesh.userData.previousReach??mesh.userData.wetReach,b=mesh.userData.wetReach,reach=a+(b-a)*alpha;mesh.userData.renderWetReach=reach;}
 }
 navigation.update(dt,now/1000,shaders.U.tide.value,shaders.U.strength.value);
 if($('cinematic').getAttribute('aria-pressed')!==String(navigation.cinematic))$('cinematic').setAttribute('aria-pressed',String(navigation.cinematic));
 
 spray.update(shaders.U.time.value,camera);camera.updateMatrixWorld();shaders.updateCamera(camera);renderer.render(scene,camera);
 profile?.record(actualMs,performance.now()-frameStart,renderer);
 diagnostics.frameTimes.push(actualMs);if(diagnostics.frameTimes.length>1200)diagnostics.frameTimes.shift();
 if(++frameCount%30===0){const ts=diagnostics.frameTimes.slice(-300).sort((a,b)=>a-b);qa.textContent=JSON.stringify({...window.saltreach.snapshot(),startupMilliseconds:diagnostics.startupMilliseconds,fps:1000/(ts.reduce((a,b)=>a+b,0)/ts.length),p95:ts[Math.floor(ts.length*.95)],renderCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles});}
}
bindTrialUI();
init();

