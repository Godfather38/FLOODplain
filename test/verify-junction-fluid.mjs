// Integrated evidence for the Brawley junction fluid layer, inside the real app
// at index.html?case=refined#/map. It is NOT a physical-device performance
// measurement: SwiftShader timings are software-GPU timings and are reported as
// such. Run with the built bundle in place:
//   node tools/simulation/build-geographic-view.mjs
//   node test/verify-junction-fluid.mjs
import {chromium} from 'playwright';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {server} from '../tools/simulation/voxel-preview-server.mjs';
import assert from 'node:assert/strict';

const port=process.env.VOXEL_QA_PORT||8094;
const JUNCTION=[-111.29459,32.39322];
const stage=process.env.JUNCTION_STAGE||'after';
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const result={stage,environment:'Chrome SwiftShader software GPU; not a phone or hardware-GPU measurement',
  errors:[],frames:[],pans:[],lifecycle:[]};
const out='junction-evidence';
let activePage;

async function shoot(page,name){await page.screenshot({path:`${out}/${stage}-${name}.png`});return `${out}/${stage}-${name}.png`;}
// Reach the 3D toggle the way a person does. After a viewport change the
// options sheet is closed again, and force-clicking a hidden control would be
// testing something the user cannot do.
async function toggleThreeD(page){
  const button=page.locator('[data-3d]');
  if(!await button.isVisible()){
    await page.locator('[data-panel="options"]').click();
    const extra=page.locator('.flood-extra > summary');
    if(await extra.count()&&!await button.isVisible())await extra.click();
    await button.waitFor({state:'visible',timeout:30000});
  }
  await button.click();
}
// Wait for a SETTLED status, not just a good one. Waiting only for 'ready'
// turns an explained 'unavailable' into a silent timeout that says nothing.
const junctionSettled=()=>['ready','dry','unavailable'].includes(window.qa?.view.inspect().junctionStatus?.status);
const describeJunction=()=>{const v=window.qa.view.inspect();
  return {status:v.junctionStatus,junction:v.junction,note:v.note,animating:v.animationActive,
    zoom:v.map.getZoom(),overviewMode:v.terrainInfo?.overviewMode??null,terrainKind:v.terrainInfo?.terrainKind??null};};

try{
  await mkdir(out,{recursive:true});
  const page=await browser.newPage({viewport:{width:1280,height:850}}); activePage=page;
  page.on('pageerror',e=>{result.errors.push(e.message);console.log('PAGE ERROR',e.message);});
  page.on('console',m=>{if(m.type()==='error')result.errors.push(m.text());});
  // Same shim the other renderer checks use: expose the live view without
  // changing the shipped bundle or the UI owner's files.
  await page.route('**/simulation/geographic-view.js',r=>r.fulfill({contentType:'text/javascript',
    body:`export {createRefinedRendererSource} from './geographic-view-observed.js';import {createGeographicView as create} from './geographic-view-observed.js';export async function createGeographicView(options){const view=await create(options);window.qa={view,state:options.sharedState};return view;}`}));
  await page.route('**/simulation/geographic-view-observed.js',async r=>r.fulfill({contentType:'text/javascript',
    body:await readFile('public/simulation/geographic-view.js','utf8')}));

  await page.goto(`http://127.0.0.1:${port}/index.html?case=refined#/map`);
  await page.waitForFunction(()=>window.qa?.state.snapshot().status==='ready',null,{timeout:180000});

  // Flat-map entry must not have fetched any junction asset.
  result.flatEntryRequests=await page.evaluate(()=>performance.getEntriesByType('resource')
    .map(e=>e.name).filter(n=>/brawley-baked|scene-contract|fluid-prototype/.test(n)));
  assert.deepEqual(result.flatEntryRequests,[],'no junction asset may load on flat-map entry');
  result.before=await shoot(page,'flat-before');

  await toggleThreeD(page);
  await page.waitForFunction(()=>window.qa.view.inspect().model&&window.qa.state.snapshot().displayed?.view==='3d',null,{timeout:180000});

  const look=async zoom=>{
    await page.evaluate(async({point,zoom})=>{const v=window.qa.view.inspect();
      v.map.setCenter(point);v.map.setZoom(zoom,{animation:false});
      await v.geography.update(v.map.getExtent(),zoom);},{point:JUNCTION,zoom});
    await page.waitForTimeout(400);
  };

  // Below the junction zoom gate nothing loads; at the gate the layer appears.
  await look(13);
  await page.waitForTimeout(600);
  result.belowGate=await page.evaluate(()=>window.qa.view.inspect().junctionStatus?.status??'off');
  assert.equal(result.belowGate,'off','the junction layer must stay off at overview zoom');
  result.coarse=await shoot(page,'3d-coarse-no-junction');

  await look(17);
  // The junction gate needs the detail terrain, not the whole-domain overview.
  // Record what the terrain actually settled on so a gate failure is diagnosable.

  result.terrainAtJunction=await page.evaluate(()=>({overviewMode:window.qa.view.inspect().terrainInfo?.overviewMode??null,
    terrainKind:window.qa.view.inspect().terrainInfo?.terrainKind??null,zoom:window.qa.view.inspect().map.getZoom()}));
  await page.waitForFunction(junctionSettled,null,{timeout:180000});
  await page.waitForTimeout(1200);
  result.ready=await page.evaluate(describeJunction);
  assert.equal(result.ready.status.status,'ready',
    'junction layer did not become ready: '+result.ready.status.status+' — '+(result.ready.status.reason??'no reason given')
    +' (zoom '+result.ready.zoom+', overviewMode '+result.ready.overviewMode+')');
  assert.ok(result.ready.junction.blobs.count>0,'particles must be rendered, not just computed');
  assert.ok(result.ready.junction.geography.triangles>10000,'the baked junction mesh is in the scene');
  assert.ok(result.ready.junction.placement.maxDeviationM<0.1,'placement is checked against the live projection');
  result.after=await shoot(page,'3d-junction-ready');

  // Measured particle motion in the live map, at one fixed geographic view.
  const sample=()=>page.evaluate(()=>{const j=window.qa.view.inspect().junction;
    const o=window.qa.view.inspect().model.group.getObjectByName('brawley-junction-blobs');
    return {offsets:Array.from(o.geometry.getAttribute('blobOffset').array.slice(0,96)),
      instances:o.geometry.instanceCount,trailSegments:j.blobs.trailSegments,streakSegments:j.blobs.streakSegments,
      screenRadiusPx:j.blobs.screenRadiusPx,radiusMetres:j.blobs.radiusMetres,
      stats:{steps:j.fluid?.steps,maxStepDisplacementM:j.fluid?.maxStepDisplacementM,
        meanSimulatedHorizontalVelocityMps:j.fluid?.meanSimulatedHorizontalVelocityMps,
        sourceTime:j.fluid?.sourceTime},stepMs:j.lastStepMs,substeps:j.substeps,skipped:j.skippedSteps};});
  const first=await sample();
  await page.waitForTimeout(2500);
  const second=await sample();
  let moved=0,maximum=0;
  for(let i=0;i<first.offsets.length;i+=3){
    const d=Math.hypot(second.offsets[i]-first.offsets[i],second.offsets[i+1]-first.offsets[i+1],second.offsets[i+2]-first.offsets[i+2]);
    if(d>1e-7)moved++;maximum=Math.max(maximum,d);
  }
  result.motion={sampledBlobs:first.offsets.length/3,moved,maximumLocalUnits:maximum,
    instances:second.instances,trailSegments:second.trailSegments,first:first.stats,second:second.stats,
    stepMs:second.stepMs,substeps:second.substeps,skippedSteps:second.skipped};
  assert.ok(second.stats.steps>first.stats.steps,'the solver advanced inside the live map');
  assert.ok(moved>0,'rendered blob instances actually travel');
  assert.ok(second.trailSegments>0,'travel direction is drawn');
  assert.ok(second.streakSegments>0&&second.streakSegments<second.instances,
    'direction is drawn on a readable subset, not on every blob');
  assert.equal(second.stats.sourceTime,first.stats.sourceTime,'local motion never advances the source clock');
  result.travel=await shoot(page,'3d-junction-travel');

  // Exact native values at the same geographic view, across two source frames.
  for(const index of [0,20]){
    await page.evaluate(i=>{const slider=document.querySelector('[data-time]');slider.value=String(i);
      slider.dispatchEvent(new Event('input'));},index);
    await page.waitForFunction(i=>window.qa.state.snapshot().displayed?.index===i,index,{timeout:180000});
    await page.waitForFunction(junctionSettled,null,{timeout:180000});
    await page.waitForTimeout(900);
    const frame=await page.evaluate(()=>{const v=window.qa.view.inspect();
      return {displayed:window.qa.state.snapshot().displayed,junctionStatus:v.junctionStatus,
        junction:v.junction,water:v.model.water.count,land:v.model.land.count};});
    result.frames.push({index,...frame});
    await shoot(page,`3d-junction-frame-${index}`);
  }
  const [a,b]=result.frames;
  assert.notEqual(a.junction.fluid.sourceTime,b.junction.fluid.sourceTime,'the junction reseeds with the selected native frame');
  assert.equal(a.junction.fluid.sourceTime,a.displayed.time,'the junction shows the frame the app says it shows');
  assert.equal(b.junction.fluid.sourceTime,b.displayed.time);
  assert.notEqual(a.junction.fluid.clippedInitialVolumeM3,b.junction.fluid.clippedInitialVolumeM3);

  // Repeated pan away and back: the layer stops and releases, then returns.
  const cdp=await page.context().newCDPSession(page);
  for(const shift of [0.02,0,0.02,0]){
    await page.evaluate(async({point,shift})=>{const v=window.qa.view.inspect();
      v.map.setCenter([point[0]+shift,point[1]]);await v.geography.update(v.map.getExtent(),v.map.getZoom());},{point:JUNCTION,shift});
    await page.waitForTimeout(1500);
    await cdp.send('HeapProfiler.collectGarbage');
    result.pans.push({shift,heap:(await cdp.send('Runtime.getHeapUsage')).usedSize,
      ...await page.evaluate(()=>{const v=window.qa.view.inspect();
        return {status:v.junctionStatus.status,active:v.junctionActive,
          children:v.model.group.children.length,blobs:v.junction?.blobs?.count??0};})});
  }
  assert.ok(result.pans.filter(p=>p.shift===0).every(p=>p.status==='ready'||p.status==='dry'),'returning to the junction restores it');
  assert.ok(result.pans.filter(p=>p.shift!==0).every(p=>p.status==='off'&&!p.active),'panning away stops the solver');
  const groups=new Set(result.pans.map(p=>p.children));
  assert.ok(groups.size<=2,'repeated entry must not accumulate scene children: '+[...groups]);

  // Phone width, then mode changes and teardown.
  await look(17);
  await page.waitForFunction(junctionSettled,null,{timeout:180000});
  result.desktopBlobs=await page.evaluate(describeJunction);
  assert.ok(result.desktopBlobs.junction.blobs.screenRadiusPx>=2.5,
    'blobs must be at least a couple of screen pixels or nobody can see the water: '+result.desktopBlobs.junction.blobs.screenRadiusPx);
  assert.ok(result.desktopBlobs.junction.blobs.streakSegments>0,'direction streaks must be drawn');

  await page.setViewportSize({width:390,height:844});
  await page.waitForTimeout(2500);
  result.phone=await page.evaluate(()=>{const v=window.qa.view.inspect();
    return {status:v.junctionStatus,junction:v.junction,dpr:v.counters.effectiveDPR};});
  await shoot(page,'phone-junction');
  assert.ok(result.phone.dpr<=1,'the existing phone pixel-ratio cap is preserved');
  assert.equal(result.phone.junction.maxParticles,768,'a phone-width viewport must actually drop to the phone particle budget');
  assert.equal(result.phone.junction.blobs.count,768);
  assert.ok(result.phone.junction.blobs.screenRadiusPx>=2.5,'blobs stay visible at phone width');
  // The shared time dock owns the bottom of a phone screen; this layer's
  // readout must not sit on top of it.
  result.phoneLayout=await page.evaluate(()=>{
    const legend=document.querySelector('[data-junction-legend]'),dock=document.querySelector('.map-dock');
    if(!legend||!dock)return null;
    const l=legend.getBoundingClientRect(),d=dock.getBoundingClientRect();
    return {legend:{top:l.top,bottom:l.bottom,left:l.left,right:l.right},dock:{top:d.top,bottom:d.bottom,left:d.left,right:d.right},
      overlaps:l.left<d.right&&l.right>d.left&&l.top<d.bottom&&l.bottom>d.top};});
  assert.ok(result.phoneLayout,'the junction readout and the shared dock must both be present to compare');
  assert.equal(result.phoneLayout.overlaps,false,'the junction readout overlaps the shared time dock: '+JSON.stringify(result.phoneLayout));

  await page.setViewportSize({width:1280,height:850});
  await page.waitForTimeout(1200);
  await toggleThreeD(page);
  await page.waitForTimeout(1200);
  result.lifecycle.push({step:'flat',...await page.evaluate(()=>{const v=window.qa.view.inspect();
    return {status:v.junctionStatus.status,active:v.junctionActive,junction:v.junction};})});
  assert.equal(result.lifecycle[0].status,'off');
  assert.equal(result.lifecycle[0].junction.blobs,null,'leaving 3D releases the junction GPU resources');
  await shoot(page,'flat-after');

  // Reduced motion must keep the water legible while stopping the animation.
  const reduced=await browser.newContext({viewport:{width:1280,height:850},reducedMotion:'reduce'});
  const reducedPage=await reduced.newPage();
  reducedPage.on('pageerror',e=>result.errors.push(e.message));
  await reducedPage.route('**/simulation/geographic-view.js',r=>r.fulfill({contentType:'text/javascript',
    body:`export {createRefinedRendererSource} from './geographic-view-observed.js';import {createGeographicView as create} from './geographic-view-observed.js';export async function createGeographicView(options){const view=await create(options);window.qa={view,state:options.sharedState};return view;}`}));
  await reducedPage.route('**/simulation/geographic-view-observed.js',async r=>r.fulfill({contentType:'text/javascript',
    body:await readFile('public/simulation/geographic-view.js','utf8')}));
  await reducedPage.goto(`http://127.0.0.1:${port}/index.html?case=refined#/map`);
  await reducedPage.waitForFunction(()=>window.qa?.state.snapshot().status==='ready',null,{timeout:180000});
  await toggleThreeD(reducedPage);
  await reducedPage.waitForFunction(()=>window.qa.view.inspect().model,null,{timeout:180000});
  await reducedPage.evaluate(async({point})=>{const v=window.qa.view.inspect();
    v.map.setCenter(point);v.map.setZoom(17,{animation:false});
    await v.geography.update(v.map.getExtent(),17);},{point:JUNCTION});
  await reducedPage.waitForFunction(junctionSettled,null,{timeout:180000});
  await reducedPage.waitForTimeout(1500);
  result.reducedMotion=await reducedPage.evaluate(()=>{const v=window.qa.view.inspect();
    return {status:v.junctionStatus,blobs:v.junction.blobs,animating:v.animationActive};});
  await reducedPage.screenshot({path:`${out}/${stage}-reduced-motion.png`});
  assert.ok(result.reducedMotion.blobs.count>0,'reduced motion still shows where the water is');
  assert.equal(result.reducedMotion.blobs.trailsVisible,false,'reduced motion draws no travel lines');
  assert.equal(result.reducedMotion.animating,false);
  await reduced.close();

  assert.deepEqual(result.errors,[]);
  result.passed=true;
  console.log(JSON.stringify(result,null,2));
}catch(error){
  result.failure=error.stack;
  if(activePage){try{result.failureState=await activePage.evaluate(()=>{const v=window.qa?.view.inspect(); return {status:v?.junctionStatus,junction:v?.junction,zoom:v?.map.getZoom(),center:v?.map.getCenter(),terrain:v?.terrainInfo,note:v?.note,shared:window.qa?.state.snapshot()};}); await activePage.screenshot({path:out+'/failure.png',timeout:15000}); console.log(JSON.stringify(result.failureState));}catch(e){console.log('Failure-state capture:',e.message);}}
  process.exitCode=1;
  console.error(error);
}finally{
  await writeFile('public/simulation/preview/junction-fluid-verification.json',JSON.stringify(result,null,2)+'\n');
  await browser.close();
  server.close();
}
