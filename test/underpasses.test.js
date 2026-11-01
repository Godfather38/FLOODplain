import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as cfg from '../public/config.js';
import { rateFailurePoint, riskScore } from '../public/logic.js';
import { resolveScreen } from '../public/routing.js';
import { UNDERPASSES } from '../public/underpasses.js';

const now = Date.parse('2026-11-01T12:00:00Z');
const reading = (site, h1) => ({ site, name: `Gauge ${site}`, last_rpt: '2026-11-01T11:50:00Z', maintenance: false, in: { h1, h3: h1, h6: h1, d1: h1 } });
const rate = (up, rain, extra = {}) => rateFailurePoint(up, { now, flows: {}, closures: [], nws: [], alert: { fetched_at: '2026-11-01T11:55:00Z', rain, stream: [] }, ...extra }, cfg);

test('the four underpasses are listed and have a screen', () => {
  assert.deepEqual(UNDERPASSES.map((u) => u.short), ['Marana Rd', 'Orange Grove Rd', 'Grant Rd', 'Speedway Blvd']);
  assert.deepEqual(resolveScreen('#/underpasses', {}), { screen: 'underpasses' });
});

test('rain near an underpass moves its number on the usual 1-5 scale', () => {
  for (const up of UNDERPASSES) {
    const site = up.rain.local[0];
    assert.equal(riskScore(rate(up, [reading(site, 0)])), 1, up.id);
    assert.equal(riskScore(rate(up, [reading(site, 0.2)])), 2, up.id);
    assert.equal(riskScore(rate(up, [reading(site, 0.5)])), 3, up.id);
    assert.equal(riskScore(rate(up, [reading(site, 1)])), 5, up.id); // The engine's existing dip rule.
  }
});

test('a county closure at an underpass reads as closed', () => {
  const up = UNDERPASSES[2];
  const r = rate(up, [reading(up.rain.local[0], 0)], { closures: [{ location: 'Grant Rd at I-10', status: 'Closed', lat: up.lat, lon: up.lon }] });
  assert.equal(riskScore(r), 5);
});

test('missing rain data never reads as a confirmed clear underpass', () => {
  const r = rate(UNDERPASSES[0], []);
  assert.match(r.checks.map((c) => c.why).join(' '), /no rain gauge reading/);
});
