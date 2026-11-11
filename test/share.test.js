import test from 'node:test';
import assert from 'node:assert/strict';
import { shareText, shareCheck } from '../public/share.js';

const route = (id, score, minutes) => ({ id, score, minutes, level: 'ok', points: [] });
const best = route('trico', 1, 10), other = route('avra', 2, 20);
const view = { rec: { best, order: [best, other] }, rated: [best, other] };
const now = Date.UTC(2026, 10, 12, 13, 5); // 6:05 AM in Arizona

test('share text is the alert sentence with the check time before the link', () => {
  const text = shareText(view, { now, closures: [], alert: {}, flows: { a: { fresh: true } } }, 'avra');
  assert.match(text, /^FLOODplain: take Trico-Marana \(1\/5 Low, 10 min\)\. Others: Avra Valley Rd 2\. Checked 6:05 AM Arizona time\. https:\/\/godfather38\.github\.io\/FLOODplain\/$/);
  assert.doesNotMatch(text, /safe/i);
});

test('share text says which live data was missing', () => {
  const text = shareText(view, { now, closures: null, alert: null, flows: {} }, 'avra');
  assert.match(text, /\(No live county\/rain\/river data\.\) Checked/);
});

test('sharing uses the share sheet, falls back to copying, and stays quiet when cancelled', async () => {
  const sent = [];
  assert.equal(await shareCheck('x', { share: async (d) => { sent.push(d); } }), '');
  assert.deepEqual(sent, [{ text: 'x' }]);
  assert.equal(await shareCheck('x', { clipboard: { writeText: async (t) => { sent.push(t); } } }), 'Copied. Paste it into a message.');
  assert.equal(await shareCheck('x', { share: async () => { throw Object.assign(new Error('no'), { name: 'AbortError' }); } }), '');
  assert.match(await shareCheck('x', {}), /Couldn’t share/);
});
