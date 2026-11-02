// Decides where the one solver window sits. It stays within the Avra Valley, Picture
// Rocks and route area, and prefers a real crossing near the middle of the view.
export const COVERAGE=Object.freeze({west:-111.33,east:-110.96,south:32.2,north:32.48});
export const MIN_WATER_ZOOM=10.5;
const SNAP_KM=4,MOVE_KM=1.5;
const km=(a,b)=>Math.hypot((a.lon-b.lon)*94,(a.lat-b.lat)*110.5);
export function chooseWindow(view,crossings,current){
 if(view.zoom<MIN_WATER_ZOOM)return{action:'hide',reason:'Zoom in to see the simulated water.'};
 const C=COVERAGE;
 if(view.lon<C.west||view.lon>C.east||view.lat<C.south||view.lat>C.north)return{action:'hide',reason:'Simulated water covers Avra Valley, Picture Rocks and the route areas.'};
 let target=null,best=Infinity;
 for(const c of crossings){const d=km(c,view);if(d<best){best=d;target=c;}}
 if(best>SNAP_KM)target={lat:view.lat,lon:view.lon,name:''};
 if(current&&km(current,target)<MOVE_KM)return{action:'stay'};
 return{action:'move',target};
}
