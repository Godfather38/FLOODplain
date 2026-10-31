import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseContinuous, summarizeGauge, rateLink, rateRoute, recommend, ratePerHour } from '../public/logic.js';
import { GAUGES, ROUTES } from '../public/config.js';

const NOW = Date.parse('2026-08-10T13:00:00Z');
const opts = { staleMs: 3 * 3600e3, dryCfs: 1 };
// Build a USGS OGC `continuous` response: values every 15 min ending at NOW.
const usgs = (param, values) => ({
  type: 'FeatureCollection',
  features: values.map((v, i) => ({
    type: 'Feature', geometry: { type: 'Point', coordinates: [-111.146, 32.402] },
    properties: { time: new Date(NOW - (values.length - 1 - i) * 900e3).toISOString(), value: String(v), parameter_code: param },
  })),
});
const merge = (...cols) => ({ type: 'FeatureCollection', features: cols.flatMap((c) => c.features) });

test('parses and sorts USGS OGC features by parameter', () => {
  const s = parseContinuous(merge(usgs('00060', [0, 0, 0]), usgs('00065', [2.1, 2.1, 2.2])));
  assert.deepEqual(s['00060'].map((p) => p.v), [0, 0, 0]);
  assert.equal(s['00065'].at(-1).v, 2.2);
});

test('skips null / non-numeric values', () => {
  const j = usgs('00060', [1, 2, 3]);
  j.features[1].properties.value = null;
  j.features[2].properties.value = 'Ice';
  assert.equal(parseContinuous(j)['00060'].length, 1);
});

test('dry wash', () => {
  const s = summarizeGauge(parseContinuous(usgs('00060', [0, 0, 0, 0, 0])), NOW, opts);
  assert.equal(s.state, 'dry');
  assert.equal(rateLink(s, { kind: 'dip' }, null).level, 'ok');
});

test('stale data is unknown, never ok', () => {
  const s = summarizeGauge(parseContinuous(usgs('00060', [0, 0, 0])), NOW + 4 * 3600e3, opts);
  assert.equal(s.state, 'nodata');
  assert.equal(rateLink(s, { kind: 'bridge' }, null).level, 'unknown');
});

test('steady flow: watch under a bridge, caution upstream of a dip', () => {
  const s = summarizeGauge(parseContinuous(usgs('00060', [40, 41, 40, 42, 41])), NOW, opts);
  assert.equal(s.state, 'flowing');
  assert.equal(s.risingFast, false);
  assert.equal(rateLink(s, { kind: 'bridge' }, null).level, 'watch');
  assert.equal(rateLink(s, { kind: 'dip' }, null).level, 'caution');
});

test('flood front rising fast: caution at bridge, danger for dip', () => {
  const s = summarizeGauge(parseContinuous(usgs('00060', [0, 5, 60, 300, 900])), NOW, opts);
  assert.equal(s.risingFast, true);
  assert.equal(rateLink(s, { kind: 'bridge' }, null).level, 'caution');
  assert.equal(rateLink(s, { kind: 'dip' }, null).level, 'danger');
});

test('calibrated trouble threshold forces danger', () => {
  const s = summarizeGauge(parseContinuous(usgs('00060', [5000, 5000, 5000])), NOW, opts);
  assert.equal(rateLink(s, { kind: 'bridge' }, 4000).level, 'danger');
});

test('trend needs at least 3 points in the window', () => {
  assert.equal(ratePerHour([{ t: 0, v: 1 }, { t: 1, v: 2 }]), null);
});

const summaries = (overrides) => {
  const dry = summarizeGauge(parseContinuous(usgs('00060', [0, 0, 0, 0, 0])), NOW, opts);
  return Object.fromEntries(Object.keys(GAUGES).map((k) => [k, overrides[k] ?? dry]));
};
const MINUTES = { trico: 10.4, avra: 19.5, 'silverbell-north': 16.5, 'silverbell-south': 19.7 };
const rateAll = (s) => Object.keys(ROUTES).map((id) => ({ id, minutes: MINUTES[id], ...rateRoute(ROUTES[id], s, GAUGES) }));

test('all dry: fastest route (Trico) wins', () => {
  const r = recommend(rateAll(summaries({})));
  assert.equal(r.best.id, 'trico');
  assert.equal(r.clear, true);
});

test('Trico-Marana bridge flooding fast -> Silverbell north', () => {
  const flood = summarizeGauge(parseContinuous(usgs('00060', [0, 50, 400, 1500, 4000])), NOW, opts);
  const r = recommend(rateAll(summaries({ '09486520': flood })));
  assert.equal(r.best.id, 'silverbell-north');
});

test('Brawley running upstream -> Avra Valley Rd is not ok', () => {
  const run = summarizeGauge(parseContinuous(usgs('00060', [30, 30, 31, 30, 30])), NOW, opts);
  const avra = rateAll(summaries({ '09487000': run })).find((r) => r.id === 'avra');
  assert.equal(avra.level, 'caution');
});

test('every gauge down -> not clear', () => {
  const none = { state: 'nodata' };
  const r = recommend(rateAll(Object.fromEntries(Object.keys(GAUGES).map((k) => [k, none]))));
  assert.equal(r.clear, false);
  assert.equal(r.best.level, 'unknown');
});
