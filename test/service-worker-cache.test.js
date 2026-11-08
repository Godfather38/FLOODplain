// The offline worker's startup-file cleanup (public/sw.js 'cache-files'), run in a sandbox with a
// fake Cache Storage. The neighborhood road station list loads lazily when the map opens, so it is
// never in the page's startup list; it must survive the cleanup once saved.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { LOCAL_ROAD_STATIONS_URL } from '../public/simulation/local-road-forecast.js';

const ORIGIN = 'https://godfather38.github.io';
const BASE = ORIGIN + '/FloodPLAIN/';

function worker() {
  const store = new Map(), listeners = {};
  const cache = {
    add: async (u) => { store.set(new URL(u, BASE).href, 'network'); },
    put: async (req, res) => { store.set(typeof req === 'string' ? req : req.url, res); },
    keys: async () => [...store.keys()].map((url) => ({ url })),
    delete: async (req) => store.delete(req.url),
    match: async (req) => store.get(req.url),
  };
  const self = {
    location: new URL(BASE + 'sw.js'),
    addEventListener: (type, fn) => { listeners[type] = fn; },
    skipWaiting: () => {}, clients: { claim: async () => {} },
  };
  vm.runInNewContext(readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8'), {
    self, URL, Promise, setTimeout, clearTimeout, fetch: async () => { throw Error('offline'); },
    caches: { open: async () => cache, keys: async () => ['floodplain-app-v2'], delete: async () => true },
  });
  const send = async (urls) => {
    let done;
    listeners.message({ data: { type: 'cache-files', urls }, waitUntil: (p) => { done = p; } });
    await done;
  };
  return { store, send };
}

test('the station list, once saved, is kept through the startup-file cleanup; old startup files are not', async () => {
  const { store, send } = worker();
  const stations = BASE + 'data/local-roads/brawley-avra-west-stations.json';
  assert.match(LOCAL_ROAD_STATIONS_URL, /\/data\/local-roads\/brawley-avra-west-stations\.json$/);
  store.set(stations, 'saved when the map fetched it');
  store.set(BASE + 'old-release.js?v=1', 'old');
  store.set(BASE + 'data/local-roads/notes.json', 'not a station list');
  await send([BASE, BASE + 'app.js?v=2']);
  assert.equal(store.get(stations), 'saved when the map fetched it');
  assert.equal(store.has(BASE + 'old-release.js?v=1'), false);
  assert.equal(store.has(BASE + 'data/local-roads/notes.json'), false);
  assert.ok(store.has(BASE + 'app.js?v=2'));
  await send([BASE]); // a second load keeps it too
  assert.ok(store.has(stations));
});

test('the cleanup does not add the station list when it was never saved', async () => {
  const { store, send } = worker();
  await send([BASE]);
  assert.deepEqual([...store.keys()], [BASE]);
});
