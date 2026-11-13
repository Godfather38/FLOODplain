// Regression checks for the Brawley upstream-gauge correction.
// Background and the before/after numbers: docs/BRAWLEY-UPSTREAM-EVIDENCE.md
//
// The bug: the Brawley Wash dip on Avra Valley Rd is scored from two gauges that sit miles up
// the wash (USGS 09487000 near Three Points, about 22 mi; county ALERT 6443 at Milewide,
// about 10 mi). The old rule took the bigger of the two and called anything at or above
// 500 cfs "a flood is coming down the wash toward this crossing" -> danger -> 5/5, with no
// travel time, channel loss or road depth anywhere in it, while the county's own barricade
// point at the crossing said Proceed with Caution.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as cfg from '../public/config.js';
import {
  parseContinuous, summarizeFlow, checkWash, checkRain, checkClosures, crossingLead,
  rateFailurePoint, rateRoutes, recommend, routeScore, riskScore, againstIt, goodSigns,
} from '../public/logic.js';
import { message } from '../public/engine.js';

const ROUTES = JSON.parse(readFileSync(new URL('../public/data/routes.geojson', import.meta.url)))
  .features.filter((f) => f.properties.area === 'avra');
const FP = Object.fromEntries(cfg.FAILURE_POINTS.map((f) => [f.id, f]));
const NOW = Date.parse('2026-11-01T20:04:00-07:00'); // what the live app saw, Arizona time

// ---- builders ----
const usgs = (values) => parseContinuous({
  features: values.map((v, i) => ({ properties: { time: new Date(NOW - (values.length - 1 - i) * 900e3).toISOString(), value: String(v), parameter_code: '00060' } })),
});
const flow = (values) => summarizeFlow(usgs(values), NOW, cfg.STALE_MS);
const steady = (v) => flow([v, v, v, v, v]);
const flows = (brawleyCfs = 0) => ({
  '09486500': steady(41), '09486520': steady(29), '09486055': steady(0), '09486350': steady(0),
  '09487000': brawleyCfs === 'rising' ? flow([10, 20, 60, 150, 300]) : steady(brawleyCfs),
});
const rainGauge = (site) => ({
  site, name: site, last_rpt: new Date(NOW - 10 * 60e3).toISOString(), maintenance: false,
  in: { m10: 0, m30: 0, h1: 0, h3: 0, h6: 0, d1: 0 },
});
// Brawley Wash at Milewide Rd, with the coordinates the county publishes for it.
const milewide = (cfs, over = {}) => ({
  site: '6443', name: 'Brawley Wash at Milewide Road (PT)', lat: 32.248611, lon: -111.244446,
  last_rpt: new Date(NOW - 10 * 60e3).toISOString(), maintenance: false, stage_ft: 2.3, flow_cfs: cfs, ...over,
});
const snapshot = (streamCfs = 0, over = {}) => ({
  fetched_at: new Date(NOW - 5 * 60e3).toISOString(),
  rain: Object.keys(cfg.RAIN_GAUGES).map(rainGauge),
  stream: [milewide(streamCfs, over)],
});
// The county's point at the dip: about 305 ft from it, so it matches (radius 450 m).
const countyAtDip = (status, over = {}) => ({
  location: 'Avra Valley Rd west of the Brawley Wash', status, direction: 'Eastbound',
  updated: '11/01/26, 11:48', lat: 32.39322, lon: -111.29352, ...over,
});
// A second county point 843 m east: outside the radius, and "Open" there says nothing here.
const openDownTheRoad = { location: 'Avra Valley Rd west of El Paso Gas Rd', status: 'Open', direction: 'All Directions', updated: '10/06/26, 11:35', lat: 32.39322, lon: -111.28562 };

const data = (over = {}) => ({ now: NOW, flows: flows(), closures: [], alert: snapshot(), nws: [], ...over });
const choose = (d) => {
  const res = Object.fromEntries(cfg.FAILURE_POINTS.map((fp) => [fp.id, rateFailurePoint(fp, d, cfg)]));
  const rated = rateRoutes(ROUTES, res, cfg.FAILURE_POINTS).map((r) => ({ ...r, score: routeScore(r) }));
  return { res, rated, ...recommend(rated) };
};
// The November 1 conditions: county Proceed with Caution, 817 cfs at Milewide, 1,160 cfs at Three Points.
const nov1 = (over = {}) => data({ flows: flows(1160), alert: snapshot(817), closures: [countyAtDip('Proceed with Caution'), openDownTheRoad], ...over });
const washCheck = (point) => point.checks.find((c) => c.src === 'wash');
// The Brawley dip on its own, so no other crossing's unknowns can hide its own.
const brawleyAlone = (d) => {
  const p = rateFailurePoint(FP['brawley-dip'], d, cfg);
  const rated = rateRoutes([{ properties: { id: 'avra', name: 'Avra Valley Rd', minutes: 20, km: 20 } }], { 'brawley-dip': p }, [FP['brawley-dip']])
    .map((r) => ({ ...r, score: routeScore(r) }));
  return { p, rated, ...recommend(rated) };
};

// ---- the reported case ----
test('Nov 1: both upstream gauges are over the old 500 cfs line, and that no longer makes the road severe', () => {
  // The inputs that used to produce danger/5-of-5 are unchanged and still cross the threshold.
  assert.ok(1160 >= cfg.WASH.bigFlowCfs && 817 >= cfg.WASH.bigFlowCfs, 'the old rule would have fired');
  const r = choose(nov1());
  const p = r.res['brawley-dip'];
  const wash = washCheck(p);
  assert.equal(wash.level, 'watch', 'an upstream reading is a watch, not a flood at this road');
  assert.equal(wash.upstream, true);
  assert.equal(wash.upstreamAlert, 'big-flow', 'the big flow is still called out');
  assert.equal(p.level, 'watch', 'neither an upstream gauge nor a lone county caution puts water at this road');
  assert.equal(riskScore(p), 2, 'was 5, then 3');
  assert.match(p.why, /County says Proceed with Caution: Avra Valley Rd west of the Brawley Wash, eastbound \(updated 11\/01\/26, 11:48\)/);
});

test('the upstream numbers are still shown, with how far away each sensor is', () => {
  const wash = washCheck(choose(nov1()).res['brawley-dip']);
  assert.match(wash.why, /1,160 cfs in Brawley Wash near Three Points/);
  assert.match(wash.why, /about 22.1 mi away in a straight line/);
  assert.match(wash.why, /a big flow is running in the wash upstream of here/);
  assert.match(wash.why, /Whether it reaches this crossing, when, and how deep is not established/);
  assert.match(wash.detail, /Brawley Wash at Milewide Road: 817 cfs at 7:54 PM, about 10.4 mi away in a straight line/);
  assert.match(wash.detail, /No rating curve, travel time or channel-loss relation/);
  assert.deepEqual(wash.observations.map((o) => [o.name, o.cfs, Math.round(o.milesAway)]), [
    ['Brawley Wash near Three Points', 1160, 22],
    ['Brawley Wash at Milewide Road', 817, 10],
  ]);
});

test('the county point at the dip matches and the Open point 843 m away does not', () => {
  const p = choose(nov1()).res['brawley-dip'];
  assert.deepEqual(p.closurePts.map((c) => c.location), ['Avra Valley Rd west of the Brawley Wash']);
  assert.ok(!goodSigns(choose(nov1()).rated.find((x) => x.id === 'avra'), true).some((t) => /county|dry/.test(t)),
    'no "barricades are Open" and no "wash is dry" on this route');
});

test('route numbers: Avra Valley Rd reads 2 of 5, not 5 of 5, and nothing is called clear', () => {
  const r = choose(nov1());
  assert.equal(r.rated.find((x) => x.id === 'avra').score, 2, 'was 5, then 3');
  assert.equal(r.best.id, 'trico', 'the routes that skip this dip still rank ahead of it');
  assert.equal(r.clear, false, 'water running up the wash keeps every route off "clear"');
  const against = againstIt(r.rated.find((x) => x.id === 'avra'));
  assert.equal(against[0].level, 'watch');
  assert.ok(against.some((a) => /cfs/.test(a.why)) || /cfs/.test(washCheck(r.res['brawley-dip']).why));
});

test('the phone text keeps the number that changed and never claims a flood at the road', () => {
  const r = choose(nov1());
  const m = message(r.best, r.order, r.rated, [], NOW);
  assert.match(m.sms, /^take Trico-Marana \(1\/5 Low, \d+ min\)\./);
  assert.match(m.sms, /Avra Valley Rd 2/);
  assert.ok(!/flood is coming down the wash/.test(m.sms + m.text + m.spoken));
  const p = r.res['brawley-dip'];
  assert.ok(!/flood is coming down the wash/.test(p.why + washCheck(p).why + washCheck(p).detail));
  for (const line of [p.why, washCheck(p).why]) assert.ok(line.length < 300 && /[.:]/.test(line), 'reads as a sentence on a phone');
});

// ---- what still rates the road ----
test('a county closure still overrides everything, and the upstream alert stays listed', () => {
  const r = choose(nov1({ closures: [countyAtDip('Closed')] }));
  const p = r.res['brawley-dip'];
  assert.equal(p.level, 'danger');
  assert.equal(riskScore(p), 5);
  assert.match(p.why, /County says CLOSED: Avra Valley Rd west of the Brawley Wash, eastbound/);
  assert.equal(washCheck(p).upstreamAlert, 'big-flow', 'still there, not erased by the closure');
  assert.equal(r.clear, false);
});

test('the local evidence this crossing really has is all still wired up', () => {
  // No sensor measures this pavement, so these are the paths that can rate it. Each one is
  // exercised here; none of them is a depth measurement, and the road-status row says so.
  const closed = choose(nov1({ closures: [countyAtDip('Closed')] })).res['brawley-dip'];
  assert.equal(closed.level, 'danger', 'county closure');
  const caution = choose(nov1()).res['brawley-dip'];
  assert.equal(caution.level, 'watch', 'county Proceed with Caution, no local sign');
  const wet = snapshot(0);
  for (const g of wet.rain) if (g.site === '6110') g.in = { ...g.in, h1: 0.45, h3: 0.6 };
  assert.equal(choose(data({ alert: wet })).res['brawley-dip'].level, 'caution', 'rain over the crossing');
  assert.equal(choose(data({ nws: [{ event: 'Flash Flood Warning' }] })).res['brawley-dip'].level, 'caution', 'NWS warning');
  // The HAND model row is added separately by hand-model.js and is labeled as a model.
  assert.ok(!cfg.FAILURE_POINTS.some((fp) => fp.wash?.atCrossing), 'no at-crossing sensor rule exists');
});

test('heavy rain on the crossing itself still rates it, so this is not a blanket downgrade', () => {
  const s = snapshot(0);
  for (const g of s.rain) if (g.site === '6110') g.in = { ...g.in, h1: 0.8, h3: 1.3, h6: 1.3 };
  const r = choose(data({ alert: s }));
  assert.equal(r.res['brawley-dip'].level, 'danger');
  assert.equal(r.res['elpaso-dip'].level, 'danger', 'the dips with no wash gauge are untouched');
  assert.equal(riskScore(r.res['brawley-dip']), 5);
});

test('rising fast upstream is called out, but still is not a flood at this road', () => {
  const w = checkWash(snapshot(0), flows('rising'), FP['brawley-dip'], NOW, cfg.STALE_MS, cfg.USGS_SITES, cfg.WASH);
  assert.equal(w.level, 'watch');
  assert.equal(w.upstreamAlert, 'big-flow');
  assert.match(w.why, /300 cfs in Brawley Wash near Three Points, rising fast/);
});

// ---- missing, stale and unknown ----
test('stale sensors read as no reading, not as dry and not as safe', () => {
  const stale = snapshot(817, { last_rpt: new Date(NOW - 4 * 3600e3).toISOString() });
  const old = { ...flows(1160), '09487000': summarizeFlow(usgs([1160]), NOW + 4 * 3600e3, cfg.STALE_MS) };
  const w = checkWash(stale, old, FP['brawley-dip'], NOW, cfg.STALE_MS, cfg.USGS_SITES, cfg.WASH);
  assert.equal(w.level, 'unknown');
  assert.equal(w.why, 'no wash flow sensor reading');
  const p = choose(data({ alert: stale, flows: old })).res['brawley-dip'];
  assert.ok(!/dry/.test(p.why), 'a silent sensor never reports the wash as dry');
  assert.ok(p.checks.some((c) => c.src === 'wash' && c.level === 'unknown'));
});

test('no county data and no wash reading: still a number, and still not clear', () => {
  const r = choose({ now: NOW, flows: {}, closures: null, alert: null, nws: null });
  const p = r.res['brawley-dip'];
  assert.equal(washCheck(p).level, 'unknown');
  assert.equal(washCheck(p).why, 'no wash flow sensor reading');
  assert.match(p.why, /No live readings/);
  assert.equal(p.evidenceAvailable, false);
  assert.equal(r.clear, false);
  assert.ok(r.rated.every((x) => Number.isInteger(x.score)), 'every route still shows a number');
});

test('a maintenance flag or a negative flow is not a reading', () => {
  const sensorOnly = { ...FP['brawley-dip'], wash: { alert: ['6443'] } };
  for (const over of [{ maintenance: true }, { flow_cfs: -1 }, { flow_cfs: null }]) {
    const w = checkWash(snapshot(817, over), flows(), sensorOnly, NOW, cfg.STALE_MS, cfg.USGS_SITES, cfg.WASH);
    assert.equal(w.level, 'unknown');
  }
});

test('a dry wash still reads dry, and the good sign still appears', () => {
  const r = choose(data());
  const p = r.res['brawley-dip'];
  assert.equal(washCheck(p).level, 'ok');
  assert.equal(washCheck(p).why, 'Brawley Wash upstream is dry');
  assert.equal(p.level, 'ok');
  assert.ok(goodSigns(r.best, true).includes('Brawley Wash upstream is dry'));
  assert.equal(r.rated.find((x) => x.id === 'avra').score, 1);
});

// ---- the other crossing on the same gauges ----
test('the Los Robles bridge keeps the same gauges as context only', () => {
  const r = choose(nov1());
  const p = r.res['losrobles-bridge'];
  const wash = washCheck(p);
  assert.equal(wash.level, 'unknown');
  assert.equal(wash.contextOnly, true);
  assert.match(wash.why, /upstream measurement; no site-specific roadway elevation comparison/);
  assert.match(wash.why, /about 25.\d mi away in a straight line/, 'farther still from the bridge');
  assert.equal(r.rated.find((x) => x.id === 'trico').score, 1, 'unchanged by this work');
  assert.equal(cfg.FAILURE_POINTS.filter((fp) => fp.wash).map((fp) => fp.id).join(','), 'brawley-dip,losrobles-bridge',
    'these two are the only crossings the wash rule touches');
});

// ---- the summary line under the number ----
test('the summary leads with the county status, direction and time, not a depth sentence', () => {
  const p = choose(nov1()).res['brawley-dip'];
  const lead = crossingLead(p);
  assert.equal(lead, 'County says Proceed with Caution: Avra Valley Rd west of the Brawley Wash, eastbound (updated 11/01/26, 11:48). That is the county reporting this road, not a measurement of how deep the water is. No local rain, weather alert or flood model shows water at this road right now.');
  assert.ok(!/Water likely at or near the road/.test(lead), 'the generic level sentence does not lead');
});

test('an upstream-only watch never says "Usually passable"', () => {
  const p = brawleyAlone(data({ flows: flows(1160), alert: snapshot(817) })).p;
  assert.equal(p.level, 'watch');
  const lead = crossingLead(p);
  assert.ok(!/Usually passable/.test(lead), 'no passability claim from an upstream reading');
  assert.match(lead, /1,160 cfs in Brawley Wash near Three Points/, 'the upstream reading still leads');
  assert.match(lead, /Nothing here reports this road, so whether you can get through is unknown/);
});

test('a quiet crossing says nothing reports it, rather than calling it dry', () => {
  const p = brawleyAlone(data()).p;
  assert.equal(p.level, 'ok');
  assert.match(crossingLead(p), /Nothing in the data reports this crossing itself\. A quiet reading miles upstream is not a dry road/);
});

test('the crossing screen uses that lead instead of the level sentence', () => {
  const src = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.ok(src.includes("crossingLead(p) ?? (p.evidenceAvailable===false?'Current road conditions are not established.':LEVEL_SENTENCE[p.level])"), 'app.js leads with evidence and does not call missing evidence normal');
  assert.match(src, /'road-status': \['🛑', 'This crossing itself'\]/, 'the road-status row has a label');
});

// ---- nothing reports this road ----
test('Brawley alone is never clear without a county report, however quiet the wash is', () => {
  const cases = {
    'dry upstream, no rain, no county match': data(),
    'stale sensors': data({ alert: snapshot(817, { last_rpt: new Date(NOW - 4 * 3600e3).toISOString() }), flows: {} }),
    'no data at all': { now: NOW, flows: {}, closures: null, alert: null, nws: null },
    'big flow upstream': data({ flows: flows(1160), alert: snapshot(817) }),
    'county point with an unreadable status': data({ closures: [countyAtDip('')] }),
  };
  for (const [name, d] of Object.entries(cases)) {
    const r = brawleyAlone(d);
    const road = r.p.checks.find((c) => c.src === 'road-status');
    assert.equal(r.clear, false, `not clear: ${name}`);
    assert.equal(road?.roadStatus, 'unknown', `road status unknown: ${name}`);
    assert.equal(road.level, 'unknown', `and it changes no number: ${name}`);
    assert.ok(Number.isInteger(r.rated[0].score), `still a number: ${name}`);
  }
  assert.equal(brawleyAlone(data()).rated[0].score, 1, 'a quiet day still reads 1 of 5');
  assert.equal(brawleyAlone(data({ flows: flows(1160), alert: snapshot(817) })).rated[0].score, 2);
});

test('a readable county report at the crossing is the local road status, and can be clear', () => {
  const r = brawleyAlone(data({ closures: [countyAtDip('Open')] }));
  assert.ok(!r.p.checks.some((c) => c.src === 'road-status'), 'the county is reporting this road');
  assert.equal(r.p.level, 'ok');
  assert.equal(r.clear, true, 'the one case where Brawley can read clear');
});

// ---- county statuses ----
test('a missing or unrecognized county status is unknown, never Open', () => {
  for (const status of [undefined, '', '   ', 'Unknown', 'Restricted', 'Water on roadway']) {
    const c = checkClosures([{ location: 'x', status, updated: '11/01/26, 11:48' }]);
    assert.equal(c.level, 'unknown', `status ${JSON.stringify(status)}`);
    assert.equal(c.roadStatus, 'unknown');
    assert.match(c.why, /status is not readable/);
  }
  assert.equal(checkClosures([{ location: 'x', status: 'Open' }]).level, 'ok');
});

test('one unreadable status among Open ones cannot be reported as all Open', () => {
  const mixed = checkClosures([
    { location: 'a', status: 'Open', updated: '10/06/26, 11:35' },
    { location: 'b', status: '', updated: '11/01/26, 11:48' },
  ]);
  assert.equal(mixed.level, 'unknown');
  assert.match(mixed.why, /b says "no status in the county feed"/);
  assert.match(mixed.detail, /a: Open \(updated 10\/06\/26, 11:35\)/, 'both points are still shown');
  // An actual closure or caution still wins over anything unreadable.
  assert.equal(checkClosures([{ location: 'a', status: '' }, { location: 'b', status: 'Closed' }]).level, 'danger');
  assert.equal(checkClosures([{ location: 'a', status: '' }, { location: 'b', status: 'Proceed with Caution' }]).level, 'caution');
  assert.equal(checkClosures([{ location: 'a', status: 'Open' }, { location: 'b', status: 'Closed' }]).level, 'danger');
});

// ---- readings that should not be believed ----
test('a reading stamped in the future is not a reading', () => {
  const ahead = snapshot(817, { last_rpt: new Date(NOW + 10 * 60e3).toISOString() });
  const only6443 = { ...FP['brawley-dip'], wash: { alert: ['6443'] } };
  assert.equal(checkWash(ahead, {}, only6443, NOW, cfg.STALE_MS, cfg.USGS_SITES, cfg.WASH).level, 'unknown');
  const futureRain = snapshot(0);
  for (const g of futureRain.rain) { g.last_rpt = new Date(NOW + 3600e3).toISOString(); g.in = { ...g.in, h1: 5 }; }
  assert.equal(checkRain(futureRain, ['6110'], cfg.RAIN.local, cfg.RAIN_GAUGES, NOW, cfg.STALE_MS).level, 'unknown');
});

test('a fresh flag with a bad number or a future time is not a reading', () => {
  for (const f of [
    { fresh: true, cfs: Number.NaN, time: NOW }, { fresh: true, cfs: null, time: NOW },
    { fresh: true, cfs: -5, time: NOW }, { fresh: true, cfs: 1160, time: NOW + 60 * 60e3 },
    { fresh: true, cfs: 1160, time: Number.NaN },
  ]) {
    const w = checkWash(snapshot(0), { '09487000': f }, { ...FP['brawley-dip'], wash: { usgs: ['09487000'] } }, NOW, cfg.STALE_MS, cfg.USGS_SITES, cfg.WASH);
    assert.equal(w.level, 'unknown', `rejected ${JSON.stringify(f)}`);
  }
});

test('each reading keeps its own source timestamp, and both are there to inspect', () => {
  const s = snapshot(817);
  const w = washCheck(choose(nov1({ alert: s })).res['brawley-dip']);
  assert.deepEqual(w.observations.map((o) => [o.cfs, o.observedAt, o.time]), [
    [1160, new Date(NOW).toISOString(), NOW],
    [817, s.stream[0].last_rpt, Date.parse(s.stream[0].last_rpt)],
  ]);
  assert.match(w.detail, /1,160 cfs at 8:04 PM/);
  assert.match(w.detail, /817 cfs at 7:54 PM/);
});

// ---- the experimental preview ----
test('the preview in public/ux-preview is exactly what the engine produces', () => {
  const preview = JSON.parse(readFileSync(new URL('../public/ux-preview/brawley-upstream-checks.json', import.meta.url)));
  const r = choose(nov1());
  const p = r.res['brawley-dip'];
  const labels = { county: 'County barricade', wash: 'Wash flow upstream', 'rain-local': 'Rain here', 'rain-basin': 'Rain upstream' };
  assert.deepEqual(preview.after.rows, p.checks.map((c) => ({ label: labels[c.src], source: c.src, level: c.level, why: c.why, detail: c.detail ?? null })));
  assert.equal(preview.after.summary, crossingLead(p), 'the line under the number');
  assert.equal(preview.after.headline, p.why);
  assert.equal(preview.after.level, p.level);
  assert.equal(preview.after.crossingNumber, riskScore(p));
  assert.equal(preview.after.upstreamAlert, washCheck(p).upstreamAlert);
  assert.equal(preview.after.clear, r.clear);
  for (const [name, n] of Object.entries(preview.routeNumbers)) {
    const route = r.rated.find((x) => cfg.ROUTE_INFO[x.id].name === name);
    assert.equal(route.score, n.after, `${name} reads ${n.after} of 5`);
  }
});

// ---- the county's own words ----
test('county status, direction and update time stay whole and independent', () => {
  const c = checkClosures([countyAtDip('Proceed with Caution')]);
  assert.equal(c.level, 'caution');
  assert.equal(c.detail, 'Avra Valley Rd west of the Brawley Wash: Proceed with Caution, eastbound (updated 11/01/26, 11:48)');
  const all = checkClosures([{ location: 'x', status: 'Open', direction: 'All Directions', updated: '10/06/26, 11:35' }]);
  assert.equal(all.detail, 'x: Open (updated 10/06/26, 11:35)', '"All Directions" adds nothing to read');
  assert.equal(checkClosures([{ location: 'x', status: 'Open' }]).detail, 'x: Open');
});

test('every path that loads county points asks for Direction and carries it', () => {
  // The browser fetches the county layer itself, so changing engine.js alone leaves the
  // phone without the direction. A live phone check caught exactly that.
  for (const file of ['../public/app.js', '../public/engine.js']) {
    const src = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.match(src, /outFields: 'Location,Status,Direction,timeUpdated'/, `${file} requests Direction`);
    assert.match(src, /parseCountyClosures/, `${file} uses the shared parser that carries Direction through`);
  }
});
