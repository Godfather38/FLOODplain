// Focused VISUAL capture for the junction water surface. This exists so the
// renderer can be judged by eye without paying for the whole acceptance run on
// every shading change; test/verify-junction-fluid.mjs remains the real gate.
//
// It captures, at the same camera:
//   * a desktop close-up and a wider desktop view,
//   * a short movement sequence with each frame's SIMULATED and wall time, so
//     travel can be read as travel rather than inferred from a counter,
//   * a phone-width view.
//
// It asserts nothing about pixels. It prints what it captured and leaves the
// images in junction-evidence for a person to look at.
//
//   node tools/simulation/build-geographic-view.mjs
//   node test/verify-junction-visual.mjs
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
const JUNCTION=[-111.29459,32.39322];
const out='junction-evidence';
const report={kind:'visual-capture',
  environment:'Chrome SwiftShader software GPU; not a phone or hardware-GPU measurement',
  frames:[],errors:[]};
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});

try{
  await mkdir(out,{recursive:true});
  const page=await browser.newPage({viewport:{width:1280,height:850}});
  page.on('pageerror',e=>{report.errors.push(e.message);console.log('PAGE ERROR',e.message);});
  await page.route('**/simulation/geographic-view.js',r=>r.fulfill({contentType:'text/javascript',
    body:`export {createRefinedRendererSource} from './geographic-view-observed.js';import {createGeographicView as create} from './geographic-view-observed.js';export async function createGeographicView(options){const view=await create(options);window.qa={view,state:options.sharedState};return view;}`}));
  // Coordinator: the observed name is a route alias, not a file on disk.
  await page.route('**/simulation/geographic-view-observed.js',async r=>r.fulfill({contentType:'text/javascript',
    body:await readFile('public/simulation/geographic-view.js','utf8')}));
  await page.goto(`http://127.0.0.1:${port}/index.html?case=refined#/map`);
  await page.waitForFunction(()=>window.qa?.state.snapshot().status==='ready',null,{timeout:180000});

  const toggleThreeD=async()=>{
    const button=page.locator('[data-3d]');
    if(!await button.isVisible()){
      await page.locator('[data-panel="options"]').click();
      const extra=page.locator('.flood-extra > summary');
      if(await extra.count()&&!await button.isVisible())await extra.click();
      await button.waitFor({state:'visible',timeout:30000});
    }
    await button.click();
  };
  await toggleThreeD();
  await page.waitForFunction(()=>window.qa.view.inspect().model&&window.qa.state.snapshot().displayed?.view==='3d',
    null,{timeout:180000});
  // Frame 20 is the exact 22:00 snapshot the flow contract couples to.
  await page.evaluate(()=>{const slider=document.querySelector('[data-time]');slider.value='20';
    slider.dispatchEvent(new Event('input'));});
  await page.waitForFunction(()=>window.qa.state.snapshot().displayed?.index===20,null,{timeout:180000});

  const look=async zoom=>{
    await page.evaluate(async({point,zoom})=>{const v=window.qa.view.inspect();
      v.map.setCenter(point);v.map.setZoom(zoom,{animation:false});
      await v.geography.update(v.map.getExtent(),zoom);},{point:JUNCTION,zoom});
    await page.waitForTimeout(500);
  };
  const settled=()=>page.waitForFunction(
    ()=>window.qa.view.inspect().junction?.status==='ready',null,{timeout:180000});
  // Normal view only: every diagnostic toggle is forced off before any capture.
  const normalView=()=>page.evaluate(()=>{
    const c=window.qa.view.junctionInternals?.()?.composite;
    c?.setDebugMask?.(0);c?.setDepthTest?.(true);
    return {debugMask:0,depthTest:true};});
  const clock=()=>page.evaluate(()=>{const j=window.qa.view.inspect().junction;
    return {simulatedSeconds:j.fluid?.elapsedSeconds??null,
      solverSteps:j.fluid?.steps??null,
      sourceTime:j.fluid?.sourceTime??null,
      playback:j.status==='ready'?window.qa.view.inspect().junctionStatus?.playback??null:null,
      metresPerPixel:j.blobs?.metresPerPixel??null,
      activeParticles:j.blobs?.activeParticles??null,
      streakSegments:j.blobs?.streakSegments??null,
      directionSource:j.blobs?.directionSource??null,
      rendering:j.blobs?.rendering??null,
      composite:j.surface?.composite??null};});
  const shoot=async(name,note)=>{
    const file=`${out}/visual-${name}.png`;
    await page.screenshot({path:file});
    const stamp=await clock();
    report.frames.push({name,file,note,wallClock:new Date().toISOString(),...stamp});
    console.log(name,'sim',stamp.simulatedSeconds,'steps',stamp.solverSteps,'->',file);
    return file;
  };

  await look(17);await settled();await page.waitForTimeout(1500);
  await normalView();
  await shoot('desktop-wide','standard zoom 17, normal view');

  await look(19);await settled();await page.waitForTimeout(1500);
  await normalView();
  await shoot('desktop-close','close zoom 19, normal view');

  // Movement sequence over a FIXED window of the solver's own simulated time,
  // so the frames can be compared against the simulated seconds between them.
  for(let i=0;i<4;i++){
    const before=await clock();
    await page.waitForFunction(target=>(window.qa.view.inspect().junction?.fluid?.elapsedSeconds??0)>=target,
      (before.simulatedSeconds??0)+1.5,{timeout:180000});
    await shoot(`desktop-move-${i+1}`,'movement sequence, +1.5 simulated seconds per frame');
  }

  await page.setViewportSize({width:390,height:844});
  await page.waitForTimeout(2500);
  await settled();
  await page.waitForTimeout(1500);
  await normalView();
  await shoot('phone','390x844, normal view');
  await look(19);await settled();await page.waitForTimeout(1500);
  await shoot('phone-close','390x844 close zoom 19, normal view');

  report.achievedPlayback=report.frames.at(-1)?.playback??null;
  console.log(JSON.stringify(report,null,2));
}catch(error){
  report.failure=error.stack;
  console.error(error);
  process.exitCode=1;
}finally{
  await writeFile(`${out}/visual-capture.json`,JSON.stringify(report,null,2)+'\n');
  await browser.close();
  server.close();
}
