// The saved SFINCS run in 3D on MapLibre. Ground is the model's own 10 m lidar inside its
// domain, water is the model's hourly water surface, roads and bridges sit on that ground.
// Nothing is carved, smoothed or invented; what is not known is not drawn.
import * as maplibre from '../vendor/maplibre/maplibre-gl.mjs';
import * as THREE from 'three/webgpu';
import {Fn,attribute,uniform,float,vec2,vec3,vec4,color,texture,textureLoad,ivec2,positionLocal,mix,smoothstep,clamp,max,floor,varying,If,Discard,renderOutput} from 'three/tsl';
import {makeNoiseTexture} from '../../coastal-lowcost/src/noise.js?v=1.3.0';
import {SCENE} from './scene-config.js';
import {loadTile} from './data-source.js';
import {GRID,makeSampler,parseFrames,buildIndex} from './run-data.js';
import {toUtm,fromUtm as utmToLonLat} from './utm.js';
import {wetCells,terrainAtlas,buildWaterMesh,frameSurface,wetShare,SHOW_DEPTH_M} from './run-water.js';
import {buildRoadMesh,parseRoadHeights,LODS,lodFor} from './roads-3d.js';
import {mountAcknowledgement} from './acknowledge.js';
const $=id=>document.getElementById(id);
const RUN='../../../simulation/data/',E=SCENE.verticalExaggeration,HOUR_SECONDS=4;
const diagnostics={ready:false,errors:[],frameTimes:[],renders:0};
const fail=error=>{diagnostics.errors.push(String(error?.stack||error));$('error').hidden=false;$('error-detail').textContent=String(error?.message||error);};
window.addEventListener('error',e=>fail(e.error||e.message));window.addEventListener('unhandledrejection',e=>fail(e.reason));
mountAcknowledgement();
const status=text=>{$('window').textContent=text;};
// Some hosts send .gz files already unpacked, so only unpack what is still gzip.
async function fetchMaybeGzip(path){
 const response=await fetch(new URL(path,import.meta.url));
 if(!response.ok)throw new Error(`${path} answered ${response.status}`);
 const bytes=new Uint8Array(await response.arrayBuffer());
 if(bytes[0]!==0x1f||bytes[1]!==0x8b)return bytes;
 return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
}
status('Loading the saved SFINCS run');
const [displayBytes,terrainBytes,heightsJson]=await Promise.all([
 fetchMaybeGzip(RUN+'frozen-terrain-display.json.gz'),fetchMaybeGzip(RUN+'frozen-voxel-terrain.f32.gz'),
 fetch(new URL('../../../inundation/road-heights.json',import.meta.url),{cache:'no-store'}).then(r=>{if(!r.ok)throw new Error('Road heights answered '+r.status);return r.json();}),
]);
const display=JSON.parse(new TextDecoder().decode(displayBytes)),terrain=new Float32Array(terrainBytes.buffer,terrainBytes.byteOffset,terrainBytes.byteLength/4);
const data={vertices:display.vertices,terrain},index=buildIndex(data.vertices),sampler=makeSampler(data,index),frames=parseFrames(display);
const DOMAIN={west:-111.35,east:-110.99,south:32.28,north:32.61};
const inDomain=(lon,lat)=>lon>DOMAIN.west&&lon<DOMAIN.east&&lat>DOMAIN.south&&lat<DOMAIN.north;
// Terrain tiles: the model's lidar wherever the model has a cell, public elevation elsewhere.
const TILE=256;
maplibre.addProtocol('sfincs',async ({url})=>{
 const [z,x,y]=url.slice('sfincs://'.length).split('/').map(Number),{rgba}=await loadTile({z,x,y}),n=TILE*2**z;
 const lonAt=px=>(x*TILE+px)/n*360-180,latAt=py=>Math.atan(Math.sinh(Math.PI*(1-2*(y*TILE+py)/n)))*180/Math.PI;
 const west=lonAt(0),east=lonAt(TILE),north=latAt(0),south=latAt(TILE);
 if(east>DOMAIN.west&&west<DOMAIN.east&&north>DOMAIN.south&&south<DOMAIN.north){
  // UTM is near-linear across one tile, so corners are converted and the inside is blended.
  const c=[toUtm(west,north),toUtm(east,north),toUtm(west,south),toUtm(east,south)];
  for(let j=0;j<TILE;j++){const v=(j+.5)/TILE;for(let i=0;i<TILE;i++){
   const u=(i+.5)/TILE,e=(c[0].e*(1-u)+c[1].e*u)*(1-v)+(c[2].e*(1-u)+c[3].e*u)*v,nn=(c[0].n*(1-u)+c[1].n*u)*(1-v)+(c[2].n*(1-u)+c[3].n*u)*v;
   const g=sampler.ground(e,nn);if(Number.isNaN(g))continue;
   const q=(j*TILE+i)*4,value=g+32768;rgba[q]=Math.floor(value/256);rgba[q+1]=Math.floor(value%256);rgba[q+2]=Math.floor(value*256%256);
  }}
 }
 return{data:await createImageBitmap(new ImageData(rgba,TILE,TILE),{premultiplyAlpha:'none',colorSpaceConversion:'none'})};
});
function basemapStyle(){
 const road=(id,classes,colour,widths)=>({id,type:'line',source:'omt','source-layer':'transportation',filter:['all',['in',['get','class'],['literal',classes]],['!=',['get','brunnel'],'bridge']],layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':colour,'line-width':['interpolate',['exponential',1.6],['zoom'],...widths]}});
 const FONT=['Noto Sans Regular'];
 return{version:8,glyphs:'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',sources:{omt:{type:'vector',url:'https://tiles.openfreemap.org/planet'},
  dem:{type:'raster-dem',tiles:['sfincs://{z}/{x}/{y}'],encoding:'terrarium',tileSize:256,maxzoom:15,attribution:'Terrain: SFINCS case lidar (USGS Pima County 2021); Terrain Tiles (Mapzen, AWS Open Data) outside it'},
  shade:{type:'raster-dem',tiles:['sfincs://{z}/{x}/{y}'],encoding:'terrarium',tileSize:256,maxzoom:15}},
 layers:[
  {id:'ground',type:'background',paint:{'background-color':'#e2d5ba'}},
  {id:'landcover',type:'fill',source:'omt','source-layer':'landcover',paint:{'fill-color':'#c9cfa4','fill-opacity':.45}},
  {id:'parks',type:'fill',source:'omt','source-layer':'park',paint:{'fill-color':'#b9cf9c','fill-opacity':.35}},
  {id:'landuse',type:'fill',source:'omt','source-layer':'landuse',filter:['in',['get','class'],['literal',['residential','suburb','neighbourhood']]],paint:{'fill-color':'#e9e2d2','fill-opacity':.6}},
  {id:'relief',type:'hillshade',source:'shade',paint:{'hillshade-exaggeration':.8,'hillshade-shadow-color':'#3b2a18','hillshade-highlight-color':'#fff6e0','hillshade-accent-color':'#6d5433','hillshade-illumination-direction':315}},
  {id:'waterway',type:'line',source:'omt','source-layer':'waterway',paint:{'line-color':'#8fb5bf','line-width':1.2,'line-opacity':.8}},
  road('minor',['minor','service','track'],'#fbfaf6',[11,.2,16,6]),
  road('tertiary',['tertiary'],'#ffffff',[9,.4,16,8]),
  road('secondary',['secondary'],'#ffffff',[8,.6,16,11]),
  road('primary',['primary'],'#fbe3a6',[7,.8,16,14]),
  road('trunk',['trunk'],'#f9d17f',[6,1,16,18]),
  road('motorway',['motorway'],'#f2b64e',[5,1.2,16,24]),
  {id:'buildings',type:'fill-extrusion',source:'omt','source-layer':'building',minzoom:13,paint:{'fill-extrusion-color':['interpolate',['linear'],['coalesce',['get','render_height'],5],3,'#e8dcc6',8,'#d9c7ab',15,'#c3b5a4',40,'#a9b1b8'],'fill-extrusion-height':['*',['coalesce',['get','render_height'],5],E],'fill-extrusion-vertical-gradient':true,'fill-extrusion-opacity':.96}},
  {id:'road-names',type:'symbol',source:'omt','source-layer':'transportation_name',minzoom:12,layout:{'symbol-placement':'line','text-field':['get','name'],'text-font':FONT,'text-size':12},paint:{'text-color':'#4a4640','text-halo-color':'#fff','text-halo-width':1.4}},
  {id:'water-names',type:'symbol',source:'omt','source-layer':'waterway',minzoom:12,layout:{'symbol-placement':'line','text-field':['get','name'],'text-font':FONT,'text-size':11},paint:{'text-color':'#2f6f86','text-halo-color':'#fff','text-halo-width':1.2}},
  {id:'places',type:'symbol',source:'omt','source-layer':'place',layout:{'text-field':['get','name'],'text-font':FONT,'text-size':14},paint:{'text-color':'#332f29','text-halo-color':'#fff','text-halo-width':1.6}},
 ],terrain:{source:'dem',exaggeration:E}};
}
const map=new maplibre.Map({container:'map',pixelRatio:Math.min(devicePixelRatio,1),canvasContextAttributes:{antialias:false},center:[-111.2946,32.3932],zoom:14.6,pitch:66,bearing:25,maxPitch:80,style:basemapStyle()});
// One fixed renderer frame in local mercator metres, shared by water and roads.
const FRAME=maplibre.MercatorCoordinate.fromLngLat([(DOMAIN.west+DOMAIN.east)/2,(DOMAIN.north+DOMAIN.south)/2],0),FRAME_M=FRAME.meterInMercatorCoordinateUnits();
const local=(lon,lat)=>{const c=maplibre.MercatorCoordinate.fromLngLat([lon,lat],0);return[(c.x-FRAME.x)/FRAME_M,(c.y-FRAME.y)/FRAME_M];};
const fromLocal=(x,y)=>new maplibre.MercatorCoordinate(FRAME.x+x*FRAME_M,FRAME.y+y*FRAME_M,0).toLngLat();
const frameMatrix=new THREE.Matrix4().set(FRAME_M,0,0,FRAME.x, 0,FRAME_M,0,FRAME.y, 0,0,FRAME_M,0, 0,0,0,1);
const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera();camera.matrixAutoUpdate=false;camera.matrixWorldAutoUpdate=false;
const clip=new THREE.Matrix4();let renderer=null,water=null,waterInfo=null;
// --- Water ---
const U={alpha:uniform(0),time:uniform(0),lift:uniform(1),far:uniform(0)};
let playing=true,frameIndex=-1,clock=0,last=performance.now();
const surfaces=[];const surfaceFor=i=>surfaces[i]??={...frameSurface(waterInfo.mesh,sampler,frames[i]),share:wetShare(waterInfo.mesh,data,sampler,frames[i])};
function buildWater(){
 const cells=wetCells(data,frames),atlas=terrainAtlas(cells,data),mesh=buildWaterMesh(cells,data,fromUtmLocal,atlas.across);
 const g=new THREE.BufferGeometry(),positions=new Float32Array(mesh.vertexCount*3);
 for(let v=0;v<mesh.vertexCount;v++){positions[v*3]=mesh.positions[v*2];positions[v*3+1]=mesh.positions[v*2+1];}
 g.setAttribute('position',new THREE.BufferAttribute(positions,3));
 for(const [name,size] of [['sA',1],['sB',1],['fA',2],['fB',2],['wA',1],['wB',1]])g.setAttribute(name,new THREE.BufferAttribute(new Float32Array(mesh.vertexCount*size),size));
 g.setAttribute('cellTop',new THREE.BufferAttribute(mesh.top,1));g.setAttribute('atlas',new THREE.BufferAttribute(mesh.atlas,2));g.setAttribute('inside',new THREE.BufferAttribute(mesh.inside,2));
 g.setIndex(new THREE.BufferAttribute(mesh.indices,1));g.computeBoundingSphere();
 const atlasTexture=new THREE.DataTexture(atlas.data,atlas.size,atlas.size,THREE.RedFormat,THREE.FloatType);atlasTexture.needsUpdate=true;
 const noise=makeNoiseTexture();
 const material=new THREE.MeshBasicNodeMaterial({side:THREE.DoubleSide});
 const surface=mix(attribute('sA','float'),attribute('sB','float'),U.alpha);
 // Zoomed out, a summary cell sits at the top of its terrain so coarse ground cannot hide it.
 material.positionNode=vec3(positionLocal.x,positionLocal.y,mix(surface,max(surface,attribute('cellTop','float')),U.far).mul(E).add(U.lift));
 const vSurface=varying(surface,'waterSurface'),vFlow=varying(mix(attribute('fA','vec2'),attribute('fB','vec2'),U.alpha),'waterFlow');
 const vAtlas=varying(attribute('atlas','vec2'),'waterAtlas'),vInside=varying(attribute('inside','vec2'),'waterInside'),vPlace=varying(positionLocal.xy,'waterPlace');
 // The 10 m lidar under this pixel, read directly from the model's terrain: the shoreline is
 // the data's, at every zoom.
 const p=vInside.sub(.5),cell=clamp(floor(p),0,GRID.sub-1),next=clamp(cell.add(1),0,GRID.sub-1),f=clamp(p.sub(floor(p)),0,1);
 const at=(i,j)=>textureLoad(atlasTexture,ivec2(vAtlas.add(vec2(i,j)))).r;
 const ground=mix(mix(at(cell.x,cell.y),at(next.x,cell.y),f.x),mix(at(cell.x,next.y),at(next.x,next.y),f.x),f.y);
 const depth=vSurface.sub(ground),share=varying(mix(attribute('wA','float'),attribute('wB','float'),U.alpha),'waterShare');
 material.fragmentNode=Fn(()=>{
  // Close up, the 10 m footprint. Zoomed out, whole cells shaded by their wet share instead.
  const footprint=depth.greaterThan(SHOW_DEPTH_M),summary=U.far.greaterThan(.5).and(share.greaterThan(.04));
  If(footprint.or(summary).not(),()=>Discard());
  // Toon water: depth bands, a shore line, and a pattern moving downhill on the surface.
  const shown=mix(depth,share.mul(2),U.far),base=mix(color('#46c2c0'),color('#1f6f9c'),smoothstep(.2,3,shown));
  const drift=texture(noise,vPlace.mul(.006).sub(vFlow.mul(U.time.mul(.04)))).r,streak=smoothstep(.6,.66,drift).mul(smoothstep(.15,.6,depth)).mul(.3);
  const shore=float(1).sub(smoothstep(SHOW_DEPTH_M,.35,depth));
  const tone=mix(base,color('#eef8f2'),max(shore.mul(.8),streak));
  return renderOutput(vec4(tone,1),THREE.NeutralToneMapping,THREE.SRGBColorSpace);
 })();
 water=new THREE.Mesh(g,material);water.frustumCulled=false;water.matrixAutoUpdate=false;water.matrix.copy(frameMatrix);scene.add(water);
 waterInfo={mesh,cells:cells.length,atlas:atlas.size};
}
const fromUtmLocal=(e,n)=>{const g=utmToLonLat(e,n);return local(g.lon,g.lat);};

function showFrame(i){
 const a=surfaceFor(i),b=surfaceFor(Math.min(frames.length-1,i+1)),g=water.geometry.attributes;
 g.sA.array.set(a.surface);g.sB.array.set(b.surface);g.fA.array.set(a.flow);g.fB.array.set(b.flow);g.wA.array.set(a.share);g.wB.array.set(b.share);
 for(const n of ['sA','sB','fA','fB','wA','wB'])g[n].needsUpdate=true;
 frameIndex=i;
 const t=new Date(frames[i].time),label=t.toLocaleString('en-US',{timeZone:'America/Phoenix',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
 $('time').textContent=`${label} MST`;$('scrub').value=String(i);
}
// --- Roads ---
const ROAD_CLASSES=['motorway','trunk','primary','secondary','tertiary'],CHUNK=2000,DETAIL_ZOOM=13.5,MEASURED_REACH=60;
const roadGroup=new THREE.Group();roadGroup.matrixAutoUpdate=false;roadGroup.matrix.copy(frameMatrix);scene.add(roadGroup);
const measured=parseRoadHeights(heightsJson).map(a=>{const[x,y]=local(a.lon,a.lat);return{...a,x,y};});
const chunks=new Map();let buildQueue=[],terrainRevision=0,roadMaterial=null,roadTimer=null;
const scheduleRoads=()=>{clearTimeout(roadTimer);roadTimer=setTimeout(rebuildRoads,200);};
function buildChunk(job){
 const L=LODS[job.lod];
 const mesh=buildRoadMesh(job.roads.filter(r=>!L.classes||r.bridge||L.classes.includes(r.cls)),(x,y)=>map.queryTerrainElevation(fromLocal(x,y)),{exaggeration:E,detail:L.detail,step:L.step,widthScale:job.widthScale,deckRise:0,furniture:false,lift:job.lift,
  // A surveyed road height (NAVD88), where one exists, decides how high the road is drawn.
  measuredAt:(x,y)=>{const m=measured.find(a=>Math.hypot(a.x-x,a.y-y)<MEASURED_REACH);return m?m.roadM*E:null;}});
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(mesh.positions,3));g.setAttribute('color',new THREE.BufferAttribute(mesh.colors,3));g.setIndex(new THREE.BufferAttribute(mesh.indices,1));g.computeBoundingSphere();
 roadMaterial??=new THREE.MeshBasicNodeMaterial({vertexColors:true,side:THREE.DoubleSide});
 const old=chunks.get(job.cell);if(old){roadGroup.remove(old.object);old.object.geometry.dispose();}
 const object=new THREE.Mesh(g,roadMaterial);object.matrixAutoUpdate=false;roadGroup.add(object);
 chunks.set(job.cell,{key:job.key,object,revision:terrainRevision,missing:mesh.missing,vertices:mesh.positions.length/3,lod:job.lod});
}
function workQueue(){
 const until=performance.now()+6;
 while(buildQueue.length&&performance.now()<until)buildChunk(buildQueue.shift());
 let vertices=0,incomplete=0;const levels=[0,0,0];for(const c of chunks.values()){vertices+=c.vertices;levels[c.lod]++;if(c.missing)incomplete++;}
 diagnostics.roads={chunks:chunks.size,levels,queued:buildQueue.length,incomplete,vertices};
 map.triggerRepaint();
 if(buildQueue.length)requestAnimationFrame(workQueue);
}
function rebuildRoads(){
 if(!renderer)return;
 if(!map.isSourceLoaded('omt')){roadTimer=setTimeout(rebuildRoads,400);return;}
 const zoom=map.getZoom(),c=map.getCenter(),[vx,vy]=local(c.lng,c.lat),widthScale=2**Math.max(0,Math.round(13.5-zoom)),seen=new Set(),byCell=new Map();
 for(const f of map.querySourceFeatures('omt',{sourceLayer:'transportation'})){
  const cls=f.properties.class,bridge=f.properties.brunnel==='bridge';
  // Smaller roads are drawn flat by the map; they get a model only where the map says bridge.
  if(!ROAD_CLASSES.includes(cls)&&!(bridge&&['minor','service','track'].includes(cls)))continue;
  for(const line of f.geometry.type==='MultiLineString'?f.geometry.coordinates:f.geometry.type==='LineString'?[f.geometry.coordinates]:[]){
   const dedupe=[cls,line[0],line.at(-1)].join();if(seen.has(dedupe))continue;seen.add(dedupe);
   const points=line.map(([lon,lat])=>local(lon,lat)),mid=points[points.length>>1],cellX=Math.floor(mid[0]/CHUNK),cellY=Math.floor(mid[1]/CHUNK),cell=cellX+','+cellY;
   if(!byCell.has(cell))byCell.set(cell,{cell,cellX,cellY,roads:[]});
   byCell.get(cell).roads.push({cls:ROAD_CLASSES.includes(cls)?cls:'minor',bridge,oneway:f.properties.oneway===1,points});
  }
 }
 const jobs=[];
 for(const job of byCell.values()){
  const d=Math.hypot((job.cellX+.5)*CHUNK-vx,(job.cellY+.5)*CHUNK-vy);
  // Coarser terrain far out rises and falls more between samples, so roads sit a little higher.
  job.lod=Math.max(zoom<DETAIL_ZOOM?1:0,lodFor(d));job.widthScale=widthScale;job.distance=d;job.lift=Math.min(40,4+1.5*2**Math.max(0,Math.round(15-zoom)));job.key=[job.lod,widthScale,job.lift,job.roads.length].join();
  const have=chunks.get(job.cell);
  if(!have||have.key!==job.key||have.revision!==terrainRevision)jobs.push(job);
 }
 for(const [cell,c] of chunks)if(!byCell.has(cell)){roadGroup.remove(c.object);c.object.geometry.dispose();chunks.delete(cell);}
 buildQueue=jobs.sort((p,q)=>p.distance-q.distance);workQueue();
}
// --- Drawing inside MapLibre ---
// Three caches every GL binding, and MapLibre changes them between frames.
let cleanState=null;
function forgetCachedGlState(gl){
 const state=renderer.backend.state;cleanState??=new state.constructor(renderer.backend);
 for(const key of Object.keys(state))if(key.startsWith('current')){const value=cleanState[key];state[key]=value&&typeof value==='object'&&!ArrayBuffer.isView(value)&&Object.getPrototypeOf(value)===Object.prototype?{}:value;}
 state.enabled={};state.parameters={};gl.disable(gl.BLEND);
}
const layer={id:'sfincs-3d',type:'custom',renderingMode:'3d',
 async onAdd(_,gl){
  renderer=new THREE.WebGPURenderer({canvas:map.getCanvas(),context:gl,forceWebGL:true,antialias:false});
  renderer.autoClear=false;renderer.toneMapping=THREE.NoToneMapping;renderer.outputColorSpace=THREE.LinearSRGBColorSpace;
  await renderer.init();
  status('Building water from the saved run');
  buildWater();showFrame(0);
  diagnostics.ready=true;diagnostics.water={cells:waterInfo.cells,triangles:waterInfo.cells*2,atlas:waterInfo.atlas};
  status(`Saved SFINCS run: ${waterInfo.cells.toLocaleString()} of ${data.vertices.length.toLocaleString()} model cells hold water above ${SHOW_DEPTH_M*100} cm at some hour.`);
  map.on('moveend',scheduleRoads);
  map.on('sourcedata',e=>{if(e.sourceId==='dem'&&e.isSourceLoaded)terrainRevision++;if((e.sourceId==='omt'||e.sourceId==='dem')&&e.isSourceLoaded)scheduleRoads();});
  map.on('resize',()=>{const c=map.getCanvas();renderer.setDrawingBufferSize(c.width,c.height,1);});
  scheduleRoads();
 },
 render(gl,args){
  if(!diagnostics.ready)return;
  const now=performance.now(),dt=now-last;last=now;
  if(playing){clock=(clock+dt/1000/HOUR_SECONDS)%(frames.length-1);}
  const i=Math.floor(clock);if(i!==frameIndex)showFrame(i);
  U.alpha.value=clock-i;U.time.value=now/1000;
  // Coarser terrain far away can rise over thin water; a small lift keeps the same water visible.
  U.lift.value=Math.min(30,.6*2**Math.max(0,15-map.getZoom()));
  U.far.value=map.getZoom()<12.5?1:0;
  clip.fromArray(args.defaultProjectionData.mainMatrix);
  camera.projectionMatrix.copy(clip);camera.projectionMatrixInverse.copy(clip).invert();
  forgetCachedGlState(gl);renderer.render(scene,camera);
  map.triggerRepaint();
  diagnostics.renders++;diagnostics.frameTimes.push(dt);if(diagnostics.frameTimes.length>600)diagnostics.frameTimes.shift();
 }};
map.on('load',()=>map.addLayer(layer));
map.on('error',e=>diagnostics.errors.push(String(e.error?.message||e.error)));
$('play').onclick=()=>{playing=!playing;$('play').textContent=playing?'Pause':'Play';};
$('scrub').max=String(frames.length-1);
$('scrub').oninput=e=>{playing=false;$('play').textContent='Play';clock=Number(e.target.value);};
document.addEventListener('visibilitychange',()=>{last=performance.now();});
setInterval(()=>{const t=diagnostics.frameTimes.slice(-120);if(t.length)$('metrics').textContent=`${(1000/(t.reduce((a,b)=>a+b,0)/t.length)).toFixed(1)} FPS`;},1000);
window.geo3dMap={map,diagnostics,frames,sampler,data,get renderer(){return renderer;},get water(){return water;},get frameIndex(){return frameIndex;},setClock:v=>{playing=false;clock=v;},measured};
