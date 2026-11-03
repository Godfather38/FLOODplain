// What the screens say about evidence, state by state. The point of these is wording, not rating:
// every case here also asserts the number and the recommendation are untouched.
//
// The bug this file pins down: Sanders Rd river bridge had its two river gauges reporting and a
// HAND estimate on the board, and the crossing still said "No live readings right now". The river
// check reads unknown there because no roadway-height comparison exists for that structure, and
// "no rating produced" was being printed as "no readings". A missing local gauge, a missing
// comparison and a silent feed are three different things and now read as three different things.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as cfg from '../public/config.js';
import { rateFailurePoint, riskScore, recommend, evidenceState, evidenceSentence, gaugePhrases, crossingLead, goodSigns } from '../public/logic.js';
import { applyHand, handCheck, matchFailurePoints, CALM_WITH_FLOW } from '../public/hand-model.js';
import { bridgeRecordFor } from '../public/simulation/bridge-evidence.js';

const read = (p) => readFileSync(new URL('../public/' + p, import.meta.url), 'utf8');
const registry = JSON.parse(read('simulation/data/bridge-evidence-registry.json'));
const coverage = JSON.parse(read('inundation/data/coverage.json'));
const byFp = matchFailurePoints(cfg.FAILURE_POINTS, coverage.points);
const NOW = Date.parse('2026-11-01T21:20:00Z');
const SANDERS = cfg.FAILURE_POINTS.find((p) => p.id === 'sc-sanders');
const DIP = cfg.FAILURE_POINTS.find((p) => p.id === 'brawley-dip');
const records = Object.fromEntries(cfg.FAILURE_POINTS.map((p) => [p.id, bridgeRecordFor(p, registry)]));

// Claims the app must never make from inference alone.
const OVERCLAIM = /\bsafe\b|passable|impassable|guarantee|confirmed clear|observed at the (road|crossing)|measured on the road/i;
const forecast = (cfs) => ({ status: 'ok', issueAgeHours: 2, points: [{ flowM3s: cfs * 0.028316846592, time: '2026-11-02T00:00:00Z' }] });
const rain = (inches) => ({
  fetched_at: new Date(NOW).toISOString(),
  rain: ['6110', '6460', '6480', '6440', '6420'].map((site) => ({ site, name: site, last_rpt: new Date(NOW).toISOString(), in: { h1: inches, h3: inches, h6: inches, d1: inches } })),
  stream: [{ site: '6443', name: 'Brawley Wash at Milewide Rd', flow_cfs: 0, last_rpt: new Date(NOW - 600000).toISOString(), lat: 32.2481, lon: -111.2371 }],
});
// One crossing, rated the way the app rates it: the engine first, then HAND layered on top.
const rate = (fp, d, hand = null) => {
  const results = { [fp.id]: rateFailurePoint(fp, d, cfg) };
  if (hand) applyHand(results, { checks: { [fp.id]: hand } });
  return results[fp.id];
};
const summaryRow = (p) => p.checks.find((c) => c.evidence === 'summary' && ['none', 'remote-only'].includes(c.src));
const asRoute = (p) => ({ id: 'r', level: p.level, minutes: 10, points: [p] });

// ---- 1. remote gauges and a model estimate, with no gauge at the crossing ----
test('reporting river gauges and a model estimate are never called "no live readings"', () => {
  const d = {
    now: NOW, closures: [], nws: [], alert: { rain: [], stream: [] }, bridgeEvidence: records,
    flows: { '09486500': { fresh: true, cfs: 52, time: NOW - 600000 }, '09486520': { fresh: true, cfs: 31, time: NOW - 900000 } },
  };
  const p = rate(SANDERS, d, handCheck(byFp['sc-sanders'], forecast(300), NOW));
  assert.doesNotMatch(p.why, /No live readings/, 'two gauges are reporting, so nothing may say there are no readings');
  assert.match(p.why, /2 river gauges reporting/);
  assert.match(p.why, /a model estimate/);
  assert.match(p.why, /nothing measuring this road itself/);
  assert.doesNotMatch(p.why + summaryRow(p).detail, OVERCLAIM);
  const state = evidenceState(p.checks);
  assert.deepEqual(gaugePhrases(state), ['2 river gauges']);
  assert.equal(state.model, true);
  assert.equal(state.observed, false, 'a gauge in the river is not a report from the road');
  assert.deepEqual([...state.missing, ...state.stale], [], 'nothing was expected and absent here');
  // The river row says which thing is missing: the comparison, not the gauge.
  const river = p.checks.find((c) => c.src === 'river');
  assert.equal(river.evidence, 'remote');
  assert.match(river.why, /Roadway elevation estimate is missing\. The gauge readings below stand/);
  assert.match(river.detail, /Cortaro Rd: 52 cfs/);
  // Nothing about the rating or the recommendation moves.
  assert.equal(riskScore(p), 1);
  assert.equal(recommend([asRoute(p)]).clear, false, 'inferred conditions still never read as clear');
});

// ---- 2. a report from the road itself ----
test('the county report is marked as the one source that looked at the road', () => {
  const closures = [{ lat: DIP.lat, lon: DIP.lon, status: 'Proceed with Caution', location: 'Avra Valley Rd west of the Brawley Wash', direction: 'Eastbound', updated: '11/01/26, 11:48' }];
  const p = rate(DIP, { now: NOW, flows: {}, closures, alert: rain(0), nws: [] }, handCheck(byFp['brawley-dip'], forecast(2), NOW));
  const state = evidenceState(p.checks);
  assert.equal(state.observed, true);
  assert.equal(p.checks.find((c) => c.src === 'county').evidence, 'observed');
  for (const src of ['wash', 'rain-local', 'rain-basin', 'hand']) {
    assert.notEqual(p.checks.find((c) => c.src === src).evidence, 'observed', src + ' is not an observation of the road');
  }
  assert.match(crossingLead(p), /That is the county reporting this road, not a measurement of how deep the water is/);
  assert.equal(riskScore(p), 2);
});

// ---- 3. expected inputs genuinely missing or stale ----
test('a real silence says so, and a stale forecast is told apart from a missing one', () => {
  const dead = { now: NOW, flows: { '09486500': { fresh: false } }, closures: null, alert: null, nws: null, bridgeEvidence: null };
  const p = rate(SANDERS, dead, handCheck(byFp['sc-sanders'], { status: 'error', reason: 'NOAA did not answer' }, NOW));
  assert.match(p.why, /No live readings right now/);
  assert.equal(summaryRow(p).src, 'none');
  const state = evidenceState(p.checks);
  assert.equal(state.remoteGauges, 0);
  assert.equal(state.model, false, 'a failed forecast is not a model estimate');
  assert.deepEqual([...state.missing].sort(), ['hand', 'river']);
  assert.equal(p.evidenceAvailable, false);
  assert.equal(recommend([asRoute(p)]).clear, false);
  assert.ok(Number.isInteger(riskScore(p)), 'a silent feed still leaves a number, never a question mark');
  // Stale is its own state: the forecast arrived, it is just old.
  const old = handCheck(byFp['sc-sanders'], { status: 'stale', issueAgeHours: 40, points: forecast(300).points }, NOW);
  assert.equal(old.evidence, 'stale');
  assert.match(old.why, /old forecast/);
});

// ---- 4. a model estimate on its own ----
test('a model estimate alone is named as an estimate, not an outage and not an observation', () => {
  const d = { now: NOW, flows: {}, closures: [], nws: [], alert: { rain: [], stream: [] }, bridgeEvidence: null };
  const p = rate(SANDERS, d, handCheck(byFp['sc-sanders'], forecast(300), NOW));
  assert.match(p.why, /^A model estimate, nothing measuring this road itself$/);
  assert.doesNotMatch(p.why, /No live readings/);
  const state = evidenceState(p.checks);
  assert.equal(state.model, true);
  assert.deepEqual(gaugePhrases(state), [], 'no gauge answered, so none is claimed');
  assert.deepEqual(state.missing, ['river'], 'the river gauges were expected and absent, and that is said');
  // The estimate never borrows the gauges it was not shown to come from.
  assert.doesNotMatch(evidenceSentence(state), /from (them|those readings)/);
  assert.equal(recommend([asRoute(p)]).clear, false);
});

// ---- a crossing the model does not cover is not a broken crossing ----
test('no coverage reads as coverage, not as a failure, and keeps the readings that did arrive', () => {
  const uncovered = handCheck({ status: 'too_far', evidence: 'nearest modeled reach is 900 m away' }, null, NOW);
  assert.equal(uncovered.evidence, 'unsupported');
  assert.match(uncovered.why, /does not cover this crossing/);
  assert.doesNotMatch(uncovered.why, /no estimate here|unavailable|error|failed/i);
  const d = { now: NOW, flows: { '09486500': { fresh: true, cfs: 52, time: NOW - 600000 } }, closures: [], nws: [], alert: { rain: [], stream: [] }, bridgeEvidence: null };
  const p = rate(SANDERS, d, uncovered);
  const state = evidenceState(p.checks);
  assert.deepEqual(state.unsupported, ['hand']);
  assert.deepEqual(state.missing, [], 'an uncovered crossing is not a missing feed');
  assert.match(p.why, /1 river gauge reporting/, 'the gauge that answered is still named');
});

// ---- the quiet ungauged dip ----
test('a quiet dip leads with the evidence it has instead of reading as broken', () => {
  const p = rate(DIP, { now: NOW, flows: {}, closures: [], alert: rain(0), nws: [] }, handCheck(byFp['brawley-dip'], forecast(2), NOW));
  const road = p.checks.find((c) => c.src === 'road-status');
  assert.equal(road.roadStatus, 'unknown', 'the road is still unrated, which is what keeps it off clear');
  assert.match(road.why, /its evidence is all off-site: nearby rain, upstream wash flow and the flood model/);
  const lead = crossingLead(p);
  assert.match(lead, /^Nearby gauges and the flood model are what this number is built on\./, 'the evidence comes first');
  assert.match(lead, /A quiet reading miles upstream is not a dry road/);
  assert.doesNotMatch(lead, OVERCLAIM);
  const state = evidenceState(p.checks);
  assert.deepEqual(gaugePhrases(state), ['1 wash flow sensor', '5 rain gauges']);
  assert.equal(recommend([asRoute(p)]).clear, false);
  assert.equal(riskScore(p), 1);
});

// ---- a reporting gauge is not erased by a missing bridge comparison ----
test('everyday river flow stays a good sign even where no roadway comparison exists', () => {
  const flows = { '09486500': { fresh: true, cfs: 52, time: NOW - 600000 }, '09486520': { fresh: true, cfs: 31, time: NOW - 900000 } };
  const p = rate(SANDERS, { now: NOW, flows, closures: [], nws: [], alert: { rain: [], stream: [] }, bridgeEvidence: null });
  const river = p.checks.find((c) => c.src === 'river');
  assert.equal(river.level, 'unknown', 'the bridge-specific rating is still unknown');
  assert.equal(river.dischargeLevel, 'ok', 'the discharge the gauges reported is still ok');
  assert.deepEqual(goodSigns(asRoute(p), true), ['the Santa Cruz is at its everyday flow', 'no weather-service flood alerts']);
  // A gauge that is actually running takes the sign away again.
  const wet = rate(SANDERS, { now: NOW, flows: { '09486500': { fresh: true, cfs: 4350, time: NOW } }, closures: [], nws: [], alert: { rain: [], stream: [] }, bridgeEvidence: null });
  assert.ok(!goodSigns(asRoute(wet), true).includes('the Santa Cruz is at its everyday flow'));
  // So does a gauge that said nothing at all.
  const silent = rate(SANDERS, { now: NOW, flows: {}, closures: [], nws: [], alert: { rain: [], stream: [] }, bridgeEvidence: null });
  assert.ok(!goodSigns(asRoute(silent), true).includes('the Santa Cruz is at its everyday flow'));
});

// ---- the screens ----
test('each crossing carries one evidence line, and the app has no second safety line', () => {
  const app = read('app.js');
  assert.match(app, /<h3 class="section">What each source says<\/h3>\s*\r?\n\s*<p class="meta"[^>]*>\$\{esc\(evidenceLine\(p\)\)\}<\/p>/);
  // The model estimate is never attributed to the gauges listed beside it.
  const line = app.match(/function evidenceLine\(p\) \{[\s\S]*?\n\}/)[0];
  assert.match(line, /built\.push\('a model estimate'\)/);
  assert.doesNotMatch(line, /from those readings|from them/);
  // One safety line, on the home screen, and it puts the driver's own judgement first.
  const fine = app.match(/<p class="fine">FLOODplain[^<]*<\/p>/)[0];
  assert.match(fine, /your own eyes and your own judgement come first/);
  assert.match(fine, /if a crossing feels wrong, don't take it/);
  assert.match(fine, /turn around, don't drown\./);
  assert.equal(app.match(/turn around, don't drown/g).length, 1, 'the safety line is not repeated across screens');
  // The source labels say which row is which.
  assert.match(app, /none: \['…', 'No source answered'\]/);
  assert.match(app, /'remote-only': \['📡', 'Evidence from elsewhere'\]/);
});

test('the calm line reports what the readings indicate without observing the crossing', () => {
  assert.match(CALM_WITH_FLOW, /none of them is a reading at this crossing/);
  assert.doesNotMatch(CALM_WITH_FLOW, /show no water|no water here\./, 'no claim that water is absent at the crossing');
  assert.doesNotMatch(CALM_WITH_FLOW, OVERCLAIM);
});

test('an uncovered tracking location is described by its sources, not promised coverage', () => {
  const tracking = read('simulation/route-tracking.js');
  assert.match(tracking, /No model forecast covers this spot/);
  assert.match(tracking, /Each location lists only the sources that actually reach it\./);
  assert.doesNotMatch(tracking, /rated from the nearest gauges/, 'coverage is never invented for a location that has none');
});
