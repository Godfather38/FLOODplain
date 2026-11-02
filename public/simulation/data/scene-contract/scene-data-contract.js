// Additive data boundary: consumes existing model/evidence; never computes route risk.
export const SCENE_SCHEMA = 'floodplain-scene-v1';
export const metersToFeet = value => Number.isFinite(value) ? value / 0.3048 : null;

// Accept the existing recentGauge cache shape. This adapter performs no requests
// and keeps the original observation clock, quality and source.
export function adaptRecentGauge(record, now) {
  const points=(record?.points??[]).map(p=>({time:p.time,
    valueM3s:Number.isFinite(p.cfs)&&p.cfs>=0?p.cfs*0.028316846592:null,
    quality:p.quality??null}));
  return {source:record?.source??null,retrievedAt:record?.retrievedAt??null,
    refreshError:record?.refreshError??null,units:'m3/s',points,
    summary:gaugeSummary(points,now),modelInputRole:'context_only',stageToRoadCorrection:null};
}

export function gaugeSummary(points, now, { staleMs = 10800000 } = {}) {
  const clock = Date.parse(now);
  if (!Number.isFinite(clock)) throw Error('Explicit assessment time required');
  const usable = points.filter(p => Number.isFinite(p.valueM3s) && p.valueM3s >= 0 &&
    Number.isFinite(Date.parse(p.time)) && Date.parse(p.time) <= clock && !p.maintenance)
    .sort((a,b) => Date.parse(a.time)-Date.parse(b.time));
  const latest = usable.at(-1), previous = usable.findLast(p => Date.parse(p.time) < Date.parse(latest?.time));
  const ageMs = latest ? clock-Date.parse(latest.time) : null;
  return {status: !latest ? 'missing' : ageMs > staleMs ? 'stale' : 'observation_supported',
    observedAt: latest?.time ?? null, ageMs, valueM3s: latest?.valueM3s ?? null,
    trend: !previous ? 'unknown' : latest.valueM3s > previous.valueM3s ? 'rising' : latest.valueM3s < previous.valueM3s ? 'falling' : 'steady',
    trendWindow: previous ? [previous.time,latest.time] : null,
    interpretation: 'Discharge trend at this gauge only; no road-depth or arrival-time conversion'};
}

export function trackingState(entry, { now, observations = [], assessment = null } = {}) {
  const gauge = gaugeSummary(observations, now);
  const model = entry.model;
  const stale = model?.validTo && Date.parse(model.validTo) < Date.parse(now);
  return {id:entry.id, hydraulicStatus: model?.status ?? 'not_yet_assessed',
    observationStatus:gauge.status,
    state: gauge.status === 'observation_supported' ? 'observation_supported' :
      model?.status === 'modeled' ? (stale ? 'stale' : 'modeled') :
      gauge.status === 'stale' ? 'stale' : model?.status ?? 'not_yet_assessed',
    risk: assessment ?? {status:'not_yet_assessed',score:null,closure:null},
    // Existing assessment is passed through intact, including closures and numeric weights.
    clearance:null};
}

export function validateScene(scene) {
  if (scene?.schema !== SCENE_SCHEMA || scene.coordinates?.crs !== 'EPSG:4326' ||
      scene.coordinates?.order !== 'longitude,latitude' || scene.units?.length !== 'm' ||
      !scene.verticalDatum || !scene.runId) throw Error('Scene identity/units/datum required');
  const ids = new Set(scene.cells.map(c=>c.nativeFaceId));
  if (ids.size !== scene.cells.length) throw Error('Duplicate native face');
  let last = -Infinity;
  for (const frame of scene.frames) {
    const time = Date.parse(frame.validTime);
    if (!Number.isFinite(time) || time <= last) throw Error('Ordered native times required');
    last = time;
    for (const key of ['depthM','waterSurfaceM'])
      if (frame[key]?.length !== scene.cells.length || frame[key].some(v=>v!==null&&!Number.isFinite(v))) throw Error('Missing values must be null, with matching face order');
    if(frame.depthM.some(v=>v!==null&&v<0)) throw Error('Negative display depth');
  }
  if(scene.flow?.status !== 'unavailable' || scene.flow.velocityMps !== null || scene.flow.direction !== null)
    throw Error('This version accepts no unverified velocity export');
  return scene;
}
