import {modelFreshness,validateScene} from './scene-data-contract.js';
const time=t=>new Date(t).toLocaleString('en-US',{timeZone:'America/Phoenix',month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'})+' MST';
export const depthFeet=m=>!Number.isFinite(m)?'Unknown':m>0&&m/0.3048<0.001?'Less than 0.001 ft':(m/0.3048).toFixed(3)+' ft';
export function bindPoint(scene,entry,manifest,pointer){
 validateScene(scene);
 if(manifest.status!=='complete'||manifest.executionMode!=='simulated_live_frozen_inputs')throw Error('Incomplete recorded source');
 for(const key of ['NWM','HRRR'])if(scene.sourceIssues[key]!==pointer.sourceIssues[key]||scene.sourceIssues[key]!==entry.model.sourceIssues[key])throw Error('Recorded input issue mismatch');
 if(scene.runId!==pointer.runId||manifest.runId!==scene.runId||scene.geometrySha256!==pointer.geometrySha256||manifest.geometry.sha256!==scene.geometrySha256||scene.provenance.manifestSha256!==pointer.sha256||scene.clockMode!=='frozen_replay')throw Error('Recorded result source mismatch');
 for(const key of ['validFrom','validTo'])if(scene[key]!==manifest[key]||scene[key]!==entry.model[key])throw Error('Recorded time window mismatch');
 const i=entry.model.pointSeriesIndex,c=scene.cells[i];
 if(!c||c.inventoryId!==entry.id||c.nativeFaceId!==entry.model.nativeFaceId||c.sourceCellIndex!==entry.model.cellIndex||JSON.stringify(c.pointCoordinates)!==JSON.stringify(entry.coordinates)||entry.model.runId!==scene.runId||entry.model.geometrySha256!==scene.geometrySha256)throw Error('Recorded location mismatch');
 if(scene.frames.length!==manifest.frames.length||!scene.frames.length)throw Error('Recorded timeline mismatch');
 scene.frames.forEach((f,j)=>{if(f.validTime!==manifest.frames[j].time||f.sourceSha256!==manifest.frames[j].sha256)throw Error('Recorded frame mismatch');});
 return i;
}
async function json(url,sha){
 const r=await fetch(url);if(!r.ok)throw Error('Recorded data HTTP '+r.status);
 const bytes=await r.arrayBuffer();
 if(sha){const actual=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');if(actual!==sha)throw Error('Recorded data checksum mismatch');}
 return JSON.parse(new TextDecoder().decode(bytes));
}
let request;
async function load(){
 const base=new URL('./',import.meta.url),pointer=await json(new URL('data/silverbell-scene-publication.json',base));
 if(pointer.status!=='complete'||pointer.runId!=='silverbell-full-41370039087'||pointer.path!=='data/silverbell-full-41370039087/compact/manifest.json')throw Error('Invalid recorded publication');
 const manifest=await json(new URL(pointer.path,base),pointer.sha256);
 const pkg=await json(new URL('data/scene-contract/package-manifest.json',base));
 const descriptor=pkg.files.find(f=>f.path==='silverbell-point-scene.json');if(!descriptor?.sha256)throw Error('Missing point-series checksum');
 const scene=await json(new URL('data/scene-contract/silverbell-point-scene.json',base),descriptor.sha256);
 return {scene,manifest,pointer};
}
export async function mountSilverbellPoint(root,entry){
 root.textContent='Loading recorded Silverbell results…';
 try{
  request??=load().catch(e=>{request=null;throw e});
  const {scene,manifest,pointer}=await request,i=bindPoint(scene,entry,manifest,pointer);if(!root.isConnected)return;
  const freshness=modelFreshness(scene,new Date().toISOString());
  root.innerHTML='<h4>Recorded Silverbell results</h4><p data-clock></p><p>These are averages across a model cell, not measured water depth on the road. They do not establish whether a road is safe.</p><label>Recorded time <select data-recorded-time></select></label><div><button type="button" class="btn" data-prev>Previous time</button> <button type="button" class="btn" data-next>Next time</button></div><p data-reading aria-live="polite"></p><p data-peak></p><details><summary>Dates and measurement details</summary><p data-dates></p><p data-elevation></p><p>The terrain-profile sample is not a validated pavement elevation. No road clearance is calculated.</p></details><p><strong>Unavailable for this recording:</strong> matching 3D terrain, precise wet extent, water speed and direction. Existing maps show their own runs; they do not display this recording.</p>';
  root.querySelector('[data-clock]').textContent='Frozen replay — not current weather. '+({expired:'The original valid window has expired.',not_yet_valid:'The original valid window has not started.',within_original_valid_window:'Within the original valid window; the inputs remain frozen.'}[freshness.temporalStatus]??'Original validity is unknown.');
  root.querySelector('[data-dates]').textContent=`Original window: ${time(scene.validFrom)} to ${time(scene.validTo)}. NWM inputs issued ${time(scene.sourceIssues.NWM)}; HRRR inputs issued ${time(scene.sourceIssues.HRRR)}. Model issue time not supplied.`;
  const select=root.querySelector('select');scene.frames.forEach((f,j)=>{const option=document.createElement('option');option.value=j;option.textContent=time(f.validTime);select.append(option)});
  const known=scene.frames.filter(f=>Number.isFinite(f.depthM[i])),peak=known.reduce((best,f)=>!best||f.depthM[i]>best.depthM[i]?f:best,null);
  root.querySelector('[data-peak]').textContent=peak?`Highest recorded cell-average depth: ${depthFeet(peak.depthM[i])}, ${time(peak.validTime)}.`:'Highest recorded depth unknown.';
  const update=()=>{const j=Number(select.value),f=scene.frames[j];root.querySelector('[data-reading]').textContent=`${time(f.validTime)} · ${j+1} of ${scene.frames.length} · Cell-average depth: ${depthFeet(f.depthM[i])}`;root.querySelector('[data-elevation]').textContent=`Water-surface elevation: ${depthFeet(f.waterSurfaceM[i])} NAVD88. Terrain-profile sample: ${depthFeet(scene.cells[i].roadProfileTerrainNAVD88M)} NAVD88.`;root.querySelector('[data-prev]').disabled=j===0;root.querySelector('[data-next]').disabled=j===scene.frames.length-1;};
  select.onchange=update;for(const [key,step] of [['prev',-1],['next',1]])root.querySelector('[data-'+key+']').onclick=()=>{select.value=Number(select.value)+step;update()};update();
 }catch(e){root.textContent='Recorded Silverbell results unavailable: '+e.message+'. Missing results do not mean a dry road.';}
}
