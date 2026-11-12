// The 2D map's model layer: the same SFINCS runs the 3D view shows (preview/geo3d/src/runs.js),
// drawn over whichever base map is chosen. Water is each 100 m model cell's simulated depth
// (water surface minus the cell's mean terrain), rain is the run's own rainfall input as a
// radar-style tint, river flow is the run's inflow at the model's inlets, and HAND is the 13Z
// run's modeled extent. Nothing here is observed water.
import {RUNS,LIVE,LIVE_MAX_AGE_H,BASE_DISPLAY,LIVE_ALL_ROUTE} from '../preview/geo3d/src/runs.js?v=dev';
import {fromUtm,toUtm} from '../preview/geo3d/src/utm.js?v=dev';
import {parseRain,rainAtUtm} from '../preview/geo3d/src/world/rain-data.js?v=dev';
import {decodeRoadHeights,roadPackage} from '../preview/geo3d/src/road-package.js?v=dev';
import {loadHand,flowsForRun,handHour,windowBounds,HAND_COLORS,isSantaCruz,useFetcher} from './hand-runs.js?v=dev';
export {loadHand,flowsForRun,HAND_COLORS,isSantaCruz};
import {canvasRatio} from '../graphics.js?v=dev';
import {openAllRoute,createQuadPainter,liveAllRoute} from './all-route-run.js?v=dev';
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
// Headers and body together, so a download that drops partway is tried again from the start.
async function fetchBytes(url,key=String(url)){
 let error;
 for(const wait of [0,1000,3000]){
  if(wait)await new Promise(r=>setTimeout(r,wait));
  let r;try{r=await fetchRetry(url);}catch(e){error=e;continue;}
  if(!r.ok)throw new Error(`${fileName(url)} answered ${r.status}.`);
  try{return await readCounted(r,key);}catch(e){error=new Error(`${fileName(url)} stopped downloading (${e.message}).`);}
 }
 throw error;
}
async function fetchJson(url){
 const bytes=await fetchBytes(url);
 const plain=bytes[0]===0x1f&&bytes[1]===0x8b?new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()):bytes;
 return JSON.parse(new TextDecoder().decode(plain));
}
const data=p=>fetchJson(new URL(p,DATA));
useFetcher(fetchJson);
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
// A run, ready for the 2D map: depth per cell per hour, rain and inflow. HAND comes from hand-runs.js.
export async function loadRun2d(def){
 if(def.quad)return loadQuad(def);
 if(def.live){
  // The live all-route runs first: three model areas with 6.25 m cells on the roads. The 100 m
  // river run stands in, and says so, when no model area has a fresh live result.
  let allRouteProblem='';
  try{const live=await liveAllRoute({base:LIVE_ALL_ROUTE,maxAgeH:LIVE_MAX_AGE_H,variant:'web',fetchBytes:url=>fetchBytes(url)});return quadRun({...def,note:live.note},live.quad);}
  catch(e){allRouteProblem=e.message;}
  const bust='?t='+Math.floor(Date.now()/120000);
  const manifest=await fetchJson(LIVE+'manifest.json'+bust).catch(()=>{throw new Error('The live model feed did not answer.');});
  const age=(Date.now()-Date.parse(manifest.issuedAt))/3600e3;
  if(!(age<=LIVE_MAX_AGE_H))throw new Error(`The newest live model run is ${age.toFixed(1)} hours old, older than ${LIVE_MAX_AGE_H} hours.`);
  const [water,rain,inflow]=await Promise.all([fetchJson(LIVE+'water.json.gz'+bust),fetchJson(LIVE+'rainfall.json'+bust),fetchJson(LIVE+'inflow.json'+bust)]);
  baseCells??=cellsOf((await data(BASE_DISPLAY)).vertices);
  const issued=new Date(manifest.issuedAt).toLocaleString('en-US',{timeZone:'America/Phoenix',hour:'numeric',minute:'2-digit'});
  const cycle=new Date(manifest.hrrrCycle).toLocaleString('en-US',{timeZone:'America/Phoenix',hour:'numeric'});
  return build({...def,note:`The live all-route model is not on the map: ${allRouteProblem} This is the 100 m river-strip run instead. Model forecast from public forcing, not observed water: SFINCS run at ${issued} MST from the NOAA HRRR rain forecast of ${cycle} MST and NWM river flows, after a 45-hour warm-up. A new run is published every hour.`},baseCells,water.frames,rain,inflow.series,null);
 }
 const display=await data(def.display);
 const [rainJson,inflowJson,handJson]=await Promise.all([def.rain&&data(def.rain),def.inflow&&def.inflow!==def.rain&&data(def.inflow),null]);
 const cells=def.display===BASE_DISPLAY?(baseCells??=cellsOf(display.vertices)):cellsOf(display.vertices);
 const series=(def.inflow===def.rain?rainJson?.boundary:inflowJson)?.series??[];
 return build(def,cells,display.waterFrames,rainJson,series,handJson);
}
function build(def,cells,waterFrames,rainJson,series,handJson){
 const times=waterFrames.map(f=>Date.parse(f.time));
 const surface=waterFrames.map(f=>Float32Array.from(f.surfaceM,z=>z==null?NaN:z));
 const depth=surface.map(s=>{const d=new Float32Array(cells.n);for(let i=0;i<cells.n;i++)d[i]=Number.isNaN(s[i])?NaN:Math.max(0,s[i]-cells.bed[i]);return d;});
 const inflow=series.filter(s=>s.lon!=null&&s.points?.some(p=>p.flowM3s>0)).map(s=>({name:s.name||'NWM reach '+s.reachId,reachId:String(s.reachId??''),lat:s.lat,lon:s.lon,points:new Map(s.points.map(p=>[Date.parse(p.time),p.flowM3s]))}));
 // The Santa Cruz at the model's upstream inlet (NWM reach 15902351): the flow HAND is run with.
 const sc=series.find(s=>String(s.reachId)==='15902351')??series.find(s=>/santa cruz/i.test(s.name??''));
 const riverM3s=times.map(tm=>{const p=sc?.points?.find(p=>Date.parse(p.time)===tm);return p?p.flowM3s:0;});
 const hand=handJson?handJson.frames.map(f=>f.hand.features.flatMap(g=>(g.geometry.type==='MultiPolygon'?g.geometry.coordinates:[g.geometry.coordinates]))):null;
 const rain=rainJson?parseRain(rainJson):null;
 return{def,cells,times,surface,depth,rain,inflow,hand,riverM3s,series:hourSeries({cells,times,depth,rain,inflow})};
}
// The all-route run (all-route-run.js): three model areas on quadtree cells, frames loaded one
// at a time. Rain and river inputs are not in its display package, so they read as unknown (NaN).
async function loadQuad(def){return quadRun(def,await openAllRoute({variant:'web',fetchBytes:url=>fetchBytes(url)}));}
function quadRun(def,quad){
 const series=quad.series().map(v=>({...v,rainMmH:NaN,inflowM3s:NaN}));
 // Each cell's corners on the map, worked out once while the run loads.
 const painter=createQuadPainter(quad,{colors:DEPTH_COLORS,bandOf:m=>depthBand(m)});
 return{def,quad,painter,cells:null,times:quad.times,frameHours:quad.frameMs/3600e3,series,rain:null,inflow:[],hand:null,riverM3s:quad.times.map(()=>0)};
}
// After the overlap choice changes: the timeline counts each place once under the new order.
export function setQuadOrder(run,mode){run.quad.setMode(mode);run.series=run.quad.series().map(v=>({...v,rainMmH:NaN,inflowM3s:NaN}));}
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
 roads??=Promise.all([fetchBytes(new URL('road-heights/routes.bin.gz',DATA),'roads').then(async b=>{if(b[0]===0x1f&&b[1]===0x8b)b=new Uint8Array(await new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());return decodeRoadHeights(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));}),fetchJson(new URL('road-heights/structures.json',DATA))])
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
  if(run.quad){
   // 6.25 m cells sit on the road, so the road height is the lidar road surface at the route point
   // itself (nearest 5 m station within 25 m), not the lowest road nearby. A cell with less than
   // 0.03 ft of water is dry: its water surface is only the cell's ground, so it counts as no water.
   if(pkg&&!road&&!bridge){const at=near(pkg.stations.filter(s=>fp.routes.includes(s.route)&&!s.deck),u.e,u.n,25)[0]?.p;if(at)road={m:at.m,e:at.x,n:at.z,deck:false,source:'Road surface at the route point, USGS 3DEP 1 m lidar'};}
   // The exact water surface at this crossing's own route point, from each model area that has it.
   // The first listed is the area built for this crossing's routes; another area's value stays beside it.
   const list=run.quad.pointSeries(fp.id).sort((a,b)=>Number(b.routes.includes(fp.routes[0]))-Number(a.routes.includes(fp.routes[0])));
   if(!list.length)return{fp,inside:false};
   road??={m:NaN,deck:false,source:'No lidar road height at the route point'};
   const cases=list.map(c=>({key:c.key,label:c.label,surface:c.zs,depth:c.depth,over:c.zs.map((z,k)=>!Number.isFinite(road.m)||!Number.isFinite(z)||!Number.isFinite(c.depth[k])?NaN:c.depth[k]<.0091?-Infinity:z-road.m),missing:c.zs.map((z,k)=>Number.isNaN(z)&&Number.isNaN(c.depth[k]))}));
   return{fp,inside:true,road,cell:-1,over:cases[0].over,surface:cases[0].surface,depth:cases[0].depth,cases,quad:true};
  }
  if(pkg&&!road&&!bridge){const low=near(pkg.stations.filter(s=>fp.routes.includes(s.route)&&!s.deck),u.e,u.n,100).reduce((a,o)=>!a||o.p.m<a.m?o.p:a,null);if(low)road={m:low.m,e:low.x,n:low.z,deck:false,source:'Lowest road surface within 100 m, USGS 3DEP 1 m lidar'};}
  const at=road??{e:u.e,n:u.n},cell=cellAt(run.cells,at.e,at.n);
  if(cell<0)return{fp,inside:false};
  if(!road)road={m:NaN,deck:false,source:'Road height unavailable'};
  const surface=run.surface.map(s=>s[cell]),depth=run.depth.map(d=>d[cell]);
  const over=surface.map((z,k)=>!Number.isFinite(road.m)||!Number.isFinite(z)||!Number.isFinite(depth[k])?NaN:depth[k]<.0091?-Infinity:z-road.m);
  return{fp,inside:true,road,cell,over,surface,depth};
 });
}
export const depthBand=m=>{const ft=m/.3048;let k=-1;for(let i=0;i<DEPTH_FT.length;i++)if(ft>=DEPTH_FT[i])k=i;return k;};
const rainBand=v=>{let k=-1;for(let i=0;i<RAIN_MMH.length;i++)if(v>=RAIN_MMH[i])k=i;return k;};

// The 100 m cells as one small picture, a pixel per cell (north up), so the map can draw water with
// soft edges instead of squares. px[k] is cell k's pixel; cols and rows are counted from the grid origin.
export function cellGrid(index){
 let minC=Infinity,maxC=-Infinity,minR=Infinity,maxR=-Infinity;
 for(const key of index.keys()){const c=Math.floor(key/1000),r=key%1000;if(c<minC)minC=c;if(c>maxC)maxC=c;if(r<minR)minR=r;if(r>maxR)maxR=r;}
 if(!Number.isFinite(minC))return null;
 const w=maxC-minC+1,h=maxR-minR+1,px=new Int32Array(index.size);
 for(const [key,k] of index)px[k]=(maxR-key%1000)*w+(Math.floor(key/1000)-minC);
 return{w,h,minC,maxR,px};
}
const DEPTH_RGB=DEPTH_COLORS.map(c=>[1,3,5].map(i=>parseInt(c.slice(i,i+2),16)));
// Below this many screen pixels per cell the water is drawn soft; closer in, the model's own cells show.
const SOFT_BELOW_PX=14;
// The layer: one canvas over the map, redrawn when the view, the hour or the run changes.
export function createSimLayer(L,map){
 if(!map.getPane('simWater'))map.createPane('simWater').style.zIndex=350;
 const pane=map.getPane('simWater'),canvas=document.createElement('canvas');canvas.className='sim-canvas';pane.append(canvas);
 const flowLayer=L.layerGroup().addTo(map);
 let run=null,clock=0,show={water:true,hand:false,rain:true,flow:true},frame=0,junctions=null,flows=null;
 // The all-route run's labels: each model area's name.
 const quadLabels=L.layerGroup().addTo(map);let quadLabelKey='',frameWait=null;
 // Frames of the all-route run load one at a time: the two at the clock first, then two ahead.
 function needFrames(){
  const q=run.quad,i=Math.min(run.times.length-1,Math.floor(clock)),j=Math.min(run.times.length-1,i+1);
  const now=[i,j].filter(fi=>q.cases.some(c=>c.byTime.has(q.iso[fi])&&q.peek(c,fi)===undefined));
  if(now.length&&!frameWait){const r=run;frameWait=Promise.all(now.map(fi=>q.ensure(fi))).then(()=>{frameWait=null;if(run===r)draw();},e=>{frameWait=null;error?.(e);});}
  if(!now.length)for(const fi of [j+1,j+2])if(fi<run.times.length)q.ensure(fi).catch(()=>{});
  if(run.def.id!==quadLabelKey){quadLabelKey=run.def.id;quadLabels.clearLayers();
   q.pkg.cases.forEach(info=>L.marker(info.labelAt,{interactive:false,keyboard:false,icon:L.divIcon({className:'live-reading quad-label',html:`<span>${info.label.split(':')[0]} model area</span>`,iconSize:[0,0]})}).addTo(quadLabels));
  }
 }
 let error=null;
 const at=()=>{const i=Math.min(run.times.length-1,Math.floor(clock)),j=Math.min(run.times.length-1,i+1);return{i,j,f:clock-i};};
 function depthAt(k){const {i,j,f}=at(),a=run.depth[i][k],b=run.depth[j][k];return Number.isNaN(a)?NaN:a+((Number.isNaN(b)?a:b)-a)*f;}
 function time(){const {i,j,f}=at();return run.times[i]+(run.times[j]-run.times[i])*f;}
 function draw(){
  cancelAnimationFrame(frame);frame=requestAnimationFrame(paint);
 }
 function paint(){
  const size=map.getSize(),ratio=canvasRatio();
  canvas.width=size.x*ratio;canvas.height=size.y*ratio;canvas.style.width=size.x+'px';canvas.style.height=size.y+'px';
  L.DomUtil.setPosition(canvas,map.containerPointToLayerPoint([0,0]));
  const ctx=canvas.getContext('2d');ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,size.x,size.y);
  if(!run)return;
  if(run.quad)needFrames();
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
  // HAND: every window drawn from its own reach's flow this hour; the outline marks each window,
  // so a window with no water still shows that HAND was run there.
  const hh=show.hand&&junctions&&flows&&flows.run===run?handHour(junctions,flows.f,Math.min(run.times.length-1,Math.round(clock))):null;
  if(hh){
   ctx.imageSmoothingEnabled=false;
   for(const {j,im} of hh.shown){
    const w=windowBounds(j);if(!b.intersects([[w.south,w.west],[w.north,w.east]]))continue;
    const p=map.latLngToContainerPoint([w.north,w.west]),q=map.latLngToContainerPoint([w.south,w.east]);
    if(im.canvas){ctx.globalAlpha=.85;ctx.drawImage(im.canvas,p.x,p.y,q.x-p.x,q.y-p.y);ctx.globalAlpha=1;}
    ctx.setLineDash(im.noFlow?[3,4]:[]);ctx.strokeStyle=im.noFlow?'rgba(90,90,90,.55)':'rgba(15,111,106,.75)';ctx.lineWidth=1;ctx.strokeRect(p.x+.5,p.y+.5,q.x-p.x,q.y-p.y);ctx.setLineDash([]);
   }
  }
  if(show.water&&run.quad){
   run.painter.paintOutlines(ctx,map,Math.min(run.times.length-1,Math.round(clock)));
   run.painter.paint(ctx,map,clock,size);
  }
  if(show.water&&!run.quad&&softWater(ctx)){/* drawn soft */}
  else if(show.water&&!run.quad){
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
 // Soft water for the 100 m runs: the cells as a small picture, stretched onto the map with smoothing.
 // Colors are the same depth bands as the key. Returns false when zoomed in far enough to show cells.
 let soft=null;
 function softWater(ctx){
  const cells=run.cells;
  if(soft?.cells!==cells){
   const g=cellGrid(cells.index);if(!g){soft={cells};return false;}
   const off=document.createElement('canvas');off.width=g.w;off.height=g.h;
   soft={cells,g,off,octx:off.getContext('2d'),image:new ImageData(g.w,g.h)};
  }
  if(!soft.g)return false;
  const {g,off,octx,image}=soft;
  // The picture's corners on screen. UTM to screen is close to a straight stretch over this area.
  const corner=(c,r)=>{const ll=fromUtm(GRID.x0+c*100,GRID.y0+r*100);return map.latLngToContainerPoint([ll.lat,ll.lon]);};
  const tl=corner(g.minC,g.maxR+1),tr=corner(g.minC+g.w,g.maxR+1),bl=corner(g.minC,g.maxR+1-g.h);
  if(Math.hypot(tr.x-tl.x,tr.y-tl.y)/g.w>=SOFT_BELOW_PX)return false;
  const data=image.data;data.fill(0);
  for(let k=0;k<cells.n;k++){
   const d=depthAt(k);const band=Number.isNaN(d)?-1:depthBand(d);if(band<0)continue;
   const o=g.px[k]*4,c=DEPTH_RGB[band];data[o]=c[0];data[o+1]=c[1];data[o+2]=c[2];data[o+3]=255;
  }
  octx.putImageData(image,0,0);
  ctx.save();ctx.globalAlpha=.82;ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
  ctx.transform((tr.x-tl.x)/g.w,(tr.y-tl.y)/g.w,(bl.x-tl.x)/g.h,(bl.y-tl.y)/g.h,tl.x,tl.y);
  ctx.drawImage(off,0,0);ctx.restore();
  return true;
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
  setJunctions(list){junctions=list;draw();},
  // The flows HAND runs with, for one run (hand-runs.js flowsForRun).
  setFlows(r,f){flows={run:r,f};draw();},
  // The windows with HAND water this hour.
  handBounds(){
   if(!run||!junctions||flows?.run!==run)return null;const hh=handHour(junctions,flows.f,Math.min(run.times.length-1,Math.round(clock)));
   let s=90,w=180,n=-90,e=-180,any=false;
   for(const {j,im} of hh.shown){if(!im.wet)continue;const b=windowBounds(j);any=true;s=Math.min(s,b.south);n=Math.max(n,b.north);w=Math.min(w,b.west);e=Math.max(e,b.east);}
   return any?[[s,w],[n,e]]:null;
  },
  // HAND this hour: windows with water, without a flow, beyond their rating curves, and the source.
  handNow(){
   if(!run)return null;if(!junctions||flows?.run!==run)return{loading:true};
   const h=Math.min(run.times.length-1,Math.round(clock)),hh=handHour(junctions,flows.f,h);
   const sc=hh.shown.find(x=>isSantaCruz(x.j)&&Number.isFinite(x.q));
   return{...hh,source:flows.f.source,kind:flows.f.kind,riverM3s:sc?.q??null};
  },
  setRun(r){run=r;clock=Math.min(clock,r.times.length-1);lastFlowHour=-1;quadLabelKey='';quadLabels.clearLayers();draw();drawFlow();},
  onError(fn){error=fn;},
  setClock(c){if(!run)return;clock=Math.max(0,Math.min(run.times.length-1,c));draw();const h=Math.floor(clock);if(h!==lastFlowHour){lastFlowHour=h;drawFlow();}},
  set(key,on){show[key]=on;draw();if(key==='flow')drawFlow();},
  show(on){pane.style.display=on?'':'none';on?map.addLayer(flowLayer):map.removeLayer(flowLayer);on?map.addLayer(quadLabels):map.removeLayer(quadLabels);},
  get run(){return run;},get clock(){return clock;},time:()=>run?time():null,
  // Simulated depth at a place, for the readout when the map is tapped.
  depthAt(lat,lon){
   if(!run)return null;
   if(run.quad){const fi=Math.min(run.times.length-1,Math.round(clock)),list=run.quad.valuesAt(lat,lon,fi);return list.length?{quad:list,depth:list.find(v=>v.drawn)?.depth??NaN,cell:-1}:null;}
   const u=toUtm(lon,lat),k=cellAt(run.cells,u.e,u.n);
   return k<0?null:{depth:depthAt(k),cell:k};
  },
  // Corners of every cell deeper than the threshold now, for "fit water".
  wetBounds(minM=.3){
   if(!run)return null;if(run.quad)return run.painter.wetBounds(clock,minM);
   const {box,n}=run.cells;let s=90,w=180,no=-90,e=-180,any=false;
   for(let k=0;k<n;k++){const d=depthAt(k);if(!(d>=minM))continue;any=true;s=Math.min(s,box[k*4]);w=Math.min(w,box[k*4+1]);no=Math.max(no,box[k*4+2]);e=Math.max(e,box[k*4+3]);}
   return any?[[s,w],[no,e]]:null;
  },
 };
}
