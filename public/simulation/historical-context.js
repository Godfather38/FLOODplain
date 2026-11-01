import {acceptInundationRun} from './inundation-contract.js';
export function checkHistoricalCase(raw,entry){
 const run=acceptInundationRun(raw);if(run.status!=='complete')throw Error(run.reason);
 const c=run.provenance?.qualityChecks?.comparison;
 if(!c||c.usedAsForcing!==false||Math.abs(c.modelPeakM3s-entry.peakM3s)>1e-7||Math.abs(c.observedPeakM3s-entry.observedPeakM3s)>1e-7)throw Error('Manifest and solver comparison disagree');
 return {run,entry,comparison:c,role:entry.evaluationRole,mode:'historical_scenario'};
}
export async function loadHistoricalCase(event,{fetchImpl=fetch}={}){
 const m=await fetchImpl('data/published-channel-manifest.json');if(!m.ok)throw Error(`Manifest HTTP ${m.status}`);const manifest=await m.json(),entry=manifest.cases.find(c=>c.event===event);if(!entry)throw Error('Historical event unavailable');
 const r=await fetchImpl('data/'+entry.appArtifact);if(!r.ok)throw Error(`Solver artifact HTTP ${r.status}`);const bytes=await r.arrayBuffer();
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');if(digest!==entry.sha256)throw Error('Solver artifact checksum mismatch');
 const text=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();return {...checkHistoricalCase(JSON.parse(text),entry),manifest};
}
export function drawHistoricalFrame(canvas,run,index){
 const frame=run.frames[index],ctx=canvas.getContext('2d'),cells=run.cells,minX=Math.min(...cells.map(c=>c.lon)),maxX=Math.max(...cells.map(c=>c.lon)),minY=Math.min(...cells.map(c=>c.lat)),maxY=Math.max(...cells.map(c=>c.lat));ctx.fillStyle='#27333b';ctx.fillRect(0,0,canvas.width,canvas.height);
 const pad=12,w=canvas.width-2*pad,h=canvas.height-2*pad;let max=0;
 cells.forEach((c,i)=>{const depth=frame.depthM[i];if(depth===null)return;max=Math.max(max,depth);const intensity=Math.min(1,depth/2);ctx.fillStyle=depth<.01?'#a6a196':`rgb(${Math.round(100-80*intensity)},${Math.round(190-100*intensity)},230)`;ctx.fillRect(pad+(c.lon-minX)/(maxX-minX)*w,pad+(maxY-c.lat)/(maxY-minY)*h,3,3)});
 return {time:frame.time,maximumCellDepthM:max,flowM3s:frame.flowM3s??null};
}
