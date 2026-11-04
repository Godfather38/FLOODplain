// Manual check of the all-route run in the Map tab's 3D view, installed Chrome, desktop and an
// emulated Pixel 7. Serve public/ first, then: node e2e/all-route-3d-check.mjs http://localhost:PORT/ OUTDIR [preset]
import {chromium,devices} from 'playwright';
const [origin,out='.',preset='']=process.argv.slice(2);
const browser=await chromium.launch({channel:'chrome',args:['--enable-precise-memory-info','--ignore-gpu-blocklist','--enable-gpu']});
const report={};
for(const [name,opts] of [['desktop',{viewport:{width:1600,height:900}}],['pixel7',devices['Pixel 7']]]){
 const ctx=await browser.newContext(opts),page=await ctx.newPage(),errors=[],frames=[];
 page.on('pageerror',e=>errors.push(String(e.stack||e).slice(0,400)));
 page.on('console',m=>{if(m.type()==='error')errors.push('console: '+m.text().slice(0,300));});
 page.on('response',r=>{const u=r.url();if(/all-route-13z\//.test(u))frames.push(u.split('all-route-13z/')[1]);});
 await page.addInitScript(p=>{try{sessionStorage.setItem('floodplain-ack','1');if(p)localStorage.setItem('fp-graphics',JSON.stringify({choice:p}));}catch{}},preset);
 await page.goto(origin+'index.html#/map',{waitUntil:'domcontentloaded'});
 await page.waitForSelector('[data-m-run]');await page.waitForTimeout(1500);
 await page.selectOption('[data-m-run]','allroutes');
 await page.waitForFunction(()=>/Model areas/.test(document.querySelector('[data-m-hud]')?.textContent||''),null,{timeout:120000});
 const t3=Date.now();
 await page.click('[data-m-layers]');await page.click('[data-m-view="3d"]');
 const f=await (async()=>{for(let k=0;k<200;k++){const fr=page.frames().find(f=>/world\.html/.test(f.url()));if(fr)return fr;await page.waitForTimeout(100);}throw new Error('no 3D frame');})();
 await f.waitForFunction(()=>window.world?.diagnostics?.ready&&window.world.run?.quad&&document.getElementById('loading').classList.contains('done'),null,{timeout:180000});
 await page.waitForSelector('.mapp.in3d',{timeout:60000,state:'attached'});
 const r={open3dMs:Date.now()-t3,errors};await page.waitForTimeout(4000);
 r.variant=await f.evaluate(()=>window.world.run.variant);r.preset=await f.evaluate(()=>window.fp3dGraphicsState?.().preset);
 r.note=(await f.textContent('#run-note')).slice(-260);
 const look=async(label,lon,lat,dist=1200)=>{
  await f.evaluate(([lon,lat,dist])=>{const w=window.world;w.setClock(w.frameIndex);window.fp3dGoto(lon,lat);},[lon,lat,dist]);
  await page.waitForTimeout(5000);
  await page.screenshot({path:`${out}/3d-${name}-${label}.png`});
  // water-coloured pixels near the middle of the 3D map
  // water-tinted pixels in the middle of the 3D map, read from a screenshot of it
  const box=await page.evaluate(()=>{const r=document.querySelector('.world-layer').getBoundingClientRect();return{x:r.x+r.width/2-150,y:r.y+r.height/2-150,width:300,height:300};});
  const png=await page.screenshot({clip:box});
  r[label]=await page.evaluate(async b64=>{const im=new Image();im.src='data:image/png;base64,'+b64;await im.decode();const c=document.createElement('canvas');c.width=im.width;c.height=im.height;const x=c.getContext('2d');x.drawImage(im,0,0);const d=x.getImageData(0,0,c.width,c.height).data;let n=0;for(let i=0;i<d.length;i+=4){if(d[i+2]>d[i]+40&&d[i+1]>d[i]+15)n++;}return n;},png.toString('base64'));
 };
 await look('brawley',-111.29459,32.39322);
 await look('sandario-pr',-111.2181,32.329);
 const cfg=await page.evaluate(async()=>(await import('./config.js')).FAILURE_POINTS.filter(p=>/sandario-(ina|magee)|picture-rocks-wash/.test(p.id)).map(p=>[p.id,p.lon,p.lat]));
 for(const [id,lon,lat] of cfg)await look(id,lon,lat);
 // play for 10 s, frame times
 const before=await f.evaluate(()=>{window.world.diagnostics.frameTimes.length=0;return window.world.frameIndex;});
 if(/Pause/.test(await page.getAttribute('[data-m-play]','aria-label')))await page.click('[data-m-play]');
 await page.click('[data-m-play]');
 await page.waitForTimeout(10000);
 r.play=await f.evaluate(b=>{const t=window.world.diagnostics.frameTimes.slice();t.sort((a,b)=>a-b);return{from:b,frames:t.length,medianMs:t[t.length>>1],p95Ms:t[Math.floor(t.length*.95)],frameIndex:window.world.frameIndex,time:document.getElementById('time').textContent};},before);
 if(/Pause/.test(await page.getAttribute('[data-m-play]','aria-label')))await page.click('[data-m-play]');
 r.mem=await f.evaluate(()=>performance.memory?Math.round(performance.memory.usedJSHeapSize/1048576)+' MB':null);
 r.files=frames.length;
 // the last frame: every area has it now, so no missing-frame or gap labels
 await f.evaluate(()=>window.world.setClock(window.world.run.frames.length-1.5));await page.waitForTimeout(4000);
 r.lastFrameLabels=await f.evaluate(()=>[...document.querySelectorAll('.marker.quad-missing,.marker.quad-gap')].map(e=>e.textContent));
 r.storyBrawley=await f.evaluate(()=>{window.world.routesUI.openDetail('brawley-dip');return document.querySelector('.crossing-view')?.innerText.slice(0,600);});
 r.storyKinney=await f.evaluate(()=>{window.world.routesUI.openDetail('pr-kinney-javelina');return document.querySelector('.crossing-view')?.innerText.slice(0,600);});
 await page.screenshot({path:`${out}/3d-${name}-lastframe.png`});
 report[name]=r;await ctx.close();
}
console.log(JSON.stringify(report,null,1));await browser.close();
