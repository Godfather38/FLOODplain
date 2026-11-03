import { fileURLToPath } from 'node:url';
// The single-file Apps Script bundle computes the same verdict the app does, from raw feeds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { makeGas } from './gas-mock.js';

const OUT = join(mkdtempSync(join(tmpdir(), 'gas-')), 'WashWatch.gs');
execFileSync(process.execPath, [fileURLToPath(new URL('../tools/build_gas.mjs', import.meta.url))], { env: { ...process.env, GAS_OUT: OUT }, stdio: 'pipe' });
const SRC = readFileSync(OUT, 'utf8');
const fx = (n) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8');

// Recorded responses from Oct 31, 2026 (light rain). Time-shift USGS so it reads as current.
function feeds(now, { failRain = false } = {}) {
  return (reqs) => reqs.map(({ url }) => {
    let body = null;
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
