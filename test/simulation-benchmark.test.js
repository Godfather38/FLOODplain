import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {routeGauge} from '../public/simulation/routing.js';
import {compareDischarge} from '../public/simulation/observations.js';
const read=name=>JSON.parse(readFileSync(new URL('../public/simulation/data/'+name,import.meta.url),'utf8'));
test('benchmark reproduces frozen fits without using target observations in routing',()=>{
 const report=read('routing-benchmark.json'),up=read('cortaro-benchmark-2014-09.json').normalized,down=read('trico-benchmark-2014-09.json').normalized;
 assert.equal(report.results.length,3);assert.equal(report.results[0].name,'Primary: 2006 fit');
 for(const [i,year]of ['2006','2013'].entries()){
  const frozen=read(`routing-frozen-${year}.json`);
  assert.ok(Date.parse(frozen.frozenAt)<Date.parse(report.generatedAt));
  for(const source of frozen.inputs){assert.ok(source.path.includes(year));const raw=readFileSync(new URL('../public/simulation/data/'+source.path,import.meta.url),'utf8');assert.equal(createHash('sha256').update(raw.replace(/\r\n/g,'\n')).digest('hex'),source.sha256);}
  const model=routeGauge(up,frozen.parameters),score=compareDischarge(model,{...down,points:down.points.filter(p=>Date.parse(p.time)>=Date.parse(report.scoringStart))});
  assert.equal(score.pairCount,273);assert.ok(Math.abs(score.rmseM3s-report.results[i].score.rmseM3s)<1e-10);
 }
 assert.equal(report.actualPeak.originalValueCfs,12000);assert.equal(report.results[2].predictedPeak.valueM3s/0.028316846592,21200);
});
