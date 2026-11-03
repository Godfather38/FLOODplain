// The toon water as a MapLibre custom layer: same GL context, same camera, on the
// map's own terrain. The demo's shader and solver run unedited, in scene units.
// One small solver window follows the view, anchored on the nearest real crossing.
import * as maplibre from '../vendor/maplibre/maplibre-gl.mjs';
import * as THREE from 'three/webgpu';
import {renderOutput} from 'three/tsl';
import {GRID} from '../../coastal-lowcost/src/coast.js?v=1.3.0';
import {makeNoiseTexture} from '../../coastal-lowcost/src/noise.js?v=1.3.0';
import {createShading} from '../../coastal-lowcost/src/shading.js?v=1.3.0';
import {SCENE,fineGrid,place,setPlace,project,unproject} from './scene-config.js';
import {sceneHeights,sampleHeights} from './elevation.js';
import {loadLiveHeights,loadTile} from './data-source.js';
import {channelsFromLines,ribbonMask} from './channels.js';
import {drainageNetwork,withWander,carveField,sampleField,streamChains} from './network.js';
import {COVERAGE,MIN_WATER_ZOOM,chooseWindow} from './water-window.js';
import {buildRoadMesh,parseRoadHeights} from './roads-3d.js';
import {mountAcknowledgement} from './acknowledge.js';
const $=id=>document.getElementById(id);
const DATA='../../../data/';
const diagnostics={ready:false,errors:[],frameTimes:[],layerMs:[],renders:0,windows:[],rebuildMs:null};
const fail=error=>{diagnostics.errors.push(String(error?.stack||error));$('error').hidden=false;$('error-detail').textContent=String(error?.message||error);};
window.addEventListener('error',e=>fail(e.error||e.message));window.addEventListener('unhandledrejection',e=>fail(e.reason));
mountAcknowledgement();
const makeField=()=>{const t=new THREE.DataTexture(new Float32Array(GRID.nx*GRID.nz*4),GRID.nx,GRID.nz,THREE.RGBAFormat,THREE.FloatType);t.minFilter=t.magFilter=THREE.LinearFilter;t.needsUpdate=true;return t;};
const fields={surface:makeField(),previous:makeField(),material:makeField(),previousMaterial:makeField(),flow:makeField(),previousFlow:makeField()};
const fine=fineGrid();
function waterGeometry(){
 const positions=new Float32Array(fine.nx*fine.nz*3),indices=new Uint32Array((fine.nx-1)*(fine.nz-1)*6);
 let w=0;
 for(let j=0;j<fine.nz;j++)for(let i=0;i<fine.nx;i++){
  const k=(j*fine.nx+i)*3;positions[k]=fine.x0+i*fine.dx;positions[k+2]=fine.z0+j*fine.dz;
  if(i<fine.nx-1&&j<fine.nz-1){const p=j*fine.nx+i,q=p+1,r=p+fine.nx,s=r+1;indices[w++]=p;indices[w++]=r;indices[w++]=q;indices[w++]=q;indices[w++]=r;indices[w++]=s;}
 }
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(positions,3));g.setAttribute('sandHeight',new THREE.BufferAttribute(new Float32Array(fine.nx*fine.nz),1));g.setIndex(new THREE.BufferAttribute(indices,1));g.computeBoundingSphere();return g;
}
// Scene units to the map's mercator space. Scene: +x north, +y up, +z east.
function sceneToMercator(lowMetres){
 const V=SCENE.visible,origin=maplibre.MercatorCoordinate.fromLngLat([place.lon,place.lat],0),m=origin.meterInMercatorCoordinateUnits();
 const horizontal=SCENE.metresPerUnit*m,E=SCENE.verticalExaggeration,vertical=SCENE.metresPerUnit*m;
 return new THREE.Matrix4().set(
  0,0,horizontal,origin.x-(V.z0+V.z1)/2*horizontal,
  -horizontal,0,0,origin.y+(V.x0+V.x1)/2*horizontal,
  0,vertical,0,(lowMetres*E-SCENE.baseHeight*SCENE.metresPerUnit)*m,
  0,0,0,1);
}
// The whole area's drainage, from live elevation, before the map asks for any terrain.
const NET_ZOOM=11,TILE=256,worldX=(lon,z)=>(lon+180)/360*TILE*2**z,worldY=(lat,z)=>{const r=lat*Math.PI/180;return(1-Math.log(Math.tan(r)+1/Math.cos(r))/Math.PI)/2*TILE*2**z;};
const netLeft=Math.floor(worldX(COVERAGE.west,NET_ZOOM)/TILE)*TILE,netTop=Math.floor(worldY(COVERAGE.north,NET_ZOOM)/TILE)*TILE,netRight=Math.ceil(worldX(COVERAGE.east,NET_ZOOM)/TILE)*TILE,netBottom=Math.ceil(worldY(COVERAGE.south,NET_ZOOM)/TILE)*TILE;
const netW=netRight-netLeft,netH=netBottom-netTop,netMetres=new Float32Array(netW*netH),netTiles=[];
for(let y=netTop/TILE;y<netBottom/TILE;y++)for(let x=netLeft/TILE;x<netRight/TILE;x++)netTiles.push({z:NET_ZOOM,x,y});
for(const t of await Promise.all(netTiles.map(loadTile))){
 const ox=t.x*TILE-netLeft,oy=t.y*TILE-netTop;
 for(let j=0;j<TILE;j++)for(let i=0;i<TILE;i++){const q=(j*TILE+i)*4;netMetres[(oy+j)*netW+ox+i]=t.rgba[q]*256+t.rgba[q+1]+t.rgba[q+2]/256-32768;}
}
const net=drainageNetwork(withWander(netMetres,netW,netH),netW,netH),cuts=carveField(net,netMetres);
const cutAt=(lon,lat)=>sampleField(cuts,netW,netH,worldX(lon,NET_ZOOM)-netLeft,worldY(lat,NET_ZOOM)-netTop);
const cellLonLat=k=>{const i=k%netW,j=(k-i)/netW,n=TILE*2**NET_ZOOM;return{lon:(i+netLeft)/n*360-180,lat:Math.atan(Math.sinh(Math.PI*(1-2*(j+netTop)/n)))*180/Math.PI};};
// Terrain tiles reach the map with the channels already cut, so banks catch real hillshade.
maplibre.addProtocol('carved',async ({url})=>{
 const [z,x,y]=url.slice('carved://'.length).split('/').map(Number),tile=await loadTile({z,x,y}),{rgba}=tile,n=TILE*2**z;
 if(z>=NET_ZOOM-2)for(let j=0;j<TILE;j++){
  const lat=Math.atan(Math.sinh(Math.PI*(1-2*(y*TILE+j+.5)/n)))*180/Math.PI;
  for(let i=0;i<TILE;i++){
   const lon=(x*TILE+i+.5)/n*360-180,cut=cutAt(lon,lat);if(!cut)continue;
   const q=(j*TILE+i)*4,value=Math.max(0,rgba[q]*256+rgba[q+1]+rgba[q+2]/256-cut);
   rgba[q]=Math.floor(value/256);rgba[q+1]=Math.floor(value%256);rgba[q+2]=Math.floor(value*256%256);
  }
 }
 return{data:await createImageBitmap(new ImageData(rgba,TILE,TILE),{premultiplyAlpha:'none',colorSpaceConversion:'none'})};
});
function basemapStyle(){
 const road=(id,classes,color,widths)=>({id,type:'line',source:'omt','source-layer':'transportation',filter:['all',['in',['get','class'],['literal',classes]],['!=',['get','brunnel'],'bridge']],layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':color,'line-width':['interpolate',['exponential',1.6],['zoom'],...widths]}});
 const FONT=['Noto Sans Regular'];
 return{version:8,glyphs:'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',sources:{omt:{type:'vector',url:'https://tiles.openfreemap.org/planet'},
  dem:{type:'raster-dem',tiles:['carved://{z}/{x}/{y}'],encoding:'terrarium',tileSize:256,maxzoom:13,attribution:'Terrain Tiles (Mapzen, AWS Open Data)'},
  shade:{type:'raster-dem',tiles:['carved://{z}/{x}/{y}'],encoding:'terrarium',tileSize:256,maxzoom:13},
  routes:{type:'geojson',data:new URL(DATA+'routes.geojson',import.meta.url).href}},
 layers:[
  {id:'ground',type:'background',paint:{'background-color':'#e2d5ba'}},
  {id:'landcover',type:'fill',source:'omt','source-layer':'landcover',paint:{'fill-color':'#c9cfa4','fill-opacity':.45}},
  {id:'parks',type:'fill',source:'omt','source-layer':'park',paint:{'fill-color':'#b9cf9c','fill-opacity':.35}},
  {id:'landuse',type:'fill',source:'omt','source-layer':'landuse',filter:['in',['get','class'],['literal',['residential','suburb','neighbourhood']]],paint:{'fill-color':'#e9e2d2','fill-opacity':.6}},
  {id:'relief',type:'hillshade',source:'shade',paint:{'hillshade-exaggeration':1,'hillshade-shadow-color':'#3b2a18','hillshade-highlight-color':'#fff6e0','hillshade-accent-color':'#6d5433','hillshade-illumination-direction':315}},
  {id:'waterway',type:'line',source:'omt','source-layer':'waterway',paint:{'line-color':'#a9c7cf','line-width':1,'line-opacity':.7}},
  road('minor',['minor','service','track'],'#fbfaf6',[11,.2,16,6]),
  road('tertiary',['tertiary'],'#ffffff',[9,.4,16,8]),
  road('secondary',['secondary'],'#ffffff',[8,.6,16,11]),
  road('primary',['primary'],'#fbe3a6',[7,.8,16,14]),
  road('trunk',['trunk'],'#f9d17f',[6,1,16,18]),
  road('motorway',['motorway'],'#f2b64e',[5,1.2,16,24]),
  {id:'routes',type:'line',source:'routes',paint:{'line-color':'#2f6fb0','line-width':['interpolate',['linear'],['zoom'],9,1.5,15,5],'line-opacity':.55}},
  {id:'buildings',type:'fill-extrusion',source:'omt','source-layer':'building',minzoom:13,paint:{'fill-extrusion-color':'#efe7d8','fill-extrusion-height':['*',['coalesce',['get','render_height'],5],2],'fill-extrusion-opacity':.92}},
  {id:'road-names',type:'symbol',source:'omt','source-layer':'transportation_name',minzoom:12,layout:{'symbol-placement':'line','text-field':['get','name'],'text-font':FONT,'text-size':12},paint:{'text-color':'#4a4640','text-halo-color':'#fff','text-halo-width':1.4}},
  {id:'water-names',type:'symbol',source:'omt','source-layer':'waterway',minzoom:12,layout:{'symbol-placement':'line','text-field':['get','name'],'text-font':FONT,'text-size':11},paint:{'text-color':'#2f6f86','text-halo-color':'#fff','text-halo-width':1.2}},
  {id:'places',type:'symbol',source:'omt','source-layer':'place',layout:{'text-field':['get','name'],'text-font':FONT,'text-size':14},paint:{'text-color':'#332f29','text-halo-color':'#fff','text-halo-width':1.6}},
 ],terrain:{source:'dem',exaggeration:SCENE.verticalExaggeration}};
}
const map=new maplibre.Map({container:'map',pixelRatio:Math.min(devicePixelRatio,1),canvasContextAttributes:{antialias:false},center:[-111.19,32.335],zoom:12.6,pitch:62,bearing:-35,maxPitch:80,
 style:basemapStyle()});
let renderer,shaders,worker=null,water=null,crossings=[],current=null,building=0,pending=null,simTime=0,previousTime=0,renderClock=0,last=performance.now();
const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera();camera.matrixAutoUpdate=false;camera.matrixWorldAutoUpdate=false;
const transform=new THREE.Matrix4(),clip=new THREE.Matrix4();
function recycle(p){worker?.postMessage({type:'recycle',surface:p.surface,material:p.material,flow:p.flow},[p.surface.buffer,p.material.buffer,p.flow.buffer]);}
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
 if(p.metrics)diagnostics.metrics=p.metrics;
}
const WATER_SCALE=.05,ROAD_CLASSES=['motorway','trunk','primary','secondary','tertiary'];
// Road models, rebuilt from the vector tiles the map has loaded for this view.
let roadMesh=null,anchors=[],roadsDirty=true,roadTimer=null;
const roadFrame=new THREE.Matrix4();
function placeRoads(){if(roadMesh){roadMesh.matrix.copy(transform).invert().multiply(roadFrame);roadMesh.matrixWorldNeedsUpdate=true;}}
const scheduleRoads=()=>{roadsDirty=true;clearTimeout(roadTimer);roadTimer=setTimeout(rebuildRoads,250);};
function rebuildRoads(){
 if(!roadsDirty||!shaders)return;
 if(!map.isSourceLoaded('omt')){roadTimer=setTimeout(rebuildRoads,500);return;}
 roadsDirty=false;const at=performance.now();
 const c=map.getCenter(),O=maplibre.MercatorCoordinate.fromLngLat([c.lng,c.lat],0),s=O.meterInMercatorCoordinateUnits();
 const local=(lon,lat)=>{const m=maplibre.MercatorCoordinate.fromLngLat([lon,lat],0);return[(m.x-O.x)/s,(m.y-O.y)/s];};
 const fromLocal=(x,y)=>new maplibre.MercatorCoordinate(O.x+x*s,O.y+y*s,0).toLngLat();
 const zoom=map.getZoom(),seen=new Set(),roads=[];
 for(const f of map.querySourceFeatures('omt',{sourceLayer:'transportation'})){
  const cls=f.properties.class,bridge=f.properties.brunnel==='bridge';
  if(!(ROAD_CLASSES.includes(cls)||(bridge&&zoom>=13&&cls==='minor')))continue;
  for(const line of f.geometry.type==='MultiLineString'?f.geometry.coordinates:f.geometry.type==='LineString'?[f.geometry.coordinates]:[]){
   const key=[cls,line[0],line.at(-1)].join();if(seen.has(key))continue;seen.add(key);
   roads.push({cls,bridge,points:line.map(([lon,lat])=>local(lon,lat))});
  }
 }
 const mesh=buildRoadMesh(roads,(x,y)=>map.queryTerrainElevation(fromLocal(x,y)),{anchors:anchors.map(a=>{const[x,y]=local(a.lon,a.lat);return{...a,x,y};}),exaggeration:SCENE.verticalExaggeration});
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(mesh.positions,3));g.setAttribute('color',new THREE.BufferAttribute(mesh.colors,3));g.setIndex(new THREE.BufferAttribute(mesh.indices,1));
 if(!roadMesh){roadMesh=new THREE.Mesh(g,new THREE.MeshBasicNodeMaterial({vertexColors:true,side:THREE.DoubleSide}));roadMesh.frustumCulled=false;roadMesh.matrixAutoUpdate=false;scene.add(roadMesh);}
 else{roadMesh.geometry.dispose();roadMesh.geometry=g;}
 roadFrame.set(s,0,0,O.x, 0,s,0,O.y, 0,0,s,0, 0,0,0,1);
 placeRoads();
 diagnostics.roads={count:roads.length,bridges:roads.filter(r=>r.bridge).length,vertices:mesh.positions.length/3,dropped:mesh.dropped,ms:Math.round(performance.now()-at)};
 map.triggerRepaint();
}
// The old water stays on screen until the new window has finished warming up.
async function moveWater(target){
 const token=++building,at=performance.now();
 setPlace(target.lat,target.lon);
 const metres=await loadLiveHeights();
 if(token!==building)return;
 // The same cuts the map's terrain has, so water and banks line up.
 for(let j=0;j<fine.nz;j++)for(let i=0;i<fine.nx;i++){const {lon,lat}=unproject(fine.x0+i*fine.dx,fine.z0+j*fine.dz);metres[j*fine.nx+i]-=cutAt(lon,lat);}
 const raw=sceneHeights(metres),low=metres.reduce((a,b)=>Math.min(a,b),Infinity),V=SCENE.visible;
 const inWindow=k=>{const c=cellLonLat(k),p=project(c.lon,c.lat);return p.x>=V.x0&&p.x<=V.x1&&p.z>=V.z0&&p.z<=V.z1;};
 const chains=streamChains(net,inWindow);
 if(!chains.length){building++;water.visible=false;worker?.postMessage({type:'pause',value:true});current=target;$('window').textContent='No channel large enough in this part of the view.';return;}
 const lines=chains.map(({cells})=>{let level=Infinity;return cells.map(k=>{const c=cellLonLat(k),p=project(c.lon,c.lat);level=Math.min(level-.002,sampleHeights(raw,fine,p.x,p.z)+.03);return{x:p.x,z:p.z,level};});});
 const nextTransform=sceneToMercator(low),channels=channelsFromLines(lines,raw,fine,GRID,sampleHeights,chains.map(c=>c.size)),mask=ribbonMask(raw,fine,lines,1.5,.5);
 // One scene unit of height is 25 real metres. This inflow gives depths of a few real metres.
 for(const source of channels.sources)source.rate*=WATER_SCALE;
 const next=new Worker(new URL('./worker.js',import.meta.url),{type:'module'});
 next.onerror=e=>fail(e.message);
 next.onmessage=({data:m})=>{
  if(token!==building){next.terminate();return;}
  if(m.type==='progress')return;
  if(m.type==='ready'){
   worker?.terminate();worker=next;pending=null;
   water.geometry.attributes.sandHeight.array.set(mask);water.geometry.attributes.sandHeight.needsUpdate=true;
   transform.copy(nextTransform);placeRoads();install(m,true);
   current=target;diagnostics.lines=lines;diagnostics.mask=mask;diagnostics.bed=channels.bed;diagnostics.sources=channels.sources;water.visible=true;diagnostics.ready=true;diagnostics.rebuildMs=performance.now()-at;diagnostics.windows.push(target.name);
   last=performance.now();worker.postMessage({type:'pause',value:document.hidden});
   $('window').textContent=target.name?`Simulated water near ${target.name}.`:'Simulated water near this view.';
   map.triggerRepaint();return;
  }
  if(pending)recycle(pending);pending=m;
 };
 next.postMessage({type:'init',grid:{...GRID},bed:channels.bed,sources:channels.sources,fill:channels.fill});
}
function followView(){
 if(!water||!crossings.length)return;
 const c=map.getCenter(),decision=chooseWindow({lat:c.lat,lon:c.lng,zoom:map.getZoom()},crossings,current);
 if(decision.action==='hide'){building++;water.visible=false;worker?.postMessage({type:'pause',value:true});current=null;$('window').textContent=decision.reason;}
 else if(decision.action==='move')moveWater(decision.target).catch(fail);
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
  water=new THREE.Mesh(waterGeometry(),shaders.water);water.frustumCulled=false;water.visible=false;scene.add(water,shaders.sunLight,shaders.sunLight.target);
  // The unedited toon shader samples a shadow map. Nothing here casts one, so a tiny static map will do.
  shaders.sunLight.shadow.mapSize.set(16,16);shaders.sunLight.shadow.autoUpdate=false;shaders.sunLight.shadow.needsUpdate=true;
  const response=await fetch(new URL(DATA+'crossings.geojson',import.meta.url),{cache:'no-store'});
  if(!response.ok)throw new Error(`Crossings answered ${response.status}`);
  crossings=(await response.json()).features.map(f=>({lon:f.geometry.coordinates[0],lat:f.geometry.coordinates[1],name:f.properties.water||f.properties.road||''}));
  const heights=await fetch(new URL('../../../inundation/road-heights.json',import.meta.url),{cache:'no-store'});
  if(!heights.ok)throw new Error('Road heights answered '+heights.status);
  anchors=parseRoadHeights(await heights.json());
  map.on('moveend',followView);map.on('moveend',scheduleRoads);map.on('sourcedata',e=>{if(e.sourceId==='omt'&&e.isSourceLoaded)scheduleRoads();});map.on('resize',()=>{const c=map.getCanvas();renderer.setDrawingBufferSize(c.width,c.height,1);map.triggerRepaint();});
  followView();scheduleRoads();
 },
 render(gl,args){
  if(!diagnostics.ready)return;
  const at=performance.now(),dt=at-last;last=at;
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
document.addEventListener('visibilitychange',()=>{if(water?.visible)worker?.postMessage({type:'pause',value:document.hidden});if(!document.hidden){last=performance.now();map.triggerRepaint();}});
setInterval(()=>{const t=diagnostics.frameTimes.slice(-120);if(t.length)$('metrics').textContent=`${(1000/(t.reduce((a,b)=>a+b,0)/t.length)).toFixed(1)} FPS`;},1000);
window.geo3dMap={map,diagnostics,COVERAGE,MIN_WATER_ZOOM,get renderer(){return renderer;},get current(){return current;},get water(){return water;},get anchors(){return anchors;},fields,transform,fine,GRID,sceneToWorld:(x,y,z)=>new THREE.Vector3(x,y,z).applyMatrix4(transform)};
