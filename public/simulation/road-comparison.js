// Road and predicted water share NAVD88 metres. Keep missing water distinct from a dry cell.
import { WET_M } from '../road-forecast.js?v=dev';
const distance = (a,b) => Math.hypot((a.lat-b.lat)*110574,(a.lon-b.lon)*111320*Math.cos(a.lat*Math.PI/180));
export function nearestRoadSample(pred, point, radiusM=25) {
 let best=null, metres=radiusM;
 for(const route of Object.values(pred?.routes??{})) for(const sample of route.samples??[]) {
  const d=distance(sample,point);
  if(d<metres){best={...sample,routeId:route.routeId};metres=d;}
 }
 return best;
}
export function roadComparison(sample,hour) {
 if(!sample||!Number.isFinite(sample.roadM))return {status:'unavailable',reason:'Road height unavailable.'};
 const waterM=sample.surface?.[hour],depthM=sample.depth?.[hour];
 if(!Number.isFinite(waterM)||!Number.isFinite(depthM))return {...sample,status:'unavailable',reason:'No predicted water height for this hour.'};
 if(depthM<WET_M)return {...sample,status:'dry',waterM:null,differenceM:null};
 return {...sample,status:'water',waterM,differenceM:waterM-sample.roadM,scoredDepthM:sample.over?.[hour]};
}
// Current road summary: only a positive native road depth can recover its surface from the
// exact same road station. Zero depth has discarded the water level; never invent one.
export function forecastComparison(route,stations) {
 if(!route)return {status:'unavailable',reason:'No current road forecast.'};
 const station=(stations??[]).find(s=>distance(s,route)<.3);
 const roadM=Number.isFinite(route.roadM)?route.roadM:station?.roadM;
 if(!Number.isFinite(roadM))return {status:'unavailable',reason:'Road height unavailable at this forecast point.'};
 if(!Number.isFinite(route.waterM)&&(route.maxOver===0||route.maxOver===-Infinity))return {status:'dry',roadM,waterM:null,differenceM:null};
 const waterM=Number.isFinite(route.waterM)?route.waterM:route.source==='high_resolution'&&route.maxOver>0?roadM+route.maxOver:null;
 if(!Number.isFinite(waterM))return {status:'unavailable',roadM,reason:'Predicted water height unavailable.'};
 return {status:'water',roadM,waterM,differenceM:waterM-roadM,scoredDepthM:route.maxOver};
}
const feet=m=>(m/.3048).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
export function comparisonLines(r) {
 const lines=Number.isFinite(r.roadM)?[`Road${r.deck?' / bridge deck':''}: ${feet(r.roadM)} ft NAVD88`]:[];
 if(r.status==='unavailable')return [...lines,r.reason];
 if(r.status==='dry')return [...lines,'No water predicted over the checked road. Water-surface height is not provided by this result.'];
 lines.push(`Predicted water: ${feet(r.waterM)} ft NAVD88`,`${feet(Math.abs(r.differenceM))} ft ${r.differenceM>=0?'above':'below'} the road`);
 if(Number.isFinite(r.scoredDepthM)&&r.scoredDepthM<r.differenceM-.001)lines.push(`Coarse model road depth used for scoring: ${feet(r.scoredDepthM)} ft (limited to the cell’s water depth).`);
 return lines;
}
