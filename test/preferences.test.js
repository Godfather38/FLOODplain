import { test } from 'node:test';
import assert from 'node:assert/strict';
import { savedRoutes, toggleSavedRoute, checkAge, plainWords } from '../public/preferences.js';

test('saved routes tolerate malformed storage, duplicates and removed routes', () => {
  for (const value of [null, {}, 'a', 1]) assert.deepEqual(savedRoutes(value, ['a']), []);
  assert.deepEqual(savedRoutes(['a', 'a', 'old', null, 'b'], ['a', 'b']), ['a', 'b']);
});
test('saving and removing preserves routes from another area without changing inputs', () => {
  const before = ['avra'];
  assert.deepEqual(toggleSavedRoute(before, 'rocks', ['avra', 'rocks']), ['avra', 'rocks']);
  assert.deepEqual(before, ['avra']);
  assert.deepEqual(toggleSavedRoute(['avra', 'rocks'], 'avra', ['avra', 'rocks']), ['rocks']);
  assert.deepEqual(toggleSavedRoute(before, 'invalid', ['avra']), before);
});
test('check age distinguishes a recent request from an older or offline check', () => {
  assert.equal(checkAge(0, 30000), 'Checked just now.');
  assert.equal(checkAge(0, 300000), 'Checked 5 min ago. Older check; refresh for an update.');
  assert.match(checkAge(0, 3600000, false), /^Offline. Checked 1 h ago/);
  assert.equal(checkAge(10000, 0), 'Checked just now.');
});

test('only the synthetic no-readings sentence becomes a short disclaimer', () => {
  const original = 'No live readings right now; current road conditions are not established';
  assert.equal(plainWords(original, 0), 'No local reading is available.');
  const html = `<section><button data-area="avra">Avra Valley</button><button data-area="picture-rocks">Picture Rocks</button><details open><summary>Live readings</summary><p>${original}</p></details></section>`;
  assert.equal(plainWords(html, 0), html.replace(original, 'No local reading is available.'));
});
test('no-data text edit preserves actual source failures, tracking messages and forecasts', () => {
  for (const message of ['Rain gauges unreachable', 'Road flood forecast (SFINCS) not responding', 'County feed unavailable', 'Stale river reading', 'No live forecast here', 'no linked gauge', '100-year storm', '1,000-year what-if']) {
    assert.equal(plainWords(message, 0), message);
  }
});
