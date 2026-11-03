// Live conditions for the 3D map, from the same feeds and the same rating code as the app
// (app.js gather/compute): USGS river gauges, county barricades, Pima ALERT rain and stream
// gauges, NWS alerts and TransView closures, rated with logic.js. Nothing here is saved data.
import * as cfg from '../../../config.js';
import {getJson} from '../../../network.js';
import {loadGaugeReadings} from '../../../gauge-feed.js';
import {parseContinuous,summarizeFlow,rateFailurePoint,rateRoutes,routeScore,riskScore,roadEventActive} from '../../../logic.js';
const {SOURCES,USGS_SITES,FAILURE_POINTS,STALE_MS}=cfg;
// The app keeps gauge replies for ten minutes; this page keeps them for its own session only.
const memory=new Map(),store={get:k=>memory.get(k),set:(k,v)=>memory.set(k,v)};
const settle=async(name,p,errors)=>{try{return await p;}catch{errors.push(name+' not responding');return null;}};
async function loadClosures(){
 const q=new URLSearchParams({where:'1=1',outFields:'Location,Status,Direction,timeUpdated',returnGeometry:'true',outSR:'4326',f:'json',geometry:cfg.CLOSURE_BOUNDS,geometryType:'esriGeometryEnvelope',inSR:'4326',spatialRel:'esriSpatialRelIntersects'});
 const j=await getJson(`${SOURCES.closures}/query?${q}`);if(j.error)throw new Error(j.error.message);
 return j.features.map(f=>({location:f.attributes.Location?.trim(),status:f.attributes.Status??'',direction:f.attributes.Direction??'',updated:f.attributes.timeUpdated,lat:f.geometry.y,lon:f.geometry.x}));
}
async function loadAlert(){
 if(cfg.TEXT_API){try{const a=await getJson(`${cfg.TEXT_API}?feed=alert`);if(a&&a.rain)return a;}catch{/* fall back */}}
 return getJson(SOURCES.alert);
}
async function loadRoadEvents(){if(!cfg.TEXT_API)return null;const j=await getJson(`${cfg.TEXT_API}?feed=roadevents`);if(!Array.isArray(j?.events))throw new Error('no road events');return j.events;}
async function loadNws(){const j=await getJson(SOURCES.nws,{headers:{Accept:'application/geo+json'}});return(j.features??[]).map(f=>({event:f.properties.event,headline:f.properties.headline}));}
async function loadUsgs(sites){
 const r=await loadGaugeReadings(sites,{fetchJson:getJson,store,parse:parseContinuous,proxyUrl:cfg.TEXT_API?`${cfg.TEXT_API}?feed=usgs`:null,
  directUrl:site=>`${SOURCES.usgs}/collections/continuous/items?f=json&monitoring_location_id=USGS-${site}&parameter_code=00060&time=PT6H&limit=500&skipGeometry=true&properties=time,value,parameter_code`});
 return r.series;
}
// {now, scores: {fpId: 1-5|null}, results, routes: {routeId: 1-5|null}, closures: [{lat,lon,title}], errors}
export async function loadLiveConditions(routes){
 const now=Date.now(),errors=[],sites=Object.keys(USGS_SITES);
 const [flowsArr,closures,alert,nws,roadEvents]=await Promise.all([settle('river gauges',loadUsgs(sites),errors),settle('county barricades',loadClosures(),errors),settle('rain gauges',loadAlert(),errors),settle('weather service',loadNws(),errors),settle('TransView closures',loadRoadEvents(),errors)]);
 const flows=Object.fromEntries(sites.map((s,i)=>[s,summarizeFlow(flowsArr?.[i]??{},now,STALE_MS)]));
 if(!Object.values(flows).some(f=>f.fresh))errors.push('no fresh river gauge reading');
 const d={now,flows,closures,alert,nws,roadEvents};
 const results=Object.fromEntries(FAILURE_POINTS.map(fp=>[fp.id,rateFailurePoint(fp,d,cfg)]));
 const scores=Object.fromEntries(FAILURE_POINTS.map(fp=>[fp.id,riskScore(results[fp.id])]));
 const rated=rateRoutes(routes.features,results,FAILURE_POINTS,{closures,radiusM:cfg.CLOSURE_RADIUS_M,roadEvents,now});
 const routeScores=Object.fromEntries(rated.map(r=>[r.id,routeScore(r)]));
 const closed=(closures??[]).filter(c=>/clos/i.test(c.status??'')&&Number.isFinite(c.lat)).map(c=>({lat:c.lat,lon:c.lon,title:`Closed: ${c.location}${c.direction?`, ${c.direction.toLowerCase()}`:''}`}));
 for(const e of (roadEvents??[]).filter(e=>e.closed&&roadEventActive(e,now)))for(const part of e.parts??[])if(part[0])closed.push({lat:part[0][1],lon:part[0][0],title:`Closed: ${e.headline.trim()}`});
 return{now,scores,results,routes:routeScores,closures:closed,errors:[...new Set(errors)]};
}
