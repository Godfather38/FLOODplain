import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeUsgs,compareDischarge } from '../public/simulation/observations.js';
const recorded=()=>JSON.parse(readFileSync(new URL('../public/simulation/data/usgs-trico-2014-candidate.json',import.meta.url),'utf8'));
test('recorded 2014 Trico observations preserve units, quality and UTC peak',()=>{
 const {raw,normalized}=recorded(),g=normalizeUsgs(raw,normalized);
 assert.equal(g.points.length,193);assert.equal(g.quality.maxGapMinutes,15);assert.deepEqual(g.quality.approvalStatuses,['Approved']);
 const peak=g.points.reduce((a,b)=>a.valueM3s>b.valueM3s?a:b);assert.equal(peak.originalValueCfs,12000);assert.equal(peak.time,'2014-09-09T06:45:00.000Z');assert.ok(Math.abs(peak.valueM3s-339.802159104)<1e-9);
});
test('gauge parser rejects missing values, wrong units/site, duplicates and truncated records',()=>{
 for(const mutate of [r=>r.features[0].properties.value=null,r=>r.features[0].properties.unit_of_measure='ft',r=>r.features[0].properties.monitoring_location_id='USGS-09487000',r=>r.features.push(r.features[0]),r=>r.links.push({rel:'next'})]){const {raw,normalized}=recorded();mutate(raw);assert.throws(()=>normalizeUsgs(raw,normalized));}
});
test('comparison has known perfect and biased answers, with exact matching only',()=>{
 const g=recorded().normalized,m={siteId:g.siteId,units:'m3/s',points:g.points.map(p=>({time:p.time,valueM3s:p.valueM3s}))};
 const perfect=compareDischarge(m,g);assert.equal(perfect.rmseM3s,0);assert.equal(perfect.nashSutcliffe,1);assert.equal(perfect.pairedPeakTimingErrorMinutes,0);assert.equal(perfect.coverageFraction,1);
 m.points.forEach(p=>p.valueM3s+=2);const bias=compareDischarge(m,g);assert.ok(Math.abs(bias.biasM3s-2)<1e-10);assert.ok(Math.abs(bias.rmseM3s-2)<1e-10);
 m.siteId='USGS-09487000';assert.throws(()=>compareDischarge(m,g));m.siteId=g.siteId;m.points.forEach(p=>p.time=new Date(Date.parse(p.time)+60000).toISOString());assert.throws(()=>compareDischarge(m,g));
});
test('comparison reports partial coverage and excludes unapproved or qualified values',()=>{
 const g=recorded().normalized;g.points[0].approval='Provisional';g.points[1].qualifier='estimated';
 const m={siteId:g.siteId,units:'m3/s',points:g.points.slice(0,10)};const r=compareDischarge(m,g);assert.equal(r.pairCount,8);assert.equal(r.eligibleObservationCount,191);assert.equal(r.coverageFraction,8/191);
});
