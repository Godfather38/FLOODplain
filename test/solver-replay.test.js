import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {inspectRecordedSolver} from '../public/simulation/solver-replay.js';
test('actual SFINCS artifact passes contract but obsolete forcing is never promoted to a forecast',()=>{
 const run=JSON.parse(gunzipSync(readFileSync(new URL('../public/simulation/data/sfincs-recorded.json.gz',import.meta.url))));
 const result=inspectRecordedSolver(run);
 assert.equal(result.suitability,'invalid_historical_forcing');
 assert.equal(run.cells.length,6767);assert.equal(run.frames.length,73);
 assert.ok(result.maximumDepthM>0 && result.maximumDepthM<0.01);
 assert.equal(run.uncertainty.plusMinus,null);
 assert.match(result.warning,/No upstream river inflow/);
 assert.throws(()=>inspectRecordedSolver({...run,status:'failed'}));
});
