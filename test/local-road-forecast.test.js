// Neighborhood road comparisons (brawley-avra-west), contract v2: static station list plus a live
// list of stations that are not plain dry. Parsing, validation, states and wording.
// Map only: these never reach route ratings, texts or pushes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  parseLocalRoadForecast, parseLocalRoadStations, localRoadsAt, loadLocalRoadForecast, loadLocalRoadStations,
  resetLocalRoadStations, stationLine, stationDetails, nearestLocalStation, localRoadStatusText, LOCAL_ROAD_URL,
  LOCAL_ROAD_STATIONS_URL, LOCAL_ROAD_STATES, LOCAL_ROAD_METHOD, LOCAL_ROAD_PARTIAL_NOTE, LOCAL_ROAD_SOME_MISSING,
} from '../public/simulation/local-road-forecast.js';

const raw = (p) => readFileSync(new URL(p, import.meta.url));
const read = (p) => raw(p).toString('utf8');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const STATIC = raw('./fixtures/local-road-stations-sample.json');
const stationSet = () => parseLocalRoadStations(JSON.parse(STATIC), sha(STATIC));
const sample = () => JSON.parse(read('./fixtures/local-road-forecast-sample.json'));
const parse = (f, now = NOW) => parseLocalRoadForecast(f, stationSet(), now);
const NOW = Date.parse('2026-11-01T15:00:00Z');

test('the static station list decodes ids, heights and flags', () => {
  const s = stationSet();
  assert.equal(s.status, 'ok');
  assert.equal(s.stations.length, 20);
  assert.equal(s.noHeight, 3);
  const first = s.stations[0];
  assert.deepEqual([first.id, first.road, first.lon, first.lat, first.roadZ, first.flags],
    ['area_m1113_322:14:1530', 'W Snyder Hill Rd', -111.2612, 32.2051, 712.42, 0]);
  assert.ok(s.stations.every((x, i) => x.index === i));
  assert.equal(new Set(s.stations.map((x) => x.id)).size, 20);
  for (const bad of [
    (d) => { d.kind = 'other'; }, (d) => { d.case = 'gates'; }, (d) => { d.stations.dDm.pop(); },
    (d) => { d.lines.start[0] = 1; }, (d) => { d.flags.index[0] = 99; }, (d) => { d.stations.dLonE6[0] = 0; },
    (d) => { d.stations.dZCm[0] = 1.5; },
  ]) {
    const d = JSON.parse(STATIC); bad(d);
    assert.equal(parseLocalRoadStations(d, sha(STATIC)).status, 'unavailable');
  }
  assert.equal(parseLocalRoadStations(JSON.parse(STATIC), 'nothex').status, 'unavailable');
});

test('the shipped station list is small, readable and matches its source counts', () => {
  const bytes = raw('../public/data/local-roads/brawley-avra-west-stations.json');
  assert.ok(bytes.length < 1_500_000, String(bytes.length));
  assert.ok(!bytes.includes(13), 'LF line endings');
  const s = parseLocalRoadStations(JSON.parse(bytes), sha(bytes));
  assert.equal(s.status, 'ok');
  assert.equal(s.stations.length, 58140);
  assert.equal(s.noHeight, 571);
  assert.equal(new Set(s.stations.map((x) => x.id)).size, 58140);
  assert.equal(statSync(new URL('../public/data/local-roads/brawley-avra-west-stations.json', import.meta.url)).size, bytes.length);
});

test('the fixture follows the contract and every state comes through', () => {
  const r = parse(sample());
  assert.equal(r.status, 'ok');
  assert.equal(r.partial, false);
  assert.equal(r.stations.length, 20);
  assert.equal(r.unreadable, 0);
  const counts = {};
  for (const s of r.stations) counts[s.state] = (counts[s.state] || 0) + 1;
  assert.deepEqual(counts, { over: 6, below: 4, dry: 3, unknown: 2, 'no-road-height': 3, 'no-cell': 2 });
  assert.deepEqual([...new Set(r.stations.map((s) => s.state))].sort(), [...LOCAL_ROAD_STATES].sort());
  const over = r.stations[0];
  assert.deepEqual([over.state, over.maxWse, over.maxOver, over.firstOverTime, over.cellSizeM],
    ['over', 712.73, 0.31, '2026-11-01T21:00:00.000Z', 6.25]);
});

test('the file is read from the live-model branch, the stations from the app', () => {
  assert.equal(LOCAL_ROAD_URL, 'https://raw.githubusercontent.com/Godfather38/FLOODplain/live-model/all-route/brawley-avra-west/local-road-forecast.json');
  assert.match(LOCAL_ROAD_STATIONS_URL, /\/public\/data\/local-roads\/brawley-avra-west-stations\.json$/);
});

test('a run computed for another station list shows nothing and says why, never dry', () => {
  const f = sample(); f.stationsSha256 = '0'.repeat(64);
  const r = parse(f);
  assert.equal(r.status, 'mismatch');
  assert.deepEqual(r.stations, []);
  assert.match(localRoadStatusText(r), /not shown\. This run was computed for a different neighborhood road list/);
  const g = sample(); g.stationCount = 21;
  assert.equal(parse(g).status, 'mismatch');
  assert.equal(parseLocalRoadForecast(sample(), null, NOW).status, 'unavailable');
});

test('stale, future and out-of-window files show nothing', () => {
  assert.equal(parse(sample(), Date.parse('2026-11-01T17:00:00Z')).status, 'stale'); // over 3 h old
  assert.equal(parse(sample(), Date.parse('2026-11-01T13:55:00Z')).status, 'stale'); // before the window
  const late = sample(); late.issuedAt = '2026-11-02T06:00:00Z';
  assert.equal(parse(late, Date.parse('2026-11-02T07:30:00Z')).status, 'stale'); // after the window
  const future = sample(); future.issuedAt = '2026-11-01T15:30:00Z';
  assert.equal(parse(future).status, 'stale');
  const ok = parse(sample());
  assert.equal(localRoadsAt(ok, NOW).status, 'ok');
  assert.equal(localRoadsAt(ok, Date.parse('2026-11-01T17:00:00Z')).status, 'stale');
  assert.equal(localRoadsAt(null, NOW), null);
});

test('a malformed file shows nothing, and is never read as dry', () => {
  const cases = {
    missing: null,
    text: 'oops',
    schema: (f) => { f.schemaVersion = 1; },
    kind: (f) => { f.kind = 'live_all_route_road_forecast'; },
    case: (f) => { f.case = 'northern'; },
    modelVersion: (f) => { f.modelVersion = 'all-routes-v3'; },
    datum: (f) => { f.datum = 'feet'; },
    heights: (f) => { f.roadHeights = 'other'; },
    runId: (f) => { delete f.runId; },
    status: (f) => { f.status = 'complete'; },
    issued: (f) => { f.issuedAt = 'yesterday'; },
    notZ: (f) => { f.forecastEnd = '2026-11-02T07:00:00'; },
    order: (f) => { f.forecastEnd = f.forecastStart; },
    noListed: (f) => { delete f.listed; },
    ragged: (f) => { f.listed.maxWseCm.pop(); },
    codes: (f) => { f.stateCodes = ['below', 'over', 'unknown', 'no-cell']; },
    badCode: (f) => { f.listed.state[0] = 7; },
    unsorted: (f) => { [f.listed.index[0], f.listed.index[1]] = [f.listed.index[1], f.listed.index[0]]; },
    outOfRange: (f) => { f.listed.index[f.listed.index.length - 1] = 20; },
    noHeightListed: (f) => { // a station without road height may not appear in the live list
      const j = stationSet().stations.find((s) => s.noHeight).index, L = f.listed;
      const at = L.index.findIndex((i) => i > j), k = at < 0 ? L.index.length : at;
      L.index.splice(k, 0, j); L.state.splice(k, 0, 3);
      for (const c of ['maxWseCm', 'maxOverCm', 'firstOverMin', 'cellSizeM', 'unknownFrames']) L[c].splice(k, 0, null);
      f.summary.noCell += 1; f.summary.noRoadHeight -= 1;
    },
    noSummary: (f) => { delete f.summary; },
    summaryCount: (f) => { f.summary.over += 1; f.summary.dry -= 1; },
    summaryUnknown: (f) => { f.summary.unknown = 0; f.summary.dry += 2; },
    // A station dropped from the list would otherwise turn into "dry": the summary catches it.
    droppedEntry: (f) => { for (const k of Object.keys(f.listed)) f.listed[k].splice(0, 1); },
  };
  for (const [name, change] of Object.entries(cases)) {
    let f = sample();
    if (change === null) f = null; else if (typeof change === 'string') f = change; else change(f);
    const r = parse(f);
    assert.notEqual(r.status, 'ok', name);
    assert.deepEqual(r.stations, [], name);
    assert.ok(r.reason, name);
  }
});

// Shared with the model branch (tools/live/fixtures/local-roads/): the publish verifier and this
// parser are run against the same cases. The pinned sha256 is the same in both test files, so a
// change to one copy fails until the other is updated with it.
const CASES_RAW = raw('./fixtures/local-road-contract-cases.json');
const CONTRACT_CASES_SHA256 = '7a09c726f1f5b9335a0b477a71008e85d4de93391236b50f0831c30ffad5d9ef';
const LISTED_COLUMNS = ['index', 'state', 'maxWseCm', 'maxOverCm', 'firstOverMin', 'cellSizeM', 'unknownFrames'];
function applyOps(f, ops) {
  const at = (path) => { let o = f; for (const p of path.slice(0, -1)) o = o[p]; return [o, path[path.length - 1]]; };
  for (const op of ops) {
    if (op.op === 'set') { const [o, k] = at(op.path); o[k] = op.value; }
    else if (op.op === 'add') { const [o, k] = at(op.path); o[k] += op.value; }
    else if (op.op === 'delete') { const [o, k] = at(op.path); delete o[k]; }
    else if (op.op === 'pop') { const [o, k] = at(op.path); o[k].pop(); }
    else if (op.op === 'dropEntry') { for (const c of LISTED_COLUMNS) f.listed[c].splice(op.at, 1); }
    else if (op.op === 'swapEntries') { const [a, b] = op.at; for (const c of LISTED_COLUMNS) [f.listed[c][a], f.listed[c][b]] = [f.listed[c][b], f.listed[c][a]]; }
    else if (op.op === 'insertEntry') { for (const c of LISTED_COLUMNS) f.listed[c].splice(op.at, 0, op.entry[c]); }
    else throw Error('unknown op ' + op.op);
  }
  return f;
}

test('the shared contract cases: the app agrees with the publish verifier', () => {
  assert.equal(sha(CASES_RAW), CONTRACT_CASES_SHA256, 'update the model copy and both pinned hashes together');
  assert.equal(sha(raw('./fixtures/local-road-forecast-sample.json')), '5d8063712eba660ff2100c77d26097b11588a1ae47ecb595c2afa6f3982268e5');
  assert.equal(sha(STATIC), '0df117b6978b7cced69d7f1f3b053cd197e0406170df6c7cb4a8758799f17d53');
  const { cases } = JSON.parse(CASES_RAW);
  assert.ok(cases.length >= 40);
  for (const c of cases) {
    const r = parse(applyOps(sample(), c.ops));
    if (c.expect === 'reject') {
      assert.notEqual(r.status, 'ok', c.name);
      assert.deepEqual(r.stations, [], c.name);
      assert.ok(r.reason, c.name);
      continue;
    }
    assert.equal(r.status, 'ok', c.name);
    const bad = c.expect === 'unreadable' ? 1 : 0;
    assert.equal(r.unreadable, bad, c.name);
    assert.equal(r.unreadableStations.length, bad, c.name);
    assert.equal(r.stations.length, 20 - bad, c.name);
    assert.equal(r.stations.filter((s) => s.state === 'dry').length, 3, c.name + ': never turned into dry');
    if (bad) assert.match(localRoadStatusText(r), /; 1 road point could not be read in the run/, c.name);
    else assert.doesNotMatch(localRoadStatusText(r), /could not be read/, c.name);
  }
});

test('an over station with missing hours stays over and says some hours are missing', () => {
  const r = parse(sample()), s = r.stations[1];
  assert.deepEqual([s.state, s.unknownFrames], ['over', 2]);
  assert.match(stationLine(s), /above this road at its highest\. .* Some model hours are missing for this point, so the water may have been higher\.$/);
  assert.ok(stationDetails(s, r.frames).includes('Missing model readings: 2 of 35 model times.'));
  assert.equal(LOCAL_ROAD_SOME_MISSING, 'Some model hours are missing for this point, so the water may have been higher.');
  assert.doesNotMatch(stationLine(r.stations[0]), /missing/);
});

test('an unreadable station is counted in the model line and a tap on it never falls through to a neighbour', () => {
  const f = sample();
  f.listed.unknownFrames[2] = 1; // below with a missing frame: no longer a firm below
  const r = parse(f), st = stationSet().stations[2];
  assert.equal(r.unreadable, 1);
  assert.equal(r.stations.some((s) => s.index === 2), false, 'not drawn');
  assert.match(localRoadStatusText(r), /model water above 6 of 20 road points; 2 unknown \(missing model readings\); 1 road point could not be read in the run issued/);
  const hit = nearestLocalStation(r, { lat: st.lat, lon: st.lon });
  assert.equal(hit.index, 2);
  assert.equal(hit.state, 'unreadable');
  assert.equal(stationLine(hit), 'Model: the model values for this point could not be read, so nothing is shown for it.');
  assert.doesNotMatch([stationLine(hit), ...stationDetails(hit, 35)].join(' '), /\bsafe\b|dry|undefined|NaN|null/i);
  const two = sample(); two.listed.cellSizeM[2] = 0; two.listed.cellSizeM[4] = null;
  assert.match(localRoadStatusText(parse(two)), /; 2 road points could not be read/);
});

test('a partial run is shown with the partial wording', () => {
  const f = sample(); f.status = 'partial';
  const r = parse(f);
  assert.equal(r.status, 'ok');
  assert.equal(r.partial, true);
  const dry = r.stations.find((s) => s.state === 'dry');
  assert.equal(stationLine(dry, r.partial), 'Model: no water here in the hours this partial run covers.');
  assert.equal(LOCAL_ROAD_PARTIAL_NOTE, 'Partial model run: some forecast hours are unavailable.');
  assert.match(localRoadStatusText(r), /Partial model run: some forecast hours are unavailable\. Map only\.$/);
  assert.doesNotMatch(localRoadStatusText(parse(sample())), /Partial/);
});

test('plain wording for every state, feet first, never "safe"', () => {
  const r = parse(sample()), by = (state) => r.stations.find((s) => s.state === state);
  assert.equal(stationLine(by('over')), 'Model: water about 1.0 ft (0.31 m) above this road at its highest. Water first reaches above the road around Sun, Nov 1, 2 PM MST.');
  assert.match(stationLine(by('below')), /^Model: water stays below this road\. At its highest it is about 1\.0 ft \(0\.30 m\) below the road\.$/);
  assert.equal(stationLine(by('dry')), 'Model: no water here in this run.');
  assert.equal(stationLine(by('unknown')), 'Model: unknown here. Some model readings are missing for this point, so it is not shown as dry.');
  assert.match(stationLine(by('no-road-height')), /no road height here/);
  assert.match(stationLine(by('no-cell')), /outside the model’s active cells/);
  const tiny = { ...by('over'), maxOver: 0.01 };
  assert.match(stationLine(tiny), /^Model: water less than 0\.1 ft \(0\.03 m\) above this road/);
  assert.match(stationLine({ ...by('below'), maxOver: 0 }), /it is less than 0\.1 ft \(0\.03 m\) below the road/);
  for (const s of r.stations) {
    const text = [stationLine(s), ...stationDetails(s, 35)].join(' ');
    assert.doesNotMatch(text, /\bsafe\b|undefined|NaN|null/i, s.id);
  }
  assert.deepEqual(stationDetails(by('over')), ['Road: 2337.34 ft NAVD88', 'Highest model water: 2338.35 ft NAVD88', 'Model cell: 6.25 m']);
  assert.deepEqual(stationDetails(by('unknown'), 35).slice(-1), ['Missing model readings: 3 of 35 model times.']);
  assert.match(stationDetails(r.stations.find((s) => s.flags & 1)).join(' '), /not a surveyed deck/);
  assert.match(LOCAL_ROAD_METHOD, /bare-earth lidar, not a surveyed road or bridge deck/);
  assert.match(LOCAL_ROAD_METHOD, /not part of the route scores/);
});

test('the map source line says plainly when the comparison is missing or stale', () => {
  assert.match(localRoadStatusText(null), /loading/);
  assert.match(localRoadStatusText(parse(null)), /not shown\. The neighborhood road comparison did not load\./);
  assert.match(localRoadStatusText(parse(sample(), Date.parse('2026-11-01T17:00:00Z'))), /not shown\. .*not current/);
  assert.match(localRoadStatusText(parse(sample())), /model water above 6 of 20 road points; 2 unknown \(missing model readings\) in the run issued Nov 1, 6:50 AM MST\. Map only\./);
});

test('nearest station search uses only a current comparison, and finds dry points too', () => {
  const r = parse(sample());
  const s = r.stations.find((x) => x.state === 'dry');
  assert.equal(nearestLocalStation(r, { lat: s.lat + 0.0001, lon: s.lon })?.id, s.id);
  assert.equal(nearestLocalStation(r, { lat: s.lat + 0.01, lon: s.lon + 0.01 }), null);
  assert.equal(nearestLocalStation(localRoadsAt(r, Date.parse('2026-11-01T17:00:00Z')), { lat: s.lat, lon: s.lon }), null);
});

const response = (body) => ({ ok: true, json: async () => JSON.parse(body), arrayBuffer: async () => new Uint8Array(Buffer.from(body)).buffer });

test('loading: stations once with normal caching, live file no-store every 2 minutes, unchanged runs kept', async () => {
  resetLocalRoadStations();
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push([url, opts.cache]);
    if (url === LOCAL_ROAD_STATIONS_URL) return response(STATIC.toString('utf8'));
    return { ok: true, json: async () => sample() };
  };
  const first = await loadLocalRoadForecast({ now: NOW, fetchImpl });
  assert.equal(first.status, 'ok');
  const again = await loadLocalRoadForecast({ now: NOW + 120000, fetchImpl, previous: first });
  assert.equal(again, first, 'same run: the loaded comparison is kept, not rebuilt');
  assert.deepEqual(calls, [
    [LOCAL_ROAD_STATIONS_URL, undefined],
    [LOCAL_ROAD_URL + '?t=' + Math.floor(NOW / 120000), 'no-store'],
    [LOCAL_ROAD_URL + '?t=' + Math.floor((NOW + 120000) / 120000), 'no-store'],
  ]);
  const next = sample(); next.runId = 'fixture-next';
  const changed = await loadLocalRoadForecast({ now: NOW, fetchImpl: async (url) => url === LOCAL_ROAD_STATIONS_URL ? response(STATIC.toString('utf8')) : { ok: true, json: async () => next }, previous: first });
  assert.notEqual(changed, first);
  assert.equal(changed.runId, 'fixture-next');
  resetLocalRoadStations();
});

test('loading failures are unavailable, and a failed station list is retried', async () => {
  resetLocalRoadStations();
  let stationTries = 0;
  const missing = await loadLocalRoadForecast({ now: NOW, fetchImpl: async (url) => { if (url === LOCAL_ROAD_STATIONS_URL) { stationTries++; return { ok: false, status: 503 }; } return { ok: true, json: async () => sample() }; } });
  assert.equal(missing.status, 'unavailable');
  assert.match(missing.reason, /station list did not load/);
  const ok = await loadLocalRoadForecast({ now: NOW, fetchImpl: async (url) => url === LOCAL_ROAD_STATIONS_URL ? (stationTries++, response(STATIC.toString('utf8'))) : { ok: true, json: async () => sample() } });
  assert.equal(ok.status, 'ok');
  assert.equal(stationTries, 2);
  const live404 = await loadLocalRoadForecast({ now: NOW, fetchImpl: async () => ({ ok: false, status: 404 }) });
  assert.equal(live404.status, 'unavailable');
  const offline = await loadLocalRoadForecast({ now: NOW, fetchImpl: async () => { throw Error('offline'); } });
  assert.equal(offline.status, 'unavailable');
  const garbled = await loadLocalRoadForecast({ now: NOW, fetchImpl: async () => ({ ok: true, json: async () => { throw SyntaxError('bad'); } }) });
  assert.equal(garbled.status, 'unavailable');
  resetLocalRoadStations();
});

test('loadLocalRoadStations hashes the exact bytes it received', async () => {
  resetLocalRoadStations();
  const s = await loadLocalRoadStations({ fetchImpl: async () => response(STATIC.toString('utf8')) });
  assert.equal(s.sha256, sha(STATIC));
  assert.equal(sample().stationsSha256, sha(STATIC));
  resetLocalRoadStations();
});

test('neighborhood roads stay out of the route scores, alerts and the service bundle', () => {
  const rf = read('../public/road-forecast.js'), gas = read('../apps-script/Code.gs'), engine = read('../public/engine.js');
  for (const code of [rf, gas, engine]) assert.doesNotMatch(code, /brawley-avra-west|local-road-forecast/);
  assert.match(rf, /gates: \['pr-gates'\],\n\};/); // ALL_ROUTE_CASES unchanged
  const map = read('../public/map-app.js');
  assert.match(map, /from '\.\/simulation\/local-road-forecast\.js\?v=dev'/);
  assert.match(map, /localRoadStatusText\(localRoads\(\)\)/);
  assert.match(map, /loadLocalRoadForecast\(\{previous:localFile\}\)/);
  const live = read('../public/simulation/live-road-forecast.js');
  assert.doesNotMatch(live, /local-road/);
});
