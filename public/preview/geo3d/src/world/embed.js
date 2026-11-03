// Inside the app's map as its 3D layer (world.html?embed=1): only the map shows, and the app's own
// side column drives this page's controls. The app sends {fp3d:'set',id,value} or
// {fp3d:'click',id} or {fp3d:'goto',lon,lat,id}; this page answers with {fp3d:'state',...} whenever what it shows changes.
export const EMBEDDED=new URLSearchParams(location.search).get('embed')==='1';
const $=id=>document.getElementById(id);
const text=id=>$(id)?.textContent??'';
function snapshot(){
 const box=id=>({checked:$(id).checked,disabled:$(id).disabled});
 return{
  runs:[...$('run').options].map(o=>({value:o.value,label:o.textContent})),run:$('run').value,runBusy:$('run').disabled,
  note:text('run-note'),live:$('live-status').hidden?'':text('live-status'),time:text('time'),
  scrub:{max:Number($('scrub').max),value:Number($('scrub').value)},playing:$('play').getAttribute('aria-label')==='Pause',
  model:$('model').value,models:[...$('model').options].filter(o=>o.disabled).map(o=>o.value),modelNote:text('model-note'),
  rain:box('rain'),rainNow:text('rain-now'),flow:box('flow'),routes:box('show-routes'),places:box('show-places'),
  base:document.querySelector('[data-base][aria-selected="true"]')?.dataset.base??'street',
  loading:!$('loading').classList.contains('done'),step:text('loading-step'),progress:parseFloat($('loading-bar').style.width)||0,ready:$('loading').classList.contains('done')&&$('run').options.length>0&&!!text('time')&&$('error').hidden,error:$('error').hidden?'':text('error-detail'),
 };
}
export function mountEmbed(){
 if(!EMBEDDED||parent===window)return;
 document.body.classList.add('embed');
 const send=m=>parent.postMessage({fp3d:'state',...m},location.origin);
 addEventListener('message',e=>{
  if(e.origin!==location.origin||e.source!==parent||!e.data?.fp3d)return;
  if(e.data.fp3d==='goto'){window.fp3dGoto?.(e.data.lon,e.data.lat,e.data.id);return;}
  const {fp3d,id,value}=e.data,el=id==='base'?document.querySelector(`[data-base="${value==='satellite'?'satellite':'street'}"]`):$(id);
  if(!el)return;
  if(fp3d==='click'||id==='base'){el.click();return;}
  if(fp3d!=='set')return;
  if(el.type==='checkbox'){if(el.checked===!!value)return;el.checked=!!value;}
  else{if(el.value===String(value))return;el.value=String(value);}
  el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));
 });
 // Cheap enough to check four times a second; only a change is sent.
 let last='';
 const check=()=>{let s;try{s=snapshot();}catch{return;}const j=JSON.stringify(s);if(j!==last){last=j;send(s);}};
 setInterval(check,250);check();
}
