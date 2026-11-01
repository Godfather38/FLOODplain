import {fuseRoutes,handEvidence,sfincsEvidence} from './route-fusion.js';
const $=id=>document.getElementById(id);let evidence=[],result,lastAutomaticHand;
function render(){try{const saved=JSON.parse(sessionStorage.getItem('floodplain-hand-evidence'));if(saved?.hand&&saved.asOf!==lastAutomaticHand){lastAutomaticHand=saved.asOf;evidence=evidence.filter(e=>e.source!=='HAND').concat(saved.hand.map(handEvidence));}}catch{}let snapshot;try{snapshot=JSON.parse(sessionStorage.getItem('floodplain-route-evidence'));}catch{}
 result=fuseRoutes(snapshot,evidence);$('status').textContent=`${result.status}: ${result.reason??'Combined evidence evaluated'}`;
 $('recommendation').textContent=result.recommendation?.text??'No route recommendation from the available evidence.';
 $('routes').replaceChildren();
 for(const r of result.routes){const section=document.createElement('section'),heading=document.createElement('h2'),summary=document.createElement('p'),details=document.createElement('details'),label=document.createElement('summary'),pre=document.createElement('pre');
  heading.textContent=r.name;summary.textContent=`${r.excluded?'EXCLUDED — official closure':r.decision}: ${r.level}; ${r.minutes} minutes. ${r.reasons.join(' ')}`;
  label.textContent='Crossing observations, model coverage and provenance';pre.textContent=JSON.stringify({original:r.points,models:r.sources,conflicts:r.conflicts},null,2);details.append(label,pre);section.append(heading,summary,details);$('routes').append(section);
 }$('download').disabled=!result.routes.length;
 $('sources').textContent=`Loaded model evidence: ${evidence.filter(e=>e.source==='HAND').length} HAND junction estimates; ${evidence.filter(e=>e.source==='SFINCS'&&e.status==='ok').length} SFINCS crossing-neighborhood matches. Unsupported, stale and historical records remain context only.`;
}
$('refresh').onclick=render;
$('hand').onchange=async event=>{try{const file=event.target.files[0];if(!file)return;if(file.size>5e6)throw Error('HAND export exceeds 5 MB');const e=handEvidence(JSON.parse(await file.text()));evidence=evidence.filter(x=>!(x.source==='HAND'&&x.crossingId===e.crossingId));evidence.push(e);render();}catch(error){$('status').textContent=`HAND import unavailable: ${error.message}`;}};
$('sfincs').onclick=async()=>{try{$('status').textContent='Loading recorded SFINCS context…';const r=await fetch('data/sfincs-reach-levee-recorded.json.gz');if(!r.ok)throw Error(`HTTP ${r.status}`);const run=JSON.parse(await new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).text());const peak=run.frames.reduce((a,b)=>(b.flowM3s??0)>(a.flowM3s??0)?b:a);evidence=evidence.filter(x=>x.source!=='SFINCS').concat(sfincsEvidence(run,peak.time));render();}catch(error){$('status').textContent=`SFINCS context unavailable: ${error.message}`;}};
$('download').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(result,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='floodplain-combined-route-decision.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
render();
