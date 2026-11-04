// What the model run says at one route crossing: the road's height, the model's water level
// over every hour at that same spot, and how far apart they are. Every number names its source.
export const COVER_M=.05,MEASURED_REACH_M=60,DECK_REACH_M=80,LOW_REACH_M=100;
const near=(list,x,z,reach)=>list.map(p=>({p,d:Math.hypot(p.x-x,p.z-z)})).filter(o=>o.d<reach).sort((a,b)=>a.d-b.d);
// fp: a FAILURE_POINTS entry. roads: {stations,decks} from road-package.js (route stations every
// 5 m and lidar bridge decks). measured: older surveyed points with lat/lon. world(lon,lat)->[x,z].
export function crossingStory(fp,{world,ground,inside,frames,samplers,measured=[],roads=null}){
 const [fx,fz]=world(fp.lon,fp.lat);
 if(!inside(fx,fz))return{inside:false};
 const bridge=fp.kind==='bridge'||fp.kind==='river';
 let road=null;
 if(roads&&bridge){
  // The deck itself: the lidar's bridge-deck points.
  const d=near(roads.decks,fx,fz,DECK_REACH_M)[0]?.p;
  if(d)road={m:d.m,x:d.x,z:d.z,source:'Bridge deck, USGS 3DEP 2021 lidar bridge-deck points',measured:true,deck:true};
 }else if(roads){
  // The lowest road surface on this crossing's routes within 100 m: the bottom of the dip.
  const low=near(roads.stations.filter(s=>fp.routes.includes(s.route)&&!s.deck),fx,fz,LOW_REACH_M).reduce((a,o)=>!a||o.p.m<a.m?o.p:a,null);
  if(low)road={m:low.m,x:low.x,z:low.z,source:'Lowest road surface within 100 m, USGS 3DEP 1 m lidar',measured:true,deck:false};
 }
 if(!road){
  const old=measured.map(m=>{const [x,z]=world(m.lon,m.lat);return{m,x,z,d:Math.hypot(x-fx,z-fz)};}).filter(o=>o.d<MEASURED_REACH_M).sort((a,b)=>a.d-b.d)[0];
  // A surveyed point wins. At grade, the model's bare-earth lidar is the road surface. On a
  // bridge, bare earth is the channel under the deck, so the deck height stays unknown.
  road=old?{m:old.m.roadM,x:old.x,z:old.z,source:old.m.deck?'Surveyed bridge deck (USGS 3DEP lidar deck points)':'Surveyed road surface (USGS 3DEP 1 m lidar)',measured:true,deck:old.m.deck}
   :bridge?{m:null,x:fx,z:fz,source:'Deck height not measured. The model lidar has bridges removed.',measured:false,deck:true}
   :{m:ground(fx,fz),x:fx,z:fz,source:"Ground at the crossing from the model's 10 m lidar",measured:false,deck:false};
 }
 const {x,z}=road,groundM=ground(x,z);
 const hours=frames.map((f,i)=>{const water=samplers[i](x,z),known=Number.isFinite(water),depth=known?water-groundM:null;return{time:f.time,water:known?water:null,depth,over:known&&road.m!=null?water-road.m:null};});
 const known=hours.filter(h=>h.water!=null),peak=known.reduce((a,h)=>!a||h.water>a.water?h:a,null);
 return{inside:true,x,z,groundM,road,hours,peak,coveredHours:road.m==null?null:hours.filter(h=>h.over!=null&&h.over>COVER_M).length,unknownHours:hours.length-known.length};
}
export const statusAt=(story,i)=>!story.inside?'outside':story.hours[i].water==null?'unknown':story.road.m==null?'unmeasured':story.hours[i].over>COVER_M?'over':'clear';
// The all-route run (simulation/all-route-run.js): its 6.25 m cells sit on the road, so the road
// height is the lidar road at the crossing's own route point (or the bridge deck), and the water is
// the exact native water surface in that cell. A cell with under 0.03 ft of water is dry: its
// surface is only the cell's ground. series: run.quad.pointSeries(id), the area built for this
// crossing's route first; another area's values stay beside it, never averaged.
export function quadStory(fp,{world,roads,series,iso}){
 if(!series.length)return{inside:false,gap:true};
 const [fx,fz]=world(fp.lon,fp.lat),bridge=fp.kind==='bridge'||fp.kind==='river';
 let road=null;
 if(roads&&bridge){const d=near(roads.decks,fx,fz,DECK_REACH_M)[0]?.p;if(d)road={m:d.m,x:d.x,z:d.z,source:'Bridge deck, USGS 3DEP 2021 lidar bridge-deck points',measured:true,deck:true};}
 else if(roads){const at=near(roads.stations.filter(s=>fp.routes.includes(s.route)&&!s.deck),fx,fz,25)[0]?.p;if(at)road={m:at.m,x:at.x,z:at.z,source:'Road surface at the route point, USGS 3DEP 1 m lidar',measured:true,deck:false};}
 road??={m:null,x:fx,z:fz,source:bridge?'Deck height not measured.':'No lidar road height at the route point.',measured:false,deck:bridge};
 const hoursOf=s=>iso.map((time,i)=>{const z=s.zs[i],d=s.depth[i],known=!Number.isNaN(z),dry=known&&d<.0091;return{time,water:known?z:null,depth:known?d:null,dry,over:known&&road.m!=null?(dry?-Infinity:z-road.m):null};});
 const hours=hoursOf(series[0]),known=hours.filter(h=>h.water!=null&&!h.dry),peak=known.reduce((a,h)=>!a||h.water>a.water?h:a,null);
 return{inside:true,quad:true,area:series[0].label,others:series.slice(1).map(s=>({label:s.label,hours:hoursOf(s)})),x:road.x,z:road.z,groundM:null,road,hours,peak,coveredHours:road.m==null?null:hours.filter(h=>h.over!=null&&h.over>COVER_M).length,unknownHours:hours.filter(h=>h.water==null).length};
}
