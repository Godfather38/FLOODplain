import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCountyClosures, checkClosures } from '../public/logic.js';
import { evaluate } from '../public/engine.js';
import { compute } from '../worker/index.js';
import { healthy, fixtureNow as now } from '../worker/fixtures/healthy.js';
const routes = JSON.parse(readFileSync(new URL('../public/data/routes.geojson', import.meta.url))).features;

// Exact incomplete public ArcGIS record captured on Nov 5, 2026 at 10:21 UTC,
// using sourceUrls().closures. Other returned rows were omitted from this fixture.
const incomplete = JSON.parse(readFileSync(new URL('./fixtures/county-incomplete-2026-11-05.json', import.meta.url)));
const closed = { attributes: { Location: 'Trico Rd south of Trico Marana Rd', Status: 'Closed' }, geometry: { x: -111.30429098657586, y: 32.45112652226325 } };

test('live Gates Pass null status names the exact gap and stays unknown', () => {
  const county = parseCountyClosures(incomplete);
  assert.equal(county.complete, false);
  assert.match(county.reason, /W Gates Pass Rd: missing Status/);
  assert.doesNotMatch(county.reason, /Malformed/);
  assert.equal(county.points.length, 1);
  assert.equal(checkClosures(county.points).roadStatus, 'unknown');
});

test('shared county parser preserves direction, update time and the county wording', () => {
  const county = parseCountyClosures({ features: [{ ...closed, attributes: { ...closed.attributes, Direction: 'Northbound', timeUpdated: '11/05/26, 03:16' } }] });
  assert.equal(county.points[0].direction, 'Northbound');
  assert.equal(county.points[0].updated, '11/05/26, 03:16');
  assert.equal(county.points[0].status, 'Closed');
});

test('valid empty county list differs from unavailable, malformed and truncated responses', () => {
  assert.deepEqual(parseCountyClosures({ features: [] }), { points: [], complete: true, issues: [], reason: '' });
  for (const body of [null, {}, { features: {} }, { error: { code: 400 }, features: [] }]) {
    const county = parseCountyClosures(body);
    assert.equal(county.points, null);
    assert.equal(county.complete, false);
  }
  assert.equal(parseCountyClosures({ features: [], exceededTransferLimit: true }).complete, false);
});

test('bad geometry or attributes cannot erase a valid closure or crash the engine', () => {
  const raw = { ...healthy(), now, routes, closures: { features: [closed, null, {}, { attributes: { Location: 'Broken point', Status: 'Closed' }, geometry: { x: null, y: 32 } }, { attributes: null, geometry: { x: -111, y: 32 } }] } };
  const county = parseCountyClosures(raw.closures);
  assert.equal(county.points.length, 2);
  assert.equal(county.complete, false);
  assert.ok(county.issues.some(i => /geometry/.test(i.reason)));
  const result = evaluate(raw);
  assert.equal(result.closuresKnown, false);
  assert.ok(result.closed.includes(closed.attributes.Location));
  assert.ok(result.missing.includes('county'));
  assert.ok(result.rated.every(r => Number.isFinite(r.score)));
});

test('official extended county statuses are readable; unrecognized and nonstring statuses stay unknown', () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/closures-2026-10-31.json', import.meta.url)));
  const statuses = fixture.fields.find(f => f.name === 'Status').domain.codedValues.map(v => v.code);
  for (const Status of statuses) assert.equal(parseCountyClosures({ features: [{ ...closed, attributes: { ...closed.attributes, Status } }] }).complete, true, Status);
  for (const Status of [null, '', ' ', 0, {}, 'Unavailable']) assert.equal(parseCountyClosures({ features: [{ ...closed, attributes: { ...closed.attributes, Status } }] }).complete, false);
  for (const Status of ['Open tomorrow', 'Closure removed', 'No caution']) {
    const county = parseCountyClosures({ features: [{ ...closed, attributes: { ...closed.attributes, Status } }] });
    assert.equal(checkClosures(county.points).roadStatus, 'unknown');
  }
});

test('county incident fingerprint is stable when source row order changes', () => {
  const second = { ...incomplete.features[0], attributes: { Location: 'Second road', Status: null } };
  assert.equal(parseCountyClosures({ features: [...incomplete.features, second] }).reason, parseCountyClosures({ features: [second, ...incomplete.features] }).reason);
});

test('Worker health and all-area assessments retain the incomplete county diagnosis', () => {
  const result = compute({ ...healthy(), closures: incomplete }, now);
  const county = result.inputs.find(i => i.id === 'county');
  assert.match(county.reason, /W Gates Pass Rd: missing Status/);
  assert.equal(county.crossings, 'W Gates Pass Rd');
  // The county answered, so the source is up; the blank record is tracked on its own.
  assert.deepEqual(result.sources.county, { lastOk: now });
  assert.deepEqual(result.sources.countyRecords, { downSince: now });
  assert.equal(county.kind, 'upstream-data');
  assert.ok(Object.values(result.verdicts).every(v => !v.closuresKnown));
});

test('browser loader uses the same parser and keeps incomplete points plus diagnostics', async () => {
  const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const fn = source.slice(source.indexOf('async function loadClosures()'), source.indexOf('// County rain/stream feed:'));
  const load = new Function('getJson', 'cfg', 'SOURCES', 'parseCountyClosures', fn + '; return loadClosures;')(async () => incomplete, { CLOSURE_BOUNDS: '' }, { closures: 'https://county.example.test' }, parseCountyClosures);
  assert.deepEqual(await load(), parseCountyClosures(incomplete));
  assert.match(source, /if \(county\?\.reason\) errors\.push\(county\.reason\)/);
});
