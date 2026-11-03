// Road heights along the routes, from experiment/road-heights (c4a5137), files copied unchanged
// into public/simulation/data/road-heights/: a station every 5 m on every route and the freeway,
// metres NAVD88 from USGS 3DEP 1 m bare earth, with bridge decks from the 2021 lidar's
// bridge-deck points (class 17). Unknown heights stay null. The decoder is that branch's
// public/simulation/road-heights.js, unchanged in format.
export const ROAD_FLAGS=Object.freeze({deckLidar:1,deckApproach:2,noTerrain:4,structureUntagged:8});
const READ={u4:['getUint32',4],i4:['getInt32',4],u1:['getUint8',1],i1:['getInt8',1],i2:['getInt16',2]};
function column(view,start,c){const [read,width]=READ[c.type]??[];if(!read||start+c.offset+c.count*width>view.byteLength)throw Error('Invalid road height column');return Array.from({length:c.count},(_,i)=>view[read](start+c.offset+i*width,true));}
export function decodeRoadHeights(buffer){
 const view=new DataView(buffer),size=view.getUint32(0,true);
 if(size>buffer.byteLength-4)throw Error('Invalid road height header');
 const h=JSON.parse(new TextDecoder().decode(new Uint8Array(buffer,4,size)));
 if(h.format!=='floodplain-road-heights-v1')throw Error('Unknown road height format');
 const body=4+size,col=Object.fromEntries(Object.entries(h.columns).map(([k,c])=>[k,column(view,body,c)])),starts=col.lineStart,lines=[];
 for(let i=0;i<starts.length-1;i++){
  const stations=[];let lon=0,lat=0,z=0,s=0;
  for(let j=starts[i];j<starts[i+1];j++){
   lon+=col.dLonE6[j];lat+=col.dLatE6[j];z+=col.dZCm[j];s+=col.dStationDm[j];const flags=col.flags[j];
   stations.push({lon:lon/1e6,lat:lat/1e6,stationM:s/10,elevationM:flags&ROAD_FLAGS.noTerrain?null:z/100,flags});
  }
  lines.push({name:h.lines.name[i],kind:h.lines.kind[i],routeId:h.lines.routeId[i],stations});
 }
 return{metadata:h.metadata,lines};
}
// Route stations and lidar bridge decks in world coordinates. world(lon,lat)->[x,z].
export function roadPackage({lines},structures,world){
 const stations=[];
 for(const l of lines)if(l.kind==='route'&&l.routeId)for(const s of l.stations)if(s.elevationM!=null){const [x,z]=world(s.lon,s.lat);stations.push({x,z,m:s.elevationM,route:l.routeId,deck:!!(s.flags&ROAD_FLAGS.deckLidar),estimatedDeck:!!(s.flags&ROAD_FLAGS.deckApproach)});}
 const decks=structures.structures.filter(s=>s.kind==='lidar'&&Number.isFinite(s.deckMedianM)).map(s=>{const [x,z]=world(s.lon,s.lat);return{x,z,m:s.deckMedianM,name:s.name,lengthM:s.lengthM,coverage:s.coverage};});
 return{stations,decks};
}
