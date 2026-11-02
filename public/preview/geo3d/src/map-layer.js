// The toon water as a MapLibre custom layer: same GL context, same camera, on the
// map's own terrain. The demo's shader and solver run unedited, in scene units.
import * as maplibre from '../vendor/maplibre/maplibre-gl.mjs';
import * as THREE from 'three/webgpu';
import {renderOutput} from 'three/tsl';
import {GRID} from '../../coastal-lowcost/src/coast.js?v=1.3.0';
import {makeNoiseTexture} from '../../coastal-lowcost/src/noise.js?v=1.3.0';
import {createShading} from '../../coastal-lowcost/src/shading.js?v=1.3.0';
import {SCENE,fineGrid} from './scene-config.js';
import {sceneHeights,sampleHeights,tileUrl} from './elevation.js';
import {loadSceneData} from './data-source.js';
import {coarseBed,pickChannels} from './channels.js';
import {mountAcknowledgement} from './acknowledge.js';
const $=id=>document.getElementById(id);
const DEM=tileUrl('{z}','{x}','{y}');
const diagnostics={ready:false,errors:[],frameTimes:[],layerMs:[],renders:0};
const fail=error=>{diagnostics.errors.push(String(error?.stack||error));$('error').hidden=false;$('error-detail').textContent=String(error?.message||error);};
window.addEventListener('error',e=>fail(e.error||e.message));window.addEventListener('unhandledrejection',e=>fail(e.reason));
const makeField=()=>{const t=new THREE.DataTexture(new Float32Array(GRID.nx*GRID.nz*4),GRID.nx,GRID.nz,THREE.RGBAFormat,THREE.FloatType);t.minFilter=t.magFilter=THREE.LinearFilter;t.needsUpdate=true;return t;};
const fields={surface:makeField(),previous:makeField(),material:makeField(),previousMaterial:makeField(),flow:makeField(),previousFlow:makeField()};
function waterGeometry(fine,heights){
 const positions=new Float32Array(fine.nx*fine.nz*3),indices=new Uint32Array((fine.nx-1)*(fine.nz-1)*6);
 let w=0;
 for(let j=0;j<fine.nz;j++)for(let i=0;i<fine.nx;i++){
  const k=(j*fine.nx+i)*3;positions[k]=fine.x0+i*fine.dx;positions[k+2]=fine.z0+j*fine.dz;
  if(i<fine.nx-1&&j<fine.nz-1){const p=j*fine.nx+i,q=p+1,r=p+fine.nx,s=r+1;indices[w++]=p;indices[w++]=r;indices[w++]=q;indices[w++]=q;indices[w++]=r;indices[w++]=s;}
 }
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(positions,3));g.setAttribute('sandHeight',new THREE.BufferAttribute(heights,1));g.setIndex(new THREE.BufferAttribute(indices,1));g.computeBoundingSphere();return g;
}
// Scene units to the map's mercator space. Scene: +x north, +y up, +z east.
function sceneToMercator(lowMetres){
 const V=SCENE.visible,origin=maplibre.MercatorCoordinate.fromLngLat([SCENE.center.lon,SCENE.center.lat],0),m=origin.meterInMercatorCoordinateUnits();
 const horizontal=SCENE.metresPerUnit*m,E=SCENE.verticalExaggeration,vertical=SCENE.metresPerUnit/E*m*E;
 return new THREE.Matrix4().set(
  0,0,horizontal,origin.x-(V.z0+V.z1)/2*horizontal,
  -horizontal,0,0,origin.y+(V.x0+V.x1)/2*horizontal,
  0,vertical,0,(lowMetres*E-SCENE.baseHeight*vertical/m)*m,
  0,0,0,1);
}
mountAcknowledgement();
const data=await loadSceneData(),fine=fineGrid(),raw=sceneHeights(data.metres),low=data.metres.reduce((a,b)=>Math.min(a,b),Infinity);
const channels=pickChannels(coarseBed(raw,fine,GRID,sampleHeights),GRID,2,0);
const map=new maplibre.Map({container:'map',pixelRatio:Math.min(devicePixelRatio,.75),canvasContextAttributes:{antialias:false},center:[SCENE.center.lon,SCENE.center.lat],zoom:12.3,pitch:62,bearing:-35,maxPitch:80,
 style:{version:8,sources:{
  dem:{type:'raster-dem',tiles:[DEM],encoding:'terrarium',tileSize:256,maxzoom:13,attribution:'Terrain Tiles (Mapzen, AWS Open Data)'},
  shade:{type:'raster-dem',tiles:[DEM],encoding:'terrarium',tileSize:256,maxzoom:13},
  osm:{type:'raster',tiles:['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],tileSize:256,maxzoom:18,attribution:'© OpenStreetMap'}},
  layers:[{id:'osm',type:'raster',source:'osm'},{id:'relief',type:'hillshade',source:'shade',paint:{'hillshade-exaggeration':.6}}],terrain:{source:'dem',exaggeration:SCENE.verticalExaggeration}}});
let renderer,shaders,worker,pending=null,simTime=0,previousTime=0,renderClock=0,last=performance.now(),rendering=null;
const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera();camera.matrixAutoUpdate=false;camera.matrixWorldAutoUpdate=false;
const transform=sceneToMercator(low),clip=new THREE.Matrix4();
function recycle(p){worker.postMessage({type:'recycle',surface:p.surface,material:p.material,flow:p.flow},[p.surface.buffer,p.material.buffer,p.flow.buffer]);}
function install(p,initial=false){
 const recycled={};
 for(const [key,previous] of [['surface','previous'],['material','previousMaterial'],['flow','previousFlow']]){
  if(initial){fields[key].image.data=p[key];fields[previous].image.data=p[key];fields[key].needsUpdate=fields[previous].needsUpdate=true;}
  else{const spare=fields[previous],old=spare.image.data;fields[previous]=fields[key];fields[key]=spare;spare.image.data=p[key];spare.needsUpdate=true;if(old!==fields[previous].image.data)recycled[key]=old;}
 }
 shaders.bindFields();
 if(recycled.surface&&recycled.material&&recycled.flow)recycle(recycled);
 previousTime=initial?p.time:simTime;simTime=p.time;if(initial)renderClock=p.time-.06;
 shaders.U.alpha.value=initial?1:0;shaders.U.time.value=previousTime;
}
// Three caches every GL binding, and MapLibre changes them between frames. Without
// this, Three skips binds it believes are done and draws with MapLibre's textures.
let cleanState=null;
function forgetCachedGlState(gl){
 const state=renderer.backend.state;
 cleanState??=new state.constructor(renderer.backend);
 for(const key of Object.keys(state))if(key.startsWith('current')){
  const value=cleanState[key];state[key]=value&&typeof value==='object'&&!ArrayBuffer.isView(value)&&Object.getPrototypeOf(value)===Object.prototype?{}:value;
 }
 state.enabled={};state.parameters={};
 gl.disable(gl.BLEND);
}
const layer={id:'simulated-water',type:'custom',renderingMode:'3d',
 async onAdd(_,gl){
  renderer=new THREE.WebGPURenderer({canvas:map.getCanvas(),context:gl,forceWebGL:true,antialias:false});
  // Renderer-level tone mapping would paint a full-screen quad over the map's frame, so
  // the same tone and colour conversion runs on the water's own material instead.
  renderer.autoClear=false;renderer.toneMapping=THREE.NoToneMapping;renderer.outputColorSpace=THREE.LinearSRGBColorSpace;renderer.shadowMap.enabled=true;
  await renderer.init();
  shaders=createShading(makeNoiseTexture(),fields);
  shaders.water.fragmentNode=renderOutput(shaders.water.fragmentNode,THREE.NeutralToneMapping,THREE.SRGBColorSpace);
  // Mercator's y axis points south, which flips the triangles' winding.
  shaders.water.side=THREE.DoubleSide;
  const water=new THREE.Mesh(waterGeometry(fine,raw),shaders.water);water.frustumCulled=false;scene.add(water,shaders.sunLight,shaders.sunLight.target);
  // The unedited toon shader samples a shadow map. Nothing here casts one, so a tiny static map will do.
  shaders.sunLight.shadow.mapSize.set(16,16);shaders.sunLight.shadow.autoUpdate=false;shaders.sunLight.shadow.needsUpdate=true;
  worker=new Worker(new URL('./worker.js',import.meta.url),{type:'module'});
  worker.onerror=e=>fail(e.message);
  worker.onmessage=({data:m})=>{
   if(m.type==='progress')return;
   if(m.type==='ready'){install(m,true);diagnostics.ready=true;last=performance.now();worker.postMessage({type:'pause',value:false});map.triggerRepaint();return;}
   if(pending)recycle(pending);pending=m;
  };
  worker.postMessage({type:'init',grid:{...GRID},bed:channels.bed,sources:channels.sources});
 },
 render(gl,args){
  if(!diagnostics.ready)return;
  const at=performance.now(),now=at,dt=now-last;last=now;
  renderClock+=dt/1000;
  if(pending&&renderClock>=simTime){const next=pending;pending=null;install(next);}
  shaders.U.alpha.value=Math.max(0,Math.min(1,(renderClock-previousTime)/Math.max(1e-6,simTime-previousTime)));
  shaders.U.time.value=previousTime+(simTime-previousTime)*shaders.U.alpha.value;
  clip.fromArray(args.defaultProjectionData.mainMatrix).multiply(transform);
  camera.projectionMatrix.copy(clip);camera.projectionMatrixInverse.copy(clip).invert();shaders.updateCamera(camera);
  forgetCachedGlState(gl);
  renderer.render(scene,camera);
  map.triggerRepaint();
  diagnostics.renders++;diagnostics.frameTimes.push(dt);diagnostics.layerMs.push(performance.now()-at);
  if(diagnostics.frameTimes.length>600){diagnostics.frameTimes.shift();diagnostics.layerMs.shift();}
 }};
map.on('load',()=>map.addLayer(layer));
map.on('error',e=>diagnostics.errors.push(String(e.error?.message||e.error)));
setInterval(()=>{const t=diagnostics.frameTimes.slice(-120);if(t.length)$('metrics').textContent=`${(1000/(t.reduce((a,b)=>a+b,0)/t.length)).toFixed(1)} FPS · ${data.source.label}`;},1000);
window.geo3dMap={map,diagnostics,scene,channels,transform,clip,camera,fields,raw,fine,get renderer(){return renderer;},get shaders(){return shaders;}};
