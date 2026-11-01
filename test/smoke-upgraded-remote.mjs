import {chromium} from 'playwright';
import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const revision=process.argv[2];if(!/^[a-f0-9]{7,40}$/.test(revision||''))throw Error('Pinned revision required');
const url=`https://raw.githack.com/Godfather38/FLOODplain/${revision}/public/index.html?case=refined#/map`;
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const result={url,errors:[],failed:[],modelResponses:[],passed:false};let page;
try{page=await browser.newPage({viewport:{width:1280,height:850},reducedMotion:'reduce'});page.on('pageerror',e=>result.errors.push(e.message));page.on('requestfailed',r=>result.failed.push({url:r.url(),error:r.failure()}));page.on('response',r=>{if(/refined-full-compact|terrain-overview|water-support|geographic-3d-runtime/.test(r.url()))result.modelResponses.push({url:r.url(),status:r.status()});});
const response=await page.goto(url,{waitUntil:'domcontentloaded',timeout:120000});result.documentStatus=response.status();assert.equal(response.status(),200);if(await page.getByText('Open the page',{exact:true}).count()){result.hostInterstitial=true;await page.getByText('Open the page',{exact:true}).click();}await page.waitForFunction(()=>document.querySelector('[data-time]')?.max==='56',null,{timeout:180000});
await page.locator('[data-panel="options"]').click();await page.locator('.flood-extra > summary').click();await page.locator('[data-3d]').click();await page.waitForFunction(()=>/Whole-area terrain|3D terrain:/.test(document.body.innerText),null,{timeout:180000});
await page.screenshot({path:'public/simulation/preview/upgraded-remote.png'});result.text=await page.locator('body').innerText();assert.equal(result.errors.length,0);assert.ok(result.modelResponses.some(r=>/water-support/.test(r.url)&&r.status===200));result.passed=true;
}finally{if(page){result.text=await page.locator('body').innerText().catch(()=>null);await page.screenshot({path:'public/simulation/preview/upgraded-remote.png'}).catch(()=>{});}await writeFile('public/simulation/preview/upgraded-remote-verification.json',JSON.stringify(result,null,2)+'\n');await browser.close();}
