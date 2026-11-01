import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { simulate, validateRain } from '../public/simulation/model.js';
const read = name => JSON.parse(readFileSync(new URL('../public/simulation/data/' + name, import.meta.url), 'utf8'));
test('real decoded 2014 accumulation enters runoff model with correct volume and source time', () => {
  const terrain = read('terrain.json'), rain = read('rainfall-iem-201409081800.json');
  validateRain(rain, terrain);assert.equal(rain.kind, 'radar-estimate');
  assert.equal(rain.frames[0].start, '2014-09-08T17:00:00Z');
  const result = simulate(terrain, rain, { infiltrationMmH: 0 });
  const expected = rain.frames[0].rates.reduce((a, b) => a + b, 0) * terrain.cellSizeM ** 2 / 1000;
  assert.ok(Math.abs(result.totals.rainfallM3 - expected) < 1e-6);
  assert.ok(result.totals.boundaryOutflowM3 > 0);
  assert.ok(Math.abs(result.totals.residualM3) < 1e-6);
  assert.equal(result.terrainQuality.crossingDischargeSupported, false);
});
test('real MRMS GRIB dry local pixels stay observed zero rather than invented rain', () => {
  const terrain = read('terrain.json'), rain = read('rainfall-mrms-20201014.json');
  validateRain(rain, terrain);
  assert.equal(rain.provenance.grib.discipline, 209);assert.equal(rain.provenance.grib.parameterCategory, 6);assert.equal(rain.provenance.grib.parameterNumber, 1);
  assert.equal(rain.provenance.grib.units, 'unknown');assert.match(rain.provenance.unitsBasis, /NOAA/);
  const result = simulate(terrain, rain);assert.equal(result.totals.rainfallM3, 0);assert.equal(result.totals.boundaryOutflowM3, 0);
});
