import {FORECAST_STATIONS,zonedTime} from './forecast-stations.js';
export const nwmUrl=id=>`https://api.water.noaa.gov/nwps/v1/reaches/${id}/streamflow?series=short_range`;
export function normalizeNwm(raw,{reachId,now=Date.now(),retrievedAt=new Date(now).toISOString()}={}){
 const base={provider:'NOAA NWM short-range guidance',reachId,sourceUrl:nwmUrl(reachId),retrievedAt,points:[],peak:null,uncertainty:{status:'not_provided',plusMinus:null}};
 const fail=(status,reason)=>({...base,status,reason});
 if(!Number.isFinite(now)||!Number.isFinite(zonedTime(retrievedAt))||zonedTime(retrievedAt)>now+300000)return fail('insufficient_data','Invalid retrieval clock');
 if(String(raw?.reach?.reachId)!==reachId)return fail('unsupported','Reach identity mismatch');
 const series=raw.shortRange?.series,issued=zonedTime(series?.referenceTime),factor={'ft³/s':.028316846592,'ft3/s':.028316846592,'m³/s':1,'m3/s':1}[series?.units];
 if(!series?.data?.length)return fail('no_forecast','No NWM short-range series');
 if(!factor)return fail('unsupported','Unknown NWM units');
 if(!Number.isFinite(issued)||issued>now+300000)return fail('insufficient_data','Invalid model reference time');
 const points=[];
 for(const p of series.data){const t=zonedTime(p.validTime);if(!Number.isFinite(t)||typeof p.flow!=='number'||!Number.isFinite(p.flow)||p.flow<0||(points.length&&t<=Date.parse(points.at(-1).time)))return fail('insufficient_data','Missing or unordered NWM samples');points.push({time:new Date(t).toISOString(),flowM3s:p.flow*factor})}
 const future=points.filter(p=>Date.parse(p.time)>=now);if(!future.length)return fail('expired','NWM horizon ended');
 const gaps=points.slice(1).map((p,i)=>(Date.parse(p.time)-Date.parse(points[i].time))/3600000);if(Math.max(...gaps)>1.01||Date.parse(future[0].time)-now>3600000)return fail('insufficient_data','NWM hourly coverage gap');
 return {...base,status:now-issued>6*3600000?'stale':'ok',reason:'Model guidance, separate from the official RFC forecast',issuedAt:new Date(issued).toISOString(),originalUnits:series.units,name:raw.reach.name,points:future,peak:future.reduce((a,b)=>b.flowM3s>a.flowM3s?b:a),upstream:(raw.reach.route?.upstream??[]).map(r=>String(r.reachId)).filter(id=>/^\d+$/.test(id)),downstream:(raw.reach.route?.downstream??[]).map(r=>String(r.reachId)),role:'guidance',limitations:['Do not sum upstream and downstream reach flows.','No lateral inflow inferred by subtracting routed flows.','Not an observed hydrograph or official RFC forecast.']};
}
export async function fetchNwmContext({siteId,fetchImpl=fetch,clock=Date.now,timeoutMs=10000}={}){
 const station=FORECAST_STATIONS[siteId];if(!station)return {status:'unsupported',reaches:[]};
 const get=async id=>{try{const r=await fetchImpl(nwmUrl(id),{signal:AbortSignal.timeout(timeoutMs)});if(!r.ok)throw Error(`HTTP ${r.status}`);return normalizeNwm(await r.json(),{reachId:id,now:clock()})}catch(e){return {status:'unavailable',reachId:id,sourceUrl:nwmUrl(id),reason:e.message,points:[]}}};
 const target=await get(station.reachId),ids=(target.upstream??[]).slice(0,4),upstream=await Promise.all(ids.map(get));
 return {status:target.status,siteId,targetReachId:station.reachId,reaches:[{...target,relationship:'target'},...upstream.map(r=>({...r,relationship:'direct_upstream',connectedTo:station.reachId}))],omittedUpstreamCount:Math.max(0,(target.upstream?.length??0)-4),lateralInflow:{status:'not_provided',reason:'This API provides total routed reach flow, not an isolated lateral-inflow series.'}};
}
