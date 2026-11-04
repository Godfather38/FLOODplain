// The all-route run on the Map tab (public/simulation/all-route-run.js and its package in
// public/simulation/data/all-route-13z/): exact route-point values, the missing Picture Rocks
// frame, the Gates gap, overlap drawing that never averages, and the 3D water picture.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const {openAllRoute,rasterize,search}=await import('../public/simulation/all-route-run.js');
const fetchBytes=async url=>new Uint8Array(readFileSync(fileURLToPath(url)));
const web=await openAllRoute({variant:'web',fetchBytes}),full=await openAllRoute({variant:'full',fetchBytes});

test('three model areas, one saved forecast, 57 quarter-hour frames; Picture Rocks has no 07:00 UTC frame',()=>{
 assert.deepEqual(web.cases.map(c=>c.key),['northern','picture-rocks','gates']);
 assert.equal(web.times.length,57);assert.equal(web.frameMs,900e3);
 assert.equal(web.iso[0],'2026-11-01T17:00:00Z');assert.equal(web.iso[56],'2026-11-02T07:00:00Z');
 assert.deepEqual(web.missingAt(56).map(c=>c.key),['picture-rocks']);assert.deepEqual(web.missingAt(55),[]);
 assert.deepEqual(web.pkg.sourceIssues,{NWM:'2026-11-01T13:00:00Z',HRRR:'2026-11-01T14:00:00Z',mode:'frozen_replay'});
 assert.equal(web.pkg.gatesGap.areaKm2,7.4221);assert.equal(web.pkg.gatesGap.uncoveredRoutePoints,59);
 assert.ok(web.gap.features.length>0);
 assert.equal(web.pkg.overlap.maximumDifferenceM,1.4583740234375);
 // Full keeps every native cell; web joins cells far from the routes.
 assert.deepEqual(full.cases.map(c=>c.n),[528201,537476,212035]);
 web.cases.forEach((c,i)=>assert.ok(c.n<full.cases[i].n));
});

test('route-point cells carry the exact native values in every frame of both variants',async()=>{
 const points=JSON.parse(readFileSync(new URL('../public/simulation/data/all-route-13z/route-points.json',import.meta.url)));
 for(const run of [web,full])for(const fi of [0,20,56]){
  await run.ensure(fi);
  for(const c of run.cases){
   const f=run.peek(c,fi);if(!c.byTime.has(run.iso[fi])){assert.equal(f,null);continue;}
   const p=points.cases[c.key],k=p.times.indexOf(run.iso[fi]);
   for(const [id,pt] of Object.entries(p.points)){
    // null in the series is a missing native value: NaN in the frame, never 0.
    const exact=v=>v==null?NaN:Math.fround(v);
    assert.deepEqual(f.routeZs[pt.slot],exact(pt.zs[k]),`${c.key} ${id} zs`);
    assert.deepEqual(f.routeDepth[pt.slot],exact(pt.depth[k]),`${c.key} ${id} depth`);
    // and the drawn depth at that cell is the exact value, not the millimetre one
    const cell=c.routeIndex[pt.slot],j=search(f.listed,cell);
    if(j>=0)assert.equal(f.depth[j],exact(pt.depth[k]));
   }
  }
 }
});

test('crossing series keep each model area apart, and the Gates-gap crossings have none',()=>{
 const avra=web.pointSeries('sc-avra');
 assert.deepEqual(avra.map(s=>s.key),['northern','picture-rocks']);
 assert.ok(Number.isNaN(avra[1].zs[56])&&Number.isFinite(avra[0].zs[56]));
 assert.notEqual(avra[0].zs[40],avra[1].zs[40]);
 for(const id of ['pr-sandario-south','pr-kinney-javelina','pr-kinney-washes'])assert.deepEqual(web.pointSeries(id),[]);
 assert.equal(web.pointSeries('brawley-dip')[0].key,'northern');
});

test('overlaps draw one model area at each place, by nearest route or by choice, never both',()=>{
 for(const mode of ['nearest','northern','picture-rocks','gates']){
  web.setMode(mode);
  for(const c of web.cases){
   assert.equal(c.drawn[0],1,'a place only this area covers is always drawn');
   if(mode===c.key)assert.ok(c.drawn.every(v=>v===1));
  }
 }
 web.setMode('nearest');
 // A Northern cell covered by Picture Rocks too is drawn by exactly one of them in either order.
 const n=web.cases[0],pr=web.cases[1];
 assert.equal(n.drawn[2]+n.drawn[2|128],1);assert.equal(pr.drawn[1]+pr.drawn[1|128],1);
 web.setMode('northern');assert.equal(pr.drawn[1],0);assert.equal(pr.drawn[1|128],0);
 web.setMode('nearest');
 const s=web.series();assert.equal(s.length,57);assert.ok(Math.max(...s.map(v=>v.wetKm2))>100);
});

test('the 3D picture stores water over each pixel area and is empty where a case has no frame',async()=>{
 const box={e0:467700,n0:3572300,w:32000,h:34600,cols:512,rows:554};
 await web.ensure(20);await web.ensure(55);await web.ensure(56);
 const a=rasterize(web,20,box);assert.ok(a.some(v=>v>0));
 assert.ok(a.every(v=>v<=255));
 // Only Picture Rocks has no 07:00 frame: its own area draws nothing then.
 web.setMode('picture-rocks');const only=rasterize(web,56,box),before=rasterize(web,55,box);web.setMode('nearest');
 assert.ok(before.some(v=>v>0)&&only.some(v=>v>0));
});

test('the all-route scenario is on the Map tab with an honest card and the HAND flows of its forecast',async()=>{
 const {RUNS}=await import('../public/preview/geo3d/src/runs.js');
 const r=RUNS.find(r=>r.id==='allroutes');
 assert.equal(r.card.short,'Nov 1 · 13Z all routes');assert.equal(r.handFlows,'run-flows/13z.json');assert.equal(r.frameMinutes,15);
 for(const words of [/1\.46 m/,/not averaged|Nothing is averaged/,/time limit/,/7\.4 km² terrain gap/,/not current conditions/])assert.match(r.note,words);
 assert.doesNotMatch(r.note+r.card.blurb,/\bsafe\b/i);
});
