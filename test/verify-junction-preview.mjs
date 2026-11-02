// Targeted check for the dated preview at phone width, with the motion sample
// pinned to ONE solver instance.
//
// Why this exists: a full-gate run reported the phone moving 48.81 m (median),
// 48.92 m (p99) and 48.98 m (max) in 2.933 simulated seconds. The spread across
// 765 particles was 0.17 m — every particle moved the same distance. That is a
// rigid translation of the local frame when the layer rebuilt, not a fluid.
// Particle generations cannot catch it, because a rebuilt solver allocates a
// fresh all-zero generations array that matches the old one exactly.
//
// So this holds a reference to the live solver object in the page and compares
// identity, not numbers. If the instance, the host model or the source time
// changes inside the window, the sample is discarded and retried rather than
// reported as movement.
//
// It opens the real dated preview URL and never touches the camera.
//
//   node tools/simulation/build-geographic-view.mjs
//   node test/verify-junction-preview.mjs
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
const PREVIEW='?case=refined&preview=2026-11-01T22:00Z';
const WINDOW_SECONDS=2.5;
// all | preview | resize
const mode=(process.argv[2]||'all').toLowerCase();
const report={kind:'preview-motion',url:`/index.html${PREVIEW}#/map`,
  declaredWindowSimulatedSeconds:WINDOW_SECONDS,
  environment:'Chrome SwiftShader software GPU; not a phone or hardware-GPU measurement',
  errors:[]};
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});

// Held references live in the page, so object identity survives between calls.
const installIdentity=()=>{
  if(window.__previewIdentity)return;
  // Every object whose replacement would reset accounting gets its own
  // sequence, so a frozen ledger can be attributed to the thing that changed.
  const seqOf=new Map();
  const track=(key,value)=>{
    const state=seqOf.get(key)||{seq:0,ref:undefined};
    if(state.ref!==value){state.seq++;state.ref=value;seqOf.set(key,state);}
    else seqOf.set(key,state);
    return state.seq;
  };
  window.__previewIdentity=()=>{
    const view=window.qa?.view;
    const internals=view?.junctionInternals?.()||{};
    const inspect=view?.inspect?.()||{};
    const flow=inspect.junction?.flow||{};
    const fluid=internals.fluid??null,model=inspect.model??null;
    const sourceTime=inspect.junctionStatus?.sourceTime??null;
    return {
      fluidSeq:track('fluid',fluid),
      modelSeq:track('model',model),
      inflowSeq:track('inflow',internals.inflowLedger??null),
      outflowSeq:track('outflow',internals.outflowLedger??null),
      boundarySeq:track('boundary',internals.boundary??null),
      sourceTimeSeq:track('sourceTime',sourceTime),
      hasFluid:!!fluid,sourceTime,
      hasInflowLedger:!!internals.inflowLedger,hasOutflowLedger:!!internals.outflowLedger,
      ledgersBound:flow.ledgersBound??null,
      coupling:flow.status??null,couplingReason:flow.reason??null,
      boundaryCalls:flow.boundaryCalls??null,boundarySkipped:flow.boundarySkipped??null,
      boundaryFailures:flow.boundaryFailures??null,boundaryLastError:flow.boundaryLastError??null,
      junctionStatus:inspect.junctionStatus?.status??null,
      junctionActive:inspect.junctionActive??null,
      ledgerSeconds:flow.ledger?.inflow?.simulatedSeconds??null,
      ledgerMoved:flow.ledger?.inflow?.moved??null,
      solverSeconds:inspect.junction?.fluid?.elapsedSeconds??null,
      // Kept for the existing single-token comparison.
      token:track('fluid',fluid)*1000+track('model',model)};
  };
};

try{
  await mkdir(out,{recursive:true});
  const context=await browser.newContext({viewport:{width:390,height:844}});
  const page=await context.newPage();
  page.on('pageerror',e=>{report.errors.push(e.message);console.log('PAGE ERROR',e.message);});
  await page.route('**/simulation/geographic-view.js',r=>r.fulfill({contentType:'text/javascript',
    body:`export {createRefinedRendererSource} from './geographic-view-observed.js';import {createGeographicView as create} from './geographic-view-observed.js';export async function createGeographicView(options){const view=await create(options);window.qa={view,state:options.sharedState};return view;}`}));
  await page.route('**/simulation/geographic-view-observed.js',async r=>r.fulfill({contentType:'text/javascript',
    body:await readFile('public/simulation/geographic-view.js','utf8')}));

  await page.goto(`http://127.0.0.1:${port}/index.html${PREVIEW}#/map`);
  await page.waitForFunction(()=>window.qa?.view?.inspect?.()?.junctionStatus?.status==='ready',
    null,{timeout:300000});
  await page.waitForTimeout(4000);
  await page.evaluate(installIdentity);

  const probe=()=>page.evaluate(()=>{
    const v=window.qa.view.inspect(),j=v.junction;
    const o=v.model?.group?.getObjectByName('brawley-junction-blobs');
    const a=o?.geometry?.getAttribute('blobOffset')?.array;
    const led=j?.flow?.ledger;
    const placement=j?.placement;
    return {
      offsets:a?Array.from(a.slice(0,Math.min(a.length,o.geometry.instanceCount*3))):[],
      generations:Array.from(j?.generations??[]),
      // Both clocks, read in the same evaluate so they cannot drift apart.
      solverSeconds:j?.fluid?.elapsedSeconds??0,
      ledgerSeconds:led?.inflow?.simulatedSeconds??null,
      steps:j?.fluid?.steps??0,
      unitsPerMetre:placement&&placement.maxDeviationM>0?placement.maxDeviationUnits/placement.maxDeviationM:null,
      metresPerPixel:j?.blobs?.metresPerPixel??1,
      inflowMoved:led?.inflow?.moved??0,outflowMoved:led?.outflow?.moved??0,
      inflowMovedM3:led?.inflow?.movedM3??null,outflowMovedM3:led?.outflow?.movedM3??null,
      inflowTargetM3:led?.inflow?.targetM3??null,outflowTargetM3:led?.outflow?.targetM3??null,
      particleVolumeM3:led?.inflow?.particleVolumeM3??null,
      activeParticles:led?.activeParticles??null,activeVolumeM3:led?.activeVolumeM3??null,
      seededVolumeM3:led?.seededVolumeM3??null,
      perEdgeBalanced:led?.perEdgeBalanced??null,
      sourceTime:j?.fluid?.sourceTime??null,
      identity:window.__previewIdentity()};});

  async function sample(attempt=0){
    const start=await probe();
    await page.waitForFunction(target=>(window.qa.view.inspect().junction?.fluid?.elapsedSeconds??0)>=target,
      start.solverSeconds+WINDOW_SECONDS,{timeout:300000});
    const end=await probe();
    if(start.identity.token!==end.identity.token||!end.identity.hasFluid
      ||start.sourceTime!==end.sourceTime){
      report.discarded??=[];
      report.discarded.push({attempt,reason:'solver instance, host model or source time changed inside the window',
        start:start.identity,end:end.identity});
      console.log('discarded sample: layer rebuilt inside the window (attempt '+attempt+')');
      if(attempt>=3)throw Error('The junction layer kept rebuilding; no clean motion sample');
      await page.waitForTimeout(3000);
      return sample(attempt+1);
    }
    const perMetre=start.unitsPerMetre,mpp=end.metresPerPixel||1;
    const flat=[];let recycled=0;
    for(let i=0;i<start.offsets.length&&i<end.offsets.length;i+=3){
      const p=i/3;
      if((start.generations?.[p]??0)!==(end.generations?.[p]??0)){recycled++;continue;}
      const dx=(end.offsets[i]-start.offsets[i])/perMetre,dz=(end.offsets[i+2]-start.offsets[i+2])/perMetre;
      flat.push(Math.hypot(dx,dz));
    }
    flat.sort((a,b)=>a-b);
    const pick=f=>flat.length?flat[Math.min(flat.length-1,Math.floor(f*flat.length))]:0;
    const simulated=Math.max(1e-6,end.solverSeconds-start.solverSeconds);
    const max=flat.at(-1)??0,min=flat[0]??0;
    const particleVolume=end.particleVolumeM3??0;
    return {attempts:attempt+1,identityToken:end.identity.token,sourceTime:end.sourceTime,
      simulatedSeconds:simulated,solverSteps:end.steps-start.steps,
      ledgerSecondsStart:start.ledgerSeconds,ledgerSecondsEnd:end.ledgerSeconds,
      samples:flat.length,recycleJumps:recycled,metresPerPixel:mpp,
      medianHorizontalMetres:pick(0.5),p99HorizontalMetres:pick(0.99),maxHorizontalMetres:max,
      spreadMetres:max-min,
      // A fluid spreads. If every particle moved within a few percent of the
      // same distance, that is a translated frame, not motion.
      looksLikeRigidShift:flat.length>8&&max>0.5&&(max-min)<max*0.05,
      exchanged:{inflowParticles:end.inflowMoved-start.inflowMoved,
        outflowParticles:end.outflowMoved-start.outflowMoved},
      exchangedVolumeM3:{inflow:(end.inflowMoved-start.inflowMoved)*particleVolume,
        outflow:(end.outflowMoved-start.outflowMoved)*particleVolume},
      nativeAccruedM3:{inflow:(end.inflowTargetM3??0)-(start.inflowTargetM3??0),
        outflow:(end.outflowTargetM3??0)-(start.outflowTargetM3??0)},
      nativeMovedM3:{inflow:(end.inflowMovedM3??0)-(start.inflowMovedM3??0),
        outflow:(end.outflowMovedM3??0)-(start.outflowMovedM3??0)},
      particleVolumeM3:particleVolume,
      conservation:{activeParticles:end.activeParticles,activeVolumeM3:end.activeVolumeM3,
        seededVolumeM3:end.seededVolumeM3,perEdgeBalanced:end.perEdgeBalanced}};
  }

  report.first=await sample();
  report.first.capture=`${out}/preview-motion-phone.png`;
  await page.screenshot({path:report.first.capture});
  console.log('motion   median',report.first.medianHorizontalMetres.toFixed(4),
    'max',report.first.maxHorizontalMetres.toFixed(4),
    'spread',report.first.spreadMetres.toFixed(4),
    'over',report.first.simulatedSeconds.toFixed(2),'sim s',
    '| rigidShift',report.first.looksLikeRigidShift,
    '| exchange in/out',report.first.exchanged.inflowParticles,'/',report.first.exchanged.outflowParticles);

  // Close and reopen through the ordinary controls, then sample again. A
  // rebuild here is expected; what matters is that it is detected rather than
  // measured as travel.
  const press=async selector=>{
    const node=page.locator(selector).first();
    if(!await node.isVisible()){
      await page.locator('[data-panel="options"]').click().catch(()=>{});
      const extra=page.locator('.flood-extra > summary');
      if(await extra.count()&&!await node.isVisible())await extra.click().catch(()=>{});
      await node.waitFor({state:'visible',timeout:30000});
    }
    await node.click();await page.waitForTimeout(1500);
  };
  await press('[data-3d]');                       // back to flat
  await page.waitForTimeout(2500);
  report.flatViewMode=await page.evaluate(()=>window.qa.view.viewMode);
  await press('[data-3d]');                       // 3D again
  await page.waitForTimeout(4000);
  await press('.voxel-goto-crossing');
  await page.waitForFunction(()=>window.qa.view.inspect().junctionStatus?.status==='ready',
    null,{timeout:300000});
  await page.waitForTimeout(4000);
  report.second=await sample();
  report.second.capture=`${out}/preview-motion-phone-reopened.png`;
  await page.screenshot({path:report.second.capture});
  console.log('reopened median',report.second.medianHorizontalMetres.toFixed(4),
    'max',report.second.maxHorizontalMetres.toFixed(4),
    'spread',report.second.spreadMetres.toFixed(4),
    '| identity token',report.first.identityToken,'->',report.second.identityToken);

  // ---- Desktop -> phone resize, the gate's failing sequence -------------
  //
  // The full gate reaches the phone by resizing a desktop page, not by opening
  // one at phone width. That rebuild is where the gate's ledger froze at 1.333
  // simulated seconds and moved 1/1 while the solver kept running. This
  // reproduces exactly that, and records which object changed.
  if(mode==='all'||mode==='resize'){
    const rcontext=await browser.newContext({viewport:{width:1280,height:850}});
    const rpage=await rcontext.newPage();
    const rerrors=[];rpage.on('pageerror',e=>rerrors.push(e.message));
    await rpage.route('**/simulation/geographic-view.js',r=>r.fulfill({contentType:'text/javascript',
      body:`export {createRefinedRendererSource} from './geographic-view-observed.js';import {createGeographicView as create} from './geographic-view-observed.js';export async function createGeographicView(options){const view=await create(options);window.qa={view,state:options.sharedState};return view;}`}));
    await rpage.route('**/simulation/geographic-view-observed.js',async r=>r.fulfill({contentType:'text/javascript',
      body:await readFile('public/simulation/geographic-view.js','utf8')}));
    await rpage.goto(`http://127.0.0.1:${port}/index.html${PREVIEW}#/map`);
    await rpage.waitForFunction(()=>window.qa?.view?.inspect?.()?.junctionStatus?.status==='ready',
      null,{timeout:300000});
    await rpage.waitForTimeout(4000);
    await rpage.evaluate(installIdentity);
    const snap=()=>rpage.evaluate(()=>window.__previewIdentity());
    const trace=[];
    const mark=async label=>{const s=await snap();trace.push({label,...s});
      console.log('resize  ',String(label).padEnd(22),
        'coupling',String(s.coupling).padEnd(10),
        'bound',String(s.ledgersBound).padEnd(5),
        'calls',String(s.boundaryCalls).padEnd(5),
        'skipped',String(s.boundarySkipped).padEnd(5),
        'ledgerS',String(s.ledgerSeconds),
        'fluid#',s.fluidSeq,'in#',s.inflowSeq,'out#',s.outflowSeq);
      return s;};
    await mark('desktop-ready');
    if(mode==='gatelike'){
      // Exactly what the full gate does before it ever reaches the phone: it
      // drives applyBoundaryTransport by hand with one side silenced, against
      // the REAL ledgers. That is a mutation of live runtime state by the
      // test. Replayed here to see whether it is what leaves the boundary
      // unable to spend afterwards.
      await rpage.evaluate(()=>{
        const {fluid,inflowLedger,outflowLedger}=window.qa.view.junctionInternals();
        const silence=real=>({accrue:()=>[],settle:()=>{},get stats(){return real.stats;}});
        for(let a=0;a<6&&fluid.flowStats.activeParticles===fluid.flowStats.capacity;a++)
          fluid.applyBoundaryTransport({inflowLedger:silence(inflowLedger),outflowLedger,dt:4,seed:11+a});
        for(let a=0;a<6&&fluid.flowStats.heldParticles>0;a++)
          fluid.applyBoundaryTransport({inflowLedger,outflowLedger:silence(outflowLedger),dt:12,seed:31+a});
      });
      await rpage.waitForTimeout(1500);
      await mark('after-conservation-probe');
    }
    await rpage.setViewportSize({width:390,height:844});
    await rpage.waitForTimeout(2500);
    await mark('just-after-resize');
    await rpage.waitForFunction(()=>{const f=window.qa.view.inspect().junction?.flow;
      return f?.status==='coupled'&&!!f.ledger&&f.ledger.inflow?.simulatedSeconds>0;},
      null,{timeout:300000}).catch(()=>{});
    const settled=await mark('phone-coupled');
    // Now let the solver run the same window the gate measures, and watch the
    // boundary counters rather than inferring from the flowStats snapshot.
    await rpage.waitForFunction(target=>(window.qa.view.inspect().junction?.fluid?.elapsedSeconds??0)>=target,
      (settled.solverSeconds??0)+WINDOW_SECONDS,{timeout:300000});
    const after=await mark('after-window');
    await rpage.screenshot({path:`${out}/preview-resize-phone.png`});
    report.resize={trace,errors:rerrors,capture:`${out}/preview-resize-phone.png`,
      boundaryCallsDuringWindow:(after.boundaryCalls??0)-(settled.boundaryCalls??0),
      boundarySkippedDuringWindow:(after.boundarySkipped??0)-(settled.boundarySkipped??0),
      ledgerSecondsAdvanced:(after.ledgerSeconds??0)-(settled.ledgerSeconds??0),
      solverSecondsAdvanced:(after.solverSeconds??0)-(settled.solverSeconds??0)};
    console.log('resize   window: boundary calls',report.resize.boundaryCallsDuringWindow,
      'skipped',report.resize.boundarySkippedDuringWindow,
      '| ledger +',report.resize.ledgerSecondsAdvanced.toFixed(3),
      's | solver +',report.resize.solverSecondsAdvanced.toFixed(3),'s');
    await rcontext.close();
    assert.ok(report.resize.solverSecondsAdvanced>0,'the solver must have advanced for this to mean anything');
    assert.ok(report.resize.boundaryCallsDuringWindow>0,
      'the boundary must keep being spent after a desktop-to-phone resize: '
      +JSON.stringify(report.resize));
    assert.ok(report.resize.ledgerSecondsAdvanced>0,
      'the ledger clock must advance with the solver clock after a resize');
  }

  for(const [label,m] of [['first',report.first],['reopened',report.second]]){
    assert.equal(m.looksLikeRigidShift,false,
      label+': the whole particle cloud moved the same distance, which is a translated frame rather than motion: '
      +JSON.stringify({median:m.medianHorizontalMetres,max:m.maxHorizontalMetres,spread:m.spreadMetres}));
    assert.ok(m.maxHorizontalMetres<5,
      label+': no particle may jump metres inside one solver instance: '+m.maxHorizontalMetres);
    assert.ok(m.samples>0,label+': some particles must survive the window');
    assert.equal(m.sourceTime,'2026-11-01T22:00:00Z',label+': the preview must stay on its dated frame');
    assert.equal(m.conservation.perEdgeBalanced,true,label+': every edge still balances');
    // Represented volume follows the participating particles, each worth one
    // declared particle volume. Never more water than was seeded.
    assert.ok(Math.abs(m.conservation.activeVolumeM3
      -m.conservation.activeParticles*m.particleVolumeM3)<1e-6,
      label+': represented volume must be whole particles of the declared volume: '
      +JSON.stringify(m.conservation));
    assert.ok(m.conservation.activeVolumeM3<=m.conservation.seededVolumeM3+1e-9,
      label+': represented volume may never exceed what was seeded');
    // Exchange is judged against the native discharge that paid for it, not a
    // bare count: whole particles of a declared volume, never more than the
    // native budget accrued in the same window.
    assert.ok(m.exchangedVolumeM3.inflow<=m.nativeAccruedM3.inflow+m.particleVolumeM3+1e-9,
      label+': inflow moved more volume than the native discharge accrued: '
      +JSON.stringify({moved:m.exchangedVolumeM3.inflow,accrued:m.nativeAccruedM3.inflow}));
    assert.ok(m.exchangedVolumeM3.outflow<=m.nativeAccruedM3.outflow+m.particleVolumeM3+1e-9,
      label+': outflow moved more volume than the native discharge accrued');
  }
  assert.equal(report.flatViewMode,'flat','pressing 3D again must return to the flat default');
  console.log('\nerrors:',report.errors.length);
}catch(error){
  report.failure=error.stack;console.error(error);process.exitCode=1;
}finally{
  await writeFile(`${out}/preview-motion.json`,JSON.stringify(report,null,2)+'\n');
  await browser.close();server.close();
}
