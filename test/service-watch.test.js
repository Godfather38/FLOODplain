// Closure push, feed health, shared feeds and driver reports, against a mock Apps Script.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeGas } from './gas-mock.js';

const OUT = join(mkdtempSync(join(tmpdir(), 'gas-')), 'WashWatch.gs');
execFileSync(process.execPath, [fileURLToPath(new URL('../tools/build_gas.mjs', import.meta.url))], { env: { ...process.env, GAS_OUT: OUT }, stdio: 'pipe' });
const SRC = readFileSync(OUT, 'utf8');
const NOW = Date.parse('2026-11-03T02:00:00Z'); // 7 PM Arizona: no scheduled alert in these tests is due.

const tricoClosed = { attributes: { Location: 'Trico Rd north of Silverbell Rd', Status: 'Closed', Direction: 'Northbound', timeUpdated: '11/02/26, 10:25' }, geometry: { x: -111.30427390008394, y: 32.44702228874744 } }; // a test barricade on the Trico route
const ok = (body) => ({ getResponseCode: () => 200, getContentText: () => JSON.stringify(body) });
const down = { getResponseCode: () => 503, getContentText: () => '' };

function setup() {
  const world = { closures: [], closuresDown: false, rainDown: false, transview: null, noaa: 0 };
  const respond = (reqs) => reqs.map(({ url }) => {
    if (url.includes('USGS-')) return ok({ features: [] });
    if (url.includes('arcgis')) return world.closuresDown ? down : ok({ features: world.closures });
    if (url.includes('currain')) return world.rainDown ? down : ok({ data: [] });
    if (url.includes('currentstream')) return ok({ data: [] });
    if (url.includes('weather.gov')) return ok({ features: [] });
    if (url.includes('transview')) return world.transview ? ok({ d: url.includes('GetData') ? world.transview : {} }) : down;
    if (url.includes('api.water.noaa.gov')) { world.noaa++; return ok({ from: url }); }
    return down;
  });
  const clock = { now: NOW };
  const gas = makeGas(clock, SRC, respond);
  const pushes = () => gas.fetches.filter((f) => f.url.includes('ntfy.sh'));
  const nextCycle = () => { clock.now += 5 * 60000; gas.cache.delete('verdicts'); gas.cache.delete('roadevents'); gas.fetches.length = 0; gas.api.tick(); };
  return { world, clock, gas, pushes, nextCycle };
}
const sub = (gas, topic, instant) => gas.post({ action: 'push', topic, area: 'avra', times: ['05:45'], days: 'w:1,2,3,4,5,6,7', mode: 'all', instant });

test('closure push goes only to people who opted in, and only on a change',() => {
  const { world, gas, pushes, nextCycle } = setup();
  sub(gas, 'washwatch-instanton1', true);sub(gas, 'washwatch-instantoff', false);
  nextCycle();
  assert.equal(pushes().length, 0, 'the first look only sets the baseline');
  world.closures = [tricoClosed];nextCycle();
  assert.deepEqual(pushes().map((f) => f.url), ['https://ntfy.sh/washwatch-instanton1']);
  assert.match(pushes()[0].opt.payload, /Road closed: Trico Rd north of Silverbell Rd/);
  assert.equal(pushes()[0].opt.headers.Title, 'FLOODplain: road closed');
  nextCycle();
  assert.equal(pushes().length, 0, 'still closed is not news');
  world.closures = [];nextCycle();
  assert.match(pushes()[0].opt.payload, /No longer listed as closed: Trico Rd north of Silverbell Rd/);
  assert.doesNotMatch(pushes()[0].opt.payload, /\bsafe\b/i);
});
test('a county feed outage is never announced as a reopening',() => {
  const { world, gas, pushes, nextCycle } = setup();
  sub(gas, 'washwatch-instanton1', true);
  world.closures = [tricoClosed];nextCycle();
  world.closuresDown = true;nextCycle();
  assert.equal(pushes().length, 0);
  world.closuresDown = false;nextCycle();
  assert.equal(pushes().length, 0, 'unchanged once the feed returns');
});
test('closure pushes stop at the daily cap',() => {
  const { world, gas, pushes, nextCycle } = setup();
  sub(gas, 'washwatch-instanton1', true);nextCycle();
  let sent = 0;
  for (let i = 0; i < 20; i++) { world.closures = i % 2 ? [] : [tricoClosed];nextCycle();sent += pushes().length; }
  assert.equal(sent, 12);
});
test('the owner hears once when a feed stays down, and once when it recovers',() => {
  const { world, gas, nextCycle } = setup();
  world.transview = [];nextCycle();
  world.rainDown = true;
  for (let i = 0; i < 5; i++) nextCycle();
  assert.equal(gas.mails.length, 0, 'not before 30 minutes');
  for (let i = 0; i < 4; i++) nextCycle();
  assert.equal(gas.mails.length, 1);assert.match(gas.mails[0].body, /Not answering.*rain/);
  for (let i = 0; i < 4; i++) nextCycle();
  assert.equal(gas.mails.length, 1, 'no repeats');
  world.rainDown = false;nextCycle();
  assert.equal(gas.mails.length, 2);assert.match(gas.mails[1].body, /Answering again: rain/);
  assert.ok(gas.api.doGet({ parameter: { feed: 'health' } }).sources.rain.lastOk);
});
test('feed=all serves everything, and keeps TransView\'s last answer when it fails',() => {
  const { world, gas, clock, nextCycle } = setup();
  world.transview = [{ KeyID: '1', headline: 'Trico Rd south of Trico Marana Rd', trafficImpacts: 'Road Closed', description: '', Geo: 'MULTIPOINT ((-111.3043 32.4511))' }];
  nextCycle();
  let all = gas.api.doGet({ parameter: { feed: 'all' } });
  assert.ok(all.usgs && all.alert);assert.equal(all.roadEvents.stale, false);assert.equal(all.roadEvents.events.length, 1);
  world.transview = null;nextCycle();
  all = gas.api.doGet({ parameter: { feed: 'all' } });
  assert.equal(all.roadEvents.stale, true);assert.equal(all.roadEvents.events.length, 1);assert.ok(all.roadEvents.fetchedAt < clock.now);
});
test('shared forecasts only reach NOAA paths on the list, and cache them',() => {
  const { world, gas } = setup();
  const get = (paths) => gas.api.doGet({ parameter: { feed: 'forecasts', paths } }).responses;
  const r = get('gauges/SCTA3,gauges/SCTA3/stageflow,reaches/945050510/streamflow,../../evil,gauges/x y');
  assert.deepEqual(Object.keys(r).sort(), ['gauges/SCTA3', 'gauges/SCTA3/stageflow', 'reaches/945050510/streamflow']);
  assert.match(r['reaches/945050510/streamflow'].from, /streamflow\?series=short_range$/);
  assert.equal(world.noaa, 3);
  get('gauges/SCTA3');assert.equal(world.noaa, 3, 'second phone reuses the copy');
});
test('driver reports take two fixed answers for real crossings, and age out',() => {
  const { gas, clock } = setup();
  assert.equal(gas.post({ action: 'drive', fp: 'brawley-dip', state: 'water' }).ok, true);
  assert.equal(gas.post({ action: 'drive', fp: 'brawley-dip', state: 'free text' }).ok, false);
  assert.equal(gas.post({ action: 'drive', fp: 'nowhere', state: 'water' }).ok, false);
  assert.equal(gas.api.doGet({ parameter: { feed: 'all' } }).drive.length, 1);
  clock.now += 7 * 3600000;gas.cache.delete('verdicts');
  assert.equal(gas.api.doGet({ parameter: { feed: 'all' } }).drive.length, 0);
});
test('failed-feed beacons count by day and keep nothing else',() => {
  const { gas } = setup();
  gas.api.doGet({ parameter: { fail: 'alert,roadevents' } });gas.api.doGet({ parameter: { fail: 'alert,<script>' } });
  gas.api.sheet_();
  const tab = gas.ss.getSheetByName('feed_failures');
  assert.deepEqual(tab.rows.slice(1).map((r) => [r[1], r[2]]), [['alert', 2], ['roadevents', 1]]);
});
