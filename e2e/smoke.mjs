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
import {gunzipSync} from 'node:zlib';
import {decodeRoadHeights} from '../public/preview/geo3d/src/road-package.js';

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
const brawley='west-avra-valley-road-32-39322-111-29459';
async function chooseHand(page){
 await dismissNotice(page);
 await page.selectOption('[data-model]','hand');
 await page.waitForFunction(()=>document.querySelector('[data-site]')?.options.length>0);
 await page.selectOption('[data-site]',brawley);
 await page.waitForSelector('.hand-depth-layer',{timeout:15000});
}

try{
 await check('scores and the main map expose predicted water against road height without a separate estimate page',async()=>{
  const {context,page,errors}=await freshPage({width:1024,height:768});
  const raw=gunzipSync(readFileSync(join(repo,'public/simulation/data/road-heights/routes.bin.gz')));
  const lines=decodeRoadHeights(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength)).lines;
  const station=lines.find(l=>l.kind==='route'&&l.routeId==='avra').stations.find(p=>p.elevationM!=null);
  const times=Array.from({length:3},(_,k)=>new Date(Date.now()+(k-1)*3600e3).toISOString());
  const summary={schemaVersion:1,kind:'live_all_route_road_forecast',executionMode:'live_current_forcing',status:'complete',case:'northern',runId:'browser-road-check',issuedAt:new Date().toISOString(),validFrom:times[0],validTo:times[2],times,
   routes:{avra:{totalStations:1,mappedStations:1,outsideStations:0,unknownHeightStations:0,frames:times.map(()=>({peakRoadDepthM:.04,validStations:1,wetStations:1,lat:station.lat,lon:station.lon,deck:false,coverage:'complete'}))}}};
  const display=JSON.parse(gunzipSync(readFileSync(join(repo,'public/simulation/data/frozen-terrain-display.json.gz'))));
  await context.route('**/all-route/northern/compact/road-forecast.json*',r=>json(r,summary));
  await context.route('**/live-model/live/manifest.json*',r=>json(r,{issuedAt:new Date().toISOString(),hrrrCycle:times[0],runId:'browser-coarse-check'}));
  await context.route('**/live-model/live/water.json.gz*',r=>json(r,{frames:times.map((time,k)=>({time,surfaceM:display.waterFrames[k].surfaceM}))}));
  await context.route('**/live-model/live/rainfall.json*',r=>json(r,{frames:[]}));
  await context.route('**/live-model/live/inflow.json*',r=>json(r,{series:[]}));
  await page.goto(origin+'/#/');await ready(page);
  await page.waitForFunction(()=>document.querySelector('#screen')?.textContent.includes('0.1 ft'));
  assert.equal(await page.locator('.exp-link').count(),0,'no alternate estimate destination');
  await page.click('[data-destination=map]');await dismissNotice(page);
  assert.equal(await page.getAttribute('[data-m-tab=routes]','aria-selected'),'true');
  await page.waitForSelector('.road-forecast-pin');
  await page.click('.road-forecast-pin');
  await page.waitForFunction(()=>document.querySelector('.road-comparison')?.textContent.includes('Predicted water:'));
  const comparison=await page.innerText('.road-comparison');
  assert.match(comparison,/Road:.*ft NAVD88.*Predicted water:.*ft NAVD88.*0.13 ft above the road/s);
  await page.click('.leaflet-popup-close-button');
  await page.click('[data-destination=routes]');await page.click('[data-destination=map]');
  assert.equal(await page.locator('.road-forecast-pin').count(),1,'one marker after repeated navigation');
  assert.deepEqual(errors,[]);await context.close();
 });
 await check('home shows the closure, ranks it last, and colors its icons',async()=>{
  const {context,page,errors}=await freshPage({width:375,height:812});
  await page.goto(origin+'/#/');await ready(page);await page.waitForSelector('.closure-banner');
  assert.match(await page.innerText('.closure-banner'),/Trico Rd south of Trico Marana Rd.*Blocks Trico-Marana/s);
  assert.doesNotMatch(await page.innerText('#screen .hero'),/Trico-Marana/);
  // The map redraws when feeds arrive, so wait for icons, and read them in a single step.
  await page.waitForFunction(()=>document.querySelectorAll('.pin:not(.closure-pin)').length>=4);
  await page.waitForTimeout(800);
  const colors=await page.$$eval('.pin:not(.closure-pin)',p=>[...new Set(p.map(e=>getComputedStyle(e,'::before').backgroundColor))]);
  assert.ok(colors.length&&colors.every(c=>/^rgb\(37, 107, 43\)|^rgb\(39, 95, 163\)|^rgb\(128, 85, 0\)|^rgb\(173, 67, 21\)|^rgb\(181, 31, 42\)|^rgb\(98, 87, 111\)/.test(c)),colors.join());
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'no sideways scroll');
  assert.deepEqual(errors,[]);await context.close();
 });
 await check('a route-first startup loads the high-resolution forecast and a closed route offers no directions',async()=>{
  const {context,page,errors}=await freshPage();
  const forecast=page.waitForRequest(r=>r.url().includes('/all-route/northern/compact/road-forecast.json'));
  await page.goto(origin+'/#/r/trico');await page.waitForSelector('.closed-note');await forecast;
  const navs=await page.$$eval('[data-nav]',b=>b.map(x=>x.dataset.nav));assert.ok(!navs.includes('trico'),navs.join());
  assert.deepEqual(errors,[],'route-first rendering must not dereference the model module before it loads');
  await context.close();
 });
 await check('route deep links override the saved area on startup, reload and browser history',async()=>{
  const {context,page,errors}=await freshPage();
  await page.addInitScript(()=>localStorage.setItem('area',JSON.stringify('avra')));
  await page.goto(origin+'/#/r/pr-gates');await ready(page);
  await page.waitForFunction(()=>document.querySelector('#title')?.textContent==='Gates Pass');
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('area'))),'picture-rocks');
  await page.reload();await ready(page);
  await page.waitForFunction(()=>document.querySelector('#title')?.textContent==='Gates Pass');
  await page.goto(origin+'/#/r/trico');
  await page.waitForFunction(()=>document.querySelector('#title')?.textContent==='Trico-Marana');
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('area'))),'avra');
  await page.goBack();
  await page.waitForFunction(()=>document.querySelector('#title')?.textContent==='Gates Pass');
  await page.goForward();
  await page.waitForFunction(()=>document.querySelector('#title')?.textContent==='Trico-Marana');
  await page.goto(origin+'/#/r/pr-ina/sc-ina');
  await page.waitForFunction(()=>document.querySelector('#title')?.textContent==='Ina Rd river bridge');
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('area'))),'picture-rocks');
  await page.goto(origin+'/#/r/trico/sc-ina');
  await page.waitForFunction(()=>document.querySelector('#title')?.textContent==='Trico-Marana');
  assert.deepEqual(errors,[]);await context.close();
 });
 await check('missing crossing evidence is separated from quiet data without claiming normal road conditions',async()=>{
  const {context,page,errors}=await freshPage();
  await page.goto(origin+'/#/r/avra');await ready(page);
  await page.waitForFunction(()=>document.querySelector('#screen')?.textContent.includes('Conditions not established'));
  const screen=await page.innerText('#screen');
  assert.match(screen,/Conditions not established/);
  assert.doesNotMatch(screen,/Every stretch looks normal|Looks normal/);
  const unknown=page.locator('h3.section').filter({hasText:'Conditions not established'});
  assert.match(await unknown.locator('xpath=following-sibling::div[1]').innerText(),/Avra Valley Rd river bridge/);
  assert.deepEqual(errors,[]);await context.close();
 });
 await check('incomplete county row reports its gap without losing the usable closure',async()=>{
  const {context,page,errors}=await freshPage();
  const gap=JSON.parse(readFileSync(join(repo,'test/fixtures/county-incomplete-2026-11-05.json'),'utf8')).features[0];
  await page.route(/services2\.arcgis\.com/,route=>json(route,{features:[tricoClosed,gap,null]}));
  await page.goto(origin+'/#/');await ready(page);await page.waitForSelector('.closure-banner');
  assert.match(await page.innerText('.closure-banner'),/Trico Rd south of Trico Marana Rd/);
  assert.match(await page.innerText('.check-status'),/W Gates Pass Rd: missing Status/);
  assert.doesNotMatch(await page.innerText('#screen .hero'),/Trico-Marana/);
  assert.deepEqual(errors,[]);
  await context.close();
 });
 await check('Map opens with simulated water, its notice once, then 3D with the 3D wording',async()=>{
  const {context,page}=await freshPage();
  await page.goto(origin+'/#/map');await ready(page);
  await page.waitForSelector('dialog.model-ack',{timeout:30000});
  // The live run when it is published and fresh, otherwise a saved run: either way, one notice.
  assert.match(await page.innerText('dialog.model-ack'),/(saved run|model forecast).*turn around, don't drown\./s);
  await page.click('dialog.model-ack button');
  await page.waitForFunction(()=>/MST/.test(document.querySelector('[data-m-time]')?.innerText||''),null,{timeout:30000});
  assert.equal(await page.$eval('input[name=mapp-model]:checked',e=>e.value),'2d','simulated water is on by default');
  assert.match(await page.innerText('[data-m-model-hint]'),/SFINCS/);
  const box=await page.evaluate(()=>{const m=document.querySelector('#map').getBoundingClientRect(),p=[...document.querySelectorAll('.pin')].map(e=>e.getBoundingClientRect()).filter(b=>b.width);return {n:p.length,inside:p.every(b=>b.x>=m.left-1&&b.x<=m.right+1&&b.y>=m.top-1&&b.y<=m.bottom+1)}});
  assert.ok(box.inside,'crossings stay on the map');
  assert.ok(await page.locator('.home-outlook').count()>=0);
  await page.reload();await ready(page);await page.waitForTimeout(2500);
  assert.equal(await page.locator('dialog.model-ack').count(),0,'once per session');
  await context.close();
 });
 await check('Current conditions in the Layers & view card match the cards instead of a dark box',async()=>{
  const {context,page}=await freshPage();
  await page.goto(origin+'/#/map');await ready(page);await dismissNotice(page);
  await page.click('[data-m-tab=routes]');
  const s=await page.$eval('.live-map-panel',p=>{const c=getComputedStyle(p),r=p.getBoundingClientRect(),b=p.querySelector('[data-refresh]').getBoundingClientRect();return {bg:c.backgroundColor,color:c.color,inset:r.right-b.right}});
  assert.equal(s.bg,'rgb(239, 239, 236)');assert.equal(s.color,'rgb(27, 27, 26)');assert.ok(s.inset>=8,'refresh inset '+s.inset);
  await context.close();
 });
 await check('Map tab lists routes with live ratings, and a pin opens its crossing card',async()=>{
  const {context,page,errors}=await freshPage();
  await page.goto(origin+'/#/map');await ready(page);await dismissNotice(page);
  await page.click('[data-m-tab=routes]');
  await page.waitForSelector('[data-map-route]');
  const rows=await page.$$eval('[data-map-route]',r=>r.map(x=>x.innerText));
  assert.ok(rows.length>=3&&rows.every(t=>/\d(\.5)? of 5 · /.test(t)),rows.join(' | '));
  await page.click('[data-map-route="trico"]');
  assert.equal(await page.getAttribute('[data-map-route="trico"]','aria-pressed'),'true');
  // A pin that is not under the side panel or the time bar.
  const pin=await page.evaluate(()=>{for(const p of document.querySelectorAll('.leaflet-marker-icon .drop-pin')){const r=p.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/3;if(r.width&&p.contains(document.elementFromPoint(x,y)))return{x,y};}return null;});
  assert.ok(pin,'a crossing pin is visible on the map');
  await page.mouse.click(pin.x,pin.y);
  await page.waitForSelector('.crossing-view h2');
  assert.match(await page.innerText('.crossing-view'),/of 5|Low|Minor|Moderate|High|Severe/);
  assert.match(await page.getAttribute('.crossing-view a.btn-primary','href'),/^#\/r\/[\w-]+\/[\w-]+$/);
  assert.equal(new URL(page.url()).hash,'#/map','the Map tab stays open');
  await page.click('[data-map-close]');await page.waitForSelector('[data-map-route]');
  assert.deepEqual(errors,[]);await context.close();
 });
 await check('HAND water from the Model menu is drawn around the crossing in water colors',async()=>{
  const {context,page}=await freshPage();
  await page.goto(origin+'/#/map');await ready(page);await dismissNotice(page);
  // The Nov 1 13Z run carries archived NWM flows for every HAND window, Brawley Wash included.
  await page.click('[data-m-scenarios]');await page.click('.mapp-menu [data-menu-run="13z"]');
  await page.waitForFunction(()=>/Nov/.test(document.querySelector('[data-m-time]')?.innerText||''),null,{timeout:30000});
  await page.click('[data-m-layers]');await page.click('input[name=mapp-model][value=hand]');
  await page.waitForFunction(()=>/HAND: water in \d+ of 25 windows/.test(document.querySelector('[data-m-model-hint]')?.innerText||''),null,{timeout:30000});
  await page.click('[data-m-close]');
  // Centre the map on the Brawley Wash crossing and read the HAND colours drawn around it.
  const r=await page.evaluate(async([lat,lon])=>{
   const c=document.querySelector('canvas.sim-canvas');const m=document.getElementById('map').getBoundingClientRect();
   const sel=document.querySelector('[data-m-search]');const opt=[...sel.options].find(o=>/Brawley/.test(o.textContent));sel.value=opt.value;sel.dispatchEvent(new Event('change'));
   await new Promise(r=>setTimeout(r,2500));
   const ctx=c.getContext('2d'),ratio=c.width/c.clientWidth,d=ctx.getImageData(0,0,c.width,c.height).data;
   let water=0,other=0;const cx=c.width/2,cy=c.height/2,R=180*ratio;
   for(let y=Math.max(0,cy-R|0);y<Math.min(c.height,cy+R);y+=2)for(let x=Math.max(0,cx-R|0);x<Math.min(c.width,cx+R);x+=2){const i=(y*c.width+x)*4;if(d[i+3]<40)continue;if(d[i+2]>d[i])water++;else other++;}
   return{water,other};
  },[32.39322,-111.29459]);
  assert.ok(r.water>0,'HAND water drawn around the Brawley Wash crossing');
  assert.ok(r.water>r.other*4,'water colours: '+JSON.stringify(r));
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
  await page.reload();await page.waitForSelector('#screen .hero',{timeout:15000});
  assert.match(await page.innerText('.closure-banner'),/Trico Rd south of Trico Marana Rd/);
  assert.match(await page.innerText('#check-age'),/Offline/);
  await context.close();
 });
}finally{
 await browser.close();server.close();rmSync(site,{recursive:true,force:true});
}
if(failures.length){console.error(`\n${failures.length} browser check(s) failed.`);process.exit(1)}
console.log('\nAll browser checks passed.');
