import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { selectAugust2014 } from '../tools/simulation/selection.mjs';
const read = name => JSON.parse(readFileSync(new URL('../public/simulation/data/' + name, import.meta.url), 'utf8'));
test('complete monthly source reproduces August 19 selection without claiming a preregistration', () => {
  const source = read('cortaro-selection-2014-08.json');
  const report = read('routing-evaluation-2014-08.json');
  const selected = selectAugust2014(source.raw);
  assert.equal(selected.dayCount, 31);assert.equal(selected.selectedDate, '2014-08-19');assert.equal(selected.selectedDailyMeanCfs, 442);
  assert.deepEqual(selected, source.selection);assert.deepEqual(selected, report.selectionEvidence.checkedSelection);
  assert.equal(source.contemporaneousSelectionRecordRetained, false);
  assert.ok(Date.parse(source.retrievedAt) > Date.parse(report.firstScoredAt));
  assert.match(report.selection, /retrieved after scoring/);
});
test('monthly selection rejects incomplete, duplicate, wrong-statistic and qualified evidence', () => {
  for (const mutate of [
    r => r.features.pop(),
    r => r.features[1] = structuredClone(r.features[0]),
    r => r.features[0].properties.statistic_id = '00001',
    r => r.features[0].properties.qualifier = 'ESTIMATED',
    r => r.links.push({ rel: 'next' }),
    r => r.features[0].properties.unit_of_measure = 'm3/s'
  ]) { const raw = read('cortaro-selection-2014-08.json').raw; mutate(raw); assert.throws(() => selectAugust2014(raw)); }
});
