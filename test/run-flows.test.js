import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,existsSync} from 'node:fs';

const DIR=new URL('../public/inundation/data/',import.meta.url);
const REACHES=readdirSync(new URL('nwm/',DIR)).filter(n=>/^\d+\.json$/.test(n)).map(n=>n.slice(0,-5));
const RUNS={'13z':['2026-11-01T17:00:00Z','2026-11-02T07:00:00Z'],'19z':['2026-11-01T22:00:00Z','2026-11-02T12:00:00Z']};

for(const [id,[from,to]] of Object.entries(RUNS)){
 test(`run-flows/${id}.json covers every HAND reach and run frame`,()=>{
  const url=new URL(`run-flows/${id}.json`,DIR);
  assert.ok(existsSync(url),`${id}.json missing`);
  const f=JSON.parse(readFileSync(url,'utf8'));
  assert.equal(f.schemaVersion,1);assert.equal(f.runId,id);assert.equal(f.units,'m3/s');
  assert.match(f.source,/National Water Model/);
  assert.equal(REACHES.length,24);
  assert.deepEqual(Object.keys(f.reaches).sort(),[...REACHES].sort());
  const t0=Date.parse(from),t1=Date.parse(to);
  for(const [r,pts] of Object.entries(f.reaches)){
   const ts=pts.map(p=>Date.parse(p.time));
   for(let i=1;i<ts.length;i++)assert.equal(ts[i]-ts[i-1],3600e3,`${r} not hourly`);
   for(let t=t0;t<=t1;t+=3600e3)assert.ok(ts.includes(t),`${r} lacks ${new Date(t).toISOString()}`);
   for(const p of pts)assert.ok(Number.isFinite(p.flowM3s)&&p.flowM3s>=0,`${r} bad flow ${p.flowM3s}`);
  }
 });
}
