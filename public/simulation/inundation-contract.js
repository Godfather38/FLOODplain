// Adapter boundary for the separately owned SFINCS/HydroMT execution pipeline.
// No solver execution or synthetic depths are provided here.
export function acceptInundationRun(run) {
  const reject=reason=>({schemaVersion:1,status:'unsupported',reason,model:'SFINCS',frames:[]});
  if(run?.schemaVersion!==1 || run.model!=='SFINCS' || run.kind!=='inundation_scenario')return reject('Require SFINCS inundation_scenario schema v1');
  if(run.status!=='complete')return {...reject('Solver output not complete'),status:'insufficient_data'};
  if(run.crs!=='EPSG:4326' || !Array.isArray(run.cells) || !run.cells.length || !Array.isArray(run.frames) || !run.frames.length)return reject('Require geographic cells and time frames');
  if(run.cells.some(c=>!Number.isFinite(c.lon)||Math.abs(c.lon)>180||!Number.isFinite(c.lat)||Math.abs(c.lat)>90))return reject('Invalid cell coordinates');
  if(!run.provenance?.solverVersion || !run.provenance?.runId || !Array.isArray(run.provenance?.inputArtifacts) || !run.provenance.inputArtifacts.length)return reject('Missing solver/input provenance');
  if(!run.support?.domainDescription || !Array.isArray(run.support?.limitations) || !run.uncertainty?.status)return reject('Missing support or uncertainty metadata');
  for(let i=0;i<run.frames.length;i++) {
    const f=run.frames[i],t=Date.parse(f.time);
    if(!Number.isFinite(t)||(i&&t<=Date.parse(run.frames[i-1].time))||!Array.isArray(f.depthM)||f.depthM.length!==run.cells.length||f.depthM.some(d=>d!==null&&(!Number.isFinite(d)||d<0)))return reject('Invalid depth/time coverage; missing cells must be null');
    if(f.flowM3s!==undefined&&(!Number.isFinite(f.flowM3s)||!f.flowLocation))return reject('Flow requires a finite value and an explicit section/location');
  }
  return {...run,interpretation:'Model scenario; not observed road depth or a passability decision'};
}
