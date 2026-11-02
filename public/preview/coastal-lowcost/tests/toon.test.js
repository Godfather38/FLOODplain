import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PRESETS,resolveTrial} from '../src/trial-config.js';

test('toon is additive: existing preset definitions and default remain unchanged',()=>{
 const expected={
  baseline:{label:'A · Original physics / original effects',physics:'original',effects:'original'},
  'original-cheap':{label:'B · Original physics / cheap effects',physics:'original',effects:'cheap'},
  'tiny-original':{label:'C · Tiny physics / original effects',physics:'tiny',effects:'original'},
  'tiny-cheap':{label:'D · Tiny physics / cheap effects',physics:'tiny',effects:'cheap'},
  'small-cheap':{label:'E · Small physics / cheap effects',physics:'small',effects:'cheap'},
 };
 for(const [id,preset] of Object.entries(expected))assert.deepEqual(PRESETS[id],preset);
 assert.equal(resolveTrial('').id,'tiny-cheap');
 const toon=resolveTrial('?preset=tiny-toon'),tiny=resolveTrial('?preset=tiny-cheap');
 assert.equal(toon.effects,'toon');assert.equal(toon.grid,tiny.grid);
 for(const key of ['dt','publishHz','interpolationDelay','renderSpacing','dprCap','bufferLong','bufferShort'])assert.equal(toon[key],tiny[key]);
});

test('toon uses an opaque material and returns before refraction/transmission graph creation',async()=>{
 const s=await readFile(new URL('../src/shading.js',import.meta.url),'utf8');
 assert.match(s,/const isToon=TRIAL\.effects==='toon'/);
 assert.match(s,/MeshBasicNodeMaterial\(\{transparent:!isToon,depthWrite:true/);
 const start=s.indexOf('if(isToon){'),end=s.indexOf('const fresnel=',start);
 assert.ok(start>=0&&end>start);
 const branch=s.slice(start,end);
 assert.match(branch,/return vec4\(result,1\)/);
 assert.doesNotMatch(branch,/viewportTexture|viewportDepthTexture|transmission|mirror\.sample|sky\(/);
 assert.match(branch,/surfaceMaterial\.ba/);assert.match(branch,/st\.z/);assert.match(branch,/shoreAccent/);
 assert.ok(s.indexOf('If(st.y.lessThanEqual(0),()=>Discard())')<start);
 assert.ok(s.indexOf('const micro=')<start);
 assert.ok(s.indexOf('viewportDepthTexture(rUV)')>end);
 assert.ok(s.indexOf('const transmission=')>end);
});
