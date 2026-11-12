// The Map tab as a maps app: the map fills the screen. Search sits at the top left and the layers
// button at the top right. Zoom, locate and fit are at the bottom right, and the model run's time
// runs along the bottom. Routes, crossings and live conditions are in a side panel (a bottom sheet
// on a phone). 2D and 3D share one run, one hour and one set of layers.
import {RUNS,loadRun2d,createSimLayer,onDownloads,loadHand,flowsForRun,HAND_COLORS,loadRoads,crossingsFor,COVER_M,DEPTH_FT,DEPTH_COLORS,RAIN_MMH,RAIN_COLORS,setQuadOrder} from './simulation/sim-2d.js?v=dev';
import {deckHtml,scoreboardHtml,routeBoardHtml,drawTimeline,timelineKeyHtml,methodsHtml} from './sim-panels.js?v=dev';
import {predictFromGrid,predictFromAllRoute,routeStations,loadRoadLines,gridCellOf,routeAtFrame} from './simulation/route-prediction.js?v=dev';
import {nearestRoadSample,roadComparison,forecastComparison,comparisonLines} from './simulation/road-comparison.js?v=dev';
import {roadForecastText} from './road-forecast.js?v=dev';
import {storyEvents,storyNow,storyHtml} from './sim-story.js?v=dev';
import {toUtm} from './preview/geo3d/src/utm.js?v=dev';
import {ROUTE_INFO} from './config.js?v=dev';
import {createWorldLayer} from './simulation/world-layer.js?v=dev';
import {showAcknowledgement} from './model-acknowledgement.js?v=dev';
import {entries,onEntry,clear as clearLog,reportText,send as sendLog,crumb,record} from './diagnostics.js?v=dev';
import {current as graphicsNow,choose as chooseGraphics,lowerAuto,setActive as setGraphics,createFrameWatch,PRESET_NAMES,PRESET_LABELS} from './graphics.js?v=dev';

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
 eye:svg('M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z'),
 expand:svg('M7.41 15.41 12 10.83l4.59 4.58L18 14l-6-6-6 6z'),
 panel:svg('M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z'),
};
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]);
const MODELS=[['2d','Simulated water · SFINCS'],['hand','Modeled estimate · HAND'],['aggregate','Simulated and modeled combined'],['off','Off - no simulated water']];
const BASES=[['street','Street map'],['osm','OpenStreetMap'],['satellite','Satellite'],['terrain','Terrain detail']];
const GRAPHICS=[['auto','Automatic'],['low','Low · lightest, for older or busy computers and phones'],['medium','Medium'],['high','High'],['ultra','Ultra · sharpest, for strong graphics cards']];
const DETAILS=[['rain','Rain'],['flow','River flow'],['routes','Routes & crossings'],['places','Places'],['live','Live readings']];
const HOUR_SECONDS=4;
const clockText=t=>new Date(t).toLocaleString('en-US',{timeZone:'America/Phoenix',weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})+' MST';

export function mountMapApp({L,map,baseMaps,routeLayer,liveLayer,fitRoutes,targets,openCrossing,points=[],roadForecast=()=>null}){
 const wrap=document.querySelector('.safety-map'),mapEl=document.getElementById('map');
 const st={view:'2d',base:'street',run:RUNS[0].id,model:'2d',rain:true,flow:true,routes:true,places:true,live:true,playing:false,speed:1};
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
  <button type="button" class="mapp-fab mapp-view" data-m-ui aria-label="Show less of the controls" title="Show less of the controls">${I.eye}<span data-m-ui-label>View</span></button>
 </div>
 <button type="button" class="mapp-fab mapp-show-ui" data-m-show-ui hidden aria-label="Show the map controls">${I.eye}<span>Show controls</span></button>
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
  <p class="mapp-hint model-hint" data-m-model-hint aria-live="polite"></p>
  <fieldset class="mapp-overlap" data-m-overlap hidden><legend>Where model areas overlap, draw</legend><div class="mapp-radios" role="radiogroup" aria-label="Where model areas overlap, draw"></div><p class="mapp-hint">The all-route run is three separate models. <span data-m-overlap-diff></span> One is drawn at each place: by default the area built for the nearest route. Tap the map for both. Nothing is averaged.</p></fieldset>
  <h3>Map details</h3>
  <div class="mapp-switches">${DETAILS.map(([k,t])=>`<label><span>${t}</span><input type="checkbox" role="switch" data-m-detail="${k}" checked></label>`).join('')}</div>
  <h3>Graphics</h3>
  <div class="mapp-radios" role="radiogroup" aria-label="Graphics">${GRAPHICS.map(([v,t])=>`<label><input type="radio" name="mapp-gfx" value="${v}"> ${t}</label>`).join('')}</div>
  <p class="mapp-hint" data-m-gfx-hint aria-live="polite"></p>
  <h3>Key</h3>
  <div class="mapp-key">
   <p>Simulated water depth (ft)</p><div class="ramp">${DEPTH_COLORS.map((c,i)=>`<span><i style="background:${c}"></i>${DEPTH_FT[i]}${i===DEPTH_FT.length-1?'+':'–'+DEPTH_FT[i+1]}</span>`).join('')}</div>
   <p>Rain (in/h)</p><div class="ramp">${RAIN_COLORS.map((c,i)=>`<span><i style="background:${c}"></i>${(RAIN_MMH[i]/25.4).toFixed(2).replace(/^0/,'')}${i===RAIN_MMH.length-1?'+':''}</span>`).join('')}</div>
   <p>HAND estimated depth (ft) · Santa Cruz windows</p><div class="ramp">${HAND_COLORS.map((c,i)=>`<span><i style="background:${c}"></i>${['0–0.3','0.3–1','1–3.3','3.3–6.6','6.6–13.1','13.1+'][i]}</span>`).join('')}</div>
  </div>
  <details class="mapp-diag" data-m-diag><summary>Diagnostics <span data-m-diag-count></span></summary><p class="mapp-hint">Errors, failed downloads and freezes on this device, with what was tapped just before. Errors and freezes are sent to the developer automatically; no location or personal details are included.</p><div class="mapp-diag-actions"><button type="button" data-m-diag-send>Send log now</button><button type="button" data-m-diag-copy>Copy log</button><button type="button" data-m-diag-clear>Clear</button></div><ol class="mapp-diag-list" data-m-diag-list></ol></details>
  <details class="mapp-about"><summary>About this map</summary><div data-m-about><p>Water is each 100 m SFINCS model cell's simulated depth: the run's water surface minus the cell's mean terrain. It is a model, not observed water. Rain is the run's own rainfall input, river flow its inflow at the model's inlets. Route ratings include predicted water above the lidar road or bridge-deck height, together with gauges, county reports and weather alerts. Tap a road to compare its height with the predicted water height.</p></div></details>
 </section>
 <div class="mapp-controls">
  <button type="button" class="mapp-ctl lbl" data-m-north aria-label="Turn to north up" hidden>${I.north}<span>North</span></button>
  <div class="mapp-zoom"><button type="button" class="mapp-ctl" data-m-in aria-label="Zoom in">${I.plus}</button><button type="button" class="mapp-ctl" data-m-out aria-label="Zoom out">${I.minus}</button></div>
  <button type="button" class="mapp-ctl lbl" data-m-locate aria-label="Show my location">${I.locate}<span>Me</span></button>
  <button type="button" class="mapp-ctl lbl" data-m-fit-routes aria-label="Zoom to the routes">${I.routes}<span>Routes</span></button>
  <button type="button" class="mapp-ctl lbl" data-m-fit-water aria-label="Zoom to the deepest water">${I.water}<span>Water</span></button>
 </div>
 <div class="mapp-player" role="group" aria-label="Model run and hour">
  <div class="mapp-player-top"><select data-m-run aria-label="Model run"></select><span class="mapp-run-label" data-m-run-label hidden>Saved Nov 1–2 run · terrain detail</span><span class="mapp-stat" data-m-stat></span><button type="button" class="mapp-icon" data-m-info aria-label="About this run" aria-expanded="false">${I.info}</button><button type="button" class="mapp-icon mapp-fold" data-m-fold aria-label="Show readouts and timeline" aria-expanded="false">${I.expand}</button></div>
  <div class="mapp-hud" data-m-hud></div>
  <p class="mapp-story" data-m-story></p>
  <div class="mapp-timeline" data-m-timeline><canvas aria-hidden="true"></canvas><input type="range" data-m-scrub min="0" max="0" step="0.01" value="0" aria-label="Model hour"></div>
  <div class="mapp-tl-key">${timelineKeyHtml}</div>
  <div class="mapp-player-row"><button type="button" class="mapp-icon" data-m-prev aria-label="Previous hour">${I.prev}</button><button type="button" class="mapp-play" data-m-play aria-label="Play">${I.play}</button><button type="button" class="mapp-icon" data-m-next aria-label="Next hour">${I.next}</button><span class="mapp-sim-badge" data-m-badge>SIM</span><button type="button" class="mapp-speed" data-m-speed aria-label="Playback speed 1×. Tap to change.">1×</button><output data-m-time>Loading the model run</output></div>
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
 document.querySelector('.official-forecast-link')?.remove();
 // The risk key is drawn with the route screens, after this runs: adopt it when it appears.
 const adopt=()=>{const k=document.querySelector('details.risk-key');if(k&&!routesPane.contains(k))routesPane.append(k);};
 adopt();addEventListener('flood-screen-rendered',adopt);

 // --- panel tabs ---
 let tab=(()=>{try{return localStorage.getItem('mapp-road-tab')}catch{return null}})()||'routes';
 function setTab(k){tab=k;try{localStorage.setItem('mapp-road-tab',k)}catch{}
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
 $$('input[name=mapp-gfx]').forEach(r=>r.onchange=()=>applyGraphics(chooseGraphics(r.value),r.value==='auto'?'Automatic chosen in Map layers':'chosen in Map layers'));

 // --- graphics: sharpness and draw distance for this device (graphics.js), shared with 3D ---
 let gfx=graphicsNow();setGraphics(gfx.preset);
 record('info',`Graphics ${PRESET_LABELS[gfx.preset]} (${gfx.choice==='auto'?'automatic':'chosen'}): ${gfx.choice==='auto'?gfx.auto.reason+(gfx.cap?'; lowered after slow frames':''):'chosen in Map layers'}`,{gpu:gfx.auto.gpu});
 function applyGraphics(next,why,{tell3d=true,log=true}={}){
  const changed=next.preset!==gfx.preset;gfx=next;setGraphics(gfx.preset);
  if(changed){baseMaps.street?.redraw?.();baseMaps.satellite?.eachLayer?.(l=>l.redraw?.());if(sim.run)sim.setClock(sim.clock);drawTl();}
  if(tell3d)world.send('graphics',null,gfx.choice);
  if(log)record('info',`Graphics ${PRESET_LABELS[gfx.preset]} (${gfx.choice==='auto'?'automatic':'chosen'}): ${why}`);
  paintGraphics();
 }
 function paintGraphics(){
  for(const r of $$('input[name=mapp-gfx]'))r.checked=r.value===gfx.choice;
  const auto=PRESET_LABELS[gfx.cap&&PRESET_NAMES.indexOf(gfx.cap)<PRESET_NAMES.indexOf(gfx.auto.preset)?gfx.cap:gfx.auto.preset];
  $('[data-m-gfx-hint]').textContent=(gfx.choice==='auto'?`Automatic picked ${PRESET_LABELS[gfx.preset]} for this device: ${(gfx.auto.gpu?[gfx.auto.gpu,...gfx.auto.reason.split('; ').slice(1)]:[gfx.auto.reason]).join('; ')}.${gfx.cap?' Lowered one step after the map drew slowly here.':''}`:`${PRESET_LABELS[gfx.preset]}, chosen here. Automatic would pick ${auto}.`)+' Changes sharpness and draw distance only, not the data.'+(world.state?.graphics?.note?' '+world.state.graphics.note:'');
 }
 const frameWatch=createFrameWatch();

 // --- controls ---
 const in3d=()=>st.view==='3d';
 $('[data-m-in]').onclick=()=>in3d()?world.send('click','zoom-in'):map.zoomIn();
 $('[data-m-out]').onclick=()=>in3d()?world.send('click','zoom-out'):map.zoomOut();
 $('[data-m-north]').onclick=()=>world.send('click','north');
 $('[data-m-fit-routes]').onclick=()=>in3d()?world.send('click','fit-routes'):fitRoutes(padding());
 // A short message on the map whenever a choice has nothing new to show, with the next step.
 const toastEl=document.createElement('div');toastEl.className='mapp-toast';toastEl.hidden=true;toastEl.setAttribute('role','status');ui.append(toastEl);
 toastEl.addEventListener('click',e=>{if(e.target===toastEl||e.target.tagName==='SPAN')toastEl.hidden=true;});
 let toastTimer=0;
 function toast(msg,action){
  toastEl.innerHTML=`<span>${esc(msg)}</span>`+(action?`<button type="button">${esc(action.label)}</button>`:'');
  if(action)toastEl.querySelector('button').onclick=()=>{toastEl.hidden=true;action.run();};
  toastEl.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>toastEl.hidden=true,action?9000:5000);
 }
 const tryStorm=()=>st.run==='stress'?{label:'Try the 1,000-year what-if',run:()=>chooseRun('extreme')}:{label:'Try the 100-year storm',run:()=>chooseRun('stress')};
 $('[data-m-fit-water]').onclick=()=>{
  if(in3d())return world.send('click','fit-flood');
  const b=(st.model!=='hand'&&(sim.wetBounds(.3)??sim.wetBounds(.01)))||(st.model!=='2d'&&sim.handBounds());
  if(b){map.fitBounds(b,{...padding(),maxZoom:15});return;}
  toast(`No ${st.model==='hand'?'HAND':'simulated'} water this hour in ${runName()}.`,tryStorm());
 };
 $('[data-m-locate]').onclick=()=>{
  if(!navigator.geolocation)return toast('This browser cannot share a location.');
  toast('Finding you…');
  navigator.geolocation.getCurrentPosition(p=>{const ll=[p.coords.latitude,p.coords.longitude];map.flyTo(ll,Math.max(map.getZoom(),14),{duration:.8});
   if(locMarker)locMarker.setLatLng(ll);else locMarker=L.circleMarker(ll,{radius:8,color:'#fff',weight:3,fillColor:'#1a73e8',fillOpacity:1}).addTo(map);
   toast(sim.run&&!sim.depthAt(ll[0],ll[1])?'You are outside the model area.':'This is you.');},
   e=>toast(e.code===1?'Location is turned off for this site. Allow it in the browser to use this button.':'Your location could not be found.'),{enableHighAccuracy:true,timeout:10000});
 };
 let locMarker=null;
 const runName=()=>{const d=RUNS.find(r=>r.id===st.run);return d?.card?.short??d?.label??'this run';};

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
 // Playback speed on the 2D map: 1×, 2×, 4×, then half speed.
 const speedBtn=$('[data-m-speed]'),SPEEDS=[1,2,4,.5];
 speedBtn.onclick=()=>{st.speed=SPEEDS[(SPEEDS.indexOf(st.speed)+1)%SPEEDS.length];const label=st.speed===.5?'½×':st.speed+'×';speedBtn.textContent=label;speedBtn.setAttribute('aria-label',`Playback speed ${label}. Tap to change.`);};
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
 let crossings=null,crossingsRun=null,routePred=null,roadStations=null,story=null,storyRoutes=[];
 async function updateCrossings(){
  const run=sim.run;if(!run||crossingsRun===run)return;crossingsRun=run;crossings=null;routePred=null;story=null;renderPanels(true);
  try{const pkg=await loadRoads();if(sim.run===run)crossings=crossingsFor(run,points,pkg);}catch{if(sim.run===run)crossings=crossingsFor(run,points,null);}
  // Whole routes: every road station (or, on the all-route run, every low point) against this run's water.
  try{const stations=routeStations(await loadRoadLines());roadStations=stations;if(sim.run===run)routePred=run.quad?predictFromAllRoute(run.quad.pkg,run.quad.points,stations,run.times):predictFromGrid(run,stations,gridCellOf(run.cells.index,toUtm));}catch(e){if(sim.run===run)routePred={error:e.message};}
  if(sim.run===run){// The storyline follows whole roads first (every road station against the water), then the listed crossings.
   storyRoutes=routePred?.routes?Object.entries(routePred.routes).filter(([,r])=>r.samples?.length).map(([id,r])=>({fp:{id:'route:'+id,short:(ROUTE_INFO[id]?.name??id)+', whole road'},inside:true,road:{},route:r,over:run.times.map((_,k)=>routeAtFrame(r,k).maxOver)})):[];
   story=crossings?storyEvents([...storyRoutes,...crossings],COVER_M):null;renderPanels(true);drawTl();statKey='';hourStat();paintForecastPoints();}
 }
 const overByHour=()=>crossings&&sim.run?sim.run.times.map((_,h)=>crossings.filter(c=>c.inside&&c.over[h]>COVER_M).length):null;
 let panelKey='';
 function renderPanels(force){
  const h=Math.round(sim.clock),key=[tab,st.run,h,!!crossings,!!sim.run].join();if(!force&&key===panelKey)return;panelKey=key;
  if(tab==='scenarios'){const ls=runs.get('live')?.series;$('[data-m-deck]').innerHTML=deckHtml(RUNS,st.run,ls&&{wetKm2:Math.max(...ls.map(v=>v.wetKm2)),rainInH:Math.max(...ls.map(v=>v.rainMmH))/25.4,riverCfs:Math.max(...ls.map(v=>v.inflowM3s))*35.3147});$$('[data-sim-load]').forEach(b=>b.onclick=()=>{chooseRun(b.dataset.simLoad);if(phone())setSheet(false);});}
  if(tab==='crossings'){$('[data-m-score]').innerHTML=sim.run?storyHtml(story,sim.run.times,h)+routeBoardHtml(routePred,h,id=>ROUTE_INFO[id]?.name??id)+scoreboardHtml(crossings,h,sim.run.times):'<p class="sim-muted">Loading the model run…</p>';$$('[data-sim-story]').forEach(b=>b.onclick=()=>{const whole=storyRoutes.find(r=>r.fp.id===b.dataset.simStory),deepest=whole&&routeAtFrame(whole.route,Number(b.dataset.storyFrame)).stretches[0],fp=deepest?{lat:deepest.lat,lon:deepest.lon}:points.find(p=>p.id===b.dataset.simStory);setPlaying(false);if(!in3d()&&st.base!=='terrain')setClock(Number(b.dataset.storyFrame));if(!fp)return;if(in3d())world.goto(fp.lon,fp.lat,fp.id);else map.flyTo([fp.lat,fp.lon],15,{duration:.8});if(phone())setSheet(false);});$$('[data-sim-route-at]').forEach(b=>b.onclick=()=>{const [lat,lon]=b.dataset.simRouteAt.split(',').map(Number);if(in3d())world.goto(lon,lat);else map.flyTo([lat,lon],16,{duration:.8});});$$('[data-sim-crossing]').forEach(b=>b.onclick=()=>{const fp=points.find(p=>p.id===b.dataset.simCrossing);if(!fp)return;if(in3d())world.goto(fp.lon,fp.lat,fp.id);else map.flyTo([fp.lat,fp.lon],15,{duration:.8});});}
  if(tab==='model')$('[data-m-methods]').innerHTML=methodsHtml(sim.run,crossings);
 }
 // How much water the model has this hour, so a dry hour reads as dry rather than as missing.
 let statKey='';
 function hourStat(){
  const run=sim.run,el=$('[data-m-stat]'),hud=$('[data-m-hud]');
  const storyLine=$('[data-m-story]');
  if(!run||(st.base==='terrain'&&!in3d())){el.textContent='';hud.innerHTML='';storyLine.textContent='';statKey='';return;}
  const h=Math.round(sim.clock),key=run.def.id+h+!!crossings+st.model;if(key===statKey)return;statKey=key;$('[data-m-model-hint]').textContent=modelStatus();
  const s=run.series[h],inside=crossings?.filter(c=>c.inside)??[],over=inside.filter(c=>c.over[h]>COVER_M).length;
  el.textContent=s.wetKm2?'':'No simulated water this hour';
  storyLine.textContent=run.def.live?'':storyNow(story,crossings&&[...storyRoutes,...crossings],h,COVER_M);
  const chip=(label,value,unit,cls='')=>`<div class="chip ${cls}"><span>${label}</span><b>${value}</b><small>${unit}</small></div>`;
  const dryLive=run.def.live&&Math.max(...run.series.map(v=>v.wetKm2))<.05;
  hud.innerHTML=chip('Wet area',s.wetKm2.toFixed(s.wetKm2<10?2:1),'km²')+chip('Deepest cell',(s.deepM/.3048).toFixed(1),'ft')+chip('Over the road',crossings?`${over}/${inside.length}`:'…','crossings',over?'alert':'')+(Number.isNaN(s.inflowM3s)?'':chip('River in',Math.round(s.inflowM3s*35.3147).toLocaleString(),'ft³/s'))+(Number.isNaN(s.rainMmH)?'':chip('Rain',(s.rainMmH/25.4).toFixed(2),'in/h'))+(run.quad?chip('Model areas',`${run.quad.cases.length-run.quad.missingAt(h).length}/${run.quad.cases.length}`,'with a result',run.quad.missingAt(h).length?'alert':''):'')+((st.model==='hand'||st.model==='aggregate')?(()=>{const hn=sim.handNow();return hn&&!hn.loading?chip('HAND',`${hn.wet}/${hn.windows}`,'windows wet',hn.wet?'hand':''):chip('HAND','…','loading');})():'')+(dryLive?'<button type="button" class="chip try" data-m-try>Dry right now. Try the 100-year storm →</button>':'');
  hud.querySelector('[data-m-try]')?.addEventListener('click',()=>chooseRun('stress'));
  renderPanels();
 }
 let last=performance.now();
 (function tick(now){
  const dt=Math.min(.25,(now-last)/1000);last=now;speedBtn.hidden=in3d()||st.base==='terrain';
  if(st.playing&&!in3d()&&st.base!=='terrain'&&sim.run&&location.hash==='#/map'){let c=sim.clock+dt*st.speed/(HOUR_SECONDS*(sim.run.frameHours??1));if(c>sim.run.times.length-1)c=0;setClock(c);
   // Playing is the 2D map's busiest drawing: slow frames there lower an automatic choice a step.
   if(document.visibilityState==='visible'&&frameWatch.add(dt*1000,now)){const before=gfx.preset,next=lowerAuto();if(next.preset!==before)applyGraphics(next,`frames stayed slower than 25 per second on ${PRESET_LABELS[before]} while the 2D map played`);else{record('info',`Frames stayed slower than 25 per second on ${PRESET_LABELS[before]} on the 2D map`);frameWatch.reset(now+60000);}}}
  else frameWatch.reset(now);
  requestAnimationFrame(tick);
 })(last);

 // A run opens at the hour nearest now when it is live, otherwise at its deepest water.
 function openingHour(run){
  if(run.def.live){const now=Date.now();return run.times.reduce((b,t,k)=>Math.abs(t-now)<Math.abs(run.times[b]-now)?k:b,0);}
  if(run.quad)return run.series.reduce((b,v,k)=>v.wetKm2>run.series[b].wetKm2?k:b,0);
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
   showAcknowledgement(def.live?'modelRun':'savedRun');updateCrossings();renderPanels(true);if(handOn())ensureHand();
  }catch(error){
   if(ticket!==loadingRun)return;
   if(def.live){runNote=`No live model run to show: ${error.message} Showing a saved run instead.`;loadingRun=null;return chooseRun('13z');}
   if(!in3d())timeOut.textContent='The model run could not load';loadError={def,message:error.message};
  }finally{if(ticket===loadingRun){loadingRun=null;loadingDef=null;describe();paintCard();}}
 }
 function describe(){
  const run=sim.run;note.textContent=in3d()?(world.state?.note??''):st.base==='terrain'?'Terrain detail: the saved Nov 1–2 run drawn on 10 m terrain by the flat renderer. Its own time and case controls are in Map layers.':runNote||run?.def.note||'';
  for(const r of $$('input[name=mapp-model]')){r.disabled=false;r.checked=r.value===st.model;}
  paintOverlap();
  $('[data-m-model-hint]').textContent=modelStatus();
 }
 // The all-route run: which model area is drawn where areas overlap. The 3D view follows.
 const overlapBox=$('[data-m-overlap]');
 function paintOverlap(){
  const q=sim.run?.quad;overlapBox.hidden=!q;if(!q)return;
  // The measured difference belongs to the saved run; a live run has no such measurement.
  $('[data-m-overlap-diff]').textContent=q.pkg.overlap?`Where Northern and Picture Rocks overlap they differ by up to ${q.pkg.overlap.maximumDifferenceM.toFixed(2)} m (${(q.pkg.overlap.maximumDifferenceM/.3048).toFixed(1)} ft) at the same place and time.`:'Where two areas overlap they can differ at the same place and time.';
  const box=overlapBox.querySelector('.mapp-radios');
  if(box.dataset.run!==sim.run.def.id){box.dataset.run=sim.run.def.id;box.innerHTML=`<label><input type="radio" name="mapp-overlap" value="nearest"> The area built for the nearest route</label>`+q.cases.map(c=>`<label><input type="radio" name="mapp-overlap" value="${c.key}"> ${esc(c.label.split(':')[0])} first</label>`).join('');
   box.querySelectorAll('input').forEach(r=>r.onchange=()=>setOverlap(r.value));}
  box.querySelectorAll('input').forEach(r=>r.checked=r.value===q.mode);
 }
 function setOverlap(first){
  const run=sim.run;if(!run?.quad)return;
  setQuadOrder(run,first);
  if(in3d())world.send('set','overlap',first);
  statKey='';sim.setClock(sim.clock);hourStat();drawTl();paintOverlap();
 }
 sim.onError(e=>toast('A frame of the model run did not download: '+e.message));
 // What the chosen model shows right now, in one sentence.
 function modelStatus(){
  const run=sim.run;if(!run)return'';
  const h=Math.min(run.times.length-1,Math.round(sim.clock)),s=run.series[h],name=runName();
  let sfincs=s.wetKm2?`SFINCS: ${s.wetKm2.toFixed(s.wetKm2<10?2:1)} km² of simulated water this ${run.quad?'frame':'hour'} in ${name}.`:`SFINCS: no simulated water this hour in ${name}.`;
  if(run.quad){const gone=run.quad.missingAt(h);if(gone.length)sfincs+=` ${gone.map(c=>c.label.split(':')[0]).join(', ')}: no result for this frame.`;}
  const hn=sim.handNow();let hand='';
  if(!hn||hn.loading)hand='HAND: loading the NOAA HAND grids and river flows…';
  else{
   const withFlow=hn.windows-hn.noFlow;
   hand=hn.wet?`HAND: water in ${hn.wet} of ${hn.windows} windows this hour, ${(hn.areaM2/1e6).toFixed(2)} km².`:`HAND: no water in any of the ${withFlow} windows with a flow this hour.`;
   hand+=` Flows: ${hn.source}.`;
   if(hn.noFlow)hand+=` ${hn.noFlow} wash window${hn.noFlow>1?'s have':' has'} no flow in this run (dashed outline).`;
   if(hn.beyond)hand+=` ${hn.beyond} beyond their rating curves.`;
  }
  return st.model==='2d'?sfincs:st.model==='hand'?hand:st.model==='aggregate'?sfincs+' '+hand:'Simulated and modeled water are hidden. Routes and live readings stay.';
 }

 // --- applying choices ---
 let handLoading=null;
 // The HAND windows once, then the flows for whichever run is loaded.
 function ensureHand(){
  handLoading??=loadHand().then(list=>{sim.setJunctions(list);return list;}).catch(e=>{handLoading=null;toast('The NOAA HAND grids did not download: '+e.message);throw e;});
  const run=sim.run;
  return handLoading.then(list=>run?flowsForRun(run,list).then(f=>{if(sim.run===run){sim.setFlows(run,f);statKey='';hourStat();describe();}return f;},e=>{toast('River flows for HAND did not download: '+e.message);}):null).catch(()=>null);
 }
 const handOn=()=>st.model==='hand'||st.model==='aggregate';
 function applyModel(){
  if(in3d())world.send('set','model',st.model);
  sim.set('water',st.model==='2d'||st.model==='aggregate');sim.set('hand',st.model==='hand'||st.model==='aggregate');
  statKey='';hourStat();
  const say=()=>{const m=modelStatus();if(/no simulated water|no water in any/.test(m))toast(m,tryStorm());else toast(m);};
  if(st.model==='hand'||st.model==='aggregate')ensureHand().then(say);else say();
  if(st.base==='terrain'){const m=document.querySelector('[data-model]');if(m&&st.model!==m.value){m.value=st.model==='hand'?'hand':st.model==='aggregate'?'aggregate':st.model==='off'?'off':'2d';m.dispatchEvent(new Event('change'));}}
  describe();
 }
 function applyDetails(key){
  const keys=key?[key]:DETAILS.map(d=>d[0]);
  for(const k of keys){
   const on=st[k];
   if(k==='rain'){sim.set('rain',on);if(in3d())world.send('set','rain',on);if(on&&key&&sim.run){const s=sim.run.series,h=Math.round(sim.clock),wet=s.map((v,i)=>v.rainMmH>.1?i:-1).filter(i=>i>=0);
    if(sim.run.quad)toast(`${runName()}: its HRRR rain input is not in the map package, so no rain is drawn.`);
    else if(!sim.run.rain||!wet.length)toast(`No rain input in ${runName()}.`,tryStorm());else if(s[h].rainMmH<=.1)toast(`No rain this hour. Rain falls ${clockText(sim.run.times[wet[0]])} to ${clockText(sim.run.times[wet.at(-1)])} in this run.`,{label:'Go to the rain',run:()=>{setPlaying(false);setClock(wet[0]);}});}}
   if(k==='flow'){sim.set('flow',on);if(in3d())world.send('set','flow',on);if(on&&key&&sim.run&&!sim.run.inflow.length)toast(sim.run.quad?`${runName()}: its river inflows are not in the map package.`:`No river inflow in ${runName()}.`,sim.run.quad?undefined:tryStorm());}
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
   setLayersOpen(false);
   pending3d=true;world.load(st.run);world.park();
   if(world.ready)enter3d();else{paintCard();sync();}
   return;
  }
  if(pending3d){pending3d=false;world.park();paintCard();sync();return;}
  if(st.view!=='3d')return;
  const from3d=world.state;st.view='2d';world.hide();
  if(from3d?.run&&from3d.run!==st.run)chooseRun(from3d.run).then(()=>setClock(from3d.scrub.value));
  else if(sim.run?.def.id!==st.run)chooseRun(st.run);
  else if(from3d)setClock(from3d.scrub.value);
  paintCard();sync();
 }
 function enter3d(){
  crumb('3D shown');
  pending3d=false;st.view='3d';setPlaying(false);world.show(true);showAcknowledgement('simulated');pushTo3d();paintCard();sync();
 }
 // The run this page asked the 3D view for: older reports from it are not taken as a choice.
 let expectRun=null,expectAt=0,pendingHour=null,lastGfxNote='';
 function pushTo3d(){
  pendingHour=Math.round(sim.clock);
  expectRun=st.run;expectAt=performance.now();world.send('set','run',st.run);world.send('set','base',st.base==='satellite'?'satellite':'street');world.send('set','model',st.model);
  for(const [k,id] of [['rain','rain'],['flow','flow'],['routes','show-routes'],['places','show-places']])world.send('set',id,st[k]);
  if(sim.run?.quad)world.send('set','overlap',sim.run.quad.mode);
 }
 // The 3D view reports what it shows; the player and layers follow it while 3D is on.
 function fromWorld(s){
  // The 3D view lowered an automatic choice after slow frames: follow it here too.
  if(s.graphics&&(s.graphics.preset!==gfx.preset||s.graphics.note!==lastGfxNote)){lastGfxNote=s.graphics.note;const next=graphicsNow();if(next.preset!==gfx.preset)applyGraphics(next,'',{tell3d:false,log:false});else paintGraphics();}
  if(pending3d){if(s.ready&&location.hash==='#/map')enter3d();else{paintCard();sync();}return;}
  if(!in3d())return;
  if(s.failed||s.error){paintCard();}
  timeOut.textContent=s.error?'The 3D view could not load':s.time||'Loading the 3D view';
  if(s.playing!==st.playing)setPlaying(s.playing);
  // The run asked for: wait for it, unless the 3D view settled on another (a stale live run).
  if(expectRun&&(performance.now()-expectAt>20000||(!s.runBusy&&!s.loading&&s.run!==expectRun&&performance.now()-expectAt>1500)))expectRun=null;
  if(expectRun){if(s.run===expectRun)expectRun=null;else{paintCard();return;}}
  if(pendingHour!=null&&s.ready&&s.run===st.run){world.send('set','scrub',Math.min(pendingHour,s.scrub.max));pendingHour=null;}
  if(s.run!==runSel.value&&RUNS.some(r=>r.id===s.run)){st.run=s.run;runSel.value=s.run;}
  if(s.run!==sim.run?.def.id&&RUNS.some(r=>r.id===s.run)&&!loadingRun)chooseRun(s.run);
  scrub.max=String(s.scrub.max);if(document.activeElement!==scrub)scrub.value=String(s.scrub.value);
  if(sim.run&&sim.run.def.id===s.run){sim.setClock(Math.min(sim.run.times.length-1,s.scrub.value));hourStat();drawTl();}
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
 const card=document.createElement('div');card.className='mapp-load';card.hidden=true;
 card.innerHTML='<span class="sr-only" role="status" data-l-sr></span><div class="mapp-load-head"><span class="mapp-spin" aria-hidden="true"></span><strong data-l-title></strong><span class="mapp-load-time" data-l-time aria-hidden="true"></span></div><p data-l-step></p><div class="mapp-load-bar"><i data-l-bar></i></div><div class="mapp-load-actions"><button type="button" data-l-retry hidden>Try again</button><button type="button" data-l-cancel>Cancel</button></div>';
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
  // Screen readers hear the title and failures, not every byte.
  const said=title+((failed3d||retry)?'. '+step:'');if(c$('[data-l-sr]').textContent!==said)c$('[data-l-sr]').textContent=said;
  c$('[data-l-bar]').style.width=Math.max(4,Math.round(share*100))+'%';
  c$('[data-l-retry]').hidden=!retry;c$('[data-l-cancel]').hidden=!cancel;
  c$('[data-l-cancel]').textContent=pending3d?'Stay in 2D':loadError?'Close':'Cancel';
 }
 setInterval(()=>{if(card.hidden)return;const s=pending3d?world.seconds:Math.round((performance.now()-loadStarted)/1000);c$('[data-l-time]').textContent=s>=2?s+' s':'';},500);
 c$('[data-l-cancel]').onclick=()=>{
  if(pending3d){pending3d=false;world.cancel();}
  else if(loadingDef){loadingRun=null;const keep=sim.run?.def.id,was=loadingDef;loadingDef=null;
   if(keep){st.run=keep;runSel.value=keep;loadError=null;}
   else{loadError={def:was,message:'Loading was cancelled.'};timeOut.textContent='No model run loaded';}
   renderMenu();paintCard();sync();return;}
  loadError=null;paintCard();sync();
 };
 c$('[data-l-retry]').onclick=()=>{if(pending3d){world.retry();paintCard();}else if(loadError){const d=loadError.def;loadError=null;chooseRun(d.id);}};

 // --- the scenario menu: every run, one tap ---
 const menu=document.createElement('div');menu.className='mapp-menu';menu.hidden=true;menu.setAttribute('role','menu');menu.setAttribute('aria-label','Scenarios');ui.append(menu);
 const scenBtn=$('[data-m-scenarios]');scenBtn.setAttribute('aria-haspopup','menu');scenBtn.setAttribute('aria-expanded','false');
 function renderMenu(){
  menu.innerHTML=RUNS.map(r=>{const c=r.card??{},on=r.id===st.run;
   const stats=r.live?'Updates every hour':c.rainInH==null?`${c.wetKm2} km² wet · ${c.areas} model areas, 6.25 m cells`:`${c.rainInH} in/h rain · ${Math.round(c.riverCfs).toLocaleString()} ft³/s river · ${c.wetKm2} km² wet`;
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
 menu.addEventListener('focusout',e=>{if(!menu.hidden&&e.relatedTarget&&!menu.contains(e.relatedTarget)&&e.relatedTarget!==scenBtn)setMenu(false);});
 addEventListener('blur',()=>{if(!menu.hidden)setMenu(false);});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!menu.hidden){setMenu(false);scenBtn.focus();}});
 renderMenu();

 // --- diagnostics ---
 const diagList=$('[data-m-diag-list]'),diagCount=$('[data-m-diag-count]');
 const KIND={info:'Info',error:'Error',freeze:'Freeze',fetch:'Download',slow:'Slow','3d':'3D','3d-failed':'3D failed',console:'Console',open:'Opened'};
 function paintDiag(){
  const list=entries(),bad=list.filter(e=>!['open','3d','info'].includes(e.kind));
  diagCount.textContent=bad.length?`· ${bad.length}`:'';diagCount.className=bad.length?'bad':'';
  diagList.innerHTML=list.slice(-40).reverse().map(e=>`<li class="k-${e.kind}"><b>${KIND[e.kind]??e.kind}</b> <time>${e.t.slice(11,19)}</time> ${esc(e.message)}${e.action&&e.kind!=='open'?`<small>after: ${esc(e.action)}</small>`:''}</li>`).join('')||'<li>Nothing logged.</li>';
 }
 onEntry(()=>{if(!$('[data-m-diag]').open){const list=entries();diagCount.textContent=list.filter(e=>!['open','3d','info'].includes(e.kind)).length?`· ${list.filter(e=>!['open','3d','info'].includes(e.kind)).length}`:'';return;}paintDiag();});
 $('[data-m-diag]').addEventListener('toggle',paintDiag);
 $('[data-m-diag-send]').onclick=async()=>{const ok=await sendLog({kind:'report',message:'Sent from the map'},{force:true});toast(ok?'Log sent to the developer.':'The log could not be sent. Use Copy log instead.');};
 $('[data-m-diag-copy]').onclick=async()=>{try{await navigator.clipboard.writeText(reportText());toast('Log copied.');}catch{toast('Copying is blocked here.');}};
 $('[data-m-diag-clear]').onclick=()=>{clearLog();paintDiag();};
 paintDiag();

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
  describe();paintForecastPoints();
 }

 // Current scored forecast points stay on the main map, using the same route records as
 // the scores. The popup gives the forecast peak time, not the coarse map player's hour.
 const forecastPoints=L.layerGroup();let forecastPointsKey='';
 function paintForecastPoints(){
  const active=location.hash==='#/map'&&!in3d()&&st.base!=='terrain'&&st.model!=='off'&&st.model!=='hand'&&st.run==='live';
  if(!active){map.removeLayer(forecastPoints);return;}
  map.addLayer(forecastPoints);
  const forecast=roadForecast(),key=forecast?.status+JSON.stringify(forecast?.routes??{})+!!roadStations;
  if(key===forecastPointsKey)return;forecastPointsKey=key;forecastPoints.clearLayers();
  if(forecast?.status!=='ok')return;
  for(const [id,r] of Object.entries(forecast.routes??{})){
   if(!Number.isFinite(r.lat)||!Number.isFinite(r.lon))continue;
   const comparison=forecastComparison(r,roadStations?.get(id));
   const value=r.maxOver>0?(r.maxOver/.3048<.01?'<0.01':(r.maxOver/.3048).toFixed(2))+' ft':'No water over road';
   const icon=L.divIcon({className:'road-forecast-pin',html:`<span data-road-comparison="${comparison.status}" class="${r.maxOver>0?'wet':'dry'}">${esc(value)}</span>`,iconSize:[0,0]});
   L.marker([r.lat,r.lon],{icon,bubblingMouseEvents:false,title:ROUTE_INFO[id]?.name??id})
    .bindPopup(`<strong>${esc(ROUTE_INFO[id]?.name??id)}</strong><br>${esc(roadForecastText(r))}<br><small>${r.time==null?'Forecast window':`Peak ${esc(clockText(r.time))}`} · issued ${esc(clockText(r.issuedAt))}</small><hr>${comparisonLines(comparison).map(esc).join('<br>')}<br><small>Same forecast used in this route’s score. Heights use NAVD88.</small>`,{className:'mapp-popup road-comparison'})
    .addTo(forecastPoints);
  }
 }
 addEventListener('flood-screen-rendered',paintForecastPoints);

 // Tap the 2D map for the simulated depth there.
 map.on('click',e=>{
  if(location.hash!=='#/map'||in3d()||st.base==='terrain'||st.model==='off'||st.model==='hand'||!sim.run)return;
  const station=nearestRoadSample(routePred,{lat:e.latlng.lat,lon:e.latlng.lng});
  const t=clockText(sim.time());
  if(station){const r=roadComparison(station,Math.round(sim.clock));L.popup({className:'mapp-popup road-comparison'}).setLatLng(e.latlng).setContent(`<strong>${esc(ROUTE_INFO[station.routeId]?.name??station.routeId)}</strong><br>${comparisonLines(r).map(esc).join('<br>')}<br><small>${esc(sim.run.def.live?'Current coarse SFINCS map frame':'Selected SFINCS run')} · ${clockText(sim.run.times[Math.round(sim.clock)])}</small>`).openOn(map);return;}
  const hit=sim.depthAt(e.latlng.lat,e.latlng.lng);
  if(!hit){L.popup({className:'mapp-popup'}).setLatLng(e.latlng).setContent(`Outside the model area · ${t}`).openOn(map);return;}
  if(hit.quad){
   const line=v=>`<b>${esc(v.label.split(':')[0])}</b>: ${!v.hasFrame?'no result for this frame':!v.loaded?'loading…':v.depth/.3048<.03?'no simulated water':`${(v.depth/.3048).toFixed(v.depth/.3048<1?2:1)} ft`} <span>(${v.sizeM} m cell${v.drawn?', drawn':''})</span>`;
   L.popup({className:'mapp-popup'}).setLatLng(e.latlng).setContent(`Simulated water · ${t}<br>${hit.quad.map(line).join('<br>')}<br><span>SFINCS cell average (stored water / cell area), not a measured road depth.${hit.quad.length>1?' Separate model areas, shown side by side, not averaged.':''}</span>`).openOn(map);
   return;
  }
  const ft=hit.depth/.3048;
  L.popup({className:'mapp-popup'}).setLatLng(e.latlng).setContent(Number.isNaN(hit.depth)?`No model result here · ${t}`:ft<.03?`No simulated water here · ${t}`:`<strong>${ft<1?ft.toFixed(2):ft.toFixed(1)} ft</strong> simulated water · ${t}<br><span>SFINCS cell average over 100 m, not a measured road depth.</span>`).openOn(map);
 });

 // Only the Map tab shows the model layers; the other screens keep their live map.
 // --- how much of the interface shows: everything, the map with a slim time bar, or the map alone ---
 const UI_MODES=['full','focus','none'];
 const UI_NEXT={full:'Show less of the controls',focus:'Hide all controls',none:'Show the map controls'};
 let uiMode=(()=>{try{return localStorage.getItem('mapp-ui')}catch{return null}})();if(!UI_MODES.includes(uiMode))uiMode='full';
 function setUi(mode){
  uiMode=mode;try{localStorage.setItem('mapp-ui',mode)}catch{}
  ui.classList.toggle('ui-focus',mode==='focus');ui.classList.toggle('ui-none',mode==='none');
  document.body.classList.toggle('mapp-bare',mode==='none'&&location.hash==='#/map');
  const b=$('[data-m-ui]');b.setAttribute('aria-label',UI_NEXT[mode]);b.title=UI_NEXT[mode];$('[data-m-ui-label]').textContent=mode==='full'?'Less':'Hide all';
  $('[data-m-show-ui]').hidden=mode!=='none';
  if(mode!=='full')setLayersOpen(false);
  requestAnimationFrame(()=>map.invalidateSize());
 }
 $('[data-m-ui]').onclick=()=>setUi(uiMode==='full'?'focus':'none');
 $('[data-m-show-ui]').onclick=()=>setUi('full');
 // On a phone the time bar starts as one row; the readouts and timeline open on request.
 let folded=matchMedia('(max-width: 899px)').matches;
 function setFold(f){folded=f;ui.classList.toggle('player-folded',f);const b=$('[data-m-fold]');b.setAttribute('aria-expanded',String(!f));b.setAttribute('aria-label',f?'Show readouts and timeline':'Hide readouts and timeline');if(!f)requestAnimationFrame(drawTl);}
 $('[data-m-fold]').onclick=()=>setFold(!folded);
 setFold(folded);

 function onRoute(){
  const on=location.hash==='#/map';document.body.classList.toggle('mapp-on',on);document.body.classList.toggle('mapp-bare',on&&uiMode==='none');
  if(on&&pending3d&&world.ready)enter3d();
  else if(on&&in3d())world.show(true);else if(pending3d)world.park();else world.hide();
  if(!on){setLayersOpen(false);if(st.base==='terrain')window.dispatchEvent(new CustomEvent('flood-terrain-detail',{detail:false}));}
  else if(st.base==='terrain')window.dispatchEvent(new CustomEvent('flood-terrain-detail',{detail:true}));
  sync();map.invalidateSize();
  if(on&&!sim.run&&!loadingRun)chooseRun(st.run);
 }
 addEventListener('hashchange',onRoute);
 setPlaying(false);setTab(tab);paintGraphics();setUi(uiMode);onRoute();
 return{
  // Bring a crossing's card into view: beside the map, or up from the bottom on a phone.
  reveal(){setTab('routes');if(phone())setSheet(true);else setCollapsed(false);},
  panelBody:body,padding,
  refreshSearch:fillSearch,
 };
}
