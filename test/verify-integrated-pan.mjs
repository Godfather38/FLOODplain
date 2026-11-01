import {chromium} from 'playwright';
import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {server} from '../tools/simulation/voxel-preview-server.mjs';
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--enable-precise-memory-info','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
 const page=await browser.newPage({viewport:{width:1280,height:800},deviceScaleFactor:3,reducedMotion:'reduce'}),errors=[],requests=[];let crashed=false;
 page.on('crash',()=>crashed=true);page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
 await page.route('**/simulation/geographic-view.js',r=>r.fulfill({contentType:'text/javascript',body:`export {createRefinedRendererSource} from './geographic-view-observed.js';import {createGeographicView as create} from './geographic-view-observed.js';export async function createGeographicView(options){const view=await create(options);window.qa={view,source:options.source,state:options.sharedState};return view;}`}));
 await page.route('**/simulation/geographic-view-observed.js',async r=>r.fulfill({contentType:'text/javascript',body:await readFile('public/simulation/geographic-view.js','utf8')}));
 await page.goto('http://127.0.0.1:8094/index.html?case=refined#/map');
 await page.waitForFunction(()=>window.qa?.state.snapshot().status==='ready',null,{timeout:180000});
 const cdp=await page.context().newCDPSession(page);
 async function sample(label){await cdp.send('HeapProfiler.collectGarbage');return {label,...await cdp.send('Runtime.getHeapUsage'),...await page.evaluate(()=>{const x=qa.view.inspect();return {time:x.frame?.time,counters:x.counters,geography:x.geography.budgets,canvas:Array.from(document.querySelectorAll('.voxel-geographic canvas'),c=>({width:c.width,height:c.height,cssWidth:c.clientWidth,cssHeight:c.clientHeight})),overview:x.overview.data?.stats,model:!!x.model};})};}
 const samples=[await sample('initial')],times=[];
 for(let i=0;i<24;i++){
  const t=Date.now();await page.mouse.move(650,420);await page.mouse.down();await page.mouse.move(650+(i%2?110:-110),420+(i%4<2?55:-55),{steps:8});await page.mouse.up();
  await page.waitForTimeout(80);
  await page.waitForFunction(()=>{const c=qa.view.inspect().counters;return !c||(!c.overviewActive&&!c.overviewPending&&!c.refreshPending);},null,{timeout:60000});times.push(Date.now()-t);
  if(i%6===5)samples.push(await sample('pan '+(i+1)));
 }
 for(const index of [20,0,10,20]){await page.evaluate(index=>{const e=document.querySelector('[data-time]');e.value=index;e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));},index);await page.waitForFunction(index=>qa.state.snapshot().status==='ready'&&qa.state.snapshot().displayed.index===index,index,{timeout:90000});}
 for(const delta of [-1,-1,1,1]){await page.evaluate(d=>qa.view.zoom(d),delta);await page.waitForTimeout(300);await page.waitForFunction(()=>!qa.view.inspect().counters?.overviewActive,null,{timeout:60000});}
 samples.push(await sample('time and zoom'));
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(600);await page.waitForFunction(()=>!qa.view.inspect().counters?.overviewActive,null,{timeout:60000});samples.push(await sample('phone size DPR3'));
 await page.screenshot({path:'public/simulation/preview/refined-pan-stability-phone.png'});
 assert.equal(crashed,false);assert.deepEqual(errors,[]);assert.equal(samples.at(-1).model,false);
 for(const s of samples)if(s.counters)assert.ok(s.counters.overviewMaxActive<=1);
 const forbidden=requests.filter(u=>/geographic-3d-runtime|terrain-display|terrain-tiles/.test(u));assert.deepEqual(forbidden,[]);
 const result={environment:'Actual 4aeb310 app and compact 398613-face partial package; Chrome headless SwiftShader, DPR3 emulation, not physical device',crashed,errors,panMs:times,samples,forbidden};
 await writeFile('public/simulation/preview/refined-pan-stability.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{await browser.close();server.closeAllConnections();server.close();}
