// The Map tab as a maps app: the map fills the screen. Search sits at the top left and the layers
// button at the top right. Zoom, locate and fit are at the bottom right, and the model run's time
// runs along the bottom. Routes, crossings and live conditions are in a side panel (a bottom sheet
// on a phone). 2D and 3D share one run, one hour and one set of layers.
import {RUNS,loadRun2d,createSimLayer,onDownloads,loadRoads,crossingsFor,COVER_M,DEPTH_FT,DEPTH_COLORS,RAIN_MMH,RAIN_COLORS} from './simulation/sim-2d.js?v=dev';
import {deckHtml,scoreboardHtml,drawTimeline,timelineKeyHtml,methodsHtml} from './sim-panels.js?v=dev';
import {createWorldLayer} from './simulation/world-layer.js?v=dev';
import {showAcknowledgement} from './model-acknowledgement.js?v=dev';

const svg=d=>`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
const I={
 layers:svg('M11.99 18.54l-7.37-5.73L3 14.07l9 7 9-7-1.63-1.27-7.38 5.74zM12 16l7.36-5.73L21 9l-9-7-9 7 1.63 1.27L12 16z'),
 search:svg('M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z'),
 plus:svg('M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z'),minus:svg('M19 13H5v-2h14v2z'),
 locate:svg('M12 8c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm8.94 3A8.994 8.994 0 0 0 13 3.06V1h-2v2.06A8.994 8.994 0 0 0 3.06 11H1v2h2.06A8.994 8.994 0 0 0 11 20.94V23h2v-2.06A8.994 8.994 0 0 0 20.94 13H23v-2h-2.06zM12 19c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7z'),
 routes:svg('M15 3l2.3 2.3-2.89 2.87 1.42 1.42L18.7 6.7 21 9V3zM3 9l2.3-2.3 2.87 2.89 1.42-1.42L6.7 5.3 9 3H3zm6 12l-2.3-2.3 2.89-2.87-1.42-1.42L5.3 17.3 3 15v6zm12-6l-2.3 2.3-2.87-2.89-1.42 1.42 2.89 2.87L15 21h6z'),
 water:svg('M12 2c-5.33 4.55-8 8.48-8 11.8 0 4.98 3.8 8.2 8 8.2s8-3.22 8-8.2c0-3.32-2.67-7.25-8-11.8z'),
 north:svg('M12 2 4.5 20.29l.71.71L12 18l6.79 3 .71-.71z'),
 close:svg('M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z'),
 info:svg('M11 7h2v2h-2zm0 4h2v6h-2zm1-9C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z'),
 prev:svg('M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z'),next:svg('M10 6 8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z'),
 play:svg('M8 5v14l11-7z'),pause:svg('M6 19h4V5H6v14zm8-14v14h4V5h-4z'),
 flask:svg('M7 2v2h1v6.6L3.2 19.2A2 2 0 0 0 5 22h14a2 2 0 0 0 1.8-2.8L16 10.6V4h1V2H7zm3 2h4v7.1l1.6 2.9H8.4L10 11.1V4z'),
 panel:svg('M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z'),
};
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]);
const MODELS=[['2d','Simulated water · SFINCS'],['hand','Modeled estimate · HAND'],['aggregate','Simulated and modeled combined'],['off','Off - no simulated water']];
const BASES=[['street','Street map'],['osm','OpenStreetMap'],['satellite','Satellite'],['terrain','Terrain detail']];
const DETAILS=[['rain','Rain'],['flow','River flow'],['routes','Routes & crossings'],['places','Places'],['live','Live readings']];
const HOUR_SECONDS=4;
const clockText=t=>new Date(t).toLocaleString('en-US',{timeZone:'America/Phoenix',weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})+' MST';

export function mountMapApp({L,map,baseMaps,routeLayer,liveLayer,fitRoutes,targets,openCrossing,points=[]}){
 const wrap=document.querySelector('.safety-map'),mapEl=document.getElementById('map');
 const st={view:'2d',base:'street',run:RUNS[0].id,model:'2d',rain:true,flow:true,routes:true,places:true,live:true,playing:false};
 const sim=createSimLayer(L,map);
 const world=createWorldLayer({container:mapEl,onState:fromWorld});
 const runs=new Map();let runNote='',loadingRun=null;

 // --- the floating pieces ---
 const ui=document.createElement('div');ui.className='mapp';
 ui.innerHTML=`
 <div class="mapp-top">
  <label class="mapp-search">${I.search}<select data-m-search aria-label="Go to a crossing or place"></select></label>
  <button type="button" class="mapp-fab mapp-scen" data-m-scenarios aria-label="Scenarios">${I.flask}<span>Scenarios</span></button>
  <button type="button" class="mapp-fab" data-m-layers aria-label="Map layers" aria-expanded="false">${I.layers}<span>Layers</span></button>
 </div>
 <section class="mapp-layers" data-m-layer-panel hidden aria-label="Map layers">
  <header><h2>Map layers</h2><button type="button" class="mapp-icon" data-m-close aria-label="Close map layers">${I.close}</button></header>
  <h3>View</h3>
  <div class="mapp-tiles" role="radiogroup" aria-label="View">${[['2d','2D map'],['3d','3D']].map(([v,t])=>`<button type="button" role="radio" data-m-view="${v}" class="mapp-tile"><i class="sw sw-${v}"></i><span>${t}</span></button>`).join('')}</div>
  <h3>Map type</h3>
  <div class="mapp-tiles" role="radiogroup" aria-label="Map type">${BASES.map(([v,t])=>`<button type="button" role="radio" data-m-base="${v}" class="mapp-tile"><i class="sw sw-${v}"></i><span>${t}</span></button>`).join('')}</div>
  <p class="mapp-hint" data-m-base-hint></p>
  <div class="mapp-terrain" data-m-terrain hidden></div>
  <h3>Water</h3>
  <div class="mapp-radios" role="radiogroup" aria-label="Water">${MODELS.map(([v,t])=>`<label><input type="radio" name="mapp-model" value="${v}"> ${t}</label>`).join('')}</div>
  <p class="mapp-hint" data-m-model-hint></p>
  <h3>Map details</h3>
  <div class="mapp-switches">${DETAILS.map(([k,t])=>`<label><span>${t}</span><input type="checkbox" role="switch" data-m-detail="${k}" checked></label>`).join('')}</div>
  <h3>Key</h3>
  <div class="mapp-key">
   <p>Simulated water depth (ft)</p><div class="ramp">${DEPTH_COLORS.map((c,i)=>`<span><i style="background:${c}"></i>${DEPTH_FT[i]}${i===DEPTH_FT.length-1?'+':'–'+DEPTH_FT[i+1]}</span>`).join('')}</div>
   <p>Rain (in/h)</p><div class="ramp">${RAIN_COLORS.map((c,i)=>`<span><i style="background:${c}"></i>${(RAIN_MMH[i]/25.4).toFixed(2).replace(/^0/,'')}${i===RAIN_MMH.length-1?'+':''}</span>`).join('')}</div>
   <p class="hand-key"><i></i>HAND modeled extent (Nov 1, 13Z run)</p>
  </div>
  <details class="mapp-about"><summary>About this map</summary><div data-m-about><p>Water is each 100 m SFINCS model cell's simulated depth: the run's water surface minus the cell's mean terrain. It is a model, not observed water. Rain is the run's own rainfall input, river flow its inflow at the model's inlets. Live readings and route ratings come from gauges, the county and the weather service, checked separately.</p></div></details>
 </section>
 <div class="mapp-controls">
  <button type="button" class="mapp-ctl" data-m-north aria-label="Turn to north up" hidden>${I.north}</button>
  <div class="mapp-zoom"><button type="button" class="mapp-ctl" data-m-in aria-label="Zoom in">${I.plus}</button><button type="button" class="mapp-ctl" data-m-out aria-label="Zoom out">${I.minus}</button></div>
  <button type="button" class="mapp-ctl" data-m-locate aria-label="Show my location">${I.locate}</button>
  <button type="button" class="mapp-ctl" data-m-fit-routes aria-label="Fit routes" title="Fit routes">${I.routes}</button>
  <button type="button" class="mapp-ctl" data-m-fit-water aria-label="Fit the deepest water" title="Fit the deepest water">${I.water}</button>
 </div>
 <div class="mapp-player" role="group" aria-label="Model run and hour">
  <div class="mapp-player-top"><select data-m-run aria-label="Model run"></select><span class="mapp-run-label" data-m-run-label hidden>Saved Nov 1–2 run · terrain detail</span><span class="mapp-stat" data-m-stat></span><button type="button" class="mapp-icon" data-m-info aria-label="About this run" aria-expanded="false">${I.info}</button></div>
  <div class="mapp-hud" data-m-hud></div>
  <div class="mapp-timeline" data-m-timeline><canvas aria-hidden="true"></canvas><input type="range" data-m-scrub min="0" max="0" step="0.01" value="0" aria-label="Model hour"></div>
  <div class="mapp-tl-key">${timelineKeyHtml}</div>
  <div class="mapp-player-row"><button type="button" class="mapp-icon" data-m-prev aria-label="Previous hour">${I.prev}</button><button type="button" class="mapp-play" data-m-play aria-label="Play">${I.play}</button><button type="button" class="mapp-icon" data-m-next aria-label="Next hour">${I.next}</button><span class="mapp-sim-badge" data-m-badge>SIM</span><output data-m-time>Loading the model run</output></div>
  <p class="mapp-note" data-m-note hidden></p>
 </div>
 <aside class="mapp-panel" data-m-panel aria-label="Routes and conditions">
  <button type="button" class="mapp-handle" data-m-handle aria-label="Show more" aria-expanded="false"><i></i></button>
  <button type="button" class="mapp-collapse" data-m-collapse aria-label="Hide the side panel">${I.prev}</button>
  <div class="mapp-tabs" role="tablist" aria-label="Panel">${[['scenarios','Scenarios'],['crossings','Crossings'],['routes','Routes'],['model','Model']].map(([k,v])=>`<button type="button" role="tab" data-m-tab="${k}" aria-selected="false">${v}</button>`).join('')}</div>
  <div class="mapp-panel-body" data-m-panel-body><section data-m-pane="scenarios" hidden><h3 class="sim-h">Scenarios</h3><p class="sim-muted">Test datasets: real forecast runs and what-if storms on the same model. Load one, then press play.</p><div data-m-deck></div></section><section data-m-pane="crossings" hidden><h3 class="sim-h">Crossings</h3><div data-m-score></div></section><section data-m-pane="routes" hidden></section><section data-m-pane="model" hidden data-m-methods></section></div>
 </aside>
 <button type="button" class="mapp-fab mapp-show-panel" data-m-show-panel hidden aria-label="Show routes and conditions">${I.panel}<span>Routes</span></button>`;
 wrap.append(ui);
 const $=s=>ui.querySelector(s),$$=s=>[...ui.querySelectorAll(s)];

 // Move what the old side column held into the panel and the layers sheet.
 const body=$('[data-m-panel-body]'),routesPane=$('[data-m-pane=routes]');
 const move=(sel,to)=>{const el=document.querySelector(sel);if(el)to.append(el);return el;};
 move('[data-map-routes]',routesPane);move('.embedded-live',routesPane);
 const links=document.createElement('div');links.className='mapp-links';routesPane.append(links);
 const history=[...document.querySelectorAll('[data-panel-content=options]>button')].find(b=>/Recent gauge readings/.test(b.textContent));if(history)links.append(history);
 move('.official-forecast-link',links);
 const exp=document.querySelector('.exp-link a');if(exp)links.append(exp.cloneNode(true));
 // The risk key is drawn with the route screens, after this runs: adopt it when it appears.
 const adopt=()=>{const k=document.querySelector('details.risk-key');if(k&&!routesPane.contains(k))routesPane.append(k);};
 adopt();addEventListener('flood-screen-rendered',adopt);

 // --- panel tabs ---
 let tab=(()=>{try{return localStorage.getItem('mapp-tab')}catch{return null}})()||'scenarios';
 function setTab(k){tab=k;try{localStorage.setItem('mapp-tab',k)}catch{}
  $$('[data-m-tab]').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.mTab===k)));
  $$('[data-m-pane]').forEach(p=>p.hidden=p.dataset.mPane!==k);
  if(k==='routes')adopt();renderPanels(true);
 }
 $$('[data-m-tab]').forEach(b=>b.onclick=()=>setTab(b.dataset.mTab));
 // Terrain detail keeps the saved-case controls it has always had.
 const terrain=$('[data-m-terrain]');
 const caseRow=document.querySelector('[data-case]')?.closest('.flood-row');if(caseRow)terrain.append(caseRow);
 const tilt=document.querySelector('[data-3d]');if(tilt)terrain.append(tilt);
 const range=document.querySelector('.dock-actions [data-panel=time]');if(range){range.textContent='Choose hours';range.setAttribute('aria-label','Choose the hours to browse');terrain.append(range);}
 move('[data-panel-content=options] [data-status]',terrain);
 const why=[...document.querySelectorAll('[data-panel-content=options]>details')].find(d=>!d.classList.contains('flood-extra'));if(why)$('.mapp-about').after(why);

 // --- search ---
 const search=$('[data-m-search]');
 function fillSearch(){
  const t=targets();const group=(label,kind)=>`<optgroup label="${label}">${t.filter(x=>x.kind===kind).sort((a,b)=>a.name.localeCompare(b.name)).map(x=>`<option value="${t.indexOf(x)}">${esc(x.name)}</option>`).join('')}</optgroup>`;
  search.innerHTML='<option value="">Search crossings and places</option>'+group('Crossings','crossing')+group('Places','place');
  search.onchange=()=>{const x=t[Number(search.value)];search.value='';if(!x)return;
   if(st.view==='3d')world.goto(x.lon,x.lat,x.kind==='crossing'?x.id:null);
   else map.flyTo([x.lat,x.lon],x.kind==='crossing'?15:14,{duration:.8});
   if(x.kind==='crossing')openCrossing(x.id);};
 }
 fillSearch();

 // --- layers sheet ---
 const layersBtn=$('[data-m-layers]'),layersPanel=$('[data-m-layer-panel]');
 const setLayersOpen=open=>{layersPanel.hidden=!open;layersBtn.setAttribute('aria-expanded',String(open));};
 layersBtn.onclick=()=>setLayersOpen(layersPanel.hidden);$('[data-m-close]').onclick=()=>setLayersOpen(false);
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!layersPanel.hidden){setLayersOpen(false);layersBtn.focus();}});
 $$('[data-m-view]').forEach(b=>b.onclick=()=>setView(b.dataset.mView));
 $$('[data-m-base]').forEach(b=>b.onclick=()=>setBase(b.dataset.mBase));
 $$('input[name=mapp-model]').forEach(r=>r.onchange=()=>{st.model=r.value;applyModel();});
 $$('[data-m-detail]').forEach(c=>c.onchange=()=>{st[c.dataset.mDetail]=c.checked;applyDetails(c.dataset.mDetail);});

 // --- controls ---
 const in3d=()=>st.view==='3d';
 $('[data-m-in]').onclick=()=>in3d()?world.send('click','zoom-in'):map.zoomIn();
 $('[data-m-out]').onclick=()=>in3d()?world.send('click','zoom-out'):map.zoomOut();
 $('[data-m-north]').onclick=()=>world.send('click','north');
 $('[data-m-fit-routes]').onclick=()=>in3d()?world.send('click','fit-routes'):fitRoutes(padding());
 $('[data-m-fit-water]').onclick=()=>{if(in3d())return world.send('click','fit-flood');const b=sim.wetBounds(.3)??sim.wetBounds(.01);if(b)map.fitBounds(b,{...padding(),maxZoom:15});};
 const oldLocate=[...document.querySelectorAll('.map-camera button')].find(b=>b.textContent.trim()==='Locate');
 $('[data-m-locate]').onclick=()=>oldLocate?.click();

 // --- panel ---
 const panel=$('[data-m-panel]');
 const phone=()=>matchMedia('(max-width: 899px)').matches;
 // Room the floating pieces take, so a fit keeps routes and water clear of them.
 function padding(){
  if(phone())return{paddingTopLeft:[16,130],paddingBottomRight:[64,Math.round(mapEl.clientHeight*.3)+16]};
  return{paddingTopLeft:[ui.classList.contains('panel-collapsed')?24:404,76],paddingBottomRight:[76,124]};
 }
 function setSheet(expanded){panel.classList.toggle('expanded',expanded);$('[data-m-handle]').setAttribute('aria-expanded',String(expanded));$('[data-m-handle]').setAttribute('aria-label',expanded?'Show less':'Show more');}
 $('[data-m-handle]').onclick=()=>setSheet(!panel.classList.contains('expanded'));
 const setCollapsed=c=>{ui.classList.toggle('panel-collapsed',c);$('[data-m-show-panel]').hidden=!c;};

 $('[data-m-collapse]').onclick=()=>setCollapsed(true);$('[data-m-show-panel]').onclick=()=>setCollapsed(false);

 // --- player ---
 const runSel=$('[data-m-run]'),scrub=$('[data-m-scrub]'),timeOut=$('[data-m-time]'),play=$('[data-m-play]'),note=$('[data-m-note]');
 runSel.innerHTML=RUNS.map(r=>`<option value="${r.id}">${esc(r.label)}</option>`).join('');
 runSel.onchange=()=>chooseRun(runSel.value);
 $('[data-m-info]').onclick=()=>{note.hidden=!note.hidden;$('[data-m-info]').setAttribute('aria-expanded',String(!note.hidden));};
 const setPlaying=p=>{st.playing=p;play.innerHTML=p?I.pause:I.play;play.setAttribute('aria-label',p?'Pause':'Play');ui.classList.toggle('playing',p);};
 play.onclick=()=>{if(in3d())return world.send('click','play');if(st.base==='terrain')return terrainPlay();setPlaying(!st.playing);};
 $('[data-m-prev]').onclick=()=>step(-1);$('[data-m-next]').onclick=()=>step(1);
 scrub.oninput=()=>{if(in3d())return world.send('set','scrub',Math.round(Number(scrub.value)));if(st.base==='terrain')return terrainSet(Number(scrub.value));setPlaying(false);setClock(Number(scrub.value));};
 function step(n){
  if(in3d())return world.send('click',n<0?'prev':'next');
  if(st.base==='terrain')return document.querySelector(n<0?'[data-prev]':'[data-next]')?.click();
  setPlaying(false);setClock(Math.max(0,Math.min(sim.run.times.length-1,Math.round(sim.clock)+n)));
 }
 function setClock(c){sim.setClock(c);if(document.activeElement!==scrub)scrub.value=String(sim.clock);const t=sim.time();if(t!=null&&!in3d())timeOut.textContent=clockText(t);hourStat();drawTl();}
 const tlCanvas=$('[data-m-timeline] canvas');
 function drawTl(){drawTimeline(tlCanvas,st.base==='terrain'&&!in3d()?null:sim.run,sim.clock,overByHour());}
 addEventListener('resize',drawTl);
 // Crossings: road and deck heights against each hour's water, for the scoreboard and the HUD.
 let crossings=null,crossingsRun=null;
 async function updateCrossings(){
  const run=sim.run;if(!run||crossingsRun===run)return;crossingsRun=run;crossings=null;renderPanels(true);
  try{const pkg=await loadRoads();if(sim.run===run)crossings=crossingsFor(run,points,pkg);}catch{if(sim.run===run)crossings=crossingsFor(run,points,null);}
  if(sim.run===run){renderPanels(true);drawTl();statKey='';hourStat();}
 }
 const overByHour=()=>crossings&&sim.run?sim.run.times.map((_,h)=>crossings.filter(c=>c.inside&&c.over[h]>COVER_M).length):null;
 let panelKey='';
 function renderPanels(force){
  const h=Math.round(sim.clock),key=[tab,st.run,h,!!crossings,!!sim.run].join();if(!force&&key===panelKey)return;panelKey=key;
  if(tab==='scenarios'){const ls=runs.get('live')?.series;$('[data-m-deck]').innerHTML=deckHtml(RUNS,st.run,ls&&{wetKm2:Math.max(...ls.map(v=>v.wetKm2)),rainInH:Math.max(...ls.map(v=>v.rainMmH))/25.4,riverCfs:Math.max(...ls.map(v=>v.inflowM3s))*35.3147});$$('[data-sim-load]').forEach(b=>b.onclick=()=>{chooseRun(b.dataset.simLoad);if(phone())setSheet(false);});}
  if(tab==='crossings'){$('[data-m-score]').innerHTML=sim.run?scoreboardHtml(crossings,h,sim.run.times):'<p class="sim-muted">Loading the model run…</p>';$$('[data-sim-crossing]').forEach(b=>b.onclick=()=>{const fp=points.find(p=>p.id===b.dataset.simCrossing);if(!fp)return;if(in3d())world.goto(fp.lon,fp.lat,fp.id);else map.flyTo([fp.lat,fp.lon],15,{duration:.8});});}
  if(tab==='model')$('[data-m-methods]').innerHTML=methodsHtml(sim.run,crossings);
 }
 // How much water the model has this hour, so a dry hour reads as dry rather than as missing.
 let statKey='';
 function hourStat(){
  const run=sim.run,el=$('[data-m-stat]'),hud=$('[data-m-hud]');
  if(!run||(st.base==='terrain'&&!in3d())){el.textContent='';hud.innerHTML='';statKey='';return;}
  const h=Math.round(sim.clock),key=run.def.id+h+!!crossings;if(key===statKey)return;statKey=key;
  const s=run.series[h],inside=crossings?.filter(c=>c.inside)??[],over=inside.filter(c=>c.over[h]>COVER_M).length;
  el.textContent=s.wetKm2?'':'No simulated water this hour';
  const chip=(label,value,unit,cls='')=>`<div class="chip ${cls}"><span>${label}</span><b>${value}</b><small>${unit}</small></div>`;
  const dryLive=run.def.live&&Math.max(...run.series.map(v=>v.wetKm2))<.05;
  hud.innerHTML=chip('Wet area',s.wetKm2.toFixed(s.wetKm2<10?2:1),'km²')+chip('Deepest cell',(s.deepM/.3048).toFixed(1),'ft')+chip('Over the road',crossings?`${over}/${inside.length}`:'…','crossings',over?'alert':'')+chip('River in',Math.round(s.inflowM3s*35.3147).toLocaleString(),'ft³/s')+chip('Rain',(s.rainMmH/25.4).toFixed(2),'in/h')+(dryLive?'<button type="button" class="chip try" data-m-try>Dry right now. Try the 100-year storm →</button>':'');
  hud.querySelector('[data-m-try]')?.addEventListener('click',()=>chooseRun('stress'));
  renderPanels();
 }
 let last=performance.now();
 (function tick(now){
  const dt=Math.min(.25,(now-last)/1000);last=now;
  if(st.playing&&!in3d()&&st.base!=='terrain'&&sim.run&&location.hash==='#/map'){let c=sim.clock+dt/HOUR_SECONDS;if(c>sim.run.times.length-1)c=0;setClock(c);}
  requestAnimationFrame(tick);
 })(last);

 // A run opens at the hour nearest now when it is live, otherwise at its deepest water.
 function openingHour(run){
  if(run.def.live){const now=Date.now();return run.times.reduce((b,t,k)=>Math.abs(t-now)<Math.abs(run.times[b]-now)?k:b,0);}
  let best=0,most=-1;run.depth.forEach((d,k)=>{let n=0;for(let i=0;i<d.length;i++)if(d[i]>=.0091)n++;if(n>most){most=n;best=k;}});return best;
 }
 async function chooseRun(id,{keepClock=false}={}){
  const def=RUNS.find(r=>r.id===id)??RUNS[1];st.run=def.id;runSel.value=def.id;loadError=null;renderMenu();
  if(in3d()){expectRun=def.id;expectAt=performance.now();world.send('set','run',def.id);}
  const ticket=loadingRun=Symbol();loadingDef=def;paintCard();if(!in3d())timeOut.textContent='Loading '+(def.card?.short??def.label);
  try{
   let run=runs.get(def.id);
   if(!run){run=await loadRun2d(def);runs.set(def.id,run);}
   if(ticket!==loadingRun)return;
   runNote=run.def.note??'';sim.setRun(run);statKey='';
   if(!in3d()){scrub.max=String(run.times.length-1);setClock(keepClock?Math.min(sim.clock,run.times.length-1):openingHour(run));}else drawTl();
   showAcknowledgement(def.live?'modelRun':'savedRun');updateCrossings();renderPanels(true);
  }catch(error){
   if(ticket!==loadingRun)return;
   if(def.live){runNote=`No live model run to show: ${error.message} Showing a saved run instead.`;loadingRun=null;return chooseRun('13z');}
   timeOut.textContent='The model run could not load';loadError={def,message:error.message};
  }finally{if(ticket===loadingRun){loadingRun=null;loadingDef=null;describe();paintCard();}}
 }
 function describe(){
  const run=sim.run;note.textContent=in3d()?(world.state?.note??''):st.base==='terrain'?'Terrain detail: the saved Nov 1–2 run drawn on 10 m terrain by the flat renderer. Its own time and case controls are in Map layers.':runNote||run?.def.note||'';
  const hand=in3d()?!world.state?.models?.includes('hand'):!!run?.hand;
  for(const r of $$('input[name=mapp-model]')){r.disabled=(r.value==='hand'||r.value==='aggregate')&&!hand;r.checked=r.value===st.model;}
  $('[data-m-model-hint]').textContent=hand?'':'The HAND modeled estimate exists only for the Nov 1, 13Z run.';
 }

 // --- applying choices ---
 function applyModel(){
  if(in3d())world.send('set','model',st.model);
  sim.set('water',st.model==='2d'||st.model==='aggregate');sim.set('hand',st.model==='hand'||st.model==='aggregate');
  if(st.base==='terrain'){const m=document.querySelector('[data-model]');if(m&&st.model!==m.value){m.value=st.model==='hand'?'hand':st.model==='aggregate'?'aggregate':st.model==='off'?'off':'2d';m.dispatchEvent(new Event('change'));}}
  describe();
 }
 function applyDetails(key){
  const keys=key?[key]:DETAILS.map(d=>d[0]);
  for(const k of keys){
   const on=st[k];
   if(k==='rain'){sim.set('rain',on);if(in3d())world.send('set','rain',on);}
   if(k==='flow'){sim.set('flow',on);if(in3d())world.send('set','flow',on);}
   if(k==='routes'){on?map.addLayer(routeLayer):map.removeLayer(routeLayer);if(in3d())world.send('set','show-routes',on);}
   if(k==='places'){mapEl.classList.toggle('hide-places',!on);if(in3d())world.send('set','show-places',on);}
   if(k==='live'){on?map.addLayer(liveLayer):map.removeLayer(liveLayer);}
  }
 }
 function setBase(base){
  if(in3d()&&(base==='terrain'||base==='osm'))return;
  const wasTerrain=st.base==='terrain';st.base=base;
  if(base!=='terrain'){
   for(const k of ['street','osm','satellite'])if(baseMaps[k]&&k!==base)map.removeLayer(baseMaps[k]);
   map.addLayer(baseMaps[base]);if(base==='osm')map.removeLayer(baseMaps.names);else map.addLayer(baseMaps.names);
   document.querySelectorAll('[data-base]').forEach(o=>o.setAttribute('aria-selected',String(o.dataset.base===base)));
  }
  if(in3d())world.send('set','base',base);
  if(base==='terrain'!==wasTerrain){
   window.dispatchEvent(new CustomEvent('flood-terrain-detail',{detail:base==='terrain'}));
   if(base==='terrain'){setPlaying(false);const m=document.querySelector('[data-model]');if(m){m.value=st.model==='off'?'off':st.model;m.dispatchEvent(new Event('change'));}}
  }
  sync();
 }
 let pending3d=false;
 function setView(view){
  if(view==='3d'){
   if(st.view==='3d')return;
   if(st.base==='terrain')setBase('street');
   pending3d=true;world.load(st.run);world.park();
   if(world.ready)enter3d();else{paintCard();sync();}
   return;
  }
  if(pending3d){pending3d=false;world.park();paintCard();sync();return;}
  if(st.view!=='3d')return;
  const from3d=world.state;st.view='2d';world.hide();
  if(from3d?.run&&from3d.run!==st.run)chooseRun(from3d.run).then(()=>setClock(from3d.scrub.value));
  else if(from3d)setClock(from3d.scrub.value);
  sync();
 }
 function enter3d(){
  pending3d=false;st.view='3d';setPlaying(false);world.show(true);showAcknowledgement('simulated');pushTo3d();paintCard();sync();
 }
 // The run this page asked the 3D view for: older reports from it are not taken as a choice.
 let expectRun=null,expectAt=0;
 function pushTo3d(){
  expectRun=st.run;expectAt=performance.now();world.send('set','run',st.run);world.send('set','base',st.base==='satellite'?'satellite':'street');world.send('set','model',st.model);
  for(const [k,id] of [['rain','rain'],['flow','flow'],['routes','show-routes'],['places','show-places']])world.send('set',id,st[k]);
  setTimeout(()=>world.send('set','scrub',Math.round(sim.clock)),400);
 }
 // The 3D view reports what it shows; the player and layers follow it while 3D is on.
 function fromWorld(s){
  if(pending3d){if(s.ready&&location.hash==='#/map')enter3d();else{paintCard();sync();}return;}
  if(!in3d())return;
  if(s.failed||s.error){paintCard();}
  if(expectRun&&performance.now()-expectAt>20000)expectRun=null;
  if(expectRun){if(s.run===expectRun)expectRun=null;else{paintCard();return;}}
  if(s.run!==runSel.value&&RUNS.some(r=>r.id===s.run)){st.run=s.run;runSel.value=s.run;}
  if(s.run!==sim.run?.def.id&&RUNS.some(r=>r.id===s.run)&&!loadingRun)chooseRun(s.run);
  scrub.max=String(s.scrub.max);if(document.activeElement!==scrub)scrub.value=String(s.scrub.value);
  if(sim.run&&sim.run.def.id===s.run){sim.setClock(Math.min(sim.run.times.length-1,s.scrub.value));hourStat();drawTl();}
  timeOut.textContent=s.error?'The 3D view could not load':s.time||'Loading the 3D view';
  if(s.playing!==st.playing)setPlaying(s.playing);
  if(s.model!==st.model){st.model=s.model;}
  describe();
 }
 // Terrain detail: the player shows the saved case's own clock and slider.
 let terrainTimer=0;
 function terrainPlay(){if(terrainTimer){clearInterval(terrainTimer);terrainTimer=0;setPlaying(false);return;}setPlaying(true);terrainTimer=setInterval(()=>{const t=document.querySelector('[data-time]');if(!t||t.disabled)return;if(Number(t.value)>=Number(t.max))terrainSet(Number(t.min));else document.querySelector('[data-next]')?.click();},1500);}
 function terrainSet(v){const t=document.querySelector('[data-time]');if(!t)return;t.value=String(Math.round(v));t.dispatchEvent(new Event('input',{bubbles:true}));t.dispatchEvent(new Event('change',{bubbles:true}));}
 const oldClock=document.querySelector('[data-clock]');
 new MutationObserver(()=>{if(st.base!=='terrain'||in3d())return;timeOut.textContent=oldClock.textContent;const t=document.querySelector('[data-time]');if(t){scrub.min=t.min;scrub.max=t.max;scrub.step='1';scrub.value=t.value;}}).observe(oldClock,{childList:true,characterData:true,subtree:true});

 // --- the loading card on the map: what is downloading or being built, and how far along ---
 const card=document.createElement('div');card.className='mapp-load';card.hidden=true;card.setAttribute('role','status');card.setAttribute('aria-live','polite');
 card.innerHTML='<div class="mapp-load-head"><span class="mapp-spin" aria-hidden="true"></span><strong data-l-title></strong><span class="mapp-load-time" data-l-time></span></div><p data-l-step></p><div class="mapp-load-bar"><i data-l-bar></i></div><div class="mapp-load-actions"><button type="button" data-l-retry hidden>Try again</button><button type="button" data-l-cancel>Cancel</button></div>';
 ui.append(card);
 const c$=s=>card.querySelector(s);
 let loadingDef=null,loadError=null,dl={count:0,got:0,total:0},loadStarted=0;
 const mb=n=>(n/1048576).toFixed(n<1048576?2:1);
 onDownloads(d=>{dl=d;paintCard();});
 function paintCard(){
  const w=world.state,failed3d=pending3d&&(w?.failed||w?.error),quiet3d=pending3d&&w?.quiet;
  let title='',step='',share=0,retry=false,show=true,cancel=true;
  if(pending3d){
   title='Building the 3D view';share=(w?.progress??0)/100;
   step=failed3d?(w.error||'The 3D view could not load.'):quiet3d?`Still on: ${w?.step||'starting'}. The connection may be slow.`:(w?.step||'Downloading the 3D view');
   retry=!!(failed3d||quiet3d);
  }else if(loadingDef&&!in3d()){
   title='Loading '+(loadingDef.card?.short??loadingDef.label);
   step=dl.count?`Downloading the model run · ${mb(dl.got)}${dl.total>=dl.got&&dl.total?' of '+mb(dl.total):''} MB`:'Reading the model run';
   share=dl.total?dl.got/dl.total:.1;
  }else if(loadError&&!in3d()){
   title='The model run could not load';step=loadError.message+' The map and the other scenarios still work.';retry=true;share=0;
  }else show=false;
  if(show&&card.hidden)loadStarted=performance.now();
  card.hidden=!show;if(!show)return;
  card.classList.toggle('failed',!!(failed3d||(loadError&&!loadingDef&&!pending3d)));
  c$('[data-l-title]').textContent=title;c$('[data-l-step]').textContent=step;
  c$('[data-l-bar]').style.width=Math.max(4,Math.round(share*100))+'%';
  c$('[data-l-retry]').hidden=!retry;c$('[data-l-cancel]').hidden=!cancel;
  c$('[data-l-cancel]').textContent=pending3d?'Stay in 2D':loadError?'Close':'Cancel';
 }
 setInterval(()=>{if(card.hidden)return;const s=pending3d?world.seconds:Math.round((performance.now()-loadStarted)/1000);c$('[data-l-time]').textContent=s>=2?s+' s':'';},500);
 c$('[data-l-cancel]').onclick=()=>{
  if(pending3d){pending3d=false;world.cancel();}
  else if(loadingDef){loadingRun=null;const keep=sim.run?.def.id;loadingDef=null;if(keep){st.run=keep;runSel.value=keep;}renderMenu();}
  loadError=null;paintCard();sync();
 };
 c$('[data-l-retry]').onclick=()=>{if(pending3d){world.retry();paintCard();}else if(loadError){const d=loadError.def;loadError=null;chooseRun(d.id);}};

 // --- the scenario menu: every run, one tap ---
 const menu=document.createElement('div');menu.className='mapp-menu';menu.hidden=true;menu.setAttribute('role','menu');menu.setAttribute('aria-label','Scenarios');ui.append(menu);
 const scenBtn=$('[data-m-scenarios]');scenBtn.setAttribute('aria-haspopup','menu');scenBtn.setAttribute('aria-expanded','false');
 function renderMenu(){
  menu.innerHTML=RUNS.map(r=>{const c=r.card??{},on=r.id===st.run;
   const stats=r.live?'Updates every hour':`${c.rainInH} in/h rain · ${Math.round(c.riverCfs).toLocaleString()} ft³/s river · ${c.wetKm2} km² wet`;
   return `<button type="button" role="menuitemradio" aria-checked="${on}" data-menu-run="${r.id}" class="k-${(c.kind??'').toLowerCase().replace(/[^a-z]/g,'')}"><span class="kind">${esc(c.kind??'')}</span><b>${esc(c.short??r.label)}</b><small>${stats}</small></button>`;}).join('')+'<button type="button" role="menuitem" class="more" data-menu-more>Compare scenarios side by side →</button>';
  menu.querySelectorAll('[data-menu-run]').forEach(b=>b.onclick=()=>{setMenu(false);chooseRun(b.dataset.menuRun);});
  menu.querySelector('[data-menu-more]').onclick=()=>{setMenu(false);setCollapsed(false);setTab('scenarios');if(phone())setSheet(true);};
 }
 function setMenu(open){
  if(open){renderMenu();const r=scenBtn.getBoundingClientRect(),w=wrap.getBoundingClientRect();menu.style.left=Math.max(8,Math.min(r.left-w.left,w.width-menu.offsetWidth-8))+'px';menu.style.top=(r.bottom-w.top+8)+'px';}
  menu.hidden=!open;scenBtn.setAttribute('aria-expanded',String(open));
  if(open){menu.style.left=Math.max(8,Math.min(scenBtn.getBoundingClientRect().left-wrap.getBoundingClientRect().left,wrap.clientWidth-menu.offsetWidth-8))+'px';menu.querySelector('[aria-checked=true]')?.focus();}
 }
 scenBtn.onclick=e=>{e.stopPropagation();setMenu(menu.hidden);};
 document.addEventListener('click',e=>{if(!menu.hidden&&!menu.contains(e.target)&&e.target!==scenBtn)setMenu(false);});
 menu.addEventListener('keydown',e=>{
  const items=[...menu.querySelectorAll('button')],i=items.indexOf(document.activeElement);
  if(e.key==='ArrowDown'){e.preventDefault();items[(i+1)%items.length].focus();}
  else if(e.key==='ArrowUp'){e.preventDefault();items[(i-1+items.length)%items.length].focus();}
  else if(e.key==='Escape'){setMenu(false);scenBtn.focus();}
 });
 renderMenu();

 function sync(){
  const terrainOn=st.base==='terrain'&&!in3d();
  $$('[data-m-view]').forEach(b=>{b.setAttribute('aria-checked',String(b.dataset.mView===st.view||(b.dataset.mView==='3d'&&pending3d)));b.dataset.loading=b.dataset.mView==='3d'&&pending3d?Math.round(world.state?.progress??0)+'%':'';});
  $$('[data-m-base]').forEach(b=>{b.setAttribute('aria-checked',String(b.dataset.mBase===st.base));b.disabled=in3d()&&(b.dataset.mBase==='terrain'||b.dataset.mBase==='osm');});
  $('[data-m-base-hint]').textContent=in3d()?'3D has Street map and Satellite. OpenStreetMap and Terrain detail are 2D map types.':terrainOn?'Terrain detail draws its own 10 m terrain map with the saved Nov 1–2 run.':'';
  terrain.hidden=!terrainOn;
  sim.show(!in3d()&&!terrainOn&&location.hash==='#/map');
  runSel.hidden=terrainOn;$('[data-m-run-label]').hidden=!terrainOn;scrub.step=in3d()||terrainOn?'1':'0.01';
  $('[data-m-north]').hidden=!in3d();$('[data-m-locate]').hidden=in3d();
  ui.classList.toggle('in3d',in3d());ui.classList.toggle('terrain-on',terrainOn);drawTl();
  hourStat();
  if(!in3d()&&!terrainOn&&sim.run){scrub.min='0';scrub.max=String(sim.run.times.length-1);setClock(sim.clock);}
  if(terrainOn){timeOut.textContent=oldClock?.textContent??'';}
  describe();
 }

 // Tap the 2D map for the simulated depth there.
 map.on('click',e=>{
  if(location.hash!=='#/map'||in3d()||st.base==='terrain'||st.model==='off'||st.model==='hand'||!sim.run)return;
  const hit=sim.depthAt(e.latlng.lat,e.latlng.lng),t=clockText(sim.time());
  if(!hit){L.popup({className:'mapp-popup'}).setLatLng(e.latlng).setContent(`Outside the model area · ${t}`).openOn(map);return;}
  const ft=hit.depth/.3048;
  L.popup({className:'mapp-popup'}).setLatLng(e.latlng).setContent(Number.isNaN(hit.depth)?`No model result here · ${t}`:ft<.03?`No simulated water here · ${t}`:`<strong>${ft<1?ft.toFixed(2):ft.toFixed(1)} ft</strong> simulated water · ${t}<br><span>SFINCS cell average over 100 m, not a measured road depth.</span>`).openOn(map);
 });

 // Only the Map tab shows the model layers; the other screens keep their live map.
 function onRoute(){
  const on=location.hash==='#/map';document.body.classList.toggle('mapp-on',on);
  if(on&&in3d())world.show(true);else if(pending3d)world.park();else world.hide();
  if(!on){setLayersOpen(false);if(st.base==='terrain')window.dispatchEvent(new CustomEvent('flood-terrain-detail',{detail:false}));}
  else if(st.base==='terrain')window.dispatchEvent(new CustomEvent('flood-terrain-detail',{detail:true}));
  sync();map.invalidateSize();
  if(on&&!sim.run&&!loadingRun)chooseRun(st.run);
 }
 addEventListener('hashchange',onRoute);
 setPlaying(false);setTab(tab);onRoute();
 return{
  // Bring a crossing's card into view: beside the map, or up from the bottom on a phone.
  reveal(){setTab('routes');if(phone())setSheet(true);else setCollapsed(false);},
  panelBody:body,padding,
  refreshSearch:fillSearch,
 };
}
