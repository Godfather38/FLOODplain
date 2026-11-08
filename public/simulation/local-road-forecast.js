// Neighborhood road comparisons from the brawley-avra-west SFINCS case (map only).
// These stations are local roads outside the three live route models. They never feed route
// ratings, texts or pushes: road-forecast.js, its ALL_ROUTE_CASES and mergeRoadForecasts are
// untouched. See docs/upgrade/LOCAL-ROAD-FORECAST.md for the file contract.
//
// The file is fetched from the same live-model location as the route summaries, with the same
// no-store fetch, 2-minute cache-busting and 3-hour freshness limit. A file that is missing, stale
// or malformed shows nothing on the map and an honest note; it is never read as "dry".
import { ALL_ROUTE_LIVE, LIVE_MAX_AGE_MS } from '../road-forecast.js?v=dev';

export const LOCAL_ROAD_CASE = 'brawley-avra-west';
export const LOCAL_ROAD_MODEL_VERSION = 'all-routes-brawley-avra-west-v1';
export const LOCAL_ROAD_URL = ALL_ROUTE_LIVE + LOCAL_ROAD_CASE + '/local-road-forecast.json';
export const LOCAL_ROAD_STATES = ['over', 'below', 'dry', 'no-road-height', 'no-cell'];
export const LOCAL_ROAD_FLAGS = { deckLidar: 1, deckApproach: 2, noTerrain: 4, structureUntagged: 8 };
const SUMMARY_KEYS = { over: 'over', below: 'below', dry: 'dry', 'no-road-height': 'noRoadHeight', 'no-cell': 'noCell' };
// A loose box around west Avra Valley and Brawley Wash: a station outside it is not from this case.
const BOX = { west: -111.75, east: -111.0, south: 31.9, north: 32.6 };

const num = (v) => typeof v === 'number' && Number.isFinite(v);
const numOrNull = (v) => v === null || num(v);
const isoZ = (v) => typeof v === 'string' && /Z$/.test(v) && Number.isFinite(Date.parse(v));

// One station, checked against its own state. Returns the station or null when it cannot be read.
// Nothing is filled in: a value the state needs that is missing makes the station unreadable.
export function readStation(s) {
  if (!s || typeof s !== 'object' || typeof s.id !== 'string' || !s.id || typeof s.road !== 'string') return null;
  if (!num(s.lon) || !num(s.lat) || s.lon < BOX.west || s.lon > BOX.east || s.lat < BOX.south || s.lat > BOX.north) return null;
  if (!LOCAL_ROAD_STATES.includes(s.state) || !Number.isInteger(s.flags) || s.flags < 0 || s.flags > 255) return null;
  for (const k of ['roadZ', 'cellSizeM', 'maxWse', 'maxOver']) if (!numOrNull(s[k])) return null;
  if (!(s.firstOverTime === null || isoZ(s.firstOverTime))) return null;
  if (s.cellSizeM !== null && !(s.cellSizeM > 0)) return null;
  const wet = s.state === 'over' || s.state === 'below';
  if (wet && (s.roadZ === null || s.cellSizeM === null || s.maxWse === null || s.maxOver === null)) return null;
  if (wet && Math.abs(s.maxWse - s.roadZ - s.maxOver) > 0.005) return null;
  if (s.state === 'over' && !(s.maxOver > 0 && s.firstOverTime)) return null;
  if (s.state === 'below' && !(s.maxOver <= 0 && s.firstOverTime === null)) return null;
  if (s.state === 'dry' && (s.roadZ === null || s.cellSizeM === null || s.maxWse !== null || s.maxOver !== null)) return null;
  if (s.state === 'no-road-height' && (s.roadZ !== null || !(s.flags & LOCAL_ROAD_FLAGS.noTerrain))) return null;
  if (s.state === 'no-cell' && (s.cellSizeM !== null || s.maxWse !== null || s.maxOver !== null)) return null;
  return {
    id: s.id, road: s.road, lon: s.lon, lat: s.lat, roadZ: s.roadZ, cellSizeM: s.cellSizeM,
    maxWse: s.maxWse, maxOver: s.maxOver, firstOverTime: s.firstOverTime, state: s.state, flags: s.flags,
  };
}

// The whole file. -> {status:'ok', runId, issuedAt, forecastStart, forecastEnd, stations, unreadable}
// or {status:'unavailable'|'stale', reason, stations: []}.
export function parseLocalRoadForecast(file, now = Date.now()) {
  const no = (status, reason) => ({ status, reason, stations: [] });
  if (!file || typeof file !== 'object') return no('unavailable', 'The neighborhood road comparison did not load.');
  if (file.schemaVersion !== 1 || file.kind !== 'floodplain-local-road-forecast' || file.case !== LOCAL_ROAD_CASE ||
      file.modelVersion !== LOCAL_ROAD_MODEL_VERSION || file.datum !== 'NAVD88 metres' ||
      file.roadHeights !== 'floodplain-road-heights-v1' || typeof file.runId !== 'string' || !file.runId) {
    return no('unavailable', 'The neighborhood road comparison file is not in the expected form.');
  }
  if (!isoZ(file.issuedAt) || !isoZ(file.forecastStart) || !isoZ(file.forecastEnd) || !Array.isArray(file.stations)) {
    return no('unavailable', 'The neighborhood road comparison is missing its times or stations.');
  }
  const issued = Date.parse(file.issuedAt), start = Date.parse(file.forecastStart), end = Date.parse(file.forecastEnd);
  if (end <= start) return no('unavailable', 'The neighborhood road comparison times are invalid.');
  if (issued > now + 5 * 60e3 || now - issued > LIVE_MAX_AGE_MS || now < start || now > end) {
    return no('stale', 'The neighborhood road comparison is not current.');
  }
  const s = file.summary, counts = { over: 0, below: 0, dry: 0, noRoadHeight: 0, noCell: 0 };
  if (!s || s.stations !== file.stations.length || Object.keys(counts).some((k) => !Number.isInteger(s[k]))) {
    return no('unavailable', 'The neighborhood road comparison summary is missing or does not match its stations.');
  }
  for (const raw of file.stations) if (SUMMARY_KEYS[raw?.state]) counts[SUMMARY_KEYS[raw.state]]++;
  if (Object.keys(counts).some((k) => counts[k] !== s[k])) {
    return no('unavailable', 'The neighborhood road comparison summary does not match its stations.');
  }
  const stations = [], seen = new Set();
  let unreadable = 0;
  for (const raw of file.stations) {
    const st = readStation(raw);
    if (!st || seen.has(st.id)) { unreadable++; continue; }
    seen.add(st.id); stations.push(st);
  }
  if (!stations.length) return no('unavailable', 'The neighborhood road comparison has no readable stations.');
  return { status: 'ok', runId: file.runId, issuedAt: file.issuedAt, forecastStart: file.forecastStart,
    forecastEnd: file.forecastEnd, stations, unreadable };
}

// A loaded comparison goes stale on screen as time passes: check it again whenever it is read.
export function localRoadsAt(f, now = Date.now()) {
  if (!f || f.status !== 'ok') return f;
  const issued = Date.parse(f.issuedAt);
  if (now - issued > LIVE_MAX_AGE_MS || now < Date.parse(f.forecastStart) || now > Date.parse(f.forecastEnd)) {
    return { status: 'stale', reason: 'The neighborhood road comparison is not current.', stations: [] };
  }
  return f;
}

export async function loadLocalRoadForecast({ now = Date.now(), fetchImpl = fetch } = {}) {
  try {
    const r = await fetchImpl(LOCAL_ROAD_URL + '?t=' + Math.floor(now / 120000), { cache: 'no-store', signal: AbortSignal.timeout(15000) });
    if (!r.ok) return { status: 'unavailable', reason: 'The neighborhood road comparison did not load.', stations: [] };
    return parseLocalRoadForecast(await r.json(), now);
  } catch {
    return { status: 'unavailable', reason: 'The neighborhood road comparison did not load.', stations: [] };
  }
}

// Plain wording. Feet first, metres in brackets, as elsewhere in the app.
const ft = (m) => m / 0.3048;
export function amountText(m) {
  const f = ft(Math.abs(m));
  return f < 0.05 ? 'less than 0.1 ft (0.03 m)' : `about ${f.toFixed(1)} ft (${Math.abs(m).toFixed(2)} m)`;
}
export function hourText(iso) {
  return new Date(iso).toLocaleString('en-US', { timeZone: 'America/Phoenix', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric' }) + ' MST';
}
export function stationLine(s) {
  if (s.state === 'over') return `Model: water ${amountText(s.maxOver)} above this road at its highest. Water first reaches above the road around ${hourText(s.firstOverTime)}.`;
  if (s.state === 'below') return `Model: water stays below this road. At its highest it is ${amountText(s.maxOver)} below the road.`;
  if (s.state === 'dry') return 'Model: no water here in this run.';
  if (s.state === 'no-road-height') return 'Model: no road height here, so the model water cannot be compared with this road.';
  return 'Model: this point is outside the model’s active cells, so there is no model water to compare.';
}
export function stationDetails(s) {
  const lines = [];
  if (num(s.roadZ)) lines.push(`Road: ${(ft(s.roadZ)).toFixed(2)} ft NAVD88`);
  if (num(s.maxWse)) lines.push(`Highest model water: ${(ft(s.maxWse)).toFixed(2)} ft NAVD88`);
  if (num(s.cellSizeM)) lines.push(`Model cell: ${s.cellSizeM < 10 ? s.cellSizeM.toFixed(2) : Math.round(s.cellSizeM)} m`);
  if (s.flags & (LOCAL_ROAD_FLAGS.deckLidar | LOCAL_ROAD_FLAGS.deckApproach | LOCAL_ROAD_FLAGS.structureUntagged)) {
    lines.push('Near a bridge or culvert: the height is from lidar, not a surveyed deck.');
  }
  return lines;
}
export const LOCAL_ROAD_METHOD = 'Neighborhood roads, west Avra Valley and Brawley Wash. Compares the model’s water-surface height in the road’s cell with the road height from bare-earth lidar, not a surveyed road or bridge deck. Shown on the map only; not part of the route scores.';

export function nearestLocalStation(forecast, point, radiusM = 25) {
  let best = null, metres = radiusM;
  for (const s of forecast?.status === 'ok' ? forecast.stations : []) {
    const d = Math.hypot((s.lat - point.lat) * 110574, (s.lon - point.lon) * 111320 * Math.cos(point.lat * Math.PI / 180));
    if (d < metres) { best = s; metres = d; }
  }
  return best;
}

// One sentence for the map's list of model sources.
export function localRoadStatusText(f) {
  if (!f) return 'Neighborhood roads (west Avra Valley): loading.';
  if (f.status !== 'ok') return `Neighborhood roads (west Avra Valley): not shown. ${f.reason}`;
  const over = f.stations.filter((s) => s.state === 'over').length;
  return `Neighborhood roads (west Avra Valley): ${over ? `model water above ${over} of ${f.stations.length} road points` : `no model water above any of ${f.stations.length} road points`} in the run issued ${new Date(f.issuedAt).toLocaleString('en-US', { timeZone: 'America/Phoenix', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} MST. Map only.`;
}
