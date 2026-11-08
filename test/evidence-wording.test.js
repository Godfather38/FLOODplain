// A crossing with no rated source names what did answer (docs/EVIDENCE-FIXES-20261108.md).
// Sanders Rd river bridge said "No live readings right now" while both its river gauges reported:
// with no roadway height to compare against, its river row is unknown, and every unknown row was
// summarised as silence. These tests pin the wording and pin that no level or score moves.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as cfg from '../public/config.js';
import { rateFailurePoint, riskScore, recommend, evidenceState, gaugePhrases, evidenceSentence, NO_READINGS, goodSigns } from '../public/logic.js';
import { applyHand, handCheck, matchFailurePoints } from '../public/hand-model.js';
import { conditionsNotEstablished } from '../public/route-status.js';
import { bridgeRecordFor } from '../public/simulation/bridge-evidence.js';

const read = (p) => JSON.parse(readFileSync(new URL('../public/' + p, import.meta.url)));
const registry = read('simulation/data/bridge-evidence-registry.json');
const now = Date.parse('2026-11-08T18:00:00Z');
const fp = (id) => cfg.FAILURE_POINTS.find((p) => p.id === id);
const bridgeEvidence = Object.fromEntries(cfg.FAILURE_POINTS.map((p) => [p.id, bridgeRecordFor(p, registry)]).filter(([, r]) => r));
const flowing = { '09486500': { fresh: true, cfs: 12, risingFast: false, time: now }, '09486520': { fresh: true, cfs: 3, risingFast: false, time: now } };
const day = (over = {}) => ({ now, bridgeEvidence, flows: flowing, closures: [], nws: [], alert: { rain: [], stream: [] }, ...over });

test('Sanders Rd: two reporting river gauges are named, not called "no live readings"', () => {
  const r = rateFailurePoint(fp('sc-sanders'), day(), cfg);
  assert.equal(r.why, '2 river gauges reporting, nothing measuring this road itself');
  assert.doesNotMatch(r.why, /No live readings/);
  assert.equal(r.checks[0].src, 'remote-only');
  assert.match(r.checks[0].detail, /inferred from readings taken elsewhere/);
  const river = r.checks.find((c) => c.src === 'river');
  assert.match(river.why, /Roadway elevation estimate is missing\. The river gauge readings are listed/);
});

test('the number, the level and "not clear" are exactly what they were', () => {
  for (const id of ['sc-sanders', 'sc-trico-marana', 'sc-avra']) {
    const r = rateFailurePoint(fp(id), day(), cfg);
    assert.equal(r.level, 'ok'); assert.equal(riskScore(r), 1); assert.equal(r.evidenceAvailable, false);
    assert.ok(conditionsNotEstablished(r), `${id} is still listed as not established`);
    assert.equal(recommend([{ level: r.level, minutes: 10, points: [r] }]).clear, false);
  }
});

test('a real silence still says there are no live readings', () => {
  const r = rateFailurePoint(fp('sc-sanders'), day({ flows: {} }), cfg);
  assert.equal(r.why, NO_READINGS);
  assert.equal(r.checks[0].src, 'none');
  assert.match(r.checks.find((c) => c.src === 'river').why, /No river gauge reading either\.$/);
  assert.equal(riskScore(r), 1);
});

test('gauge kinds are kept apart and one gauge listed twice counts once', () => {
  const s = evidenceState([
    { src: 'river', evidence: 'remote', gaugeIds: ['a', 'b'] }, { src: 'river-early', evidence: 'remote', gaugeIds: ['b'] },
    { src: 'rain-local', evidence: 'remote', gaugeIds: ['r1'] }, { src: 'hand', evidence: 'unsupported' }, { src: 'wash', evidence: 'missing' },
  ]);
  assert.deepEqual(gaugePhrases(s), ['2 river gauges', '1 rain gauge']);
  assert.deepEqual(s.unsupported, ['hand']); assert.deepEqual(s.missing, ['wash']);
  assert.equal(evidenceSentence(s), '2 river gauges and 1 rain gauge reporting, nothing measuring this road itself');
  assert.equal(evidenceSentence({ ...evidenceState([]), model: true }), 'A model estimate, nothing measuring this road itself');
});

test('each source says what kind of evidence it is', () => {
  const closed = rateFailurePoint(fp('sc-sanders'), day({ closures: [{ lat: fp('sc-sanders').lat, lon: fp('sc-sanders').lon, status: 'Closed', location: 'Sanders' }] }), cfg);
  assert.equal(closed.checks.find((c) => c.src === 'county').evidence, 'observed');
  assert.equal(riskScore(closed), 5, 'a closure still rates 5');
  assert.equal(rateFailurePoint(fp('sc-sanders'), day(), cfg).checks.find((c) => c.src === 'river').evidence, 'remote');
  const warned = rateFailurePoint(fp('sc-sanders'), day({ nws: [{ event: 'Flash Flood Warning' }] }), cfg);
  assert.equal(warned.checks.find((c) => c.src === 'nws').evidence, 'official');
});

test('a HAND estimate added afterwards is named in the summary row, and still moves nothing at a bridge', () => {
  const row = matchFailurePoints(cfg.FAILURE_POINTS, read('inundation/data/coverage.json').points)['sc-trico-marana'];
  const peak = { flowM3s: 20 * 0.028316846592, time: '2026-11-08T19:00:00Z' };
  const hand = handCheck(row, { status: 'ok', issueAgeHours: 1, peak, points: [peak] }, now);
  assert.equal(hand.evidence, 'model');
  const r = rateFailurePoint(fp('sc-trico-marana'), day(), cfg), results = { 'sc-trico-marana': r };
  applyHand(results, { checks: { 'sc-trico-marana': hand } });
  assert.equal(r.why, '2 river gauges reporting plus a model estimate, nothing measuring this road itself');
  assert.equal(r.checks.filter((c) => c.evidence === 'summary').length, 1);
  assert.equal(riskScore(r), 1); assert.equal(r.level, 'ok');
  const outside = handCheck({ status: 'unsupported', evidence: 'no reach' }, null, now);
  assert.equal(outside.evidence, 'unsupported'); assert.match(outside.why, /does not cover this crossing/);
});

test('everyday river flow is a good sign again where no roadway comparison exists', () => {
  const r = rateFailurePoint(fp('sc-sanders'), day(), cfg);
  assert.ok(goodSigns({ points: [r] }, false).includes('the Santa Cruz is at its everyday flow'));
  const high = rateFailurePoint(fp('sc-sanders'), day({ flows: { '09486500': { fresh: true, cfs: 4350, risingFast: false, time: now } } }), cfg);
  assert.ok(!goodSigns({ points: [high] }, false).includes('the Santa Cruz is at its everyday flow'));
});

test('the alert service carries the same wording', () => {
  const gas = readFileSync(new URL('../apps-script/WashWatch.gs', import.meta.url), 'utf8');
  assert.match(gas, /function evidenceSentence\(/);
  assert.match(gas, /nothing measuring this road itself/);
});
