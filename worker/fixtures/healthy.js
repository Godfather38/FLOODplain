import { USGS_SITES, FAILURE_POINTS } from '../../public/config.js';
// Synthetic, public configuration only. Fixed clock prevents quietly refreshing observations.
export const fixtureNow = Date.parse('2026-11-03T02:00:00Z');
export function healthy() {
  const ids = [...new Set(FAILURE_POINTS.flatMap(p => Object.values(p.rain || {}).flat()))];
  const streams = [...new Set(FAILURE_POINTS.flatMap(p => p.wash?.alert || []))];
  const station = site => ({ site, source: 'pima', name: 'Synthetic station', latitude: 32.3, longitude: -111.2, last_rpt: '2026-11-02T19:00:00' });
  return {
    usgs: Object.fromEntries(Object.keys(USGS_SITES).map(id => [id, {features: [{properties: {parameter_code: '00060', value: 0, time: new Date(fixtureNow).toISOString()}}]}])),
    rain: {data: ids.map(id => ({...station(id), rain: Array(9).fill(0)}))},
    stream: {data: streams.map(id => ({...station(id), flow: 0, stage: 0}))},
    closures: {features: []}, nws: {features: []}, tvClosures: {d: []}, tvWork: {d: {}},
  };
}
