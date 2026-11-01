import {createForecastEngine} from './forecast-engine.js';
import {fetchNwmContext} from './nwm-context.js';
import {fetchQpfContext} from './qpf-context.js';
import {loadJunctionIndex,loadJunction,estimateFromForecast} from './vendor/claude-hand/hand-inundation.js';
export function createIntegratedEngine({enabled=false,fetchImpl=globalThis.fetch,clock=Date.now,timeoutMs=10000}={}){
 const official=createForecastEngine({enabled,fetchImpl,clock,timeoutMs});
 return {...official,async evaluate({siteId='SCTA3',force=false}={}){
  if(!enabled)return {status:'disabled',official:await official.predict({siteId}),hand:[],nwm:{status:'disabled',reaches:[]},rainfall:{status:'disabled',intervals:[]},ensemble:{status:'disabled',points:[]}};
  const [forecast,nwm,ensemble,rainfall]=await Promise.all([official.predict({siteId,force}),fetchNwmContext({siteId,fetchImpl,clock,timeoutMs}),official.ensemble({siteId}),fetchQpfContext({fetchImpl,clock,timeoutMs})]);
  const hand=[];let handStatus='unsupported';
  try{const index=await loadJunctionIndex((url)=>fetchImpl(url,{signal:AbortSignal.timeout(timeoutMs)})),ids=Object.keys(index).filter(id=>index[id].station===siteId);for(const id of ids){const j=await loadJunction(id,(url)=>fetchImpl(url,{signal:AbortSignal.timeout(timeoutMs)}));const eligible=forecast.points.filter(p=>Date.parse(p.time)>=clock()&&Date.parse(p.time)<=clock()+24*3600000);const routePeak=eligible.reduce((a,b)=>!a||b.flowM3s>a.flowM3s?b:a,null);const prediction=estimateFromForecast(j,routePeak?forecast:{...forecast,status:'insufficient_data',reason:'No forecast within the next 24-hour route horizon'},{now:clock(),time:routePeak?.time});hand.push(prediction)}handStatus=ids.length?'available':'unsupported'}catch(e){handStatus='unavailable: '+e.message}
  const value={schemaVersion:1,kind:'integrated_forecast',status:forecast.status,siteId,asOf:new Date(clock()).toISOString(),official:forecast,nwm,ensemble,rainfall,hand,handStatus,handHorizonHours:24,handImplementation:{commit:'6a0c56ac1bfabb925fad1527c65d9908518723d9',mode:'unchanged_snapshot'},limitations:['RFC is primary; NWM is separate guidance, not averaged or substituted.','HAND consumes only its matched RFC gauge, never NWM lateral estimates.','One-cell QPF is context, not whole-domain solver forcing.','Only original observations/closures and eligible current HAND evidence enter route fusion.']};
  return value;
 }};
}
// Strip large masks for same-tab route transport. Preserve original source/validity fields.
export function routeHandPayload(bundle){return {asOf:bundle.asOf,siteId:bundle.siteId,hand:bundle.hand.map(({masks,...result})=>result)};}
