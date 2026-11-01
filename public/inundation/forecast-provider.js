// Forecast provider for the HAND layer. Gauge handling is the shape used on the
// experimental forecast branch, reduced to what this layer needs. Reach forecasts
// are NOAA National Water Model (NWM) flows. No road condition is inferred.
import {FORECAST_STATIONS,stationUrl,zonedTime} from './forecast-stations.js';
const CFS_TO_M3S=0.028316846592;
const units={kcfs:1000*CFS_TO_M3S,'ft3/s':CFS_TO_M3S,'ft³/s':CFS_TO_M3S,cfs:CFS_TO_M3S,'m3/s':1};
export const reachUrl=id=>`https://api.water.noaa.gov/nwps/v1/reaches/${id}/streamflow?series=short_range`;
const fail=(status,reason,extra={})=>({schemaVersion:1,status,reason,points:[],peak:null,...extra});

function finish(points,issued,now,retrievedAt,maxIssueAgeHours,extra){
 const future=points.filter(p=>Date.parse(p.time)>=now);
 if(!future.length)return fail('expired','Forecast horizon ended',extra);
 const gaps=points.slice(1).map((p,i)=>(Date.parse(p.time)-Date.parse(points[i].time))/60000);
 if(Math.max(0,...gaps)>120||Date.parse(future[0].time)-now>120*60000)return fail('insufficient_data','Forecast coverage gap exceeds two hours',extra);
 const issueAgeHours=(now-issued)/3600000,stale=issueAgeHours>maxIssueAgeHours;
 return {schemaVersion:1,status:stale?'stale':'ok',reason:stale?'Issue exceeds app freshness policy':'Forecast available',issuedAt:new Date(issued).toISOString(),retrievedAt,asOf:new Date(now).toISOString(),issueAgeHours,maxIssueAgeHours,points:future,peak:future.reduce((a,b)=>b.flowM3s>a.flowM3s?b:a),...extra};
}

export function normalizeForecast(metadata,stageflow,{now=Date.now(),retrievedAt=new Date(now).toISOString(),maxIssueAgeHours=24,siteId=metadata?.lid}={}){
 const station=FORECAST_STATIONS[siteId],extra={provider:'NOAA NWPS gauge forecast',siteId,providerContext:{categories:metadata?.flood?.categories??null,flowUnits:metadata?.flood?.flowUnits??null}};
 if(!station||metadata?.lid!==siteId||metadata?.usgsId!==station.usgsId||String(metadata?.reachId)!==station.reachId)return fail('unsupported','Station identity mismatch',extra);
 extra.nwmReachId=station.reachId;
 const f=stageflow?.forecast,issued=zonedTime(f?.issuedTime);
 if(!f||!Array.isArray(f.data)||!f.data.length)return fail('no_forecast','No official forecast issued',extra);
 if(f.primaryName!=='Stage'||f.secondaryName!=='Flow'||!Object.hasOwn(units,f.secondaryUnits))return fail('unsupported','Unknown forecast units or variable',extra);
 if(!Number.isFinite(issued)||issued>now+300000)return fail('insufficient_data','Invalid or future issue time',extra);
 const points=[];
 for(const p of f.data){
  const t=zonedTime(p.validTime);
  if(!Number.isFinite(t)||!Number.isFinite(p.secondary)||p.secondary<0||(points.length&&t<=Date.parse(points.at(-1).time)))return fail('insufficient_data','Invalid, missing or unordered forecast samples',extra);
  points.push({time:new Date(t).toISOString(),flowM3s:p.secondary*units[f.secondaryUnits]});
 }
 return finish(points,issued,now,retrievedAt,maxIssueAgeHours,extra);
}

export function normalizeReachForecast(raw,{now=Date.now(),retrievedAt=new Date(now).toISOString(),maxIssueAgeHours=24,reachId=raw?.reach?.reachId}={}){
 const extra={provider:'NOAA National Water Model short range',nwmReachId:String(reachId)};
 if(String(raw?.reach?.reachId)!==String(reachId))return fail('unsupported','Reach identity mismatch',extra);
 const s=raw.shortRange?.series,issued=zonedTime(s?.referenceTime);
 if(!s||!Array.isArray(s.data)||!s.data.length)return fail('no_forecast','No model forecast for this reach',extra);
 if(!Object.hasOwn(units,s.units))return fail('unsupported','Unknown forecast units',extra);
 if(!Number.isFinite(issued)||issued>now+300000)return fail('insufficient_data','Invalid or future issue time',extra);
 const points=[];
 for(const p of s.data){
  const t=zonedTime(p.validTime);
  if(!Number.isFinite(t)||typeof p.flow!=='number'||!Number.isFinite(p.flow)||p.flow<0||(points.length&&t<=Date.parse(points.at(-1).time)))return fail('insufficient_data','Invalid, missing or unordered forecast samples',extra);
  points.push({time:new Date(t).toISOString(),flowM3s:p.flow*units[s.units]});
 }
 return finish(points,issued,now,retrievedAt,maxIssueAgeHours,extra);
}

// Off unless enabled. Injectable fetch and clock. A failed request gives no forecast.
export function createForecastProvider({enabled=false,fetchImpl=globalThis.fetch,clock=Date.now,timeoutMs=10000}={}){
 const get=async url=>{
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{const r=await fetchImpl(url,{signal:controller.signal});if(!r.ok)throw new Error(`NOAA HTTP ${r.status}`);return await r.json();}finally{clearTimeout(timer);}
 };
 return {async predict(forecast){
  if(!enabled)return fail('disabled','Live requests are off');
  try{
   if(forecast?.kind==='gauge'){
    const root=stationUrl(forecast.station),[m,s]=await Promise.all([get(root),get(root+'/stageflow')]);
    return normalizeForecast(m,s,{now:clock(),siteId:forecast.station});
   }
   if(forecast?.kind==='nwm_reach')return normalizeReachForecast(await get(reachUrl(forecast.reachId)),{now:clock(),reachId:forecast.reachId});
   return fail('unsupported','Unknown forecast source');
  }catch(error){return fail('unavailable',`Forecast request failed: ${error.message}`);}
 }};
}
