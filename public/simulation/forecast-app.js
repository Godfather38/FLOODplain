import {createIntegratedEngine,routeHandPayload} from './integrated-engine.js';
import {normalizeEnsemble} from './ensemble.js';
import {createForecastEngine,normalizeForecast} from './forecast-engine.js';
const $=id=>document.getElementById(id);
let engine=createIntegratedEngine(),result,requestVersion=0;
const selectedSite=()=>$("station").value||"SCTA3";
function render(r,replay=false){
 $('integrated-context').textContent='No connected context loaded for this view.';
 result={...r,displayMode:replay?'recorded_replay':'live_request',replayClock:replay?r.retrievedAt:null};$('forecast-status').textContent=`${replay?'RECORDED REPLAY — ':''}${r.geography?.name??r.siteId??''} ${r.status}: ${r.reason??''}`;
 $('forecast-chart').innerHTML='';$('forecast-summary').textContent='';$('forecast-context').textContent='';$('forecast-download').disabled=false;
 if(!r.points.length)return;
 $('forecast-summary').textContent=`Forecast peak ${r.peak.flowM3s.toFixed(2)} m³/s at ${r.peak.time}. Issued ${r.issuedAt}; retrieved ${r.retrievedAt}. Issue age ${r.issueAgeHours.toFixed(1)} hours. Accuracy ± unavailable.`;
 const start=Date.parse(r.points[0].time),duration=Math.max(1,Date.parse(r.points.at(-1).time)-start),max=Math.max(.001,...r.points.map(p=>p.flowM3s));
 const path=r.points.map((p,i)=>`${i?'L':'M'}${40+(Date.parse(p.time)-start)/duration*540},${220-p.flowM3s/max*190}`).join(' ');
 $('forecast-chart').innerHTML=`<path d="M40 20V220H580" stroke="#879ea9" fill="none"/><path d="${path}" stroke="#72dbc6" stroke-width="3" fill="none"/><text x="40" y="16" fill="white">${max.toFixed(2)} m³/s</text><text x="40" y="248" fill="white">${r.points[0].time.slice(0,16)} UTC</text><text x="360" y="248" fill="white">${r.points.at(-1).time.slice(0,16)} UTC</text>`;
 $('forecast-context').textContent=JSON.stringify({coverage:r.coverage,providerContext:r.providerContext,uncertainty:r.uncertainty,limitations:r.limitations},null,2);
}
$('enable').onchange=()=>{requestVersion++;engine=createIntegratedEngine({enabled:$('enable').checked});render({status:'disabled',reason:'Refresh to request forecast',points:[]});};
$('refresh').onclick=async()=>{const version=++requestVersion,siteId=selectedSite();$('forecast-status').textContent='Requesting NOAA forecast…';const bundle=await engine.evaluate({force:true,siteId});if(version===requestVersion){render(bundle.official);renderIntegrated(bundle);}};
$('recorded').onclick=async()=>{const version=++requestVersion;$('forecast-status').textContent='Loading recorded NOAA response; evaluated at its historical retrieval time.';try{const [m,s,record]=await Promise.all([`nwps-${selectedSite().toLowerCase()}-metadata.json`,`nwps-${selectedSite().toLowerCase()}-stageflow.json`,selectedSite()==='SCTA3'?'nwps-record.json':'nwps-regional-record.json'].map(async f=>{const r=await fetch('./data/'+f);if(!r.ok)throw new Error(`Fixture HTTP ${r.status}`);return r.json();}));if(version===requestVersion)render(normalizeForecast(m,s,{now:Date.parse(record.recordedAt),retrievedAt:record.recordedAt}),true);}catch(e){if(version===requestVersion)render({status:'unavailable',reason:e.message,points:[]});}};
$('forecast-download').onclick=()=>{const u=URL.createObjectURL(new Blob([JSON.stringify(result,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=u;a.download='floodplain-forecast.json';a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);};
function renderEnsemble(e,replay=false){
 $('ensemble-status').textContent=`${replay?'RECORDED REPLAY — ':''}${e.provider??'HEFS'}: ${e.status}. ${e.reason??''}`;$('ensemble-chart').innerHTML='';$('ensemble-context').textContent='';
 if(!e.points.length)return;
 const start=Date.parse(e.points[0].time),duration=Math.max(1,Date.parse(e.points.at(-1).time)-start),max=Math.max(.001,...e.points.map(p=>p.highM3s));
 const x=p=>40+(Date.parse(p.time)-start)/duration*540,y=v=>220-v/max*190;
 $('ensemble-chart').innerHTML=`<path d="M40 20V220H580" stroke="#879ea9" fill="none"/>`+e.points.map(p=>`<path d="M${x(p)},${y(p.lowM3s)}V${y(p.highM3s)}" stroke="#82b6ff" opacity=".3"/><circle cx="${x(p)}" cy="${y(p.medianM3s)}" r="1.5" fill="#f6c76c"/>`).join('')+`<text x="40" y="16" fill="white">${max.toFixed(2)} m³/s</text><text x="40" y="248" fill="white">${e.points[0].time.slice(0,16)} UTC</text><text x="360" y="248" fill="white">${e.points.at(-1).time.slice(0,16)} UTC</text>`;
 $('ensemble-context').textContent=`Issued ${e.issuedAt}; retrieved ${e.retrievedAt}. Blue: 90% exceedance (low) to 10% exceedance (high); gold: median. ${e.missingRows} missing rows omitted. ${e.interpretation}`;
 if(result)result={...result,ensembleContext:e};
}
$('ensemble-live').onclick=async()=>{const siteId=selectedSite(),version=requestVersion;$('ensemble-status').textContent='Requesting NOAA HEFS ensemble spread.';const e=await engine.ensemble({siteId});if(siteId===selectedSite()&&version===requestVersion)renderEnsemble(e);};
$('ensemble-recorded').onclick=async()=>{const version=requestVersion;$('ensemble-status').textContent='Loading recorded HEFS spread.';if(selectedSite()!=='SCTA3'){renderEnsemble({status:'unavailable',reason:'Recorded HEFS fixture is Trico only; enable live requests for this station',points:[]});return;}try{const [raw,record]=await Promise.all(['hefs-scta3-quantiles.json','hefs-record.json'].map(async f=>{const r=await fetch('./data/'+f);if(!r.ok)throw Error(`HEFS fixture HTTP ${r.status}`);return r.json();}));if(version===requestVersion)renderEnsemble(normalizeEnsemble(raw,{now:Date.parse(record.recordedAt),retrievedAt:record.recordedAt}),true);}catch(e){if(version===requestVersion)renderEnsemble({status:'unavailable',reason:e.message,points:[]});}};
$("station").onchange=()=>{requestVersion++;render({status:"disabled",reason:"Select Refresh or recorded replay for this gauge",points:[],siteId:selectedSite()});renderEnsemble({status:"unavailable",reason:"No ensemble loaded for selected gauge",points:[]});};

function renderIntegrated(bundle,replay=false){
 result={...result,integrated:bundle};
 $('integrated-context').replaceChildren();
 const line=text=>{const p=document.createElement('p');p.textContent=text;$('integrated-context').append(p)};
 line(`${replay?'RECORDED SNAPSHOT — ':''}Connected sources: RFC ${bundle.official.status}; NWM ${bundle.nwm.status}; HEFS ${bundle.ensemble.status}; rainfall ${bundle.rainfall.status}; HAND ${bundle.handStatus??'disabled'}.`);
 for(const reach of bundle.nwm.reaches??[])line(`NWM ${reach.relationship} reach ${reach.reachId}: ${reach.status}. ${reach.peak?`Peak ${reach.peak.flowM3s.toFixed(2)} m³/s at ${reach.peak.time}; model reference ${reach.issuedAt}.`:reach.reason??''}`);
 line(bundle.nwm.lateralInflow?.reason??'NWM is model guidance, not official RFC forecasting.');
 const rain=bundle.rainfall;line(`NWS rainfall: ${rain.status}. ${rain.limitation??rain.reason??''}`);
 if(rain.intervals?.length){const next=rain.intervals.find(p=>!p.partialAtRetrieval);if(next)line(`Next full forecast interval ${next.start} to ${next.end}: ${next.accumulationMm===null?'missing':next.accumulationMm+' mm'}. Source ${rain.sourceUrl}; issued ${rain.issuedAt}.`)}
 for(const h of bundle.hand){line(`${h.name}: ${h.status}; ${h.extent?`${h.extent.wetCells} estimated wet cells at ${h.flowTime}.`:h.reason}`);if(h.labels)line(h.labels.missingCoverage+' '+h.labels.uncertainty)}
 renderEnsemble(bundle.ensemble);
 if(bundle.status==='disabled')return;
 if(replay){line('Recorded source snapshot; not passed to current route decisions.');return;}
 try{sessionStorage.setItem('floodplain-hand-evidence',JSON.stringify(routeHandPayload(bundle)));line('Current HAND results are available automatically in Combined route decision.')}catch(e){line('Could not store route handoff: '+e.message)}
}

$('connected-recorded').onclick=async()=>{const version=++requestVersion;try{const response=await fetch('data/connected-stack-record.json');if(!response.ok)throw Error(`Snapshot HTTP ${response.status}`);const bundle=await response.json();if(version!==requestVersion)return;render(bundle.official,true);renderIntegrated(bundle,true);}catch(e){$('forecast-status').textContent='Connected snapshot unavailable: '+e.message}};
