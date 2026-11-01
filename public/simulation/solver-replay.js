import { acceptInundationRun } from './inundation-contract.js';

export function inspectRecordedSolver(run) {
  const accepted = acceptInundationRun(run);
  if (accepted.status !== 'complete') throw new Error(accepted.reason);
  return {run: accepted, suitability: 'invalid_historical_forcing',
    warning: 'Recorded integration run only. Superseded rainfall encoding and ambiguous zeros invalidate its historical forcing. No upstream river inflow was supplied. Not a 2014 flood prediction.',
    maximumDepthM: Math.max(...accepted.frames.map(f => Math.max(...f.depthM.filter(Number.isFinite))))};
}

export function inspectReachSolver(run) {
  const accepted=acceptInundationRun(run);
  if(accepted.status!=='complete')throw new Error(accepted.reason);
  const checks=accepted.provenance.qualityChecks,comparison=checks?.comparison;
  if(!comparison || comparison.usedAsForcing!==false || !accepted.provenance.upstream)throw new Error('Missing reach boundary/comparison provenance');
  return {run:accepted,suitability:'requires_hydraulic_review',comparison,
    warning:'Observed Cortaro-inflow scenario; Trico is not an inflow boundary. '+(accepted.provenance.rainfallStatus==='complete_stage_iv_analysis'?'Stage IV rainfall included. '+(accepted.provenance.initialState?.description??'Initial-state details unavailable')+'. ':'Local rainfall omitted. ')+(/Independent-event/.test(comparison.validationRole??'')?'Independent-event check of frozen SFINCS configuration failed to reproduce the observed flow. Not blinded; no tuning for this event. ':comparison.validationRole?'Development benchmark: geometry was iterated against this event. Levee crest evidence is from February 2015, after the flood; exact 2014 condition remains unknown. Not independent validation. ':'Poor downstream agreement requires hydraulic review. ')+'Deep upstream pooling and unresolved geometry remain. Not an operational flood prediction.',
    maximumDepthM:checks.maximumDepthM,displayMaximumDepthM:checks.displayMaximumDepthM,depthDefinition:checks.depthDefinition??'Model grid-cell depth; not observed road depth'};
}
