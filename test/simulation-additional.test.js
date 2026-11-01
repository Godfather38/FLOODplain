import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { routeGauge } from '../public/simulation/routing.js';
import { compareDischarge } from '../public/simulation/observations.js';
const read = name => JSON.parse(readFileSync(new URL('../public/simulation/data/' + name, import.meta.url), 'utf8'));
test('additional event uses exactly the original frozen parameters and reports all candidates', () => {
  const report = read('routing-evaluation-2014-08.json');
  const original = read('routing-benchmark.json');
  assert.equal(report.results.length, 3);
  const up = read('cortaro-evaluation-2014-08.json').normalized;
  const down = read('trico-evaluation-2014-08.json').normalized;
  for (const [i, source] of report.frozenFiles.entries()) {
    const text = readFileSync(new URL('../public/simulation/data/' + source.path, import.meta.url), 'utf8');
    assert.equal(createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex'), source.sha256);
    assert.deepEqual(report.results[i].parameters, original.results[i].frozen.parameters);
    const model = routeGauge(up, report.results[i].parameters);
    const score = compareDischarge(model, { ...down, points: down.points.filter(p => p.time >= report.scoringStart) });
    assert.equal(score.pairCount, 577);
    assert.ok(Math.abs(score.rmseM3s - report.results[i].score.rmseM3s) < 1e-10);
  }
  assert.equal(report.actualPeak.originalValueCfs, 1340);
  assert.match(report.selection, /Not used in fitting/);
});
test('radar validation preserves the original failure and successful independent public sources', () => {
  const status = read('radar-source-status.json');
  assert.equal(status.initialAttempt.httpStatus, 403);assert.equal(status.realFixtureValidated, true);
  assert.equal(status.initialAttempt.alternateAccessAttempted, false);
});
