export const HEFS_URL='https://api.water.noaa.gov/hefs/v1/hydrograph-quantiles/?location_id=SCTA3&parameter_id=QINE';
const factor=.028316846592;
export function normalizeEnsemble(raw,{now=Date.now(),retrievedAt=new Date(now).toISOString()}={}) {
 const empty=(status,reason)=>({status,reason,provider:'NOAA experimental HEFS',points:[],accuracyPlusMinus:null});
 const m=raw?.metadata,q=m?.exceedance_quantiles;
 if(m?.location_id!=='SCTA3'||m.parameter_id!=='QINE'||m.units!=='CFS'||!Array.isArray(q)||!Array.isArray(raw.value_set))return empty('unsupported','Unsupported HEFS station, variable or units');
 if(q.some((v,i)=>!Number.isFinite(v)||v<=0||v>=1||(i&&v<=q[i-1]))||![.1,.5,.9].every(v=>q.includes(v)))return empty('unsupported','Require ordered 10%, 50%, 90% exceedance quantiles');
 const issued=Date.parse(m.forecast_datetime);if(!Number.isFinite(issued)||issued>now+300000)return empty('insufficient_data','Invalid ensemble issue time');
 let missingRows=0,previous=-Infinity;const points=[];
 for(const row of raw.value_set){
  const t=Date.parse(row.valid_datetime),v=row.quantile_values;
  if(!Number.isFinite(t)||t<=previous)return empty('insufficient_data','Invalid ensemble time ordering');previous=t;
  if(!Array.isArray(v)||v.length!==q.length||v.some(x=>typeof x!=='number'||!Number.isFinite(x)||x<0)){missingRows++;continue;}
  // Exceedance probability rises as flow FALLS. Never treat these as ordinary percentiles.
  if(v.some((x,i)=>i&&x>v[i-1]))return empty('insufficient_data','Exceedance flows must be nonincreasing');
  if(t>=now)points.push({time:new Date(t).toISOString(),lowM3s:v[q.indexOf(.9)]*factor,medianM3s:v[q.indexOf(.5)]*factor,highM3s:v[q.indexOf(.1)]*factor});
 }
 if(!points.length)return empty('insufficient_data','No future complete ensemble rows');
 const ageHours=(now-issued)/3600000;
 return {...empty(ageHours>24?'stale':missingRows?'partial':'ok','10%–90% exceedance ensemble spread, not calibrated accuracy'),issuedAt:m.forecast_datetime,retrievedAt,issueAgeHours:ageHours,ensembleId:m.ensemble_id,points,missingRows,coverage:{start:points[0].time,end:points.at(-1).time,samples:points.length,maxGapMinutes:Math.max(0,...points.slice(1).map((p,i)=>(Date.parse(p.time)-Date.parse(points[i].time))/60000))},sourceUrl:HEFS_URL,band:{lowExceedance:.9,medianExceedance:.5,highExceedance:.1},interpretation:'Experimental HEFS spread about its own median; not a confidence band around the deterministic NWPS forecast, not a validated local ± accuracy.'};
}
export async function fetchEnsemble({fetchImpl=globalThis.fetch,clock=Date.now,timeoutMs=10000}={}){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
 try{const r=await fetchImpl(HEFS_URL,{signal:controller.signal});if(!r.ok)throw Error(`HEFS HTTP ${r.status}`);return normalizeEnsemble(await r.json(),{now:clock()});}catch(e){return{status:'unavailable',reason:e.message,provider:'NOAA experimental HEFS',points:[],accuracyPlusMinus:null};}finally{clearTimeout(timer);}
}
