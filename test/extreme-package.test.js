import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {openAllRoute,rasterize,rasterizeUnknown} from '../public/simulation/all-route-run.js';
import {RUNS} from '../public/preview/geo3d/src/runs.js';
import {toUtm} from '../public/preview/geo3d/src/utm.js';
const base=new URL('../public/simulation/data/all-route-extreme/',import.meta.url),fetchBytes=async url=>new Uint8Array(readFileSync(fileURLToPath(url)));
const raw=readFileSync(new URL('package.json',base)),pkg=JSON.parse(raw),points=JSON.parse(readFileSync(new URL('route-points.json',base)));
const web=await openAllRoute({base,fetchBytes}),full=await openAllRoute({base,variant:'full',fetchBytes});
test('only the complete wider extreme package is activated and stress retains its existing model',()=>{
 assert.equal(createHash('sha256').update(raw).digest('hex'),'dbe6b2cb72b5d21bbe7d0f6e884d370926aa62f42d81aaaaa775fbff157bb080');
 assert.equal(pkg.live,false);assert.equal(pkg.executionMode,'synthetic_design_storm');assert.equal(pkg.scenario,'extreme');assert.equal(pkg.returnPeriodYears,1000);
 const extreme=RUNS.find(r=>r.id==='extreme'),stress=RUNS.find(r=>r.id==='stress');
 assert.equal(extreme.quad,'all-route-extreme');assert.equal(extreme.card.short,'1,000-year what-if');assert.equal(extreme.card.wetKm2,642.3);
 assert.equal(stress.quad,undefined);assert.equal(stress.display,'sfincs-stress-storm-41633261576-map/frozen-terrain-display.json.gz');assert.match(stress.note,/pending validation/);
 assert.deepEqual(pkg.caseOrder,['northern','picture-rocks','gates']);assert.equal(web.times.length,57);assert.equal(web.iso[0],'2026-11-01T17:00:00Z');assert.equal(web.iso[56],'2026-11-02T07:00:00Z');
 const peak=web.series().reduce((a,b)=>a.wetKm2>b.wetKm2?a:b);assert.ok(Math.abs(peak.wetKm2-642.2603515625)<.00001);assert.equal(peak.time,Date.parse('2026-11-01T21:30:00Z'));assert.ok(web.series().slice(-4).every(f=>Number.isNaN(f.rainMmH)));assert.ok(web.series().every(f=>Number.isFinite(f.inflowM3s)));
});
test('all342 actual full/web frame files pass checksums, unknown validation and exact native route values',async()=>{
 let count=0;for(const run of [web,full])for(let fi=0;fi<57;fi++){await run.ensure(fi);for(const c of run.cases){count++;const f=run.peek(c,fi),cp=points.cases[c.key];for(const p of Object.values(cp.points)){const k=cp.times.indexOf(run.iso[fi]);assert.deepEqual(f.routeDepth[p.slot],p.depth[k]==null?NaN:Math.fround(p.depth[k]));assert.deepEqual(f.routeZs[p.slot],p.zs[k]==null?NaN:Math.fround(p.zs[k]));}}}assert.equal(count,342);
});
test('actual Avra and PR-Avra water outside old narrow grid is drawn by default and lies inside3D raster',async()=>{
 const checks=[{lat:32.398934,lon:-111.246346,fi:23,key:'northern',depth:.720778760},{lat:32.398348,lon:-111.216823,fi:29,key:'picture-rocks',depth:1.116611816}];
 const box={e0:467700,n0:3572300,w:32000,h:34600,cols:2048,rows:2214};
 for(const p of checks){await web.ensure(p.fi);const v=web.valuesAt(p.lat,p.lon,p.fi).find(v=>v.key===p.key);assert.equal(v.drawn,true);assert.ok(Math.abs(v.depth-p.depth)<.001);const u=toUtm(p.lon,p.lat),col=Math.floor((u.e-box.e0)/box.w*box.cols),row=Math.floor((box.n0+box.h-u.n)/box.h*box.rows),k=row*box.cols+col;assert.ok(col>=0&&col<box.cols&&row>=0&&row<box.rows);assert.ok(rasterize(web,p.fi,box)[k]>0);assert.equal(rasterizeUnknown(web,p.fi,box)[k],0);}
});
