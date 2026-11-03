// SFINCS model runs in a 3D world the page owns: one height field, one surface for ground and
// water, the street map painted into it, bridges and buildings standing on it, the run's rain
// falling where its rainfall input says, and the app's routes and crossings on top.
import * as THREE from 'three/webgpu';
import {MapControls} from 'three/addons/controls/MapControls.js';
import {makeNoiseTexture} from '../../../coastal-lowcost/src/noise.js?v=1.3.0';
import * as config from '../../../../config.js';
import {parseFrames} from '../run-data.js';
import {parseRoadHeights} from '../road-heights.js';
import {decodeRoadHeights,roadPackage} from '../road-package.js';
import {toUtm,fromUtm} from '../utm.js';
import {buildHeights,groundSampler,levelGrid,shareGrid,levelSampler,modelCells,toWorld,worldToUtm,SIZE_X,SIZE_Z} from './heights.js';
import {createLabels} from './labels.js';
import {loadVectorTile,tileRange} from './tiles.js';
import {createSurface} from './surface.js';
import {createChunks} from './chunks.js';
import {routeOverlay,baseMap} from './paint.js';
import {createMarkers} from './markers.js';
import {GRID} from '../run-data.js';
import {parseRain,rainAt,createRain} from './rain.js';
import {createRoutesUI} from './routes-ui.js';
import {mountAcknowledgement} from '../acknowledge.js';
const $=id=>document.getElementById(id);
const DATA='../../../../simulation/data/',E=2,SHOW_DEPTH_M=.05,HOUR_SECONDS=4;
// The saved runs to choose from. Both share the model's grid and terrain.
const RUNS=[
 {id:'13z',label:'Nov 1, 13Z forecast run',note:'Rain shown from this run\'s rainfall input.',display:'frozen-terrain-display.json.gz',rain:'frozen-map-context.json',inflow:'frozen-map-context.json',hand:'frozen-map-polygons.json.gz'},
 {id:'19z',label:'Nov 1, 19Z forecast run (more water)',note:'Rain shown from this run\'s rainfall input (HRRR 19Z forecast). Its heaviest rain, Nov 1 9–10 AM MST, fell before the first saved water hour.',display:'sfincs-current-coarse-20261101-19z-41350254061-map/frozen-terrain-display.json.gz',rain:'sfincs-current-coarse-20261101-19z-41350254061-map/rainfall.json',inflow:'sfincs-current-coarse-20261101-19z-41350254061-map/inflow.json'},
 {id:'stress',label:'Stress test: 100-year storm with a record river',note:'A what-if run of the same model, not a forecast: the 19Z run\'s ground conditions, then NOAA Atlas 14\'s 100-year 6-hour storm (2.8 in, 2.2 in in the peak hour) on every cell from 5 PM MST, and the Santa Cruz rising to its 1983 record flow (65,000 cfs) at 10 PM.',display:'sfincs-stress-storm-41633261576-map/frozen-terrain-display.json.gz',rain:'sfincs-stress-storm-41633261576-map/rainfall.json',inflow:'sfincs-stress-storm-41633261576-map/inflow.json'},
 {id:'extreme',label:'Extreme what-if: 1,000-year storm, twice the record river',note:'A deliberately extreme what-if run of the same model, far beyond anything on record and not a forecast: the 19Z run\'s ground conditions, then NOAA Atlas 14\'s 1,000-year 6-hour storm (4.0 in, 3.0 in in the peak hour) on every cell from 5 PM MST, and the Santa Cruz at twice its 1983 record flow (130,000 cfs) at 10 PM.',display:'sfincs-extreme-storm-41635232621-map/frozen-terrain-display.json.gz',rain:'sfincs-extreme-storm-41635232621-map/rainfall.json',inflow:'sfincs-extreme-storm-41635232621-map/inflow.json'},
];
const diagnostics={ready:false,errors:[],frameTimes:[]};
const fail=error=>{diagnostics.errors.push(String(error?.stack||error));$('error').hidden=false;$('error-detail').textContent=String(error?.message||error);};
window.addEventListener('error',e=>fail(e.error||e.message));window.addEventListener('unhandledrejection',e=>fail(e.reason));
mountAcknowledgement();
const status=text=>{$('window').textContent=text;};
// The loading card on the map: what is happening, and how far along.
const loading=(text,share)=>{$('loading').classList.remove('done');$('loading-step').textContent=text;if(share!=null)$('loading-bar').style.width=Math.round(share*100)+'%';};
const loaded=()=>$('loading').classList.add('done');
async function fetchMaybeGzip(path){
 const response=await fetch(new URL(path,import.meta.url));
 if(!response.ok)throw new Error(`${path} answered ${response.status}`);
 const bytes=new Uint8Array(await response.arrayBuffer());
 // Some hosts send .gz files already unpacked.
 if(bytes[0]!==0x1f||bytes[1]!==0x8b)return bytes;
 return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
}
const json=async path=>JSON.parse(new TextDecoder().decode(await fetchMaybeGzip(path)));
status('Loading the model terrain');loading('Loading the model terrain',.05);
const terrainBytes=await fetchMaybeGzip(DATA+'frozen-voxel-terrain.f32.gz');
const firstRun=RUNS.find(r=>r.id===new URLSearchParams(location.search).get('run'))??RUNS[0];
const [firstDisplay,routes,measured]=await Promise.all([json(DATA+firstRun.display),fetch(new URL('../../../../data/routes.geojson',import.meta.url)).then(r=>{if(!r.ok)throw new Error('Routes answered '+r.status);return r.json();}),fetch(new URL('../../../../inundation/road-heights.json',import.meta.url)).then(r=>{if(!r.ok)throw new Error('Road heights answered '+r.status);return r.json();}).then(parseRoadHeights)]);
loading('Joining the terrain',.35);
const data={vertices:firstDisplay.vertices,terrain:new Float32Array(terrainBytes.buffer,terrainBytes.byteOffset,terrainBytes.byteLength/4)};
status('Joining the terrain');
const {heights,filled}=await buildHeights(data),ground=groundSampler(heights);
const world=(lon,lat)=>{const u=toUtm(lon,lat);return toWorld(u.e,u.n);};
// Road heights every 5 m on the routes, with lidar bridge decks (see src/road-package.js).
const ROADS=new URL('../../../../simulation/data/road-heights/',import.meta.url);
loading('Loading road and bridge-deck heights',.55);
const roads=await Promise.all([fetchMaybeGzip(new URL('routes.bin.gz',ROADS).href).then(b=>decodeRoadHeights(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength))),fetch(new URL('structures.json',ROADS)).then(r=>r.json())]).then(([lines,structures])=>roadPackage(lines,structures,world));
const toLonLat=(x,z)=>{const u=worldToUtm(x,z);return fromUtm(u.e,u.n);};
const inside=(x,z)=>Math.abs(x)<SIZE_X/2&&Math.abs(z)<SIZE_Z/2;
// A run, prepared for drawing and for the crossing sheets.
async function prepareRun(def,display){
 display??=await json(DATA+def.display);
 const frames=parseFrames(display),levels=frames.map(f=>levelGrid(f,data.vertices));
 const [rainJson,inflowJson,handJson]=await Promise.all([def.rain&&json(DATA+def.rain),def.inflow&&def.inflow!==def.rain&&json(DATA+def.inflow),def.hand&&json(DATA+def.hand)]);
 // River inflow at the model's inlets: the run's NWM boundary series or its own sfincs.dis.
 const inflow=((def.inflow===def.rain?rainJson?.boundary:inflowJson)?.series??[]).filter(s=>s.lon!=null&&s.points?.some(p=>p.flowM3s>0)).map(s=>{const [x,z]=world(s.lon,s.lat);return{name:s.name||'NWM reach '+s.reachId,x,z,points:new Map(s.points.map(p=>[Date.parse(p.time),p.flowM3s]))};});
 // HAND modeled extent per hour, in world coordinates.
 const hand=handJson?handJson.frames.map(f=>f.hand.features.flatMap(g=>(g.geometry.type==='MultiPolygon'?g.geometry.coordinates:[g.geometry.coordinates]).map(poly=>poly.map(ring=>ring.map(([lon,lat])=>world(lon,lat)))))):null;
 return{def,frames,levels,shares:frames.map(f=>shareGrid(f,data,SHOW_DEPTH_M)),samplers:levels.map(levelSampler),measured,rain:rainJson?parseRain(rainJson):null,inflow,hand};
}
loading('Preparing the model water',.7);
let run=await prepareRun(firstRun,firstDisplay);
loading('Starting the 3D view',.8);
const renderer=new THREE.WebGPURenderer({antialias:true,forceWebGL:true,logarithmicDepthBuffer:true,powerPreference:'high-performance'});
const view=()=>[Math.max(1,$('map').clientWidth),Math.max(1,$('map').clientHeight)];
renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.setSize(...view());renderer.toneMapping=THREE.NoToneMapping;
await renderer.init();$('map').appendChild(renderer.domElement);
const scene=new THREE.Scene();scene.background=new THREE.Color('#cfe2ec');scene.fog=new THREE.Fog('#cfe2ec',14000,60000);
const camera=new THREE.PerspectiveCamera(45,view()[0]/view()[1],2,200000);
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
const routesUI=createRoutesUI({root:$('map'),panelRoot:$('routes-ui'),camera,config,routes,roads,world,inside:modelled,ground,E,appHref,flyTo,onRoutes:(area,route)=>{routeOverlay.area=area;routeOverlay.route=route;chunks.repaint();showLayers();}});
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
 showLayers();
}
function describeRun(){
 $('run-note').textContent=run.def.note;$('rain').disabled=!run.rain;$('flow').disabled=!run.inflow.length;$('scrub').max=String(run.frames.length-1);
 for(const o of $('model').options)if(o.value==='hand'||o.value==='aggregate')o.disabled=!run.hand;
 if(!run.hand&&($('model').value==='hand'||$('model').value==='aggregate'))$('model').value='2d';
 applyModel();
}
// --- Layers & view: the same choices as the app's 2D map ---
function applyModel(){
 const m=$('model').value;surface.U.water.value=m==='2d'||m==='aggregate'?1:0;surface.U.hand.value=m==='hand'||m==='aggregate'?1:0;
 $('model-note').textContent=!run.hand?"The HAND modeled estimate exists only for the Nov 1, 13Z run, from its own NWM flows.":m==='off'?'No simulated water is drawn. Routes, places and crossings stay.':m==='hand'?"HAND: a terrain-height estimate of where river water could reach for the run's NWM flow, not the SFINCS simulation.":'';
 showLayers();
}
$('model').onchange=applyModel;
const markers=createMarkers($('map'),camera,ground,E);
let showFlow=true,showPlaces=true;
function showLayers(){
 if(frameIndex<0)return;
 surface.setHand(run.hand&&surface.U.hand.value?run.hand[frameIndex]:null);
 const t=Date.parse(run.frames[frameIndex].time),list=[];
 if(showFlow)for(const s of run.inflow){const q=s.points.get(t);if(q!=null)list.push({x:s.x,z:s.z,className:'flow',html:`<span>${s.name} inflow: ${Math.round(q).toLocaleString()} m³/s (${Math.round(q*35.3147).toLocaleString()} ft³/s)</span>`});}
 if(showPlaces)for(const p of config.PLACES.filter(p=>p.area===routesUI.area)){const [x,z]=world(p.lon,p.lat);list.push({x,z,className:'place',html:`<span>${p.name}</span>`});}
 markers.set(list);
}
$('flow').onchange=e=>{showFlow=e.target.checked;showLayers();};
$('show-places').onchange=e=>{showPlaces=e.target.checked;showLayers();};
$('show-routes').onchange=e=>{routeOverlay.show=e.target.checked;chunks.repaint();};
for(const b of document.querySelectorAll('[data-base]'))b.onclick=()=>{baseMap.kind=b.dataset.base;for(const o of document.querySelectorAll('[data-base]'))o.setAttribute('aria-selected',String(o===b));chunks.repaint();};
// Zoom in steps, as the map buttons on the 2D map do, keeping the view's direction.
const zoomBy=k=>{const d=camera.position.clone().sub(controls.target),len=Math.min(controls.maxDistance,Math.max(controls.minDistance,d.length()*k));flight={start:performance.now(),from:{t:controls.target.clone(),c:camera.position.clone()},to:{t:controls.target.clone(),c:controls.target.clone().add(d.setLength(len))}};};
$('zoom-in').onclick=()=>zoomBy(.55);$('zoom-out').onclick=()=>zoomBy(1.8);
const fitBox=(xs,zs)=>{if(!xs.length)return;let x0=Infinity,x1=-Infinity,z0=Infinity,z1=-Infinity;xs.forEach((x,k)=>{x0=Math.min(x0,x);x1=Math.max(x1,x);z0=Math.min(z0,zs[k]);z1=Math.max(z1,zs[k]);});flyTo((x0+x1)/2,(z0+z1)/2,Math.max(2000,Math.hypot(x1-x0,z1-z0)*1.05));};
$('fit-routes').onclick=()=>{const pts=routeOverlay.lines.filter(r=>r.area===routesUI.area).flatMap(r=>r.parts.flat());fitBox(pts.map(p=>p[0]),pts.map(p=>p[1]));};
$('fit-flood').onclick=()=>{
 // Every model cell with water deeper than 0.3 m this hour.
 const f=run.frames[frameIndex],xs=[],zs=[];data.vertices.forEach((v,k)=>{const s=f.surface[k];if(!Number.isNaN(s)&&s-v[2]>.3){const [x,z]=toWorld(GRID.x0+(v[4]+.5)*GRID.dx,GRID.y0+(v[3]+.5)*GRID.dx);xs.push(x);zs.push(z);}});
 fitBox(xs,zs);
};
$('prev').onclick=()=>{playing=false;showPlaying();clock=Math.max(0,frameIndex-1);};
$('next').onclick=()=>{playing=false;showPlaying();clock=Math.min(run.frames.length-2,frameIndex+1);};
$('run').innerHTML=RUNS.map(r=>`<option value="${r.id}"${r===run.def?' selected':''}>${r.label}</option>`).join('');
$('run').onchange=async e=>{
 const def=RUNS.find(r=>r.id===e.target.value);$('run').disabled=true;status('Loading '+def.label);loading('Loading '+def.label,.3);
 try{run=await prepareRun(def);loading('Preparing the model water',.8);routesUI.setRun(run);clock=0;frameIndex=-1;describeRun();status(`${def.label}: ${run.frames.length} hours.`);}
 catch(error){fail(error);}finally{$('run').disabled=false;loaded();}
};
const PLAY='<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>',PAUSE='<svg viewBox="0 0 24 24"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>';
const showPlaying=()=>{$('play').innerHTML=playing?PAUSE:PLAY;$('play').setAttribute('aria-label',playing?'Pause':'Play');};
$('play').onclick=()=>{playing=!playing;showPlaying();};
$('scrub').oninput=e=>{playing=false;showPlaying();clock=Number(e.target.value);};
describeRun();
// The map is a panel of the page, as in the app: follow its size, not the window's.
new ResizeObserver(()=>{const [w,h]=view();camera.aspect=w/h;camera.updateProjectionMatrix();renderer.setSize(w,h);}).observe($('map'));
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
 controls.update();followGround();flyStep(now);chunks.update(camera);labels.update();routesUI.update();markers.update();
 rainNow=rain.update(dt/1000,{rain:run.rain,time:frameTime(),target:controls.target,cameraDistance:camera.position.distanceTo(controls.target),groundAt:ground,enabled:rainOn});
 renderer.render(scene,camera);
 diagnostics.frameTimes.push(dt);if(diagnostics.frameTimes.length>600)diagnostics.frameTimes.shift();
});
diagnostics.ready=true;
// The card stays until the street map around the view is painted, 12 s at most.
{const began=performance.now();loading('Painting the map',.9);const wait=setInterval(()=>{const s=chunks.stats();if(s.queued===0||performance.now()-began>12000){clearInterval(wait);$('loading-bar').style.width='100%';loaded();}},200);}
status(`${run.def.label}: ${run.frames.length} hours over the model's 10 m lidar terrain.`);
setInterval(()=>{
 const t=diagnostics.frameTimes.slice(-120),s=chunks.stats(),c=toLonLat(controls.target.x,controls.target.z),here=run.rain?rainAt(run.rain,frameTime(),c.lon,c.lat):null;
 $('rain-now').textContent=run.rain?(here>.05?`${here.toFixed(1)} mm/h at the view centre this hour`:'No rain at the view centre this hour'):'';
 if(t.length)$('metrics').textContent=`${(1000/(t.reduce((a,b)=>a+b,0)/t.length)).toFixed(1)} FPS · ${s.painted}/${s.chunks} areas mapped`;
},500);
window.world={renderer,scene,camera,controls,chunks,diagnostics,ground,filled,labels,places,flyTo,routesUI,get run(){return run;},setClock:v=>{playing=false;clock=v;},get frameIndex(){return frameIndex;}};
