// Decides where the one solver window sits. It stays within the Avra Valley, Picture
// Rocks and route area, and prefers a real crossing near the middle of the view.
export const COVERAGE=Object.freeze({west:-111.33,east:-110.96,south:32.2,north:32.48});
export const MIN_WATER_ZOOM=9;
const SNAP_KM=4,MOVE_KM=1.5,BASE_SCALE=50;
// Metres per scene unit. The window doubles in size each zoom level out from 14, which
// keeps it about as large as the view.
export const scaleForZoom=zoom=>BASE_SCALE*2**Math.min(4,Math.max(0,Math.ceil(14-zoom)));
const km=(a,b)=>Math.hypot((a.lon-b.lon)*94,(a.lat-b.lat)*110.5);
export function chooseWindow(view,crossings,current){
 if(view.zoom<MIN_WATER_ZOOM)return{action:'hide',reason:'Zoom in to see the simulated water.'};
 const C=COVERAGE,scale=scaleForZoom(view.zoom),wide=scale>BASE_SCALE,slack=wide?.1:0;
 if(view.lon<C.west-slack||view.lon>C.east+slack||view.lat<C.south-slack||view.lat>C.north+slack)return{action:'hide',reason:'Simulated water covers Avra Valley, Picture Rocks and the route areas.'};
 let target=null,best=Infinity;
 for(const c of crossings){const d=km(c,view);if(d<best){best=d;target=c;}}
 // Zoomed out, the window simply centres on the view instead of one crossing.
 if(wide||best>SNAP_KM)target={lat:view.lat,lon:view.lon,name:''};
 if(current&&current.scale===scale&&km(current,target)<MOVE_KM*scale/BASE_SCALE)return{action:'stay'};
 return{action:'move',target:{...target,scale}};
}
