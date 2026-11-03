// The 3D map as a layer of the app's map: the 3D model view (preview/geo3d/world.html, embedded)
// in a frame over the map. The map's own controls drive it through send() and goto(); it reports
// what it shows (run, hour, layers) through onState.
export function createWorldLayer({container,src='preview/geo3d/world.html?embed=1',onState=()=>{}}){
 let frame=null,state=null;
 addEventListener('message',e=>{
  if(e.origin!==location.origin||!frame||e.source!==frame.contentWindow||e.data?.fp3d!=='state')return;
  state=e.data;onState(state);
 });
 const post=m=>frame?.contentWindow?.postMessage(m,location.origin);
 return{
  show(on){
   if(on&&!frame){frame=document.createElement('iframe');frame.className='world-layer';frame.title='3D model view';frame.src=src;frame.allow='fullscreen';container.append(frame);}
   if(frame)frame.hidden=!on;
  },
  send(fp3d,id,value){post({fp3d,id,value});},
  goto(lon,lat,id){post({fp3d:'goto',lon,lat,id});},
  get state(){return state;},
  get ready(){return!!state?.time;},
 };
}
