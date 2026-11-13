import {chromium} from 'playwright';
import fs from 'node:fs';import path from 'node:path';import http from 'node:http';
const root=path.resolve('public');
const server=http.createServer((req,res)=>{let p=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));if(!p.startsWith(root+path.sep)&&p!==root){res.writeHead(403).end();return;}if(p===root)p=path.join(root,'index.html');fs.stat(p,(e,st)=>{if(e||!st.isFile()){res.writeHead(404).end();return;}res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.svg':'image/svg+xml'})[path.extname(p)]||'application/octet-stream');fs.createReadStream(p).pipe(res);});});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1280,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
// Explicit outage fixture: only local app assets/data load; remote feeds fail.
await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.fulfill({status:503,body:'Fixture: source unavailable'}));
const result={fixture:'Remote sources return HTTP 503; local app and retained data load',errors};
try{
 await page.goto('http://127.0.0.1:'+server.address().port+'/#/r/avra',{waitUntil:'domcontentloaded'});
 await page.locator('a[href="#/r/avra/elpaso-dip"]').waitFor({timeout:60000});
 const routeText=await page.locator('#screen').innerText();
 result.routeHasSyntheticAnnouncement=/No live readings right now/i.test(routeText);
 result.routeHasFalseNormalHeading=/Every stretch looks normal/.test(routeText);
 await page.screenshot({path:'docs/quiet-readings-route.png'});
 await page.locator('a[href="#/r/avra/elpaso-dip"]').click();
 await page.waitForFunction(()=>document.querySelector('#screen')?.textContent.includes('Current road conditions are not established.'));
 const detailText=await page.locator('#screen').innerText();
 result.detailHasSyntheticAnnouncement=/No live readings right now/.test(detailText);
 result.detailRetainsUnavailable=/unreachable|unavailable|stale/i.test(detailText);
 result.detailRetainsUncertainty=/Current road conditions are not established/.test(detailText);
 await page.screenshot({path:'docs/quiet-readings-detail.png'});
 console.log(JSON.stringify(result));
 if(result.routeHasSyntheticAnnouncement||result.routeHasFalseNormalHeading||result.detailHasSyntheticAnnouncement||!result.detailRetainsUnavailable||!result.detailRetainsUncertainty||errors.length)process.exitCode=1;
}finally{await browser.close();server.close();fs.writeFileSync('docs/quiet-readings-browser.json',JSON.stringify(result,null,2)+'\n');}
