import {acceptInundationRun} from './inundation-contract.js';
import {FAILURE_POINTS} from '../config.js';
const time=s=>typeof s==='string'&&/(Z|[+-]\d{2}:\d{2})$/.test(s)?Date.parse(s):NaN;
export function acceptCurrentManifest(m,{now=Date.now()}={}){
 const fail=(status,reason)=>({status,reason,manifest:m,run:null});
 if(m?.schemaVersion!==1||m.kind!=='current_inundation_manifest')return fail('unsupported','Unknown current-run manifest');
 if(m.status!=='complete')return fail('unavailable',m.reason??'No completed current SFINCS run published');
 if(!m.runId||!/^data\/[a-zA-Z0-9_./-]+\.json\.gz$/.test(m.artifact?.path??'')||m.artifact.path.includes('..')||!/^[a-f0-9]{64}$/.test(m.artifact.sha256??''))return fail('unsupported','Invalid current artifact reference');
 if(![m.issuedAt,m.validFrom,m.validTo,m.sourceAsOf].every(s=>Number.isFinite(time(s)))||time(m.issuedAt)>now+300000||time(m.sourceAsOf)>time(m.issuedAt)||time(m.validFrom)>=time(m.validTo))return fail('insufficient_data','Invalid issue/source/valid timestamps');
 if(m.outputQuantity?.name!=='cell_average_depth'||m.outputQuantity.units!=='m'||!m.outputQuantity.definition||!Array.isArray(m.assumptions)||!m.assumptions.length)return fail('unsupported','Output quantity and assumptions required');
 if(m.executionMode==='simulated_live_frozen_inputs')return {...fail('simulated_live','Frozen-input simulated live replay; not current weather'),quantity:m.outputQuantity};
 return {...fail(time(m.validTo)<=now?'expired':now-time(m.issuedAt)>86400000?'stale':'ok','Current forecast publication'),quantity:m.outputQuantity};
}
export function acceptCurrentRun(manifest,raw,{now=Date.now()}={}){
 const checked=acceptCurrentManifest(manifest,{now});if(!['ok','stale','expired','simulated_live'].includes(checked.status))return checked;
 const run=acceptInundationRun(raw),f=run.provenance?.forecast;
 if(manifest.executionMode==='simulated_live_frozen_inputs'&&run.provenance?.executionMode!==manifest.executionMode)return {...checked,status:'unsupported',reason:'Frozen-run mode mismatch',run:null};
 if(run.status!=='complete'||run.provenance.runId!==manifest.runId||f?.inputRole!=='forecast'||f.issuedAt!==manifest.issuedAt||f.validFrom!==manifest.validFrom||f.validTo!==manifest.validTo)return {...checked,status:'unsupported',reason:'Output lacks matching current-forecast provenance; historical replay cannot be substituted',run:null};
 if(run.frames.some(f=>!Number.isFinite(time(f.time)))||time(run.frames[0].time)>time(manifest.validFrom)||time(run.frames.at(-1).time)<time(manifest.validTo))return {...checked,status:'insufficient_data',reason:'Output does not cover declared valid window',run:null};
 return {...checked,run,reason:checked.status==='simulated_live'?'Frozen-input simulated live replay; not current weather':checked.status==='ok'?'Current SFINCS output available':`Current output ${checked.status}; context only`};
}
export async function loadCurrentRun({fetchImpl=fetch,now=Date.now(),timeoutMs=15000}={}){
 try{const r=await fetchImpl('data/current-sfincs-manifest.json',{cache:'no-store',signal:AbortSignal.timeout(timeoutMs)});if(!r.ok)throw Error(`Manifest HTTP ${r.status}`);const m=await r.json(),checked=acceptCurrentManifest(m,{now});if(!['ok','stale','expired','simulated_live'].includes(checked.status))return checked;
 const response=await fetchImpl(m.artifact.path,{signal:AbortSignal.timeout(timeoutMs)});if(!response.ok)throw Error(`Output HTTP ${response.status}`);const bytes=await response.arrayBuffer(),hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');if(hash!==m.artifact.sha256)throw Error('Current output checksum mismatch');const raw=JSON.parse(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text());return acceptCurrentRun(m,raw,{now});
 }catch(e){return {status:'unavailable',reason:e.message,run:null};}
}
export function currentSfincsEvidence(loaded,{now=Date.now()}={}){
 if(!loaded.run)return [];const {manifest:m,run}=loaded;
 return FAILURE_POINTS.map(fp=>{
  const support=m.crossings?.find(c=>c.crossingId===fp.id),index=support?.cellIndex;
  const cell=Number.isInteger(index)&&index>=0&&index<run.cells.length?run.cells[index]:null;const distanceM=cell?Math.hypot((cell.lat-fp.lat)*111320,(cell.lon-fp.lon)*111320*Math.cos(fp.lat*Math.PI/180)):Infinity;
  const matched=support?.status==='supported_neighborhood'&&!!support.evidence&&cell!==null&&distanceM<=150;
  const frames=matched?run.frames.filter(f=>time(f.time)>=now&&time(f.time)<=now+86400000&&time(f.time)>=time(m.validFrom)&&time(f.time)<=time(m.validTo)&&f.depthM[index]!==null):[];
  const peak=frames.reduce((a,b)=>!a||b.depthM[index]>a.depthM[index]?b:a,null);
  return {source:'SFINCS',crossingId:fp.id,status:!matched||!peak?'unsupported':loaded.status,mode:'forecast',asOf:m.issuedAt,validAt:peak?.time??null,concern:peak?peak.depthM[index]>=.01:false,depthM:peak?.depthM[index]??null,distanceM:Number.isFinite(distanceM)?distanceM:null,meaning:'Explicitly mapped model-cell neighborhood; cell-average depth, not roadway or bridge clearance',provenance:{runId:m.runId,sourceAsOf:m.sourceAsOf,artifact:m.artifact,support},limitations:m.assumptions,uncertainty:run.uncertainty};
 });
}
