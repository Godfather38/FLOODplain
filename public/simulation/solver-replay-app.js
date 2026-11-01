import {inspectRecordedSolver,inspectReachSolver} from './solver-replay.js';
const $=id=>document.getElementById(id),status=$('status');let version=0;
async function load(){const token=++version,reach=$('run').value!=='legacy',rain=$('run').value==='stage4';status.textContent='Loading original recorded solver output…';$('frame').disabled=true;$('details').textContent='';$('time').textContent='';$('comparison').textContent='';
 try {
  const file=rain?'sfincs-reach-stage4-recorded.json.gz':reach?'sfincs-reach-recorded.json.gz':'sfincs-recorded.json.gz';$('artifact').href='data/'+file;
  const response=await fetch('data/'+file);if(!response.ok)throw new Error(`Recorded artifact HTTP ${response.status}`);
  const run=JSON.parse(await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).text());if(token!==version)return;
  const result=reach?inspectReachSolver(run):inspectRecordedSolver(run);status.textContent=result.warning;
  $('details').textContent=JSON.stringify({suitability:result.suitability,model:run.model,runId:run.provenance.runId,cells:run.cells.length,frames:run.frames.length,fullDomainMaximumDepthM:result.maximumDepthM,displayMaximumDepthM:result.displayMaximumDepthM,uncertainty:run.uncertainty,support:run.support,provenance:run.provenance},null,2);
  if(reach){const c=result.comparison,minutes=(Date.parse(c.modelPeakTime)-Date.parse(c.observedPeakTime))/60000;
   $('comparison').textContent=`Native section peak ${c.modelPeakM3s.toFixed(1)} m³/s versus observed Trico ${c.observedPeakM3s.toFixed(1)} m³/s; ${Math.floor(minutes/60)} h ${minutes%60} min late. RMSE ${c.rmseM3s.toFixed(1)} m³/s. Full-domain maximum depth ${result.maximumDepthM.toFixed(2)} m; displayed Trico crop maximum ${result.displayMaximumDepthM.toFixed(2)} m. Deep upstream pooling requires hydraulic review. Comparison uses finer native output than the hourly viewer.`;
  }
  const slider=$('frame');slider.max=run.frames.length-1;slider.value=0;slider.disabled=false;
  const xs=run.cells.map(c=>c.lon),ys=run.cells.map(c=>c.lat),west=Math.min(...xs),east=Math.max(...xs),south=Math.min(...ys),north=Math.max(...ys);
  function render(){const f=run.frames[Number(slider.value)],max=Math.max(...f.depthM.filter(Number.isFinite));$('time').textContent=`${f.time}: displayed maximum ${max.toFixed(3)} m${f.flowM3s===undefined?'':`; section flow ${f.flowM3s.toFixed(2)} m³/s`}.`;
   const ctx=$('depth-map').getContext('2d');ctx.fillStyle='#172833';ctx.fillRect(0,0,600,500);
   run.cells.forEach((c,i)=>{const d=f.depthM[i];ctx.fillStyle=d===null?'#777':d<.01?'#34414a':`hsl(205 70% ${85-Math.min(d/2,1)*55}%)`;ctx.fillRect(5+(c.lon-west)/(east-west)*585,5+(north-c.lat)/(north-south)*485,6,6);});
  }slider.oninput=render;render();
 }catch(error){if(token===version)status.textContent=`Recorded solver output unavailable: ${error.message}`;}
}
$('run').onchange=load;await load();
