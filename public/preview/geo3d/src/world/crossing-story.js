// What the model run says at one route crossing: the road's height, the model's water level
// over every hour, and how far apart they are. Every number names where it came from.
export const COVER_M=.05,MEASURED_REACH_M=60;
// fp: a FAILURE_POINTS entry. measured: road-heights points with lat/lon. world(lon,lat)->[x,z].
export function crossingStory(fp,{world,ground,inside,frames,samplers,measured}){
 const [x,z]=world(fp.lon,fp.lat);
 if(!inside(x,z))return{inside:false};
 const near=measured.map(m=>({m,d:Math.hypot(...world(m.lon,m.lat).map((v,i)=>v-[x,z][i]))})).filter(o=>o.d<MEASURED_REACH_M).sort((a,b)=>a.d-b.d)[0]?.m;
 const groundM=ground(x,z),bridge=fp.kind==='bridge'||fp.kind==='river';
 // A surveyed road point wins. At grade, the model's bare-earth lidar is the road surface.
 // On a bridge, bare earth is the channel under the deck, so the deck height stays unknown.
 const road=near?{m:near.roadM,source:near.deck?'Surveyed bridge deck (USGS 3DEP lidar deck points)':'Surveyed road surface (USGS 3DEP 1 m lidar)',measured:true,deck:near.deck}
  :bridge?{m:null,source:'Deck height not measured. The model lidar has bridges removed.',measured:false,deck:true}
  :{m:groundM,source:"Ground at the crossing from the model's 10 m lidar",measured:false,deck:false};
 const hours=frames.map((f,i)=>{const water=samplers[i](x,z),known=Number.isFinite(water),depth=known?water-groundM:null;return{time:f.time,water:known?water:null,depth,over:known&&road.m!=null?water-road.m:null};});
 const known=hours.filter(h=>h.water!=null),peak=known.reduce((a,h)=>!a||h.water>a.water?h:a,null);
 return{inside:true,x,z,groundM,road,hours,peak,coveredHours:road.m==null?null:hours.filter(h=>h.over!=null&&h.over>COVER_M).length,unknownHours:hours.length-known.length};
}
export const statusAt=(story,i)=>!story.inside?'outside':story.hours[i].water==null?'unknown':story.road.m==null?'unmeasured':story.hours[i].over>COVER_M?'over':'clear';
