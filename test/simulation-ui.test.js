// DOM contract test, not browser/visual validation. No external requests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
test('lab loads recorded inputs, reruns, clears rejected imports, and restores demo',async()=>{
 const html=readFileSync(new URL('../public/simulation/index.html',import.meta.url),'utf8');
 const canvas=new Proxy({}, {get:()=>()=>{},set:()=>true});
 const element=()=>({value:'',textContent:'',innerHTML:'',disabled:false,children:[],replaceChildren(...xs){this.children=xs;this.innerHTML='';},append(...xs){this.children.push(...xs);},getContext:()=>canvas});
 const elements=Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(m=>[m[1],element()]));
 Object.assign(elements.infiltration,{value:'10'});elements.travel.value='8';elements.multiplier.value='1';elements.time.value='30';elements.layer.value='elevation';elements.layer.selectedOptions=[{text:'Elevation (m)'}];
 const oldDocument=globalThis.document,oldFetch=globalThis.fetch;
 globalThis.document={getElementById:id=>{assert.ok(elements[id],`HTML missing ${id}`);return elements[id];},createElement:element};
 const requested=[];
 globalThis.fetch=async url=>{requested.push(url);assert.ok(['./data/terrain.json','./data/usgs-trico-2014-candidate.json'].includes(url));return{ok:true,json:async()=>JSON.parse(readFileSync(new URL('../public/simulation/'+url,import.meta.url),'utf8'))};};
 try {
  await import('../public/simulation/app.js');
  assert.equal(requested.length,2);assert.match(elements.status.textContent,/SYNTHETIC/);assert.match(elements.gaugeStatus?.textContent??elements['gauge-status'].textContent,/193 recorded samples/);assert.equal(elements.metrics.children.length,3);assert.ok(elements.chart.innerHTML.includes('<path'));assert.equal(elements.download.disabled,false);
  assert.match(elements['terrain-quality'].textContent,/not a delineated basin/);assert.match(elements['terrain-quality'].textContent,/truncated/);assert.match(html,/Real radar fixtures validated/);
  elements.multiplier.value='0';elements.run.onclick();assert.match(elements.metrics.children[0].children[0].textContent,/^0 /);
  elements.file.files=[{size:5,text:async()=>'{bad'}];await elements.file.onchange();assert.match(elements.status.textContent,/Import failed/);assert.equal(elements.metrics.children.length,0);assert.equal(elements.download.disabled,true);
  elements.demo.onclick();assert.match(elements.status.textContent,/SYNTHETIC/);assert.equal(elements.download.disabled,false);
  elements.travel.value='0';elements.run.onclick();assert.match(elements.status.textContent,/Cannot run/);assert.equal(elements.chart.innerHTML,'');
 } finally {globalThis.document=oldDocument;globalThis.fetch=oldFetch;}
});
