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
import {loadLiveConditions} from '../live-conditions.js';
import {GRID} from '../run-data.js';
import {parseRain,rainAt,createRain} from './rain.js';
import {createRoutesUI} from './routes-ui.js';
import {mountAcknowledgement} from '../acknowledge.js';
import {mountEmbed} from './embed.js';
import {startGraphics,mountGraphics,chunkDetail} from './graphics-3d.js';
import {loadHand,flowsForRun,handHour,windowBounds} from '../../../../simulation/hand-runs.js?v=dev';
import {RUNS,LIVE,LIVE_MAX_AGE_H,BASE_DISPLAY} from '../runs.js';
import {openAllRoute,rasterize} from '../../../../simulation/all-route-run.js?v=dev';
const $=id=>document.getElementById(id);
const DATA='../../../../simulation/data/',E=2,SHOW_DEPTH_M=.05,HOUR_SECONDS=4;
const diagnostics={ready:false,errors:[],frameTimes:[]};
const fail=error=>{diagnostics.errors.push(String(error?.stack||error));try{if(parent!==window)parent.postMessage({fp3d:'log',kind:'error',message:String(error?.message||error),where:String(error?.stack||'').split('\n')[1]?.trim()},location.origin);}catch{}$('error').hidden=false;$('error-detail').textContent=String(error?.message||error);$('loading').classList.add('done');};
window.addEventListener('error',e=>fail(e.error||e.message));window.addEventListener('unhandledrejection',e=>fail(e.reason));
mountAcknowledgement();mountEmbed();
const status=text=>{$('window').textContent=text;};
// The loading card on the map: what is happening, and how far along.
// Downloads in flight add "· 3.1 of 8.4 MB" to the step, so a slow connection shows it is moving.
const downloads=new Map();let stepText='';
const mb=n=>(n/1048576).toFixed(n<1048576?2:1);
function showStep(){
 let got=0,total=0;for(const d of downloads.values()){got+=d.got;total+=d.total;}
 $('loading-step').textContent=stepText+(downloads.size?` · ${mb(got)}${total>=got&&total?' of '+mb(total):''} MB`:'');
}
const loading=(text,share)=>{$('loading').classList.remove('done');stepText=text;showStep();if(share!=null)$('loading-bar').style.width=Math.round(share*100)+'%';};
const loaded=()=>$('loading').classList.add('done');
// A moment for the page around this view to answer clicks between heavy steps.
const breathe=()=>new Promise(r=>setTimeout(r,0));
// The same work over every hour of a run, pausing after each so the page stays responsive.
async function eachFrame(list,fn){const out=[];for(const x of list){out.push(fn(x));await breathe();}return out;}
// Read a response body while counting its bytes for the loading card.
async function readCounted(response,key){
 const total=Number(response.headers.get('content-length'))||0;
 if(!response.body)return new Uint8Array(await response.arrayBuffer());
 const entry={got:0,total};downloads.set(key,entry);const parts=[];let last=0;
 try{
  const reader=response.body.getReader();
  for(;;){const {done,value}=await reader.read();if(done)break;parts.push(value);entry.got+=value.length;const now=performance.now();if(now-last>150){last=now;showStep();}}
 }finally{downloads.delete(key);showStep();}
 const out=new Uint8Array(parts.reduce((s,p)=>s+p.length,0));let o=0;for(const p of parts){out.set(p,o);o+=p.length;}
 return out;
}
// Two more tries, a second and then three apart, before a download counts as failed.
async function fetchRetry(url){
 let error;
 for(const wait of [0,1000,3000]){
  if(wait)await new Promise(r=>setTimeout(r,wait));
  try{const r=await fetch(url);if(r.ok||r.status===404)return r;error=new Error(`${String(url).split('/').pop()} answered ${r.status}`);}catch(e){error=e;}
 }
 throw error;
}
async function fetchMaybeGzip(path){
 const url=new URL(path,import.meta.url),name=String(path).split('/').pop();let bytes,error;
 // Headers and body together, so a download that drops partway is tried again from the start.
 for(const wait of [0,1000,3000]){
  if(wait)await new Promise(r=>setTimeout(r,wait));
  let response;try{response=await fetchRetry(url);}catch(e){error=new Error(`${name} did not download (${e.message}).`);continue;}
  if(!response.ok)throw new Error(`${name} answered ${response.status}.`);
  try{bytes=await readCounted(response,url.href);break;}catch(e){error=new Error(`${name} stopped downloading (${e.message}).`);}
 }
 if(!bytes)throw error;
 // Some hosts send .gz files already unpacked.
 if(bytes[0]!==0x1f||bytes[1]!==0x8b)return bytes;
 return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
}
const json=async path=>JSON.parse(new TextDecoder().decode(await fetchMaybeGzip(path)));
status('Loading the model terrain');loading('Loading the model terrain',.05);
const terrainBytes=await fetchMaybeGzip(DATA+'frozen-voxel-terrain.f32.gz');
const firstRun=RUNS.find(r=>r.id===new URLSearchParams(location.search).get('run'))??RUNS[0];
const [firstDisplay,routes,measured]=await Promise.all([json(DATA+BASE_DISPLAY),fetchRetry(new URL('../../../../data/routes.geojson',import.meta.url)).then(r=>{if(!r.ok)throw new Error('Routes answered '+r.status);return r.json();}),fetchRetry(new URL('../../../../inundation/road-heights.json',import.meta.url)).then(r=>{if(!r.ok)throw new Error('Road heights answered '+r.status);return r.json();}).then(parseRoadHeights)]);
loading('Joining the terrain',.35);await breathe();
const data={vertices:firstDisplay.vertices,terrain:new Float32Array(terrainBytes.buffer,terrainBytes.byteOffset,terrainBytes.byteLength/4)};
status('Joining the terrain');
const {heights,filled}=await buildHeights(data),ground=groundSampler(heights);
const world=(lon,lat)=>{const u=toUtm(lon,lat);return toWorld(u.e,u.n);};
// The run's Santa Cruz inflow (NWM reach 15902351) per frame hour, m³/s, 0 where missing: HAND
// uses it for what-if runs (simulation/hand-runs.js).
const santaCruzM3s=(series,frames)=>{const s=series?.find(s=>String(s.reachId)==='15902351')??series?.find(s=>/santa cruz/i.test(s.name??''));const at=new Map((s?.points??[]).map(p=>[Date.parse(p.time),p.flowM3s]));return frames.map(f=>at.get(Date.parse(f.time))??0);};
const handFields=(frames,series)=>({times:frames.map(f=>Date.parse(f.time)),riverM3s:santaCruzM3s(series,frames)});
// Road heights every 5 m on the routes, with lidar bridge decks (see src/road-package.js).
const ROADS=new URL('../../../../simulation/data/road-heights/',import.meta.url);
loading('Loading road and bridge-deck heights',.55);await breathe();
const roads=await Promise.all([fetchMaybeGzip(new URL('routes.bin.gz',ROADS).href).then(b=>decodeRoadHeights(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength))),fetchRetry(new URL('structures.json',ROADS)).then(r=>r.json())]).then(([lines,structures])=>roadPackage(lines,structures,world));
const toLonLat=(x,z)=>{const u=worldToUtm(x,z);return fromUtm(u.e,u.n);};
const inside=(x,z)=>Math.abs(x)<SIZE_X/2&&Math.abs(z)<SIZE_Z/2;
// A run, prepared for drawing and for the crossing sheets.
async function prepareRun(def,display){
 if(def.live)return prepareLive(def);
 if(def.quad)return prepareQuad(def);
 display??=await json(DATA+def.display);
 const frames=parseFrames(display),levels=await eachFrame(frames,f=>levelGrid(f,data.vertices));
 const [rainJson,inflowJson]=await Promise.all([def.rain&&json(DATA+def.rain),def.inflow&&def.inflow!==def.rain&&json(DATA+def.inflow)]);
 // River inflow at the model's inlets: the run's NWM boundary series or its own sfincs.dis.
 const series=(def.inflow===def.rain?rainJson?.boundary:inflowJson)?.series??[];
 const inflow=series.filter(s=>s.lon!=null&&s.points?.some(p=>p.flowM3s>0)).map(s=>{const [x,z]=world(s.lon,s.lat);return{name:s.name||'NWM reach '+s.reachId,x,z,points:new Map(s.points.map(p=>[Date.parse(p.time),p.flowM3s]))};});
 return{def,frames,levels,shares:await eachFrame(frames,f=>shareGrid(f,data,SHOW_DEPTH_M)),samplers:levels.map(levelSampler),measured,rain:rainJson?parseRain(rainJson):null,inflow,...handFields(frames,series)};
}
loading('Preparing the model water',.7);await breathe();
// The newest live run, refused when it is older than LIVE_MAX_AGE_H: never an old one in its place.
async function prepareLive(def){
 const bust='?t='+Math.floor(Date.now()/120000),manifest=await json(LIVE+'manifest.json'+bust).catch(()=>{throw new Error('The live model feed did not answer.');});
 const age=(Date.now()-Date.parse(manifest.issuedAt))/3600e3;
 if(!(age<=LIVE_MAX_AGE_H))throw new Error(`The newest live model run is ${age.toFixed(1)} hours old (from HRRR ${manifest.hrrrCycle}), older than ${LIVE_MAX_AGE_H} hours.`);
 const [water,rainJson,inflowJson]=await Promise.all([json(LIVE+'water.json.gz'+bust),json(LIVE+'rainfall.json'+bust),json(LIVE+'inflow.json'+bust)]);
 const frames=parseFrames({waterFrames:water.frames}),levels=await eachFrame(frames,f=>levelGrid(f,data.vertices));
 const inflow=inflowJson.series.filter(s=>s.points.some(p=>p.flowM3s>0)).map(s=>{const [x,z]=world(s.lon,s.lat);return{name:s.name,x,z,points:new Map(s.points.map(p=>[Date.parse(p.time),p.flowM3s]))};});
 const issued=new Date(manifest.issuedAt).toLocaleString('en-US',{timeZone:'America/Phoenix',hour:'numeric',minute:'2-digit'});
 def={...def,note:`Model forecast from public forcing, not observed water: SFINCS run at ${issued} MST from the NOAA HRRR rain forecast of ${new Date(manifest.hrrrCycle).toLocaleString('en-US',{timeZone:'America/Phoenix',hour:'numeric'})} MST and NWM river flows, after a 45-hour warm-up. A new run is published every hour.`};
 return{def,frames,levels,shares:await eachFrame(frames,f=>shareGrid(f,data,SHOW_DEPTH_M)),samplers:levels.map(levelSampler),measured,rain:parseRain(rainJson),inflow,...handFields(frames,inflowJson.series),manifest};
}
// The all-route run (simulation/all-route-run.js): three separate model areas on 6.25-100 m cells.
// Its water is drawn from depth pictures rasterised per frame (surface.js setFine); every native
// cell on High and Ultra, the lighter web cells otherwise. The 100 m grid is left empty for it.
const blankLevels=new Float32Array(GRID.mmax*GRID.nmax).fill(-1e5),blankShares=new Float32Array(GRID.mmax*GRID.nmax).fill(-2);
const rawBytes=async url=>{const r=await fetchRetry(url);if(!r.ok)throw new Error(`${String(url).split('/').pop()} answered ${r.status}.`);return readCounted(r,String(url));};
async function prepareQuad(def){
 const variant=['high','ultra'].includes(gfx.preset)?'full':'web',quad=await openAllRoute({variant,fetchBytes:rawBytes});
 const frames=quad.iso.map(time=>({time})),zero=quad.times.map(()=>0);
 // A point is inside when any of the three areas has a cell there.
 const inside=(x,z)=>{const u=worldToUtm(x,z);return quad.cases.some(c=>quad.cellAtUtm(c,u.e,u.n)>=0);};
 return{def,quad,variant,frames,frameMs:quad.frameMs,levels:frames.map(()=>blankLevels),shares:frames.map(()=>blankShares),samplers:frames.map(()=>()=>NaN),measured,rain:null,inflow:[],times:quad.times,riverM3s:zero,inside};
}
const gfx=startGraphics(),G=gfx.settings;
let run,liveProblem=null;
try{run=await prepareRun(firstRun,firstRun.display===BASE_DISPLAY?firstDisplay:undefined);}
catch(error){if(!firstRun.live)throw error;liveProblem=error.message;run=await prepareRun(RUNS.find(r=>r.id==='13z'));}
loading('Starting the 3D view',.8);await breathe();
const renderer=new THREE.WebGPURenderer({antialias:G.antialias,forceWebGL:true,logarithmicDepthBuffer:true,powerPreference:'high-performance'});
const view=()=>[Math.max(1,$('map').clientWidth),Math.max(1,$('map').clientHeight)];
renderer.setSize(...view());renderer.toneMapping=THREE.NoToneMapping;
await renderer.init();$('map').appendChild(renderer.domElement);
const scene=new THREE.Scene();scene.background=new THREE.Color('#cfe2ec');scene.fog=new THREE.Fog('#cfe2ec',...G.fog);
const camera=new THREE.PerspectiveCamera(45,view()[0]/view()[1],2,G.far);
// The all-route water picture: about 7.8 m pixels on High and Ultra, 15.6 m on Low and Medium.
const FINE_PX=['high','ultra'].includes(gfx.preset)?4096:2048;
const surface=createSurface({heights,levelA:run.levels[0],levelB:run.levels[1],shareA:run.shares[0],shareB:run.shares[1],noise:makeNoiseTexture(),exaggeration:E,showDepth:SHOW_DEPTH_M,handPx:G.hand,finePx:FINE_PX});
const fineBox={e0:GRID.x0,n0:GRID.y0,w:SIZE_X,h:SIZE_Z,cols:surface.fineSize.w,rows:surface.fineSize.h};
// Frames i and i+1 of the all-route run, loaded one at a time and rasterised once each.
const finePics=new Map();let fineWant=-1,fineBusy=false;
async function showFine(i){
 fineWant=i;if(fineBusy)return;fineBusy=true;
 try{
  while(true){
   const r=run,at=fineWant,next=Math.min(r.frames.length-1,at+1);
   await Promise.all([r.quad.ensure(at),r.quad.ensure(next)]);
   if(r!==run||!r.quad)break;
   const pic=k=>{const key=r.def.id+'|'+r.quad.mode+'|'+k;if(!finePics.has(key)){if(finePics.size>=4)finePics.delete(finePics.keys().next().value);finePics.set(key,rasterize(r.quad,k,fineBox));}return finePics.get(key);};
   surface.setFine(pic(at),pic(next));
   for(const k of [next+1,next+2])if(k<r.frames.length)r.quad.ensure(k).catch(()=>{});
   if(fineWant===at)break;
  }
 }catch(error){$('model-note').textContent='A frame of the all-route run did not download: '+(error?.message??error);}
 finally{fineBusy=false;}
}
const structureMaterial=new THREE.MeshBasicNodeMaterial({vertexColors:true,side:THREE.DoubleSide});
// The app's routes, painted into the ground; the chosen area's routes stand out.
routeOverlay.lines=routes.features.map(f=>({id:f.properties.id,area:f.properties.area,parts:(f.geometry.type==='MultiLineString'?f.geometry.coordinates:[f.geometry.coordinates]).map(line=>line.map(([lon,lat])=>world(lon,lat)))}));
const chunks=createChunks(scene,surface.make(),{ground,E,structureMaterial,...chunkDetail(gfx.preset)});
// Start over the Santa Cruz River at the Avra Valley Road bridge.
const [sx,sz]=world(-111.1462,32.4026),sy=ground(sx,sz)*E;
const controls=new MapControls(camera,renderer.domElement);
controls.target.set(sx,sy,sz);camera.position.set(sx-900,sy+1500,sz+1700);
controls.enableDamping=true;controls.dampingFactor=.08;controls.maxPolarAngle=Math.PI*.46;controls.minDistance=120;controls.maxDistance=60000;controls.zoomToCursor=true;
controls.update();
// The orbit point rides on the ground so turning and zooming stay anchored to the land.
function followGround(){const g=ground(controls.target.x,controls.target.z)*E;if(Number.isFinite(g)){const dy=g-controls.target.y;controls.target.y+=dy;camera.position.y+=dy;}}
// A live run opens at the hour nearest now; saved runs at their start.
const startClock=()=>{if(!run.def.live)return 0;const now=Date.now(),i=run.frames.reduce((b,f,k)=>Math.abs(Date.parse(f.time)-now)<Math.abs(Date.parse(run.frames[b].time)-now)?k:b,0);return Math.min(run.frames.length-1.001,i);};
let playing=true,clock=startClock(),frameIndex=-1,last=performance.now(),flight=null;
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
// The app's search, when this page is its map's 3D layer (see embed.js).
window.fp3dGoto=(lon,lat,id)=>{const [x,z]=world(lon,lat);flyTo(x,z,id?900:1600);if(id)routesUI.openDetail(id);};
// --- Rain ---
const rain=createRain(scene,{toLonLat,E,...G.rain});
let rainOn=true;
$('rain').onchange=e=>{rainOn=e.target.checked;};
function frameTime(){const i=Math.max(0,Math.min(run.frames.length-2,Math.floor(clock)));return Date.parse(run.frames[i].time)+(clock-i)*(run.frameMs??3600e3);}
// --- Time and runs ---
function showFrame(i){
 const next=Math.min(run.frames.length-1,i+1);surface.setLevels(run.levels[i],run.levels[next],run.shares[i],run.shares[next]);frameIndex=i;
 // The all-route run's fine water starts at the 2D map's first band (0.03 ft), as its cells are
 // averages over 6.25 m and up rather than single 10 m lidar samples.
 surface.U.fine.value=run.quad?1:0;surface.U.show.value=run.quad?.0091:SHOW_DEPTH_M;if(run.quad)showFine(i);
 const label=new Date(run.frames[i].time).toLocaleString('en-US',{timeZone:'America/Phoenix',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
 $('time').textContent=`${label} MST`;$('scrub').value=String(i);routesUI.setFrame(i);
 showLayers();
}
// What of the all-route run lies outside this view's 32 × 35 km terrain rectangle.
function quadReach(q){
 const out=q.pkg.cases.filter(c=>{const [s,w]=c.bounds[0],[n,e]=c.bounds[1],a=world(w,s),b=world(e,n);return a[0]<-SIZE_X/2||b[0]>SIZE_X/2||b[1]<-SIZE_Z/2||a[1]>SIZE_Z/2;}).map(c=>c.label.split(':')[0]);
 return out.length?` In 3D, only the part inside this view's 32 × 35 km terrain is drawn: ${out.join(', ')} reach${out.length>1?'':'es'} beyond it. The 2D map shows all of it.`:'';
}
function describeRun(){
 $('run-note').textContent=(liveProblem&&!run.def.live?'No live model run to show: '+liveProblem+' Showing a saved run instead. ':'')+run.def.note+(run.quad?quadReach(run.quad)+(run.variant==='full'?' Drawn from every native cell.':' Drawn from the lighter web cells (50 m blocks away from the routes); High and Ultra draw every native cell.'):'');
 $('overlap-row').hidden=!run.quad;if(run.quad)$('overlap').value=run.quad.mode;$('rain').disabled=!run.rain;$('flow').disabled=!run.inflow.length;$('scrub').max=String(run.frames.length-1);
 for(const o of $('model').options)o.disabled=false;
 applyModel();
 // HAND for this run loads in the background when HAND is shown, never before the run is drawn.
 if(/hand|aggregate/.test($('model').value))setTimeout(()=>loadRunHand(run),0);
}
// --- Layers & view: the same choices as the app's 2D map ---
function applyModel(){
 const m=$('model').value;surface.U.water.value=m==='2d'||m==='aggregate'?1:0;surface.U.hand.value=m==='hand'||m==='aggregate'?1:0;
 if(surface.U.hand.value&&run)loadRunHand(run);
 handKey='';showLayers();
}
// --- HAND, the same method and flows as the 2D map (simulation/hand-runs.js) ---
let handList=null,handKey='';
function loadRunHand(r){
 r.handState??=loadHand().then(list=>{handList=list;return flowsForRun(r,list);}).then(flows=>{r.handFlows=flows;},error=>{
  r.handError=/answered 404/.test(error?.message)&&r.def.handFlows?`This run's HAND flow file (${r.def.handFlows}) is missing.`:'HAND could not load: '+(error?.message??error);
 }).finally(()=>{if(r===run){handKey='';showLayers();}});
}
function handNote(m){
 if(m==='off')return 'No simulated water is drawn. Routes, places and crossings stay.';
 if(m==='2d')return '';
 const head=m==='hand'?"HAND: a terrain-height estimate of where river water could reach for each window's river flow, not the SFINCS simulation. ":'';
 if(run.handError)return head+run.handError;
 if(!run.handFlows||!run.handHour)return head+'HAND is loading.';
 const h=run.handHour,f=run.handFlows;
 return head+`Flows: ${f.source}. ${h.wet} of ${h.windows} HAND windows have water this hour.`+(f.kind==='inflow'&&h.noFlow?` ${h.noFlow} wash windows show nothing: a what-if storm has no flow for the washes.`:h.noFlow?` ${h.noFlow} windows have no flow this hour.`:'');
}
function showHand(){
 const m=$('model').value,on=m==='hand'||m==='aggregate',key=on&&run.handFlows&&handList?run.def.id+'|'+run.times[0]+'|'+frameIndex:'off|'+run.def.id;
 if(key!==handKey){
  handKey=key;run.handHour=null;
  if(on&&run.handFlows&&handList){const hh=handHour(handList,run.handFlows,frameIndex);run.handHour=hh;surface.setHandImages(hh.shown.filter(s=>s.im.canvas).map(s=>({canvas:s.im.canvas,...windowBounds(s.j)})),world);}
  else surface.setHandImages([],world);
 }
 $('model-note').textContent=handNote(m);
}
$('model').onchange=applyModel;
$('overlap').onchange=e=>{if(!run.quad)return;run.quad.setMode(e.target.value);finePics.clear();showFine(frameIndex);showLayers();};
const markers=createMarkers($('map'),camera,ground,E);
let showFlow=true,showPlaces=true,liveNow=null,liveTimer=null;
// With the live run: the app's live ratings and closures, checked again every five minutes.
async function refreshLive(){
 if(!run.def.live){liveNow=null;routesUI.setLive(null);showLayers();return;}
 try{liveNow=await loadLiveConditions(routes);routesUI.setLive(liveNow);showLayers();
  $('live-status').textContent='Live ratings checked '+new Date(liveNow.now).toLocaleTimeString('en-US',{timeZone:'America/Phoenix',hour:'numeric',minute:'2-digit'})+' MST'+(liveNow.errors.length?' · '+liveNow.errors.join(', '):'');}
 catch(error){$('live-status').textContent='Live ratings could not load: '+error.message;}
}
function watchLive(){clearInterval(liveTimer);$('live-status').hidden=!run.def.live;refreshLive();if(run.def.live)liveTimer=setInterval(refreshLive,300000);}
function showLayers(){
 if(frameIndex<0)return;
 showHand();
 const t=Date.parse(run.frames[frameIndex].time),list=[];
 if(showFlow)for(const s of run.inflow){const q=s.points.get(t);if(q!=null)list.push({x:s.x,z:s.z,className:'flow',html:`<span>${s.name} inflow: ${Math.round(q).toLocaleString()} m³/s (${Math.round(q*35.3147).toLocaleString()} ft³/s)</span>`});}
 if(liveNow)for(const c of liveNow.closures){const [x,z]=world(c.lon,c.lat);list.push({x,z,className:'closure',html:`<span aria-hidden="true">⛔</span><em>${c.title.replace(/[<>&]/g,'')}</em>`});}
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
 if(run.quad){const xs=[],zs=[],q=run.quad;for(const c of q.cases){const f=q.peek(c,frameIndex);if(!f)continue;for(let p=0;p<f.listed.length;p++){const k=f.listed[p];if(f.depth[p]<.3||!c.drawn[c.flags[k]])continue;const s=(1<<c.lvl[k])*6.25,[x,z]=toWorld(c.e0+c.ix[k]*6.25+s/2,c.n0+c.iy[k]*6.25+s/2);if(Math.abs(x)<SIZE_X/2&&Math.abs(z)<SIZE_Z/2){xs.push(x);zs.push(z);}}}return fitBox(xs,zs);}
 // Every model cell with water deeper than 0.3 m this hour.
 const f=run.frames[frameIndex],xs=[],zs=[];data.vertices.forEach((v,k)=>{const s=f.surface[k];if(!Number.isNaN(s)&&s-v[2]>.3){const [x,z]=toWorld(GRID.x0+(v[4]+.5)*GRID.dx,GRID.y0+(v[3]+.5)*GRID.dx);xs.push(x);zs.push(z);}});
 fitBox(xs,zs);
};
$('prev').onclick=()=>{playing=false;showPlaying();clock=Math.max(0,frameIndex-1);};
$('next').onclick=()=>{playing=false;showPlaying();clock=Math.min(run.frames.length-2,frameIndex+1);};
$('run').innerHTML=RUNS.map(r=>`<option value="${r.id}"${r.id===run.def.id?' selected':''}>${r.label}</option>`).join('');
// A newer choice made while one is loading replaces it: only the newest one is drawn.
let switchId=0;
$('run').onchange=async e=>{
 const ticket=++switchId;
 const def=RUNS.find(r=>r.id===e.target.value);$('run').disabled=true;status('Loading '+def.label);loading('Loading '+def.label,.3);
 try{liveProblem=null;const next=await prepareRun(def);if(ticket!==switchId)return;run=next;loading('Preparing the model water',.8);routesUI.setRun(run);clock=startClock();frameIndex=-1;describeRun();watchLive();status(`${def.label}: ${run.frames.length} ${run.quad?'frames':'hours'}.`);}
 catch(error){if(ticket!==switchId)return;if(def.live){liveProblem=error.message;$('run').value=run.def.id;describeRun();}else fail(error);}finally{if(ticket===switchId){$('run').disabled=false;loaded();}}
};
const PLAY='<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>',PAUSE='<svg viewBox="0 0 24 24"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>';
const showPlaying=()=>{$('play').innerHTML=playing?PAUSE:PLAY;$('play').setAttribute('aria-label',playing?'Pause':'Play');};
$('play').onclick=()=>{playing=!playing;showPlaying();};
$('scrub').oninput=e=>{playing=false;showPlaying();clock=Number(e.target.value);};
describeRun();watchLive();
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
// The app pauses drawing while this view is out of sight (embed.js).
let drawPaused=false;window.fp3dPause=p=>{drawPaused=!!p;};
const graphics=mountGraphics({start:gfx,renderer,scene,camera,chunks,rain,size:view,busy:()=>!$('loading').classList.contains('done'),log:message=>{console.info(message);try{if(parent!==window)parent.postMessage({fp3d:'log',kind:'info',message},location.origin);}catch{}}});
renderer.setAnimationLoop(()=>{if(drawPaused)return;
 const now=performance.now(),dt=Math.max(0,Math.min(200,now-last)),span=run.frames.length-1;last=now;
 if(playing)clock=((clock+dt/1000/(HOUR_SECONDS*(run.frameMs??3600e3)/3600e3))%span+span)%span;
 const i=Math.min(span-1,Math.floor(clock));if(i!==frameIndex)showFrame(i);
 surface.U.alpha.value=clock-i;surface.U.time.value=now/1000;
 controls.update();followGround();flyStep(now);chunks.update(camera);labels.update();routesUI.update();markers.update();
 rainNow=rain.update(dt/1000,{rain:run.rain,time:frameTime(),target:controls.target,cameraDistance:camera.position.distanceTo(controls.target),groundAt:ground,enabled:rainOn});
 renderer.render(scene,camera);graphics.frame(dt,now);
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
window.world={graphics,renderer,scene,camera,controls,chunks,diagnostics,ground,filled,labels,places,flyTo,routesUI,get run(){return run;},setClock:v=>{playing=false;clock=v;},get frameIndex(){return frameIndex;}};
window.world.hand={canvas:surface.handCanvas,get flows(){return run.handFlows;},get hour(){return run.handHour;},get error(){return run.handError;}};
