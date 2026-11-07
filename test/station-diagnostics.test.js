// Nov 7, 2026: stream station 6443 (Brawley Wash at Milewide Rd) was reported missing at
// 21:54 UTC and recovered at 21:59 UTC with an observation from 21:00 UTC. The old check
// called it "Expected station absent" whether the county sent a readable list without the
// station or a list it could not read, and the original response was not kept, so which one
// happened is unknown. These tests cover the bounded, sanitized diagnostics that tell
// those cases apart from a lost connection, stale data and bad times, without any delay.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { makeGas } from './gas-mock.js';
import { USGS_SITES, RAIN_GAUGES } from '../public/config.js';
import { sourceResponse, jsonShape, findAlertStation } from '../public/logic.js';
import { loadPublic } from '../worker/index.js';

const out = join(mkdtempSync(join(tmpdir(), 'stationdiag-')), 'bundle.gs');
execFileSync(process.execPath, ['tools/build_gas.mjs'], { env: { ...process.env, GAS_OUT: out } });
const SRC = readFileSync(out, 'utf8');
const AZ = (s) => Date.parse(`${s}-07:00`);
const ok = (value) => sourceResponse(200, JSON.stringify(value)).meta;

function raw(now, streamRows = [{ site: '6443', last_rpt: '2026-11-07T14:00:00', flow: 0 }]) {
  const r = {
    usgs: Object.fromEntries(Object.keys(USGS_SITES).map((id) => [id, { features: [{ properties: { parameter_code: '00060', value: 0, time: new Date(now).toISOString() } }] }])),
    rain: { data: Object.keys(RAIN_GAUGES).map((site) => ({ site, last_rpt: '2026-11-07T14:00:00', rain: Array(9).fill(0) })) },
    stream: { data: streamRows },
    closures: { features: [] }, nws: { features: [] }, tvClosures: { d: [] }, tvWork: { d: {} },
  };
  r.meta = { usgs: Object.fromEntries(Object.entries(r.usgs).map(([k, v]) => [k, ok(v)])), ...Object.fromEntries(['closures', 'rain', 'stream', 'nws', 'tvClosures', 'tvWork'].map((k) => [k, ok(r[k])])) };
  return r;
}
function setup(start) {
  const clock = { now: start };
  const gas = makeGas(clock, SRC, () => { throw Error('network'); });
  const check = (r) => { gas.api.noteOwnerHealth_(gas.api.expectedInputHealth_(r, clock.now), clock.now); gas.api.ownerHealthWatch_(clock.now); };
  const stream = (r) => gas.api.expectedInputHealth_(r, clock.now).find((x) => x.id === 'stream:6443');
  return { gas, clock, check, stream };
}
const Z = (s) => Date.parse(s);

// ---------- the response description ----------
test('response metadata: status, size, JSON or not, and shape with key names only', () => {
  assert.deepEqual(sourceResponse(null, null).meta, { httpStatus: null, bytes: null, outcome: 'no-response' });
  assert.deepEqual(sourceResponse(503, 'Service Unavailable').meta, { httpStatus: 503, bytes: 19, outcome: 'http-error' });
  assert.equal(sourceResponse(503, '{"data":[]}').value, null, 'an HTTP error is never used, even when JSON');
  assert.deepEqual(sourceResponse(200, '  ').meta, { httpStatus: 200, bytes: 2, outcome: 'empty' });
  assert.deepEqual(sourceResponse(200, '<html>maintenance</html>').meta, { httpStatus: 200, bytes: 24, outcome: 'not-json' });
  const good = sourceResponse(200, '{"data":[{"site":"6443"}],"count":1}');
  assert.deepEqual(good.meta, { httpStatus: 200, bytes: 36, outcome: 'json', shape: 'object{data,count}' });
  assert.deepEqual(good.value, { data: [{ site: '6443' }], count: 1 });
});

test('shape never carries values, odd key names or more than eight keys', () => {
  assert.equal(jsonShape([1, 2, 3]), 'array(3)');
  assert.equal(jsonShape('secret-token-value'), 'string');
  assert.equal(jsonShape(null), 'null');
  assert.equal(jsonShape({ 'https://x.example/?key=abc': 1, 'me@example.com': 2, ok: 3 }), 'object{?,?,ok}');
  assert.equal(jsonShape(Object.fromEntries(Array.from({ length: 11 }, (_, i) => ['k' + i, 'v' + i]))), 'object{k0,k1,k2,k3,k4,k5,k6,k7,+3}');
  assert.doesNotMatch(jsonShape({ token: 'abcdef123456' }), /abcdef/);
});

// ---------- finding the station ----------
test('station IDs match as text or number; spaces are ignored, leading zeros are not', () => {
  assert.equal(findAlertStation({ data: [{ site: '6443' }] }, '6443').status, 'present');
  const numeric = findAlertStation({ data: [{ site: 6443 }, { site: '6440' }] }, '6443');
  assert.equal(numeric.status, 'present');
  assert.deepEqual([numeric.stringIds, numeric.numericIds, numeric.unreadable, numeric.stationCount], [1, 1, 0, 2]);
  assert.equal(findAlertStation({ data: [{ site: ' 6443 ' }] }, '6443').status, 'present');
  assert.equal(findAlertStation({ data: [{ site: '06443' }] }, '6443').status, 'absent');
});

test('absent, empty, partial and malformed lists are told apart, and nothing throws', () => {
  assert.equal(findAlertStation({ data: [{ site: '6440' }, { site: 6420 }] }, '6443').status, 'absent');
  assert.equal(findAlertStation({ data: [] }, '6443').status, 'empty');
  assert.equal(findAlertStation({ data: [null, { site: '6440' }] }, '6443').status, 'partial');
  for (const body of [{ data: [null, 7, 'x', [], { site: null }, { site_id: '6443' }] }, { data: [{ data: [{ site: '6443' }] }] }]) {
    assert.equal(findAlertStation(body, '6443').status, 'malformed', JSON.stringify(body));
  }
  assert.deepEqual(findAlertStation({ data: { site: '6443' } }, '6443'), { status: 'malformed', row: null, stationCount: null, detail: 'data is object{site}' });
  assert.equal(findAlertStation({ error: 'busy' }, '6443').detail, 'no data list');
  assert.equal(findAlertStation([{ site: '6443' }], '6443').detail, 'no data list');
  assert.equal(findAlertStation('text', '6443').status, 'malformed');
});

// ---------- the owner check ----------
test('a normal response is healthy for text and number station IDs, with no diagnostic noise', () => {
  const now = Z('2026-11-07T21:54:00Z');
  for (const site of ['6443', 6443]) {
    const { stream } = setup(now);
    const row = stream(raw(now, [{ site, last_rpt: '2026-11-07T14:00:00', flow: 3 }]));
    assert.equal(row.reason, '');
    assert.equal(row.diagnostic, undefined);
    assert.equal(row.response, undefined);
  }
});

test('Nov 7 replay: a readable list without 6443 alerts at once with metadata, then recovers', () => {
  const t0 = Z('2026-11-07T21:54:00Z');
  const { gas, clock, check, stream } = setup(t0);
  const r = raw(t0, [{ site: '6440', last_rpt: '2026-11-07T14:50:00', flow: 0 }, { site: 6420, last_rpt: '2026-11-07T14:50:00', flow: 0 }]);
  const row = stream(r);
  assert.equal(row.reason, 'Expected station absent from a readable list');
  assert.equal(row.kind, 'upstream-data');
  assert.deepEqual(row.response, { checkedAt: '2026-11-07T21:54:00.000Z', httpStatus: 200, outcome: 'json', bytes: JSON.stringify(r.stream).length, shape: 'object{data}', checkedStation: '6443', stationCount: 2, stringIds: 1, numericIds: 1, unreadable: 0 });
  assert.match(row.diagnostic, /^HTTP 200, JSON object\{data\}, \d+ bytes; 2 station entries \(1 text IDs, 1 number IDs, 0 unreadable\); checked station 6443; checked at 2026-11-07T21:54:00.000Z$/);
  check(r);
  assert.equal(gas.mails.length, 1, 'no delay before reporting a genuinely missing station');
  assert.match(gas.mails[0].body, /PROBLEM: stream:6443\n[\s\S]*Result: Expected station absent from a readable list\nType: Upstream data error[^\n]*\nDiagnostic: HTTP 200, JSON object\{data\}/);
  clock.now = Z('2026-11-07T21:59:00Z');
  check(raw(clock.now)); // 6443 back, last_rpt 14:00 Arizona = 21:00 UTC
  assert.equal(gas.mails.length, 2);
  assert.match(gas.mails[1].body, /RECOVERED: stream:6443\n[\s\S]*Last observation: 2026-11-07T21:00:00.000Z\nObservation age at check: 59 minutes/);
  assert.doesNotMatch(gas.mails[1].body.split('RECOVERED: stream:6443')[1].split('RECOVERED:')[0], /Diagnostic:/);
  const state = JSON.parse(gas.props.get('ownerHealth:stream:6443'));
  assert.equal(state.reason, '');
  assert.equal(state.diagnostic, undefined, 'diagnostics are cleared on recovery');
  assert.equal(state.response, undefined);
});

test('the same moment with a malformed envelope gives a different reason than an absent station', () => {
  const now = Z('2026-11-07T21:54:00Z');
  const { stream } = setup(now);
  const reasons = {};
  for (const [name, body] of Object.entries({
    absent: { data: [{ site: '6440', last_rpt: '2026-11-07T14:50:00', flow: 0 }] },
    notAList: { data: { site: '6443' } },
    noData: { error: 'Database busy' },
    nested: { data: [{ data: [{ site: '6443' }] }] },
    empty: { data: [] },
    partial: { data: [null, { site: '6440', last_rpt: '2026-11-07T14:50:00', flow: 0 }] },
  })) {
    const r = raw(now); r.stream = body; r.meta.stream = ok(body);
    const row = stream(r);
    reasons[name] = row.reason;
    assert.equal(row.kind, 'upstream-data', name);
    assert.equal(row.response.checkedStation, '6443');
  }
  assert.deepEqual(reasons, {
    absent: 'Expected station absent from a readable list',
    notAList: 'Malformed station list', noData: 'Malformed station list', nested: 'Malformed station list',
    empty: 'Empty station list',
    partial: 'Expected station absent; some list entries unreadable',
  });
  const r = raw(now); r.stream = { error: 'Database busy' }; r.meta.stream = ok(r.stream);
  assert.match(stream(r).diagnostic, /JSON object\{error\}.*no data list.*checked station 6443/);
  assert.doesNotMatch(stream(r).diagnostic, /Database busy/, 'values from the body are never copied');
});

test('unavailable source vs malformed response: HTTP status and body type decide', () => {
  const now = Z('2026-11-07T21:54:00Z');
  const { stream } = setup(now);
  const cases = [
    [sourceResponse(null, null), 'Source unavailable', 'connection', /^no HTTP response; checked station 6443/],
    [sourceResponse(503, 'Service Unavailable'), 'Source unavailable', 'connection', /^HTTP 503, 19 bytes; checked station 6443/],
    [sourceResponse(200, '<html>down</html>'), 'Malformed response: not readable JSON', 'upstream-data', /^HTTP 200, not JSON, 17 bytes/],
    [sourceResponse(200, ''), 'Malformed response: empty body', 'upstream-data', /^HTTP 200, empty body, 0 bytes/],
  ];
  for (const [answer, reason, kind, diag] of cases) {
    const r = raw(now); r.stream = answer.value; r.meta.stream = answer.meta;
    const row = stream(r);
    assert.deepEqual([row.reason, row.kind], [reason, kind]);
    assert.match(row.diagnostic, diag);
  }
  // Callers without metadata (older tests, the shadow fixture) keep the old wording.
  const r = raw(now); r.stream = null; delete r.meta;
  assert.deepEqual([stream(r).reason, stream(r).kind], ['Source unavailable', 'connection']);
  assert.match(stream(r).diagnostic, /^response details not recorded; checked station 6443/);
});

test('stale, future and unreadable times keep their reasons and gain the same metadata', () => {
  const now = Z('2026-11-07T21:54:00Z');
  const { stream } = setup(now);
  const at = (last_rpt) => stream(raw(now, [{ site: '6443', last_rpt, flow: 0 }]));
  assert.equal(at('2026-11-07T10:00:00').reason, 'Stale reading');
  assert.equal(at('2026-11-07T10:00:00').response.stationCount, 1);
  const future = at('2026-11-07T17:00:00');
  assert.equal(future.reason, 'Upstream time error: observation time is in the future');
  assert.equal(future.aheadMinutes, 126);
  assert.match(future.diagnostic, /checked station 6443/);
  assert.equal(at('2026-11-31T00:00:00').reason, 'Upstream time error: unreadable observation time');
  assert.equal(at('').reason, 'Upstream time error: no observation time');
});

test('diagnostic changes alone do not resend; only a new reason does', () => {
  const { gas, clock, check } = setup(Z('2026-11-07T21:54:00Z'));
  const missing = () => raw(clock.now, [{ site: '6440', last_rpt: '2026-11-07T14:50:00', flow: 0 }]);
  check(missing());
  for (let i = 0; i < 4; i++) { clock.now += 60000; check(missing()); } // checkedAt and bytes differ each time
  assert.equal(gas.mails.length, 1);
  clock.now += 60000;
  const r = raw(clock.now); r.stream = { data: [] }; r.meta.stream = ok(r.stream);
  check(r);
  assert.equal(gas.mails.length, 2);
  assert.match(gas.mails[1].body, /Result: Empty station list/);
});

// ---------- the real fetch path: nothing private leaves the response ----------
test('tick: diagnostics come from the real fetch path and never include URLs, keys or body text', () => {
  const now = Z('2026-11-07T21:54:00Z');
  const clock = { now };
  const secretBody = '<html>Contact admin@county.example 520-555-0100 token=abcdefabcdefabcdefabcdefabcdef12</html>';
  const answer = (status, text) => ({ getResponseCode: () => status, getContentText: () => text });
  const gas = makeGas(clock, SRC, (reqs) => reqs.map(({ url }) => {
    if (/currentstream/.test(url)) return answer(200, secretBody);
    if (/currain/.test(url)) return answer(200, JSON.stringify({ data: Object.keys(RAIN_GAUGES).map((site) => ({ site, last_rpt: '2026-11-07T14:50:00', rain: Array(9).fill(0) })) }));
    if (/waterdata|usgs/.test(url)) return answer(200, JSON.stringify({ features: [{ properties: { parameter_code: '00060', value: 0, time: new Date(now).toISOString() } }] }));
    return answer(200, JSON.stringify({ features: [], data: [], d: [] }));
  }));
  gas.props.set('USGS_API_KEY', 'SECRETKEY1234567890');
  try { gas.api.tick(); } catch { /* the assessment itself is covered elsewhere */ }
  const state = JSON.parse(gas.props.get('ownerHealth:stream:6443'));
  assert.equal(state.reason, 'Malformed response: not readable JSON');
  assert.deepEqual(state.response, { checkedAt: '2026-11-07T21:54:00.000Z', httpStatus: 200, outcome: 'not-json', bytes: secretBody.length, checkedStation: '6443' });
  // Everything diagnostics can write: owner-health state, owner email and console logs.
  const written = JSON.stringify([...gas.props.entries()].filter(([k]) => k.startsWith('ownerHealth'))) + JSON.stringify(gas.mails) + JSON.stringify(gas.logs);
  assert.match(written, /stream:6443/);
  for (const leak of ['admin@county.example', '555-0100', 'abcdefabcdef', 'SECRETKEY', 'http://', 'https://', '<html>', 'token=']) {
    assert.ok(!written.includes(leak), 'leaked ' + leak);
  }
});

test('the shadow worker records the same metadata and classification', async () => {
  const now = Z('2026-11-07T21:54:00Z');
  const fetcher = async (url) => {
    if (/currentstream/.test(url)) return new Response('{"data":{"site":"6443"}}', { status: 200 });
    if (/currain/.test(url)) return new Response('busy', { status: 503 });
    return new Response(JSON.stringify({ features: [], data: [], d: [] }), { status: 200 });
  };
  const r = await loadPublic(fetcher);
  assert.equal(r.meta.stream.outcome, 'json');
  assert.equal(r.meta.rain.httpStatus, 503);
  assert.equal(r.rain, null);
  const { expectedInputHealth_ } = await import('../worker/generated/input-health.js');
  const rows = expectedInputHealth_(r, now);
  const stream = rows.find((x) => x.id === 'stream:6443');
  assert.equal(stream.reason, 'Malformed station list');
  assert.match(stream.diagnostic, /data is object\{site\}/);
  const rain = rows.find((x) => x.id === 'rain:6110');
  assert.deepEqual([rain.reason, rain.kind], ['Source unavailable', 'connection']);
  assert.match(rain.diagnostic, /^HTTP 503; checked station 6110/, 'error bodies are not read by the worker');
});

test('generated bundles carry the diagnostics', () => {
  for (const f of ['apps-script/WashWatch.gs', 'worker/generated/input-health.js']) {
    const s = readFileSync(f, 'utf8');
    assert.match(s, /findAlertStation/);
    assert.match(s, /Expected station absent from a readable list/);
  }
  assert.match(readFileSync('apps-script/WashWatch.gs', 'utf8'), /function sourceResponse\(/);
});
