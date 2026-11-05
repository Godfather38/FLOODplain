import { fileURLToPath } from 'node:url';
// The single-file Apps Script bundle computes the same verdict the app does, from raw feeds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { makeGas } from './gas-mock.js';

const OUT = join(mkdtempSync(join(tmpdir(), 'gas-')), 'WashWatch.gs');
execFileSync(process.execPath, [fileURLToPath(new URL('../tools/build_gas.mjs', import.meta.url))], { env: { ...process.env, GAS_OUT: OUT }, stdio: 'pipe' });
const SRC = readFileSync(OUT, 'utf8');
const fx = (n) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8');

// A live SFINCS run around `now`: dry everywhere, or `overM` of water over the lowest road cell of
// `route` three hours ahead. Cell order follows public/data/road-cells.json.
const CELLS = JSON.parse(readFileSync(new URL('../public/data/road-cells.json', import.meta.url), 'utf8'));
function liveSfincs(now, { overM = null, route = 'avra', ageH = 1 } = {}) {
  const issued = now - ageH * 3600e3, times = Array.from({ length: 8 }, (_, k) => issued - 3600e3 + k * 3600e3);
  const low = CELLS.routes[route].filter((c) => c[2] <= c[1]).reduce((a, c) => (c[1] < a[1] ? c : a)); // a cell whose ground is at or below the road
  const frames = times.map((t, k) => { const surfaceM = new Array(CELLS.cellCount).fill(-99999); if (overM != null && k === 4) surfaceM[low[0]] = low[1] + overM; return { time: new Date(t).toISOString(), surfaceM }; });
  return { manifest: JSON.stringify({ runId: 'live-test', issuedAt: new Date(issued).toISOString() }), water: gzipSync(JSON.stringify({ cellOrder: 'test', frames })) };
}

// Recorded responses from Oct 31, 2026 (light rain). Time-shift USGS so it reads as current.
function feeds(now, { failRain = false, sfincs = liveSfincs(now), failSfincs = false } = {}) {
  return (reqs) => reqs.map(({ url }) => {
    let body = null;
    if (url.includes('live-model/live/')) {
      if (failSfincs) return { getResponseCode: () => 404, getContentText: () => '', getBlob: () => ({ bytes: Buffer.alloc(0), setContentType() { return this; } }) };
      if (url.includes('manifest.json')) return { getResponseCode: () => 200, getContentText: () => sfincs.manifest };
      return { getResponseCode: () => 200, getContentText: () => '', getBlob: () => ({ bytes: sfincs.water, setContentType() { return this; } }) };
    }
    const site = /USGS-(\d+)/.exec(url)?.[1];
    if (site) {
      let j;
      try { j = JSON.parse(fx(`usgs-${site}-2026-10-31.json`)); } catch { return { getResponseCode: () => 503, getContentText: () => '' }; }
      const last = Date.parse(j.features.at(-1).properties.time);
      j.features.forEach((f) => { f.properties.time = new Date(Date.parse(f.properties.time) + (now - 20 * 60e3 - last)).toISOString(); });
      body = JSON.stringify(j);
    } else if (url.includes('arcgis')) body = fx('closures-2026-10-31.json');
    else if (url.includes('currain')) body = failRain ? null : fx('alert-currain-2026-10-31.json');
    else if (url.includes('currentstream')) body = failRain ? null : fx('alert-currentstream-2026-10-31.json');
    else if (url.includes('weather.gov')) body = JSON.stringify({ features: [] });
    return { getResponseCode: () => (body ? 200 : 503), getContentText: () => body ?? '' };
  });
}
const NOW = Date.parse('2026-10-31T14:30:00-07:00'); // shortly after the recorded ALERT readings

test('bundle computes the verdict itself from the raw feeds', () => {
  const clock = { now: NOW, verdict: null };
  const g = makeGas(clock, SRC, feeds(NOW));
  const v = g.api.computeVerdict_();
  assert.match(v.sms, /^take Trico-Marana \(1\/5 Low, 10 min\)\. Others: /);
  assert.equal(v.off, false);
  const snap = g.api.doGet({ parameter: { feed: 'alert' } });
  assert.ok(snap.rain.some((r) => r.site === '6110' && r.in.h6 === 0.2), 'rain feed served to the app');
});

test('rain feed down: still a numbered verdict, says the rain data is missing', () => {
  const clock = { now: NOW, verdict: null };
  const g = makeGas(clock, SRC, feeds(NOW, { failRain: true }));
  const v = g.api.computeVerdict_();
  assert.match(v.sms, /\d\/5/);
  assert.match(v.sms, /No live rain data/);
});

test('bundle works out both areas', () => {
  const clock = { now: NOW, verdict: null };
  const g = makeGas(clock, SRC, feeds(NOW));
  const pr = g.api.computeVerdict_('picture-rocks');
  assert.match(pr.sms, /^Picture Rocks: take /);
  assert.match(pr.title, /Picture Rocks/);
});

test('bundle serves the river gauges to the app in one request', () => {
  const clock = { now: NOW, verdict: null };
  const g = makeGas(clock, SRC, feeds(NOW));
  const u = g.api.doGet({ parameter: { feed: 'usgs' } });
  assert.ok(u.series['09486500'].features.length > 0);
  assert.ok('time' in u.series['09486500'].features[0].properties);
});

test('texts and pushes use the SFINCS road forecast: water over the road raises that route', () => {
  const dry = makeGas({ now: NOW, verdict: null }, SRC, feeds(NOW)).api;
  const base = dry.computeVerdict_();
  assert.doesNotMatch(base.sms, /flood model/);
  const f = dry.doGet({ parameter: { feed: 'roadforecast' } });
  assert.equal(f.status, 'ok');assert.equal(f.routes.avra.level, 'ok');
  const wet = makeGas({ now: NOW, verdict: null }, SRC, feeds(NOW, { sfincs: liveSfincs(NOW, { overM: 0.4 }) })).api;
  const v = wet.computeVerdict_();
  assert.match(v.sms, /Avra Valley Rd 5/, 'a foot or more over the road is a 5');
  assert.equal(wet.doGet({ parameter: { feed: 'roadforecast' } }).routes.avra.level, 'danger');
  const shallow = makeGas({ now: NOW, verdict: null }, SRC, feeds(NOW, { sfincs: liveSfincs(NOW, { overM: 0.1 }) })).api.computeVerdict_();
  assert.match(shallow.sms, /Avra Valley Rd 3/);
});

test('a stale or missing SFINCS run leaves a numbered verdict and says so', () => {
  for (const opt of [{ failSfincs: true }, { sfincs: liveSfincs(NOW, { ageH: 5, overM: 1 }) }]) {
    const v = makeGas({ now: NOW, verdict: null }, SRC, feeds(NOW, opt)).api.computeVerdict_();
    assert.match(v.sms, /\d\/5/);
    assert.match(v.sms, /No live flood model data/);
    assert.doesNotMatch(v.sms, /Avra Valley Rd 5/);
  }
});
