import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alertSnapshot } from '../public/engine.js';
import { checkRain, checkWash } from '../public/logic.js';
import { resolveScreen } from '../public/routing.js';
import * as cfg from '../public/config.js';

const now = Date.parse('2026-11-01T06:00:00Z');
const rain = (values) => ({ fetched_at: new Date(now).toISOString(), rain: [{ site: '6110', name: 'test', last_rpt: new Date(now).toISOString(), in: values }] });
const check = (values) => checkRain(rain(values), ['6110'], cfg.RAIN.local, cfg.RAIN_GAUGES, now, cfg.STALE_MS);

test('empty county values remain missing rather than zero', () => {
  const row = { source: 'pima', longitude: -111.3, latitude: 32.4, name: 'test', rain: [null, '', ' ', '0', '0.2'], flow: null };
  const s = alertSnapshot([row], [row], now);
  assert.deepEqual(Object.values(s.rain[0].in).slice(0, 5), [null, null, null, 0, 0.2]);
  assert.equal(s.stream[0].flow_cfs, null);
});
test('missing rain is not reported as no rain; measured heavy rain still counts', () => {
  assert.equal(check({ h1: null, h6: null }).level, 'unknown');
  const incomplete = check({ h1: 0 });
  assert.equal(incomplete.level, 'unknown');
  assert.match(incomplete.detail, /6 h unavailable/);
  assert.equal(check({ h1: 5, h6: null }).level, 'danger');
});
test('maintenance and invalid wash readings are excluded', () => {
  for (const extra of [{ maintenance: true, flow_cfs: 1000 }, { flow_cfs: -1 }, { flow_cfs: null }]) {
    const snapshot = { stream: [{ site: 'x', name: 'test', last_rpt: new Date(now).toISOString(), ...extra }] };
    assert.equal(checkWash(snapshot, {}, { alert: ['x'] }, 'dip', now, cfg.STALE_MS, {}).level, 'unknown');
  }
});
test('invalid and unrelated crossing links fall back to their route', () => {
  const routes = { trico: { points: [{ id: 'bridge' }] } };
  assert.deepEqual(resolveScreen('#/updates', routes), { screen: 'updates' });
  assert.deepEqual(resolveScreen('#/r/trico/missing', routes), { screen: 'route', route: 'trico' });
  assert.deepEqual(resolveScreen('#/r/trico/bridge', routes), { screen: 'stretch', route: 'trico', fp: 'bridge' });
  assert.deepEqual(resolveScreen('#/r/deleted/bridge', routes), { screen: 'home' });
});
