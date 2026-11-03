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
execFileSync(process.execPath,[join(repo,'tools/prune-published.mjs'),site],{stdio:'pipe'});
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
const SAVED_RUN_FILE=/frozen|water-footprints|retained|terrain|geographic-view|renderer-chunks|voxel/;
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
const brawley='west-avra-valley-road-32-39322-111-29459';
async function chooseHand(page){
 await page.click('[data-panel=options]');
 await page.selectOption('[data-mode]','hand');
 await page.waitForFunction(()=>document.querySelector('[data-site]')?.options.length>0);
 await page.selectOption('[data-site]',brawley);
 await page.waitForSelector('dialog.model-ack, .hand-depth-layer',{timeout:15000});
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
 await check('fresh Map fits the routes, shows no notice, and loads no 3D or saved-run files',async()=>{
  const {context,page,requests}=await freshPage();
  await page.goto(origin+'/#/map');await ready(page);await page.waitForTimeout(1500);
  const box=await page.evaluate(()=>{const m=document.querySelector('#map').getBoundingClientRect(),p=[...document.querySelectorAll('.pin')].map(e=>e.getBoundingClientRect()),x=p.map(b=>b.x);return {spread:Math.max(...x)-Math.min(...x),inside:p.every(b=>b.x>=m.left-1&&b.x<=m.right+1&&b.y>=m.top-1&&b.y<=m.bottom+1)}});
  assert.ok(box.spread>150,'routes fill the map, spread '+box.spread);assert.ok(box.inside);
  assert.equal(await page.locator('dialog.model-ack').count(),0);
  assert.deepEqual(requests.filter(u=>SAVED_RUN_FILE.test(u)),[]);
  assert.doesNotMatch(await page.innerText('body'),/frozen|retained|replay|Nov 1\b/i);
  await context.close();
 });
 await check('Map options panel matches the sheet instead of a dark box',async()=>{
  const {context,page}=await freshPage();
  await page.goto(origin+'/#/map');await ready(page);await page.click('[data-panel=options]');
  const s=await page.$eval('.live-map-panel',p=>{const c=getComputedStyle(p),r=p.getBoundingClientRect(),b=p.querySelector('[data-refresh]').getBoundingClientRect();return {bg:c.backgroundColor,color:c.color,inset:r.right-b.right}});
  assert.equal(s.bg,'rgb(239, 239, 236)');assert.equal(s.color,'rgb(27, 27, 26)');assert.ok(s.inset>=8,'refresh inset '+s.inset);
  await context.close();
 });
 await check('HAND water sits on the crossing, in water colors, with one notice a session',async()=>{
  const {context,page}=await freshPage();
  await page.goto(origin+'/#/map');await ready(page);await chooseHand(page);
  assert.match(await page.innerText('dialog.model-ack'),/model estimate.*turn around, don't drown\..*Got it/s);
  await page.click('dialog.model-ack button');
  assert.equal(await page.evaluate(()=>sessionStorage.getItem('floodplain-ack')),'1');
  await page.waitForSelector('.hand-depth-layer');await page.waitForTimeout(800);
  const placed=await page.evaluate(()=>{const g=document.querySelector('.hand-depth-layer').getBoundingClientRect(),p=[...document.querySelectorAll('.leaflet-marker-icon')].find(e=>e.title==='Brawley Wash dip').getBoundingClientRect();return [Math.abs(g.left+g.width/2-p.left-p.width/2),Math.abs(g.top+g.height/2-p.top-p.height/2)]});
  assert.ok(placed[0]<3&&placed[1]<3,'centered on the crossing, off by '+placed);
  const colors=await page.$eval('.hand-depth-layer',img=>{const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;const x=c.getContext('2d');x.drawImage(img,0,0);const d=x.getImageData(0,0,c.width,c.height).data,out={wet:0,warm:0};for(let i=0;i<d.length;i+=4)if(d[i+3]>100){out.wet++;if(d[i]>d[i+2])out.warm++}return out});
  assert.ok(colors.wet>0);assert.equal(colors.warm,0,'no amber or brown water');
  assert.match(await page.innerText('.hand-legend'),/Modeled water depth estimate/);
  await page.selectOption('[data-site]','west-trico-marana-road-32-45369-111-27985').catch(()=>{});await page.waitForTimeout(1000);
  assert.equal(await page.locator('dialog.model-ack').count(),0,'no repeat');
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
 await check('Test flood draws saved water with its own wording, then goes back to live',async()=>{
  const {context,page}=await freshPage();
  await page.goto(origin+'/?mode=test-flood#/map');await page.waitForSelector('dialog.model-ack',{timeout:30000});
  assert.match(await page.innerText('dialog.model-ack'),/saved run/);await page.click('dialog.model-ack button');
  assert.equal(await page.innerText('#title'),'Simulated flood');
  await page.waitForFunction(()=>document.querySelector('.dock-status')?.innerText.includes('Simulated water'),null,{timeout:30000});
  assert.equal(await page.locator('.test-flood-banner').count(),0);
  await page.click('[data-destination=routes]');await page.waitForURL(u=>!u.search.includes('test-flood'));
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
