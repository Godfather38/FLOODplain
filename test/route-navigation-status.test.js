import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { routeAreaForHash, resolveScreen } from '../public/routing.js';
import { conditionsNotEstablished, groupRoutePoints } from '../public/route-status.js';
import { rateFailurePoint, riskScore } from '../public/logic.js';
import * as cfg from '../public/config.js';

const routes = JSON.parse(readFileSync(new URL('../public/data/routes.geojson', import.meta.url))).features;
const score = (p) => p.score === undefined ? riskScore(p) : p.score;

test('all route and crossing links choose their owning area before area filtering', () => {
  assert.equal(routes.length, 8);
  for (const route of routes) {
    const { id, area } = route.properties;
    assert.equal(routeAreaForHash(`#/r/${id}`, routes), area);
    assert.equal(routeAreaForHash(`#/r/${id}/a-crossing`, routes), area);
    assert.equal(routeAreaForHash(`#/r/${id}/not-on-this-route`, routes), area);
  }
  assert.equal(routeAreaForHash('#/r/legacy', [{ properties: { id: 'legacy' } }]), 'avra');
});

test('non-route and deleted-route links preserve the chosen area', () => {
  for (const hash of ['#/', '#/map', '#/settings', '#/report/bridge', '#/r', '#/r/deleted/bridge']) {
    assert.equal(routeAreaForHash(hash, routes), null, hash);
  }
  assert.deepEqual(resolveScreen('#/r/trico/foreign', { trico: { points: [{ id: 'local' }] } }), { screen: 'route', route: 'trico' });
  assert.deepEqual(resolveScreen('#/r/trico/sfincs-trico', { trico: { points: [{ id: 'sfincs-trico', routeBarricade: true }] } }), { screen: 'route', route: 'trico' });
  for (const id of ['constructor', '__proto__', 'toString']) {
    assert.deepEqual(resolveScreen(`#/r/${id}`, {}), { screen: 'home' });
  }
});

test('missing bridge readings keep their score but cannot be presented as normal', () => {
  const fp = cfg.FAILURE_POINTS.find((p) => p.id === 'sc-avra');
  const result = rateFailurePoint(fp, { now: Date.parse('2026-11-06T03:00:00Z'), flows: {}, alert: null, nws: [], closures: [] }, cfg);
  assert.equal(riskScore(result), 1);
  assert.equal(result.evidenceAvailable, false);
  assert.equal(conditionsNotEstablished(result), true);
  assert.deepEqual(groupRoutePoints([result], score), { concerns: [], unestablished: [result], quiet: [] });
});

test('quiet regional readings do not clear an unknown road, bridge, or county status', () => {
  for (const gap of [
    { src: 'road-status', level: 'unknown', roadStatus: 'unknown' },
    { src: 'river', level: 'unknown', bridgeClearance: 'unknown' },
    { src: 'county', level: 'unknown' },
    { src: 'none', level: 'ok' },
    { src: 'wash', level: 'unknown', upstream: true },
  ]) {
    const p = { level: 'ok', evidenceAvailable: true, checks: [{ src: 'rain-local', level: 'ok' }, gap] };
    assert.equal(conditionsNotEstablished(p), true, JSON.stringify(gap));
    assert.deepEqual(groupRoutePoints([p], score).unestablished, [p]);
  }
});

test('a valid quiet bridge estimate stays data-qualified without claiming passage', () => {
  const p = { level: 'ok', checks: [{ src: 'river', level: 'ok', bridgeClearance: 'unknown', heightComparison: { status: 'estimated' } }] };
  assert.equal(conditionsNotEstablished(p), false);
  assert.deepEqual(groupRoutePoints([p], score).quiet, [p]);
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.doesNotMatch(app, /Every stretch looks normal|Looks normal|Nothing working against it/);
  assert.match(app, /No warning in available data/);
});

test('warnings lead, unknown scores stay unresolved, and every point appears once', () => {
  const closure = { id: 'closed', level: 'danger', evidenceAvailable: false, checks: [{ src: 'county', level: 'danger' }] };
  const raised = { id: 'model-concern', score: 1.5, level: 'ok', evidenceAvailable: false, checks: [] };
  const missing = { id: 'missing', level: 'ok', evidenceAvailable: false, checks: [] };
  const unknown = { id: 'unknown', level: 'unknown', checks: [] };
  const nullScore = { id: 'null', level: 'ok', score: null, checks: [] };
  const quiet = { id: 'quiet', level: 'ok', checks: [{ src: 'rain-local', level: 'ok' }] };
  const points = [missing, closure, quiet, unknown, raised, nullScore];
  const grouped = groupRoutePoints(points, score);
  assert.deepEqual(grouped.concerns, [closure, raised]);
  assert.deepEqual(grouped.unestablished, [missing, unknown, nullScore]);
  assert.deepEqual(grouped.quiet, [quiet]);
  assert.deepEqual(Object.values(grouped).flat().map((p) => p.id).sort(), points.map((p) => p.id).sort());
});
