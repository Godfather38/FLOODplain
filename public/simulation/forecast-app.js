import {createForecastEngine,normalizeForecast} from './forecast-engine.js';
const $=id=>document.getElementById(id);
let engine=createForecastEngine(),result;
function render(r,replay=false){
 result=r;$('forecast-status').textContent=`${replay?'RECORDED REPLAY — ':''}${r.status}: ${r.reason}`;
 $('forecast-chart').innerHTML='';$('forecast-summary').textContent='';$('forecast-context').textContent='';$('forecast-download').disabled=false;
 if(!r.points.length)return;
 $('forecast-summary').textContent=`Forecast peak ${r.peak.flowM3s.toFixed(2)} m³/s at ${r.peak.time}. Issued ${r.issuedAt}; retrieved ${r.retrievedAt}. Issue age ${r.issueAgeHours.toFixed(1)} hours. Accuracy ± unavailable.`;
 const start=Date.parse(r.points[0].time),duration=Math.max(1,Date.parse(r.points.at(-1).time)-start),max=Math.max(.001,...r.points.map(p=>p.flowM3s));
 const path=r.points.map((p,i)=>`${i?'L':'M'}${40+(Date.parse(p.time)-start)/duration*540},${220-p.flowM3s/max*190}`).join(' ');
 $('forecast-chart').innerHTML=`<path d="M40 20V220H580" stroke="#879ea9" fill="none"/><path d="${path}" stroke="#72dbc6" stroke-width="3" fill="none"/><text x="40" y="16" fill="white">${max.toFixed(2)} m³/s</text><text x="40" y="248" fill="white">${r.points[0].time.slice(0,16)} UTC</text><text x="360" y="248" fill="white">${r.points.at(-1).time.slice(0,16)} UTC</text>`;
 $('forecast-context').textContent=JSON.stringify({coverage:r.coverage,providerContext:r.providerContext,uncertainty:r.uncertainty,limitations:r.limitations},null,2);
}
$('enable').onchange=()=>{engine=createForecastEngine({enabled:$('enable').checked});render({status:'disabled',reason:'Refresh to request forecast',points:[]});};
$('refresh').onclick=async()=>{ $('forecast-status').textContent='Requesting NOAA forecast…';render(await engine.predict({force:true}));};
$('recorded').onclick=async()=>{try{const [m,s,record]=await Promise.all(['nwps-scta3-metadata.json','nwps-scta3-stageflow.json','nwps-record.json'].map(async f=>{const r=await fetch('./data/'+f);if(!r.ok)throw new Error(`Fixture HTTP ${r.status}`);return r.json();}));render(normalizeForecast(m,s,{now:Date.parse(record.recordedAt),retrievedAt:record.recordedAt}),true);}catch(e){render({status:'unavailable',reason:e.message,points:[]});}};
$('forecast-download').onclick=()=>{const u=URL.createObjectURL(new Blob([JSON.stringify(result,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=u;a.download='floodplain-forecast.json';a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);};
