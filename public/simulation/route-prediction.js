// SFINCS flood prediction for whole routes, not just the listed crossings.
//
// Every road station on a route (one every 5 m, USGS 3DEP lidar road surface or bridge deck, from
// public/simulation/data/road-heights/) is compared with the SFINCS water surface of the model cell
// it sits in, for every frame of the run. Water surface minus road height is the predicted water
// over the road. A cell with less than 0.03 ft of water is dry there: its stored surface is only
// the cell's ground, so it counts as no water.
//
// This prediction feeds the route ratings whenever the run's forecast covers the current time
// (see docs/SFINCS-ROUTE-PREDICTION.md). It is a model forecast, worded as one on screen.
// It only raises a route's rating: a dry prediction never lowers a closure or a gauge reading.

// One set of thresholds for the app and the alert service (road-forecast.js).
import { WET_M, COVER_M, DEEP_M, levelFor, roadForecastPoint } from '../road-forecast.js?v=dev';
export { WET_M, COVER_M, DEEP_M, levelFor, roadForecastPoint };
export const NEAR_M = 0.3;       // water within 1 ft below the road is listed as near it
const FT = 3.28084;
export const ft = (m) => m * FT;

// Water over the road at one station, for every frame. -Infinity: dry cell. NaN: no model value.
// capAtDepth (100 m cells): a road below the cell's average ground would read the cell's whole
// height difference as water over the road as soon as the cell is barely wet. There the estimate is
// the cell's own water depth instead: min(surface - road, surface - ground). road-forecast.js does
// the same, so the app and the alerts agree.
function overSeries(surface, depth, roadM, capAtDepth = false) {
  return surface.map((z, k) => {
    const d = depth[k];
    if (Number.isFinite(d) && d < WET_M) return -Infinity;
    if (!Number.isFinite(z)) return NaN;
    return capAtDepth && Number.isFinite(d) ? Math.min(z - roadM, d) : z - roadM;
  });
}

// Road stations on each route, in order along the road: [{routeId, samples:[{lon,lat,stationM,roadM,deck}]}].
export function routeStations(lines, routeIds = null) {
  const out = new Map();
  for (const l of lines) {
    if (l.kind !== 'route' || !l.routeId || (routeIds && !routeIds.includes(l.routeId))) continue;
    const list = out.get(l.routeId) ?? [];
    for (const s of l.stations) if (s.elevationM != null) list.push({ lon: s.lon, lat: s.lat, stationM: s.stationM, roadM: s.elevationM, deck: !!(s.flags & 1) });
    out.set(l.routeId, list);
  }
  return out;
}

// A 100 m grid run (the live hourly run and the saved coarse runs, simulation/sim-2d.js):
// run.times (ms), run.surface[frame][cell], run.depth[frame][cell]; cellOf(lon, lat) -> cell or -1.
export function predictFromGrid(run, stations, cellOf) {
  const routes = {};
  for (const [routeId, list] of stations) {
    const samples = [];
    let outside = 0;
    for (const s of list) {
      const cell = cellOf(s.lon, s.lat);
      if (cell < 0) { outside++; continue; }
      samples.push({ ...s, cell, over: overSeries(run.surface.map((f) => f[cell]), run.depth.map((f) => f[cell]), s.roadM, true) });
    }
    routes[routeId] = { routeId, samples, stations: list.length, outside };
  }
  return { times: run.times.slice(), routes, cellM: 100 };
}

// The all-route run (simulation/all-route-run.js, 6.25 m cells on the road): its route points are
// the low points along every route. Each point takes the road station of its own route within 25 m.
// pointsJson is data/all-route-13z/route-points.json; pkg its package.json.
export function predictFromAllRoute(pkg, pointsJson, stations, times) {
  const iso = times.map((t) => new Date(t).toISOString().replace('.000Z', 'Z'));
  const routes = {};
  for (const [routeId, list] of stations) {
    const c = pkg.cases.find((x) => x.routes.includes(routeId));
    const caseData = c && pointsJson.cases[c.key];
    const samples = [];
    let outside = 0;
    if (!caseData) { routes[routeId] = { routeId, samples, stations: list.length, outside: list.length }; continue; }
    const at = new Map(caseData.times.map((t, k) => [t, k]));
    for (const p of c.routePoints.filter((x) => x.routes.includes(routeId))) {
      const series = caseData.points[p.id];
      const road = nearest(list, p, 25);
      if (!series || !road) { outside++; continue; }
      const z = iso.map((t) => { const k = at.get(t); return k == null || series.zs[k] == null ? NaN : series.zs[k]; });
      const d = iso.map((t) => { const k = at.get(t); return k == null || series.depth[k] == null ? NaN : series.depth[k]; });
      samples.push({ lon: p.lon, lat: p.lat, stationM: road.stationM, roadM: road.roadM, deck: road.deck, over: overSeries(z, d, road.roadM) });
    }
    samples.sort((a, b) => a.stationM - b.stationM);
    routes[routeId] = { routeId, samples, stations: list.length, outside, lowPoints: true };
  }
  return { times: times.slice(), routes, cellM: 6.25 };
}
const metres = (a, b) => Math.hypot((a.lat - b.lat) * 110574, (a.lon - b.lon) * 111320 * Math.cos(a.lat * Math.PI / 180));
function nearest(list, p, reach) {
  let best = null, bestD = reach;
  for (const s of list) { const d = metres(s, p); if (d < bestD) { bestD = d; best = s; } }
  return best;
}

// One frame of one route: the stretches with water over the road, the deepest point and how much
// road is under water. Neighbouring stations within 30 m join one stretch.
export function routeAtFrame(route, k) {
  const wet = route.samples.filter((s) => s.over[k] > COVER_M);
  const near = route.samples.filter((s) => s.over[k] > -NEAR_M && !(s.over[k] > COVER_M)).length;
  const known = route.samples.filter((s) => !Number.isNaN(s.over[k])).length;
  const stretches = [];
  for (const s of wet) {
    const last = stretches.at(-1);
    if (last && s.stationM - last.toM <= 30) { last.toM = s.stationM; if (s.over[k] > last.maxOver) Object.assign(last, { maxOver: s.over[k], lat: s.lat, lon: s.lon, deck: s.deck }); last.count++; }
    else stretches.push({ fromM: s.stationM, toM: s.stationM, maxOver: s.over[k], lat: s.lat, lon: s.lon, deck: s.deck, count: 1 });
  }
  const maxOver = route.samples.reduce((m, s) => (s.over[k] > m ? s.over[k] : m), -Infinity);
  return { maxOver, stretches: stretches.sort((a, b) => b.maxOver - a.maxOver), wetCount: wet.length, near, known };
}


// The forecast still ahead for one route: from the frame holding `now` to the end of the run.
// status 'current' when the run covers now, otherwise 'not_current' with the reason.
export function routeOutlook(pred, routeId, now) {
  const route = pred?.routes?.[routeId];
  if (!route) return { status: 'no_route', reason: 'This route has no road heights in the model area.' };
  if (!route.samples.length) return { status: 'outside', reason: 'This route is outside the model area.' };
  const t = pred.times, step = t.length > 1 ? t[1] - t[0] : 3600e3;
  if (now < t[0] - step || now > t.at(-1) + step) return { status: 'not_current', reason: 'The model run does not cover the current time.', route };
  let from = 0;
  while (from + 1 < t.length && t[from + 1] <= now) from++;
  let peak = null;
  for (let k = from; k < t.length; k++) {
    const f = routeAtFrame(route, k);
    if (!peak || f.maxOver > peak.maxOver) peak = { ...f, time: t[k], index: k };
  }
  const nowFrame = routeAtFrame(route, from);
  return { status: 'current', level: levelFor(peak.maxOver), peak, now: { ...nowFrame, time: t[from] }, route, from, end: t.at(-1) };
}

const azTime = (ms) => new Date(ms).toLocaleString('en-US', { timeZone: 'America/Phoenix', weekday: 'short', hour: 'numeric', minute: '2-digit' });
const feet = (m) => `${ft(m).toFixed(1)} ft`;
const lengthText = (s) => { const l = s.toM - s.fromM + 5; return l >= 160 ? `${(l / 1609.34).toFixed(1)} mi` : `${Math.round(l * FT)} ft`; };

// The plain sentence for a route outlook.
export function outlookWhy(o, issuedAt) {
  const issued = issuedAt ? ` Run issued ${azTime(Date.parse(issuedAt))} Arizona time.` : '';
  const what = o.route.lowPoints ? 'low points along this road' : 'road stations along this road';
  const checked = `${o.route.samples.length.toLocaleString('en-US')} ${what} compared with lidar road heights${o.route.outside ? `; ${o.route.outside.toLocaleString('en-US')} outside the model area` : ''}.`;
  if (!o.peak.stretches.length) {
    const near = o.peak.near ? ` Water comes within 1 ft of the road at ${o.peak.near} of them.` : '';
    return `SFINCS model forecast: no water over this road through ${azTime(o.end)}.${near} ${checked}${issued}`;
  }
  const s = o.peak.stretches[0], more = o.peak.stretches.length - 1;
  const where = o.route.lowPoints ? '' : `, along about ${lengthText(s)}`;
  const others = more > 0 ? `; ${more} more ${o.route.lowPoints ? 'low point' : 'stretch'}${more > 1 ? (o.route.lowPoints ? 's' : 'es') : ''} with water over the road` : '';
  return `SFINCS model forecast: ${feet(s.maxOver)} of water over the ${s.deck ? 'bridge deck' : 'road'} at its deepest, ${azTime(o.peak.time)}${where}${others}. ${checked}${issued}`;
}

// A row for the route's rating, shaped like the county barricade rows in logic.js.
export function predictionPoint(routeId, o, issuedAt) {
  const s = o.peak.stretches[0];
  const why = outlookWhy(o, issuedAt);
  return {
    id: `sfincs-${routeId}`, short: 'Flood model along this road (SFINCS)', name: 'SFINCS road flood forecast', where: 'Along this route',
    kind: 'road', lat: s?.lat ?? null, lon: s?.lon ?? null, level: o.level, why, evidenceAvailable: true, closurePts: [], routeBarricade: true, sfincs: o,
    checks: [{ src: 'sfincs', level: o.level, why }],
  };
}

// ---------------- loading (browser) ----------------
// The hourly live run from the live-model branch, on the shared 100 m grid, against the road heights.
const DATA = new URL('./data/', import.meta.url);
const GRID = { x0: 467700, y0: 3572300 };
async function bytesOf(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${String(url).split('/').pop().split('?')[0]} answered ${r.status}`);
  const b = new Uint8Array(await r.arrayBuffer());
  return b[0] === 0x1f && b[1] === 0x8b ? new Uint8Array(await new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()) : b;
}
const jsonOf = async (url) => JSON.parse(new TextDecoder().decode(await bytesOf(url)));
let linesPromise = null;
export function loadRoadLines() {
  linesPromise ??= Promise.all([bytesOf(new URL('road-heights/routes.bin.gz', DATA)), import('../preview/geo3d/src/road-package.js?v=dev')])
    .then(([b, m]) => m.decodeRoadHeights(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)).lines);
  linesPromise.catch(() => { linesPromise = null; });
  return linesPromise;
}
let gridPromise = null;
function loadGrid() {
  gridPromise ??= jsonOf(new URL('frozen-terrain-display.json.gz', DATA)).then((d) => {
    const index = new Map(), bed = new Float32Array(d.vertices.length);
    d.vertices.forEach((v, i) => { bed[i] = v[2]; index.set(Math.floor(v[0] / 100) * 1000 + Math.floor(v[1] / 100), i); });
    return { index, bed };
  });
  gridPromise.catch(() => { gridPromise = null; });
  return gridPromise;
}
export function gridCellOf(index, toUtm) {
  return (lon, lat) => { const u = toUtm(lon, lat); return index.get(Math.floor((u.e - GRID.x0) / 100) * 1000 + Math.floor((u.n - GRID.y0) / 100)) ?? -1; };
}
// -> {status:'ok', pred, manifest} or {status:'stale'|'unavailable', reason}
export async function loadLivePrediction(options = {}) {
  const { loadRoadForecasts } = await import('./live-road-forecast.js?v=dev');
  return loadRoadForecasts(options);
}
