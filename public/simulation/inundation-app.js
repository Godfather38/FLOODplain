import {createForecastEngine,normalizeForecast} from './forecast-engine.js';
import {decodeJunction,estimateFromFlow,estimateFromForecast,loadJunction,loadJunctionIndex} from './hand-inundation.js';
const $=id=>document.getElementById(id);
const CFS_TO_M3S=0.028316846592,COLORS={half:[31,111,209,210],flow:[95,168,234,200],double:[195,224,247,170],none:[138,143,148,110]};
let engine=createForecastEngine(),junction=null,forecast=null,result=null,version=0,overlay=null,marker=null,listing={},fitted=false,lastBounds=null;
const map=L.map('map').setView([32.45,-111.28],14);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:18,attribution:'© OpenStreetMap'}).addTo(map);

function paint(j,masks){
 const {cols,rows,catchmentNone}=j.grid,canvas=document.createElement('canvas');canvas.width=cols;canvas.height=rows;
 const ctx=canvas.getContext('2d'),img=ctx.createImageData(cols,rows);
 for(let i=0;i<cols*rows;i++){
  const c=j.catchment[i]===catchmentNone||j.handCm[i]===j.grid.handNodata?COLORS.none:masks?.half[i]?COLORS.half:masks?.flow[i]?COLORS.flow:masks?.double?.[i]?COLORS.double:null;
  if(c)img.data.set(c,i*4);
 }
 ctx.putImageData(img,0,0);
 const {lonMin,latMax,dLon,dLat}=j.grid,bounds=[[latMax-rows*dLat,lonMin],[latMax,lonMin+cols*dLon]];
 overlay?.remove();overlay=L.imageOverlay(canvas.toDataURL(),bounds,{opacity:1}).addTo(map);
 marker?.remove();marker=L.circleMarker([j.crossing.lat,j.crossing.lon],{radius:6,color:'#111',fillColor:'#f6c76c',fillOpacity:1}).addTo(map).bindTooltip('Crossing location');
 return bounds;
}

// A map first drawn while its pane is hidden has no size, so measure again before fitting.
function fit(bounds){map.invalidateSize();map.fitBounds(bounds);fitted=map.getZoom()>0;lastBounds=bounds;}

function render(r,note=''){
 const {masks,...shown}=r;result=shown;
 $('status').textContent=`${note}${r.status}: ${r.reason}`;
 $('summary').textContent=r.extent?`${r.source==='forecast'?'Forecast':'Reference'} flow ${r.flowM3s.toFixed(1)} m³/s (${Math.round(r.flowM3s/CFS_TO_M3S)} cfs)${r.flowTime?' at '+r.flowTime:''}. Estimated area ${(r.extent.wetAreaM2/1e6).toFixed(2)} km² inside this square; ${(r.sensitivity.halfFlow.wetAreaM2/1e6).toFixed(2)} km² at half the flow${r.sensitivity.doubleFlow?`, ${(r.sensitivity.doubleFlow.wetAreaM2/1e6).toFixed(2)} km² at double`:', double is above the rating curve'}.`:'No extent is estimated for this result.';
 const l=r.labels??{};
 $('label-extent').textContent=l.estimatedExtent??'No estimate.';$('label-age').textContent=l.sourceAge??'';$('label-missing').textContent=l.missingCoverage??'';$('label-uncertainty').textContent=l.uncertainty??'';
 $('download').disabled=false;
 if(junction){const bounds=paint(junction,masks);if(!fitted)fit(bounds);}
}

function showForecast(f,note,now){
 forecast={f,note,now};
 const usable=['ok','stale'].includes(f.status)&&f.points.length;
 $('time-row').hidden=!usable;
 if(usable){$('time').max=f.points.length-1;$('time').value=f.points.indexOf(f.points.find(p=>p.time===f.peak.time));}
 fillScenarios(f.providerContext);
 render(estimateFromForecast(junction,f,{now}),note);
}

function fillScenarios(context){
 const c=context?.categories,select=$('scenario');select.innerHTML='<option value="">Choose a flow</option>';
 if(!c||context.flowUnits!=='cfs')return;
 for(const k of ['action','minor','moderate','major'])if(Number.isFinite(c[k]?.flow))select.insertAdjacentHTML('beforeend',`<option value="${c[k].flow*CFS_TO_M3S}">NOAA ${k} category flow, ${c[k].flow} cfs</option>`);
}

async function selectJunction(id){
 const v=++version;forecast=null;$('time-row').hidden=true;
 const j=await loadJunction(id);if(v!==version)return;
 junction=j;fit(paint(j,null));
 $('status').textContent='Choose a forecast or a reference flow.';$('summary').textContent='';
 try{const raw=await (await fetch(`./data/nwps-${j.station.toLowerCase()}-metadata.json`)).json();if(v===version)fillScenarios({categories:raw.flood?.categories,flowUnits:raw.flood?.flowUnits});}catch{}
}

$('enable').onchange=()=>{version++;engine=createForecastEngine({enabled:$('enable').checked});$('status').textContent=$('enable').checked?'Live requests on.':'Live requests off.';};
$('live').onclick=async()=>{
 const v=++version;$('status').textContent='Requesting NOAA forecast…';
 const f=await engine.predict({siteId:junction.station,force:true});if(v!==version)return;
 if(f.status==='disabled'){$('status').textContent='Live requests are off. Tick the box first, or use the recorded forecast.';return;}
 showForecast(f,'',Date.now());
};
$('recorded').onclick=async()=>{
 const v=++version,id=junction.station,lower=id.toLowerCase();
 try{
  const [m,s,record]=await Promise.all([`nwps-${lower}-metadata.json`,`nwps-${lower}-stageflow.json`,id==='SCTA3'?'nwps-record.json':'nwps-regional-record.json'].map(async f=>{const r=await fetch('./data/'+f);if(!r.ok)throw new Error(`Fixture HTTP ${r.status}`);return r.json();}));
  if(v!==version)return;
  const now=Date.parse(record.recordedAt);showForecast(normalizeForecast(m,s,{now,retrievedAt:record.recordedAt,siteId:id}),`RECORDED FORECAST from ${record.recordedAt}. `,now);
 }catch(e){if(v===version)$('status').textContent=`unavailable: ${e.message}`;}
};
$('time').oninput=()=>{const {f,note,now}=forecast;render(estimateFromForecast(junction,f,{now,time:f.points[+$('time').value].time}),note);};
$('peak').onclick=()=>{const {f,note,now}=forecast;$('time').value=f.points.indexOf(f.points.find(p=>p.time===f.peak.time));render(estimateFromForecast(junction,f,{now}),note);};
$('scenario').onchange=()=>{if(!$('scenario').value)return;version++;$('time-row').hidden=true;render(estimateFromFlow(junction,+$('scenario').value,{now:Date.now()}),'REFERENCE FLOW, NOT A FORECAST. ');};
$('download').onclick=()=>{const u=URL.createObjectURL(new Blob([JSON.stringify(result,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=u;a.download='floodplain-hand-estimate.json';a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);};
$('junction').onchange=()=>selectJunction($('junction').value);

new ResizeObserver(()=>{if(lastBounds&&!fitted)fit(lastBounds);else map.invalidateSize();}).observe($('map'));
listing=await loadJunctionIndex();
for(const [id,j] of Object.entries(listing))$('junction').insertAdjacentHTML('beforeend',`<option value="${id}">${j.name}</option>`);
await selectJunction(Object.keys(listing)[0]);
