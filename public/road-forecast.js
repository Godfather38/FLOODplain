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
    for (const [cell, roadM, bedM, lon, lat, deck] of table.routes[id]) {
      for (let k = from; k < water.frames.length; k++) {
        const z = water.frames[k].surfaceM[cell];
        if (z == null || !Number.isFinite(z) || z - bedM < WET_M) continue; // dry cell or no value
        // A road below the cell's average ground: the cell's own depth, not the height difference
        // (the same rule as simulation/route-prediction.js).
        const over = Math.min(z - roadM, z - bedM);
        if (over > best.maxOver) best = { maxOver: over, time: times[k], lat, lon, deck: !!deck };
      }
    }
    routes[id] = { ...best, level: levelFor(best.maxOver), cells: table.routes[id].length };
  }
  return { status: 'ok', issuedAt: manifest.issuedAt, runId: manifest.runId, times, routes };
}

// One rating row for a route, shaped like the county barricade rows in logic.js. The words are short
// because they go into texts. Only when the forecast covers now; it can raise a route, never lower it.
export function roadForecastPoint(id, r) {
  const hour = r.time == null ? '' : ` at ${new Date(r.time).toLocaleTimeString('en-US', { timeZone: 'America/Phoenix', hour: 'numeric', minute: '2-digit' })}`;
  const why = r.maxOver > COVER_M
    ? `SFINCS forecast: ${(r.maxOver * 3.28084).toFixed(1)} ft of water over the ${r.deck ? 'bridge deck' : 'road'}${hour}`
    : 'SFINCS forecast: no water over the road';
  return { id: `sfincs-${id}`, short: 'Flood model', name: 'SFINCS road flood forecast', where: 'Along this route', kind: 'road', lat: r.lat, lon: r.lon,
    level: r.level, why, evidenceAvailable: true, closurePts: [], routeBarricade: true, checks: [{ src: 'sfincs', level: r.level, why }] };
}
