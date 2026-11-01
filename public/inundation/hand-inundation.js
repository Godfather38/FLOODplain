// Estimated flood extent from existing NOAA HAND data (see docs/HAND-INUNDATION.md).
// HAND = Height Above Nearest Drainage. A cell counts as wet when its HAND is at or
// below the stage the reach's rating curve gives for the flow. Nothing here reads
// road condition, and results carry no verdict about using a road.
import {createForecastProvider} from './forecast-provider.js';
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
 // No flow means no estimated water, even on cells at zero height above the stream.
 const {cols,rows,handNodata,catchmentNone,radiusM}=j.grid,limits=stages.map(s=>flow>0?s*100:-1),mask=new Uint8Array(cols*rows),cellM2=(2*radiusM/cols)**2;
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

function flowSource(j){
 if(j.forecast.kind==='gauge')return `The flow comes from the ${j.forecast.station} gauge forecast, ${j.gauge.alongChannelKm} km ${j.gauge.gaugeIs} of this point, and is assumed unchanged along the channel.`;
 const km=j.reach.lengthKm?`${j.reach.lengthKm} km`:'unknown length';
 return `Forecast flow is a National Water Model result for the whole reach (${km}), not a gauge reading, and its accuracy on this reach has not been checked.`;
}

export const SCORE_NOTE='This score labels how good the match is. It is not a measured probability.';
export const confidenceText=c=>`${c.band}, ${c.score} of 100. ${SCORE_NOTE} `+c.factors.map(f=>`${f.factor}: ${f.points} of ${f.max} (${f.detail}).`).join(' ');

export function buildLabels(j,{extent,now,forecast,source}){
 const age=now-Date.parse(j.source.sourceDate),missing=extent?(extent.noEstimateCells+extent.noHandCells)/extent.totalCells*100:100,km=(2*j.grid.radiusM/1000).toFixed(0);
 const forecastAge=source==='forecast'&&Number.isFinite(forecast?.issueAgeHours)?` Forecast issued ${forecast.issuedAt}, ${forecast.issueAgeHours.toFixed(1)} hours before this view.`:'';
 return {
  confidence:confidenceText(j.confidence),
  estimatedExtent:`Estimated extent, not observed water. ${source==='forecast'?`From ${forecast?.provider??'a NOAA forecast'}`:'From a chosen flow, not a forecast'}, a computed rating curve and terrain height above the channel.`,
  sourceAge:`NOAA HAND files uploaded ${j.source.sourceDate.slice(0,10)}, ${(age/YEAR_MS).toFixed(1)} years before this view. The files state no FIM version.${forecastAge}`,
  missingCoverage:`No estimate for ${missing.toFixed(0)}% of this ${km} km square (grey): outside the catchments of NWM reach ${j.reach.featureId}. Side washes, local runoff and anything past the square are not included.${extent?.touchesWindowEdge?' The estimated area reaches the edge of the square, so it continues beyond what is shown.':''}`,
  uncertainty:`Not measured: no ± is available. ${j.calibration.calibrated?'':'This rating curve is not calibrated to gauge readings. '}${flowSource(j)} ${j.reach.crossingDistanceM>100?`The modeled stream is ${Math.round(j.reach.crossingDistanceM)} m from this crossing. `:''}${j.reach.nameAgreement==='agree'?'':'The water name is not confirmed by both our map data and NOAA, so this reach is matched mainly by location. '}${j.droppedHydroIds?.length?`${j.droppedHydroIds.length} catchment(s) in this square have an unusable rating curve and show no estimate. `:''}Bridges, culverts and berms are not modeled. The half and double flow shading shows sensitivity, not a confidence range.`
 };
}

// What the page says for a crossing with no verified coverage. Never carries an extent.
export function missingCoverageResult(row){
 return {schemaVersion:1,kind:'hand_inundation_estimate',status:'missing_coverage',reason:row.evidence,junctionId:row.id,name:row.name,crossing:{lon:row.lon,lat:row.lat},
  labels:{confidence:'None: nothing is estimated here.',estimatedExtent:'No estimate at this crossing.',sourceAge:'No NOAA HAND files are used here.',missingCoverage:`Missing coverage: ${row.evidence}`,uncertainty:'Not applicable: nothing is estimated here. Missing coverage does not mean water is absent.'},uncertainty:{status:'not_quantified',plusMinus:null}};
}

function result(j,fields,{now,forecast,source}){
 const extent=fields.extent??null,labels=buildLabels(j,{extent,now,forecast,source});
 return {schemaVersion:1,kind:'hand_inundation_estimate',junctionId:j.id,name:j.name,forecastSource:j.forecast,crossing:j.crossing,confidence:j.confidence,source,
  provenance:{...j.source},calibration:j.calibration,gauge:j.gauge,asOf:new Date(now).toISOString(),labels,
  uncertainty:{status:'not_quantified',plusMinus:null,reason:labels.uncertainty},
  limitations:['Estimated extent only, not observed water.','No passability, closure or bridge condition is inferred.'],...fields};
}

export function estimateFromFlow(j,flowM3s,{now=Date.now(),source='scenario',status='ok',reason='Chosen flow, not a forecast',forecast=null,flowTime=null}={}){
 const info={now,forecast,source};
 if(!Number.isFinite(flowM3s)||flowM3s<0)return result(j,{status:'insufficient_data',reason:'No usable flow',flowM3s:null},info);
 const extent=computeExtent(j,flowM3s);
 if(!extent)return result(j,{status:'beyond_rating',reason:'Flow is above the top of the rating curve; no extent is estimated',flowM3s},info);
 const half=computeExtent(j,flowM3s/2),double=computeExtent(j,flowM3s*2);
 return result(j,{status,reason:flowM3s>0?reason:`${reason}. The flow is zero, so no water is estimated.`,flowM3s,flowTime,extent:withoutMask(extent),sensitivity:{halfFlow:withoutMask(half),doubleFlow:withoutMask(double)},masks:{half:half.mask,flow:extent.mask,double:double?.mask??null}},info);
}

// A forecast that isn't usable, or is for another reach, gives no extent.
export function estimateFromForecast(j,forecast,{now=Date.now(),time=null}={}){
 const info={now,forecast,source:'forecast'};
 if(!['ok','stale'].includes(forecast?.status))return result(j,{status:forecast?.status??'unavailable',reason:forecast?.reason??'No forecast'},info);
 if(forecast.nwmReachId!==j.reach.featureId)return result(j,{status:'unsupported',reason:'Forecast reach does not match the HAND reach'},info);
 const point=time?forecast.points.find(p=>p.time===time):forecast.peak;
 if(!point)return result(j,{status:'insufficient_data',reason:'No forecast point at that time'},info);
 return estimateFromFlow(j,point.flowM3s,{now,source:'forecast',status:forecast.status,reason:forecast.status==='stale'?'Estimate uses an old forecast: '+forecast.reason:'Estimate uses the forecast',forecast,flowTime:point.time});
}

const dataUrl=name=>new URL('./data/'+name,import.meta.url).href;
export async function loadCoverage(fetchImpl=globalThis.fetch){
 const r=await fetchImpl(dataUrl('coverage.json'));
 if(!r.ok)throw new Error(`HAND coverage HTTP ${r.status}`);
 return r.json();
}
export async function loadJunction(file,fetchImpl=globalThis.fetch){
 const r=await fetchImpl(dataUrl(file));
 if(!r.ok)throw new Error(`HAND junction HTTP ${r.status}`);
 return decodeJunction(await r.json());
}

// The one call the app needs: any crossing id in, an estimate or a labeled gap out.
export function createInundationLayer({enabled=false,fetchImpl=globalThis.fetch,clock=Date.now}={}){
 const provider=createForecastProvider({enabled,fetchImpl,clock});
 return {provider,async inundation({junctionId,time=null}={}){
  if(!enabled)return {status:'disabled',reason:'Live requests are off',junctionId};
  let row,junction;
  try{
   row=(await loadCoverage(fetchImpl)).points.find(p=>p.id===junctionId);
   if(!row)return {status:'unsupported',reason:'Not a known crossing',junctionId};
   if(row.status!=='supported')return missingCoverageResult(row);
   junction=await loadJunction(row.file,fetchImpl);
  }catch(error){return {status:'unavailable',reason:`HAND data failed to load: ${error.message}`,junctionId};}
  return estimateFromForecast(junction,await provider.predict(junction.forecast),{now:clock(),time});
 }};
}
