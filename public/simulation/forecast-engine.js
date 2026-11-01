// One app-facing provider. No routing-model fallback or road-safety inference.
export const NWPS_ROOT = 'https://api.water.noaa.gov/nwps/v1/gauges/SCTA3';
const CFS_TO_M3S = 0.028316846592;
const units = { kcfs: 1000 * CFS_TO_M3S, 'ft3/s': CFS_TO_M3S, cfs: CFS_TO_M3S, 'm3/s': 1 };
const unavailable = (status, reason) => ({schemaVersion:1,status,reason,provider:'NOAA NWPS',siteId:'SCTA3',points:[],peak:null,uncertainty:{status:'not_provided',plusMinus:null,confidenceLevel:null,reason:'No provider uncertainty interval supplied. Local routing benchmark errors do not measure NOAA forecast accuracy.'}});

export function normalizeForecast(metadata, stageflow, {now=Date.now(), retrievedAt=new Date(now).toISOString(), maxIssueAgeHours=24}={}) {
  if (!Number.isFinite(now) || !Number.isFinite(maxIssueAgeHours) || maxIssueAgeHours <= 0) throw new Error('Invalid clock/freshness policy');
  if (metadata?.lid!=='SCTA3' || metadata?.usgsId!=='09486520' || String(metadata?.reachId)!=='15890430') return unavailable('unsupported','Station identity mismatch');
  const f=stageflow?.forecast, issued=Date.parse(f?.issuedTime);
  if (!f || !Array.isArray(f.data) || !f.data.length) return unavailable('insufficient_data','No official forecast issued');
  if (f.primaryName!=='Stage' || f.primaryUnits!=='ft' || f.secondaryName!=='Flow' || !Object.hasOwn(units,f.secondaryUnits)) return unavailable('unsupported','Unknown forecast units or variable');
  if (!Number.isFinite(issued) || issued>now+5*60000) return unavailable('insufficient_data','Invalid or future issue time');
  const points=[];
  for (const p of f.data) {
    const t=Date.parse(p.validTime);
    if (!Number.isFinite(t) || typeof p.primary!=='number' || !Number.isFinite(p.primary) || typeof p.secondary!=='number' || !Number.isFinite(p.secondary) || p.secondary<0 || (points.length && t<=Date.parse(points.at(-1).time))) return unavailable('insufficient_data','Invalid, missing or unordered forecast samples');
    points.push({time:new Date(t).toISOString(),flowM3s:p.secondary*units[f.secondaryUnits],stageFt:p.primary});
  }
  const future=points.filter(p=>Date.parse(p.time)>=now);
  if (!future.length) return unavailable('expired','Forecast horizon ended');
  const gaps=points.slice(1).map((p,i)=>(Date.parse(p.time)-Date.parse(points[i].time))/60000);
  if (Math.max(0,...gaps)>120 || Date.parse(future[0].time)-now>120*60000) return unavailable('insufficient_data','Forecast coverage gap exceeds two-hour app policy');
  const ageHours=(now-issued)/3600000;
  const result={...unavailable(ageHours>maxIssueAgeHours?'stale':'ok',ageHours>maxIssueAgeHours?'Issue exceeds app freshness policy':'Official forecast available'),
    issuedAt:f.issuedTime,retrievedAt,asOf:new Date(now).toISOString(),issueAgeHours:ageHours,maxIssueAgeHours,
    points:future,peak:future.reduce((a,b)=>b.flowM3s>a.flowM3s?b:a),peakStage:future.reduce((a,b)=>b.stageFt>a.stageFt?b:a),
    coverage:{start:future[0].time,end:future.at(-1).time,samples:future.length,maxGapMinutes:Math.max(0,...gaps)},
    geography:{name:metadata.name,usgsId:metadata.usgsId,nwmReachId:String(metadata.reachId),scope:'Santa Cruz River gauge at Trico Road only; not Los Robles or every Trico crossing'},
    provenance:{metadataUrl:NWPS_ROOT,forecastUrl:NWPS_ROOT+'/stageflow',originalFlowUnits:f.secondaryUnits,originalStageUnits:f.primaryUnits},
    providerContext:{categories:metadata.flood?.categories??null,stageUnits:metadata.flood?.stageUnits??null,flowUnits:metadata.flood?.flowUnits??null,impacts:metadata.flood?.impacts??[],inundationEnabled:metadata.inundation?.enabled===true},
    limitations:['Stage is gauge height, not road depth.','Provider impact statements are context, not observed closures.','No passability or structural-failure prediction.','Rainfall-to-local-crossing prediction is not supported.']};
  return result;
}

// Injectable fetch and clock: use browser fetch or a server-side transport. Cache is memory-only.
export function createForecastEngine({enabled=false,fetchImpl=globalThis.fetch,clock=Date.now,cacheMinutes=5,timeoutMs=10000}={}) {
  let cached;
  return {async predict({siteId='SCTA3',force=false}={}) {
    if (!enabled) return unavailable('disabled','Enable experimentalForecasts explicitly');
    if (siteId!=='SCTA3') return unavailable('unsupported','Only SCTA3 is supported');
    const now=clock();
    if (!force && cached && now-cached.at<cacheMinutes*60000) return {...normalizeForecast(cached.metadata,cached.series,{now,retrievedAt:cached.retrievedAt}),delivery:'cache'};
    try {
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
      let responses;
      try {responses=await Promise.all([NWPS_ROOT,NWPS_ROOT+'/stageflow'].map(async url=>{const r=await fetchImpl(url,{signal:controller.signal});if(!r.ok)throw new Error(`NOAA HTTP ${r.status}`);return r.json();}));} finally {clearTimeout(timer);}
      const retrievedAt=new Date(clock()).toISOString(),[metadata,series]=responses;
      const result=normalizeForecast(metadata,series,{now:clock(),retrievedAt});
      if (['ok','stale'].includes(result.status)) cached={metadata,series,at:clock(),retrievedAt};
      return {...result,delivery:'network'};
    } catch(error) {
      if(cached) { cached.at=-Infinity; return {...normalizeForecast(cached.metadata,cached.series,{now:clock(),retrievedAt:cached.retrievedAt}),status:'unavailable',reason:`Refresh failed: ${error.message}`,delivery:'cached_after_error'}; }
      return unavailable('unavailable',`Forecast request failed: ${error.message}`);
    }
  }};
}
