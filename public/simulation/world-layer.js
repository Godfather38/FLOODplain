// The 3D map as a layer of the app's map. Choosing 3D in Layers & view puts the 3D model view
// (preview/geo3d/world.html, embedded) in a frame over the map, and the side column's controls
// drive it: model run and time, model, rain, river flow, routes, base map, fit and zoom.
// 2D keeps its own settings; going back to 2D shows them as they were.
const FORWARD={'[data-model]':'model','[data-rain]':'rain','[data-flow]':'flow','[data-routes]':'show-routes','[data-places]':'show-places'};
const CLICKS={'[data-fit]':'fit-flood','[data-home]':'fit-routes','[data-in]':'zoom-in','[data-out]':'zoom-out'};
const PLAY='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>',PAUSE='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>';
export function mountWorldLayer({src='preview/geo3d/world.html?embed=1',onChange=()=>{}}={}){
 const q=s=>document.querySelector(s),qa=s=>[...document.querySelectorAll(s)];
 let frame=null,on=false,state=null,first=true,saved=null;
 const block=document.createElement('section');block.className='world-run';block.hidden=true;block.setAttribute('aria-label','3D model run and time');
 block.innerHTML=`<select data-w-run class="run-select" aria-label="3D model run"></select><p data-w-note class="meta"></p><p data-w-live class="meta"></p><output data-w-time class="clock">Loading the 3D view</output><div class="time-row"><button type="button" data-w-prev class="icon-btn step" aria-label="Previous hour">←</button><button type="button" data-w-play class="icon-btn play" aria-label="Pause">${PAUSE}</button><button type="button" data-w-next class="icon-btn step" aria-label="Next hour">→</button><input data-w-scrub type="range" min="0" max="0" step="1" value="0" aria-label="Model hour"></div><p data-w-rain-now class="meta"></p><label class="world-places"><input data-places type="checkbox" checked> Places</label>`;
 const send=(fp3d,id,value)=>frame?.contentWindow?.postMessage({fp3d,id,value},location.origin);
 const b=s=>block.querySelector(s);
 b('[data-w-run]').onchange=e=>send('set','run',e.target.value);
 b('[data-w-prev]').onclick=()=>send('click','prev');b('[data-w-next]').onclick=()=>send('click','next');b('[data-w-play]').onclick=()=>send('click','play');
 b('[data-w-scrub]').oninput=e=>send('set','scrub',e.target.value);
 // Places only the 3D view draws, so its switch sits with Rain, River flow and Routes while 3D is on.
 const places=b('.world-places');
 function place(){if(block.isConnected)return;const time=q('.flood-time');if(time)time.before(block);else q('.map-side .run-card')?.append(block);q('[data-routes]')?.closest('label')?.after(places);}
 // Only the map tab shows the 3D layer; other screens keep the 2D map they use.
 const visible=()=>on&&location.hash==='#/map';
 function show(){
  place();const v=visible();
  if(frame)frame.hidden=!v;
  document.body.classList.toggle('world3d-on',v);
  block.hidden=!on;places.hidden=!on;
  for(const s of ['.flood-time','.flood-tag','[data-case]']){const el=q(s);const box=s==='[data-case]'?el?.closest('.flood-row'):el;if(box)box.hidden=on;}
  for(const x of qa('[data-view]'))x.setAttribute('aria-selected',String((x.dataset.view==='3d')===on));
  q('[data-3d-world]')?.setAttribute('aria-pressed',String(on));
 }
 function boxes(){return Object.keys(FORWARD).map(s=>q(s)).filter(Boolean);}
 function enter(){
  if(on)return;on=true;
  saved=boxes().map(el=>({el,checked:el.checked,disabled:el.disabled,value:el.value,options:[...(el.options??[])].map(o=>o.disabled)}));
  if(!frame){
   frame=document.createElement('iframe');frame.className='world-layer';frame.title='3D model view';frame.src=src;frame.allow='fullscreen';
   document.getElementById('map').append(frame);first=true;
  }
  if(state)mirror(state);
  show();onChange(true);
 }
 function leave(){
  if(!on)return;on=false;
  for(const s of saved??[]){s.el.checked=s.checked;s.el.disabled=s.disabled;s.el.value=s.value;[...(s.el.options??[])].forEach((o,i)=>o.disabled=s.options[i]);}
  show();onChange(false);
 }
 // The side column shows what the 3D view shows.
 function mirror(s){
  const run=b('[data-w-run]');
  if(run.options.length!==s.runs.length||[...run.options].some((o,i)=>o.value!==s.runs[i].value))run.innerHTML=s.runs.map(r=>`<option value="${r.value}">${r.label.replace(/[<&]/g,c=>c==='<'?'&lt;':'&amp;')}</option>`).join('');
  run.value=s.run;run.disabled=s.runBusy;
  b('[data-w-note]').textContent=s.note;b('[data-w-live]').textContent=s.live;b('[data-w-live]').hidden=!s.live;
  b('[data-w-time]').textContent=s.error?'The 3D view could not load':s.time||'Loading the 3D view';
  const scrub=b('[data-w-scrub]');scrub.max=String(s.scrub.max);if(document.activeElement!==scrub)scrub.value=String(s.scrub.value);
  const play=b('[data-w-play]');if(play.dataset.playing!==String(s.playing)){play.dataset.playing=String(s.playing);play.innerHTML=s.playing?PAUSE:PLAY;play.setAttribute('aria-label',s.playing?'Pause':'Play');}
  b('[data-w-rain-now]').textContent=s.rainNow;
  if(!on)return;
  const model=q('[data-model]');if(model){for(const o of model.options)o.disabled=s.models.includes(o.value);model.value=s.model;}
  for(const [sel,key] of [['[data-rain]','rain'],['[data-flow]','flow'],['[data-routes]','routes'],['[data-places]','places']]){const el=q(sel);if(el){el.checked=s[key].checked;el.disabled=s[key].disabled;}}
 }
 addEventListener('message',e=>{
  if(e.origin!==location.origin||!frame||e.source!==frame.contentWindow||e.data?.fp3d!=='state')return;
  state=e.data;
  // Once loaded, the 3D view takes the base map and routes the 2D map shows.
  if(first&&state.time){first=false;const base=q('[data-base][aria-selected="true"]')?.dataset.base;if(base)send('set','base',base);const r=saved?.find(x=>x.el.matches('[data-routes]'));if(r)send('set','show-routes',r.checked);}
  mirror(state);
 });
 // While 3D is on, these controls drive the 3D view and leave the 2D map's settings alone.
 addEventListener('change',e=>{
  if(!on)return;const hit=Object.entries(FORWARD).find(([s])=>e.target.matches?.(s));
  if(!hit)return;e.stopImmediatePropagation();send('set',hit[1],e.target.type==='checkbox'?e.target.checked:e.target.value);
 },true);
 addEventListener('click',e=>{
  const view=e.target.closest?.('[data-view],[data-3d-world]');
  if(view){e.preventDefault();const want=view.dataset.view?view.dataset.view==='3d':!on;want?enter():leave();return;}
  if(!on||!visible())return;
  const base=e.target.closest?.('[data-base]');if(base){send('set','base',base.dataset.base);return;}
  const hit=Object.entries(CLICKS).find(([s])=>e.target.closest?.(s));
  if(hit){e.preventDefault();e.stopImmediatePropagation();send('click',hit[1]);}
 },true);
 addEventListener('hashchange',show);
 return{enter,leave,get on(){return on;}};
}
