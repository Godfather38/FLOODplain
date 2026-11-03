// Surveyed road heights at crossings (public/inundation/road-heights.json, NAVD88), keyed by
// an id that ends in the point's coordinates: "west-avra-valley-road-32-39322-111-29459".
export function parseRoadHeights(json){
 const out=[];
 for(const [id,p] of Object.entries(json.points??{})){
  const m=id.match(/-(\d+)-(\d+)-(\d+)-(\d+)$/);if(!m)continue;
  out.push({id,lat:Number(`${m[1]}.${m[2]}`),lon:-Number(`${m[3]}.${m[4]}`),roadM:p.roadM,bedM:p.bedM,aboveBedM:p.roadAboveBedM,deck:!!p.deck});
 }
 return out;
}
