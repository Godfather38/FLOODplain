import {chromium} from 'playwright';
import {writeFileSync} from 'node:fs';
const browser=await chromium.launch({channel:'chrome'});const context=await browser.newContext();
// Read-only audit: prevent telemetry and all writes, including any messaging request.
await context.route('**/*',r=>r.request().method()==='GET'?r.continue():r.abort());
const results=[];
try{for(const path of ['#/privacy','twilio/optin.png','']){
 const page=await context.newPage();const requested='https://godfather38.github.io/FLOODplain/'+path;
 try{const response=await page.goto(requested,{waitUntil:'domcontentloaded',timeout:45000});await page.waitForTimeout(8000);results.push({requested,final:page.url(),status:response?.status(),type:response?.headers()['content-type'],text:(await page.locator('body').innerText()).slice(0,8000)});}catch(e){results.push({requested,error:e.message,final:page.url()});}await page.close();
}}finally{await browser.close();}
writeFileSync('../public-url-audit.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
