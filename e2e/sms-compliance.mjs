// Real-browser checks on the same files a deploy publishes, with every outside service faked so
// the result doesn't depend on the weather or anyone's uptime. These catch what unit tests can't:
// layers drawn in the wrong place, colors that don't apply, panels that look wrong.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {cpSync,existsSync,mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {extname,join,normalize} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

const repo=fileURLToPath(new URL('..',import.meta.url));
const site=mkdtempSync(join(tmpdir(),'floodplain-e2e-'));
cpSync(join(repo,'public'),site,{recursive:true});
execFileSync(process.execPath,[join(repo,'tools/add-preloads.mjs'),site],{stdio:'pipe'});

const TYPES={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.geojson':'application/json','.png':'image/png','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.gz':'application/gzip'};
const server=createServer((req,res)=>{
 const path=decodeURIComponent(new URL(req.url,'http://x').pathname);
 let file=normalize(join(site,path==='/'?'index.html':path));
 if(!file.startsWith(site)||!existsSync(file)){res.writeHead(404);return res.end()}
 res.writeHead(200,{'Content-Type':TYPES[extname(file)]??'application/octet-stream','Cache-Control':'no-store'});res.end(readFileSync(file));
});
await new Promise(r=>server.listen(0,r));
const origin=`http://localhost:${server.address().port}`;

const tricoClosed={attributes:{Location:'Trico Rd south of Trico Marana Rd',Status:'Closed',Direction:'Northbound',timeUpdated:'11/02/26, 10:25'},geometry:{x:-111.30429098657586,y:32.45112652226325}};
const json=(route,body)=>route.fulfill({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify(body)});
const hours=(n)=>Array.from({length:n},(_,i)=>new Date(Date.now()+i*3600000).toISOString());
const reach=(id)=>({reach:{reachId:id},shortRange:{series:{referenceTime:new Date(Date.now()-3600000).toISOString(),units:'ft³/s',data:hours(18).map(validTime=>({validTime,flow:400}))}}});
const posts=[];
async function fakeWorld(context){
 await context.route(/^https?:\/\/(?!localhost)/,(route)=>{
  const url=route.request().url();
  if(url.includes('script.google.com')){
   if(route.request().method()==='POST'){const body=JSON.parse(route.request().postData()||'{}');posts.push(body);return json(route,{ok:true,reports:body.action==='drive'?[{fp:body.fp,state:body.state,at:Date.now()}]:undefined})}
   if(url.includes('feed=all'))return json(route,{usgs:{series:{}},alert:{fetched_at:new Date().toISOString(),rain:[],stream:[]},roadEvents:{events:[],fetchedAt:Date.now()},drive:[]});
   if(url.includes('feed=forecasts'))return json(route,{responses:{}});
   return json(route,{ok:true,sender:'verizon'});
  }
  if(url.includes('arcgis'))return json(route,{features:[tricoClosed]});
  if(url.includes('weather.gov'))return json(route,{features:[]});
  const r=/reaches\/(\d+)\/streamflow/.exec(url);if(r)return json(route,reach(r[1]));
  if(url.includes('api.water.noaa.gov')||url.includes('waterdata.usgs.gov'))return route.fulfill({status:503,headers:{'Access-Control-Allow-Origin':'*'},body:''});
  if(url.includes('cdn.')||url.includes('openfreemap')||url.includes('fonts'))return route.continue().catch(()=>{});
  return route.abort();
 });
}
const browser=await chromium.launch(process.env.E2E_EXECUTABLE?{executablePath:process.env.E2E_EXECUTABLE}:process.env.E2E_CHROME?{channel:'chrome'}:{});
const failures=[];
async function check(name,fn){try{await fn();console.log('ok  ',name)}catch(e){failures.push(name);console.error('FAIL',name,'\n    ',String(e.message).split('\n').slice(0,6).join('\n     '))}}
async function freshPage(size={width:1024,height:768},serviceWorkers='block'){
 const context=await browser.newContext({viewport:size,serviceWorkers});await fakeWorld(context);
 const page=await context.newPage();const requests=[],errors=[];
 page.on('request',r=>requests.push(r.url()));page.on('pageerror',e=>errors.push(e.message));
 return {context,page,requests,errors};
}
const ready=(page)=>page.waitForSelector('.pin');
// Opening the Map shows simulated water and its notice. Dismiss it the way a person would.
async function dismissNotice(page){await page.waitForSelector('dialog.model-ack',{timeout:30000});await page.click('dialog.model-ack button');}
try {
 for(const size of [{width:390,height:844},{width:1280,height:900}]) {
  await check(`policies remain readable without app modules, route data or external services (${size.width})`,async()=>{
   const {context,page}=await freshPage(size);
   await context.route(/\/app\.js|\/data\//,r=>r.abort());
   await page.goto(origin+'/#/privacy');
   await page.locator('#legacy-policy').waitFor({state:'visible'});
   assert.match(await page.locator('#legacy-policy').innerText(),/SMS opt-in data and consent/);
   assert.equal(await page.locator('body').evaluate(e=>e.scrollWidth<=innerWidth),true);
   await page.goto(origin+'/#/terms');assert.equal(await page.locator('#legacy-policy').isVisible(),true);
   for(const path of ['privacy.html','terms.html']){await page.goto(origin+'/'+path);assert.match(await page.locator('main').innerText(),/Message and data rates may apply/);}
   if(size.width===390)await page.screenshot({path:join(repo,'public/twilio/terms.png'),fullPage:true});
   await context.close();
  });
  await check(`signup, interrupted/repeated confirmation, waitlist and failed stop (${size.width})`,async()=>{
   const {context,page}=await freshPage(size);const actions=[];let failStop=true;
   await context.route('https://script.google.com/**',async r=>{
    if(r.request().method()!=='POST')return json(r,{ok:true,sender:'verizon'});
    const body=JSON.parse(r.request().postData());actions.push(body);
    if(body.action==='stop'&&failStop)return json(r,{ok:false,error:'Stop request failed. Try again.'});
    await new Promise(resolve=>setTimeout(resolve,150));return json(r,{ok:true});
   });
   await page.goto(origin+'/#/alerts');await page.locator('#w-join').waitFor();
   await page.locator('#t-phone').fill('5205550123');
   assert.equal(await page.locator('#screen a[href="privacy.html"]').count(),2);
   assert.equal(await page.locator('#screen a[href="terms.html"]').count(),2);
   if(size.width===390){await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:join(repo,'public/twilio/optin.png'),fullPage:true});}
   await page.locator('#t-signup').click();await page.locator('#t-code').waitFor();
   await page.locator('#t-back').click();await page.locator('#t-signup').click();await page.locator('#t-code').waitFor();
   await page.locator('#t-code').fill('1234');
   if(size.width===390){await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:join(repo,'public/twilio/confirm.png'),fullPage:true});}
   await page.locator('#t-confirm').dblclick();await page.getByText('Texts are on for', {exact:false}).waitFor();
   assert.equal(actions.filter(a=>a.action==='confirm').length,1);
   await page.reload();await page.locator('#w-join').waitFor();await page.locator('#w-phone').fill('5205550123');await page.locator('#w-join').dblclick();
   await page.getByText("You're on the waitlist",{exact:false}).waitFor();assert.equal(actions.filter(a=>a.action==='waitlist').length,1);
   await page.locator('#t-phone').fill('5205550123');await page.locator('#t-stop').click();await page.getByText('Stop request failed. Try again.',{exact:true}).waitFor();
   assert.equal(await page.getByText('its texts and waitlist entry are stopped.',{exact:false}).count(),0);
   failStop=false;await page.locator('#t-stop').click();await page.getByText('its texts and waitlist entry are stopped.',{exact:false}).waitFor();
   assert.ok(actions.filter(a=>a.action==='signup'||a.action==='waitlist').every(a=>a.consentVersion==='2026-11-06'));
   await context.close();
  });
 }
 await check('approved sender preview discloses STOP/HELP without activating a live sender',async()=>{
  const {context,page}=await freshPage({width:390,height:844});
  await context.route('https://script.google.com/**',r=>json(r,{ok:true,sender:'any'}));
  await page.goto(origin+'/#/alerts');await page.getByText('Texts are on',{exact:false}).waitFor();
  assert.match(await page.locator('.consent').innerText(),/Reply STOP to cancel, HELP for help/);
  assert.equal(await page.locator('#w-join').count(),0);
  await page.screenshot({path:join(repo,'public/twilio/approved-preview.png'),fullPage:true});await context.close();
 });
 await check('static policies work with JavaScript disabled',async()=>{
  const context=await browser.newContext({javaScriptEnabled:false});const page=await context.newPage();
  await page.goto(origin+'/privacy.html');assert.match(await page.innerText('main'),/SMS opt-in data and consent/);await context.close();
 });
 await check('standalone support reports refusal honestly and sends no SMS signup',async()=>{
  const {context,page}=await freshPage();const actions=[];let fail=true;
  await context.route('https://script.google.com/**',r=>{actions.push(JSON.parse(r.request().postData()));return json(r,fail?{ok:false,error:'Unavailable'}:{ok:true});});
  await page.goto(origin+'/support.html');await page.locator('[name=phone]').fill('5205550123');await page.locator('#stop-form button').click();await page.getByText('Unavailable',{exact:true}).waitFor();
  fail=false;await page.locator('[name=contact]').fill('reviewer@example.test');await page.locator('[name=message]').fill('Test support request');await page.locator('#help-form button').dblclick();await page.getByText('Your support request was sent to the operator.').waitFor();
  assert.deepEqual(actions.map(a=>a.action),['stop','request']);await context.close();
 });
}finally{await browser.close();server.close();rmSync(site,{recursive:true,force:true});}
if(failures.length)process.exitCode=1;
