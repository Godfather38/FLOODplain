// Neighborhood road comparisons from the brawley-avra-west SFINCS case (map only).
// These stations are local roads outside the three live route models. They never feed route
// ratings, texts or pushes: road-forecast.js, its ALL_ROUTE_CASES and mergeRoadForecasts are
// untouched. See docs/upgrade/LOCAL-ROAD-FORECAST.md for the file contract (v2).
//
// Two files:
// - the static station list (public/data/local-roads/brawley-avra-west-stations.json) ships with
//   the app and is fetched once with normal caching (the service worker keeps it offline: sw.js
//   keeps it through the startup-file cleanup);
// - the live local-road-forecast.json lists only stations that are not plain dry, indexed into the
//   static list and pinned to it by its sha256 (stationsSha256). It is fetched from the same
//   live-model location, with the same no-store fetch, 2-minute cadence and 3-hour freshness limit
//   as the route summaries. When its run has not changed, the loaded comparison is kept as is.
// A file that is missing, stale, malformed or computed for another station list shows nothing on
// the map and an honest note; it is never read as "dry".
import { ALL_ROUTE_LIVE, LIVE_MAX_AGE_MS } from '../road-forecast.js?v=dev';

export const LOCAL_ROAD_CASE = 'brawley-avra-west';
export const LOCAL_ROAD_MODEL_VERSION = 'all-routes-brawley-avra-west-v1';
export const LOCAL_ROAD_URL = ALL_ROUTE_LIVE + LOCAL_ROAD_CASE + '/local-road-forecast.json';
export const LOCAL_ROAD_STATIONS_URL = new URL('../data/local-roads/brawley-avra-west-stations.json', import.meta.url).href;
export const LOCAL_ROAD_STATES = ['over', 'below', 'dry', 'unknown', 'no-road-height', 'no-cell'];
// Live list state codes, in the exporter's order (export_road_forecast.LIVE_STATES).
export const LOCAL_ROAD_LIVE_STATES = ['over', 'below', 'unknown', 'no-cell'];
export const LOCAL_ROAD_FLAGS = { deckLidar: 1, deckApproach: 2, noTerrain: 4, structureUntagged: 8 };
export const LOCAL_ROAD_PARTIAL_NOTE = 'Partial model run: some forecast hours are unavailable.';
const SUMMARY_KEYS = { over: 'over', below: 'below', dry: 'dry', unknown: 'unknown', 'no-road-height': 'noRoadHeight', 'no-cell': 'noCell' };
const LISTED_KEYS = ['index', 'state', 'maxWseCm', 'maxOverCm', 'firstOverMin', 'cellSizeM', 'unknownFrames'];
// A loose box around west Avra Valley and Brawley Wash: a station outside it is not from this case.
const BOX = { west: -111.75, east: -111.0, south: 31.9, north: 32.6 };

const num = (v) => typeof v === 'number' && Number.isFinite(v);
const int = (v) => Number.isInteger(v);
const isoZ = (v) => typeof v === 'string' && /Z$/.test(v) && Number.isFinite(Date.parse(v));
const NOT_LOADED = 'The neighborhood road comparison did not load.';

async function sha256Hex(bytes) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(d, (b) => b.toString(16).padStart(2, '0')).join('');
}

// The static station list. -> {status:'ok', sha256, version, stations:[{index,id,road,lon,lat,roadZ,roadZCm,flags,noHeight}], noHeight}
// or {status:'unavailable', reason}. Running sums decode the per-station deltas (see the contract).
export function parseLocalRoadStations(data, sha256) {
  const no = (reason) => ({ status: 'unavailable', reason, stations: [] });
  if (!data || typeof data !== 'object' || data.schemaVersion !== 1 || data.kind !== 'floodplain-local-road-station-geometry' ||
      data.case !== LOCAL_ROAD_CASE || data.roadHeights !== 'floodplain-road-heights-v1' || typeof sha256 !== 'string' ||
      !/^[0-9a-f]{64}$/.test(sha256) || typeof data.version !== 'string') {
    return no('The neighborhood road station list is not in the expected form.');
  }
  const n = data.stationCount, cols = data.stations, lines = data.lines, roads = data.roads;
  if (!int(n) || n < 1 || !cols || !lines || !Array.isArray(roads) || !roads.every((r) => typeof r === 'string') ||
      ['dDm', 'dLonE6', 'dLatE6', 'dZCm'].some((k) => !Array.isArray(cols[k]) || cols[k].length !== n) ||
      !Array.isArray(lines.id) || !Array.isArray(lines.road) || !Array.isArray(lines.start) ||
      lines.id.length !== lines.road.length || lines.id.length !== lines.start.length || !lines.id.length ||
      !Array.isArray(data.flags?.index) || !Array.isArray(data.flags?.value) || data.flags.index.length !== data.flags.value.length) {
    return no('The neighborhood road station list is not in the expected form.');
  }
  const flags = new Map();
  for (let k = 0; k < data.flags.index.length; k++) {
    const i = data.flags.index[k], v = data.flags.value[k];
    if (!int(i) || i < 0 || i >= n || !int(v) || v < 0 || v > 255 || flags.has(i)) return no('The neighborhood road station list has invalid flags.');
    flags.set(i, v);
  }
  const stations = new Array(n);
  let dm = 0, lon = 0, lat = 0, z = 0, noHeight = 0;
  for (let k = 0; k < lines.id.length; k++) {
    const a = lines.start[k], b = k + 1 < lines.start.length ? lines.start[k + 1] : n, road = roads[lines.road[k]];
    if (!int(a) || (k === 0 && a !== 0) || !(b > a) || b > n || typeof lines.id[k] !== 'string' || !lines.id[k] || road === undefined) {
      return no('The neighborhood road station list has invalid lines.');
    }
    for (let i = a; i < b; i++) {
      const dz = cols.dZCm[i];
      if (!int(cols.dDm[i]) || !int(cols.dLonE6[i]) || !int(cols.dLatE6[i]) || !(dz === null || int(dz))) {
        return no('The neighborhood road station list has invalid values.');
      }
      dm += cols.dDm[i]; lon += cols.dLonE6[i]; lat += cols.dLatE6[i];
      let roadZCm = null;
      if (dz !== null) { z += dz; roadZCm = z; } else noHeight++;
      const s = { index: i, id: lines.id[k] + ':' + dm, road, lon: lon / 1e6, lat: lat / 1e6, roadZCm,
        roadZ: roadZCm === null ? null : roadZCm / 100, flags: flags.get(i) ?? 0, noHeight: roadZCm === null };
      if (dm < 0 || s.lon < BOX.west || s.lon > BOX.east || s.lat < BOX.south || s.lat > BOX.north) {
        return no('The neighborhood road station list has a point outside this model area.');
      }
      stations[i] = s;
    }
  }
  return { status: 'ok', sha256, version: data.version, stations, noHeight };
}

let stationsPromise = null;
// Fetched once with normal HTTP caching (and kept by the service worker); a failure is retried next time.
export function loadLocalRoadStations({ fetchImpl = fetch, url = LOCAL_ROAD_STATIONS_URL } = {}) {
  if (stationsPromise) return stationsPromise;
  const p = (async () => {
    const r = await fetchImpl(url, { signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw Error('HTTP ' + r.status);
    const bytes = new Uint8Array(await r.arrayBuffer());
    return parseLocalRoadStations(JSON.parse(new TextDecoder().decode(bytes)), await sha256Hex(bytes));
  })().catch(() => ({ status: 'unavailable', reason: 'The neighborhood road station list did not load.', stations: [] }));
  stationsPromise = p.then((s) => { if (s.status !== 'ok') stationsPromise = null; return s; });
  return stationsPromise;
}
export function resetLocalRoadStations() { stationsPromise = null; }

// One live list entry against its static station. Returns the merged station or null when the
// values contradict the state (that station is then unreadable: counted, not drawn, never dry).
// The same rules as the publish verifier (tools/live/verify_all_route_package.local_entry_problem);
// both are tested against test/fixtures/local-road-contract-cases.json.
function readEntry(st, state, wse, over, first, cell, unknownFrames, windowMin, frames, start) {
  const cellOk = num(cell) && cell > 0;
  if (state === 'over' || state === 'below') {
    if (!int(wse) || !int(over) || over !== wse - st.roadZCm || !cellOk) return null;
    if (state === 'over' && !(over >= 1 && int(first) && first >= 0 && first <= windowMin &&
        int(unknownFrames) && unknownFrames >= 0 && unknownFrames < frames)) return null;
    // A frame without a valid reading could have had water over the road: a firm below needs none.
    if (state === 'below' && !(over <= 0 && first === null && unknownFrames === 0)) return null;
  } else if (state === 'unknown') {
    if (wse !== null || over !== null || first !== null || !cellOk ||
        !(int(unknownFrames) && unknownFrames >= 1 && unknownFrames <= frames)) return null;
  } else if (wse !== null || over !== null || first !== null || cell !== null || unknownFrames !== null) return null; // no-cell
  return { ...st, state, maxWse: int(wse) ? wse / 100 : null, maxOver: int(over) ? over / 100 : null,
    firstOverTime: int(first) ? new Date(start + first * 60e3).toISOString() : null,
    cellSizeM: cellOk ? cell : null, unknownFrames: state === 'over' || state === 'unknown' ? unknownFrames : null };
}
const blank = { maxWse: null, maxOver: null, firstOverTime: null, cellSizeM: null, unknownFrames: null };

// The live file against the static list.
// -> {status:'ok', partial, runId, issuedAt, forecastStart, forecastEnd, frames, stationsSha256, stations,
//     unreadable (count), unreadableStations (state 'unreadable': not drawn, but a tap there says so)}
// or {status:'unavailable'|'stale'|'mismatch', reason, stations: []}.
export function parseLocalRoadForecast(file, stationSet, now = Date.now()) {
  const no = (status, reason) => ({ status, reason, stations: [] });
  if (!file || typeof file !== 'object') return no('unavailable', NOT_LOADED);
  if (file.schemaVersion !== 2 || file.kind !== 'floodplain-local-road-forecast' || file.case !== LOCAL_ROAD_CASE ||
      file.modelVersion !== LOCAL_ROAD_MODEL_VERSION || file.datum !== 'NAVD88 metres' ||
      file.roadHeights !== 'floodplain-road-heights-v1' || typeof file.runId !== 'string' || !file.runId ||
      !['ok', 'partial'].includes(file.status) || typeof file.stationsSha256 !== 'string') {
    return no('unavailable', 'The neighborhood road comparison file is not in the expected form.');
  }
  if (!isoZ(file.issuedAt) || !isoZ(file.forecastStart) || !isoZ(file.forecastEnd)) {
    return no('unavailable', 'The neighborhood road comparison is missing its times.');
  }
  const issued = Date.parse(file.issuedAt), start = Date.parse(file.forecastStart), end = Date.parse(file.forecastEnd);
  if (end <= start || !int(file.frames) || file.frames < 1) return no('unavailable', 'The neighborhood road comparison times are invalid.');
  if (!stationSet || stationSet.status !== 'ok') return no('unavailable', stationSet?.reason || 'The neighborhood road station list did not load.');
  if (file.stationsSha256 !== stationSet.sha256 || file.stationCount !== stationSet.stations.length) {
    return no('mismatch', 'This run was computed for a different neighborhood road list than this version of the app has, so it is not shown. Reloading the app may fix this.');
  }
  if (issued > now + 5 * 60e3 || now - issued > LIVE_MAX_AGE_MS || now < start || now > end) {
    return no('stale', 'The neighborhood road comparison is not current.');
  }
  const L = file.listed, n = stationSet.stations.length, codes = file.stateCodes;
  const malformed = () => no('unavailable', 'The neighborhood road comparison list is malformed.');
  if (!Array.isArray(codes) || codes.join() !== LOCAL_ROAD_LIVE_STATES.join() || !L ||
      LISTED_KEYS.some((k) => !Array.isArray(L[k]) || L[k].length !== L.index.length)) return malformed();
  const counts = { over: 0, below: 0, dry: 0, unknown: 0, noRoadHeight: stationSet.noHeight, noCell: 0 };
  let prev = -1;
  for (let k = 0; k < L.index.length; k++) {
    const i = L.index[k], state = LOCAL_ROAD_LIVE_STATES[L.state[k]];
    if (!int(i) || i <= prev || i >= n || !int(L.state[k]) || !state || stationSet.stations[i].noHeight) return malformed();
    prev = i; counts[SUMMARY_KEYS[state]]++;
  }
  counts.dry = n - counts.over - counts.below - counts.unknown - counts.noRoadHeight - counts.noCell;
  const s = file.summary;
  if (!s || s.stations !== n || Object.keys(counts).some((k) => s[k] !== counts[k])) {
    return no('unavailable', 'The neighborhood road comparison summary does not match its stations.');
  }
  const windowMin = Math.round((end - start) / 60e3);
  const stations = [], unreadableStations = [];
  let k = 0;
  for (const st of stationSet.stations) {
    if (k < L.index.length && L.index[k] === st.index) {
      const e = readEntry(st, LOCAL_ROAD_LIVE_STATES[L.state[k]], L.maxWseCm[k], L.maxOverCm[k], L.firstOverMin[k],
        L.cellSizeM[k], L.unknownFrames[k], windowMin, file.frames, start);
      k++;
      if (e) stations.push(e); else unreadableStations.push({ ...st, state: 'unreadable', ...blank });
    } else if (st.noHeight) {
      stations.push({ ...st, state: 'no-road-height', ...blank });
    } else {
      // Absent from the list, with a road height: known dry in every frame of the run.
      stations.push({ ...st, state: 'dry', ...blank });
    }
  }
  if (!stations.length) return no('unavailable', 'The neighborhood road comparison has no readable stations.');
  return { status: 'ok', partial: file.status === 'partial', runId: file.runId, issuedAt: file.issuedAt,
    forecastStart: file.forecastStart, forecastEnd: file.forecastEnd, frames: file.frames,
    stationsSha256: file.stationsSha256, stations, unreadable: unreadableStations.length, unreadableStations };
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

// previous: the comparison loaded last time. When the new file is the same run against the same
// station list, previous is returned unchanged (no rebuild, no redraw).
export async function loadLocalRoadForecast({ now = Date.now(), fetchImpl = fetch, previous = null } = {}) {
  try {
    const stationSet = await loadLocalRoadStations({ fetchImpl });
    const r = await fetchImpl(LOCAL_ROAD_URL + '?t=' + Math.floor(now / 120000), { cache: 'no-store', signal: AbortSignal.timeout(15000) });
    if (!r.ok) return { status: 'unavailable', reason: NOT_LOADED, stations: [] };
    const file = await r.json();
    if (previous?.status === 'ok' && file && previous.runId === file.runId && previous.issuedAt === file.issuedAt &&
        previous.stationsSha256 === file.stationsSha256 && stationSet.status === 'ok' && previous.stationsSha256 === stationSet.sha256 &&
        previous.partial === (file.status === 'partial')) {
      return localRoadsAt(previous, now);
    }
    return parseLocalRoadForecast(file, stationSet, now);
  } catch {
    return { status: 'unavailable', reason: NOT_LOADED, stations: [] };
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
export const LOCAL_ROAD_SOME_MISSING = 'Some model hours are missing for this point, so the water may have been higher.';
export function stationLine(s, partial = false) {
  if (s.state === 'over') return `Model: water ${amountText(s.maxOver)} above this road at its highest. Water first reaches above the road around ${hourText(s.firstOverTime)}.` + (int(s.unknownFrames) && s.unknownFrames >= 1 ? ' ' + LOCAL_ROAD_SOME_MISSING : '');
  if (s.state === 'below') return `Model: water stays below this road. At its highest it is ${amountText(s.maxOver)} below the road.`;
  if (s.state === 'dry') return partial ? 'Model: no water here in the hours this partial run covers.' : 'Model: no water here in this run.';
  if (s.state === 'unknown') return 'Model: unknown here. Some model readings are missing for this point, so it is not shown as dry.';
  if (s.state === 'unreadable') return 'Model: the model values for this point could not be read, so nothing is shown for it.';
  if (s.state === 'no-road-height') return 'Model: no road height here, so the model water cannot be compared with this road.';
  return 'Model: this point is outside the model’s active cells, so there is no model water to compare.';
}
export function stationDetails(s, frames = null) {
  const lines = [];
  if (num(s.roadZ)) lines.push(`Road: ${(ft(s.roadZ)).toFixed(2)} ft NAVD88`);
  if (num(s.maxWse)) lines.push(`Highest model water: ${(ft(s.maxWse)).toFixed(2)} ft NAVD88`);
  if (num(s.cellSizeM)) lines.push(`Model cell: ${s.cellSizeM < 10 ? s.cellSizeM.toFixed(2) : Math.round(s.cellSizeM)} m`);
  if ((s.state === 'unknown' || s.state === 'over') && int(s.unknownFrames) && s.unknownFrames >= 1) lines.push(`Missing model readings: ${s.unknownFrames}${int(frames) ? ` of ${frames}` : ''} model times.`);
  if (s.flags & (LOCAL_ROAD_FLAGS.deckLidar | LOCAL_ROAD_FLAGS.deckApproach | LOCAL_ROAD_FLAGS.structureUntagged)) {
    lines.push('Near a bridge or culvert: the height is from lidar, not a surveyed deck.');
  }
  return lines;
}
export const LOCAL_ROAD_METHOD = 'Neighborhood roads, west Avra Valley and Brawley Wash. Compares the model’s water-surface height in the road’s cell with the road height from bare-earth lidar, not a surveyed road or bridge deck. Shown on the map only; not part of the route scores.';

// An unreadable station is a candidate too, so a tap on it says it could not be read instead of
// falling through to a neighbouring (possibly dry) station.
export function nearestLocalStation(forecast, point, radiusM = 25) {
  let best = null, metres = radiusM;
  const ok = forecast?.status === 'ok';
  for (const s of ok ? [...forecast.stations, ...(forecast.unreadableStations || [])] : []) {
    const d = Math.hypot((s.lat - point.lat) * 110574, (s.lon - point.lon) * 111320 * Math.cos(point.lat * Math.PI / 180));
    if (d < metres) { best = s; metres = d; }
  }
  return best;
}

// One sentence (two for a partial run) for the map's list of model sources. Unreadable stations are
// counted in the total and named, never left out silently.
export function localRoadStatusText(f) {
  if (!f) return 'Neighborhood roads (west Avra Valley): loading.';
  if (f.status !== 'ok') return `Neighborhood roads (west Avra Valley): not shown. ${f.reason}`;
  let over = 0, unknown = 0;
  for (const s of f.stations) { if (s.state === 'over') over++; else if (s.state === 'unknown') unknown++; }
  const bad = int(f.unreadable) ? f.unreadable : 0, total = f.stations.length + bad;
  const water = over ? `model water above ${over} of ${total} road points` : `no model water above any of ${total} road points`;
  const unk = (unknown ? `; ${unknown} unknown (missing model readings)` : '') +
    (bad ? `; ${bad} road point${bad === 1 ? '' : 's'} could not be read` : '');
  const when = new Date(f.issuedAt).toLocaleString('en-US', { timeZone: 'America/Phoenix', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  return `Neighborhood roads (west Avra Valley): ${water}${unk} in the run issued ${when} MST. ${f.partial ? LOCAL_ROAD_PARTIAL_NOTE + ' ' : ''}Map only.`;
}
