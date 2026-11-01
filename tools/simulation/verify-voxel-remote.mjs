import {chromium} from 'playwright';import {writeFile} from 'node:fs/promises';import assert from 'node:assert/strict';
const url=process.argv[2];if(!url)throw Error('Pass the published commit-pinned renderer QA URL');
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--enable-webgl','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
let page;const errors=[],failed=[];
try{page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  page.on('pageerror',e=>{errors.push(e.message);console.log('Page error:',e.message);});page.on('requestfailed',r=>failed.push({url:r.url(),error:r.failure()?.errorText}));
  page.on('response',r=>{if(r.status()>=400)failed.push({url:r.url(),status:r.status()});});await page.goto(url,{waitUntil:'domcontentloaded',timeout:60000});
  await page.waitForFunction(()=>window.qaReady||window.qaError,null,{timeout:45000});
  assert.equal(await page.evaluate(()=>window.qaError),undefined);
  await page.evaluate(()=>{const c=qa.run.cells[9344];qa.map.setView([c.lat,c.lon],16,{animate:false});});
  await page.waitForTimeout(2500);await page.waitForFunction(()=>qa.view.inspect().geography.status.status==='ready');
  await page.evaluate(()=>qa.view.select(9344));await page.screenshot({path:'public/simulation/preview/remote-vector-voxel-8pm.png'});
  const state=await page.evaluate(()=>{const x=qa.view.inspect();return{info:x.model.cellInfo(9344),geography:x.geography.status,active:x.active};});assert.ok(state.info.depthM>3.36&&state.info.depthM<3.37);
  await writeFile('public/simulation/preview/remote-vector-voxel-verification.json',JSON.stringify({url,state,errors},null,2));console.log(JSON.stringify({url,state,errors},null,2));
}catch(error){const result={url,status:'failed',reason:error.message,errors,failed,pageText:await page?.locator('body').innerText().catch(()=>null)};await writeFile('public/simulation/preview/remote-vector-voxel-verification.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));process.exitCode=1;}finally{await browser.close();}
