import {createForecastProvider,normalizeForecast,normalizeReachForecast} from './forecast-provider.js';
import {estimateFromFlow,estimateFromForecast,loadCoverage,loadJunction,missingCoverageResult} from './hand-inundation.js';
const $=id=>document.getElementById(id);
const CFS_TO_M3S=0.028316846592,COLORS={half:[31,111,209,210],flow:[95,168,234,200],double:[195,224,247,170],none:[138,143,148,110]};
let provider=createForecastProvider(),points=[],junction=null,forecast=null,result=null,version=0,overlay=null,marker=null,fitted=false,lastBounds=null;
const map=L.map('map').setView([32.35,-111.2],11);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:18,attribution:'© OpenStreetMap'}).addTo(map);

function place(lat,lon){
 marker?.remove();marker=L.circleMarker([lat,lon],{radius:6,color:'#111',fillColor:'#f6c76c',fillOpacity:1}).addTo(map).bindTooltip('Crossing location');
}

function paint(j,masks){
 const {cols,rows,catchmentNone,handNodata,lonMin,latMax,dLon,dLat}=j.grid,canvas=document.createElement('canvas');canvas.width=cols;canvas.height=rows;
 const ctx=canvas.getContext('2d'),img=ctx.createImageData(cols,rows);
 for(let i=0;i<cols*rows;i++){
  const c=j.catchment[i]===catchmentNone||j.handCm[i]===handNodata?COLORS.none:masks?.half[i]?COLORS.half:masks?.flow[i]?COLORS.flow:masks?.double?.[i]?COLORS.double:null;
  if(c)img.data.set(c,i*4);
 }
 ctx.putImageData(img,0,0);
 const bounds=[[latMax-rows*dLat,lonMin],[latMax,lonMin+cols*dLon]];
 overlay?.remove();overlay=L.imageOverlay(canvas.toDataURL(),bounds,{opacity:1}).addTo(map);
 place(j.crossing.lat,j.crossing.lon);
 return bounds;
}

// A map first drawn while its pane is hidden has no size, so measure again before fitting.
function fit(bounds){map.invalidateSize();map.fitBounds(bounds);fitted=map.getZoom()>0;lastBounds=bounds;}

function showLabels(l){$('label-extent').textContent=l.estimatedExtent??'No estimate.';$('label-age').textContent=l.sourceAge??'';$('label-missing').textContent=l.missingCoverage??'';$('label-uncertainty').textContent=l.uncertainty??'';}

function render(r,note=''){
 const {masks,...shown}=r;result=shown;
 $('status').textContent=`${note}${r.status}: ${r.reason}`;
 const s=r.sensitivity;
 $('summary').textContent=r.extent?`${r.source==='forecast'?'Forecast':'Chosen'} flow ${r.flowM3s.toFixed(1)} m³/s (${Math.round(r.flowM3s/CFS_TO_M3S)} cfs)${r.flowTime?' at '+r.flowTime:''}. Estimated area ${(r.extent.wetAreaM2/1e6).toFixed(2)} km² inside this square; ${(s.halfFlow.wetAreaM2/1e6).toFixed(2)} km² at half the flow${s.doubleFlow?`, ${(s.doubleFlow.wetAreaM2/1e6).toFixed(2)} km² at double`:', double is above the rating curve'}.`:'No extent is estimated for this result.';
 showLabels(r.labels??{});
 $('download').disabled=false;
 if(junction){const bounds=paint(junction,masks);if(!fitted)fit(bounds);}
}

function showForecast(f,note,now){
 const usable=['ok','stale'].includes(f.status)&&f.points.length;
 forecast=usable?{f,note,now}:null;
 $('time-row').hidden=!usable;
 if(usable){$('time').max=f.points.length-1;$('time').value=f.points.indexOf(f.peak);}
 render(estimateFromForecast(junction,f,{now}),note);
}

async function selectCrossing(id){
 const v=++version,row=points.find(p=>p.id===id);
 forecast=null;junction=null;$('time-row').hidden=true;overlay?.remove();overlay=null;
 $('controls').hidden=row.status!=='supported';
 if(row.status!=='supported'){
  place(row.lat,row.lon);map.invalidateSize();map.setView([row.lat,row.lon],15);lastBounds=null;fitted=true;
  render(missingCoverageResult(row));
  return;
 }
 const j=await loadJunction(row.file);if(v!==version)return;
 junction=j;fit(paint(j,null));
 $('status').textContent='Choose a forecast or a flow.';$('summary').textContent='';showLabels({estimatedExtent:'Nothing shown yet.'});
}

async function recorded(j){
 const read=async f=>{const r=await fetch('./data/'+f);if(!r.ok)throw new Error(`Fixture HTTP ${r.status}`);return r.json();};
 if(j.forecast.kind==='gauge'){
  const id=j.forecast.station.toLowerCase(),[m,s,record]=await Promise.all([read(`nwps-${id}-metadata.json`),read(`nwps-${id}-stageflow.json`),read('nwps-record.json')]),now=Date.parse(record.recordedAt);
  return {now,recordedAt:record.recordedAt,f:normalizeForecast(m,s,{now,retrievedAt:record.recordedAt,siteId:j.forecast.station})};
 }
 const saved=await read(`nwm/${j.forecast.reachId}.json`),now=Date.parse(saved.recordedAt);
 return {now,recordedAt:saved.recordedAt,f:normalizeReachForecast(saved.response,{now,retrievedAt:saved.recordedAt,reachId:j.forecast.reachId})};
}

$('enable').onchange=()=>{version++;provider=createForecastProvider({enabled:$('enable').checked});$('status').textContent=$('enable').checked?'Live requests on.':'Live requests off.';};
$('live').onclick=async()=>{
 const v=++version;$('status').textContent='Requesting NOAA forecast…';
 const f=await provider.predict(junction.forecast);if(v!==version)return;
 if(f.status==='disabled'){$('status').textContent='Live requests are off. Tick the box first, or use the recorded forecast.';return;}
 showForecast(f,'',Date.now());
};
$('recorded').onclick=async()=>{
 const v=++version;
 try{const {f,now,recordedAt}=await recorded(junction);if(v===version)showForecast(f,`RECORDED FORECAST from ${recordedAt}. `,now);}
 catch(e){if(v===version)$('status').textContent=`unavailable: ${e.message}`;}
};
$('time').oninput=()=>{const {f,note,now}=forecast;render(estimateFromForecast(junction,f,{now,time:f.points[+$('time').value].time}),note);};
$('peak').onclick=()=>{const {f,note,now}=forecast;$('time').value=f.points.indexOf(f.peak);render(estimateFromForecast(junction,f,{now}),note);};
$('try-flow').onclick=()=>{const cfs=$('flow').valueAsNumber;version++;forecast=null;$('time-row').hidden=true;render(estimateFromFlow(junction,cfs*CFS_TO_M3S,{now:Date.now()}),'CHOSEN FLOW, NOT A FORECAST. ');};
$('download').onclick=()=>{const u=URL.createObjectURL(new Blob([JSON.stringify(result,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=u;a.download='floodplain-hand-estimate.json';a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);};
$('junction').onchange=()=>selectCrossing($('junction').value);

new ResizeObserver(()=>{if(lastBounds&&!fitted)fit(lastBounds);else map.invalidateSize();}).observe($('map'));
points=(await loadCoverage()).points;
const options=rows=>rows.map(p=>`<option value="${p.id}">${p.name}</option>`).join('');
$('junction').innerHTML=`<optgroup label="Estimate available">${options(points.filter(p=>p.status==='supported'))}</optgroup><optgroup label="Missing coverage">${options(points.filter(p=>p.status!=='supported'))}</optgroup>`;
await selectCrossing($('junction').value);
