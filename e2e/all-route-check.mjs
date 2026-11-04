// Manual check of the all-route run on the Map tab in installed Chrome, desktop and an emulated
// Pixel 7: frame load times, memory, page errors, and water at the Brawley Wash and Sandario dips.
// Serve public/ first (python -m http.server PORT --directory public), then:
//   node e2e/all-route-check.mjs http://localhost:PORT/ OUTDIR [3d]
import {chromium,devices} from 'playwright';
const [origin,out='.',mode='2d']=process.argv.slice(2);
const browser=await chromium.launch({channel:'chrome',args:['--enable-precise-memory-info','--ignore-gpu-blocklist','--enable-unsafe-swiftshader']});
const report={};
for(const [name,opts] of [['desktop',{viewport:{width:1600,height:900}}],['pixel7',devices['Pixel 7']]]){
 const ctx=await browser.newContext(opts),page=await ctx.newPage(),errors=[],frames=[];
 page.on('pageerror',e=>errors.push(String(e.stack||e)));
 page.on('console',m=>{if(m.type()==='error')errors.push('console: '+m.text());});
 page.on('response',r=>{const u=r.url();if(/all-route-13z\/.+\/(web|full)-\d+\.bin\.gz/.test(u))frames.push({u:u.split('all-route-13z/')[1],t:Date.now()});});
 await page.addInitScript(()=>{try{sessionStorage.setItem('floodplain-ack','1');}catch{}
  let l;Object.defineProperty(window,'L',{configurable:true,get(){return l;},set(v){l=v;v?.Map?.addInitHook?.(function(){window.__map??=this;});}});});
 const t0=Date.now();
 await page.goto(origin+'index.html#/map',{waitUntil:'domcontentloaded'});
 await page.waitForSelector('[data-m-run]',{timeout:60000});
 // dismiss the acknowledgement if it shows
 const ack=async()=>{for(const b of await page.$$('button')){const t=(await b.textContent()||'').trim();if(/^(I understand|Got it|OK|Continue)/i.test(t)&&await b.isVisible())await b.click().catch(()=>{});}};
 await page.waitForTimeout(1500);await ack();
 const tl=Date.now();
 await page.selectOption('[data-m-run]','allroutes');
 await page.waitForFunction(()=>/Model areas/.test(document.querySelector('[data-m-hud]')?.textContent||''),null,{timeout:120000});
 const loadMs=Date.now()-tl;await ack();
 await page.waitForTimeout(2500);
 const r={loadMs,errors};
 r.time=await page.textContent('[data-m-time]');r.hud=await page.textContent('[data-m-hud]');
 r.mem=await page.evaluate(()=>performance.memory?{usedMB:Math.round(performance.memory.usedJSHeapSize/1048576),totalMB:Math.round(performance.memory.totalJSHeapSize/1048576)}:null);
 await page.screenshot({path:`${out}/${name}-overview.png`});
 // Water drawn at a place: count blue pixels in the sim canvas around a lat/lon after flying there.
 async function look(label,lat,lon,zoom){
  await page.evaluate(([lat,lon,zoom])=>window.__map.setView([lat,lon],zoom,{animate:false}),[lat,lon,zoom]);
  await page.waitForTimeout(2500);
  const px=await page.evaluate(([lat,lon])=>{const m=window.__map,p=m.latLngToContainerPoint([lat,lon]),c=document.querySelector('.sim-canvas'),r=c.width/c.clientWidth,ctx=c.getContext('2d'),R=40,d=ctx.getImageData(Math.max(0,(p.x-R)*r),Math.max(0,(p.y-R)*r),2*R*r,2*R*r).data;let n=0;for(let i=3;i<d.length;i+=4)if(d[i]>0&&d[i-1]>d[i-3])n++;return{blue:n,of:d.length/4};},[lat,lon]);
  await page.screenshot({path:`${out}/${name}-${label}.png`});
  r[label]=px;
 }
 // Brawley Wash dip on Avra Valley Rd; Sandario dips (Picture Rocks Rd / Ina / Magee / Emigh).
 // Step to each spot's peak frame first.
 const peak=async id=>page.evaluate(id=>{const s=window.__mapApp?.debug?.();return s;},id);
 r.brawley=null;
 await look('brawley',32.39322,-111.29459,16);
 const cfg=await page.evaluate(async()=>{const c=await import('./config.js');return c.FAILURE_POINTS.filter(p=>/sandario/.test(p.id)).map(p=>[p.id,p.lat,p.lon]);});
 for(const [id,lat,lon] of cfg)await look(id,lat,lon,16);
 // play 8 frames, timing
 const p0=Date.now();await page.click('[data-m-play]');await page.waitForTimeout(8000);await page.click('[data-m-play]');
 r.playedTo=await page.textContent('[data-m-time]');
 r.framesFetched=frames.length;r.frameSample=frames.slice(0,4).map(f=>f.u);
 r.mem2=await page.evaluate(()=>performance.memory?{usedMB:Math.round(performance.memory.usedJSHeapSize/1048576)}:null);
 r.scoreboard=await page.evaluate(()=>{document.querySelector('[data-m-tab=crossings]')?.click();return document.querySelector('[data-m-score]')?.innerText.slice(0,1500);});
 r.total=Date.now()-t0;
 report[name]=r;await ctx.close();
}
console.log(JSON.stringify(report,null,1));
await browser.close();
