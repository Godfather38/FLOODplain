import test from 'node:test';
import assert from 'node:assert/strict';
import { byHour, hoursFromSummary, hoursFromCoarse, attachHours, outlookCells, outlookSummary, outlookHtml } from '../public/outlook.js';
import { roadForecast } from '../public/road-forecast.js';

const H = 3600e3, t0 = Date.UTC(2026, 10, 12, 13); // 6 AM Arizona
const iso = (k) => new Date(t0 + k * H).toISOString();
const summary = { times: [0, 1, 2, 3].map(iso), routes: { avra: { frames: [0.5, 0, 0.04, 0.4].map((d) => ({ validStations: 5, peakRoadDepthM: d })) } } };

test('high-resolution hours start at the hour holding now and keep each hour\'s depth', () => {
  const hours = hoursFromSummary(summary, 'avra', t0 + 1.5 * H);
  assert.deepEqual(hours, [{ time: t0 + H, over: 0 }, { time: t0 + 2 * H, over: 0.04 }, { time: t0 + 3 * H, over: 0.4 }]);
  assert.equal(hoursFromSummary(summary, 'nope', t0), null);
});

test('an hour without a usable model value is no data, never dry', () => {
  const broken = { times: summary.times, routes: { avra: { frames: [{ validStations: 0, peakRoadDepthM: 0 }, null, { validStations: 3, peakRoadDepthM: 0 }, { validStations: 3, peakRoadDepthM: -1 }] } } };
  assert.deepEqual(hoursFromSummary(broken, 'avra', t0).map((h) => h.over), [null, null, 0, null]);
  assert.deepEqual(outlookCells([{ time: t0, over: null }]).map((c) => [c.level, c.text]), [['none', 'No data']]);
});

test('coarse hours use the same cell rule as the route rating, so the deepest hour matches it', () => {
  const table = { routes: { trico: [[0, 10, 9.5, -111, 32, 0], [1, 12, 11, -111, 32, 0]] } };
  const water = { frames: [{ time: iso(0), surfaceM: [9.5, 11] }, { time: iso(1), surfaceM: [10.2, 11] }, { time: iso(2), surfaceM: [-9999, -9999] }] };
  const hours = hoursFromCoarse(table, water, 'trico', t0);
  assert.equal(hours[0].over, 0);
  assert.ok(Math.abs(hours[1].over - 0.2) < 1e-9);
  assert.equal(hours[2].over, null);
  const rated = roadForecast(table, { issuedAt: iso(0) }, water, t0).routes.trico;
  assert.ok(Math.abs(Math.max(...hours.map((h) => h.over ?? 0)) - rated.maxOver) < 1e-9);
});

test('attachHours takes each route\'s hours from the model its rating came from', () => {
  const forecast = { routes: { avra: { source: 'high_resolution', case: 'northern' }, trico: { source: 'coarse_fallback' }, gone: { source: 'high_resolution', case: 'missing' } } };
  attachHours(forecast, { table: { routes: { trico: [[0, 10, 9.5]] } }, water: { frames: [{ time: iso(0), surfaceM: [9.5] }] }, summaries: { northern: summary } }, t0);
  assert.equal(forecast.hours.avra.length, 4);
  assert.deepEqual(forecast.hours.trico, [{ time: t0, over: 0 }]);
  assert.equal(forecast.hours.gone, undefined);
  assert.deepEqual(Object.keys(forecast), ['routes'], 'the strip is not part of the forecast the service also computes');
});

test('cells and summary use plain words and the rating thresholds', () => {
  const hours = hoursFromSummary(summary, 'avra', t0);
  assert.deepEqual(outlookCells(hours).map((c) => [c.label, c.level, c.text]), [['Now', 'danger', '1.6 ft'], ['7 AM', 'dry', 'Dry'], ['8 AM', 'trace', '0.1 ft'], ['9 AM', 'danger', '1.3 ft']]);
  assert.equal(outlookSummary(hours), 'Deepest modeled water in the next 4 hours: 1.6 ft now.');
  assert.equal(outlookSummary(hours.slice(1)), 'Deepest modeled water in the next 3 hours: 1.3 ft around 9 AM.');
  assert.equal(outlookSummary([{ time: t0, over: 0 }]), 'No modeled water over this road in the next 1 hour.');
  assert.match(outlookSummary([{ time: t0, over: 0 }, { time: t0 + H, over: null }]), /Some hours have no model value\.$/);
});

test('the strip says it is modeled and never says safe or uses a question mark', () => {
  const html = outlookHtml(hoursFromSummary(summary, 'avra', t0)) + outlookHtml([{ time: t0, over: null }], { compact: true });
  assert.match(html, /SFINCS forecast/);
  assert.match(html, /Modeled water over the road, next 1 hours|Modeled water over the road/);
  assert.doesNotMatch(html, /safe|\?/i);
  assert.equal(outlookHtml(null), '');
});

test('half-hour frames fold into clock hours: deepest value, no data only if the whole hour has none', () => {
  const half = [{ time: t0, over: 0 }, { time: t0 + H / 2, over: 0.2 }, { time: t0 + H, over: null }, { time: t0 + 1.5 * H, over: 0 }, { time: t0 + 2 * H, over: null }];
  assert.deepEqual(byHour(half), [{ time: t0, over: 0.2 }, { time: t0 + H, over: 0 }, { time: t0 + 2 * H, over: null }]);
  assert.deepEqual(outlookCells(half).map((c) => c.label), ['Now', '7 AM', '8 AM']);
});
