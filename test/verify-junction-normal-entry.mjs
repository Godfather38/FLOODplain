// What a REAL user sees. No forced camera, no injected map state.
//
// The existing acceptance run drives the map with
// `map.setCenter(Brawley); map.setZoom(19)` straight out of the harness. A
// person opening the app never does that, so nothing it proves says anything
// about what they actually get. This walks the shipped UI with real clicks —
// open the map, press 3D, press the zoom buttons, press "Fit flood area",
// switch back to flat and into 3D again, close and reopen the route panel —
// and records, at every step, the zoom, the junction status and whether any
// water is on screen at all.
//
// The qa handle is used for READING only. Every navigation here is a click.
//
//   node tools/simulation/build-geographic-view.mjs
//   node test/verify-junction-normal-entry.mjs
import {chromium} from 'playwright';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,extname,sep} from 'node:path';

const root=resolve('public');
const server=createServer(async(req,res)=>{try{
  const path=resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
  if(!path.startsWith(root+sep))throw Error();
  const body=await readFile(path);
  res.writeHead(200,{'content-type':({'.html':'text/html','.js':'text/javascript','.css':'text/css',
    '.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.gz':'application/gzip',
    '.glb':'model/gltf-binary','.frag':'text/plain','.vert':'text/plain'})[extname(path)]||'application/octet-stream'}).end(body);
}catch{res.writeHead(404).end();}});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const port=server.address().port;
const out='junction-evidence';
const report={kind:'normal-entry',
  url:`/index.html?case=refined#/map`,
  environment:'Chrome SwiftShader software GPU; not a phone or hardware-GPU measurement',
  steps:[],errors:[]};
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});

try{
  await mkdir(out,{recursive:true});
  const page=await browser.newPage({viewport:{width:1280,height:850}});
  page.on('pageerror',e=>{report.errors.push(e.message);console.log('PAGE ERROR',e.message);});
  page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
  // Read-only observation hook. It changes no behaviour and drives nothing.
  await page.route('**/simulation/geographic-view.js',r=>r.fulfill({contentType:'text/javascript',
    body:`export {createRefinedRendererSource} from './geographic-view-observed.js';import {createGeographicView as create} from './geographic-view-observed.js';export async function createGeographicView(options){const view=await create(options);window.qa={view,state:options.sharedState};return view;}`}));
  await page.route('**/simulation/geographic-view-observed.js',async r=>r.fulfill({contentType:'text/javascript',
    body:await readFile('public/simulation/geographic-view.js','utf8')}));
  await page.goto(`http://127.0.0.1:${port}/index.html?case=refined#/map`);
  await page.waitForFunction(()=>window.qa?.state.snapshot().status==='ready',null,{timeout:180000});

  const look=async(name,note)=>{
    const file=`${out}/normal-${name}.png`;
    await page.screenshot({path:file});
    const state=await page.evaluate(()=>{
      const v=window.qa?.view?.inspect?.();
      if(!v)return {noView:true};
      const group=v.model?.group;
      const water=group?.getObjectByName('brawley-junction-water-surface');
      const blobs=group?.getObjectByName('brawley-junction-blobs');
      return {
        viewMode:v.viewMode??window.qa.view.viewMode,
        zoom:v.map?.getZoom?.()??null,
        centre:v.map?.getCenter?.()?(()=>{const c=v.map.getCenter();return [c.x,c.y];})():null,
        junctionStatus:v.junctionStatus?.status??null,
        junctionReason:v.junctionStatus?.reason??null,
        junctionActive:v.junctionActive??null,
        junctionParticles:v.junctionStatus?.particleCount??null,
        // The whole-domain modelled water sheet: this is what should be on
        // screen when the close-up junction layer is not eligible.
        modelWaterCells:v.model?.water?.count??null,
        modelWaterVisible:v.model?.water?.visible??null,
        modelGroupVisible:group?.visible??null,
        landCells:v.model?.land?.count??null,
        terrainKind:v.terrainInfo?.terrainKind??null,
        overviewMode:v.terrainInfo?.overviewMode??null,
        compositePresent:!!water,compositeVisible:water?.visible??null,
        spheresVisible:blobs?.visible??null,
        regional:(()=>{const r=v.regionalContext;return r?{
          status:r.status??'ready',attached:r.attached??null,visible:r.visible??null,
          triangles:r.triangles??null,stride:r.stride??null,
          elevationRangeM:r.elevationRangeM??null,
          exaggeration:r.verticalExaggeration??null,
          cutOut:r.droppedTrianglesOverNativeDomain??null,
          reason:r.reason??null}:null;})(),
        note:v.note??null};});
    report.steps.push({name,note,file,...state});
    console.log(String(name).padEnd(28),
      'zoom',String(state.zoom).padEnd(5),
      'junction',String(state.junctionStatus).padEnd(12),
      'modelWater',String(state.modelWaterCells).padEnd(6),
      'composite',String(state.compositeVisible).padEnd(5),
      'regional',String(state.regional?.status??'-').padEnd(11),
      'tris',String(state.regional?.triangles??'-'));
    return state;
  };
  const click=async(selector,label)=>{
    const node=page.locator(selector).first();
    if(!await node.count())throw Error('missing control '+selector+' ('+label+')');
    if(!await node.isVisible()){
      await page.locator('[data-panel="options"]').click().catch(()=>{});
      const extra=page.locator('.flood-extra > summary');
      if(await extra.count()&&!await node.isVisible())await extra.click().catch(()=>{});
      await node.waitFor({state:'visible',timeout:30000});
    }
    await node.click();
    await page.waitForTimeout(1200);
  };

  await look('01-flat-default','as the app opens: flat map, default view');
  await click('[data-3d]','3D toggle');
  await page.waitForTimeout(3500);
  await look('02-3d-default','3D, straight after pressing the toggle, camera untouched');

  // Zoom in with the real buttons until the junction gate is crossed, so the
  // number of ordinary presses it takes is on record.
  for(let press=1;press<=7;press++){
    await click('[data-in]','zoom in');
    await page.waitForTimeout(1800);
    const state=await look(`03-zoom-in-${String(press).padStart(2,'0')}`,`zoom-in press ${press}`);
    if(state.junctionStatus==='ready')break;
  }

  // The one affordance that actually takes a person to the modelled water.
  await click('[data-fit]','Fit flood area');
  await page.waitForTimeout(4000);
  await look('04-fit-flood-area','after pressing "Fit flood area"');

  // The new affordance: one press, no camera injection, no harness.
  await click('.voxel-goto-crossing','Close-up crossing');
  await page.waitForFunction(()=>window.qa.view.inspect().junctionStatus?.status==='ready',
    null,{timeout:180000}).catch(()=>{});
  await page.waitForTimeout(5000);
  await look('04b-crossing-button','after pressing "Close-up crossing" — normal UI only');

  // The surrounding relief, reached by its own press.
  await click('.voxel-goto-regional','Regional view');
  await page.waitForTimeout(7000);
  await look('04c-regional-view','after pressing "Regional view" — surrounding mountains');
  // And back again: the close-up must stay usable after the wide view.
  await click('.voxel-goto-crossing','Close-up crossing again');
  await page.waitForFunction(()=>window.qa.view.inspect().junctionStatus?.status==='ready',
    null,{timeout:180000}).catch(()=>{});
  await page.waitForTimeout(5000);
  await look('04d-crossing-after-regional','close-up still works after the regional view');

  // Mode switching and panel close/reopen: the lifecycle the user exercised.
  await click('[data-3d]','3D toggle (back to flat)');
  await page.waitForTimeout(2000);
  await look('05-back-to-flat','flat again');
  await click('[data-3d]','3D toggle (second entry)');
  await page.waitForTimeout(4000);
  await look('06-3d-second-entry','3D a second time');
  // Route panel sends you to the routes screen; coming back is a navigation,
  // so return to the map the way a person would before touching 3D again.
  await click('[data-panel="routes"]','routes panel');
  await page.waitForTimeout(1500);
  await page.evaluate(()=>{location.hash='#/map';});
  await page.waitForTimeout(2500);
  await look('07-back-from-routes','returned to the map after the routes screen — flat, which is the default');
  // Coming back from the routes screen returns you to the flat default, so 3D
  // is pressed again exactly as a person would.
  await click('[data-3d]','3D toggle after returning from routes');
  await page.waitForTimeout(4000);
  await click('.voxel-goto-crossing','Close-up crossing after panel cycle');
  await page.waitForFunction(()=>window.qa.view.inspect().junctionStatus?.status==='ready',
    null,{timeout:180000}).catch(()=>{});
  await page.waitForTimeout(5000);
  await look('07b-crossing-after-cycle','crossing reached again after close/reopen');

  await page.setViewportSize({width:390,height:844});
  await page.waitForTimeout(3000);
  await look('08-phone-default','phone width, camera untouched');
  if(!await page.locator('.voxel-goto-crossing').first().isVisible())
    await click('[data-3d]','3D toggle on phone');
  await click('.voxel-goto-crossing','Close-up crossing on phone');
  await page.waitForFunction(()=>window.qa.view.inspect().junctionStatus?.status==='ready',
    null,{timeout:180000}).catch(()=>{});
  await page.waitForTimeout(5000);
  await look('09-phone-crossing','phone, after pressing "Close-up crossing"');

  await page.setViewportSize({width:1280,height:850});
  await page.waitForTimeout(2000);

  // ---- Deliberate faults. A clean load proves nothing about fallbacks. ----
  //
  // Each case breaks ONE thing, then asks what is still on screen. The rule
  // being tested is the same every time: when detail fails, the lower-detail
  // real thing must remain, and nothing may invent water.
  const faults=[];
  const faultCase=async(name,routes,steps)=>{
    const context=await browser.newContext({viewport:{width:1280,height:850}});
    const fault=await context.newPage();
    const pageErrors=[];
    fault.on('pageerror',e=>pageErrors.push(e.message));
    await fault.route('**/simulation/geographic-view.js',r=>r.fulfill({contentType:'text/javascript',
      body:`export {createRefinedRendererSource} from './geographic-view-observed.js';import {createGeographicView as create} from './geographic-view-observed.js';export async function createGeographicView(options){const view=await create(options);window.qa={view,state:options.sharedState};return view;}`}));
    await fault.route('**/simulation/geographic-view-observed.js',async r=>r.fulfill({contentType:'text/javascript',
      body:await readFile('public/simulation/geographic-view.js','utf8')}));
    for(const [pattern,handler] of routes)await fault.route(pattern,handler);
    await fault.goto(`http://127.0.0.1:${port}/index.html?case=refined#/map`);
    await fault.waitForFunction(()=>window.qa?.state.snapshot().status==='ready',null,{timeout:180000});
    const result=await steps(fault);
    const file=`${out}/fault-${name}.png`;
    await fault.screenshot({path:file});
    const state=await fault.evaluate(()=>{
      const v=window.qa?.view?.inspect?.();
      const group=v?.model?.group;
      return {junctionStatus:v?.junctionStatus?.status??null,
        junctionReason:v?.junctionStatus?.reason??null,
        modelWaterCells:v?.model?.water?.count??null,
        modelWaterVisible:v?.model?.water?.visible??null,
        landCells:v?.model?.land?.count??null,
        terrainKind:v?.terrainInfo?.terrainKind??null,
        overviewMode:v?.terrainInfo?.overviewMode??null,
        regionalStatus:v?.regionalContext?.status??'ready',
        regionalTriangles:v?.regionalContext?.triangles??null,
        compositeVisible:group?.getObjectByName('brawley-junction-water-surface')?.visible??null,
        spheresVisible:group?.getObjectByName('brawley-junction-blobs')?.visible??null,
        note:v?.note??null};});
    faults.push({name,file,pageErrors,...state,...result});
    console.log('FAULT',String(name).padEnd(24),
      'junction',String(state.junctionStatus).padEnd(12),
      'modelWater',String(state.modelWaterCells).padEnd(6),
      'land',String(state.landCells).padEnd(6),
      'regional',String(state.regionalStatus));
    await context.close();
  };
  const enter3D=async fault=>{
    const button=fault.locator('[data-3d]').first();
    if(!await button.isVisible()){
      await fault.locator('[data-panel="options"]').click().catch(()=>{});
      const extra=fault.locator('.flood-extra > summary');
      if(await extra.count()&&!await button.isVisible())await extra.click().catch(()=>{});
      await button.waitFor({state:'visible',timeout:30000});
    }
    await button.click();
    await fault.waitForTimeout(5000);
  };
  const pressCrossing=async fault=>{
    const button=fault.locator('.voxel-goto-crossing').first();
    if(await button.isVisible()){await button.click();
      await fault.waitForTimeout(8000);}
  };

  // 1. Regional context 404s. The map must keep the native ground and water.
  await faultCase('regional-missing',
    [['**/regional-context/**',r=>r.fulfill({status:404,body:'gone'})]],
    async fault=>{await enter3D(fault);
      const button=fault.locator('.voxel-goto-regional').first();
      if(await button.isVisible())await button.click();
      await fault.waitForTimeout(6000);return {pressedRegional:true};});

  // 2. Regional context is slow. It must not block the map or the crossing.
  await faultCase('regional-slow',
    [['**/regional-context/terrain.json.gz',async r=>{await new Promise(s=>setTimeout(s,25000));await r.continue();}]],
    async fault=>{await enter3D(fault);await pressCrossing(fault);return {slowAsset:'terrain.json.gz 25s'};});

  // 3. The junction's baked detail ground 404s. The native model water and the
  //    whole-domain ground must survive; no fabricated stand-in water.
  await faultCase('junction-baked-missing',
    [['**/brawley-baked/**',r=>r.fulfill({status:503,body:'unavailable'})]],
    async fault=>{await enter3D(fault);await pressCrossing(fault);return {};});

  // 4. The fluid compute module fails to load. Native modelled water must
  //    still be drawn; the particle layer reports itself unavailable.
  await faultCase('fluid-module-missing',
    [['**/fluid-prototype/junction-fluid.js',r=>r.fulfill({status:500,body:'boom'})]],
    async fault=>{await enter3D(fault);await pressCrossing(fault);return {};});

  // 5. No WebGL2: the composite needs fragment depth, so the lit spheres are
  //    the documented fallback. Water must not vanish.
  await faultCase('no-webgl2',
    [],
    async fault=>{
      await fault.addInitScript(()=>{
        const original=HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext=function(type,...rest){
          if(type==='webgl2')return null;
          return original.call(this,type,...rest);};});
      await fault.reload();
      await fault.waitForFunction(()=>window.qa?.state.snapshot().status==='ready',null,{timeout:180000});
      await enter3D(fault);await pressCrossing(fault);
      return {capability:'webgl2 denied'};});

  // 6. The detailed terrain tiles fail. The coarse whole-domain ground must
  //    remain rather than leaving a hole.
  await faultCase('detail-tiles-missing',
    [['**/terrain-tile-*',r=>r.fulfill({status:504,body:'timeout'})]],
    async fault=>{await enter3D(fault);await pressCrossing(fault);return {};});
  report.faults=faults;

  // ---- The ordinary public URL: no query string at all. ----
  const plain=await browser.newPage({viewport:{width:1280,height:850}});
  const plainErrors=[];
  plain.on('pageerror',e=>plainErrors.push(e.message));
  await plain.goto(`http://127.0.0.1:${port}/index.html#/map`);
  await plain.waitForTimeout(6000);
  await plain.screenshot({path:`${out}/normal-10-no-query.png`});
  report.noQuery={file:`${out}/normal-10-no-query.png`,errors:plainErrors,
    caseControls:await plain.evaluate(()=>Array.from(document.querySelectorAll('[data-case]'))
      .map(n=>({value:n.value??n.dataset.case,text:(n.textContent||'').trim().slice(0,60),
        tag:n.tagName,visible:!!(n.offsetWidth||n.offsetHeight)}))),
    threeDVisible:await plain.locator('[data-3d]').first().isVisible().catch(()=>false)};
  console.log('\nno-query case controls:',JSON.stringify(report.noQuery.caseControls));
  await plain.close();

  console.log('\nerrors:',report.errors.length);
}catch(error){
  report.failure=error.stack;
  console.error(error);
  process.exitCode=1;
}finally{
  await writeFile(`${out}/normal-entry.json`,JSON.stringify(report,null,2)+'\n');
  await browser.close();
  server.close();
}
