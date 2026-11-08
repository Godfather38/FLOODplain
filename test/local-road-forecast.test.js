// Neighborhood road comparisons (brawley-avra-west): parsing, validation, states and wording.
// Map only: these never reach route ratings, texts or pushes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseLocalRoadForecast, readStation, localRoadsAt, loadLocalRoadForecast, stationLine, stationDetails,
  nearestLocalStation, localRoadStatusText, LOCAL_ROAD_URL, LOCAL_ROAD_STATES, LOCAL_ROAD_METHOD,
} from '../public/simulation/local-road-forecast.js';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const sample = () => JSON.parse(read('./fixtures/local-road-forecast-sample.json'));
const NOW = Date.parse('2026-11-01T15:00:00Z');

test('the fixture follows the contract and covers every state', () => {
  const f = sample();
  assert.equal(f.stations.length, 20);
  assert.deepEqual([...new Set(f.stations.map((s) => s.state))].sort(), [...LOCAL_ROAD_STATES].sort());
  const r = parseLocalRoadForecast(f, NOW);
  assert.equal(r.status, 'ok');
  assert.equal(r.stations.length, 20);
  assert.equal(r.unreadable, 0);
  assert.equal(r.runId, f.runId);
});

test('the file is read from the live-model branch beside the case output', () => {
  assert.equal(LOCAL_ROAD_URL, 'https://raw.githubusercontent.com/Godfather38/FLOODplain/live-model/all-route/brawley-avra-west/local-road-forecast.json');
});

test('stale, future and out-of-window files show nothing', () => {
  assert.equal(parseLocalRoadForecast(sample(), Date.parse('2026-11-01T17:00:00Z')).status, 'stale'); // over 3 h old
  assert.equal(parseLocalRoadForecast(sample(), Date.parse('2026-11-01T13:55:00Z')).status, 'stale'); // before the window
  const late = sample(); late.issuedAt = '2026-11-02T06:00:00Z';
  assert.equal(parseLocalRoadForecast(late, Date.parse('2026-11-02T07:30:00Z')).status, 'stale'); // after the window
  const future = sample(); future.issuedAt = '2026-11-01T15:30:00Z';
  assert.equal(parseLocalRoadForecast(future, NOW).status, 'stale');
  for (const r of [parseLocalRoadForecast(sample(), Date.parse('2026-11-01T17:00:00Z'))]) assert.deepEqual(r.stations, []);
  // A loaded comparison goes stale on screen as time passes.
  const ok = parseLocalRoadForecast(sample(), NOW);
  assert.equal(localRoadsAt(ok, NOW).status, 'ok');
  assert.equal(localRoadsAt(ok, Date.parse('2026-11-01T17:00:00Z')).status, 'stale');
  assert.equal(localRoadsAt(null, NOW), null);
});

test('a malformed file shows nothing, and is never read as dry', () => {
  const cases = {
    missing: null,
    text: 'oops',
    schema: (f) => { f.schemaVersion = 2; },
    kind: (f) => { f.kind = 'live_all_route_road_forecast'; },
    case: (f) => { f.case = 'northern'; },
    modelVersion: (f) => { f.modelVersion = 'all-routes-v3'; },
    datum: (f) => { f.datum = 'feet'; },
    heights: (f) => { f.roadHeights = 'other'; },
    runId: (f) => { delete f.runId; },
    issued: (f) => { f.issuedAt = 'yesterday'; },
    notZ: (f) => { f.forecastEnd = '2026-11-02T07:00:00'; },
    order: (f) => { f.forecastEnd = f.forecastStart; },
    stations: (f) => { f.stations = {}; },
    noSummary: (f) => { delete f.summary; },
    summaryCount: (f) => { f.summary.over += 1; f.summary.dry -= 1; },
    summaryTotal: (f) => { f.stations.pop(); },
    allUnreadable: (f) => { for (const s of f.stations) s.lat = null; },
  };
  for (const [name, change] of Object.entries(cases)) {
    let f = sample();
    if (change === null) f = null; else if (typeof change === 'string') f = change; else change(f);
    const r = parseLocalRoadForecast(f, NOW);
    assert.equal(r.status, 'unavailable', name);
    assert.deepEqual(r.stations, [], name);
    assert.ok(r.reason, name);
  }
});

test('a station that contradicts its own state is dropped, not guessed', () => {
  const base = sample().stations;
  const by = (state) => structuredClone(base.find((s) => s.state === state));
  const bad = [
    Object.assign(by('over'), { maxOver: -0.1, maxWse: by('over').roadZ - 0.1 }),
    Object.assign(by('over'), { firstOverTime: null }),
    Object.assign(by('over'), { maxWse: null }),
    Object.assign(by('over'), { maxOver: 1 }), // does not equal maxWse - roadZ
    Object.assign(by('below'), { maxOver: 0.2, maxWse: by('below').roadZ + 0.2 }),
    Object.assign(by('below'), { roadZ: null }),
    Object.assign(by('dry'), { maxWse: 700 }),
    Object.assign(by('dry'), { roadZ: null }),
    Object.assign(by('no-road-height'), { roadZ: 700 }),
    Object.assign(by('no-road-height'), { flags: 0 }),
    Object.assign(by('no-cell'), { cellSizeM: 6.25 }),
    Object.assign(by('over'), { state: 'wet' }),
    Object.assign(by('over'), { lon: 0 }),
    Object.assign(by('over'), { flags: 1.5 }),
    Object.assign(by('over'), { roadZ: '712.4' }),
    Object.assign(by('over'), { id: '' }),
  ];
  for (const s of bad) assert.equal(readStation(s), null, JSON.stringify(s));
  for (const s of base) assert.ok(readStation(s), s.id);
  // One bad station is dropped and counted; the rest still show.
  const f = sample(); f.stations[0].maxWse = null;
  const r = parseLocalRoadForecast(f, NOW);
  assert.equal(r.status, 'ok');
  assert.equal(r.stations.length, 19);
  assert.equal(r.unreadable, 1);
  assert.ok(!r.stations.some((s) => s.id === f.stations[0].id));
  // A repeated id is not shown twice.
  const d = sample(); d.stations[1].id = d.stations[0].id;
  assert.equal(parseLocalRoadForecast(d, NOW).unreadable, 1);
});

test('plain wording for every state, feet first, never "safe"', () => {
  const r = parseLocalRoadForecast(sample(), NOW), by = (state) => r.stations.find((s) => s.state === state);
  assert.equal(stationLine(by('over')), 'Model: water about 1.0 ft (0.31 m) above this road at its highest. Water first reaches above the road around Sun, Nov 1, 2 PM MST.');
  assert.match(stationLine(by('below')), /^Model: water stays below this road\. At its highest it is about 1\.0 ft \(0\.30 m\) below the road\.$/);
  assert.equal(stationLine(by('dry')), 'Model: no water here in this run.');
  assert.match(stationLine(by('no-road-height')), /no road height here/);
  assert.match(stationLine(by('no-cell')), /outside the model’s active cells/);
  const tiny = { ...by('over'), maxOver: 0.01 };
  assert.match(stationLine(tiny), /^Model: water less than 0\.1 ft \(0\.03 m\) above this road/);
  assert.match(stationLine({ ...by('below'), maxOver: 0 }), /it is less than 0\.1 ft \(0\.03 m\) below the road/);
  for (const s of r.stations) {
    const text = [stationLine(s), ...stationDetails(s)].join(' ');
    assert.doesNotMatch(text, /\bsafe\b|undefined|NaN|null/i, s.id);
  }
  assert.deepEqual(stationDetails(by('over')), ['Road: 2337.34 ft NAVD88', 'Highest model water: 2338.35 ft NAVD88', 'Model cell: 6.25 m']);
  assert.match(stationDetails(r.stations.find((s) => s.flags & 1)).join(' '), /not a surveyed deck/);
  assert.match(LOCAL_ROAD_METHOD, /bare-earth lidar, not a surveyed road or bridge deck/);
  assert.match(LOCAL_ROAD_METHOD, /not part of the route scores/);
});

test('the map source line says plainly when the comparison is missing or stale', () => {
  assert.match(localRoadStatusText(null), /loading/);
  assert.match(localRoadStatusText(parseLocalRoadForecast(null, NOW)), /not shown\. The neighborhood road comparison did not load\./);
  assert.match(localRoadStatusText(parseLocalRoadForecast(sample(), Date.parse('2026-11-01T17:00:00Z'))), /not shown\. .*not current/);
  assert.match(localRoadStatusText(parseLocalRoadForecast(sample(), NOW)), /model water above 6 of 20 road points in the run issued Nov 1, 6:50 AM MST\. Map only\./);
});

test('nearest station search uses only a current comparison', () => {
  const r = parseLocalRoadForecast(sample(), NOW);
  const s = r.stations[2];
  assert.equal(nearestLocalStation(r, { lat: s.lat + 0.0001, lon: s.lon })?.id, s.id);
  assert.equal(nearestLocalStation(r, { lat: s.lat + 0.01, lon: s.lon }), null);
  assert.equal(nearestLocalStation(localRoadsAt(r, Date.parse('2026-11-01T17:00:00Z')), { lat: s.lat, lon: s.lon }), null);
});

test('loading uses no-store, a 2-minute cache-buster, and treats failures as unavailable', async () => {
  const calls = [];
  const ok = await loadLocalRoadForecast({ now: NOW, fetchImpl: async (url, opts) => { calls.push([url, opts.cache]); return { ok: true, json: async () => sample() }; } });
  assert.equal(ok.status, 'ok');
  assert.deepEqual(calls, [[LOCAL_ROAD_URL + '?t=' + Math.floor(NOW / 120000), 'no-store']]);
  const missing = await loadLocalRoadForecast({ now: NOW, fetchImpl: async () => ({ ok: false, status: 404 }) });
  assert.equal(missing.status, 'unavailable');
  const offline = await loadLocalRoadForecast({ now: NOW, fetchImpl: async () => { throw Error('offline'); } });
  assert.equal(offline.status, 'unavailable');
  const garbled = await loadLocalRoadForecast({ now: NOW, fetchImpl: async () => ({ ok: true, json: async () => { throw SyntaxError('bad'); } }) });
  assert.equal(garbled.status, 'unavailable');
});

test('neighborhood roads stay out of the route scores, alerts and the service bundle', () => {
  const rf = read('../public/road-forecast.js'), gas = read('../apps-script/Code.gs'), engine = read('../public/engine.js');
  for (const code of [rf, gas, engine]) assert.doesNotMatch(code, /brawley-avra-west|local-road-forecast/);
  assert.match(rf, /gates: \['pr-gates'\],\n\};/); // ALL_ROUTE_CASES unchanged
  const map = read('../public/map-app.js');
  assert.match(map, /from '\.\/simulation\/local-road-forecast\.js\?v=dev'/);
  assert.match(map, /localRoadStatusText\(localRoads\(\)\)/);
  const live = read('../public/simulation/live-road-forecast.js');
  assert.doesNotMatch(live, /local-road/);
});
