import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=f=>readFileSync(new URL('../public/'+f,import.meta.url),'utf8');

test('errors, failed downloads and freezes are logged from the start, and freezes are caught off the main thread',()=>{
 const app=read('app.js'),diag=read('diagnostics.js'),worker=read('diag-worker.js');
 assert.ok(app.indexOf('mountDiagnostics();')<app.indexOf('const map = L.map('),'logging starts before the map');
 for(const s of ["addEventListener('error'","unhandledrejection",'window.fetch=',"record('freeze'","new Worker("])assert.ok(diag.includes(s),s);
 assert.match(worker,/gap>4000/);assert.match(worker,/ntfy\.sh/);
 // A hidden page is not frozen.
 assert.match(diag,/visibilitychange/);assert.match(worker,/!visible/);
});

test('reports carry no location or personal details, and are rate-limited',()=>{
 const diag=read('diagnostics.js');
 assert.doesNotMatch(diag,/coords|latitude|geolocation|localStorage\.getItem\('(?!fp-diag)/);
 assert.match(diag,/SEND_GAP_MS=30000/);
 assert.match(read('config.js'),/export const DIAG_TOPIC = 'washwatch-diag-/);
});

test('the 3D view reports its own errors to the app, and the map offers the log',()=>{
 assert.match(read('preview/geo3d/src/world/main.js'),/fp3d:'log',kind:'error'/);
 assert.match(read('preview/geo3d/world.html'),/fp3d:'log',kind:'error'/);
 const app=read('map-app.js');for(const s of ['data-m-diag-send','data-m-diag-copy','data-m-diag-list'])assert.match(app,new RegExp(s));
});
