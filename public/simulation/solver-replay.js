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
    warning:'Observed Cortaro-inflow scenario; Trico observations withheld. Local rainfall omitted. Poor downstream agreement and deep upstream pooling require hydraulic review. Not an operational flood prediction.',
    maximumDepthM:checks.maximumDepthM,displayMaximumDepthM:checks.displayMaximumDepthM};
}
