// Saved model runs appear only in Test flood mode. See docs/LIVE-DATA-ONLY.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {cpSync,existsSync,mkdtempSync,readFileSync,rmSync,writeFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {isTestFlood,testFloodHref} from '../public/simulation/test-flood.js';

const read=p=>readFileSync(new URL('../public/'+p,import.meta.url),'utf8');
const repo=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const script=new URL('../tools/prune-published.mjs',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1');

test('only its own link turns Test flood on',()=>{
 assert.equal(isTestFlood('?mode=test-flood'),true);
 for(const s of ['','?case=frozen','?case=refined','?mode=live','?test-flood=1'])assert.equal(isTestFlood(s),false,s);
 assert.equal(testFloodHref('https://x.test/?a=1#/settings'),'https://x.test/?a=1&mode=test-flood#/map');
 assert.equal(testFloodHref('https://x.test/?mode=test-flood&case=refined#/map',false),'https://x.test/#/');
});
test('the live path cannot load a saved run or offer one',()=>{
 const layers=read('simulation/map-layers.js');
 assert.match(layers,/async function enterMap\(\)\{if\(!testFlood\)\{notifyRender\(\{status:'off'/);
 assert.match(layers,/async function load\(\)\{if\(!testFlood\)throw/);
 assert.doesNotMatch(layers,/selectedMapCase\(location/);
 assert.match(layers,/<option value="off">Off - no model water<\/option>\$\{testFlood\?/);
 assert.doesNotMatch(layers,/<option value="aggregate">|<option value="hand">/);
 const shell=read('simulation/map-shell.js');
 assert.doesNotMatch(shell,/home-outlook/);
 assert.match(shell,/testFlood\?'<button data-panel="time">Time<\/button>':''/);
 assert.match(shell,/age\.hidden=!testFlood/);
});
test('the mode never remembers itself and always says what it is',()=>{
 const mode=read('simulation/test-flood.js');
 assert.doesNotMatch(mode,/localStorage|sessionStorage|store\./);
 assert.match(mode,/Not current conditions/);assert.match(mode,/Back to live/);
 const app=read('app.js');
 assert.match(app,/if\(isTestFlood\(\)\)mountTestFloodBanner\(\)/);
 assert.match(app,/testFloodHref\(\)/);
 assert.match(app,/active:w\.screen==='map'&&!isTestFlood\(\)/);
 assert.doesNotMatch(read('logic.js')+read('engine.js'),/isTestFlood|test-flood/);
});
test('no saved model water reaches bridges or the live panel',()=>{
 assert.doesNotMatch(read('simulation/bridge-evidence.js'),/current-sfincs-manifest/);
 assert.doesNotMatch(read('live-map.js'),/current-sfincs-manifest/);
});
test('the deploy keeps the Test flood package and removes other model data',()=>{
 const dir=mkdtempSync(join(tmpdir(),'publish-'));
 try{
  mkdirSync(join(dir,'simulation/data/refined-full-1'),{recursive:true});mkdirSync(join(dir,'simulation/preview'));mkdirSync(join(dir,'ux-preview'));
  for(const f of ['simulation/data/frozen-map-context.json','simulation/data/water-footprints-3.json.gz','simulation/data/frozen-other.json','simulation/data/sfincs-current-x.json.gz','simulation/data/refined-full-1/frame-0.bin.gz','simulation/data/bridge-evidence-registry.json','simulation/data/route-tracking.json','simulation/preview/x.png','simulation/map-layers.js'])writeFileSync(join(dir,f),'x');
  execFileSync(process.execPath,[script,dir]);
  for(const f of ['frozen-map-context.json','water-footprints-3.json.gz','bridge-evidence-registry.json','route-tracking.json'])assert.ok(existsSync(join(dir,'simulation/data',f)),f);
  for(const f of ['frozen-other.json','sfincs-current-x.json.gz','refined-full-1'])assert.ok(!existsSync(join(dir,'simulation/data',f)),f);
  assert.ok(!existsSync(join(dir,'simulation/preview')));
  assert.ok(existsSync(join(dir,'simulation/map-layers.js')));
 }finally{rmSync(dir,{recursive:true,force:true})}
});
test('the deploy fails on model data somewhere else',()=>{
 const dir=mkdtempSync(join(tmpdir(),'publish-bad-'));
 try{
  mkdirSync(join(dir,'stray'));writeFileSync(join(dir,'stray/frozen-run.json'),'x');
  assert.throws(()=>execFileSync(process.execPath,[script,dir],{stdio:'pipe'}));
 }finally{rmSync(dir,{recursive:true,force:true})}
});
test('the real public folder passes the deploy check',()=>{
 const dir=mkdtempSync(join(tmpdir(),'publish-real-'));
 try{cpSync(new URL('../public',import.meta.url),dir,{recursive:true});execFileSync(process.execPath,[script,dir],{stdio:'pipe'})}
 finally{rmSync(dir,{recursive:true,force:true})}
});
test('the deploy runs the check and the rule is written down',()=>{
 assert.match(repo('.github/workflows/pages.yml'),/node tools\/prune-published\.mjs public/);
 for(const f of ['CLAUDE.md','README.md','docs/LIVE-DATA-ONLY.md'])assert.match(repo(f),/Saved model runs NEVER appear in the live app/,f);
});
