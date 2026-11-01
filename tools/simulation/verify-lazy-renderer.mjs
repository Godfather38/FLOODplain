import {chromium} from 'playwright';
import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {server} from './voxel-preview-server.mjs';
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--enable-webgl','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
try{
  await page.goto('http://127.0.0.1:8094/simulation/voxel-qa.html');
  await page.waitForFunction(()=>window.qaReady||window.qaError,null,{timeout:60000});
  const cold=await page.evaluate(()=>({error:window.qaError,view:qa.view.viewMode,model:!!qa.view.inspect().model,layer:!!qa.view.inspect().layer,animation:qa.view.inspect().animationActive,readyMs:performance.now(),resources:performance.getEntriesByType('resource').map(r=>({url:r.name,bytes:r.encodedBodySize})),heap:performance.memory?.usedJSHeapSize}));
  assert.equal(cold.error,undefined);assert.equal(cold.view,'flat');assert.equal(cold.model,false);assert.equal(cold.layer,false);assert.equal(cold.animation,false);
  assert.equal(cold.resources.filter(r=>/frozen-terrain|frozen-voxel-terrain|geographic-3d-runtime/.test(r.url)).length,0);
  await page.evaluate(()=>{const c=qa.run.cells[9344];qa.map.setView([c.lat,c.lon],16);});
  const first3D=await page.evaluate(async()=>{const t=performance.now();await qa.view.setViewMode('3d');return {ms:performance.now()-t,model:!!qa.view.inspect().model,view:qa.view.viewMode,heap:performance.memory?.usedJSHeapSize};});
  assert.equal(first3D.model,true);assert.equal(first3D.view,'3d');
  const frameTimings=await page.evaluate(async()=>{const results=[];for(const i of [9,10,11,10]){const t=performance.now();await qa.view.update(qa.run.frames[i]);await new Promise(requestAnimationFrame);results.push(performance.now()-t);}return results;});
  const switches=await page.evaluate(async()=>{const out=[];for(let i=0;i<3;i++){let t=performance.now();await qa.view.setViewMode('flat');await qa.view.setViewMode('3d');out.push(performance.now()-t);}await qa.view.setViewMode('flat');return {ms:out,layers:qa.view.inspect().map.getLayers().map(l=>l.getId()),visible:qa.view.inspect().model.group.visible,animation:qa.view.inspect().animationActive,readyMs:performance.now(),resources:performance.getEntriesByType('resource').filter(r=>/frozen-terrain|frozen-voxel-terrain|geographic-3d-runtime/.test(r.name)).map(r=>({url:r.name,bytes:r.encodedBodySize})),heap:performance.memory?.usedJSHeapSize};});
  assert.equal(switches.visible,false);assert.equal(switches.animation,false);
  await page.evaluate(()=>qa.view.dispose());assert.equal(await page.locator('.voxel-geographic').count(),0);
  const evidence={environment:'Chrome headless SwiftShader, 390x844 viewport; not a physical phone or hardware GPU benchmark',cold,first3D,frameTimings,switches,errors};
  await writeFile('public/simulation/preview/lazy-renderer-verification.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence,null,2));assert.deepEqual(errors,[]);
}finally{await browser.close();server.closeAllConnections();server.close();}
