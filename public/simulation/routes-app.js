import {loadCurrentRun,currentSfincsEvidence,acceptCurrentManifest} from './current-inundation.js';
import {loadHistoricalCase,drawHistoricalFrame} from './historical-context.js';
import {createRouteAssessment} from './route-assessment.js';
import {fuseRoutes,handEvidence,sfincsEvidence} from './route-fusion.js';
const $=id=>document.getElementById(id);let currentSolver=null;
let evidence=[],result,lastAutomaticHand,operating,snapshotOverride,refreshTimer,busy=false;
const assessment=createRouteAssessment();
function render(){try{const saved=JSON.parse(sessionStorage.getItem('floodplain-hand-evidence'));if(saved?.hand&&saved.asOf!==lastAutomaticHand){lastAutomaticHand=saved.asOf;evidence=evidence.filter(e=>e.source!=='HAND').concat(saved.hand.map(handEvidence));}}catch{}let snapshot=snapshotOverride;if(!snapshot)try{snapshot=JSON.parse(sessionStorage.getItem('floodplain-route-evidence'));}catch{}
 if(currentSolver?.run){const checked=acceptCurrentManifest(currentSolver.manifest);currentSolver={...currentSolver,status:checked.status,reason:checked.reason};evidence=evidence.filter(e=>e.source!=='SFINCS'||e.mode!=='forecast').concat(currentSfincsEvidence(currentSolver));$('current-solver-status').textContent=`Current SFINCS: ${currentSolver.status}. ${currentSolver.reason}`;}
 result=fuseRoutes(snapshot,evidence);if(!snapshot)result.reason='Select Start / refresh live assessment to load all sources here';if(operating)result={...result,operatingContext:{asOf:operating.asOf,observations:operating.observations,connected:operating.connected,limitations:operating.limitations,currentSolver:{status:currentSolver?.status,reason:currentSolver?.reason,manifest:currentSolver?.manifest}}};$('status').textContent=`${result.status}: ${result.reason??'Combined evidence evaluated'}`;
 $('recommendation').textContent=result.recommendation?.text??'No route recommendation from the available evidence.';
 $('routes').replaceChildren();
 for(const r of result.routes){const section=document.createElement('section'),heading=document.createElement('h2'),summary=document.createElement('p'),details=document.createElement('details'),label=document.createElement('summary'),pre=document.createElement('pre');
  heading.textContent=r.name;summary.textContent=`${r.excluded?'EXCLUDED â€” official closure':r.decision}: ${r.level}; ${r.minutes} minutes. ${r.reasons.join(' ')}`;
  label.textContent='Crossing observations, model coverage and provenance';pre.textContent=JSON.stringify({original:r.points,models:r.sources,conflicts:r.conflicts},null,2);details.append(label,pre);section.append(heading,summary,details);$('routes').append(section);
 }$('download').disabled=!result.routes.length;
 $('sources').textContent=`Loaded model evidence: ${evidence.filter(e=>e.source==='HAND').length} HAND junction estimates; ${evidence.filter(e=>e.source==='SFINCS'&&e.status==='ok').length} SFINCS crossing-neighborhood matches. Unsupported, stale and historical records remain context only.`;
}
async function refreshAll(){
 if(busy)return;busy=true;$('refresh').disabled=true;$('area').disabled=true;$('operation').textContent='Refreshing observations, closures, official forecast, upstream guidance and HANDâ€¦';
 try{[operating,currentSolver]=await Promise.all([assessment.refresh({area:$('area').value}),loadCurrentRun()]);showCurrentSolver();snapshotOverride=operating.observations.snapshot;evidence=operating.connected.hand.map(handEvidence).concat(evidence.filter(e=>e.source==='SFINCS'&&e.mode==='scenario'),currentSfincsEvidence(currentSolver));lastAutomaticHand=operating.handTransport.asOf;
 try{sessionStorage.setItem('floodplain-route-evidence',JSON.stringify(snapshotOverride));sessionStorage.setItem('floodplain-hand-evidence',JSON.stringify(operating.handTransport));}catch{}
 render();const c=operating.connected;$('operation').textContent=`Updated ${operating.asOf}. Original sources missing: ${operating.observations.missing.join(', ')||'none'}. RFC ${c.official.status}; NWM ${c.nwm.status}; HEFS ${c.ensemble.status}; rainfall ${c.rainfall.status}; HAND ${c.handStatus}. ${operating.observations.errors.join(' ')} ${refreshTimer?'Next refresh in 5 minutes.':'Automatic refresh paused.'}`;
 $('provider-context').textContent=JSON.stringify({officialPeak:c.official.peak,nwm:c.nwm.reaches.map(r=>({reachId:r.reachId,relationship:r.relationship,status:r.status,issuedAt:r.issuedAt,peak:r.peak,sourceUrl:r.sourceUrl})),rainfall:{status:c.rainfall.status,issuedAt:c.rainfall.issuedAt,intervals:c.rainfall.intervals,limitation:c.rainfall.limitation},hand:c.hand.map(({masks,...h})=>h)},null,2);
 }catch(e){$('operation').textContent='Refresh failed: '+e.message+' Previous evidence retains its original timestamps.';render();}finally{busy=false;$('refresh').disabled=false;$('area').disabled=false;}
}
$('refresh').onclick=()=>{if(!refreshTimer)refreshTimer=setInterval(refreshAll,300000);$('stop').disabled=false;refreshAll();};
$('stop').onclick=()=>{clearInterval(refreshTimer);refreshTimer=null;$('stop').disabled=true;$('operation').textContent='Automatic refresh paused; displayed evidence retains its original timestamps.';};
$('area').onchange=()=>{snapshotOverride=null;operating=null;if(refreshTimer)refreshAll();else{$('operation').textContent='Select Start / refresh for this area.';$('routes').replaceChildren();$('recommendation').textContent='';$('download').disabled=true;$('status').textContent='No assessment loaded for selected area.';}};
window.addEventListener('pagehide',()=>clearInterval(refreshTimer));
$('hand').onchange=async event=>{try{const file=event.target.files[0];if(!file)return;if(file.size>5e6)throw Error('HAND export exceeds 5 MB');const e=handEvidence(JSON.parse(await file.text()));evidence=evidence.filter(x=>!(x.source==='HAND'&&x.crossingId===e.crossingId));evidence.push(e);render();}catch(error){$('status').textContent=`HAND import unavailable: ${error.message}`;}};
let historical,historyVersion=0;
function drawHistory(){if(!historical)return;const f=drawHistoricalFrame($('historical-map'),historical.run,Number($('historical-time').value));$('historical-frame').textContent=`${f.time} — maximum cell-average depth ${f.maximumCellDepthM.toFixed(2)} m. Grey: less than 0.01 m; blue: 0.01–2 m; darkest blue: 2 m or more. Not roadway depth.`;}
$('historical-time').oninput=drawHistory;
$('historical-event').onchange=()=>{historyVersion++;historical=null;$('historical-time').disabled=true;$('historical-artifact').hidden=true;$('historical-frame').textContent='';$('historical-status').textContent='Select Load selected historical run for this event.';const c=$('historical-map');c.getContext('2d').clearRect(0,0,c.width,c.height);};
$('sfincs').onclick=async()=>{const version=++historyVersion;$('historical-status').textContent='Loading original historical solver artifact and checking its checksum…';try{const loaded=await loadHistoricalCase($('historical-event').value);if(version!==historyVersion)return;historical=loaded;const {entry,comparison:c,manifest,run}=historical;
 $('historical-status').textContent=`${entry.event}: ${entry.evaluationRole}. Peak ${entry.peakM3s.toFixed(2)} vs ${entry.observedPeakM3s.toFixed(2)} m³/s (${entry.peakErrorPercent.toFixed(1)}%); timing ${entry.timingErrorMinutes>0?'+':''}${entry.timingErrorMinutes} min (${entry.timingErrorMinutes<0?'early':'late'}). ${c.pairs} paired readings; ${manifest.sampleSize} historical events, not a calibrated ± interval. ${manifest.conditioning}. ${manifest.geometryTemporalLimitation}. Rainfall: ${entry.rainfallStatus}.`;
 const slider=$('historical-time');slider.max=run.frames.length-1;slider.value=0;slider.disabled=false;$('historical-artifact').href='data/'+entry.appArtifact;$('historical-artifact').hidden=false;drawHistory();
 const frame=run.frames.reduce((a,b)=>(b.flowM3s??0)>(a.flowM3s??0)?b:a);evidence=evidence.filter(e=>e.source!=='SFINCS'||e.mode==='forecast').concat(sfincsEvidence(run,frame.time));render();
 }catch(e){$('historical-status').textContent='Historical context unavailable: '+e.message;}};
$('download').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(result,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='floodplain-combined-route-decision.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
render();

(async()=>{try{const response=await fetch('data/sfincs-event-comparison.json');if(!response.ok)throw Error(`HTTP ${response.status}`);const data=await response.json();$('measured-errors').replaceChildren();for(const event of data.events){const p=document.createElement('p');p.textContent=`${event.event}: peak ${event.peakErrorPercent.toFixed(1)}%; timing ${event.timingErrorMinutes>0?'+':''}${event.timingErrorMinutes} minutes (${event.timingErrorMinutes<0?'early':'late'}); ${event.comparison.pairs} paired samples. ${event.assessmentRole??event.comparison.validationRole}.`;$('measured-errors').append(p);}const p=document.createElement('p');p.textContent='These are different saved configurations/diagnostics across two storms, not independent samples of one universal error range.';$('measured-errors').append(p);}catch(e){$('measured-errors').textContent='Saved error evidence unavailable: '+e.message}})();

function showCurrentSolver(){
 $('current-solver-status').textContent=`Current SFINCS: ${currentSolver?.status??'unavailable'}. ${currentSolver?.reason??'No current run loaded.'}`;
 const slider=$('current-solver-time');slider.disabled=!currentSolver?.run;$('current-solver-download').hidden=!currentSolver?.run;
 if(!currentSolver?.run){$('current-solver-details').textContent='';$('current-solver-frame').textContent='';const c=$('current-solver-map');c.getContext('2d').clearRect(0,0,c.width,c.height);return;}
 const m=currentSolver.manifest;slider.max=currentSolver.run.frames.length-1;const first=currentSolver.run.frames.findIndex(f=>Date.parse(f.time)>=Date.now());slider.value=Math.max(0,first);$('current-solver-download').href=m.artifact.path;
 $('current-solver-details').textContent=JSON.stringify({issuedAt:m.issuedAt,sourceAsOf:m.sourceAsOf,validFrom:m.validFrom,validTo:m.validTo,quantity:m.outputQuantity,assumptions:m.assumptions,crossings:m.crossings??'No explicit crossing mapping; display only',uncertainty:currentSolver.run.uncertainty},null,2);drawCurrentSolver();
}
function drawCurrentSolver(){if(!currentSolver?.run)return;const f=drawHistoricalFrame($('current-solver-map'),currentSolver.run,Number($('current-solver-time').value));$('current-solver-frame').textContent=`Valid ${f.time}; maximum ${currentSolver.manifest.outputQuantity.name} ${f.maximumCellDepthM.toFixed(2)} m. Grey below 0.01 m; blue 0.01-2 m; darkest blue 2 m or more. Not road depth.`;}
$('current-solver-time').oninput=drawCurrentSolver;
loadCurrentRun().then(r=>{if(!operating){currentSolver=r;showCurrentSolver();}});
