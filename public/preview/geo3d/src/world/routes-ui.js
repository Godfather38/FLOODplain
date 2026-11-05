// The 2D layer of the 3D map, built from the app's own parts (style.css): the same Avra Valley /
// Picture Rocks switch, its routes as list rows, drop pins for the crossings on the safety screen,
// and a card for each crossing that puts the road's height next to the model's water height.
import * as THREE from 'three/webgpu';
import {crossingStory,quadStory,statusAt,COVER_M} from './crossing-story.js';
const FT=3.28084,ft=m=>m==null?'—':`${(m*FT).toFixed(1)} ft`,el=(tag,cls,html)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(html!=null)e.innerHTML=html;return e;};
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const GLYPH={dip:'⌄',flat:'⌄',road:'⌄',bridge:'⌒',river:'≈'};
// Status colours are the app's: s1 low, s3 caution, s5 danger, sq no reading.
const TONE={over:'danger',clear:'ok',unmeasured:'none',unknown:'none',outside:'none'};
const WORD={1:'Low',2:'Minor',3:'Moderate',4:'High',5:'Severe'};
const STATUS={over:'Water over the road',clear:'Road above the water',unmeasured:'Deck height not measured',unknown:'No model level here this hour',outside:'Outside the model area'};
export function createRoutesUI({root,panelRoot,camera,config,routes,roads,world,inside,ground,E,appHref,flyTo,onRoutes}){
 const {AREAS,ROUTE_INFO,FAILURE_POINTS}=config;
 let area=AREAS[0].id,route=null,run=null,frameIndex=0,stories=new Map(),openId=null,roadWater=new Map(),live=null;
 // --- side panel: area switch, route list, and the crossing card in place of the list ---
 const tabs=el('div','seg');tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','Area');
 for(const a of AREAS){const b=el('button',null,esc(a.name));b.dataset.area=a.id;b.setAttribute('role','tab');b.onclick=()=>select(a.id,null);tabs.appendChild(b);}
 const listView=el('div'),list=el('div','list');listView.append(el('h3','section','Routes'),list);
 const sheet=el('div','crossing-view');sheet.hidden=true;sheet.setAttribute('aria-live','polite');
 panelRoot.append(tabs,listView,sheet);
 // --- pins on the map ---
 const pinLayer=el('div','pins');root.appendChild(pinLayer);
 const pins=FAILURE_POINTS.map(fp=>{const b=el('button','drop-pin',`<span class="glyph">${GLYPH[fp.kind]??'•'}</span>`);b.title=fp.name;b.setAttribute('aria-label',fp.name);b.onclick=()=>{openDetail(fp.id);reveal();};pinLayer.appendChild(b);return{fp,b,pos:new THREE.Vector3()};});
 // On a phone the card sits under the map: bring it into view after a tap on the map.
 const reveal=()=>{if(matchMedia('(max-width: 899px)').matches)sheet.scrollIntoView({behavior:'smooth',block:'start'});};
 function select(nextArea,nextRoute){
  area=nextArea;route=nextRoute;
  for(const b of tabs.children)b.setAttribute('aria-selected',String(b.dataset.area===area));
  const ids=routes.features.filter(f=>f.properties.area===area).map(f=>f.properties.id);
  list.innerHTML='';
  for(const id of ids){
   const info=ROUTE_INFO[id]??{name:id},f=routes.features.find(r=>r.properties.id===id),points=FAILURE_POINTS.filter(fp=>fp.routes.includes(id));
   const b=el('button','row route',`<span class="dot" data-route-dot="${id}"></span><span class="text"><span class="t">${esc(info.name)}</span><span class="st">${esc(info.via??'')} · ${f.properties.km} km · ${points.length} crossing${points.length===1?'':'s'}</span><span class="st status" data-route="${id}"></span></span><span class="badge" data-route-badge="${id}" hidden></span><span class="chev">›</span>`);b.setAttribute('aria-pressed',String(route===id));
   b.onclick=()=>{select(area,route===id?null:id);if(route)flyTo(...routeCentre(f),routeSpan(f));};list.appendChild(b);
  }
  onRoutes?.(area,route);refreshCounts();showLive();
 }
 const routePoints=f=>(f.geometry.type==='MultiLineString'?f.geometry.coordinates.flat():f.geometry.coordinates).map(([lon,lat])=>world(lon,lat));
 const routeCentre=f=>{const p=routePoints(f);return[p.reduce((s,q)=>s+q[0],0)/p.length,p.reduce((s,q)=>s+q[1],0)/p.length];};
 const routeSpan=f=>{const p=routePoints(f),xs=p.map(q=>q[0]),zs=p.map(q=>q[1]);return Math.max(2500,Math.hypot(Math.max(...xs)-Math.min(...xs),Math.max(...zs)-Math.min(...zs))*1.1);};
 // Road under model water, per route and hour: the road-height stations every 5 m (lidar road
 // surface, bridge decks at deck height) where the model has a cell, against the model level there.
 const samples=new Map(routes.features.map(f=>[f.properties.id,(roads?.stations??[]).filter(s=>s.route===f.properties.id&&inside(s.x,s.z)).map(s=>[s.x,s.z,s.m])]));
 // The all-route run has exact values at its route points only, so it counts crossings, not road length.
 function measureRoads(){if(run.quad){roadWater=new Map();return;}roadWater=new Map([...samples].map(([id,pts])=>[id,run.samplers.map(s=>{let wet=0,deep=0;for(const [x,z,g] of pts){const d=s(x,z)-g;if(d>.15)wet++;if(d>.5)deep++;}return{wet:wet*5/1000,deep:deep*5/1000};})]));}
 const km=v=>v>=1?v.toFixed(1)+' km':Math.round(v*1000/10)*10+' m';
 // Live ratings, as the app shows them: a number 1-5 on each pin and route.
 function showLive(){
  for(const p of pins){const s=live?live.scores[p.fp.id]:undefined;if(live)p.b.dataset.score=String(s??'q');else delete p.b.dataset.score;p.b.querySelector('.glyph').textContent=live?String(s??'?'):(GLYPH[p.fp.kind]??'•');}
  for(const b of list.querySelectorAll('[data-route-badge]')){const s=live?.routes[b.dataset.routeBadge];b.hidden=!live;b.className='badge '+(s?'s'+s:'sq');b.textContent=s??'?';b.title=s?WORD[s]+' risk now':'';}
 }
 function setLive(next){live=next;showLive();if(openId)renderDetail();}
 function refreshCounts(){
  for(const em of list.querySelectorAll('[data-route]')){
   const points=FAILURE_POINTS.filter(fp=>fp.routes.includes(em.dataset.route)),over=points.filter(fp=>stories.get(fp.id)&&statusAt(stories.get(fp.id),frameIndex)==='over').length,modelled=points.filter(fp=>stories.get(fp.id)?.inside).length;
   const road=roadWater.get(em.dataset.route)?.[frameIndex],wet=road&&road.wet>=.05;
   const parts=[];if(over)parts.push(`${over} crossing${over===1?'':'s'} with water over the road`);if(wet)parts.push(`${km(road.wet)} of road under model water${road.deep>=.05?`, ${km(road.deep)} of it over 1.6 ft deep`:""}`);
   const when=run?.quad?' this frame':' this hour';
   em.textContent=!modelled&&(run?.quad||!samples.get(em.dataset.route)?.length)?'Outside the model area':parts.length?parts.join(' · ')+when:run?.quad?'No crossing with model water over the road'+when:'No model water over the road this hour';
   em.classList.toggle('warn',!!(over||wet));
   list.querySelector(`[data-route-dot="${em.dataset.route}"]`).className='dot '+(over?'danger':wet?'caution':modelled||samples.get(em.dataset.route)?.length?'ok':'');
  }
 }
 function setRun(nextRun){
  run=nextRun;measureRoads();
  const own=fp=>(a,b)=>Number(b.routes.includes(fp.routes[0]))-Number(a.routes.includes(fp.routes[0]));
  stories=new Map(FAILURE_POINTS.map(fp=>[fp.id,run.quad?quadStory(fp,{world,roads,series:run.quad.pointSeries(fp.id).sort(own(fp)),iso:run.quad.iso}):crossingStory(fp,{world,ground,inside,frames:run.frames,samplers:run.samplers,measured:run.measured,roads})]));
  if(openId)openDetail(openId);
 }
 function setFrame(i){
  frameIndex=i;
  for(const p of pins){const s=stories.get(p.fp.id);p.b.dataset.status=s?statusAt(s,i):'outside';}
  refreshCounts();if(openId)renderDetail();
 }
 function chart(story){
  // Water level over the run against the road, in feet above the lowest value shown.
  const vals=[...story.hours.map(h=>h.dry?null:h.water).filter(v=>v!=null),story.road.m,story.groundM].filter(v=>v!=null&&Number.isFinite(v));
  if(!vals.length)return'';
  const lo=Math.min(...vals)-.3,hi=Math.max(...vals)+.3,W=300,H=120,x=i=>8+i/(story.hours.length-1)*(W-16),y=v=>H-8-(v-lo)/(hi-lo)*(H-16);
  const line=story.hours.map((h,i)=>h.water==null||h.dry?null:`${x(i).toFixed(1)},${y(h.water).toFixed(1)}`),segments=[];let cur=[];
  for(const p of line){if(p)cur.push(p);else if(cur.length){segments.push(cur);cur=[];}}if(cur.length)segments.push(cur);
  const road=story.road.m!=null?`<line class="road" x1="8" x2="${W-8}" y1="${y(story.road.m)}" y2="${y(story.road.m)}"/>`:'';
  return`<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Model water level by hour against the road height">
   ${story.groundM!=null?`<line class="ground" x1="8" x2="${W-8}" y1="${y(story.groundM)}" y2="${y(story.groundM)}"/>`:''}${road}
   ${segments.map(s=>`<polyline class="water" points="${s.join(' ')}"/>`).join('')}
   <line class="now" x1="${x(frameIndex)}" x2="${x(frameIndex)}" y1="4" y2="${H-4}"/></svg>
   <div class="chart-key"><span class="k water">Model water level</span>${story.road.m!=null?'<span class="k road">Road</span>':''}${story.groundM!=null?'<span class="k ground">Ground (model lidar)</span>':''}</div>`;
 }
 function renderDetail(){
  const fp=FAILURE_POINTS.find(f=>f.id===openId),story=stories.get(openId);
  const routeId=fp.routes[0],hour=story?.hours?.[frameIndex];
  let body;
  if(!story?.inside)body=story?.quad?`<p class="status none"><span class="dot"></span>${STATUS.outside}</p><p>None of the three model areas has a result at this crossing's route point, so the model has nothing to show here: not dry, just not modelled.</p>`:`<p class="status none"><span class="dot"></span>${STATUS.outside}</p><p>The saved SFINCS runs compute about 297 km² of 100 m cells around the Santa Cruz River, Cortaro and Trico. This crossing is not in one of those cells, so the model has nothing to show here: not dry, just not modelled.</p>`;
  else if(story.quad){
   const s=statusAt(story,frameIndex),vs=h=>h.over==null?'—':h.over===-Infinity?'Dry cell':(h.over>=0?'+':'−')+ft(Math.abs(h.over));
   const other=story.others.map(o=>{const h=o.hours[frameIndex];return`<dt>${esc(o.label.split(':')[0])} model area</dt><dd><strong>${h.dry?'Dry cell':h.water==null?'No result':vs(h)}</strong><small>The same spot in a separate model area. Shown beside it, not averaged.</small></dd>`;}).join('');
   body=`<p class="status ${TONE[s]}"><span class="dot ${TONE[s]}"></span>${hour.dry?'No water in the model cell at the road':hour.water==null?'No result for this frame':STATUS[s]}${s==='over'&&!hour.dry?`: ${ft(hour.over)} deep`:''}</p>
   <dl class="heights">
    <dt>Road height</dt><dd><strong>${ft(story.road.m)}</strong> NAVD88<small>${esc(story.road.source)}</small></dd>
    <dt>Model water level now</dt><dd><strong>${hour.water==null||hour.dry?'—':ft(hour.water)}</strong>${hour.water==null||hour.dry?'':' NAVD88'}<small>${hour.dry?'Under 0.03 ft of water in the 6.25 m cell.':hour.water==null?(esc(story.area.split(':')[0])+' has no result for this frame.'):`${ft(hour.depth)} of stored water in the cell (cell average)`}</small></dd>
    <dt>Water vs road now</dt><dd><strong>${vs(hour)}</strong><small>${hour.over==null?'Needs both heights.':hour.over>COVER_M?'Model water is above the road.':hour.over>=0?`Model water is level with the road (within ${ft(COVER_M)}).`:'Model water is below the road.'}</small></dd>
    ${other}
    <dt>Highest model level</dt><dd><strong>${ft(story.peak?.water)}</strong><small>${story.peak?new Date(story.peak.time).toLocaleString('en-US',{timeZone:'America/Phoenix',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})+' MST':'No water in the cell in this run'}${story.coveredHours!=null?` · over the road in ${story.coveredHours} of ${story.hours.length} frames`:''}</small></dd>
   </dl>${chart(story)}
   <p class="fine">Model water is the exact SFINCS water surface in the ${esc(story.area.split(':')[0])} model area's 6.25 m cell at this crossing's route point, from the saved Nov 1 13Z all-route run, not current conditions. ${story.unknownHours?`${story.unknownHours} frame(s) have no result here. `:''}</p>`;
  }
  else{
   const s=statusAt(story,frameIndex);
   body=`<p class="status ${TONE[s]}"><span class="dot ${TONE[s]}"></span>${STATUS[s]}${s==='over'?`: ${ft(hour.over)} deep`:''}</p>
   <dl class="heights">
    <dt>Road height</dt><dd><strong>${ft(story.road.m)}</strong> NAVD88<small>${esc(story.road.source)}</small></dd>
    <dt>Model water level now</dt><dd><strong>${ft(hour.water)}</strong> NAVD88<small>${hour.water==null?'No model level for this hour.':hour.depth>=0?`${ft(hour.depth)} above the ground at the crossing`:`${ft(-hour.depth)} below the ground here: the level of the nearby model cells, not water on this spot`}</small></dd>
    <dt>Water vs road now</dt><dd><strong>${hour.over==null?'—':(hour.over>=0?'+':'−')+ft(Math.abs(hour.over))}</strong><small>${hour.over==null?'Needs both heights.':hour.over>COVER_M?'Model water is above the road.':'Model water is below the road.'}</small></dd>
    <dt>Highest model level</dt><dd><strong>${ft(story.peak?.water)}</strong><small>${story.peak?new Date(story.peak.time).toLocaleString('en-US',{timeZone:'America/Phoenix',month:'short',day:'numeric',hour:'numeric'})+' MST':''}${story.coveredHours!=null?` · over the road in ${story.coveredHours} of ${story.hours.length} hours`:''}</small></dd>
   </dl>${chart(story)}
   <p class="fine">Model water is the SFINCS water surface blended between 100 m model cells, from a saved run, not current conditions. ${story.unknownHours?`${story.unknownHours} hour(s) have no model level here. `:''}</p>`;
  }
  const s=live?live.scores[fp.id]:undefined,now=live?`<div class="live-now"><span class="badge lg ${s?'s'+s:'sq'}">${s??'?'}</span><div><p class="overline">Live rating now</p><strong>${s?WORD[s]:'No rating'}</strong><p class="meta">${esc(live.results[fp.id]?.why??'')}</p></div></div><p class="overline model-head">Model forecast at this crossing</p>`:'';
  sheet.innerHTML=`<button class="back btn btn-text">‹ All routes</button><div class="hero"><p class="overline">${esc({dip:'Dip',flat:'Low road',road:'Road',bridge:'Bridge',river:'River bridge'}[fp.kind]??fp.kind)}</p><h2>${esc(fp.name)}</h2><p class="meta">${esc(fp.where??'')}</p>${now}${body}<div class="actions"><a class="btn btn-primary" href="${appHref(routeId,fp.id)}">Open the safety screen</a></div></div>`;
  sheet.querySelector('.back').onclick=closeDetail;
 }
 function openDetail(id){openId=id;sheet.hidden=false;listView.hidden=true;for(const p of pins)p.b.classList.toggle('open',p.fp.id===id);renderDetail();}
 function closeDetail(){openId=null;sheet.hidden=true;listView.hidden=false;for(const p of pins)p.b.classList.remove('open');}
 const v=new THREE.Vector3();
 function update(){
  const w=root.clientWidth,h=root.clientHeight;
  for(const p of pins){
   const s=stories.get(p.fp.id),[x,z]=world(p.fp.lon,p.fp.lat),g=ground(x,z);
   const show=p.fp.routes.some(r=>routes.features.find(f=>f.properties.id===r)?.properties.area===area)&&(!route||p.fp.routes.includes(route));
   v.set(x,(Number.isFinite(g)?g:0)*E,z);const distance=v.distanceTo(camera.position);v.project(camera);
   const on=show&&v.z<1&&Math.abs(v.x)<1.1&&Math.abs(v.y)<1.1;
   p.b.style.display=on?'':'none';
   if(on){p.b.style.transform=`translate(${(v.x+1)/2*w}px,${(1-v.y)/2*h}px) translate(-50%,-100%) scale(${Math.max(.7,Math.min(1.1,4000/distance))})`;p.b.style.zIndex=String(100000-Math.round(distance));}
  }
 }
 select(area,null);
 return{update,setRun,setFrame,setLive,openDetail,closeDetail,reveal,select,get area(){return area;},get route(){return route;},stories:()=>stories};
}
