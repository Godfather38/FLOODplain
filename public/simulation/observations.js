// Regional observations remain distinct from uncalibrated local-window output.
export function normalizeUsgs(json, { siteId, retrievedAt, sourceUrl }) {
  if (!/^USGS-\d{8,15}$/.test(siteId) || !Number.isFinite(Date.parse(retrievedAt)) || !sourceUrl.startsWith('https://api.waterdata.usgs.gov/')) throw new Error('USGS site, retrieval time and official source URL required');
  if (json?.type !== 'FeatureCollection' || !Array.isArray(json.features) || !json.features.length || json.features.length > 1000) throw new Error('Expected 1–1000 USGS features');
  if (json.links?.some(l=>l.rel==='next')) throw new Error('Incomplete paginated record: narrow the time window');
  const points=json.features.map(f=>{
    const p=f.properties;
    if(p?.monitoring_location_id!==siteId || p.parameter_code!=='00060' || p.unit_of_measure!=='ft^3/s') throw new Error('Wrong station, parameter or discharge units');
    const time=Date.parse(p.time), value=Number(p.value);
    if(!/(Z|[+-]\d{2}:\d{2})$/.test(p.time) || !Number.isFinite(time) || p.value===null || String(p.value).trim()==='' || !Number.isFinite(value) || value<0) throw new Error('Missing/invalid gauge value or timezone');
    return {time:new Date(time).toISOString(),valueM3s:value*0.028316846592,originalValueCfs:value,approval:p.approval_status??'Unknown',qualifier:p.qualifier??null};
  }).sort((a,b)=>Date.parse(a.time)-Date.parse(b.time));
  if(points.some((p,i)=>i&&p.time===points[i-1].time)) throw new Error('Duplicate station timestamps / multiple series');
  const gaps=points.slice(1).map((p,i)=>(Date.parse(p.time)-Date.parse(points[i].time))/60000);
  return {schemaVersion:1,kind:'gauge-observation',siteId,units:'m3/s',sourceUrl,retrievedAt,points,
    quality:{approvalStatuses:[...new Set(points.map(p=>p.approval))],qualifiedCount:points.filter(p=>p.qualifier!==null).length,maxGapMinutes:Math.max(0,...gaps)},
    warning:'Regional gauge discharge; not crossing depth or proof of bridge failure. Historical replay, not live.'};
}

export function compareDischarge(modeled, observed) {
  if(observed.kind!=='gauge-observation' || modeled.siteId!==observed.siteId || modeled.units!=='m3/s' || observed.units!=='m3/s') throw new Error('Comparison requires matching station and m3/s units; no automatic basin scaling');
  if(!Array.isArray(modeled.points) || !modeled.points.length) throw new Error('Modeled points required');
  const model=new Map();
  for(const p of modeled.points){const t=Date.parse(p.time);if(!/(Z|[+-]\d{2}:\d{2})$/.test(p.time)||!Number.isFinite(t)||!Number.isFinite(p.valueM3s)||p.valueM3s<0||model.has(t))throw new Error('Invalid/duplicate model timestamp or flow');model.set(t,p.valueM3s);}
  const eligible=observed.points.filter(p=>p.approval==='Approved'&&p.qualifier===null);
  const pairs=eligible.filter(p=>model.has(Date.parse(p.time))).map(p=>({time:p.time,observed:p.valueM3s,modeled:model.get(Date.parse(p.time))}));
  if(pairs.length<3)throw new Error('Need at least three exact-time approved unqualified pairs; no time shifting/interpolation');
  if(pairs.some(p=>!Number.isFinite(p.observed)||p.observed<0))throw new Error('Invalid observed flow');
  const mean=pairs.reduce((s,p)=>s+p.observed,0)/pairs.length;
  const sse=pairs.reduce((s,p)=>s+(p.modeled-p.observed)**2,0),sst=pairs.reduce((s,p)=>s+(p.observed-mean)**2,0);
  const op=pairs.reduce((a,b)=>a.observed>=b.observed?a:b),mp=pairs.reduce((a,b)=>a.modeled>=b.modeled?a:b);
  return {siteId:observed.siteId,pairCount:pairs.length,eligibleObservationCount:eligible.length,coverageFraction:pairs.length/eligible.length,
    biasM3s:pairs.reduce((s,p)=>s+p.modeled-p.observed,0)/pairs.length,rmseM3s:Math.sqrt(sse/pairs.length),nashSutcliffe:sst===0?null:1-sse/sst,
    pairedPeakErrorM3s:mp.modeled-op.observed,pairedPeakTimingErrorMinutes:(Date.parse(mp.time)-Date.parse(op.time))/60000,
    warning:'Metrics on exact matched samples only; sparse coverage can miss the event peak. A fitted event is not independent validation.'};
}
