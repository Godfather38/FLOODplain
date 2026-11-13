// Every crossing and terrain candidate on a route, with the live sources that reach it.
// Live only: no model run, recorded frame or coverage window is read here.
import {recentGauge} from './recent-readings.js?v=dev';
import {USGS_SITES,ROUTE_INFO,CLOSURE_RADIUS_M} from '../config.js?v=dev';

const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const when=t=>Number.isFinite(t)?new Date(t).toLocaleString('en-US',{timeZone:'America/Phoenix',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})+' MST':'Unknown time';
const metres=(a,b)=>Math.hypot((a.lat-b.lat)*110574,(a.lon-b.lon)*94000);
const FORECAST_MATCH_M=60;
const KINDS={officialRoadJunctions:'Official road junction',terrain_profile_minimum:'Terrain-profile candidate',terrain_minimum:'Terrain-profile candidate',mapped_crossing:'Mapped crossing',dip:'Dip',bridge:'Bridge',river:'River bridge',flat:'Flat dip',road:'Road'};

export function routeEntries(tracking,routeId,entryId=null){
 return tracking.entries.filter(e=>e.routeIds.includes(routeId)&&(!entryId||e.id===entryId||e.aliases?.includes(entryId)));
}

// Which live sources reach this spot. Having none means unknown, never dry.
export function liveCoverage(entry,{handPoints=[],roadHeights={},closures=[]}={}){
 const here={lon:entry.coordinates[0],lat:entry.coordinates[1]};
 const nearest=handPoints.filter(p=>p.status==='supported'&&metres(here,p)<=FORECAST_MATCH_M).sort((a,b)=>metres(here,a)-metres(here,b))[0];
 return {forecast:Boolean(nearest),roadHeight:Boolean(nearest&&Number.isFinite(roadHeights[nearest.id]?.roadAboveBedM)),
  county:closures.filter(c=>metres(here,c)<=CLOSURE_RADIUS_M),gauges:entry.gaugeAssociations?.length??0};
}
export function coverageText(c){
 const parts=[c.forecast?(c.roadHeight?'Live forecast compared with road height':'Live forecast, road height not resolved'):null].filter(Boolean);
 if(c.county.length)parts.push('county barricade nearby');
 if(c.gauges)parts.push(`${c.gauges} linked gauge${c.gauges>1?'s':''}`);
 return parts.join(' · ');
}

// The latest reading from the app's own live feeds, with its own clock.
export function liveGaugeReading(gaugeId,{flows={},alert=null}={}){
 if(gaugeId.startsWith('USGS-')){
  const f=flows[gaugeId.slice(5)];
  return f?.fresh?{cfs:f.cfs,time:f.time,risingFast:Boolean(f.risingFast)}:null;
 }
 if(gaugeId.startsWith('ALERT-')){
  const s=(alert?.stream??[]).find(x=>x.site===gaugeId.slice(6));
  const time=Date.parse(s?.last_rpt);
  return s&&!s.maintenance&&Number.isFinite(s.flow_cfs)&&Number.isFinite(time)?{cfs:s.flow_cfs,time,risingFast:false}:null;
 }
 return null;
}
function readingMarkup(reading){
 if(!reading)return '<p>No recent reading right now. That does not mean no water.</p>';
 return `<p><strong>${Math.round(reading.cfs).toLocaleString('en-US')} cfs</strong>${reading.risingFast?' and rising fast':''}</p><p>Observed ${esc(when(reading.time))}</p>`;
}

let trackingRequest,coverageRequest,roadRequest;
const once=(url)=>fetch(url).then(r=>{if(!r.ok)throw Error('HTTP '+r.status);return r.json()});
function loadTracking(){
 trackingRequest??=once(new URL('./data/route-tracking.json',import.meta.url)).catch(e=>{trackingRequest=null;throw e});
 coverageRequest??=once(new URL('../inundation/data/coverage.json',import.meta.url)).catch(()=>{coverageRequest=null;return {points:[]}});
 roadRequest??=once(new URL('../inundation/road-heights.json',import.meta.url)).catch(()=>{roadRequest=null;return {points:{}}});
 return Promise.all([trackingRequest,coverageRequest,roadRequest]);
}

function gaugeBox(gauge,association,live){
 const box=document.createElement('section');box.className='tracking-gauge';
 box.innerHTML=`<h4>${esc(gauge.name)}</h4><p>${esc(association.relationship.replaceAll('_',' '))} · ${esc(association.reachPath)}</p><div data-gauge-reading>${readingMarkup(liveGaugeReading(gauge.id,live))}</div><p>Flow at this gauge only. It is not water height at the road or an arrival time.</p><a href="${esc(gauge.source)}" target="_blank" rel="noopener noreferrer">Gauge source</a>`;
 const id=gauge.id.replace(/^USGS-/,'');
 if(gauge.id.startsWith('USGS-')&&Object.hasOwn(USGS_SITES,id)){
  const button=document.createElement('button');button.type='button';button.className='btn btn-text';button.textContent='Check recent gauge readings';box.append(button);
  button.onclick=async()=>{button.disabled=true;button.textContent='Checking gauge…';
   try{const result=await recentGauge(id),last=result.points?.filter(p=>Number.isFinite(p.cfs)).at(-1);if(box.isConnected)box.querySelector('[data-gauge-reading]').innerHTML=readingMarkup(last?{cfs:last.cfs,time:Date.parse(last.time),risingFast:false}:null)}
   catch(e){const p=document.createElement('p');p.setAttribute('role','status');p.textContent='Recent readings unavailable: '+e.message;box.append(p)}
   finally{button.disabled=false;button.textContent='Check recent gauge readings'}};
 }
 return box;
}

export async function mountRouteTracking(root,{routeId,entryId=null,flows,alert,closures}={}){
 root.innerHTML='<details class="route-tracking"><summary>Coverage &amp; gauge tracking</summary><div data-tracking-body><p role="status">Loading route locations.</p></div></details>';
 try{
  const [tracking,coverage,roads]=await loadTracking();if(!root.isConnected)return;
  const entries=routeEntries(tracking,routeId,entryId),body=root.querySelector('[data-tracking-body]');
  const rows=entries.map(e=>({entry:e,cover:liveCoverage(e,{handPoints:coverage.points,roadHeights:roads.points,closures:closures??[]})}));
  const count=fn=>rows.filter(r=>fn(r.cover)).length;
  root.querySelector('summary').textContent=`Coverage & gauge tracking · ${entries.length} location${entries.length===1?'':'s'}`;
  body.innerHTML=`<p><strong>${count(c=>c.forecast)} with a live forecast · ${count(c=>c.roadHeight)} compared with road height · ${count(c=>c.gauges)} with a linked gauge</strong></p><p>${esc(ROUTE_INFO[routeId]?.name??routeId)}. These are crossings, junctions and terrain candidates, not confirmed dips. A location with no live source is unknown, not dry.</p><label>Find a location<input type="search" data-tracking-search></label><label>Show<select data-tracking-filter><option value="">All</option><option value="forecast">Live forecast</option><option value="none">No live forecast</option><option value="gauge">Linked gauge</option></select></label><p role="status" data-tracking-count></p><div data-tracking-entries></div>`;
  const list=body.querySelector('[data-tracking-entries]');
  for(const {entry,cover} of rows){
   const detail=document.createElement('details');detail.className='tracking-entry';
   detail.dataset.search=[entry.name,entry.id].join(' ').toLowerCase();detail.dataset.forecast=cover.forecast;detail.dataset.gauge=cover.gauges>0;
   detail.innerHTML=`<summary>${esc(entry.name)}${coverageText(cover)?`<span>${esc(coverageText(cover))}</span>`:''}</summary><div class="tracking-entry-body"><p>Record type: ${esc(KINDS[entry.kind]??entry.kind.replaceAll('_',' '))}</p>${cover.county.map(c=>`<p>County: ${esc(c.location)}: ${esc(c.status||'no status')}${c.updated?` (updated ${esc(c.updated)})`:''}</p>`).join('')}<div data-entry-gauges></div></div>`;
   const gauges=detail.querySelector('[data-entry-gauges]');
   for(const association of entry.gaugeAssociations??[]){
    const gauge=tracking.gauges.find(g=>g.id===association.gaugeId);
    if(gauge)gauges.append(gaugeBox(gauge,association,{flows,alert}));
   }
   list.append(detail);
  }
  const filter=()=>{
   const query=body.querySelector('[data-tracking-search]').value.toLowerCase().trim(),show=body.querySelector('[data-tracking-filter]').value;let shown=0;
   for(const row of list.children){
    const match=!show||(show==='forecast'&&row.dataset.forecast==='true')||(show==='none'&&row.dataset.forecast==='false')||(show==='gauge'&&row.dataset.gauge==='true');
    row.hidden=!(row.dataset.search.includes(query)&&match);if(!row.hidden)shown++;
   }
   body.querySelector('[data-tracking-count]').textContent=`Showing ${shown} of ${rows.length}`;
  };
  body.querySelector('[data-tracking-search]').oninput=filter;body.querySelector('[data-tracking-filter]').onchange=filter;filter();
 }catch(e){if(root.isConnected)root.querySelector('[data-tracking-body]').textContent='Tracking unavailable: '+e.message+'. Missing locations are not evidence of a clear road.'}
}
