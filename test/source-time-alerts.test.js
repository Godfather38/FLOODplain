// Nov 6 and 7, 2026: just after Arizona midnight the county ALERT feed sent last_rpt
// "<today>T17:00:00" (5 PM Arizona, which is midnight UTC on the next day) for eight rain
// stations and stream 6443. The owner got "Missing or invalid observation time" for each,
// and a recovery about an hour later. These tests pin down how source times are read,
// how a future time is reported, and that real outages still alert at once.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { makeGas } from './gas-mock.js';
import { USGS_SITES, RAIN_GAUGES, RAIN } from '../public/config.js';
import { alertTimeIso, checkRain, parseCountyClosures } from '../public/logic.js';
import { alertSnapshot } from '../public/engine.js';

const out = join(mkdtempSync(join(tmpdir(), 'srctime-')), 'bundle.gs');
execFileSync(process.execPath, ['tools/build_gas.mjs'], { env: { ...process.env, GAS_OUT: out } });
const SRC = readFileSync(out, 'utf8');
const AZ = (s) => Date.parse(`${s}-07:00`);
const CAPTURE = JSON.parse(readFileSync(new URL('./fixtures/alert-future-stamp-2026-11-07.json', import.meta.url)));

function raw(rainTime, streamTime = rainTime, now) {
  return {
    usgs: Object.fromEntries(Object.keys(USGS_SITES).map((id) => [id, { features: [{ properties: { parameter_code: '00060', value: 0, time: new Date(now).toISOString() } }] }])),
    rain: { data: Object.keys(RAIN_GAUGES).map((site) => ({ site, last_rpt: rainTime, rain: Array(9).fill(0) })) },
    stream: { data: [{ site: '6443', last_rpt: streamTime, flow: 0 }] },
    closures: { features: [] }, nws: { features: [] }, tvClosures: { d: [] }, tvWork: { d: {} },
  };
}
function setup(start) {
  const clock = { now: start };
  const gas = makeGas(clock, SRC, () => { throw Error('network'); });
  const check = (r) => { gas.api.noteOwnerHealth_(gas.api.expectedInputHealth_(r, clock.now), clock.now); gas.api.ownerHealthWatch_(clock.now); };
  return { gas, clock, check };
}
const bad = (gas, r, now) => gas.api.expectedInputHealth_(r, now).filter((x) => x.reason);
const alertIds = [...Object.keys(RAIN_GAUGES).map((s) => 'rain:' + s), 'stream:6443'];

// ---------- reading the source time ----------
test('zone-free ALERT times are Arizona; times with a zone keep it and never get a second one', () => {
  assert.equal(alertTimeIso('2026-11-07T01:00:00'), '2026-11-07T01:00:00-07:00');
  assert.equal(alertTimeIso('2026-11-07 01:00:00'), '2026-11-07T01:00:00-07:00');
  assert.equal(alertTimeIso('2026-11-07T01:00'), '2026-11-07T01:00:00-07:00');
  assert.equal(alertTimeIso('2026-11-07T08:00:00Z'), '2026-11-07T08:00:00Z');
  assert.equal(alertTimeIso('2026-11-07T08:00:00+00:00'), '2026-11-07T08:00:00+00:00');
  assert.equal(alertTimeIso('2026-11-07T01:00:00-0700'), '2026-11-07T01:00:00-07:00');
  assert.equal(alertTimeIso('2026-11-07T01:00:00-07:00'), '2026-11-07T01:00:00-07:00');
  // All of these are the same moment.
  const same = ['2026-11-07T01:00:00', '2026-11-07T08:00:00Z', '2026-11-07T08:00:00+00:00', '2026-11-07T01:00:00-07:00'].map((t) => Date.parse(alertTimeIso(t)));
  assert.ok(same.every((t) => t === AZ('2026-11-07T01:00:00')));
});

test('unreadable source times are null, never guessed', () => {
  for (const v of [null, undefined, '', '   ', 'garbage', '2026-11-07', '2026-02-30T01:00:00', '2026-11-07T24:00:00', '2026-11-07T01:60:00', '2026-13-01T00:00:00', '2026-11-07T01:00:00+25:00', 1794035164000, {}]) {
    assert.equal(alertTimeIso(v), null, String(v));
  }
});

test('alertSnapshot keeps the time as sent (no double zone) and blanks only unreadable ones', () => {
  const row = (site, last_rpt) => ({ site, source: 'pima', name: 'x', latitude: '32.3', longitude: '-111.2', last_rpt, rain: Array(9).fill(0) });
  const snap = alertSnapshot([row('a', '2026-11-07T17:00:00'), row('b', '2026-11-07T08:00:00Z'), row('c', 'bad')], [], AZ('2026-11-07T00:06:00'));
  assert.deepEqual(snap.rain.map((g) => g.last_rpt), ['2026-11-07T17:00:00-07:00', '2026-11-07T08:00:00Z', null]);
});

test('ratings never use a future-stamped rain reading as current (rated unknown, not dry)', () => {
  const now = AZ('2026-11-07T00:06:00');
  const snap = { fetched_at: new Date(now).toISOString(), rain: [{ site: '6110', last_rpt: '2026-11-07T17:00:00-07:00', in: { m10: 0, m30: 0, h1: 0, h3: 0, h6: 0, d1: 0 } }] };
  assert.equal(checkRain(snap, ['6110'], RAIN.local, {}, now, 3 * 3600000).level, 'unknown');
  snap.rain[0].last_rpt = '2026-11-07T00:00:00-07:00';
  assert.equal(checkRain(snap, ['6110'], RAIN.local, {}, now, 3 * 3600000).level, 'ok');
});

// ---------- Arizona midnight ----------
test('Arizona midnight: a reading from just before midnight is fresh just after it', () => {
  const now = AZ('2026-11-07T00:00:30');
  assert.deepEqual(bad(setup(now).gas, raw('2026-11-06T23:55:00', '2026-11-06T23:55:00', now), now), []);
  // Exactly at the observation time is not the future.
  const at = AZ('2026-11-07T00:00:00');
  assert.deepEqual(bad(setup(at).gas, raw('2026-11-07T00:00:00', '2026-11-07T00:00:00', at), at), []);
  // One second before midnight, a midnight stamp is in the future.
  const before = AZ('2026-11-06T23:59:59');
  const r = bad(setup(before).gas, raw('2026-11-07T00:00:00', '2026-11-07T00:00:00', before), before);
  assert.deepEqual(r.map((x) => x.id).sort(), [...alertIds].sort());
  assert.ok(r.every((x) => x.kind === 'upstream-time' && x.aheadMinutes === 1));
});

test('times sent with a zone are compared as sent, across Arizona midnight', () => {
  const now = AZ('2026-11-07T00:06:00');
  for (const t of ['2026-11-07T07:00:00Z', '2026-11-07T07:00:00+00:00', '2026-11-07T00:00:00-07:00']) {
    assert.deepEqual(bad(setup(now).gas, raw(t, t, now), now), [], t);
  }
  const r = bad(setup(now).gas, raw('2026-11-08T00:00:00Z', '2026-11-08T00:00:00Z', now), now);
  assert.equal(r.length, alertIds.length);
  assert.ok(r.every((x) => x.kind === 'upstream-time'));
});

// ---------- the Nov 7 episode, replayed ----------
test('Nov 7 replay: a future time is an upstream time error, held, and silent when it clears within the hour', () => {
  const { gas, clock, check } = setup(AZ('2026-11-06T23:59:00'));
  check(raw('2026-11-06T23:00:00', '2026-11-06T23:45:00', clock.now));
  assert.equal(gas.mails.length, 0);
  clock.now = Date.parse('2026-11-07T07:05:59.635Z'); // the alert's "Since"
  const issues = bad(gas, raw('2026-11-07T17:00:00', '2026-11-07T17:00:00', clock.now), clock.now);
  assert.deepEqual(issues.map((x) => x.id).sort(), [...alertIds].sort());
  for (const x of issues) {
    assert.equal(x.reason, 'Upstream time error: observation time is in the future');
    assert.equal(x.kind, 'upstream-time');
    assert.equal(x.sourceTime, '2026-11-07T17:00:00');
    assert.equal(x.aheadMinutes, 1015); // the -1015 minutes in the real email
    assert.equal(x.observedAt, null, 'a future time is not reported as the last observation');
  }
  for (let m = 0; m <= 58; m += 1) { clock.now = Date.parse('2026-11-07T07:05:59.635Z') + m * 60000; check(raw('2026-11-07T17:00:00', '2026-11-07T17:00:00', clock.now)); }
  assert.equal(gas.mails.length, 0, 'held during the confirmation window');
  clock.now = AZ('2026-11-07T01:04:05'); // recovered at 08:04:05Z
  check(raw('2026-11-07T01:00:00', '2026-11-07T01:00:00', clock.now));
  assert.equal(gas.mails.length, 0, 'no problem was sent, so no recovery is sent');
  const state = JSON.parse(gas.props.get('ownerHealth:rain:6110'));
  assert.equal(state.reason, '');
  assert.equal(state.sourceTime, undefined, 'cleared fields do not linger');
});

test('a future time that persists past the hold is sent, explained, then recovers', () => {
  const { gas, clock, check } = setup(AZ('2026-11-07T00:06:00'));
  const future = () => raw('2026-11-07T17:00:00', '2026-11-07T17:00:00', clock.now);
  check(future());
  clock.now += 74 * 60000; check(future());
  assert.equal(gas.mails.length, 0);
  clock.now += 2 * 60000; check(future());
  assert.equal(gas.mails.length, 1);
  const body = gas.mails[0].body;
  assert.match(body, /PROBLEM: rain:6110/);
  assert.match(body, /Upstream time error: observation time is in the future/);
  assert.match(body, /Type: Upstream data error: the source answered/);
  assert.doesNotMatch(body, /Lost connection/);
  assert.match(body, /Time as sent by the source: 2026-11-07T17:00:00 \(read as Arizona time when it has no zone; \d+ minutes after this check\)/);
  assert.match(body, /Held 75 minutes before sending/);
  assert.doesNotMatch(body, /Observation age at check: -/);
  clock.now += 60000; check(raw('2026-11-07T01:00:00', '2026-11-07T01:00:00', clock.now));
  assert.equal(gas.mails.length, 2);
  assert.match(gas.mails[1].body, /RECOVERED: rain:6110/);
});

// ---------- real outages still alert at once ----------
test('a lost connection alerts at once and says so; it is not called a data error', () => {
  const { gas, clock, check } = setup(AZ('2026-11-07T00:06:00'));
  const r = raw('2026-11-07T00:00:00', '2026-11-07T00:00:00', clock.now);
  r.rain = null; r.stream = null; r.closures = null;
  check(r);
  assert.equal(gas.mails.length, 1);
  const body = gas.mails[0].body;
  assert.match(body, /PROBLEM: rain:6110\nExpected: [^\n]+\nCrossings: [^\n]+\nResult: Source unavailable\nType: Lost connection/);
  assert.match(body, /PROBLEM: county[\s\S]*?Type: Lost connection/);
  assert.doesNotMatch(body, /Held \d+ minutes/);
  assert.doesNotMatch(body, /Upstream data error/);
});

test('genuinely stale and missing stations alert at once, each with its own type', () => {
  const now = AZ('2026-11-07T00:06:00');
  const { gas, check } = setup(now);
  const r = raw('2026-11-07T00:00:00', '2026-11-06T20:00:00', now); // stream 4 h old
  r.rain.data = r.rain.data.filter((d) => d.site !== '6110'); // station gone from the list
  r.rain.data.find((d) => d.site === '6460').last_rpt = '2026-11-05T23:00:00'; // rain over a day old
  r.rain.data.find((d) => d.site === '6480').last_rpt = ''; // no time at all
  r.rain.data.find((d) => d.site === '6440').last_rpt = '2026-11-31T00:00:00'; // not a real date
  const byId = Object.fromEntries(bad(gas, r, now).map((x) => [x.id, x]));
  assert.equal(byId['stream:6443'].reason, 'Stale reading'); assert.equal(byId['stream:6443'].kind, 'stale');
  assert.equal(byId['stream:6443'].ageMinutes, 246);
  assert.equal(byId['rain:6460'].kind, 'stale');
  assert.equal(byId['rain:6110'].reason, 'Expected station absent'); assert.equal(byId['rain:6110'].kind, 'upstream-data');
  assert.equal(byId['rain:6480'].reason, 'Upstream time error: no observation time');
  assert.equal(byId['rain:6440'].reason, 'Upstream time error: unreadable observation time');
  assert.equal(byId['rain:6440'].sourceTime, '2026-11-31T00:00:00');
  check(r);
  assert.equal(gas.mails.length, 1, 'no hold for stale, absent, missing or unreadable times');
  assert.match(gas.mails[0].body, /Type: Stale: the source answered/);
});

test('a future USGS time is reported at once (the hold is only for the county ALERT feed)', () => {
  const now = AZ('2026-11-07T00:06:00');
  const { gas, check } = setup(now);
  const r = raw('2026-11-07T00:00:00', '2026-11-07T00:00:00', now);
  r.usgs['09486500'].features[0].properties.time = '2026-11-08T00:00:00Z';
  const issue = bad(gas, r, now);
  assert.equal(issue.length, 1);
  assert.equal(issue[0].kind, 'upstream-time');
  assert.equal(issue[0].confirmAfterMs, undefined);
  check(r);
  assert.equal(gas.mails.length, 1);
  assert.doesNotMatch(gas.mails[0].body, /Held/);
  // A USGS time with no zone is unreadable, not assumed to be Arizona.
  r.usgs['09486500'].features[0].properties.time = '2026-11-07T00:00:00';
  assert.equal(bad(gas, r, now)[0].reason, 'Upstream time error: unreadable observation time');
});

test('the captured live feed: stations stamped 5 PM today are future; normal stations are fresh', () => {
  const now = Date.parse(CAPTURE.capturedAt);
  const future = CAPTURE.data.filter((d) => d.last_rpt === '2026-11-07T17:00:00');
  assert.equal(future.length, 6);
  for (const d of future) assert.ok(Date.parse(alertTimeIso(d.last_rpt)) > now, d.site);
  for (const d of CAPTURE.data.filter((x) => ['6110', '6460'].includes(x.site))) {
    const t = Date.parse(alertTimeIso(d.last_rpt));
    assert.ok(t <= now && now - t < 3 * 3600000, d.site + ' ' + d.last_rpt);
  }
  // Fed to the health check, only configured stations count, and none of the six are configured.
  const r = raw('2026-11-07T10:00:00', '2026-11-07T10:00:00', now);
  r.rain.data = [...r.rain.data.filter((d) => !CAPTURE.data.some((c) => c.site === d.site)), ...CAPTURE.data];
  assert.deepEqual(bad(setup(now).gas, r, now), []);
});

test('a future time in the feed does not break the assessment itself', () => {
  const now = AZ('2026-11-07T00:06:00');
  const clock = { now };
  const gas = makeGas(clock, SRC, (reqs) => {
    const r = raw('2026-11-07T17:00:00', '2026-11-07T17:00:00', now);
    return reqs.map(({ url }) => {
      const site = /USGS-(\d+)/.exec(url)?.[1];
      const body = site ? r.usgs[site] : url.includes('arcgis') ? r.closures : url.includes('currain') ? r.rain : url.includes('currentstream') ? r.stream
        : url.includes('weather.gov') ? r.nws : url.includes('GetConstructionEvents') ? r.tvWork : r.tvClosures;
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify(body) };
    });
  });
  assert.ok(gas.api.computeVerdict_('avra'));
  assert.equal(JSON.parse(gas.props.get('ownerHealth:compute')).reason, '');
  assert.equal(JSON.parse(gas.props.get('ownerHealth:rain:6110')).kind, 'upstream-time');
  const health = JSON.parse(gas.props.get('health'));
  assert.ok(health.rain.lastOk && !health.rain.downSince, 'the rain feed answered; it is not marked down');
});

// ---------- county record with no Status (separate from the time episode) ----------
test('a county record with no Status is a county data gap, not a lost connection; the county stays up', () => {
  const now = AZ('2026-11-07T00:06:00');
  const incomplete = JSON.parse(readFileSync(new URL('./fixtures/county-incomplete-2026-11-05.json', import.meta.url)));
  const parsed = parseCountyClosures(incomplete);
  assert.notEqual(parsed.points, null, 'the county answered with readable records');
  assert.equal(parsed.complete, false);
  const { gas, check } = setup(now);
  const r = raw('2026-11-07T00:00:00', '2026-11-07T00:00:00', now);
  r.closures = incomplete;
  const county = gas.api.expectedInputHealth_(r, now).find((x) => x.id === 'county');
  assert.equal(county.reason, 'Incomplete county records: W Gates Pass Rd: missing Status');
  assert.equal(county.kind, 'upstream-data');
  check(r);
  assert.equal(gas.mails.length, 1, 'still alerted: the status is genuinely unknown');
  assert.match(gas.mails[0].body, /PROBLEM: county[\s\S]*Type: Upstream data error: the source answered, but this part of its data is missing or malformed/);
  assert.doesNotMatch(gas.mails[0].body, /Held \d+ minutes/);
});

test('legacy health: county answered means up; incomplete records are tracked separately', () => {
  const now = AZ('2026-11-07T00:06:00');
  const incomplete = JSON.parse(readFileSync(new URL('./fixtures/county-incomplete-2026-11-05.json', import.meta.url)));
  for (const [closures, county, records] of [[incomplete, 'lastOk', 'downSince'], [{ features: [] }, 'lastOk', 'lastOk'], [null, 'downSince', 'downSince'], [{ error: { code: 500 } }, 'downSince', 'downSince']]) {
    const clock = { now };
    const gas = makeGas(clock, SRC, (reqs) => {
      const r = raw('2026-11-07T00:00:00', '2026-11-07T00:00:00', now);
      return reqs.map(({ url }) => {
        if (url.includes('arcgis')) return { getResponseCode: () => (closures ? 200 : 503), getContentText: () => JSON.stringify(closures) };
        const site = /USGS-(\d+)/.exec(url)?.[1];
        const body = site ? r.usgs[site] : url.includes('currain') ? r.rain : url.includes('currentstream') ? r.stream
          : url.includes('weather.gov') ? r.nws : url.includes('GetConstructionEvents') ? r.tvWork : r.tvClosures;
        return { getResponseCode: () => 200, getContentText: () => JSON.stringify(body) };
      });
    });
    gas.api.computeVerdict_('avra');
    const health = JSON.parse(gas.props.get('health'));
    assert.ok(county in health.county, JSON.stringify([closures, health.county]));
    assert.ok(records in health.countyRecords, JSON.stringify([closures, health.countyRecords]));
  }
});

// ---------- the GitHub snapshot script reads times the same way ----------
test('snapshot_alert.py: zone-free is Arizona, a zone is kept, unreadable is None', (t) => {
  const py = ['python3', 'python'].find((p) => spawnSync(p, ['-c', 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)']).status === 0);
  if (!py) { t.skip('Python 3.11+ not available'); return; }
  const code = 'import json,sys; sys.path.insert(0,"tools"); from snapshot_alert import iso; print(json.dumps([iso(v) for v in json.loads(sys.argv[1])]))';
  const input = ['2026-11-07T17:00:00', '2026-11-07T08:00:00Z', '2026-11-07T08:00:00+00:00', '2026-11-07T01:00:00-07:00', 'bad', '', '2026-11-07', null];
  const res = spawnSync(py, ['-c', code, JSON.stringify(input)], { encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr);
  const got = JSON.parse(res.stdout);
  assert.deepEqual(got, ['2026-11-07T17:00:00-07:00', '2026-11-07T08:00:00+00:00', '2026-11-07T08:00:00+00:00', '2026-11-07T01:00:00-07:00', null, null, null, null]);
  for (const [i, v] of input.entries()) if (got[i]) assert.equal(Date.parse(got[i]), Date.parse(alertTimeIso(v)), String(v));
});
