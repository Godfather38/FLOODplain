// Acceptance of actual wider-domain extreme water in the unchanged 2D and 3D views.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync,existsSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join,normalize,extname} from 'node:path';
import {chromium} from 'playwright';
const root=fileURLToPath(new URL('../public/',import.meta.url)),out='H:/AI/Projects/FLOODplain-builds';
const points=[{name:'northern-avra',lat:32.398934,lon:-111.246346,frame:23,key:'northern',depth:.720778760},{name:'pr-avra',lat:32.398348,lon:-111.216823,frame:29,key:'picture-rocks',depth:1.116611816}];
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png'};
const server=createServer((req,res)=>{const path=new URL(req.url,'http://x').pathname,file=normalize(join(root,path==='/'?'index.html':path));if(!file.startsWith(root)||!existsSync(file)){res.writeHead(404);return res.end();}let body=readFileSync(file);if(path==='/map-app.js')body=body.toString().replace(' setPlaying(false);setTab(tab);paintGraphics();setUi(uiMode);onRoute();',' window.__acceptanceMap={map,sim};\n setPlaying(false);setTab(tab);paintGraphics();setUi(uiMode);onRoute();');if(path==='/preview/geo3d/src/world/main.js')body=body.toString()+'\nwindow.__acceptanceFine={surface,finePics,fineBox};\n';res.setHeader('Content-Type',types[extname(file)]??'application/octet-stream');res.end(body);});
await new Promise(r=>server.listen(0,r));const origin='http://localhost:'+server.address().port;
const browser=await chromium.launch({channel:'chrome',args:['--enable-unsafe-swiftshader']}),report={map2d:[],view3d:[]};
try{
 const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});
 await context.addInitScript(()=>localStorage.setItem('geo3d-simulation-ack','1'));
 await context.route(/^https?:\/\/(?!localhost)/,async route=>{const u=route.request().url();if(u.includes('script.google.com'))return route.fulfill({json:{ok:true,usgs:{series:{}},alert:{fetched_at:new Date().toISOString(),rain:[],stream:[]},roadEvents:{events:[],fetchedAt:Date.now()},drive:[],responses:{}}});if(u.includes('weather.gov')||u.includes('arcgis'))return route.fulfill({json:{features:[]}});if(u.includes('s3.amazonaws.com')||u.includes('openfreemap')||u.includes('cdn.')||u.includes('fonts'))return route.continue();return route.abort();});
 const page=await context.newPage();page.setDefaultTimeout(180000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'/#/map');await page.waitForSelector('[data-m-run]');await page.waitForFunction(()=>window.__acceptanceMap?.sim.run);
 const dialog=page.locator('dialog.model-ack');if(await dialog.count())await dialog.locator('button').click();
 await page.selectOption('[data-m-run]','extreme');await page.waitForFunction(()=>window.__acceptanceMap?.sim.run?.def.id==='extreme');
 assert.ok(await page.locator('[data-m-run] option[value=stress]').count());
 for(const point of points){await page.evaluate(p=>{window.__acceptanceMap.map.setView([p.lat,p.lon],17,{animate:false});const el=document.querySelector('[data-m-scrub]');el.value=p.frame;el.dispatchEvent(new Event('input',{bubbles:true}));},point);
  await page.waitForFunction(p=>{const s=window.__acceptanceMap.sim;return s.clock===p.frame&&s.run.quad.cases.every(c=>s.run.quad.peek(c,p.frame));},point);await page.waitForTimeout(700);
  const result=await page.evaluate(p=>{const {map,sim}=window.__acceptanceMap,canvas=document.querySelector('.sim-canvas'),pt=map.latLngToContainerPoint([p.lat,p.lon]),ratio=canvas.width/map.getSize().x;return{time:sim.run.quad.iso[p.frame],values:sim.run.quad.valuesAt(p.lat,p.lon,p.frame),pixel:[...canvas.getContext('2d').getImageData(Math.floor(pt.x*ratio),Math.floor(pt.y*ratio),1,1).data]};},point);
  const value=result.values.find(v=>v.key===point.key);assert.equal(value.drawn,true);assert.ok(Math.abs(value.depth-point.depth)<.001);assert.ok(result.pixel[3]>0&&result.pixel[2]>result.pixel[0],'actual map canvas must paint blue water');report.map2d.push({point,...result});await page.screenshot({path:out+'/extreme-2d-'+point.name+'.png'});
 }
 assert.deepEqual(errors,[]);await page.close();
 const view=await context.newPage();view.setDefaultTimeout(240000);const viewErrors=[];view.on('pageerror',e=>viewErrors.push(e.message));
 await view.goto(origin+'/preview/geo3d/world.html?run=extreme');
 await view.waitForFunction(()=>window.world?.diagnostics.ready||!document.querySelector('#error').hidden);
 if(await view.locator('#error').isVisible())throw Error(await view.locator('#error-detail').innerText());
 await view.waitForSelector('#loading.done');
 for(const point of points){await view.evaluate(p=>{world.setClock(p.frame);window.fp3dGoto(p.lon,p.lat);},point);
  await view.waitForFunction(p=>window.world.frameIndex===p.frame&&window.__acceptanceFine?.finePics.has('extreme|nearest|'+p.frame),point);await view.waitForTimeout(2500);
  const result=await view.evaluate(async p=>{const {toUtm}=await import('/preview/geo3d/src/utm.js'),u=toUtm(p.lon,p.lat),{finePics,fineBox:b}=__acceptanceFine,pic=finePics.get('extreme|nearest|'+p.frame),col=Math.floor((u.e-b.e0)/b.w*b.cols),row=Math.floor((b.n0+b.h-u.n)/b.h*b.rows);return{time:world.run.quad.iso[p.frame],values:world.run.quad.valuesAt(p.lat,p.lon,p.frame),raster:{col,row,cols:b.cols,rows:b.rows,depthCode:pic.depth[row*b.cols+col],unknown:pic.unknown[row*b.cols+col]},errors:world.diagnostics.errors};},point);
  const value=result.values.find(v=>v.key===point.key);assert.equal(value.drawn,true);assert.ok(Math.abs(value.depth-point.depth)<.001);assert.ok(result.raster.col>=0&&result.raster.col<result.raster.cols&&result.raster.row>=0&&result.raster.row<result.raster.rows);assert.ok(result.raster.depthCode>0);assert.equal(result.raster.unknown,0);assert.deepEqual(result.errors,[]);report.view3d.push({point,...result});await view.screenshot({path:out+'/extreme-3d-'+point.name+'.png'});
 }
 assert.deepEqual(viewErrors,[]);console.log(JSON.stringify(report,null,2));writeFileSync(out+'/extreme-rendered-acceptance.json',JSON.stringify(report,null,2));
}finally{await browser.close();server.close();}
