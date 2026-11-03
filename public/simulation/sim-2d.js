// The 2D map's model layer: the same SFINCS runs the 3D view shows (preview/geo3d/src/runs.js),
// drawn over whichever base map is chosen. Water is each 100 m model cell's simulated depth
// (water surface minus the cell's mean terrain), rain is the run's own rainfall input as a
// radar-style tint, river flow is the run's inflow at the model's inlets, and HAND is the 13Z
// run's modeled extent. Nothing here is observed water.
import {RUNS,LIVE,LIVE_MAX_AGE_H,BASE_DISPLAY} from '../preview/geo3d/src/runs.js?v=dev';
import {fromUtm,toUtm} from '../preview/geo3d/src/utm.js?v=dev';
import {parseRain,rainAtUtm} from '../preview/geo3d/src/world/rain-data.js?v=dev';
import {decodeRoadHeights,roadPackage} from '../preview/geo3d/src/road-package.js?v=dev';
export {RUNS};
const DATA=new URL('./data/',import.meta.url);
// Depth bands in feet, the same as the app's simulated-water key.
export const DEPTH_FT=[.03,.3,1,3.3,6.6,13.1];
export const DEPTH_COLORS=['#9fd9ee','#6cc3e6','#3a9fd0','#2272b5','#1f4b9c','#3b2a78'];
// Rain in mm/h, radar style: light to heavy.
export const RAIN_MMH=[.5,2,5,10,25];
export const RAIN_COLORS=['#9be27a','#3cbf4a','#f4d03f','#f08a24','#d6304f'];
const HALF=50;

// Downloads report their bytes to whoever listens (the map's loading card), and try twice more,
// a second and then three apart, before they count as failed.
const downloads=new Map();let listener=null;
export function onDownloads(fn){listener=fn;}
const report=()=>{let got=0,total=0;for(const d of downloads.values()){got+=d.got;total+=d.total;}listener?.({count:downloads.size,got,total});};
const fileName=url=>String(url).split('/').pop().split('?')[0];
async function fetchRetry(url){
 let error;
 for(const wait of [0,1000,3000]){
  if(wait)await new Promise(r=>setTimeout(r,wait));
  try{const r=await fetch(url);if(r.ok||r.status===404)return r;error=new Error(`${fileName(url)} answered ${r.status}`);}catch(e){error=new Error(`${fileName(url)} did not download (${e.message})`);}
 }
 throw error;
}
async function readCounted(r,key){
 const total=Number(r.headers.get('content-length'))||0;
 if(!r.body)return new Uint8Array(await r.arrayBuffer());
 const entry={got:0,total};downloads.set(key,entry);report();const parts=[];let last=0;
 try{const reader=r.body.getReader();for(;;){const {done,value}=await reader.read();if(done)break;parts.push(value);entry.got+=value.length;const now=performance.now();if(now-last>120){last=now;report();}}}
 finally{downloads.delete(key);report();}
 const out=new Uint8Array(parts.reduce((s,p)=>s+p.length,0));let o=0;for(const p of parts){out.set(p,o);o+=p.length;}return out;
}
async function fetchJson(url){
 const r=await fetchRetry(url);if(!r.ok)throw new Error(`${fileName(url)} answered ${r.status}`);
 const bytes=await readCounted(r,String(url));
 const plain=bytes[0]===0x1f&&bytes[1]===0x8b?new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()):bytes;
 return JSON.parse(new TextDecoder().decode(plain));
}
const data=p=>fetchJson(new URL(p,DATA));
const GRID={x0:467700,y0:3572300};
// Cell centres and corners from the display's vertices: [x, y, mean terrain, n, m], metres from the grid origin.
function cellsOf(vertices){
 const n=vertices.length,bed=new Float32Array(n),box=new Float64Array(n*4),utm=new Float64Array(n*2),index=new Map();
 vertices.forEach((v,i)=>{
  const e=GRID.x0+v[0],nn=GRID.y0+v[1];bed[i]=v[2];utm[i*2]=e;utm[i*2+1]=nn;index.set(Math.floor(v[0]/100)*1000+Math.floor(v[1]/100),i);
  const sw=fromUtm(e-HALF,nn-HALF),ne=fromUtm(e+HALF,nn+HALF);box.set([sw.lat,sw.lon,ne.lat,ne.lon],i*4);
 });
 return{n,bed,box,utm,index};
}
let baseCells=null;
// A run, ready for the 2D map: depth per cell per hour, rain, inflow and (13Z only) HAND.
export async function loadRun2d(def){
 if(def.live){
  const bust='?t='+Math.floor(Date.now()/120000);
  const manifest=await fetchJson(LIVE+'manifest.json'+bust).catch(()=>{throw new Error('The live model feed did not answer.');});
  const age=(Date.now()-Date.parse(manifest.issuedAt))/3600e3;
  if(!(age<=LIVE_MAX_AGE_H))throw new Error(`The newest live model run is ${age.toFixed(1)} hours old, older than ${LIVE_MAX_AGE_H} hours.`);
  const [water,rain,inflow]=await Promise.all([fetchJson(LIVE+'water.json.gz'+bust),fetchJson(LIVE+'rainfall.json'+bust),fetchJson(LIVE+'inflow.json'+bust)]);
  baseCells??=cellsOf((await data(BASE_DISPLAY)).vertices);
  const issued=new Date(manifest.issuedAt).toLocaleString('en-US',{timeZone:'America/Phoenix',hour:'numeric',minute:'2-digit'});
  const cycle=new Date(manifest.hrrrCycle).toLocaleString('en-US',{timeZone:'America/Phoenix',hour:'numeric'});
  return build({...def,note:`Model forecast from public forcing, not observed water: SFINCS run at ${issued} MST from the NOAA HRRR rain forecast of ${cycle} MST and NWM river flows, after a 45-hour warm-up. A new run is published every hour.`},baseCells,water.frames,rain,inflow.series,null);
 }
 const display=await data(def.display);
 const [rainJson,inflowJson,handJson]=await Promise.all([def.rain&&data(def.rain),def.inflow&&def.inflow!==def.rain&&data(def.inflow),def.hand&&data(def.hand)]);
 const cells=def.display===BASE_DISPLAY?(baseCells??=cellsOf(display.vertices)):cellsOf(display.vertices);
 const series=(def.inflow===def.rain?rainJson?.boundary:inflowJson)?.series??[];
 return build(def,cells,display.waterFrames,rainJson,series,handJson);
}
function build(def,cells,waterFrames,rainJson,series,handJson){
 const times=waterFrames.map(f=>Date.parse(f.time));
 const surface=waterFrames.map(f=>Float32Array.from(f.surfaceM,z=>z==null?NaN:z));
 const depth=surface.map(s=>{const d=new Float32Array(cells.n);for(let i=0;i<cells.n;i++)d[i]=Number.isNaN(s[i])?NaN:Math.max(0,s[i]-cells.bed[i]);return d;});
 const inflow=series.filter(s=>s.lon!=null&&s.points?.some(p=>p.flowM3s>0)).map(s=>({name:s.name||'NWM reach '+s.reachId,lat:s.lat,lon:s.lon,points:new Map(s.points.map(p=>[Date.parse(p.time),p.flowM3s]))}));
 const hand=handJson?handJson.frames.map(f=>f.hand.features.flatMap(g=>(g.geometry.type==='MultiPolygon'?g.geometry.coordinates:[g.geometry.coordinates]))):null;
 const rain=rainJson?parseRain(rainJson):null;
 return{def,cells,times,surface,depth,rain,inflow,hand,series:hourSeries({cells,times,depth,rain,inflow})};
}
// The model cell holding a UTM point, or -1 outside the model.
export function cellAt(cells,e,n){const k=cells.index.get(Math.floor((e-GRID.x0)/100)*1000+Math.floor((n-GRID.y0)/100));return k??-1;}
// Per hour, for the timeline: wet area (km²), deepest cell (m), rain averaged over the model
// (mm/h, sampled on a 1 km lattice of cells) and the total river inflow (m³/s).
function hourSeries({cells,times,depth,rain,inflow}){
 const sample=[];for(let k=0;k<cells.n;k+=97)sample.push(k);
 return times.map((t,h)=>{
  let wet=0,deep=0;const d=depth[h];for(let k=0;k<cells.n;k++){const x=d[k];if(x>=.0091){wet++;if(x>deep)deep=x;}}
  let r=0;if(rain){const mid=t-1800e3;for(const k of sample)r+=rainAtUtm(rain,mid,cells.utm[k*2],cells.utm[k*2+1]);r/=sample.length;}
  let q=0;for(const s of inflow){const v=s.points.get(t);if(v!=null)q+=v;}
  return{time:t,wetKm2:wet/100,deepM:deep,rainMmH:r,inflowM3s:q};
 });
}
// Road and bridge-deck heights along the routes (public/simulation/data/road-heights/).
let roads=null;
export function loadRoads(){
 roads??=Promise.all([fetchRetry(new URL('road-heights/routes.bin.gz',DATA)).then(async r=>{if(!r.ok)throw new Error('Road heights answered '+r.status);let b=await readCounted(r,'roads');if(b[0]===0x1f&&b[1]===0x8b)b=new Uint8Array(await new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());return decodeRoadHeights(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));}),fetchJson(new URL('road-heights/structures.json',DATA))])
  .then(([lines,structures])=>roadPackage(lines,structures,(lon,lat)=>{const u=toUtm(lon,lat);return[u.e,u.n];}));
 roads.catch(()=>{roads=null;});
 return roads;
}
// Each crossing's road height, as on the 3D map: a bridge's lidar deck within 80 m, otherwise the
// lowest road surface on its routes within 100 m. Water over the road is the model's water
// surface in the cell holding that road point, minus the road height.
export const COVER_M=.05;
export function crossingsFor(run,points,pkg){
 const near=(list,e,n,reach)=>list.map(p=>({p,d:Math.hypot(p.x-e,p.z-n)})).filter(o=>o.d<reach).sort((a,b)=>a.d-b.d);
 return points.map(fp=>{
  const u=toUtm(fp.lon,fp.lat),bridge=fp.kind==='bridge'||fp.kind==='river';let road=null;
  if(pkg&&bridge){const d=near(pkg.decks,u.e,u.n,80)[0]?.p;if(d)road={m:d.m,e:d.x,n:d.z,deck:true,source:'Bridge deck, USGS 3DEP 2021 lidar'};}
  if(pkg&&!road&&!bridge){const low=near(pkg.stations.filter(s=>fp.routes.includes(s.route)&&!s.deck),u.e,u.n,100).reduce((a,o)=>!a||o.p.m<a.m?o.p:a,null);if(low)road={m:low.m,e:low.x,n:low.z,deck:false,source:'Lowest road surface within 100 m, USGS 3DEP 1 m lidar'};}
  const at=road??{e:u.e,n:u.n},cell=cellAt(run.cells,at.e,at.n);
  if(cell<0)return{fp,inside:false};
  if(!road)road={m:run.cells.bed[cell],deck:false,source:'Model cell mean terrain (no road height found)'};
  const over=run.surface.map(s=>Number.isNaN(s[cell])?NaN:s[cell]-road.m);
  return{fp,inside:true,road,cell,over};
 });
}
export const depthBand=m=>{const ft=m/.3048;let k=-1;for(let i=0;i<DEPTH_FT.length;i++)if(ft>=DEPTH_FT[i])k=i;return k;};
const rainBand=v=>{let k=-1;for(let i=0;i<RAIN_MMH.length;i++)if(v>=RAIN_MMH[i])k=i;return k;};

// The layer: one canvas over the map, redrawn when the view, the hour or the run changes.
export function createSimLayer(L,map){
 if(!map.getPane('simWater'))map.createPane('simWater').style.zIndex=350;
 const pane=map.getPane('simWater'),canvas=document.createElement('canvas');canvas.className='sim-canvas';pane.append(canvas);
 const flowLayer=L.layerGroup().addTo(map);
 let run=null,clock=0,show={water:true,hand:false,rain:true,flow:true},frame=0;
 const at=()=>{const i=Math.min(run.times.length-1,Math.floor(clock)),j=Math.min(run.times.length-1,i+1);return{i,j,f:clock-i};};
 function depthAt(k){const {i,j,f}=at(),a=run.depth[i][k],b=run.depth[j][k];return Number.isNaN(a)?NaN:a+((Number.isNaN(b)?a:b)-a)*f;}
 function time(){const {i,j,f}=at();return run.times[i]+(run.times[j]-run.times[i])*f;}
 function draw(){
  cancelAnimationFrame(frame);frame=requestAnimationFrame(paint);
 }
 function paint(){
  const size=map.getSize(),ratio=Math.min(2,devicePixelRatio||1);
  canvas.width=size.x*ratio;canvas.height=size.y*ratio;canvas.style.width=size.x+'px';canvas.style.height=size.y+'px';
  L.DomUtil.setPosition(canvas,map.containerPointToLayerPoint([0,0]));
  const ctx=canvas.getContext('2d');ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,size.x,size.y);
  if(!run)return;
  const t=time(),b=map.getBounds().pad(.05);
  // Rain first, softly, so water reads on top of it.
  if(show.rain&&run.rain){
   const f=run.rain.frames.find(f=>t>=f.start&&t<f.end);
   if(f){
    const {rows,cols,utm}=run.rain,dr=Math.abs(rows[1]-rows[0])/2,dc=Math.abs(cols[1]-cols[0])/2;ctx.globalAlpha=.42;
    for(let r=0;r<rows.length;r++)for(let c=0;c<cols.length;c++){
     const k=rainBand(f.grid[r][c]);if(k<0)continue;
     let sw,ne;if(utm){sw=fromUtm(cols[c]-dc,rows[r]-dr);ne=fromUtm(cols[c]+dc,rows[r]+dr);}else{sw={lat:rows[r]-dr,lon:cols[c]-dc};ne={lat:rows[r]+dr,lon:cols[c]+dc};}
     if(!b.intersects([[sw.lat,sw.lon],[ne.lat,ne.lon]]))continue;
     const p=map.latLngToContainerPoint([ne.lat,sw.lon]),q=map.latLngToContainerPoint([sw.lat,ne.lon]);
     ctx.fillStyle=RAIN_COLORS[k];ctx.fillRect(p.x,p.y,q.x-p.x+.5,q.y-p.y+.5);
    }
    ctx.globalAlpha=1;
   }
  }
  if(show.hand&&run.hand){
   const polys=run.hand[Math.min(run.hand.length-1,Math.round(clock))]??[];
   ctx.fillStyle='rgba(25,167,160,.45)';ctx.strokeStyle='rgba(15,111,106,.9)';ctx.lineWidth=1;
   for(const poly of polys){ctx.beginPath();for(const ring of poly)ring.forEach(([lon,lat],i)=>{const p=map.latLngToContainerPoint([lat,lon]);i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y);});ctx.fill('evenodd');ctx.stroke();}
  }
  if(show.water){
   const {box,n}=run.cells,south=b.getSouth(),north=b.getNorth(),west=b.getWest(),east=b.getEast();ctx.globalAlpha=.82;
   for(let k=0;k<n;k++){
    if(box[k*4+2]<south||box[k*4]>north||box[k*4+3]<west||box[k*4+1]>east)continue;
    const d=depthAt(k);const band=Number.isNaN(d)?-1:depthBand(d);if(band<0)continue;
    const p=map.latLngToContainerPoint([box[k*4+2],box[k*4+1]]),q=map.latLngToContainerPoint([box[k*4],box[k*4+3]]);
    ctx.fillStyle=DEPTH_COLORS[band];ctx.fillRect(p.x,p.y,Math.max(1,q.x-p.x+.5),Math.max(1,q.y-p.y+.5));
   }
   ctx.globalAlpha=1;
  }
 }
 function drawFlow(){
  flowLayer.clearLayers();if(!run||!show.flow)return;
  const {i}=at(),t=run.times[i];
  for(const s of run.inflow){
   const q=s.points.get(t)??[...s.points].reduce((best,[k,v])=>Math.abs(k-t)<Math.abs(best[0]-t)?[k,v]:best,[Infinity,null])[1];
   if(q==null)continue;
   L.marker([s.lat,s.lon],{interactive:false,icon:L.divIcon({className:'live-reading flow-reading',html:`<span>${s.name}: ${Math.round(q*35.3147).toLocaleString()} ft³/s</span>`,iconSize:[0,0]})}).addTo(flowLayer);
  }
 }
 map.on('moveend zoomend resize viewreset',draw);
 map.on('zoomstart',()=>canvas.style.opacity='0');map.on('zoomend',()=>canvas.style.opacity='');
 let lastFlowHour=-1;
 return{
  setRun(r){run=r;clock=Math.min(clock,r.times.length-1);lastFlowHour=-1;draw();drawFlow();},
  setClock(c){if(!run)return;clock=Math.max(0,Math.min(run.times.length-1,c));draw();const h=Math.floor(clock);if(h!==lastFlowHour){lastFlowHour=h;drawFlow();}},
  set(key,on){show[key]=on;draw();if(key==='flow')drawFlow();},
  show(on){pane.style.display=on?'':'none';on?map.addLayer(flowLayer):map.removeLayer(flowLayer);},
  get run(){return run;},get clock(){return clock;},time:()=>run?time():null,
  // Simulated depth at a place, for the readout when the map is tapped.
  depthAt(lat,lon){
   if(!run)return null;const u=toUtm(lon,lat),k=cellAt(run.cells,u.e,u.n);
   return k<0?null:{depth:depthAt(k),cell:k};
  },
  // Corners of every cell deeper than the threshold now, for "fit water".
  wetBounds(minM=.3){
   if(!run)return null;const {box,n}=run.cells;let s=90,w=180,no=-90,e=-180,any=false;
   for(let k=0;k<n;k++){const d=depthAt(k);if(!(d>=minM))continue;any=true;s=Math.min(s,box[k*4]);w=Math.min(w,box[k*4+1]);no=Math.max(no,box[k*4+2]);e=Math.max(e,box[k*4+3]);}
   return any?[[s,w],[no,e]]:null;
  },
 };
}
