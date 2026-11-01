import {chromium} from 'playwright';import assert from 'node:assert/strict';import {writeFile} from 'node:fs/promises';
import {syntheticRefinedPackage} from '../../test/fixtures/refined-renderer-synthetic.js';import {server} from './voxel-preview-server.mjs';
const fixture=syntheticRefinedPackage();
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--enable-webgl','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{const page=await browser.newPage({viewport:{width:900,height:700},reducedMotion:'reduce'}),errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
 await page.route('**/synthetic-refined',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,"><link rel="stylesheet" href="/vendor/leaflet/leaflet.css"><style>html,body,#map{height:100%;margin:0}#warning{position:absolute;z-index:9999;bottom:0;background:white}</style></head><body><div id="map"></div><strong id="warning">SYNTHETIC CONTRACT CHECK — NOT A FORECAST</strong><script src="/vendor/leaflet/leaflet.js"></script><script type="module">
 import {createGeographicView,createRefinedRendererSource} from '/simulation/geographic-view.js';
 const f=${JSON.stringify(fixture)},reads=[];
 const source=createRefinedRendererSource({...f,readArtifact:async a=>{reads.push(a.path);return a.path==='terrain.json.gz'?window.syntheticTerrain:f.frames.find(x=>x.time===a.time);}});
 const map=L.map('map').setView([32.4205,-111.1605],18),routeLayer=L.layerGroup().addTo(map);
 const view=await createGeographicView({leaflet:map,source,routeLayer,get:p=>{throw Error('Unexpected legacy request '+p);}});await view.ready;await view.update(f.manifest.frames[0]);window.qa={view,map,source,f,reads};window.ready=true;
 </script></body></html>`}));
 await page.goto('http://127.0.0.1:8094/synthetic-refined');await page.waitForFunction(()=>window.ready,null,{timeout:60000});
 const point=await page.evaluate(()=>{const p=qa.map.latLngToContainerPoint([32.4208,-111.1608]);return{x:p.x,y:p.y};});await page.mouse.click(point.x,point.y);await page.waitForFunction(()=>qa.view.inspect().selected===0);
 assert.match(await page.locator('.voxel-cell-info').textContent(),/9007199254740997/);
 await page.evaluate(()=>qa.view.update(qa.f.manifest.frames[1]));const missing=await page.evaluate(()=>({count:qa.view.inspect().flatWater.getGeometries().length,info:qa.source.cellInfo(1,qa.view.inspect().frame),model:!!qa.view.inspect().model}));assert.equal(missing.count,2);assert.equal(missing.info.depthM,null);assert.equal(missing.model,false);
 const unavailable=await page.evaluate(async()=>{try{await qa.view.setViewMode('3d');return false;}catch(e){return e.message;}});assert.match(unavailable,/unavailable/);assert.equal(await page.evaluate(()=>qa.view.viewMode),'flat');
 assert.equal(requests.filter(u=>/frozen-|water-footprints-|geographic-3d-runtime/.test(u)).length,0,'unavailable native terrain must not trigger any legacy or3D assets');
 // Only now inject an explicitly synthetic, source-bound terrain to test the lazy path.
 await page.evaluate(async()=>{const f=qa.f,vertices=f.geometry.rings.flatMap(r=>r.map(([lat,lon])=>[lon,lat,599]));window.syntheticTerrain={kind:'native_face_triangle_terrain',runId:f.manifest.runId,geometrySha256:f.manifest.geometry.sha256,verticalDatum:'NAVD88',vertices,triangles:[[0,1,2],[0,2,3],[0,3,4],[5,6,7],[5,7,8]],triangleFaceId:[...Array(3).fill(f.geometry.cells[0].nativeFaceId),...Array(2).fill(f.geometry.cells[1].nativeFaceId)]};f.manifest.terrainDisplay={status:'available',artifact:{path:'terrain.json.gz',sha256:'b'.repeat(64)}};await qa.view.setViewMode('3d');});
 const native3D=await page.evaluate(()=>({view:qa.view.viewMode,info:qa.view.inspect().model.cellInfo(0),water:qa.view.inspect().model.water.count,reads:qa.reads}));assert.equal(native3D.view,'3d');assert.equal(native3D.info.nativeFaceId,'9007199254740997');assert.equal(native3D.info.depthM,2);assert.ok(native3D.water>0);assert.ok(native3D.reads.includes('terrain.json.gz'));
 await page.evaluate(()=>qa.view.update(qa.f.manifest.frames[2]));assert.equal(await page.evaluate(()=>qa.view.inspect().model.cellInfo(0).depthM),3);
 await page.screenshot({path:'public/simulation/preview/refined-SYNTHETIC-contract.png'});
 await page.evaluate(()=>qa.view.dispose());assert.equal(await page.locator('.voxel-geographic').count(),0);assert.deepEqual(errors,[]);
 await writeFile('public/simulation/preview/refined-SYNTHETIC-verification.json',JSON.stringify({notice:'SYNTHETIC CONTRACT CHECK ONLY; no real refined output or coverage',missing,unavailable,native3D,errors,legacyRequests:requests.filter(u=>/frozen-|water-footprints-/.test(u))},null,2));console.log(JSON.stringify({unavailable,water:native3D.water,errors}));
}finally{await browser.close();server.closeAllConnections();server.close();}
