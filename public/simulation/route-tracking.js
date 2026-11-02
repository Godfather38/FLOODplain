import {loadAllRouteData} from './all-route-data.js';
import {mountAllRoutePoint,ledgerCoverage,ledgerRows} from './all-route-point-view.js';
import {trackingState,adaptRecentGauge,gaugeSummary} from './scene-data-contract.js';
import {recentGauge} from './recent-readings.js';
import {USGS_SITES,ROUTE_INFO} from '../config.js';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const when=t=>t&&Number.isFinite(Date.parse(t))?new Date(t).toLocaleString('en-US',{timeZone:'America/Phoenix',month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'})+' MST':'Unknown time';
let inventoryRequest,ledgerRequest;
export function routeInventory(inventory,routeId,entryId=null){
 if(inventory.schema!=='floodplain-tracking-v1')throw Error('Unsupported tracking inventory');
 const route=inventory.routes.find(r=>r.id===routeId);
 const ids=new Set(route?.entryIds??[]);
 return {route,entries:inventory.entries.filter(e=>ids.has(e.id)&&(!entryId||e.id===entryId))};
}
export function coverageText(entry,now){
 const status=trackingState(entry,{now});
 if(entry.model?.resultStatus==='awaiting_verified_output')return 'Awaiting verified extension output';
 if(status.hydraulicStatus==='outside_coverage')return 'Outside this refined run’s coverage';
 if(entry.model?.resultStatus==='model_output_available')return status.state==='stale'?'Recorded output available — frozen run expired':'Recorded output available — frozen replay';
 if(status.hydraulicStatus==='modeled')return status.state==='stale'?'Inside refined coverage · frozen run expired':'Inside refined coverage · frozen replay';
 return 'Not yet assessed';
}
function gaugeMarkup(gauge,record=null){
 const now=new Date().toISOString(),adapted=record?adaptRecentGauge(record,now):null;
 const points=adapted?.points??gauge.points??[],s=adapted?.summary??gaugeSummary(points,now);
 const last=points.filter(p=>p.time===s.observedAt).at(-1);
 const quality=last?.quality||[last?.approval,last?.qualifier].filter(Boolean).join(' · ')||'Quality not supplied';
 const age=s.ageMs===null?'Age unknown':s.ageMs<3600000?Math.floor(s.ageMs/60000)+' min old':(s.ageMs/3600000).toFixed(1)+' hours old';
 return `<p><strong>${s.status==='stale'?'Stale observation':s.status==='missing'?'No usable observation':'Recent observation'}</strong> · ${esc(age)}</p><p>${s.valueM3s===null?'Flow unavailable':(s.valueM3s/0.028316846592).toLocaleString('en-US',{maximumFractionDigits:2})+' cfs'} · Trend: ${esc(s.trend)}${s.trend==='unknown'?' (two distinct observation times needed)':''}</p><p>Observed ${esc(when(s.observedAt))}${s.trendWindow?'<br>Trend window: '+esc(s.trendWindow.map(when).join(' to ')):''}</p><p>${esc(quality)}</p><p>${record?'Existing recent-readings feed/cache':'Recorded inventory snapshot — not refreshed'}${record?.refreshError?'; refresh failed: '+esc(record.refreshError):''}</p>`;
}
export async function mountRouteTracking(root,{routeId,entryId=null}={}){
 root.innerHTML='<details class="route-tracking"><summary>Coverage & gauge tracking</summary><div data-tracking-body><p role="status">Loading route inventory.</p></div></details>';
 try{
  inventoryRequest??=fetch(new URL('./data/scene-contract/inventory.json',import.meta.url)).then(r=>{if(!r.ok)throw Error('Inventory HTTP '+r.status);return r.json()}).catch(e=>{inventoryRequest=null;throw e});
  ledgerRequest??=loadAllRouteData({now:new Date().toISOString()}).catch(e=>{ledgerRequest=null;throw e});
  const [inventory,data]=await Promise.all([inventoryRequest,ledgerRequest]);if(!root.isConnected)return;
  const entries=ledgerRows(data,routeId,entryId);
  const counts=status=>entries.filter(e=>e.coverageStatus===status).length;
  const body=root.querySelector('[data-tracking-body]');
  root.querySelector('summary').textContent='Coverage & gauge tracking · '+entries.length+' evidence records';
  body.innerHTML='<p><strong>'+counts('full_window')+' full-window · '+counts('partial_window')+' partial-window · '+counts('uncovered')+' uncovered</strong></p><p>Across all routes: 234 full-window, 165 partial-window and 59 uncovered records. Routes share records; these are crossings, junctions and terrain candidates, not independently confirmed dips. Coverage does not change road warnings.</p><label>Find a location<input type="search" data-tracking-search placeholder="Name, record ID or coordinates"></label><label>Show records<select data-tracking-filter><option value="">All coverage</option><option value="full_window">Full recorded window</option><option value="partial_window">Partial recorded window</option><option value="uncovered">Uncovered</option><option value="overlap">Overlapping outputs</option></select></label><p data-match-count role="status"></p><div data-tracking-entries></div>';
  for(const entry of entries){
   const detail=document.createElement('details');detail.className='tracking-entry';detail.dataset.trackingId=entry.id;
   detail.innerHTML=`<summary>${esc(entry.name)}<span>${esc(ledgerCoverage(entry))}${entry.overlap?' · Separate overlapping outputs':''}</span></summary><div class="tracking-entry-body"><p>Record type: ${esc(({officialRoadJunctions:'Official road junction',terrain_profile_minimum:'Terrain-profile candidate',terrain_minimum:'Terrain-profile candidate',mapped_crossing:'Mapped crossing'}[entry.kind]??entry.kind.replaceAll('_',' ')))}. Location: ${entry.coordinates.map(v=>v.toFixed(5)).reverse().join(', ')}.</p><p>Shared route memberships: ${entry.routeIds.map(id=>esc(ROUTE_INFO[id]?.name??id)).join(', ')}. Record: ${esc(entry.id)}.</p><div data-point-results></div><div data-entry-gauges></div></div>`;
   body.querySelector('[data-tracking-entries]').append(detail);
   let loaded=false;detail.addEventListener('toggle',()=>{if(detail.open&&!loaded){loaded=true;mountAllRoutePoint(detail.querySelector('[data-point-results]'),entry,data)}});
   detail.dataset.coverage=entry.coverageStatus;detail.dataset.overlap=Boolean(entry.overlap);detail.dataset.search=[entry.name,entry.id,...entry.coordinates].join(' ').toLowerCase();
   const gauges=detail.querySelector('[data-entry-gauges]');
   if(!entry.gaugeAssociations?.length)gauges.innerHTML='<p>No hydrologically linked gauge supplied for this location. Gauge support is unknown.</p>';
   for(const association of entry.gaugeAssociations??[]){
    const gauge=inventory.gauges.find(g=>g.id===association.gaugeId);if(!gauge)continue;
    const box=document.createElement('section');box.className='tracking-gauge';const id=gauge.id.replace(/^USGS-/,'');
    let cached=null;try{cached=JSON.parse(localStorage.getItem('recent-usgs:'+id))}catch{}
    box.innerHTML=`<h4>${esc(gauge.name)}</h4><p>${esc(association.relationship.replaceAll('_',' '))} · ${esc(association.reachPath)}</p><div data-gauge-reading>${gaugeMarkup(gauge,cached)}</div><p>Gauge discharge is context only for this frozen run. It is not road-water height or an arrival-time estimate.</p><a href="${esc(gauge.source)}" target="_blank" rel="noopener noreferrer">Gauge source</a>`;
    if(gauge.id.startsWith('USGS-')&&Object.hasOwn(USGS_SITES,id)){
     const button=document.createElement('button');button.type='button';button.className='btn btn-text';button.textContent='Check recent gauge readings';box.append(button);
     button.onclick=async()=>{button.disabled=true;button.textContent='Checking gauge…';try{const result=await recentGauge(id);if(box.isConnected)box.querySelector('[data-gauge-reading]').innerHTML=gaugeMarkup(gauge,result)}catch(e){const p=document.createElement('p');p.setAttribute('role','status');p.textContent='Recent readings unavailable: '+e.message+'. Recorded evidence above is retained.';box.append(p)}finally{button.disabled=false;button.textContent='Check recent gauge readings'}};
    }else{const p=document.createElement('p');p.textContent='Recent-history adapter unavailable for this gauge; open its source for current readings.';box.append(p)}
    gauges.append(box);
   }
  }
  const filter=()=>{const query=body.querySelector('[data-tracking-search]').value.toLowerCase().trim(),coverage=body.querySelector('[data-tracking-filter]').value;let count=0;for(const row of body.querySelectorAll('.tracking-entry')){row.hidden=!(row.dataset.search.includes(query)&&(!coverage||(coverage==='overlap'?row.dataset.overlap==='true':row.dataset.coverage===coverage)));if(!row.hidden)count++;}body.querySelector('[data-match-count]').textContent=count+' matching records'+(entryId?' · Open the parent route to see its full ledger.':'');};body.querySelector('[data-tracking-search]').oninput=filter;body.querySelector('[data-tracking-filter]').onchange=filter;filter();
 }catch(e){if(root.isConnected)root.querySelector('[data-tracking-body]').textContent='Tracking unavailable: '+e.message+'. Missing inventory is not evidence of a clear road.'}
}
