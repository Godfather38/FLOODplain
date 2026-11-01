import {chromium} from 'playwright';
import {execFileSync} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
import {server} from './voxel-preview-server.mjs';
const body=execFileSync('C:/Program Files/Git/cmd/git.exe',['show','5a630f4:public/simulation/geographic-view.js'],{maxBuffer:10000000});
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--enable-webgl','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{const page=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'}),errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('**/simulation/geographic-view.js',r=>r.fulfill({status:200,contentType:'text/javascript',body}));
await page.goto('http://127.0.0.1:8094/simulation/voxel-qa.html');await page.waitForFunction(()=>window.qaReady||window.qaError,null,{timeout:60000});
const cold=await page.evaluate(()=>({error:window.qaError,view:qa.view.viewMode,model:!!qa.view.inspect().model,layer:!!qa.view.inspect().layer,readyMs:performance.now(),heap:performance.memory?.usedJSHeapSize,resources:performance.getEntriesByType('resource').filter(r=>/simulation\//.test(r.name)).map(r=>({url:r.name,bytes:r.encodedBodySize}))}));
const evidence={environment:'Chrome headless SwiftShader 390x844 reduced motion, prior5a630f4 renderer routed into same QA page',bundleBytes:body.length,cold,errors};await writeFile('public/simulation/preview/renderer-baseline-verification.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence,null,2));
}finally{await browser.close();server.closeAllConnections();server.close();}
