import * as cfg from '../config.js';
import {loadGaugeReadings} from '../gauge-feed.js';
import {parseContinuous} from '../logic.js';
import {evaluate} from '../engine.js';
import {createIntegratedEngine,routeHandPayload} from './integrated-engine.js';
import {fuseRoutes,handEvidence} from './route-fusion.js';
export function createRouteAssessment({fetchImpl=globalThis.fetch,clock=Date.now,timeoutMs=12000}={}){
 const cache=new Map(),store={get:key=>cache.get(key),set:(key,value)=>cache.set(key,value)};
 const connected=createIntegratedEngine({enabled:true,fetchImpl,clock,timeoutMs});
 return {async refresh({area='avra'}={}){
  const errors=[],sources=[];
  const get=async url=>{try{const r=await fetchImpl(url,{signal:AbortSignal.timeout(timeoutMs)});if(!r.ok)throw Error(`HTTP ${r.status}`);const j=await r.json();if(j.error)throw Error(j.error.message??'Provider error');sources.push({url:String(url).startsWith('file:')?'public/data/routes.geojson':String(url),status:'retrieved',retrievedAt:new Date(clock()).toISOString()});return j;}catch(e){sources.push({url:String(url).startsWith('file:')?'public/data/routes.geojson':String(url),status:'unavailable',reason:e.message});throw e}};
  const optional=async(name,task)=>{try{return await task}catch(e){errors.push(`${name}: ${e.message}`);return null}};
  const sites=Object.keys(cfg.USGS_SITES),q=new URLSearchParams({where:'1=1',outFields:'Location,Status,timeUpdated',returnGeometry:'true',outSR:'4326',f:'json',geometry:cfg.CLOSURE_BOUNDS,geometryType:'esriGeometryEnvelope',inSR:'4326',spatialRel:'esriSpatialRelIntersects'});
  const gauges=loadGaugeReadings(sites,{fetchJson:get,store,parse:parseContinuous,now:clock(),proxyUrl:cfg.TEXT_API?`${cfg.TEXT_API}?feed=usgs`:null,directUrl:site=>`${cfg.SOURCES.usgs}/collections/continuous/items?f=json&monitoring_location_id=USGS-${site}&parameter_code=00060&time=PT6H&limit=500&skipGeometry=true&properties=time,value,parameter_code`});
  const [g,closures,alert,nws,routes,bundle]=await Promise.all([gauges,optional('County closures',get(`${cfg.SOURCES.closures}/query?${q}`)),optional('Pima ALERT',get(cfg.SOURCES.alert)),optional('NWS warnings',get(cfg.SOURCES.nws)),get(new URL('../data/routes.geojson',import.meta.url).href),connected.evaluate({siteId:'SCTA3'})]);
  const now=clock(),raw={now,usgs:Object.fromEntries(sites.map(s=>[s,store.get(`usgs:${s}`)?.json??null])),closures,alert,nws,routes:routes.features};
  if(!Array.isArray(raw.routes))throw Error('Route geometry unavailable');
  const original=evaluate(raw,area),snapshot={now,area,rated:original.rated,errors,missing:original.missing};
  const evidence=bundle.hand.map(handEvidence),decision=fuseRoutes(snapshot,evidence,{now});
  return {schemaVersion:1,kind:'operating_route_assessment',asOf:new Date(now).toISOString(),area,decision,observations:{snapshot,sources,missing:original.missing,errors,gaugesBusy:g.busy},connected:bundle,handTransport:routeHandPayload(bundle),limitations:['Original observations and closures retain precedence.','NWM and local QPF are context; they do not independently assign road scores.','Unsupported, stale or historically recorded inundation never clears a road.']};
 }};
}
