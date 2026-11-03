// The 2D layer over the 3D map: the same Avra Valley / Picture Rocks choice as the app, its
// routes, drop pins for the crossings on the safety screen, and a sheet for each crossing that
// puts the road's height next to the model's water height, hour by hour.
import * as THREE from 'three/webgpu';
import {crossingStory,statusAt,COVER_M} from './crossing-story.js';
const FT=3.28084,ft=m=>m==null?'—':`${(m*FT).toFixed(1)} ft`,el=(tag,cls,html)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(html!=null)e.innerHTML=html;return e;};
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const GLYPH={dip:'⌄',flat:'⌄',road:'⌄',bridge:'⌒',river:'≈'};
const STATUS={over:'Water over the road',clear:'Road above the water',unmeasured:'Deck height not measured',unknown:'No model level here this hour',outside:'Outside the model area'};
export function createRoutesUI({root,camera,config,routes,world,inside,ground,E,appHref,flyTo,onRoutes}){
 const {AREAS,ROUTE_INFO,FAILURE_POINTS}=config;
 let area=AREAS[0].id,route=null,run=null,frameIndex=0,stories=new Map(),openId=null,roadWater=new Map();
 // --- panel ---
 const panel=el('aside','routes-panel');panel.setAttribute('aria-label','Routes and crossings');
 const tabs=el('div','segmented');
 for(const a of AREAS){const b=el('button',null,esc(a.name));b.dataset.area=a.id;b.onclick=()=>select(a.id,null);tabs.appendChild(b);}
 const list=el('div','route-list');
 panel.append(el('div','routes-title','Routes'),tabs,list);root.appendChild(panel);
 // --- pins ---
 const pinLayer=el('div','pins');root.appendChild(pinLayer);
 const pins=FAILURE_POINTS.map(fp=>{const b=el('button','pin',`<span class="glyph">${GLYPH[fp.kind]??'•'}</span>`);b.title=fp.name;b.setAttribute('aria-label',fp.name);b.onclick=()=>openDetail(fp.id);pinLayer.appendChild(b);return{fp,b,pos:new THREE.Vector3()};});
 // --- detail sheet ---
 const sheet=el('aside','detail');sheet.hidden=true;sheet.setAttribute('aria-live','polite');root.appendChild(sheet);
 function select(nextArea,nextRoute){
  area=nextArea;route=nextRoute;
  for(const b of tabs.children)b.classList.toggle('on',b.dataset.area===area);
  const ids=routes.features.filter(f=>f.properties.area===area).map(f=>f.properties.id);
  list.innerHTML='';
  for(const id of ids){
   const info=ROUTE_INFO[id]??{name:id},f=routes.features.find(r=>r.properties.id===id),points=FAILURE_POINTS.filter(fp=>fp.routes.includes(id));
   const b=el('button','route'+(route===id?' on':''),`<strong>${esc(info.name)}</strong><span>${esc(info.via??'')} · ${f.properties.km} km · ${points.length} crossing${points.length===1?'':'s'}</span><em data-route="${id}"></em>`);
   b.onclick=()=>{select(area,route===id?null:id);if(route)flyTo(...routeCentre(f),routeSpan(f));};list.appendChild(b);
  }
  onRoutes?.(area,route);refreshCounts();
 }
 const routePoints=f=>(f.geometry.type==='MultiLineString'?f.geometry.coordinates.flat():f.geometry.coordinates).map(([lon,lat])=>world(lon,lat));
 const routeCentre=f=>{const p=routePoints(f);return[p.reduce((s,q)=>s+q[0],0)/p.length,p.reduce((s,q)=>s+q[1],0)/p.length];};
 const routeSpan=f=>{const p=routePoints(f),xs=p.map(q=>q[0]),zs=p.map(q=>q[1]);return Math.max(2500,Math.hypot(Math.max(...xs)-Math.min(...xs),Math.max(...zs)-Math.min(...zs))*1.1);};
 // Road under model water, per route and hour: samples every 10 m where the model has a cell,
 // with the road at the model's lidar ground. Bridge and river crossings are left out (200 m
 // around them), since the ground under a deck is the channel, not the road.
 const spans=FAILURE_POINTS.filter(p=>p.kind==='bridge'||p.kind==='river').map(p=>world(p.lon,p.lat));
 const samples=new Map(routes.features.map(f=>{const out=[];for(const line of f.geometry.type==='MultiLineString'?f.geometry.coordinates:[f.geometry.coordinates]){const p=line.map(([lon,lat])=>world(lon,lat));for(let i=1;i<p.length;i++){const [ax,az]=p[i-1],[bx,bz]=p[i],n=Math.max(1,Math.ceil(Math.hypot(bx-ax,bz-az)/10));for(let k=0;k<n;k++){const x=ax+(bx-ax)*k/n,z=az+(bz-az)*k/n;if(inside(x,z)&&!spans.some(([a,b])=>Math.hypot(a-x,b-z)<200))out.push([x,z,ground(x,z)]);}}}return[f.properties.id,out];}));
 function measureRoads(){roadWater=new Map([...samples].map(([id,pts])=>[id,run.samplers.map(s=>{let wet=0,deep=0;for(const [x,z,g] of pts){const d=s(x,z)-g;if(d>.15)wet++;if(d>.5)deep++;}return{wet:wet/100,deep:deep/100};})]));}
 const km=v=>v>=1?v.toFixed(1)+' km':Math.round(v*1000/10)*10+' m';
 function refreshCounts(){
  for(const em of list.querySelectorAll('em[data-route]')){
   const points=FAILURE_POINTS.filter(fp=>fp.routes.includes(em.dataset.route)),over=points.filter(fp=>stories.get(fp.id)&&statusAt(stories.get(fp.id),frameIndex)==='over').length,modelled=points.filter(fp=>stories.get(fp.id)?.inside).length;
   const road=roadWater.get(em.dataset.route)?.[frameIndex],wet=road&&road.wet>=.05;
   const parts=[];if(over)parts.push(`${over} crossing${over===1?'':'s'} with water over the road`);if(wet)parts.push(`${km(road.wet)} of road under model water${road.deep>=.05?`, ${km(road.deep)} of it over 1.6 ft deep`:""}`);
   em.textContent=!modelled&&!samples.get(em.dataset.route)?.length?'Outside the model area':parts.length?parts.join(' · ')+' this hour':'No model water over the road this hour';
   em.className=over||wet?'over':'';
  }
 }
 function setRun(nextRun){
  run=nextRun;measureRoads();stories=new Map(FAILURE_POINTS.map(fp=>[fp.id,crossingStory(fp,{world,ground,inside,frames:run.frames,samplers:run.samplers,measured:run.measured})]));
  if(openId)openDetail(openId);
 }
 function setFrame(i){
  frameIndex=i;
  for(const p of pins){const s=stories.get(p.fp.id);p.b.dataset.status=s?statusAt(s,i):'outside';}
  refreshCounts();if(openId)renderDetail();
 }
 function chart(story){
  // Water level over the run against the road, in feet above the lowest value shown.
  const vals=[...story.hours.map(h=>h.water).filter(v=>v!=null),story.road.m,story.groundM].filter(v=>v!=null&&Number.isFinite(v));
  if(!vals.length)return'';
  const lo=Math.min(...vals)-.3,hi=Math.max(...vals)+.3,W=300,H=120,x=i=>8+i/(story.hours.length-1)*(W-16),y=v=>H-8-(v-lo)/(hi-lo)*(H-16);
  const line=story.hours.map((h,i)=>h.water==null?null:`${x(i).toFixed(1)},${y(h.water).toFixed(1)}`),segments=[];let cur=[];
  for(const p of line){if(p)cur.push(p);else if(cur.length){segments.push(cur);cur=[];}}if(cur.length)segments.push(cur);
  const road=story.road.m!=null?`<line class="road" x1="8" x2="${W-8}" y1="${y(story.road.m)}" y2="${y(story.road.m)}"/>`:'';
  return`<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Model water level by hour against the road height">
   <line class="ground" x1="8" x2="${W-8}" y1="${y(story.groundM)}" y2="${y(story.groundM)}"/>${road}
   ${segments.map(s=>`<polyline class="water" points="${s.join(' ')}"/>`).join('')}
   <line class="now" x1="${x(frameIndex)}" x2="${x(frameIndex)}" y1="4" y2="${H-4}"/></svg>
   <div class="chart-key"><span class="k water">Model water level</span>${story.road.m!=null?'<span class="k road">Road</span>':''}<span class="k ground">Ground (model lidar)</span></div>`;
 }
 function renderDetail(){
  const fp=FAILURE_POINTS.find(f=>f.id===openId),story=stories.get(openId);
  const routeId=fp.routes[0],hour=story?.hours?.[frameIndex];
  let body;
  if(!story?.inside)body=`<p class="status outside">${STATUS.outside}</p><p>The saved SFINCS runs compute about 297 km² of 100 m cells around the Santa Cruz River, Cortaro and Trico. This crossing is not in one of those cells, so the model has nothing to show here: not dry, just not modelled.</p>`;
  else{
   const s=statusAt(story,frameIndex);
   body=`<p class="status ${s}">${STATUS[s]}${s==='over'?`: ${ft(hour.over)} deep`:''}</p>
   <dl class="heights">
    <dt>Road height</dt><dd><strong>${ft(story.road.m)}</strong> NAVD88<small>${esc(story.road.source)}</small></dd>
    <dt>Model water level now</dt><dd><strong>${ft(hour.water)}</strong> NAVD88<small>${hour.water==null?'No model level for this hour.':hour.depth>=0?`${ft(hour.depth)} above the ground at the crossing`:`${ft(-hour.depth)} below the ground here: the level of the nearby model cells, not water on this spot`}</small></dd>
    <dt>Water vs road now</dt><dd><strong>${hour.over==null?'—':(hour.over>=0?'+':'−')+ft(Math.abs(hour.over))}</strong><small>${hour.over==null?'Needs both heights.':hour.over>COVER_M?'Model water is above the road.':'Model water is below the road.'}</small></dd>
    <dt>Highest model level</dt><dd><strong>${ft(story.peak?.water)}</strong><small>${story.peak?new Date(story.peak.time).toLocaleString('en-US',{timeZone:'America/Phoenix',month:'short',day:'numeric',hour:'numeric'})+' MST':''}${story.coveredHours!=null?` · over the road in ${story.coveredHours} of ${story.hours.length} hours`:''}</small></dd>
   </dl>${chart(story)}
   <p class="fine">Model water is the SFINCS water surface blended between 100 m model cells, from a saved run, not current conditions. ${story.unknownHours?`${story.unknownHours} hour(s) have no model level here. `:''}</p>`;
  }
  sheet.innerHTML=`<button class="close" aria-label="Close">×</button><h2>${esc(fp.name)}</h2><p class="where">${esc(fp.where??'')} · ${esc({dip:'Dip',flat:'Low road',road:'Road',bridge:'Bridge',river:'River bridge'}[fp.kind]??fp.kind)}</p>${body}<a class="app-link" href="${appHref(routeId,fp.id)}">Open the safety screen for this crossing</a>`;
  sheet.querySelector('.close').onclick=closeDetail;
 }
 function openDetail(id){openId=id;sheet.hidden=false;for(const p of pins)p.b.classList.toggle('open',p.fp.id===id);renderDetail();}
 function closeDetail(){openId=null;sheet.hidden=true;for(const p of pins)p.b.classList.remove('open');}
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
 return{update,setRun,setFrame,openDetail,select,get area(){return area;},get route(){return route;},stories:()=>stories};
}
