import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
test('forecast UI defaults off and renders recorded official engine output',async()=>{
 const html=readFileSync(new URL('../public/simulation/forecast.html',import.meta.url),'utf8');
 const elements=Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(m=>[m[1],{textContent:'',innerHTML:'',checked:false,children:[],replaceChildren(){this.children=[];},append(child){this.children.push(child);}}]));
 const oldDoc=globalThis.document,oldFetch=globalThis.fetch;let requests=0;
 globalThis.document={createElement:()=>({textContent:''}),getElementById:id=>{assert.ok(elements[id]);return elements[id];}};
 globalThis.fetch=async url=>{requests++;assert.ok(url.startsWith('./data/'));return{ok:true,json:async()=>JSON.parse(readFileSync(new URL('../public/simulation/'+url,import.meta.url),'utf8'))};};
 try{
  await import('../public/simulation/forecast-app.js');assert.equal(requests,0);
  await elements.refresh.onclick();assert.match(elements['forecast-status'].textContent,/disabled/);assert.equal(requests,0);
  await elements.recorded.onclick();assert.equal(requests,3);assert.match(elements['forecast-status'].textContent,/RECORDED REPLAY/);assert.match(elements['forecast-summary'].textContent,/Forecast peak/);assert.match(elements['forecast-summary'].textContent,/Accuracy ± unavailable/);assert.match(elements['forecast-chart'].innerHTML,/<path/);assert.equal(elements['forecast-download'].disabled,false);
  await elements['ensemble-recorded'].onclick();assert.equal(requests,5);assert.match(elements['ensemble-status'].textContent,/RECORDED REPLAY/);assert.match(elements['ensemble-context'].textContent,/90% exceedance/);assert.match(elements['ensemble-chart'].innerHTML,/<circle/);
  elements.station.value='BWTA3';elements.station.onchange();assert.equal(elements['forecast-chart'].innerHTML,'');await elements.recorded.onclick();assert.match(elements['forecast-status'].textContent,/Brawley/);await elements['ensemble-recorded'].onclick();assert.match(elements['ensemble-status'].textContent,/Trico only/);
  const immediateFetch=globalThis.fetch;let release;const gate=new Promise(resolve=>{release=resolve;});globalThis.fetch=async url=>{await gate;return immediateFetch(url);};elements.station.value='SCTA3';const pending=elements.recorded.onclick();elements.station.value='BWTA3';elements.station.onchange();release();await pending;assert.match(elements['forecast-status'].textContent,/BWTA3/);assert.equal(elements['forecast-chart'].innerHTML,'');
 }finally{globalThis.document=oldDoc;globalThis.fetch=oldFetch;}
});
