import { AREAS } from '../public/config.js';
import { evaluate, alertSnapshot, sourceUrls } from '../public/engine.js';
import { normalizeRoadEvents, parseCountyClosures } from '../public/logic.js';
import { expectedInputHealth_ } from './generated/input-health.js';
import routes from './generated/routes.json' with { type: 'json' };
import { healthy, fixtureNow } from './fixtures/healthy.js';
import { createAZ511Adapter, az511RoadEvents } from './az511.js';

const forecastPath = /^(gauges\/[A-Z0-9]{3,8}(\/stageflow)?|reaches\/\d{1,14}\/streamflow)$/;
const unavailable = {error: 'unavailable'};
// Only fixed public endpoints. No user URL, credentials, Sheets or notification endpoints.
export async function loadPublic(fetcher = fetch) {
  const urls = sourceUrls();
  const jobs = [...Object.entries(urls.usgs).map(([id,url]) => ['usgs:'+id,url]),
    ...['closures','rain','stream','nws'].map(id => [id,urls[id]]),
    ['tvClosures','https://transview.org/Map.aspx/GetData',{theDataType:'RoadClosure'}],
    ['tvWork','https://transview.org/Map.aspx/GetConstructionEvents',{type:''}]];
  const raw = {usgs:{}};
  await Promise.all(jobs.map(async ([id,url,body]) => {
    let value = null;
    try {
      const response = await fetcher(url, {signal:AbortSignal.timeout(10000), redirect:'error',
        headers:{'User-Agent':'FLOODplain-shadow/1.0', ...(body ? {'Content-Type':'application/json; charset=utf-8', Referer:'https://transview.org/Map.aspx'} : {})},
        ...(body ? {method:'POST',body:JSON.stringify(body)} : {})});
      if (response.ok) value = await response.json();
    } catch { /* failed sources remain null, never an empty successful list */ }
    if (id.startsWith('usgs:')) raw.usgs[id.slice(5)] = value; else raw[id] = value;
  }));
  return raw;
}

export function validAssessments(verdicts) {
  return AREAS.every(({id}) => verdicts[id]?.rated?.length && verdicts[id].rated.every(r => Number.isFinite(r.score) && r.score>=1 && r.score<=5));
}
export function compute(raw, now) {
  const inputs = expectedInputHealth_(raw, now);
  const alert = raw.rain && raw.stream ? alertSnapshot(raw.rain.data, raw.stream.data, now) : null;
  const events = raw.tvClosures || raw.tvWork ? normalizeRoadEvents(raw.tvClosures?.d, raw.tvWork?.d, [-111.45,32.1,-110.9,32.6]) : null;
  const verdicts = Object.fromEntries(AREAS.map(({id}) => [id, evaluate({now,usgs:raw.usgs,closures:raw.closures,alert,nws:raw.nws,roadEvents:events,routes},id)]));
  if (!validAssessments(verdicts)) throw Error('Incomplete all-area assessment');
  const sources = Object.fromEntries(Object.entries({usgs:Object.values(raw.usgs).some(Boolean),county:parseCountyClosures(raw.closures).complete,rain:!!raw.rain,stream:!!raw.stream,weather:!!raw.nws,transview:!!events}).map(([id,ok]) => [id,ok?{lastOk:now}:{downSince:now}]));
  return {inputs, verdicts, sources, feeds:{
    usgs:{fetched_at:new Date(now).toISOString(),series:Object.fromEntries(Object.entries(raw.usgs).map(([id,v]) => [id,v?{features:(v.features||[]).map(f=>({properties:f.properties}))}:null]))},
    alert, roadEvents:events?{events,fetchedAt:now,stale:false}:null, drive:[],
  }};
}

export function createWorker({fetcher=fetch, fixture=healthy, clock=()=>Date.now()}={}) {
  const loadAZ511 = createAZ511Adapter({fetcher, clock, diagnostics:true});
  return {
    async fetch(request, env={}) {
      const url = new URL(request.url), q=url.searchParams;
      const reply = (data,status=200) => Response.json(data,{status,headers:{'Cache-Control':'no-store','X-FLOODplain-Mode':env.PUBLIC_LIVE==='true'?'public-read-only':'synthetic-fixture'}});
      if (request.method!=='GET' || q.has('hit') || q.has('new') || q.has('fail') || q.has('action')) return reply({ok:false,error:'Mutations disabled in shadow preview'},405);
      const feed=q.get('feed');
      if (!feed) return reply({ok:true,service:'wash-watch-alerts-shadow',sender:'disabled',freePerDay:0,preview:true});
      // Isolated diagnostic feed; no change to existing feeds, ratings or closure matching.
      if (feed==='az511') {
        const result=await loadAZ511(env);
        return reply({...result,roadEvents:az511RoadEvents(result)});
      }
      if (feed==='forecasts') {
        const responses={};
        const paths=[...new Set((q.get('paths')||'').split(',').filter(p=>forecastPath.test(p)))].slice(0,40);
        if(env.PUBLIC_LIVE==='true') await Promise.all(paths.map(async p=>{try {const r=await fetcher(`https://api.water.noaa.gov/nwps/v1/${p}${p.startsWith('reaches/')?'?series=short_range':''}`,{signal:AbortSignal.timeout(10000),redirect:'error'});if(r.ok) responses[p]=await r.json();}catch{}}));
        return reply({responses});
      }
      if (!['all','usgs','alert','roadevents','health','preview'].includes(feed)) return reply({error:'Unknown feed'},404);
      try {
        const live=env.PUBLIC_LIVE==='true';
        const result=compute(live?await loadPublic(fetcher):fixture(),live?clock():fixtureNow);
        if(feed==='preview') return reply({preview:true,privateState:'mock-empty', ...result});
        if(feed==='health') return reply({ok:true,sources:result.sources});
        if(feed==='all') return reply(result.feeds);
        return reply(result.feeds[feed==='roadevents'?'roadEvents':feed]||unavailable);
      } catch { return reply({error:'Assessment unavailable',preview:true},503); }
    },
    scheduled() { return {disabled:true}; },
  };
}
export default createWorker();
