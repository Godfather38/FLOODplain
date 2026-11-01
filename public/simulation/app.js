import { simulate, syntheticRain } from './model.js';
const $ = id => document.getElementById(id);
let terrain, rain, result;
const fmt = n => n.toLocaleString(undefined, { maximumFractionDigits: 2 });
function clearResult(message) {
  result=null;$('status').textContent=message;$('download').disabled=true;
  $('metrics').replaceChildren();$('chart').replaceChildren();$('balance').textContent='';
  $('map').getContext('2d').clearRect(0,0,540,540);$('time-label').textContent='';$('legend').textContent='';$('provenance').textContent='';
}
function draw() {
  if (!result) return;
  const index = Math.min(Number($('time').value), result.series.length-1), frame = result.series[index];
  const layer = $('layer').value;
  const values = layer === 'elevation' ? terrain.cells.map(c=>c.elevationM) : layer === 'accumulation' ? result.network.accumulation : frame.storageM3;
  const min = Math.min(...values), max = Math.max(...values), ctx = $('map').getContext('2d'), size = 540/terrain.cols;
  ctx.clearRect(0,0,540,540);
  values.forEach((v,i) => {
    const x = i % terrain.cols * size, y = Math.floor(i/terrain.cols)*size, f = (v-min)/(max-min || 1);
    ctx.fillStyle = `hsl(${layer==='elevation'?40+f*90:205-f*35} 38% ${22+f*35}%)`; ctx.fillRect(x,y,size,size);
    ctx.strokeStyle = result.network.contributes[i] ? '#f6c76c' : '#ffffff20'; ctx.lineWidth = result.network.contributes[i] ? 2 : 1; ctx.strokeRect(x+1,y+1,size-2,size-2);
    const j = result.network.downstream[i];
    if(j>=0){const dx=(j%terrain.cols-i%terrain.cols),dy=Math.floor(j/terrain.cols)-Math.floor(i/terrain.cols),a=Math.atan2(dy,dx),cx=x+size/2,cy=y+size/2;
      ctx.strokeStyle='#f0f5f5';ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(cx-Math.cos(a)*9,cy-Math.sin(a)*9);ctx.lineTo(cx+Math.cos(a)*10,cy+Math.sin(a)*10);ctx.lineTo(cx+Math.cos(a)*10-Math.cos(a-.6)*6,cy+Math.sin(a)*10-Math.sin(a-.6)*6);ctx.moveTo(cx+Math.cos(a)*10,cy+Math.sin(a)*10);ctx.lineTo(cx+Math.cos(a)*10-Math.cos(a+.6)*6,cy+Math.sin(a)*10-Math.sin(a+.6)*6);ctx.stroke();}
  });
  const c=terrain.crossingCell;ctx.fillStyle='#fff';ctx.font='bold 20px system-ui';ctx.fillText('×',c%terrain.cols*size+5,Math.floor(c/terrain.cols)*size+21);
  $('legend').textContent=`${$('layer').selectedOptions[0].text}: ${fmt(min)} to ${fmt(max)}. × = crossing sample, not surveyed bridge geometry.`;
  $('time-label').textContent=`${fmt(frame.minute)} min · ${new Date(Date.parse(rain.frames[0].start)+frame.minute*60000).toISOString()} · rain ${fmt(frame.rainfallMmH)} mm/h · crossing ${fmt(frame.crossingM3s)} m³/s`;
}
function run() {
  try {
    result = simulate(terrain, rain, { infiltrationMmH:Number($('infiltration').value),travelMinutes:Number($('travel').value),multiplier:Number($('multiplier').value) });
    $('status').textContent = `${rain.kind==='synthetic'?'SYNTHETIC STORM — no observed rainfall':'RADAR ESTIMATE REPLAY — not live'} · uncalibrated runoff scenario`;
    $('provenance').textContent = `Rain: ${rain.source}. First interval: ${rain.frames[0].start}. Terrain: ${terrain.source}; retrieved ${terrain.retrievedAt}. Rain multiplier: ${result.parameters.multiplier}×. ${result.network.downstream[terrain.crossingCell] === -1 ? "Crossing cell is an unresolved terrain pit: inflow is retained, not routed through a bridge." : ""}`;
    const peak=Math.max(...result.series.map(s=>s.crossingM3s)), peakFrame=result.series.find(s=>s.crossingM3s===peak);
    const metrics=[['Local inflow peak',`${fmt(peak)} m³/s`],['Peak after storm start',`${fmt(peakFrame.minute)} min`],['Contributing area in window',`${fmt(result.network.accumulation[terrain.crossingCell]*terrain.cellSizeM**2/1e6)} km²`]];
    $('metrics').replaceChildren(...metrics.map(([label,value])=>{const el=document.createElement('div');el.className='metric';const s=document.createElement('strong'),l=document.createElement('span');s.textContent=value;l.textContent=label;el.append(s,l);return el;}));
    const totals=result.totals;
    $('balance').textContent=`Rainfall          ${fmt(totals.rainfallM3)} m³\nInfiltration      ${fmt(totals.infiltrationM3)} m³\nBoundary outflow  ${fmt(totals.boundaryOutflowM3)} m³\nRemaining storage ${fmt(totals.storedM3)} m³\nBalance residual  ${totals.residualM3.toExponential(2)} m³`;
    const ymax=Math.max(.001,...result.series.map(s=>Math.max(s.boundaryM3s,s.crossingM3s))), end=result.series.at(-1).minute;
    const path=key=>'M45,245 '+result.series.map(s=>`L${45+s.minute/end*535},${245-s[key]/ymax*205}`).join(' ');
    $('chart').innerHTML=`<path d="M45 25V245H580" fill="none" stroke="#879ea9"/><path d="${path('boundaryM3s')}" fill="none" stroke="#72dbc6" stroke-width="2"/><path d="${path('crossingM3s')}" fill="none" stroke="#82b6ff" stroke-width="3"/><g fill="#c6d8e0" font-size="13"><text x="45" y="18">${fmt(ymax)} m³/s</text><text x="10" y="248">0</text><text x="45" y="270">0 min</text><text x="490" y="270">${fmt(end)} min</text></g>`;
    $('time').max=result.series.length-1;$('download').disabled=false;draw();
  } catch(e) { clearResult(`Cannot run: ${e.message}`); }
}
$('run').onclick=run;$('time').oninput=draw;$('layer').onchange=draw;
$('demo').onclick=()=>{rain=syntheticRain(terrain);$('file').value='';run();};
$('file').onchange=async()=>{try{const file=$('file').files[0];if(!file)return;if(file.size>8*1024*1024)throw new Error('8 MB input limit');rain=JSON.parse(await file.text());run();}catch(e){rain=null;clearResult(`Import failed: ${e.message}`);}};
$('download').onclick=()=>{const blob=new Blob([JSON.stringify({terrain,rain,result},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='floodplain-experimental-run.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
try{const response=await fetch('./data/terrain.json');if(!response.ok)throw new Error(`Terrain HTTP ${response.status}`);terrain=await response.json();rain=syntheticRain(terrain);run();}catch(e){$('status').textContent=`Cannot load terrain: ${e.message}. Serve this directory over HTTP.`;}
try {
  const response=await fetch('./data/usgs-trico-2014-candidate.json');if(!response.ok)throw new Error(`HTTP ${response.status}`);
  const {normalized:g}=await response.json(),p=g.points,peak=p.reduce((a,b)=>a.valueM3s>b.valueM3s?a:b),start=Date.parse(p[0].time),duration=Date.parse(p.at(-1).time)-start;
  const path=p.map((v,i)=>`${i?'L':'M'}${45+(Date.parse(v.time)-start)/duration*535},${245-v.valueM3s/peak.valueM3s*205}`).join(' ');
  $('gauge-chart').innerHTML=`<path d="M45 25V245H580" fill="none" stroke="#879ea9"/><path d="${path}" fill="none" stroke="#edbb66" stroke-width="3"/><g fill="#c6d8e0" font-size="13"><text x="45" y="18">${fmt(peak.valueM3s)} m³/s</text><text x="10" y="248">0</text><text x="45" y="270">Sep 8 00:00 UTC</text><text x="450" y="270">Sep 10 00:00 UTC</text></g>`;
  $('gauge-status').textContent=`${g.siteId}: ${p.length} recorded samples; ${g.quality.approvalStatuses.join(', ')}; maximum gap ${g.quality.maxGapMinutes} min. Peak in this window: ${fmt(peak.valueM3s)} m³/s (${fmt(peak.originalValueCfs)} ft³/s), ${peak.time}. Retrieved ${g.retrievedAt}. Historical evidence, not live.`;
} catch(e) {$('gauge-status').textContent=`Gauge evidence unavailable: ${e.message}`;}
