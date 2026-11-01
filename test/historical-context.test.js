import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {loadHistoricalCase} from '../public/simulation/historical-context.js';
import {sfincsEvidence} from '../public/simulation/route-fusion.js';
test('both published artifacts match checksums/contracts and remain historical scenario evidence',async()=>{
 const fetchImpl=async path=>new Response(await readFile(new URL('../public/simulation/'+path,import.meta.url)));
 for(const event of ['2013','2014']){const h=await loadHistoricalCase(event,{fetchImpl});assert.equal(h.mode,'historical_scenario');assert.equal(h.manifest.operationalForecast,false);assert.equal(h.manifest.sampleSize,2);assert.equal(h.run.cells.length,6578);assert.equal(h.comparison.pairs,289);assert.ok(h.entry.peakErrorPercent<0);assert.ok(sfincsEvidence(h.run,h.run.frames[0].time).every(e=>e.mode==='scenario'));assert.match(h.role,event==='2013'?/mismatched geometry/:/post-event terrain/);}
});
