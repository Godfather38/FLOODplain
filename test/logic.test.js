import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as cfg from '../public/config.js';
import {
  goodSigns, againstIt, riskScore,
  parseContinuous, summarizeFlow, checkRiver, checkRain, checkWash, checkClosures, checkNws,
  rateFailurePoint, rateRoutes, recommend, googleMapsUrl,
} from '../public/logic.js';

const fx = (n) => JSON.parse(readFileSync(new URL(`./fixtures/${n}`, import.meta.url)));
const ROUTES = JSON.parse(readFileSync(new URL('../public/data/routes.geojson', import.meta.url))).features;
const FP = Object.fromEntries(cfg.FAILURE_POINTS.map((f) => [f.id, f]));
const NOW = Date.parse('2026-10-31T21:30:00Z');

// ---- builders ----
const usgs = (values, end = NOW) => parseContinuous({
  features: values.map((v, i) => ({ properties: { time: new Date(end - (values.length - 1 - i) * 900e3).toISOString(), value: String(v), parameter_code: '00060' } })),
});
const flow = (values) => summarizeFlow(usgs(values), NOW, cfg.STALE_MS);
const normalFlows = () => ({
  '09486500': flow([40, 41, 40, 42, 41]), '09486520': flow([28, 29, 28, 29, 29]),
  '09486055': flow([0, 0, 0, 0, 0]), '09486350': flow([0, 0, 0, 0, 0]), '09487000': flow([0, 0, 0, 0, 0]),
});
const rainGauge = (site, inches) => ({
  site, name: site, last_rpt: new Date(NOW - 10 * 60e3).toISOString(), maintenance: false,
  in: { m10: 0, m30: 0, h1: 0, h3: 0, h6: 0, d1: 0, ...inches },
});
const snapshot = (rainBySite = {}, stream = {}) => ({
  fetched_at: new Date(NOW - 5 * 60e3).toISOString(),
  rain: Object.keys(cfg.RAIN_GAUGES).map((s) => rainGauge(s, rainBySite[s] ?? {})),
  stream: ['6443'].map((s) => ({ site: s, name: 'Brawley Wash at Milewide Road (PT)', last_rpt: new Date(NOW - 10 * 60e3).toISOString(), flow_cfs: stream[s] ?? 0 })),
});
const data = (over = {}) => ({ now: NOW, flows: normalFlows(), closures: [], alert: snapshot(), nws: [], ...over });
const choose = (d) => {
  const res = Object.fromEntries(cfg.FAILURE_POINTS.map((fp) => [fp.id, rateFailurePoint(fp, d, cfg)]));
  return { res, ...recommend(rateRoutes(ROUTES, res, cfg.FAILURE_POINTS)) };
};

// ---- individual checks ----
test('river: normal wastewater flow is ok, not "water under bridge"', () => {
  assert.equal(checkRiver(normalFlows(), ['09486500', '09486520'], cfg.USGS_SITES, cfg.RIVER).level, 'ok');
});
test('river: 2014-size flood is avoid', () => {
  const f = { '09486500': flow([15000, 18000, 20000, 21000, 21200]) };
  const r = checkRiver(f, ['09486500'], cfg.USGS_SITES, cfg.RIVER);
  assert.equal(r.level, 'danger');
  assert.match(r.why, /21,200 cfs/);
});
test('river: no live gauge -> unknown', () => {
  assert.equal(checkRiver({}, ['09486500'], cfg.USGS_SITES, cfg.RIVER).level, 'unknown');
});
test('rain: inches against dip thresholds, heaviest gauge named', () => {
  const s = snapshot({ '6460': { h1: 0.45, h3: 0.5 }, '6110': { h1: 0.1 } });
  const r = checkRain(s, ['6110', '6460', '6480'], cfg.RAIN.local, cfg.RAIN_GAUGES, NOW, cfg.STALE_MS);
  assert.equal(r.level, 'caution');
  assert.equal(r.why, '0.45" of rain in the last 1 hour at Picture Rocks Community Ctr');
  assert.match(r.detail, /last 1 h 0.45" · 3 h 0.50"/);
});
test('rain: Oct 31 2026 light rain (0.20" in 6 h, roads drove fine) is Low', () => {
  const s = snapshot({ '6110': { h6: 0.2, d1: 0.2 } });
  assert.equal(checkRain(s, ['6110', '6460', '6480'], cfg.RAIN.local, cfg.RAIN_GAUGES, NOW, cfg.STALE_MS).level, 'ok');
  assert.equal(checkRain(s, ['6110', '6480'], cfg.RAIN.road, cfg.RAIN_GAUGES, NOW, cfg.STALE_MS).level, 'ok');
});
test('rain: a gauge under maintenance or silent is ignored', () => {
  const s = snapshot();
  s.rain.forEach((g) => { g.maintenance = true; });
  assert.equal(checkRain(s, ['6110'], cfg.RAIN.local, cfg.RAIN_GAUGES, NOW, cfg.STALE_MS).level, 'unknown');
});
test('wash: Brawley flowing upstream is caution for a dip, watch for a bridge', () => {
  const s = snapshot({}, { 6443: 40 });
  assert.equal(checkWash(s, normalFlows(), FP['brawley-dip'].wash, 'dip', NOW, cfg.STALE_MS, cfg.USGS_SITES).level, 'caution');
  assert.equal(checkWash(s, normalFlows(), FP['losrobles-bridge'].wash, 'bridge', NOW, cfg.STALE_MS, cfg.USGS_SITES).level, 'watch');
});
test('county: Closed beats everything, Proceed with Caution is caution', () => {
  assert.equal(checkClosures([{ status: 'Closed', location: 'x' }]).level, 'danger');
  assert.equal(checkClosures([{ status: 'Proceed with Caution', location: 'x' }]).level, 'caution');
});
test('NWS: county-wide Flood Watch changes no score', () => {
  assert.equal(checkNws([{ event: 'Flood Watch' }], 'dip'), null);
  const r = choose(data({ nws: [{ event: 'Flood Watch' }] }));
  assert.ok(r.order.every((x) => x.level === 'ok'), 'every route stays at 1/5');
});
test('NWS: advisory nudges dips only; flash flood warning: dips caution, bridges watch', () => {
  assert.equal(checkNws([{ event: 'Flood Advisory' }], 'dip').level, 'watch');
  assert.equal(checkNws([{ event: 'Flood Advisory' }], 'bridge'), null);
  assert.equal(checkNws([{ event: 'Flash Flood Warning' }], 'dip').level, 'caution');
  assert.equal(checkNws([{ event: 'Flash Flood Warning' }], 'river').level, 'watch');
});
test('river: a peak 3 h ago still counts while it drains', () => {
  const f = { '09486500': flow([200, 1500, 4200, 3500, 2200, 1200, 600, 300, 200, 150, 120, 100, 90]) };
  const r = checkRiver(f, ['09486500'], cfg.USGS_SITES, cfg.RIVER);
  assert.equal(r.level, 'caution');
  assert.match(r.why, /down from 4,200/);
});
test('rain: wet ground from the last 3 days lowers the bar', () => {
  const dry = snapshot({ '6460': { h1: 0.32 } });
  const wet = snapshot({ '6460': { h1: 0.32, d3: 1.1 } });
  const f = (s) => checkRain(s, ['6460'], cfg.RAIN.local, cfg.RAIN_GAUGES, NOW, cfg.STALE_MS);
  assert.equal(f(dry).level, 'watch');
  assert.equal(f(wet).level, 'caution');
  assert.match(f(wet).why, /ground already wet/);
});

// ---- whole-morning scenarios ----
test('dry morning: fastest route (Trico) and nothing flagged', () => {
  const r = choose(data());
  assert.equal(r.best.id, 'trico');
  assert.equal(r.best.level, 'ok');
});
test('storm over Picture Rocks: Avra Valley Rd dips flagged, Trico still fine', () => {
  const r = choose(data({ alert: snapshot({ '6460': { h1: 0.8, h3: 1.3, h6: 1.3 } }) }));
  assert.equal(r.res['brawley-dip'].level, 'danger');
  assert.equal(r.res['elpaso-dip'].level, 'danger');
  assert.notEqual(r.order.find((x) => x.id === 'avra').level, 'ok');
  assert.equal(r.best.id, 'trico');
});
test('county closes Trico-Marana: Silverbell north is next', () => {
  const closures = [{ location: 'Trico Marana Rd west of Marana Town Limit', status: 'Closed', lat: 32.4548, lon: -111.2789 }];
  const r = choose(data({ closures }));
  assert.equal(r.res['sc-trico-marana'].level, 'danger');
  assert.equal(r.best.id, 'silverbell-north');
});
test('Santa Cruz in big flood: every river bridge flagged, least-bad suggested, not "clear"', () => {
  const flows = { ...normalFlows(), '09486500': flow([8000, 9000, 10000, 11000, 12000]), '09486520': flow([6000, 7000, 8000, 9000, 10500]) };
  const r = choose(data({ flows }));
  assert.equal(r.clear, false);
  assert.ok(['caution', 'danger'].includes(r.best.level));
});
test('rain data missing: dips are unknown, never clear', () => {
  const r = choose(data({ alert: null }));
  assert.equal(r.res['brawley-dip'].level, 'unknown');
  assert.equal(r.order.find((x) => x.id === 'avra').level, 'unknown');
});
test('heavy basin rain is only a heads-up at the Los Robles bridge', () => {
  const r = choose(data({ alert: snapshot({ '6460': { h1: 0.6, h3: 0.9, h6: 0.95 } }) }));
  assert.equal(r.res['losrobles-bridge'].level, 'watch');
  assert.equal(r.best.id, 'trico');
  assert.equal(r.clear, true);
});
test('Silverbell drainage is never worse than caution', () => {
  const r = choose(data({ alert: snapshot({ '6110': { h1: 2, h3: 3 } }) }));
  assert.equal(r.res['silverbell-drainage'].level, 'caution');
});

// ---- real data from Oct 31, 2026 (light rain day) ----
test('real Oct 31 2026 data parses and produces a recommendation', () => {
  const closuresJson = fx('closures-2026-10-31.json');
  const closures = closuresJson.features.map((f) => ({ location: f.attributes.Location, status: f.attributes.Status, lat: f.geometry.y, lon: f.geometry.x }));
  const flows = Object.fromEntries(Object.keys(cfg.USGS_SITES).map((s) => [s, summarizeFlow(parseContinuous(fx(`usgs-${s}-2026-10-31.json`)), NOW, cfg.STALE_MS)]));
  const alert = fx('alert-2026-10-31.json');
  const r = choose({ now: Date.parse(alert.fetched_at) + 60e3, flows, closures, alert, nws: [] });
  assert.ok(Object.values(flows).every((f) => f.fresh), 'all 5 USGS gauges live');
  assert.ok(closures.some((c) => /Brawley/.test(c.location)));
  assert.ok(r.best);
  // County barricade points line up with our failure points.
  assert.ok(r.res['brawley-dip'].closurePts.some((c) => /west of the Brawley Wash/.test(c.location)));
  assert.ok(r.res['elpaso-dip'].closurePts.some((c) => /El Paso Gas/.test(c.location)));
});

test('Google Maps link forces the route through its waypoints', () => {
  const u = new URL(googleMapsUrl(cfg.NAV['silverbell-north'], 'Tucson Mall'));
  assert.equal(u.searchParams.get('destination'), 'Tucson Mall');
  assert.equal(u.searchParams.get('waypoints').split('|').length, 3);
});

test('angel never praises a source that is bad elsewhere on the same route', () => {
  const closures = [
    { location: 'Avra Valley Rd west of the Brawley Wash', status: 'Closed', lat: 32.3932, lon: -111.2956 },
    { location: 'Avra Valley Rd west of El Paso Gas Rd', status: 'Open', lat: 32.3933, lon: -111.2766 },
  ];
  const r = choose(data({ closures }));
  const avra = r.order.find((x) => x.id === 'avra');
  assert.ok(!goodSigns(avra, true).some((t) => /county/.test(t)));
  assert.equal(againstIt(avra)[0].level, 'danger');
  assert.equal(riskScore(r.res['brawley-dip']), 5);
});
test('dry morning: angel lists the good signs, nothing against', () => {
  const r = choose(data());
  assert.deepEqual(goodSigns(r.best, true), ['the Santa Cruz is at its everyday flow', 'Brawley Wash upstream is dry', 'no rain in the last 6 hours', 'no weather-service flood alerts']);
  assert.equal(againstIt(r.best).length, 0);
});
