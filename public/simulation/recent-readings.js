import {USGS_SITES} from '../config.js';
import {getJson} from '../network.js';
const cache=new Map(),pending=new Map();
export async function recentGauge(site,{now=Date.now(),fetchJson=getJson}={}){
 if(!Object.hasOwn(USGS_SITES,site))throw Error('Unknown gauge');
 const key='recent-usgs:'+site;let saved=cache.get(site);try{saved??=JSON.parse(localStorage.getItem(key))}catch{}
 if(saved&&now>=saved.retrievedAt&&now-saved.retrievedAt<15*60000)return saved;
 if(pending.has(site))return pending.get(site);
 const task=(async()=>{const start=new Date(now-86400000).toISOString(),end=new Date(now).toISOString();
  const url=new URL('https://api.waterdata.usgs.gov/ogcapi/v1/collections/continuous/items');url.search=new URLSearchParams({f:'json',monitoring_location_id:'USGS-'+site,parameter_code:'00060',datetime:start+'/'+end,limit:'2000'});
  try{let raw=await fetchJson(url.href),next=raw.links?.find(l=>l.rel==='next')?.href,pages=1;while(next&&pages<4){const target=new URL(next,url);if(target.origin!==url.origin||target.pathname!==url.pathname)throw Error('Unexpected pagination destination');const page=await fetchJson(target.href);raw.features.push(...(page.features??[]));next=page.links?.find(l=>l.rel==='next')?.href;pages++}if(next)throw Error('Response exceeds bounded recent-history request');
   const points=(raw.features??[]).map(f=>f.properties).filter(p=>p.monitoring_location_id==='USGS-'+site&&p.parameter_code==='00060'&&p.unit_of_measure==='ft^3/s'&&p.value!==null&&p.value!==''&&Number.isFinite(Number(p.value))&&Number.isFinite(Date.parse(p.time))).map(p=>({time:p.time,cfs:Number(p.value),quality:[p.approval_status,p.qualifier].filter(Boolean).join(' · ')})).filter(p=>Date.parse(p.time)>=now-86400000&&Date.parse(p.time)<=now).sort((a,b)=>Date.parse(a.time)-Date.parse(b.time));
   const result={points,retrievedAt:now,source:url.href};cache.set(site,result);try{localStorage.setItem(key,JSON.stringify(result))}catch{}return result;
  }catch(e){if(saved)return {...saved,refreshError:e.message};throw e}
 })().finally(()=>pending.delete(site));pending.set(site,task);return task;
}
export function mountRecentReadings(root){
 root.innerHTML='<p>Observed river flow, separate from the simulation.</p><label>Gauge<select data-gauge></select></label><label>Period<select data-period><option value="24">Last 24 hours</option><option value="today">Today (Arizona)</option></select></label><button data-load>Show readings</button><p data-status role="status">Choose a gauge to load its observations.</p><div data-readings></div>';
 const q=s=>root.querySelector(s);for(const [id,site] of Object.entries(USGS_SITES)){const o=document.createElement('option');o.value=id;o.textContent=site.name;q('[data-gauge]').append(o)}
 let result;function draw(){if(!result)return;const today=new Date().toLocaleDateString('en-CA',{timeZone:'America/Phoenix'}),points=result.points.filter(p=>q('[data-period]').value!=='today'||new Date(p.time).toLocaleDateString('en-CA',{timeZone:'America/Phoenix'})===today);q('[data-readings]').replaceChildren();q('[data-status]').textContent=result.refreshError?'Refresh failed; retained readings from '+new Date(result.retrievedAt).toLocaleString()+'.':points.length+' observations. Observation times below; gaps are not filled.';if(!points.length)return;
  const table=document.createElement('table');table.innerHTML='<thead><tr><th>Arizona time</th><th>Flow (cfs)</th><th>Quality</th></tr></thead>';const body=document.createElement('tbody');for(const p of [...points].reverse()){const row=document.createElement('tr');for(const text of [new Date(p.time).toLocaleString('en-US',{timeZone:'America/Phoenix',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})+' MST',p.cfs.toLocaleString(),p.quality||'Not supplied']){const td=document.createElement('td');td.textContent=text;row.append(td)}body.append(row)}table.append(body);q('[data-readings]').append(table)}
 q('[data-load]').onclick=async()=>{q('[data-load]').disabled=true;q('[data-status]').textContent='Loading USGS observations…';try{result=await recentGauge(q('[data-gauge]').value);draw()}catch(e){q('[data-status]').textContent='Readings unavailable: '+e.message}finally{q('[data-load]').disabled=false}};q('[data-period]').onchange=draw;q('[data-gauge]').onchange=()=>{result=null;q('[data-readings]').replaceChildren();q('[data-status]').textContent='Select Show readings for this gauge.'};
}
