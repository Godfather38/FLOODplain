// The 3D map as a layer of the app's map: the 3D model view (preview/geo3d/world.html, embedded)
// in a frame over the map. It loads out of sight, so the 2D map keeps working, and shows only once
// it is ready. The map's own controls drive it through send() and goto(); it reports what it shows
// (loading step, run, hour, layers) through onState.
const QUIET_MS=20000;
export function createWorldLayer({container,src='preview/geo3d/world.html?embed=1',onState=()=>{}}){
 let frame=null,state=null,started=0,lastHeard=0,watch=0;
 const emit=extra=>onState({...state,...extra});
 addEventListener('message',e=>{
  if(e.origin!==location.origin||!frame||e.source!==frame.contentWindow||e.data?.fp3d!=='state')return;
  state={...state,...e.data,quiet:false};lastHeard=performance.now();emit({});
 });
 const post=m=>frame?.contentWindow?.postMessage(m,location.origin);
 // A frame that says nothing for a while is reported as quiet, with the step it was last on.
 function startWatch(){
  clearInterval(watch);
  watch=setInterval(()=>{if(!frame||state?.ready||state?.failed||state?.error)return;if(performance.now()-lastHeard>QUIET_MS&&!state?.quiet){state={...state,quiet:true};emit({});}},2000);
 }
 let wantRun=null;
 function create(){
  frame=document.createElement('iframe');frame.className='world-layer warming';frame.title='3D model view';frame.src=src+(wantRun?'&run='+encodeURIComponent(wantRun):'');frame.allow='fullscreen';
  state={loading:true,step:'Downloading the 3D view',progress:0};started=lastHeard=performance.now();
  container.append(frame);startWatch();emit({});
 }
 return{
  // Start loading without showing it.
  load(run){if(run)wantRun=run;if(!frame)create();},
  show(on){if(on&&!frame)create();if(frame){frame.hidden=!on&&!frame.classList.contains('warming');frame.classList.toggle('warming',!on&&!state?.ready);if(on)frame.classList.remove('warming');post({fp3d:'pause',value:!on});}},
  // Out of sight but still loading (or ready, waiting to be shown).
  park(){if(frame){frame.classList.add('warming');frame.hidden=false;}},
  // Out of sight and not drawing: a ready view nobody is waiting for costs nothing.
  hide(){if(frame){frame.hidden=true;frame.classList.remove('warming');post({fp3d:'pause',value:true});}},
  cancel(){clearInterval(watch);frame?.remove();frame=null;state=null;},
  retry(){clearInterval(watch);frame?.remove();frame=null;state=null;create();},
  send(fp3d,id,value){post({fp3d,id,value});},
  goto(lon,lat,id){post({fp3d:'goto',lon,lat,id});},
  get state(){return state;},
  get ready(){return!!state?.ready;},
  get loading(){return!!frame&&!state?.ready&&!state?.failed&&!state?.error;},
  get seconds(){return frame?Math.round((performance.now()-started)/1000):0;},
 };
}
