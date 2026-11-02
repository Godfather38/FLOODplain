import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {mountRoadReplay} from '../public/simulation/road-replay.js';
import {mountFloodLayers} from '../public/simulation/map-layers.js';

function environment(url) {
 const dom=new JSDOM('<body><header class="appbar"></header><main><div id="map"></div><div id="screen"></div></main></body>',{url,pretendToBeVisual:true});
 const saved=new Map(),set=(key,value)=>{saved.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});};
 for(const name of ['window','document','location','Event','CustomEvent','Node','MutationObserver'])set(name,dom.window[name]);
 set('innerWidth',390);set('requestAnimationFrame',fn=>setTimeout(fn,0));set('setInterval',()=>0);set('clearInterval',()=>{});
 const requests=[];set('fetch',async input=>{requests.push(String(input));return new Response(readFileSync(new URL(input)));});
 const layers=new Set(),panes={},handlers=new Map(),bounds={getWest:()=>-111.3,getEast:()=>-111.29,getSouth:()=>32.39,getNorth:()=>32.4};
 const map={getBounds:()=>bounds,getZoom:()=>16,getCenter:()=>({lat:32.39322,lng:-111.29459}),getPane:n=>panes[n],createPane:n=>(panes[n]={style:{}}),
  invalidateSize(){},whenReady(fn){fn();},on(name,fn){handlers.set(name,fn);return this;},off(name){handlers.delete(name);},
  addLayer(l){layers.add(l);},removeLayer(l){layers.delete(l);},hasLayer:l=>layers.has(l),closePopup(){},setView(){},fitBounds(){},zoomIn(){},zoomOut(){},locate(){}};
 function shape(){return{bindTooltip(){return this;},bindPopup(){return this;},addTo(group){group.items?.push(this);return this;}};}
 const group=()=>({items:[],addTo(){return this;},clearLayers(){this.items=[];},addLayer(){},getLayers(){return this.items;}});
 set('L',{layerGroup:group,canvas:()=>({}),polyline:shape,circleMarker:shape,tileLayer:()=>({}),control:{layers:()=>({addTo(){}})}});
 return {dom,map,requests,routeLayer:group(),restore(){dom.window.dispatchEvent(new dom.window.Event('pagehide'));dom.window.close();for(const[k,d]of saved){if(d)Object.defineProperty(globalThis,k,d);else delete globalThis[k];}}};
}
async function ready(state){for(let n=0;n<200;n++){if(state.snapshot().status==='ready')return;if(state.snapshot().status==='error')throw Error(state.snapshot().error);await new Promise(r=>setTimeout(r,10));}throw Error('Road replay did not become ready');}
test('moved road slider remains wired after hidden live-panel insertion; repeated flows retain exact time',async()=>{
 const e=environment('https://app.invalid/?case=roads#/map');
 try{
  const view=mountRoadReplay(e.map,{routeLayer:e.routeLayer});
  const slider=document.querySelector('.map-dock input[data-time]');assert.ok(slider);
  // Reproduce mountLiveMap adding its similarly named control inside the original host.
  const panel=document.createElement('section');panel.className='embedded-live';panel.innerHTML='<select data-time><option value="live">Live forecast</option></select>';
  document.querySelector('[data-panel-content=options]').append(panel);
  await ready(view.sharedState);
  assert.equal(slider.disabled,false);assert.equal(slider.value,'20');assert.equal(panel.querySelector('select').value,'live');
  slider.value='0';slider.dispatchEvent(new Event('input'));slider.value='56';slider.dispatchEvent(new Event('input'));await ready(view.sharedState);
  assert.equal(view.sharedState.snapshot().displayed.time,'2026-11-02T07:00:00Z');assert.equal(slider.value,'56');
  const hide=new Event('pagehide');Object.defineProperty(hide,'persisted',{value:true});window.dispatchEvent(hide);const show=new Event('pageshow');Object.defineProperty(show,'persisted',{value:true});window.dispatchEvent(show);await ready(view.sharedState);assert.equal(view.sharedState.snapshot().displayed.index,56);
  assert.equal(document.querySelector('[data-next]').disabled,true);assert.equal(document.querySelector('[data-3d]').disabled,true);
  const model=document.querySelector('[data-model]');model.value='off';model.dispatchEvent(new Event('change'));assert.equal(view.sharedState.snapshot().displayed,null);
  model.value='2d';model.dispatchEvent(new Event('change'));await ready(view.sharedState);assert.equal(view.sharedState.snapshot().displayed.index,56);
  const live=new URL(document.querySelector('[data-return-live]').href);assert.equal(live.searchParams.has('case'),false);assert.equal(live.searchParams.get('live'),'1');
  assert.ok(!e.requests.some(p=>/current-sfincs|frozen-20261101|geometry.bin|frame-\d+\.bin|renderer-chunks/.test(p)));
 }finally{e.restore();}
});
test('fresh ordinary map entry is live-first and makes no frozen model or road requests',async()=>{
 const e=environment('https://app.invalid/#/map');
 try{
  mountFloodLayers(e.map,{routeLayer:e.routeLayer,streetTiles:{}});await new Promise(r=>setTimeout(r,20));
  assert.equal(document.querySelector('[data-model]').value,'off');assert.equal(e.requests.length,0);
  assert.equal(document.querySelector('.source-age').hidden,true);assert.ok(document.querySelector('.road-replay-open').href.includes('case=roads'));
  assert.equal(document.body.classList.contains('road-replay-active'),false);
 }finally{e.restore();}
});
