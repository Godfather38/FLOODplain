// HAND for every model run, shared by the 2D map and the 3D view. HAND = Height Above Nearest
// Drainage (NOAA OWP HAND grids, public/inundation/data/): each window is a 3 km grid around a
// crossing, on one National Water Model reach. A window turns that reach's flow into an estimated
// extent and depth. Each run gets an hourly flow per reach:
// - live run: NOAA's current National Water Model short-range forecast for each reach (NWPS API);
// - saved forecast runs (13Z, 19Z): the same NWM forecast cycle the run was built from, read from
//   NOAA's archive into public/inundation/data/run-flows/<id>.json (tools/hand/run_flows.py);
// - what-if storms: the run's own Santa Cruz inflow on the Santa Cruz windows; no flow exists for
//   the washes, so those windows say so instead of showing water.
import {decodeJunction,computeExtent,depthGrid,HAND_DEPTH_BANDS,depthBand} from '../inundation/hand-inundation.js?v=dev';
const HAND_DATA=new URL('../inundation/data/',import.meta.url);
export const HAND_COLORS=HAND_DEPTH_BANDS.map(b=>`rgb(${b.rgb.join(',')})`);
export const isSantaCruz=j=>/santa cruz/i.test(j.reach?.name??'');
export const reachOf=j=>String(j.reach?.featureId??j.forecast?.reachId??'');
const CFS=0.028316846592;
let fetchJson=async url=>{const r=await fetch(url);if(!r.ok)throw new Error(`${String(url).split('/').pop()} answered ${r.status}`);return r.json();};
export function useFetcher(fn){fetchJson=fn;}

let windows=null;
export function loadHand(){
 windows??=(async()=>{
  const cov=await fetchJson(new URL('coverage.json',HAND_DATA));
  const files=[...new Set(cov.points.filter(p=>p.status==='supported'&&p.file).map(p=>p.file))];
  const list=await Promise.all(files.map(f=>fetchJson(new URL(f,HAND_DATA)).then(decodeJunction).catch(()=>null)));
  return list.filter(Boolean);
 })();
 windows.catch(()=>{windows=null;});
 return windows;
}

// Hourly flow per reach for a run: {source, perReach: Map(reachId -> Float64Array of m3/s or NaN)}.
const flowCache=new Map();
export function flowsForRun(run,list){
 const key=run.def.id+'|'+run.times[0];
 if(!flowCache.has(key)){const p=buildFlows(run,list);flowCache.set(key,p);p.catch(()=>flowCache.delete(key));}
 return flowCache.get(key);
}
const nearestOnHour=(points,times)=>times.map(t=>{let best=NaN,d=Infinity;for(const p of points){const dt=Math.abs(p.t-t);if(dt<d&&dt<=40*60e3){d=dt;best=p.q;}}return best;});
async function buildFlows(run,list){
 const reaches=[...new Set(list.map(reachOf).filter(Boolean))],perReach=new Map();
 if(run.def.live){
  // NOAA NWPS: the current NWM short-range forecast for each reach, in ft³/s.
  const got=await Promise.all(reaches.map(id=>fetchJson(`https://api.water.noaa.gov/nwps/v1/reaches/${id}/streamflow?series=short_range`).then(j=>{
   const s=j?.shortRange?.series,unit=/ft/.test(s?.units??'')?CFS:1;
   return[id,(s?.data??[]).map(d=>({t:Date.parse(d.validTime),q:d.flow*unit})),s?.referenceTime];
  }).catch(()=>[id,null])));
  let cycle=null;for(const [id,pts,ref] of got){if(pts)perReach.set(id,Float64Array.from(nearestOnHour(pts,run.times)));cycle??=ref;}
  if(!perReach.size)throw new Error('NOAA did not answer for any river reach');
  const missing=reaches.length-perReach.size;
  return{source:`NOAA National Water Model short-range forecast${cycle?' from '+new Date(cycle).toISOString().slice(11,13)+'Z':''}, current for each reach${missing?` (${missing} reach${missing>1?'es':''} did not answer)`:''}`,perReach,kind:'nwm'};
 }
 if(run.def.handFlows){
  const f=await fetchJson(new URL(run.def.handFlows,HAND_DATA));
  for(const [id,pts] of Object.entries(f.reaches))perReach.set(id,Float64Array.from(nearestOnHour(pts.map(p=>({t:Date.parse(p.time),q:p.flowM3s})),run.times)));
  return{source:f.source,perReach,kind:'nwm'};
 }
 // What-ifs: the run's own Santa Cruz inflow, on the Santa Cruz reaches only.
 for(const j of list)if(isSantaCruz(j))perReach.set(reachOf(j),Float64Array.from(run.riverM3s));
 return{source:"this run's own Santa Cruz inflow (no wash flows exist for a what-if storm)",perReach,kind:'inflow'};
}

// One window at one flow, painted once into a small image: wet cells coloured by HAND depth.
const imgCache=new Map();
export function handImage(j,flowM3s){
 if(!Number.isFinite(flowM3s))return{noFlow:true};
 const key=j.id+'|'+flowM3s.toFixed(2);if(imgCache.has(key))return imgCache.get(key);
 const extent=computeExtent(j,flowM3s);let out;
 if(!extent)out={beyond:true};
 else if(!extent.wetCells)out={wet:0};
 else{
  const {cols,rows}=j.grid,d=depthGrid(j,extent),c=document.createElement('canvas');c.width=cols;c.height=rows;
  const ctx=c.getContext('2d'),img=ctx.createImageData(cols,rows);
  for(let i=0;i<d.length;i++){if(Number.isNaN(d[i]))continue;const b=HAND_DEPTH_BANDS[Math.max(0,depthBand(d[i]))].rgb;img.data.set([b[0],b[1],b[2],205],i*4);}
  ctx.putImageData(img,0,0);out={wet:extent.wetCells,areaM2:extent.wetAreaM2,canvas:c};
 }
 if(imgCache.size>600)imgCache.delete(imgCache.keys().next().value);
 imgCache.set(key,out);return out;
}
// A window's corners in latitude/longitude.
export const windowBounds=j=>{const g=j.grid;return{north:g.latMax,south:g.latMax-g.rows*g.dLat,west:g.lonMin,east:g.lonMin+g.cols*g.dLon};};
// What HAND shows for one hour: each window's flow and image, and totals.
export function handHour(list,flows,h){
 const shown=[];let wet=0,beyond=0,noFlow=0,areaM2=0;
 for(const j of list){
  const q=flows?.perReach.get(reachOf(j))?.[h];
  const im=handImage(j,q);shown.push({j,q,im});
  if(im.noFlow)noFlow++;else if(im.beyond)beyond++;else if(im.wet){wet++;areaM2+=im.areaM2;}
 }
 return{shown,windows:list.length,wet,beyond,noFlow,areaM2};
}
