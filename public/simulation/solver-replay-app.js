import {inspectRecordedSolver} from './solver-replay.js';
const status=document.querySelector('#status');
try {
  const response=await fetch('data/sfincs-recorded.json.gz');
  if(!response.ok)throw new Error(`Recorded artifact HTTP ${response.status}`);
  const run=JSON.parse(await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).text());
  const result=inspectRecordedSolver(run);
  status.textContent=result.warning;
  document.querySelector('#details').textContent=JSON.stringify({suitability:result.suitability,model:run.model,runId:run.provenance.runId,cells:run.cells.length,frames:run.frames.length,maximumDepthM:result.maximumDepthM,wettingThresholdM:0.01,uncertainty:run.uncertainty,support:run.support},null,2);
  const slider=document.querySelector('#frame');slider.max=run.frames.length-1;slider.disabled=false;
  const render=()=>{const f=run.frames[Number(slider.value)];document.querySelector('#time').textContent=`${f.time}: maximum stored depth ${(Math.max(...f.depthM.filter(Number.isFinite))*1000).toFixed(3)} mm. This run is below the 10 mm wetting threshold.`;};
  slider.addEventListener('input',render);render();
} catch(error){status.textContent=`Recorded solver output unavailable: ${error.message}`;}
