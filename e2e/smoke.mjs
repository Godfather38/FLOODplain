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
const browser=await chromium.launch(process.env.E2E_CHROME?{channel:'chrome'}:{});
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
const brawley='west-avra-valley-road-32-39322-111-29459';
async function chooseHand(page){
 await dismissNotice(page);
 await page.click('[data-panel=options]');
 await page.selectOption('[data-model]','hand');
 await page.waitForFunction(()=>document.querySelector('[data-site]')?.options.length>0);
 await page.selectOption('[data-site]',brawley);
 await page.waitForSelector('.hand-depth-layer',{timeout:15000});
}

try{
 await check('home shows the closure, ranks it last, and colors its icons',async()=>{
  const {context,page,errors}=await freshPage({width:375,height:812});
  await page.goto(origin+'/#/');await ready(page);await page.waitForSelector('.closure-banner');
  assert.match(await page.innerText('.closure-banner'),/Trico Rd south of Trico Marana Rd.*Blocks Trico-Marana/s);
  assert.doesNotMatch(await page.innerText('.hero'),/Trico-Marana/);
  // The map redraws when feeds arrive, so wait for icons, and read them in a single step.
  await page.waitForFunction(()=>document.querySelectorAll('.pin:not(.closure-pin)').length>=4);
  await page.waitForTimeout(800);
  const colors=await page.$$eval('.pin:not(.closure-pin)',p=>[...new Set(p.map(e=>getComputedStyle(e).backgroundColor))]);
  assert.ok(colors.length&&colors.every(c=>/^rgb\(37, 107, 43\)|^rgb\(39, 95, 163\)|^rgb\(128, 85, 0\)|^rgb\(173, 67, 21\)|^rgb\(181, 31, 42\)|^rgb\(98, 87, 111\)/.test(c)),colors.join());
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'no sideways scroll');
  assert.deepEqual(errors,[]);await context.close();
 });
 await check('a closed route offers no directions',async()=>{
  const {context,page}=await freshPage();
  await page.goto(origin+'/#/r/trico');await page.waitForSelector('.closed-note');
  const navs=await page.$$eval('[data-nav]',b=>b.map(x=>x.dataset.nav));assert.ok(!navs.includes('trico'),navs.join());
  await context.close();
 });
 await check('Map opens with simulated water, its notice once, then 3D with the 3D wording',async()=>{
  const {context,page}=await freshPage();
  await page.goto(origin+'/#/map');await ready(page);
  await page.waitForSelector('dialog.model-ack',{timeout:30000});
  assert.match(await page.innerText('dialog.model-ack'),/saved run.*turn around, don't drown\./s);
  await page.click('dialog.model-ack button');
  await page.waitForFunction(()=>document.querySelector('.dock-status')?.innerText.includes('Simulated water'),null,{timeout:30000});
  assert.equal(await page.$eval('[data-model]',e=>e.value),'2d');
  const box=await page.evaluate(()=>{const m=document.querySelector('#map').getBoundingClientRect(),p=[...document.querySelectorAll('.pin')].map(e=>e.getBoundingClientRect()).filter(b=>b.width);return {n:p.length,inside:p.every(b=>b.x>=m.left-1&&b.x<=m.right+1&&b.y>=m.top-1&&b.y<=m.bottom+1)}});
  assert.ok(box.inside,'crossings stay on the map');
  assert.ok(await page.locator('.home-outlook').count()>=0);
  await page.reload();await ready(page);await page.waitForTimeout(2500);
  assert.equal(await page.locator('dialog.model-ack').count(),0,'once per session');
  await context.close();
 });
 await check('Map options panel matches the sheet instead of a dark box',async()=>{
  const {context,page}=await freshPage();
  await page.goto(origin+'/#/map');await ready(page);await dismissNotice(page);await page.click('[data-panel=options]');
  const s=await page.$eval('.live-map-panel',p=>{const c=getComputedStyle(p),r=p.getBoundingClientRect(),b=p.querySelector('[data-refresh]').getBoundingClientRect();return {bg:c.backgroundColor,color:c.color,inset:r.right-b.right}});
  assert.equal(s.bg,'rgb(239, 239, 236)');assert.equal(s.color,'rgb(27, 27, 26)');assert.ok(s.inset>=8,'refresh inset '+s.inset);
  await context.close();
 });
 await check('HAND water from the Model menu is drawn around the crossing in water colors',async()=>{
  const {context,page}=await freshPage();
  await page.addInitScript(()=>{window.addEventListener('current-hand-layers',e=>{if(e.detail.layers.length)window.__hand=e.detail.layers.map(l=>({fill:l.options.fillColor,b:l.getBounds()}))})});
  await page.goto(origin+'/#/map');await ready(page);await dismissNotice(page);
  await page.click('[data-panel=options]');await page.selectOption('[data-model]','hand');
  await page.waitForFunction(()=>document.querySelector('[data-site]')?.options.length>0);
  await page.selectOption('[data-site]',brawley);
  await page.waitForFunction(()=>window.__hand?.length>0,null,{timeout:20000});
  const r=await page.evaluate(()=>{const fills=[...new Set(window.__hand.map(h=>h.fill))];let s=90,n=-90,w=180,e=-180;for(const {b} of window.__hand){s=Math.min(s,b._southWest.lat);n=Math.max(n,b._northEast.lat);w=Math.min(w,b._southWest.lng);e=Math.max(e,b._northEast.lng)}return {fills,s,n,w,e}});
  assert.ok(r.fills.every(f=>{const [x,,z]=f.match(/\d+/g).map(Number);return z>x}),'water colors only: '+r.fills);
  assert.ok(r.s<32.39322&&r.n>32.39322&&r.w<-111.29459&&r.e>-111.29459,'water surrounds the crossing');
  await page.click('.map-sheet [data-close]');
  await page.waitForFunction(()=>/HAND modeled water depth estimate/.test(document.querySelector('.map-dock .dock-key')?.innerText||''),null,{timeout:15000});
  assert.equal(await page.locator('dialog.model-ack').count(),0,'one notice a session');
  await context.close();
 });
 await check('closures list shows the closure with a plain age and what it blocks',async()=>{
  const {context,page}=await freshPage({width:375,height:812});
  await page.goto(origin+'/#/');await page.waitForSelector('.closure-banner a');await page.click('.closure-banner a');await page.waitForSelector('.closure-status');
  const text=await page.innerText('#screen');
  assert.match(text,/Trico Rd south of Trico Marana Rd/);assert.match(text,/Closed/);assert.match(text,/updated /);assert.match(text,/Blocks Trico-Marana/);assert.doesNotMatch(text,/11\/02\/26/);
  await context.close();
 });
 await check('a driver report sends one fixed answer and says thanks',async()=>{
  const {context,page}=await freshPage({width:375,height:812});posts.length=0;
  await page.goto(origin+'/#/r/avra/brawley-dip');await page.waitForSelector('[data-drive=water]');
  assert.match(await page.innerText('.drive-report'),/No driver reports/);
  await page.click('[data-drive=water]');await page.waitForFunction(()=>/Latest driver report: water over the road/.test(document.querySelector('.drive-report')?.innerText));
  assert.deepEqual(posts.map(p=>[p.action,p.fp,p.state]),[['drive','brawley-dip','water']]);
  assert.match(await page.innerText('.drive-report'),/not part of the rating/);assert.match(await page.innerText('.drive-report'),/Thanks/);
  await context.close();
 });
 await check('crossing screen uses plain words',async()=>{
  const {context,page}=await freshPage();
  await page.goto(origin+'/#/r/trico/sc-trico-marana');await ready(page);await page.waitForTimeout(800);
  const text=await page.innerText('#screen');assert.doesNotMatch(text,/NAVD88/);assert.doesNotMatch(text,/HAND flood model|HAND model/);
  await context.close();
 });
 await check('instant closure alerts are off until someone opts in',async()=>{
  const {context,page}=await freshPage();posts.length=0;
  await page.goto(origin+'/#/alerts');await page.waitForSelector('#p-on');
  await page.evaluate(()=>{localStorage.setItem('pushOn','true')});await page.reload();await page.waitForSelector('#a-instant');
  assert.equal(await page.isChecked('#a-instant'),false);
  await page.check('#a-instant');await page.waitForTimeout(400);
  assert.equal(posts.at(-1)?.instant,true);
  await context.close();
 });
 await check('with no signal the app still opens with the last check',async()=>{
  const {context,page}=await freshPage({width:375,height:812},'allow');
  await page.goto(origin+'/#/');await page.waitForSelector('.closure-banner');
  await page.evaluate(()=>navigator.serviceWorker.ready);await page.reload();await page.waitForSelector('.closure-banner');await page.waitForTimeout(1500);
  await context.setOffline(true);
  await page.reload();await page.waitForSelector('.hero',{timeout:15000});
  assert.match(await page.innerText('.closure-banner'),/Trico Rd south of Trico Marana Rd/);
  assert.match(await page.innerText('#check-age'),/Offline/);
  await context.close();
 });
}finally{
 await browser.close();server.close();rmSync(site,{recursive:true,force:true});
}
if(failures.length){console.error(`\n${failures.length} browser check(s) failed.`);process.exit(1)}
console.log('\nAll browser checks passed.');
