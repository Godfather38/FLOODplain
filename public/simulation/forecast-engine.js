import {FORECAST_STATIONS,stationUrl,zonedTime} from './forecast-stations.js';
// One app-facing provider. No routing-model fallback or road-safety inference.
import {fetchEnsemble} from './ensemble.js';
export const NWPS_ROOT = 'https://api.water.noaa.gov/nwps/v1/gauges/SCTA3';
const CFS_TO_M3S = 0.028316846592;
const units = { kcfs: 1000 * CFS_TO_M3S, 'ft3/s': CFS_TO_M3S, cfs: CFS_TO_M3S, 'm3/s': 1 };
const unavailable = (status, reason) => ({schemaVersion:1,status,reason,provider:'NOAA NWPS',siteId:'SCTA3',points:[],peak:null,uncertainty:{status:'not_provided',plusMinus:null,confidenceLevel:null,reason:'No provider uncertainty interval supplied. Local routing benchmark errors do not measure NOAA forecast accuracy.'}});

export function normalizeForecast(metadata, stageflow, {now=Date.now(), retrievedAt=new Date(now).toISOString(), maxIssueAgeHours=24,siteId=metadata?.lid}={}) {
  if (!Number.isFinite(now) || !Number.isFinite(maxIssueAgeHours) || maxIssueAgeHours <= 0) throw new Error('Invalid clock/freshness policy');
  const station=FORECAST_STATIONS[siteId],context={siteId,geography:station??null,inundation:{status:metadata?.inundation?.enabled===true?'provider_available':'unavailable',reason:'No local inundation prediction supplied by this engine'}};
  const fail=(status,reason)=>({...unavailable(status,reason),...context});
  if (!station || metadata?.lid!==siteId || metadata?.usgsId!==station.usgsId || String(metadata?.reachId)!==station.reachId) return fail('unsupported','Station identity mismatch');
  if(!Number.isFinite(zonedTime(retrievedAt)) || zonedTime(retrievedAt)>now+300000)return fail('insufficient_data','Invalid retrieval clock');
  const f=stageflow?.forecast, issued=zonedTime(f?.issuedTime);
  if (!f || !Array.isArray(f.data) || !f.data.length) return fail('no_forecast','No official forecast issued');
  if (f.primaryName!=='Stage' || f.primaryUnits!=='ft' || f.secondaryName!=='Flow' || !Object.hasOwn(units,f.secondaryUnits)) return fail('unsupported','Unknown forecast units or variable');
  if (!Number.isFinite(issued) || issued>now+5*60000) return fail('insufficient_data','Invalid or future issue time');
  const points=[];
  for (const p of f.data) {
    const t=zonedTime(p.validTime);
    if (!Number.isFinite(t) || typeof p.primary!=='number' || !Number.isFinite(p.primary) || p.primary<=-900 || typeof p.secondary!=='number' || !Number.isFinite(p.secondary) || p.secondary<0 || (points.length && t<=Date.parse(points.at(-1).time))) return fail('insufficient_data','Invalid, missing or unordered forecast samples');
    points.push({time:new Date(t).toISOString(),flowM3s:p.secondary*units[f.secondaryUnits],stageFt:p.primary});
  }
  const future=points.filter(p=>Date.parse(p.time)>=now);
  if (!future.length) return fail('expired','Forecast horizon ended');
  const gaps=points.slice(1).map((p,i)=>(Date.parse(p.time)-Date.parse(points[i].time))/60000);
  if (Math.max(0,...gaps)>120 || Date.parse(future[0].time)-now>120*60000) return fail('insufficient_data','Forecast coverage gap exceeds two-hour app policy');
  const ageHours=(now-issued)/3600000;
  const result={...fail(ageHours>maxIssueAgeHours?'stale':'ok',ageHours>maxIssueAgeHours?'Issue exceeds app freshness policy':'Official forecast available'),
    issuedAt:f.issuedTime,retrievedAt,asOf:new Date(now).toISOString(),issueAgeHours:ageHours,maxIssueAgeHours,
    points:future,peak:future.reduce((a,b)=>b.flowM3s>a.flowM3s?b:a),peakStage:future.reduce((a,b)=>b.stageFt>a.stageFt?b:a),
    coverage:{start:future[0].time,end:future.at(-1).time,samples:future.length,maxGapMinutes:Math.max(0,...gaps)},
    geography:{name:metadata.name,usgsId:metadata.usgsId,nwmReachId:String(metadata.reachId),scope:station.name+' gauge only; not surrounding roads or other crossings'},
    provenance:{metadataUrl:stationUrl(siteId),forecastUrl:stationUrl(siteId)+'/stageflow',originalFlowUnits:f.secondaryUnits,originalStageUnits:f.primaryUnits},
    providerContext:{categories:metadata.flood?.categories??null,stageUnits:metadata.flood?.stageUnits??null,flowUnits:metadata.flood?.flowUnits??null,impacts:metadata.flood?.impacts??[],inundationEnabled:metadata.inundation?.enabled===true},
    limitations:['Stage is gauge height, not road depth.','Provider impact statements are context, not observed closures.','No passability or structural-failure prediction.','Rainfall-to-local-crossing prediction is not supported.']};
  return result;
}

// Injectable fetch and clock: use browser fetch or a server-side transport. Cache is memory-only.
export function createForecastEngine({enabled=false,fetchImpl=globalThis.fetch,clock=Date.now,cacheMinutes=5,timeoutMs=10000}={}) {
  const cache=new Map();
  return {async ensemble({siteId='SCTA3'}={}){return enabled?fetchEnsemble({fetchImpl,clock,timeoutMs,siteId}):{status:'disabled',points:[],reason:'Enable experimentalForecasts explicitly'};},async predict({siteId='SCTA3',force=false}={}) {
    if (!enabled) return {...unavailable('disabled','Enable experimentalForecasts explicitly'),siteId};
    if (!FORECAST_STATIONS[siteId]) return {...unavailable('unsupported','Station not supported'),siteId};
    const cached=cache.get(siteId),root=stationUrl(siteId);
    const now=clock();
    if (!force && cached && now>=cached.at && now-cached.at<cacheMinutes*60000) return {...normalizeForecast(cached.metadata,cached.series,{now,retrievedAt:cached.retrievedAt,siteId}),delivery:'cache'};
    try {
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
      let responses;
      try {responses=await Promise.all([root,root+'/stageflow'].map(async url=>{const r=await fetchImpl(url,{signal:controller.signal});if(!r.ok)throw new Error(`NOAA HTTP ${r.status}`);return r.json();}));} finally {clearTimeout(timer);}
      const retrievedAt=new Date(clock()).toISOString(),[metadata,series]=responses;
      const result=normalizeForecast(metadata,series,{now:clock(),retrievedAt,siteId});
      if (['ok','stale'].includes(result.status)) cache.set(siteId,{metadata,series,at:clock(),retrievedAt});
      else cache.delete(siteId);
      return {...result,delivery:'network'};
    } catch(error) {
      if(cached) { cached.at=-Infinity; return {...normalizeForecast(cached.metadata,cached.series,{now:clock(),retrievedAt:cached.retrievedAt,siteId}),status:'unavailable',reason:`Refresh failed: ${error.message}`,delivery:'cached_after_error'}; }
      return {...unavailable('unavailable',`Forecast request failed: ${error.message}`),siteId};
    }
  }};
}
