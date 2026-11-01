import { test } from 'node:test';
import assert from 'node:assert/strict';
import { savedRoutes, toggleSavedRoute, checkAge } from '../public/preferences.js';

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
