import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
globalThis.atob??=s=>Buffer.from(s,'base64').toString('binary');
const {decodeJunction,computeExtent}=await import('../public/inundation/hand-inundation.js');
const read=f=>readFileSync(new URL('../public/'+f,import.meta.url),'utf8');
const json=f=>JSON.parse(read(f));

test('HAND runs for every scenario: the Santa Cruz windows flood more as the run\'s river flow rises',()=>{
 const cov=json('inundation/data/coverage.json');
 const windows=cov.points.filter(p=>p.status==='supported'&&p.file).map(p=>{try{return decodeJunction(json('inundation/data/'+p.file));}catch{return null;}}).filter(j=>j&&/santa cruz/i.test(j.reach.name));
 assert.ok(windows.length>=9,`${windows.length} Santa Cruz windows`);
 // 13Z (2,498 ft³/s), the 100-year storm's hour (30,017) and the 1,000-year what-if's (77,692).
 for(const j of windows){
  const at=cfs=>computeExtent(j,cfs/35.3147)?.wetCells??-1;
  const a=at(2498),b=at(30017),c=at(77692);
  assert.ok(a>0&&b>a&&c>b,`${j.id}: ${a} < ${b} < ${c}`);
  assert.equal(computeExtent(j,0).wetCells,0,'no flow, no HAND water');
 }
});

test('each run carries its Santa Cruz flow for HAND, and no model choice is ever greyed out',()=>{
 const sim=read('simulation/sim-2d.js'),app=read('map-app.js');
 assert.match(sim,/reachId\)==='15902351'/);assert.match(sim,/riverM3s/);assert.match(sim,/export function loadHand/);
 assert.match(app,/r\.disabled=false/);assert.doesNotMatch(app,/r\.disabled=\(r\.value==='hand'/);
 // A choice with nothing to draw says why, and offers the next step.
 assert.match(app,/function modelStatus/);assert.match(app,/so HAND estimates no river water/);assert.match(app,/Try the 100-year storm/);
 // Map buttons are labelled on screen.
 for(const l of ['Me','Routes','Water','North'])assert.match(app,new RegExp(`<span>${l}</span></button>`));
});

test('the 3D view only reports a run once it has finished loading, and a newer choice replaces an older one',()=>{
 const main=read('preview/geo3d/src/world/main.js'),embed=read('preview/geo3d/src/world/embed.js');
 assert.match(main,/const ticket=\+\+switchId/);assert.match(main,/if\(ticket!==switchId\)return;run=next/);
 assert.match(embed,/ready:\$\('loading'\)\.classList\.contains\('done'\)/);
 assert.match(embed,/fp3d==='pause'/);
});

test('the offline worker never stands the home page in for another page, such as the 3D view',()=>{
 const sw=read('sw.js');
 assert.match(sw,/isAppPage/);assert.match(sw,/request\.destination === 'document'/);
});
