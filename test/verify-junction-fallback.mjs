// Focused checks for the specific failures the full walk is too slow to
// iterate on. Each mode is selectable so a single fix can be re-tested in
// seconds rather than re-running a seven-minute walk:
//
//   node test/verify-junction-fallback.mjs            all modes
//   node test/verify-junction-fallback.mjs budget     water budget overflow
//   node test/verify-junction-fallback.mjs webgl      3D unavailable control
//   node test/verify-junction-fallback.mjs noquery    plain URL, end to end
//   node test/verify-junction-fallback.mjs faults     wet-frame fault images
//
// Everything runs at the WET frame (Nov 1, 3:00 PM MST — step 21 of 57, the
// 22:00Z snapshot). The dry midnight default hides exactly the failures these
// are meant to catch.
import {chromium} from 'playwright';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,extname,sep} from 'node:path';
import assert from 'node:assert/strict';

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
const only=(process.argv[2]||'all').toLowerCase();
const run=name=>only==='all'||only===name;
const report={kind:'fallback',modes:only,results:{},errors:[]};
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});

const OBSERVE=`export {createRefinedRendererSource} from './geographic-view-observed.js';import {createGeographicView as create} from './geographic-view-observed.js';export async function createGeographicView(options){const view=await create(options);window.qa={view,state:options.sharedState};return view;}`;

async function openPage({routes=[],init=null,query='?case=refined',observe=true}={}){
  const context=await browser.newContext({viewport:{width:1280,height:850}});
  const page=await context.newPage();
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  if(init)await page.addInitScript(init);
  if(observe){
    await page.route('**/simulation/geographic-view.js',r=>r.fulfill({contentType:'text/javascript',body:OBSERVE}));
    await page.route('**/simulation/geographic-view-observed.js',async r=>r.fulfill({contentType:'text/javascript',
      body:await readFile('public/simulation/geographic-view.js','utf8')}));
  }
  for(const [pattern,handler] of routes)await page.route(pattern,handler);
  await page.goto(`http://127.0.0.1:${port}/index.html${query}#/map`);
  return {context,page,errors};
}
const press=async(page,selector,label)=>{
  const node=page.locator(selector).first();
  if(!await node.count())throw Error('missing control '+selector+' ('+label+')');
  if(!await node.isVisible()){
    await page.locator('[data-panel="options"]').click().catch(()=>{});
    const extra=page.locator('.flood-extra > summary');
    if(await extra.count()&&!await node.isVisible())await extra.click().catch(()=>{});
    await node.waitFor({state:'visible',timeout:30000});
  }
  await node.click();await page.waitForTimeout(1200);
};
// The wet frame, chosen through the real time slider.
const wetFrame=async page=>{
  await page.evaluate(()=>{const slider=document.querySelector('[data-time]');slider.value='20';
    slider.dispatchEvent(new Event('input'));});
  await page.waitForFunction(()=>window.qa?.state.snapshot().displayed?.index===20,null,{timeout:180000});
  await page.waitForTimeout(2500);
};
const enter3D=async page=>{await press(page,'[data-3d]','3D map');await page.waitForTimeout(5000);};
const waterState=page=>page.evaluate(()=>{
  const v=window.qa?.view?.inspect?.();const d=v?.model?.detailStats||{};
  return {waterTriangles:v?.model?.water?.count??null,waterVisible:v?.model?.water?.visible??null,
    product:d.waterProduct??null,budgetLimited:d.budgetLimited??null,
    fallback:d.waterFallback??null,note:v?.note??null,
    regional:v?.regionalContext?{triangles:v.regionalContext.triangles,
      cutOut:v.regionalContext.droppedTrianglesOverNativeDomain,
      exaggeration:v.regionalContext.verticalExaggeration}:null,
    sourceTime:v?.frame?.time??null};});

try{
  await mkdir(out,{recursive:true});

  // 1. Water budget overflow must keep showing water, labelled as coarser.
  if(run('budget')){
    const {context,page,errors}=await openPage({init:()=>{window.__floodWaterBudget=400;}});
    await page.waitForFunction(()=>window.qa?.state.snapshot().status==='ready',null,{timeout:180000});
    await wetFrame(page);await enter3D(page);
    await press(page,'[data-fit]','Fit flood area');await page.waitForTimeout(5000);
    const state=await waterState(page);
    await page.screenshot({path:`${out}/fallback-budget.png`});
    report.results.budget={...state,errors,file:`${out}/fallback-budget.png`};
    console.log('budget    triangles',state.waterTriangles,'product',state.product,
      'limited',state.budgetLimited,'cells',state.fallback?.cellsDrawn??'-');
    await context.close();
  }

  // 2. No WebGL2: the control must settle on "3D unavailable", not hang.
  if(run('webgl')){
    const {context,page,errors}=await openPage({init:()=>{
      const original=HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext=function(type,...rest){
        if(type==='webgl2'||type==='webgl'||type==='experimental-webgl')return null;
        return original.call(this,type,...rest);};}});
    await page.waitForFunction(()=>window.qa?.state.snapshot().status==='ready',null,{timeout:180000});
    await wetFrame(page);
    await press(page,'[data-3d]','3D map');
    // Bounded by the control's own timeout, plus slack.
    await page.waitForFunction(()=>{const b=document.querySelector('[data-3d]');
      return b&&!/Loading 3D/.test(b.textContent||'');},null,{timeout:60000}).catch(()=>{});
    await page.waitForTimeout(1500);
    const control=await page.evaluate(()=>{const b=document.querySelector('[data-3d]');
      return {text:(b?.textContent||'').trim(),disabled:!!b?.disabled,
        status:(document.querySelector('[data-status]')?.textContent||'').trim(),
        flatWaterFeatures:window.qa?.view?.inspect?.()?.flatWater?.getGeometries?.().length??null};});
    await page.screenshot({path:`${out}/fallback-webgl-denied.png`});
    report.results.webgl={...control,errors,file:`${out}/fallback-webgl-denied.png`};
    console.log('webgl     button:',JSON.stringify(control.text),'disabled',control.disabled);
    assert.doesNotMatch(control.text,/Loading 3D/,'the 3D control must not hang on "Loading 3D…"');
    assert.match(control.text,/3D unavailable/,'the control must say 3D is unavailable');
    await context.close();
  }

  // 3. The plain public URL, end to end through visible controls only.
  if(run('noquery')){
    const {context,page,errors}=await openPage({query:''});
    await page.waitForFunction(()=>window.qa?.state.snapshot().status==='ready',null,{timeout:180000});
    const before=await page.evaluate(()=>window.qa.state.snapshot().displayed??null);
    await page.screenshot({path:`${out}/noquery-01-default.png`});
    // Map options -> Case -> Optional refined SFINCS, by the real control.
    await page.locator('[data-panel="options"]').click();
    await page.waitForTimeout(800);
    const caseSelect=page.locator('[data-case]').first();
    await caseSelect.waitFor({state:'visible',timeout:30000});
    const options=await caseSelect.locator('option').allTextContents();
    await caseSelect.selectOption({label:'Optional refined SFINCS'});
    await page.waitForTimeout(6000);
    await page.screenshot({path:`${out}/noquery-02-refined-selected.png`});
    await wetFrame(page);
    await enter3D(page);
    await press(page,'.voxel-goto-crossing','Close-up crossing');
    await page.waitForFunction(()=>window.qa.view.inspect().junctionStatus?.status==='ready',
      null,{timeout:180000}).catch(()=>{});
    await page.waitForTimeout(6000);
    await page.screenshot({path:`${out}/noquery-03-crossing.png`});
    const crossing=await page.evaluate(()=>{const v=window.qa.view.inspect();
      return {junction:v.junctionStatus?.status,sourceTime:v.junctionStatus?.sourceTime,
        displayed:window.qa.state.snapshot().displayed,
        composite:!!v.model?.group?.getObjectByName('brawley-junction-water-surface')?.visible};});
    await press(page,'.voxel-goto-regional','Regional view');
    await page.waitForTimeout(8000);
    await page.screenshot({path:`${out}/noquery-04-regional.png`});
    const regional=await waterState(page);
    report.results.noquery={before,caseOptions:options,crossing,regional:regional.regional,errors,
      files:[`${out}/noquery-01-default.png`,`${out}/noquery-02-refined-selected.png`,
        `${out}/noquery-03-crossing.png`,`${out}/noquery-04-regional.png`]};
    console.log('noquery   case options',JSON.stringify(options),
      '| junction',crossing.junction,'at',crossing.sourceTime,
      '| regional cutOut',regional.regional?.cutOut);
    assert.equal(crossing.junction,'ready','the crossing must be reachable from the plain URL');
    assert.ok((regional.regional?.cutOut??0)>0,
      'the native domain must actually be cut out of the regional context: '
      +JSON.stringify(regional.regional));
    await context.close();
  }

  // 3b. The dated preview deep link, on desktop and phone, plus the refusal
  //     of a date this saved run does not contain.
  if(run('preview')){
    report.results.preview=[];
    for(const [label,width,height] of [['desktop',1280,850],['phone',390,844]]){
      const context=await browser.newContext({viewport:{width,height}});
      const page=await context.newPage();
      const errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.route('**/simulation/geographic-view.js',r=>r.fulfill({contentType:'text/javascript',body:OBSERVE}));
      await page.route('**/simulation/geographic-view-observed.js',async r=>r.fulfill({contentType:'text/javascript',
        body:await readFile('public/simulation/geographic-view.js','utf8')}));
      await page.goto(`http://127.0.0.1:${port}/index.html?case=refined&preview=2026-11-01T22:00Z#/map`);
      // The preview presses the crossing control itself; the particle layer
      // then has to build. A phone budget rebuild lands later than a desktop
      // one, so wait on the layer rather than on a fixed guess.
      await page.waitForFunction(()=>window.qa?.view?.inspect?.()?.junctionStatus?.status==='ready',
        null,{timeout:240000}).catch(()=>{});
      await page.waitForTimeout(label==='phone'?20000:6000);
      await page.waitForFunction(()=>window.qa?.view?.inspect?.()?.junctionStatus?.status==='ready',
        null,{timeout:120000}).catch(()=>{});
      const file=`${out}/preview-${label}.png`;
      await page.screenshot({path:file});
      const state=await page.evaluate(()=>{const v=window.qa.view.inspect();
        return {junction:v.junctionStatus?.status,sourceTime:v.junctionStatus?.sourceTime,
          viewMode:v.viewMode,displayed:window.qa.state.snapshot().displayed,
          status:(document.querySelector('[data-preview-banner]')?.textContent||'').trim(),
          previewState:document.querySelector('[data-preview-banner]')?.dataset.previewState??null,
          previewLink:(document.querySelector('.dated-preview a')?.textContent||'').trim(),
          composite:!!v.model?.group?.getObjectByName('brawley-junction-water-surface')?.visible};});
      report.results.preview.push({label,file,errors,...state});
      console.log('preview  ',label.padEnd(8),state.junction,'at',state.sourceTime,
        '| mode',state.viewMode);
      assert.equal(state.junction,'ready',label+' preview must reach the close-up crossing');
      assert.equal(state.sourceTime,'2026-11-01T22:00:00Z',label+' preview must land on the exact saved frame');
      assert.equal(state.previewState,'open',label+' preview must report itself open');
      assert.match(state.status,/saved model result/i,
        label+' preview must say it is a saved model result');
      assert.match(state.status,/not live conditions/i,
        label+' preview must say it is not live');
      assert.match(state.previewLink,/Nov 1, 2026/,
        label+' must offer the dated preview as a visible link too');
      await context.close();
    }
    // A date this run does not contain is refused, never substituted.
    const {context,page}=await openPage({query:'?case=refined&preview=2026-07-04T12:00Z'});
    await page.waitForFunction(()=>window.qa?.state.snapshot().status==='ready',null,{timeout:180000});
    await page.waitForTimeout(4000);
    const refusal=await page.evaluate(()=>({
      status:(document.querySelector('[data-preview-banner]')?.textContent||'').trim(),
      previewState:document.querySelector('[data-preview-banner]')?.dataset.previewState??null,
      viewMode:window.qa.view.viewMode}));
    await page.screenshot({path:`${out}/preview-unknown-date.png`});
    report.results.previewRefusal={...refusal,file:`${out}/preview-unknown-date.png`};
    console.log('preview   refusal:',JSON.stringify(refusal.status.slice(0,80)));
    assert.match(refusal.status,/not in this saved run/,'an unsupported date must be refused');
    assert.equal(refusal.viewMode,'flat','a refused preview leaves the ordinary 2D map');
    await context.close();
  }

  // 4. Fault images at the WET frame, where missing water is actually visible.
  if(run('faults')){
    const cases=[
      ['fluid-module-missing',[['**/fluid-prototype/junction-fluid.js',r=>r.fulfill({status:500,body:'boom'})]]],
      ['detail-tiles-missing',[['**/terrain-tile-*',r=>r.fulfill({status:504,body:'timeout'})]]],
      ['regional-missing',[['**/regional-context/**',r=>r.fulfill({status:404,body:'gone'})]]]];
    report.results.faults=[];
    for(const [name,routes] of cases){
      const {context,page,errors}=await openPage({routes});
      await page.waitForFunction(()=>window.qa?.state.snapshot().status==='ready',null,{timeout:180000});
      await wetFrame(page);await enter3D(page);
      await press(page,'.voxel-goto-crossing','Close-up crossing').catch(()=>{});
      await page.waitForTimeout(7000);
      const state=await waterState(page);
      const file=`${out}/fault-wet-${name}.png`;
      await page.screenshot({path:file});
      report.results.faults.push({name,file,errors,...state});
      console.log('fault-wet',String(name).padEnd(22),'waterTris',state.waterTriangles,
        'product',state.product,'regionalCutOut',state.regional?.cutOut??'-');
      await context.close();
    }
  }
}catch(error){
  report.failure=error.stack;console.error(error);process.exitCode=1;
}finally{
  await writeFile(`${out}/fallback.json`,JSON.stringify(report,null,2)+'\n');
  await browser.close();server.close();
}
