// The Map's Live scenario reads the live all-route display package first
// (tools/all-route/build_live_web_package.py, published to the live-all-route-web branch).
// These checks use the saved package's own files as a stand-in live package.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const {openAllRoute,liveAllRoute,liveAreaProblem}=await import('../public/simulation/all-route-run.js');

const SAVED=new URL('../public/simulation/data/all-route-13z/',import.meta.url);
const NOW=Date.parse('2026-11-12T20:30:00Z'),H=3600e3;
const iso=ms=>new Date(ms).toISOString().replace('.000Z','Z');
// A live package: the saved one with each area's run time, and the build time live packages carry.
function livePackage(issuedHoursAgo){
 const pkg=JSON.parse(readFileSync(new URL('package.json',SAVED)));
 pkg.live=true;pkg.builtAt=iso(NOW-600e3);delete pkg.overlap;pkg.unavailable=[];
 pkg.cases.forEach((c,i)=>{c.issuedAt=iso(NOW-issuedHoursAgo[i]*H);c.validTo=iso(NOW+10*H);});
 return pkg;
}
const asked=[];let P1;
const fetcher=pkg=>async url=>{
 const u=new URL(url);asked.push(u.search);
 if(u.pathname.endsWith('/package.json'))return new TextEncoder().encode(JSON.stringify(pkg));
 return new Uint8Array(readFileSync(fileURLToPath(new URL(u.pathname,'file://'))));
};

test('an area is fresh only while its run is at most the limit old and still covers now',()=>{
 const info={issuedAt:iso(NOW-2*H),validTo:iso(NOW+H)};
 assert.equal(liveAreaProblem(info,NOW,3),'');
 assert.equal(liveAreaProblem({...info,issuedAt:iso(NOW-3.5*H)},NOW,3),'its newest run is 3.5 hours old');
 assert.equal(liveAreaProblem({...info,validTo:iso(NOW-H)},NOW,3),'its run ends before now');
 assert.equal(liveAreaProblem({validTo:info.validTo},NOW,3),'its run time is missing');
});

test('all three fresh areas load, and every file after package.json carries the build time',async()=>{
 asked.length=0;
 const live=await liveAllRoute({base:SAVED,maxAgeH:3,fetchBytes:fetcher(P1=livePackage([1,1,2])),fetchPackage:fetcher(P1),now:NOW});
 assert.deepEqual(live.quad.cases.map(c=>c.key),['northern','picture-rocks','gates']);
 assert.deepEqual(live.left,[]);
 assert.match(live.note,/^Model forecast from public forcing, not observed water: the live all-route SFINCS runs/);
 assert.match(live.note,/Northern \(run at 12:30 PM MST\), Picture Rocks \(run at 12:30 PM MST\), Gates \(run at 11:30 AM MST\)/);
 assert.match(live.note,/Gates uses mixed-vintage terrain/);
 assert.doesNotMatch(live.note,/safe/i);
 assert.match(asked[0],/^\?t=\d+$/,'package.json is asked for with a time bucket');
 assert.ok(asked.slice(1).every(q=>q==='?b='+encodeURIComponent(iso(NOW-600e3))),'the rest carry the build time');
});

test('a stale area is left out by name and the others still draw every place they cover',async()=>{
 const live=await liveAllRoute({base:SAVED,maxAgeH:3,fetchBytes:fetcher(P1=livePackage([1,4.2,2])),fetchPackage:fetcher(P1),now:NOW});
 assert.deepEqual(live.quad.cases.map(c=>c.key),['northern','gates']);
 assert.deepEqual(live.left,['Picture Rocks: its newest run is 4.2 hours old']);
 assert.match(live.note,/Left out: Picture Rocks: its newest run is 4\.2 hours old\./);
 // Overlap bits still name areas by their place in the package order.
 assert.deepEqual(live.quad.cases.map(c=>c.bit),[1,4]);
 const [northern,gates]=live.quad.cases;
 // Northern is first of the areas present, so it draws wherever it has a cell, including where
 // the missing area would have been nearest. Gates gives way only to Northern.
 assert.ok(northern.drawn.every(v=>v===1));
 assert.equal(gates.drawn[0],1);assert.equal(gates.drawn[1],0);assert.equal(gates.drawn[2],1);assert.equal(gates.drawn[128|2],1);
 assert.deepEqual(live.quad.series().length,live.quad.times.length);
});

test('with no fresh area the reason is given in plain words',async()=>{
 await assert.rejects(liveAllRoute({base:SAVED,maxAgeH:3,fetchBytes:fetcher(P1=livePackage([5,6,7])),fetchPackage:fetcher(P1),now:NOW}),/no model area has a fresh run \(Northern: its newest run is 5\.0 hours old; Picture Rocks: .*; Gates: .*\)\./);
 await assert.rejects(liveAllRoute({base:SAVED,maxAgeH:3,fetchPackage:async()=>{throw new Error('package.json answered 404');},now:NOW}),/its map package did not answer\./);
});

test('the saved run still opens as before: whole package, nearest-route drawing',async()=>{
 const saved=await openAllRoute({variant:'web',fetchBytes:async url=>new Uint8Array(readFileSync(fileURLToPath(url)))});
 assert.deepEqual(saved.cases.map(c=>c.bit),[1,2,4]);
 assert.equal(saved.pkg.dropped,0);
 assert.equal(saved.cases[1].drawn[1],0,'in an overlap the area without the nearest route is not drawn');
 assert.equal(saved.cases[1].drawn[128|1],1);
});

test('the Live scenario tries the all-route package first in 2D and 3D and says when it falls back',()=>{
 const read=f=>readFileSync(new URL('../public/'+f,import.meta.url),'utf8');
 for(const f of ['simulation/sim-2d.js','preview/geo3d/src/world/main.js']){
  const src=read(f);
  assert.match(src,/liveAllRoute\(\{base:LIVE_ALL_ROUTE,maxAgeH:LIVE_MAX_AGE_H/,f);
  assert.match(src,/The live all-route model is not on the map: \$\{allRouteProblem\} This is the 100 m river-strip run instead\./,f);
 }
 assert.match(read('preview/geo3d/src/runs.js'),/raw\.githubusercontent\.com\/Godfather38\/FLOODplain\/live-all-route-web\//);
});
