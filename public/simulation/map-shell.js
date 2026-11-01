import {mountRecentReadings} from './recent-readings.js';
export function mountMapShell(host,map,{load,state,applyWindow}){
 document.body.classList.add('map-first');host.open=true;
 const main=document.querySelector('main'),screen=document.getElementById('screen');
 const sheet=document.createElement('section');sheet.className='map-sheet';sheet.hidden=true;sheet.setAttribute('aria-label','Map panel');
 sheet.innerHTML='<header><h2 data-panel-title></h2><button data-close aria-label="Close panel">Close</button></header><div class="sheet-content"></div>';
 main.append(sheet);const content=sheet.querySelector('.sheet-content');content.append(host,screen);
 const dock=document.createElement('nav');dock.className='map-dock';dock.setAttribute('aria-label','Map tools');
 dock.innerHTML='<div class="dock-status" role="status">Live readings · checked separately from simulation</div><div class="dock-actions"><button data-panel="routes">Routes</button><button data-panel="time">Time</button><button data-panel="options">Map options</button></div>';
 main.append(dock);
 const time=host.querySelector('.flood-time');dock.prepend(time);time.hidden=true;const key=document.createElement('div');key.className='dock-key';key.hidden=true;dock.insertBefore(key,dock.querySelector('.dock-actions'));
 const camera=host.querySelector('.flood-viewport');camera.classList.add('map-camera');main.append(camera);const locate=document.createElement('button');locate.textContent='Locate';locate.onclick=()=>{map.locate({setView:true,maxZoom:14,timeout:10000})};map.on('locationerror',()=>{dock.querySelector('.dock-status').textContent='Location unavailable · drag or zoom the map instead'});camera.append(locate);
 const body=host.querySelector('.flood-tool-body'),options=document.createElement('div');options.dataset.panelContent='options';
 while(body.firstChild)options.append(body.firstChild);body.append(options);
 const editor=document.createElement('section');editor.dataset.panelContent='time';editor.hidden=true;
 editor.innerHTML='<p>Choose the hours to browse. This does not combine flood depths across the range.</p><div class="range-presets"><button data-hours="6">6 hours</button><button data-hours="12">12 hours</button><button data-hours="all">Full span</button></div><label>Start<select data-start aria-label="Range start"></select></label><label>End<select data-end aria-label="Range end"></select></label><p data-range-message role="status"></p><div class="sheet-actions"><button data-cancel>Cancel</button><button data-apply>Apply range</button></div>';
 body.append(editor);const fitRow=document.createElement('div');fitRow.className='sheet-actions';for(const [selector,label] of [['[data-fit]','Fit flood area'],['[data-home]','Fit routes']]){const b=document.createElement('button');b.textContent=label;b.onclick=()=>{camera.querySelector(selector).click();close()};fitRow.append(b)}options.prepend(fitRow);
 const recent=document.createElement('section');recent.hidden=true;recent.dataset.panelContent='recent';body.append(recent);mountRecentReadings(recent);
 const historyButton=document.createElement('button');historyButton.textContent='Recent gauge readings';historyButton.onclick=()=>open('recent');options.append(historyButton);
 let panel=null,previousFocus=null,liveStatus='Live readings · see Routes for source freshness';
 const format=t=>new Date(t).toLocaleString('en-US',{timeZone:'America/Phoenix',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})+' MST';
 function close(){sheet.hidden=true;panel=null;document.body.classList.remove('panel-open');previousFocus?.focus();map.invalidateSize()}
 async function open(which){previousFocus=document.activeElement;panel=which;sheet.hidden=false;document.body.classList.add('panel-open');sheet.querySelector('h2').textContent=({routes:'Routes & conditions',options:'Map options',time:'Time range',recent:'Recent observations'})[which];host.hidden=which==='routes';screen.hidden=which!=='routes';body.querySelectorAll('[data-panel-content]').forEach(el=>el.hidden=el.dataset.panelContent!==which);sheet.querySelector('[data-close]').focus();
  if(which==='time'){editor.querySelector('[data-range-message]').textContent='Loading available hours…';try{await load();const s=state();for(const [name,value] of [['start',s.start],['end',s.end]]){const select=editor.querySelector('[data-'+name+']');select.replaceChildren(...s.frames.map((f,i)=>{const o=document.createElement('option');o.value=i;o.textContent=format(f.time);o.selected=i===value;return o}))}editor.querySelector('[data-range-message]').textContent='Hourly model frames · '+(s.frames.length-1)+' elapsed hours available.'}catch(e){editor.querySelector('[data-range-message]').textContent=e.message}}
 }
 dock.querySelectorAll('[data-panel]').forEach(b=>b.onclick=()=>panel===b.dataset.panel?close():open(b.dataset.panel));sheet.querySelector('[data-close]').onclick=close;editor.querySelector('[data-cancel]').onclick=close;
 editor.querySelectorAll('[data-hours]').forEach(b=>b.onclick=()=>{const s=state();if(!s.frames?.length)return;const start=Number(editor.querySelector('[data-start]').value);editor.querySelector('[data-start]').value=b.dataset.hours==='all'?0:start;editor.querySelector('[data-end]').value=b.dataset.hours==='all'?s.frames.length-1:Math.min(s.frames.length-1,start+Number(b.dataset.hours))});
 editor.querySelector('[data-apply]').onclick=()=>{const start=Number(editor.querySelector('[data-start]').value),end=Number(editor.querySelector('[data-end]').value);if(end<=start){editor.querySelector('[data-range-message]').textContent='End must be later than start.';return}applyWindow(start,end);close()};
 const model=host.querySelector('[data-model]');model.addEventListener('change',()=>{time.hidden=model.value==='off';key.hidden=model.value==='off';key.textContent=({hand:'HAND: amber flood estimate','2d':'2D: blue mean depth bands (m)',aggregate:'Blue: 2D depth (m) / amber: HAND estimate'})[model.value]??'';dock.querySelector('.dock-status').textContent=model.value==='off'?liveStatus:'Frozen Nov 1–2, 2026 · not current weather'});
 window.addEventListener('hashchange',()=>open('routes'));if(location.hash&&location.hash!=='#/')open('routes');
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!sheet.hidden)close()});
 window.addEventListener('flood-check-status',e=>{liveStatus=e.detail;if(model.value==='off')dock.querySelector('.dock-status').textContent=e.detail});
 return {open,close};
}
