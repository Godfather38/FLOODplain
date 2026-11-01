import { acceptInundationRun } from './inundation-contract.js';

export function inspectRecordedSolver(run) {
  const accepted = acceptInundationRun(run);
  if (accepted.status !== 'complete') throw new Error(accepted.reason);
  return {run: accepted, suitability: 'invalid_historical_forcing',
    warning: 'Recorded integration run only. Superseded rainfall encoding and ambiguous zeros invalidate its historical forcing. No upstream river inflow was supplied. Not a 2014 flood prediction.',
    maximumDepthM: Math.max(...accepted.frames.map(f => Math.max(...f.depthM.filter(Number.isFinite))))};
}
