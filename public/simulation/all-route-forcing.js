// Adapt hash-verified design-storm inputs to the existing rain, river and HAND layers.
import {fromUtm} from '../preview/geo3d/src/utm.js?v=dev';
export function inputAt(samples,time,value){
 for(let i=0;i<samples.length;i++){const b=samples[i],tb=Date.parse(b.time),vb=b[value];
  if(tb===time)return Number.isFinite(vb)?vb:NaN;
  if(tb>time){if(i===0)return NaN;const a=samples[i-1],ta=Date.parse(a.time),va=a[value];return Number.isFinite(va)&&Number.isFinite(vb)&&tb>ta?va+(vb-va)*(time-ta)/(tb-ta):NaN;}
 }
 return NaN;
}
export function allRouteInputs(pkg,times){
 const forcing=pkg.forcing,rainSamples=forcing?.rain?.samples??[],bounds=pkg.cases.map(c=>c.bounds).filter(b=>b?.length===2);
 let rain=null;
 if(rainSamples.length&&bounds.length){
  const south=Math.min(...bounds.map(b=>b[0][0])),north=Math.max(...bounds.map(b=>b[1][0])),west=Math.min(...bounds.map(b=>b[0][1])),east=Math.max(...bounds.map(b=>b[1][1]));
  rain={utm:false,uniform:rainSamples,bounds,rows:[south+(north-south)*.75,south+(north-south)*.25],cols:[west+(east-west)*.25,west+(east-west)*.75],frames:times.map((start,i)=>({start,end:times[i+1]??start+1}))};
 }
 const inflow=[];
 for(const [key,info] of Object.entries(forcing?.inflow?.byCase??{}))for(const inlet of info.inlets??[]){
  if(!inlet.available||inlet.crs!=='EPSG:32612'||![inlet.eastingM,inlet.northingM].every(Number.isFinite))continue;
  const ll=fromUtm(inlet.eastingM,inlet.northingM),points=new Map(times.map(t=>[t,inputAt(inlet.samples??[],t,'flowM3s')]).filter(([,v])=>Number.isFinite(v)));
  if(!points.size)continue;
  inflow.push({name:(pkg.cases.find(c=>c.key===key)?.label.split(':')[0]??key)+': '+inlet.label,caseKey:key,reachId:String(inlet.reachId),lat:ll.lat,lon:ll.lon,points,exactTimes:true});
 }
 return{rain,inflow};
}
