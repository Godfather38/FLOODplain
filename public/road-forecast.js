// The SFINCS road flood forecast for texts and push alerts (the Apps Script service), and the
// thresholds the app shares (simulation/route-prediction.js). No imports and no browser features,
// so tools/build_gas.mjs can bundle it into apps-script/WashWatch.gs.
//
// The service can't decode the 5 m road-height package every minute, so tools/build_road_cells.mjs
// reduces it to a small table: for every route, each 100 m model cell its road passes through, with
// the LOWEST road height in that cell. Water over the road in a cell is the SFINCS water surface
// minus that lowest road (capped at the cell's own water depth), which is exactly the deepest value
// the app finds among that cell's 5 m stations. So the route's level here is the same as in the app.
// See docs/SFINCS-ROUTE-PREDICTION.md.

export const WET_M = 0.0091;     // 0.03 ft: below this a cell holds no water
export const COVER_M = 0.05;     // more than about 2 in over the road counts as water over the road
export const DEEP_M = 0.3;       // 1 ft or more over the road
export const LIVE_MAX_AGE_MS = 3 * 3600e3; // the same freshness limit as the app's live run
export const levelFor = (maxOver) => (maxOver >= DEEP_M ? 'danger' : maxOver > COVER_M ? 'caution' : 'ok');

// table: {routes: {routeId: [[cell, lowestRoadM, bedM, lon, lat, deck], ...]}}
// water: the live run's water.json ({frames: [{time, surfaceM: [...]}]}); manifest: its manifest.json.
// -> {status: 'ok', issuedAt, times, routes: {routeId: {level, maxOver, time, lat, lon, deck, cells}}}
//    or {status: 'stale' | 'unavailable', reason}
export function roadForecast(table, manifest, water, now) {
  if (!manifest || !water || !Array.isArray(water.frames)) return { status: 'unavailable', reason: 'The live SFINCS run did not answer.' };
  const issued = Date.parse(manifest.issuedAt);
  if (!(now - issued <= LIVE_MAX_AGE_MS)) return { status: 'stale', reason: `The newest live SFINCS run is older than ${LIVE_MAX_AGE_MS / 3600e3} hours.` };
  const times = water.frames.map((f) => Date.parse(f.time));
  const step = times.length > 1 ? times[1] - times[0] : 3600e3;
  if (!times.length || now < times[0] - step || now > times[times.length - 1] + step) return { status: 'stale', reason: 'The live SFINCS run does not cover the current time.' };
  let from = 0;
  while (from + 1 < times.length && times[from + 1] <= now) from++;
  const routes = {};
  for (const id of Object.keys(table.routes)) {
    let best = { maxOver: -Infinity, time: null, lat: null, lon: null, deck: false };
    const validCells = new Set();
    for (const [cell, roadM, bedM, lon, lat, deck] of table.routes[id]) {
      for (let k = from; k < water.frames.length; k++) {
        const z = water.frames[k].surfaceM[cell];
        if (z == null || !Number.isFinite(z) || z <= -9999) continue; // no model value
        validCells.add(cell);
        if (z - bedM < WET_M) continue; // observed dry model cell
        // A road below the cell's average ground: the cell's own depth, not the height difference
        // (the same rule as simulation/route-prediction.js).
        const over = Math.min(z - roadM, z - bedM);
        if (over > best.maxOver) best = { maxOver: over, time: times[k], lat, lon, deck: !!deck };
      }
    }
    routes[id] = { ...best, level: levelFor(best.maxOver), cells: validCells.size, mappedCells: table.routes[id].length };
  }
  return { status: 'ok', issuedAt: manifest.issuedAt, runId: manifest.runId, times, routes };
}

// One rating row for a route, shaped like the county barricade rows in logic.js. The words are short
// because they go into texts. Only when the forecast covers now; it can raise a route, never lower it.
export function roadForecastPoint(id, r) {
  const hour = r.time == null ? '' : ` at ${new Date(r.time).toLocaleTimeString('en-US', { timeZone: 'America/Phoenix', hour: 'numeric', minute: '2-digit' })}`;
  const model = r.source === 'high_resolution' ? 'High-resolution SFINCS forecast' : 'SFINCS forecast';
  let why = r.maxOver > COVER_M
    ? `${model}: ${(r.maxOver * 3.28084).toFixed(1)} ft of modeled water over the ${r.deck ? 'bridge deck' : 'road'}${hour}`
    : `${model}: no water over the checked road locations`;
  if (r.coverage === 'partial') why += '. Road coverage is incomplete.';
  if (r.source === 'coarse_fallback') why += ` Coarse model fallback: ${r.fallbackReason}`;
  if (r.issuedAt) why += ` Run issued ${new Date(r.issuedAt).toLocaleString('en-US', { timeZone: 'America/Phoenix', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} Arizona time.`;
  return { id: `sfincs-${id}`, short: 'Flood model', name: 'SFINCS road flood forecast', where: 'Along this route', kind: 'road', lat: r.lat, lon: r.lon,
    level: r.level, why, evidenceAvailable: true, closurePts: [], routeBarricade: true, checks: [{ src: 'sfincs', level: r.level, why }] };
}

// The three native high-resolution models own different routes. Never substitute a neighboring
// model just because its rectangle overlaps a road, or a saved/replayed run for a live forecast.
export const ALL_ROUTE_CASES = {
  northern: ['trico', 'avra', 'silverbell-north', 'silverbell-south'],
  'picture-rocks': ['pr-ina', 'pr-twinpeaks', 'pr-avra'],
  gates: ['pr-gates'],
};
export const ALL_ROUTE_LIVE = 'https://raw.githubusercontent.com/Godfather38/FLOODplain/live-model/all-route/';

export function highResolutionRoadForecast(summary, expectedCase, now) {
  const unavailable = (reason) => ({ status: 'unavailable', reason, routes: {} });
  if (!summary || summary.schemaVersion !== 1 || summary.kind !== 'live_all_route_road_forecast' ||
      summary.executionMode !== 'live_current_forcing' || summary.case !== expectedCase ||
      !ALL_ROUTE_CASES[expectedCase] || summary.status !== 'complete') {
    return unavailable('A complete live high-resolution run is unavailable.');
  }
  if (!Array.isArray(summary.times) || !summary.runId) return unavailable('The high-resolution run identity or times are missing.');
  const issued = Date.parse(summary.issuedAt), times = summary.times.map(Date.parse);
  if (!Number.isFinite(issued) || issued > now + 5 * 60e3 || now - issued > LIVE_MAX_AGE_MS) {
    return { status: 'stale', reason: 'The high-resolution run is not current.', routes: {} };
  }
  if (times.length < 2 || times.some((t, k) => !Number.isFinite(t) || (k && t <= times[k - 1])) ||
      Date.parse(summary.validFrom) !== times[0] || Date.parse(summary.validTo) !== times[times.length - 1]) {
    return unavailable('The high-resolution forecast times are incomplete or invalid.');
  }
  if (now < times[0] || now > times[times.length - 1]) {
    return { status: 'stale', reason: 'The high-resolution run does not cover the current time.', routes: {} };
  }
  let from = 0;
  while (from + 1 < times.length && times[from + 1] <= now) from++;
  const routes = {}, routeStatus = {};
  for (const id of ALL_ROUTE_CASES[expectedCase]) {
    const r = summary.routes?.[id], count = r?.totalStations;
    if (!r || !Number.isInteger(count) || count < 1 || !Number.isInteger(r.mappedStations) ||
        r.mappedStations < 1 || r.mappedStations > count || !Array.isArray(r.frames) || r.frames.length !== times.length) {
      routeStatus[id] = 'No high-resolution road coverage.'; continue;
    }
    let best = null, minimumValid = count, complete = r.mappedStations === count && r.outsideStations === 0 && r.unknownHeightStations === 0;
    for (let k = from; k < times.length; k++) {
      const f = r.frames[k];
      if (!f || !Number.isInteger(f.validStations) || f.validStations < 1 || f.validStations > r.mappedStations ||
          !Number.isFinite(f.peakRoadDepthM) || f.peakRoadDepthM < 0 || !['complete', 'partial'].includes(f.coverage)) {
        complete = false; minimumValid = 0; continue;
      }
      minimumValid = Math.min(minimumValid, f.validStations);
      if (f.validStations !== count || f.coverage !== 'complete') complete = false;
      if (!best || f.peakRoadDepthM > best.maxOver) best = {
        maxOver: f.peakRoadDepthM, time: times[k], lat: Number.isFinite(f.lat) ? f.lat : null,
        lon: Number.isFinite(f.lon) ? f.lon : null, deck: f.deck === true,
      };
    }
    if (!best) { routeStatus[id] = 'No usable high-resolution road values.'; continue; }
    routes[id] = { ...best, level: levelFor(best.maxOver), cells: r.mappedStations,
      source: 'high_resolution', case: expectedCase, runId: summary.runId, issuedAt: summary.issuedAt,
      validTo: summary.validTo, coverage: complete ? 'complete' : 'partial', totalStations: count,
      minimumValidStations: minimumValid, stationMethod: 'native model cells and lidar road heights',
      limitations: summary.limits || '', };
    routeStatus[id] = complete ? 'Current high-resolution forecast.' : 'High-resolution road coverage is incomplete.';
  }
  return { status: Object.keys(routes).length ? 'ok' : 'unavailable', runId: summary.runId,
    issuedAt: summary.issuedAt, times, routes, routeStatus, reason: Object.keys(routes).length ? '' : 'No usable high-resolution road coverage.' };
}

// Prefer the owning high-resolution case per route. Incomplete coverage can add a wet indication,
// but it cannot erase a current coarse wet indication or turn unknown road sections into dry ones.
export function mergeRoadForecasts(coarse, cases, now) {
  const routes = {}, routeStatus = {}, sources = {};
  for (const [name, ids] of Object.entries(ALL_ROUTE_CASES)) {
    const high = highResolutionRoadForecast(cases?.[name], name, now);
    sources[name] = { status: high.status, reason: high.reason, runId: high.runId, issuedAt: high.issuedAt };
    for (const id of ids) {
      const h = high.routes?.[id], c = coarse?.status === 'ok' && coarse.routes?.[id]?.cells > 0 ? coarse.routes[id] : null;
      const fallback = h ? high.routeStatus[id] : high.routeStatus?.[id] || high.reason;
      if (h && (h.coverage === 'complete' || h.maxOver > COVER_M) && !(h.coverage === 'partial' && c && c.maxOver > h.maxOver)) routes[id] = h;
      else if (c) routes[id] = { ...c, source: 'coarse_fallback', coverage: 'partial', runId: coarse.runId,
        issuedAt: coarse.issuedAt, fallbackReason: fallback, limitations: 'Only the coarse model area is covered.' };
      routeStatus[id] = routes[id] ? { status: 'ok', source: routes[id].source, reason: routes[id].fallbackReason || fallback }
        : { status: high.status === 'stale' ? 'stale' : 'unavailable', reason: fallback };
    }
  }
  const selected = Object.values(routes), runIds = [...new Set(selected.map((r) => r.runId).filter(Boolean))];
  const issued = selected.map((r) => r.issuedAt).filter((t) => Number.isFinite(Date.parse(t))).sort();
  return { forecastVersion: 2, status: selected.length ? 'ok' : 'unavailable', routes, routeStatus, sources,
    runId: runIds.join(','), issuedAt: issued[0] || null,
    reason: selected.length ? '' : 'No current model has usable road coverage. Live gauges and closures still apply.' };
}
