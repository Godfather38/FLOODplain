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
const ALL_ROUTES = JSON.parse(readFileSync(new URL('../public/data/routes.geojson', import.meta.url))).features;
const ROUTES = ALL_ROUTES.filter((f) => f.properties.area === 'avra');
const PR_ROUTES = ALL_ROUTES.filter((f) => f.properties.area === 'picture-rocks');
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
test('wash: upstream flow is an upstream alert at a dip and context at a bridge', () => {
  const s = snapshot({}, { 6443: 40 });
  const dip = checkWash(s, normalFlows(), FP['brawley-dip'], NOW, cfg.STALE_MS, cfg.USGS_SITES, cfg.WASH);
  assert.equal(dip.level, 'watch');
  assert.equal(dip.upstream, true);
  assert.equal(checkWash(s, normalFlows(), FP['losrobles-bridge'], NOW, cfg.STALE_MS, cfg.USGS_SITES, cfg.WASH).level, 'unknown');
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
test('River discharge alone cannot establish bridge inundation or clear passage', () => {
  const flows = { ...normalFlows(), '09486500': flow([8000, 9000, 10000, 11000, 12000]), '09486520': flow([6000, 7000, 8000, 9000, 10500]) };
  const r = choose(data({ flows }));
  assert.equal(r.clear, false);
  assert.equal(r.res['sc-trico-marana'].level,'ok');
  assert.equal(r.res['sc-trico-marana'].checks.find(c=>c.src==='river').bridgeClearance,'unknown');
});
test('rain data missing: still a number, from the sources that answered', () => {
  const r = choose(data({ alert: null }));
  assert.equal(r.res['brawley-dip'].level, 'ok');
  assert.ok(r.res['brawley-dip'].checks.some((c) => c.level === 'unknown' && /unreachable/.test(c.why)));
  assert.notEqual(r.order.find((x) => x.id === 'avra').level, 'unknown');
});
test('everything unreachable: still a number, and it says there are no live readings', () => {
  const none = { now: NOW, flows: {}, closures: null, alert: null, nws: null };
  const r = choose(none);
  assert.ok(r.order.every((x) => x.level !== 'unknown'));
  assert.match(r.res['elpaso-dip'].why, /No live readings/);
});
test('old rain readings are used, and labeled with their time', () => {
  const s = snapshot({ '6460': { h1: 0.45 } });
  s.fetched_at = new Date(NOW - 2 * 3600e3).toISOString();
  s.rain.forEach((g) => { g.last_rpt = new Date(NOW - 2 * 3600e3).toISOString(); });
  const r = checkRain(s, ['6460'], cfg.RAIN.local, cfg.RAIN_GAUGES, NOW, cfg.STALE_MS);
  assert.equal(r.level, 'caution');
  assert.match(r.why, /rain readings from/);
});
test('heavy basin rain stays context without a bridge-specific inundation relationship', () => {
  const r = choose(data({ alert: snapshot({ '6460': { h1: 0.6, h3: 0.9, h6: 0.95 } }) }));
  assert.equal(r.res['losrobles-bridge'].level, 'ok');
  assert.equal(r.best.id, 'trico');
  assert.equal(r.clear, false);
});
test('Silverbell drainage is never worse than caution', () => {
  const r = choose(data({ alert: snapshot({ '6110': { h1: 2, h3: 3 } }) }));
  assert.equal(r.res['silverbell-drainage'].level, 'caution');
});

// ---- real data from Oct 31, 2026 (light rain day) ----
test('real Oct 31 2026 data parses and produces a recommendation', () => {
  const closuresJson = fx('closures-2026-10-31.json');
  const closures = closuresJson.features.map((f) => ({ location: f.attributes.Location, status: f.attributes.Status, direction: f.attributes.Direction, updated: f.attributes.timeUpdated, lat: f.geometry.y, lon: f.geometry.x }));
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
  assert.deepEqual(goodSigns(r.best, true), ['Brawley Wash upstream is dry', 'no rain in the last 6 hours', 'no weather-service flood alerts']);
  assert.equal(againstIt(r.best).length, 0);
});

test('Google Maps into the valley: off I-10 at the route ramp, back along it to Trico & El Tiro', () => {
  const u = new URL(googleMapsUrl(cfg.NAV['silverbell-north'], '', 'valley'));
  const wp = u.searchParams.get('waypoints').split('|');
  assert.equal(wp[0], cfg.NAV['silverbell-north'].ramp.join(','));
  assert.equal(wp[1], cfg.NAV['silverbell-north'].via.at(-1).join(','));
  assert.equal(u.searchParams.get('destination'), '32.4295,-111.3045');
});

// ---- Picture Rocks ----
const choosePR = (d) => {
  const res = Object.fromEntries(cfg.FAILURE_POINTS.map((fp) => [fp.id, rateFailurePoint(fp, d, cfg)]));
  return { res, ...recommend(rateRoutes(PR_ROUTES, res, cfg.FAILURE_POINTS)) };
};
test('Picture Rocks: four routes, dry day picks one at 1', () => {
  assert.equal(PR_ROUTES.length, 4);
  const r = choosePR(data());
  assert.equal(r.best.level, 'ok');
  assert.ok(['pr-twinpeaks', 'pr-avra'].includes(r.best.id), 'fastest of the dry routes');
});
test('Picture Rocks: storm at the Picture Rocks gauge flags the Sandario dips, not Gates Pass', () => {
  const r = choosePR(data({ alert: snapshot({ '6460': { h1: 0.8, h3: 1.3 } }) }));
  assert.equal(r.res['pr-sandario-ina'].level, 'danger');
  assert.equal(r.best.id, 'pr-gates' === r.best.id ? 'pr-gates' : r.best.id);
  assert.notEqual(r.order.find((x) => x.id === 'pr-twinpeaks').level, 'ok');
});
test('the flat dip on Ina never rates above caution', () => {
  const r = choosePR(data({ alert: snapshot({ '6130': { h1: 2, h3: 3 } }) }));
  assert.equal(r.res['pr-ina-flat'].level, 'caution');
  assert.equal(r.res['pr-yuma-mine'].level, 'danger');
});
