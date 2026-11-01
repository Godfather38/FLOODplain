// Estimated flood extent from existing NOAA HAND data (see docs/HAND-INUNDATION.md).
// HAND = Height Above Nearest Drainage. A cell counts as wet when its HAND is at or
// below the stage the reach's rating curve gives for the flow. Nothing here reads
// road condition, and results carry no verdict about using a road.
const YEAR_MS=365.25*86400000;
const bytes=text=>Uint8Array.from(atob(text),c=>c.charCodeAt(0));

export function decodeJunction(raw){
 if(raw?.schemaVersion!==1||raw.kind!=='hand_junction')throw new Error('Not a HAND junction file');
 const g=raw.grid,handBytes=bytes(g.handCm),catchment=bytes(g.catchment),cells=g.cols*g.rows;
 if(handBytes.length!==cells*2||catchment.length!==cells)throw new Error('HAND grid size mismatch');
 const view=new DataView(handBytes.buffer),handCm=new Uint16Array(cells);
 for(let i=0;i<cells;i++)handCm[i]=view.getUint16(i*2,true);
 return {...raw,handCm,catchment,curves:raw.hydroIds.map(id=>raw.rating[id])};
}

// Linear lookup. Past the top of the curve there is no answer: never extrapolated.
export function stageForFlow(curve,flow){
 const q=curve.dischargeM3s,s=curve.stageM;
 if(!Number.isFinite(flow)||flow<0||flow>q.at(-1))return null;
 for(let i=1;i<q.length;i++)if(flow<=q[i])return q[i]>q[i-1]?s[i-1]+(flow-q[i-1])/(q[i]-q[i-1])*(s[i]-s[i-1]):s[i-1];
 return s.at(-1);
}

export function computeExtent(j,flow){
 const stages=j.curves.map(c=>stageForFlow(c,flow));
 if(stages.some(s=>s===null))return null;
 const {cols,rows,handNodata,catchmentNone,radiusM}=j.grid,limits=stages.map(s=>s*100),mask=new Uint8Array(cols*rows),cellM2=(2*radiusM/cols)**2;
 let wet=0,noEstimate=0,noHand=0,edge=false;
 for(let r=0,i=0;r<rows;r++)for(let c=0;c<cols;c++,i++){
  const k=j.catchment[i];
  if(k===catchmentNone){noEstimate++;continue;}
  if(j.handCm[i]===handNodata){noHand++;continue;}
  if(j.handCm[i]<=limits[k]){mask[i]=1;wet++;if(!r||!c||r===rows-1||c===cols-1)edge=true;}
 }
 return {mask,wetCells:wet,wetAreaM2:wet*cellM2,noEstimateCells:noEstimate,noHandCells:noHand,totalCells:cols*rows,touchesWindowEdge:edge,stages:j.hydroIds.map((hydroId,i)=>({hydroId,stageM:stages[i]}))};
}

const withoutMask=e=>{if(!e)return null;const {mask,...rest}=e;return rest;};
const years=ms=>(ms/YEAR_MS).toFixed(1);

export function buildLabels(j,{extent,now,forecast,source}){
 const age=now-Date.parse(j.source.sourceDate),missing=extent?(extent.noEstimateCells+extent.noHandCells)/extent.totalCells*100:100,km=(2*j.grid.radiusM/0.3048).toFixed(0),g=j.gauge;
 const forecastAge=source==='forecast'&&Number.isFinite(forecast?.issueAgeHours)?` Forecast issued ${forecast.issuedAt}, ${forecast.issueAgeHours.toFixed(1)} hours before this view.`:'';
 return {
  estimatedExtent:`Estimated extent, not observed water. ${source==='forecast'?'From a NOAA gauge forecast':'From a chosen flow, not a forecast'}, a computed rating curve and terrain height above the channel.`,
  sourceAge:`NOAA HAND files uploaded ${j.source.sourceDate.slice(0,10)}, ${years(age)} years before this view. The files state no FIM version.${forecastAge}`,
  missingCoverage:`No estimate for ${missing.toFixed(0)}% of this ${km} ft square (grey): outside the catchments of NWM reach ${j.reach.featureId}. Side washes, local runoff and anything past the square are not included.${extent?.touchesWindowEdge?' The estimated area reaches the edge of the square, so it continues beyond what is shown.':''}`,
  uncertainty:`We do not have a measured error range. ${j.calibration.calibrated?'':'This rating curve is not calibrated to gauge readings. '}The flow comes from the ${g.station} gauge, ${(g.alongChannelKm*1000/0.3048).toFixed(0)} ft ${g.gaugeIs} of this point, and is assumed unchanged along the channel. Bridges, culverts and berms are not modeled. The half and double flow shading shows sensitivity, not a confidence range.`
 };
}

function result(j,fields,{now,forecast,source}){
 const extent=fields.extent??null;
 const labels=buildLabels(j,{extent,now,forecast,source});
 return {schemaVersion:1,kind:'hand_inundation_estimate',junctionId:j.id,name:j.name,station:j.station,crossing:j.crossing,source,
  provenance:{...j.source},calibration:j.calibration,gauge:j.gauge,asOf:new Date(now).toISOString(),labels,
  uncertainty:{status:'not_quantified',plusMinus:null,reason:labels.uncertainty},
  limitations:['Estimated extent only, not observed water.','No passability, closure or bridge condition is inferred.'],...fields};
}

export function estimateFromFlow(j,flowM3s,{now=Date.now(),source='scenario',status='ok',reason='Chosen flow, not a forecast',forecast=null,flowTime=null}={}){
 if(!Number.isFinite(flowM3s)||flowM3s<0)return result(j,{status:'insufficient_data',reason:'No usable flow',flowM3s:null},{now,forecast,source});
 const extent=computeExtent(j,flowM3s);
 if(!extent)return result(j,{status:'beyond_rating',reason:'Flow is above the top of the rating curve; no extent is estimated',flowM3s},{now,forecast,source});
 const half=computeExtent(j,flowM3s/2),double=computeExtent(j,flowM3s*2);
 return result(j,{status,reason,flowM3s,flowTime,extent:withoutMask(extent),sensitivity:{halfFlow:withoutMask(half),doubleFlow:withoutMask(double)},masks:{half:half.mask,flow:extent.mask,double:double?.mask??null}},{now,forecast,source});
}

// Connects a normalizeForecast() result to the layer. A forecast that isn't usable gives no extent.
export function estimateFromForecast(j,forecast,{now=Date.now(),time=null}={}){
 const info={now,forecast,source:'forecast'};
 if(forecast?.siteId!==j.station)return result(j,{status:'unsupported',reason:`This junction uses ${j.station}, not ${forecast?.siteId}`},info);
 if(!['ok','stale'].includes(forecast.status))return result(j,{status:forecast.status,reason:forecast.reason},info);
 if(forecast.geography?.nwmReachId!==j.reach.featureId)return result(j,{status:'unsupported',reason:'Forecast reach does not match the HAND reach'},info);
 const point=time?forecast.points.find(p=>p.time===time):forecast.peak;
 if(!point)return result(j,{status:'insufficient_data',reason:'No forecast point at that time'},info);
 return estimateFromFlow(j,point.flowM3s,{now,source:'forecast',status:forecast.status,reason:forecast.status==='stale'?'Estimate uses an old forecast: '+forecast.reason:'Estimate uses the official forecast',forecast,flowTime:point.time});
}

export async function loadJunctionIndex(fetchImpl=globalThis.fetch){
 const r=await fetchImpl(new URL('./data/hand/index.json',import.meta.url).href);
 if(!r.ok)throw new Error(`HAND index HTTP ${r.status}`);
 return (await r.json()).junctions;
}

export async function loadJunction(id,fetchImpl=globalThis.fetch){
 const listing=await loadJunctionIndex(fetchImpl);
 if(!Object.hasOwn(listing,id))return null;
 const r=await fetchImpl(new URL('./data/hand/'+listing[id].file,import.meta.url).href);
 if(!r.ok)throw new Error(`HAND junction HTTP ${r.status}`);
 return decodeJunction(await r.json());
}
