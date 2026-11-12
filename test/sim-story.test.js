import test from 'node:test';
import assert from 'node:assert/strict';
import { storyEvents, eventState, storyNow, storyHtml } from '../public/sim-story.js';

const COVER = 0.05, H = 3600e3, t0 = Date.UTC(2026, 10, 2, 0); // 5 PM Arizona, Nov 1
const times = [0, 1, 2, 3, 4, 5].map((k) => t0 + k * H);
const crossings = [
  { fp: { id: 'late', short: 'Late dip' }, inside: true, road: {}, over: [-Infinity, 0, 0.02, 0.4, 0.6, 0.5] },
  { fp: { id: 'early', short: 'Early bridge' }, inside: true, road: { deck: true }, over: [NaN, 0.2, 1.0, 0.3, 0.01, -Infinity] },
  { fp: { id: 'dry', short: 'Dry dip' }, inside: true, road: {}, over: [0, 0.04, 0.05, 0, 0, 0] },
  { fp: { id: 'out', short: 'Outside' }, inside: false },
];

test('events list each crossing once, in arrival order, with peak and clearing', () => {
  const events = storyEvents(crossings, COVER);
  assert.deepEqual(events.map((e) => [e.id, e.first, e.peak, e.clear]), [['early', 1, 2, 4], ['late', 3, 4, null]]);
  assert.equal(events[0].deck, true);
  assert.equal(events[0].peakOver, 1.0);
});

test('water at or under the rating threshold is not an event', () => {
  assert.equal(storyEvents(crossings, COVER).some((e) => e.id === 'dry'), false);
  assert.deepEqual(storyEvents(null, COVER), []);
});

test('state follows the clock', () => {
  const [early] = storyEvents(crossings, COVER);
  assert.deepEqual([0, 1, 3, 4, 5].map((h) => eventState(early, h)), ['ahead', 'over', 'over', 'cleared', 'cleared']);
});

test('the player line says simulated and names the deepest crossing', () => {
  const events = storyEvents(crossings, COVER);
  assert.equal(storyNow(events, crossings, 0, COVER), 'Simulated: no road or crossing under water yet. Next: Early bridge.');
  assert.equal(storyNow(events, crossings, 3, COVER), 'Simulated: water over the road in 2 places. Deepest: Late dip, 1.3 ft.');
  assert.equal(storyNow([], crossings.slice(2), 0, COVER), '');
});

test('storyline html uses plain words, Arizona times, and never says safe', () => {
  const html = storyHtml(storyEvents(crossings, COVER), times, 3);
  assert.match(html, /6:00 PM.*Early bridge.*Modeled water reaches the bridge deck\. Deepest 3\.3 ft at 7:00 PM\. Clear again by 9:00 PM\./s);
  assert.match(html, /Late dip.*Still over the road when the run ends\./s);
  assert.match(html, /data-sim-story="late" data-story-frame="3"/);
  assert.doesNotMatch(html, /safe/i);
  assert.match(storyHtml([], times, 0), /no road or crossing has modeled water over it/);
});

test('the cell picture puts each 100 m cell on its own pixel, north up', async () => {
  const src = (await import('node:fs')).readFileSync(new URL('../public/simulation/sim-2d.js', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('export function cellGrid'), src.indexOf('const DEPTH_RGB'));
  const cellGrid = new Function(`${body.replace('export function', 'function')}; return cellGrid;`)();
  // keys are column * 1000 + row; rows count north
  const g = cellGrid(new Map([[5 * 1000 + 7, 0], [6 * 1000 + 7, 1], [5 * 1000 + 9, 2]]));
  assert.deepEqual([g.w, g.h, g.minC, g.maxR], [2, 3, 5, 9]);
  assert.deepEqual([...g.px], [4, 5, 0]);
  assert.equal(cellGrid(new Map()), null);
});
