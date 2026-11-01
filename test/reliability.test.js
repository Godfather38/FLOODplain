import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as cfg from '../public/config.js';
import { rateFailurePoint, riskScore } from '../public/logic.js';
import { sourceUrls } from '../public/engine.js';
import { getJson } from '../public/network.js';

test('official closures retain severity at shallow crossings', () => {
  for (const fp of cfg.FAILURE_POINTS.filter((p) => ['road', 'flat'].includes(p.kind))) {
    const result = rateFailurePoint(fp, {
      now: Date.now(), flows: {}, alert: null, nws: [],
      closures: [{ lat: fp.lat, lon: fp.lon, status: 'Closed', location: fp.name }],
    }, cfg);
    assert.equal(result.level, 'danger', fp.id);
    assert.equal(riskScore(result), 5);
    assert.match(result.why, /County says CLOSED/);
  }
});

test('closure query includes every crossing and its matching radius', () => {
  const bounds = new URL(sourceUrls().closures).searchParams.get('geometry');
  assert.equal(bounds, cfg.CLOSURE_BOUNDS);
  const [west, south, east, north] = bounds.split(',').map(Number);
  for (const p of cfg.FAILURE_POINTS) {
    const dy = cfg.CLOSURE_RADIUS_M / 111320;
    const dx = dy / Math.cos(p.lat * Math.PI / 180);
    assert.ok(p.lon - dx >= west && p.lon + dx <= east && p.lat - dy >= south && p.lat + dy <= north, p.id);
  }
});

test('feed reads return JSON and preserve HTTP rate-limit status', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => ({ value: 0 }) }));
  assert.deepEqual(await getJson('https://example.invalid'), { value: 0 });
  globalThis.fetch.mock.mockImplementation(async () => ({ ok: false, status: 429 }));
  await assert.rejects(getJson('https://example.invalid'), { status: 429 });
});

test('a stalled connection or response body times out and aborts', async (t) => {
  let signal;
  t.mock.method(globalThis, 'fetch', async (_, opts) => {
    signal = opts.signal;
    return new Promise(() => {});
  });
  await assert.rejects(getJson('https://example.invalid', {}, 10), /timed out/);
  assert.equal(signal.aborted, true);
  globalThis.fetch.mock.mockImplementation(async (_, opts) => {
    signal = opts.signal;
    return { ok: true, json: () => new Promise(() => {}) };
  });
  await assert.rejects(getJson('https://example.invalid', {}, 10), /timed out/);
  assert.equal(signal.aborted, true);
});
