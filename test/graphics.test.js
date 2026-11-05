import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PRESETS,PRESET_NAMES,classifyGpu,choosePreset,stepDown,resolve,pixelRatioFor,canvasRatio,lodsFor,createFrameWatch,shortGpu} from '../public/graphics.js';
import {LODS,lodFor} from '../public/preview/geo3d/src/world/detail.js';
const read=f=>readFileSync(new URL('../public/'+f,import.meta.url),'utf8');

// Renderer names as Chrome reports them (WEBGL_debug_renderer_info).
const RTX5070='ANGLE (NVIDIA, NVIDIA GeForce RTX 5070 (0x00002F04) Direct3D11 vs_5_0 ps_5_0, D3D11)';
const UHD='ANGLE (Intel, Intel(R) UHD Graphics 630 (0x00003E92) Direct3D11 vs_5_0 ps_5_0, D3D11)';
const IRIS='ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x00009A49) Direct3D11 vs_5_0 ps_5_0, D3D11)';
const desktop={memoryGB:32,cores:12,screen:{w:1920,h:1080},dpr:1,touch:false,mobile:false,effectiveType:'4g'};
const office={memoryGB:8,cores:8,screen:{w:1920,h:1080},dpr:1,touch:false,mobile:false,effectiveType:'4g'};

test('the RTX 5070 desktop starts at Ultra',()=>{
 assert.equal(classifyGpu(RTX5070).preset,'ultra');
 const c=choosePreset({...desktop,gpu:RTX5070});
 assert.equal(c.preset,'ultra');assert.match(c.reason,/RTX 5070/);
 assert.equal(shortGpu(RTX5070),'NVIDIA GeForce RTX 5070');
 for(const g of ['NVIDIA GeForce RTX 4080','NVIDIA GeForce RTX 3070 Laptop GPU','AMD Radeon RX 7900 XTX','AMD Radeon RX 9070 XT'])assert.equal(classifyGpu(g).preset,'ultra',g);
 for(const g of ['NVIDIA GeForce RTX 4060','NVIDIA GeForce RTX 2080 SUPER','NVIDIA GeForce GTX 1080','AMD Radeon RX 6600'])assert.equal(classifyGpu(g).preset,'high',g);
});

test('Intel built-in graphics start at Low (UHD) or Medium (Iris Xe)',()=>{
 assert.equal(choosePreset({...office,gpu:UHD}).preset,'low');
 assert.equal(choosePreset({...office,gpu:IRIS}).preset,'medium');
 assert.equal(choosePreset({...office,gpu:'ANGLE (Intel, Intel(R) HD Graphics 520 Direct3D11 vs_5_0 ps_5_0, D3D11)'}).preset,'low');
 assert.equal(choosePreset({...office,gpu:'ANGLE (Intel, Intel(R) Arc(TM) Graphics (0x00007D55) Direct3D11 vs_5_0 ps_5_0, D3D11)'}).preset,'medium');
 assert.equal(choosePreset({...office,gpu:'ANGLE (AMD, AMD Radeon(TM) Graphics (0x00001638) Direct3D11 vs_5_0 ps_5_0, D3D11)'}).preset,'medium');
});

test('phones, low memory, data saver and slow connections start at Low',()=>{
 const pixel7={gpu:'ANGLE (ARM, Mali-G710, OpenGL ES 3.2)',memoryGB:8,cores:8,screen:{w:412,h:915},dpr:2.625,touch:true,mobile:true,effectiveType:'4g'};
 assert.equal(choosePreset(pixel7).preset,'low');
 assert.equal(choosePreset({...pixel7,gpu:'Adreno (TM) 740',mobile:false}).preset,'low','a small touch screen is a phone');
 assert.equal(choosePreset({...desktop,gpu:RTX5070,memoryGB:4}).preset,'low');
 assert.equal(choosePreset({...desktop,gpu:RTX5070,saveData:true}).preset,'low');
 assert.equal(choosePreset({...desktop,gpu:RTX5070,effectiveType:'3g'}).preset,'low');
 assert.equal(choosePreset({...desktop,gpu:RTX5070,cores:4}).preset,'medium');
 assert.equal(choosePreset({...desktop,gpu:'Google SwiftShader'}).preset,'low');
 const unknown=choosePreset({...desktop,gpu:''});assert.equal(unknown.preset,'medium');assert.match(unknown.reason,/not reported/);
});

test('High is the look the map had before presets, and the presets rise in cost',()=>{
 const h=PRESETS.high;
 assert.equal(pixelRatioFor('high',2),1.5);assert.deepEqual(h.fog,[14000,60000]);assert.equal(h.far,200000);
 assert.deepEqual(h.imagery,[2,17]);assert.equal(h.rain.count,9000);assert.equal(h.rain.column,1500);assert.equal(canvasRatio('high',3),2);
 assert.deepEqual(lodsFor('high',LODS),LODS.map(l=>({...l})));
 for(let i=1;i<PRESET_NAMES.length;i++){const a=PRESETS[PRESET_NAMES[i-1]],b=PRESETS[PRESET_NAMES[i]];
  assert.ok(b.rain.count>a.rain.count&&b.fog[1]>a.fog[1]&&b.reach>=a.reach&&b.paint[0]>=a.paint[0]&&b.canvas>=a.canvas,PRESET_NAMES[i]);}
 assert.equal(PRESETS.high.hand,1600);assert.equal(PRESETS.ultra.hand,3200);assert.match(read('preview/geo3d/src/world/main.js'),/handPx:G\.hand/);
 assert.equal(PRESETS.low.antialias,false);assert.equal(PRESETS.ultra.antialias,true);
});

test('Ultra draws at the full screen sharpness and Low at one pixel per screen pixel',()=>{
 assert.equal(pixelRatioFor('ultra',1,{w:1920,h:1080}),1.5,'a standard screen is drawn finer still');
 assert.equal(pixelRatioFor('ultra',2,{w:1512,h:982}),2);
 assert.ok(pixelRatioFor('ultra',3,{w:3840,h:2160})*3840*2160<=14e6*1.01*1,'kept within the pixel budget');
 assert.equal(pixelRatioFor('low',2.625),1);assert.equal(canvasRatio('low',2.625),1);assert.equal(canvasRatio('ultra',2),2);
});

test('detail levels keep their switching rules at every preset',()=>{
 for(const name of PRESET_NAMES){const lods=lodsFor(name,LODS);
  assert.equal(lods.length,LODS.length);assert.equal(lods.at(-1).reach,Infinity);
  assert.equal(lodFor(0,null,lods),0);assert.equal(lodFor(1e6,null,lods),lods.length-1);
  assert.ok(lods.every((l,i)=>i===0||l.n<=lods[i-1].n&&l.px<=lods[i-1].px),name);
  assert.ok(lods.every(l=>l.n<=100),'no finer than the 10 m lidar samples');}
 assert.ok(lodsFor('ultra',LODS)[0].reach>LODS[0].reach&&lodsFor('low',LODS)[0].reach<LODS[0].reach);
});

test('a choice is kept per device, and slow frames lower only an automatic one',()=>{
 const ua=globalThis.navigator?.userAgent??'';
 const auto={preset:'ultra',reason:'NVIDIA RTX 5070',ua};
 assert.equal(resolve({choice:'auto',auto}).preset,'ultra');
 assert.equal(resolve({choice:'auto',auto,cap:'high'}).preset,'high');
 assert.equal(resolve({choice:'low',auto,cap:'high'}).preset,'low','a hand choice wins');
 assert.equal(resolve({choice:'ultra',auto:{...auto,preset:'low'}}).preset,'ultra');
 let detected=0;const r=resolve({choice:'auto',auto:{...auto,ua:'another browser'}},()=>{detected++;return{...office,gpu:UHD};});
 assert.equal(detected,1,'a different browser is detected again');assert.equal(r.preset,'low');
 assert.deepEqual([stepDown('ultra'),stepDown('medium'),stepDown('low')],['high','low','low']);
});

test('only sustained slow frames count, not a single hitch or the first seconds',()=>{
 const w=createFrameWatch();w.reset(0);let t=0,fired=false;
 for(;t<8000;t+=50)fired||=w.add(50,t);assert.equal(fired,false,'settling time is not measured');
 for(;t<20000;t+=16){fired||=w.add(t%1000<16?400:16,t);}assert.equal(fired,false,'a hitch a second is not slow');
 for(;t<33000;t+=50)fired||=w.add(50,t);assert.equal(fired,true,'20 frames a second for 12 s is slow');
});

test('presets reach every drawing surface, through one shared setting',()=>{
 assert.doesNotMatch(read('preview/geo3d/src/world/main.js'),/Math\.min\(devicePixelRatio,1\.5\)/);
 assert.match(read('preview/geo3d/src/world/main.js'),/antialias:G\.antialias/);
 for(const f of ['simulation/sim-2d.js','street-map.js','sim-panels.js'])assert.match(read(f),/canvasRatio\(\)/,f);
 assert.match(read('preview/geo3d/src/world/embed.js'),/fp3d==='graphics'/);
 assert.match(read('map-app.js'),/name="mapp-gfx"/);
 assert.match(read('map-app.js'),/world\.send\('graphics'/);
 assert.match(read('preview/geo3d/src/world/graphics-3d.js'),/kind:'info'|log\(/);
 assert.match(read('diagnostics.js'),/kind==='info'\?'info'/);
});
