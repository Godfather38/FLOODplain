import {chromium} from 'playwright';import {mkdir,writeFile} from 'node:fs/promises';
import {server} from './voxel-preview-server.mjs';
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--enable-webgl','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
await page.goto('http://127.0.0.1:8094/simulation/voxel-qa.html');
await page.waitForFunction(()=>window.qaReady||window.qaError,{timeout:60000});
await page.waitForTimeout(2500);await mkdir('public/simulation/preview',{recursive:true});
await page.screenshot({path:'public/simulation/preview/voxel-desktop.png'});
console.log(JSON.stringify({errors,status:await page.locator('#status').textContent(),state:await page.evaluate(()=>{const x=window.qa?.view.inspect();return x?{active:x.active,instances:x.model?.land.count,water:x.model?.water.count,center:x.map.getCenter(),zoom:x.map.getZoom(),frame:x.frame?.time,basis:x.model?.basis.slice(0,2),origin:x.model?.group.position,matrix:Array.from(x.model?.land.instanceMatrix.array.slice(0,16)),extent:x.map.getExtent().toArray()}:null;})},null,2));
await writeFile('public/simulation/preview/voxel-browser-first.json',JSON.stringify({errors},null,2));await browser.close();server.close();

