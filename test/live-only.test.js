// Frozen model runs never go into the published app. See docs/LIVE-DATA-ONLY.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {cpSync,existsSync,mkdtempSync,readFileSync,rmSync,writeFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const read=p=>readFileSync(new URL('../public/'+p,import.meta.url),'utf8');
const script=new URL('../tools/prune-published.mjs',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1');

test('opening the map cannot start a frozen run',()=>{
 const layers=read('simulation/map-layers.js');
 assert.match(layers,/async function enterMap\(\)\{notifyRender\(\{status:'off'/);
 assert.match(layers,/let caseChoice='frozen'/);
 assert.doesNotMatch(layers,/selectedMapCase\(location/);
 assert.doesNotMatch(layers,/<option value="2d">|<option value="aggregate">|<option value="refined"><\/option>/);
 assert.match(layers,/<div class="flood-row" hidden><label>Case/);
});
test('the map shell offers no frozen outlook or time browsing',()=>{
 const shell=read('simulation/map-shell.js');
 assert.doesNotMatch(shell,/home-outlook|data-panel="time"/);
 assert.match(shell,/age\.hidden=true/);
});
test('no saved model water reaches bridges or the live panel',()=>{
 assert.doesNotMatch(read('simulation/bridge-evidence.js'),/current-sfincs-manifest/);
 assert.doesNotMatch(read('live-map.js'),/current-sfincs-manifest/);
});
test('the deploy step removes frozen data and keeps reference data',()=>{
 const dir=mkdtempSync(join(tmpdir(),'publish-'));
 try{
  mkdirSync(join(dir,'simulation/data/refined-full-1'),{recursive:true});mkdirSync(join(dir,'simulation/preview'));mkdirSync(join(dir,'ux-preview'));
  for(const f of ['simulation/data/frozen-map.json','simulation/data/refined-full-1/frame-0.bin.gz','simulation/data/bridge-evidence-registry.json','simulation/data/route-tracking.json','simulation/preview/x.png','simulation/map-layers.js'])writeFileSync(join(dir,f),'x');
  execFileSync(process.execPath,[script,dir]);
  assert.ok(!existsSync(join(dir,'simulation/data/frozen-map.json')));
  assert.ok(!existsSync(join(dir,'simulation/data/refined-full-1')));
  assert.ok(!existsSync(join(dir,'simulation/preview')));
  assert.ok(existsSync(join(dir,'simulation/data/bridge-evidence-registry.json')));
  assert.ok(existsSync(join(dir,'simulation/map-layers.js')));
 }finally{rmSync(dir,{recursive:true,force:true})}
});
test('the real public folder passes the deploy check',()=>{
 const dir=mkdtempSync(join(tmpdir(),'publish-real-'));
 try{cpSync(new URL('../public',import.meta.url),dir,{recursive:true});execFileSync(process.execPath,[script,dir],{stdio:'pipe'})}
 finally{rmSync(dir,{recursive:true,force:true})}
});
test('the deploy runs the check and the rule is written down',()=>{
 const repo=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
 assert.match(repo('.github/workflows/pages.yml'),/node tools\/prune-published\.mjs public/);
 for(const f of ['CLAUDE.md','README.md','docs/LIVE-DATA-ONLY.md'])assert.match(repo(f),/NEVER go into the published app/,f);
});
