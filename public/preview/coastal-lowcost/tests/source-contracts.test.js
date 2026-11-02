import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PRESETS,resolveTrial} from '../src/trial-config.js';
const source=path=>readFile(new URL(`../src/${path}`,import.meta.url),'utf8');

test('controlled presets use identical render spacing, publication, timestep and pixel budget',()=>{
 for(const id of Object.keys(PRESETS)){
  const p=resolveTrial(`?preset=${id}`);
  assert.equal(p.renderSpacing,.3);assert.equal(p.publishHz,20);assert.equal(p.dt,1/60);
  assert.equal(p.interpolationDelay,.06);assert.equal(p.dprCap,.75);
  assert.equal(p.bufferLong,1280);assert.equal(p.bufferShort,720);
  assert.equal(p.useWasm,false);assert.equal(p.useBakedState,false);
 }
});
test('page/worker dimensions stay coupled while visible geometry is independent',async()=>{
 const main=await source('main.js'),world=await source('world.js');
 assert.match(main,/workerURL\.searchParams\.set\('preset',TRIAL\.id\)/);
 assert.match(main,/Float32Array\(GRID\.nx\*GRID\.nz\*4\)/);
 assert.match(main,/Worker packet\/grid mismatch/);
 assert.doesNotMatch(world,/axis\([^\n]*GRID\.d[xyz]/);
 assert.match(world,/axis\(GRID\.x0,58,TRIAL\.renderSpacing/);
 assert.match(world,/axis\(GRID\.z0,28,TRIAL\.renderSpacing/);
 assert.match(main,/const cap=Math\.min\(devicePixelRatio,TRIAL\.dprCap,\(landscape\?TRIAL\.bufferLong:TRIAL\.bufferShort\)\/w,\(landscape\?TRIAL\.bufferShort:TRIAL\.bufferLong\)\/h\)/);
 for(const text of [main,world])for(const line of text.split('\n'))if(line.includes('shaders.mirror.'))assert.ok(line.includes('if(shaders.mirror)'),`unguarded optional reflector: ${line}`);
});
test('continuous texture/temporal interpolation remains enabled',async()=>{
 const main=await source('main.js'),shading=await source('shading.js');
 assert.match(main,/t\.minFilter=t\.magFilter=THREE\.LinearFilter/);
 assert.match(main,/renderClock\+=actualMs\/1000/);
 assert.match(main,/shaders\.U\.alpha\.value=alpha/);
 assert.match(shading,/const field=.*mix\(pairs\[key\]\[0\].*pairs\[key\]\[1\].*U\.alpha/);
});
test('cheap branch omits reflector creation and mirror sample graph, retains sky, refraction, foam and fine normals',async()=>{
 const s=await source('shading.js');
 assert.match(s,/const mirror=TRIAL\.effects==='original'\?reflector\([^\n]*:null/);
 const branch=s.slice(s.indexOf('if(mirror){'),s.indexOf('const sunGlint='));
 assert.match(branch,/mirror\.sample/);assert.match(branch,/mirror\.getDepthNode/);
 assert.match(s,/let reflectionColor=sky\(reflectionDirection,float\(0\)\)/);
 assert.match(s,/viewportTexture\(/);assert.match(s,/const foam=/);assert.match(s,/const micro=/);
});
