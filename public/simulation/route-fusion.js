import {FAILURE_POINTS} from '../config.js';
import {acceptInundationRun} from './inundation-contract.js';
const rank={ok:0,watch:1,unknown:1.5,caution:2,danger:3};
const junctions={'trico-marana-santa-cruz':'sc-trico-marana','sanders-santa-cruz':'sc-sanders'};
const distance=(a,b)=>Math.hypot((a.lat-b.lat)*111320,(a.lon-b.lon)*111320*Math.cos(a.lat*Math.PI/180));

// Consume the existing HAND export contract; do not implement its solver again.
export function handEvidence(result){
 const crossingId=junctions[result?.junctionId];
 if(result?.kind!=='hand_inundation_estimate'||!crossingId)throw Error('Unsupported HAND export/junction');
 return {source:'HAND',crossingId,status:result.status,mode:result.source==='forecast'?'forecast':'scenario',
  validAt:result.flowTime,asOf:result.asOf,concern:result.extent?.wetCells>0,
  meaning:'Estimated wet area near the crossing; not verified road intersection or bridge-deck depth',
  provenance:result.provenance,limitations:result.labels,uncertainty:result.uncertainty};
}

export function sfincsEvidence(raw,time){
 const run=acceptInundationRun(raw);if(run.status!=='complete')throw Error(run.reason);
 const frame=time?run.frames.find(f=>f.time===time):run.frames.at(-1);
 if(!frame)throw Error('No SFINCS frame at requested time');
 return FAILURE_POINTS.map(fp=>{
  let nearest=-1,metres=Infinity;run.cells.forEach((c,i)=>{const d=distance(fp,c);if(d<metres){metres=d;nearest=i;}});
  const depth=metres<=150?frame.depthM[nearest]:null;
  return {source:'SFINCS',crossingId:fp.id,status:depth===null?'unsupported':'ok',mode:'scenario',validAt:frame.time,
   concern:depth!==null&&depth>=.01,depthM:depth,distanceM:metres,
   meaning:'Water depth in the nearest model cell within 492 ft; this past scenario does not measure depth on the road',
   provenance:run.provenance,limitations:run.support,uncertainty:run.uncertainty};
 });
}

// Max-concern precedence, never an average of unrelated scores/depths.
export function fuseRoutes(snapshot,evidence=[],{now=Date.now(),maxSnapshotAgeMs=10*60000,modelMode='aggregate',clockMode='live'}={}){
 if(!snapshot||!Array.isArray(snapshot.rated))return {status:'insufficient_data',recommendation:null,routes:[],reason:'Open the main app and refresh observations first'};
 const age=now-snapshot.now,stale=!Number.isFinite(age)||age< -300000||age>maxSnapshotAgeMs;
 const routes=snapshot.rated.map(route=>{
  let level=Object.hasOwn(rank,route.level)?route.level:'unknown';if(stale&&rank[level]<rank.unknown)level='unknown';const reasons=[],sources=[];
  const closed=route.points.some(p=>p.checks?.some(c=>c.src==='county'&&c.level==='danger'&&/closed/i.test(c.why)));
  const unobserved=route.points.some(p=>!p.checks?.some(c=>c.src!=='none'&&c.level!=='unknown'));
  if(unobserved&&rank[level]<rank.unknown)level='unknown';
  if(stale)reasons.push('Original observation snapshot is stale; refresh the main app');
  if(unobserved)reasons.push('At least one crossing has no usable observations');
  const groups=new Map();
  for(const e of evidence.filter(e=>route.points.some(p=>p.id===e.crossingId)&& (modelMode==='aggregate'||(modelMode==='hand'?e.source==='HAND':e.source==='SFINCS')))){
   const rating=simulationReliability(e,{now,clockMode});
   const used=rating.weight>=.2&&e.concern===true;
   const group=e.correlationGroup??'shared_NOAA_hydrometeorology';
   const source={...e,reliability:rating,usedForRanking:used,contextOnly:!used,correlationGroup:group};sources.push(source);
   if(used){const prior=groups.get(group);if(!prior||rating.weight>prior.reliability.weight)groups.set(group,source);}
   else if(!rating.supported)reasons.push(`${e.source}: unknown or incompatible coverage/time; no model clearance`);
  }
  for(const e of groups.values()){
   if(rank[level]<rank.caution)level='caution';
   reasons.push(`${e.source} modeled water near ${e.crossingId}: reliability weight ${e.reliability.weight.toFixed(2)} raised concern; ${e.reliability.explanation}. Shared-forcing evidence counted once.`);
  }
  const conflicts=sources.some(e=>e.usedForRanking)&&['ok','watch'].includes(route.level);
  return {...route,originalLevel:route.level,level,evidenceAdequate:!stale&&!unobserved,excluded:closed,decision:closed?'excluded_official_closure':level==='danger'?'avoid':level==='unknown'?'unknown':'candidate',conflicts,reasons,sources,simulationGuidance:{modelMode,clockMode,weightMeaning:'Heuristic reliability, not probability or accuracy',independentEvidenceGroups:groups.size}};
 });
 const order=[...routes].sort((a,b)=>Number(a.excluded)-Number(b.excluded)||rank[a.level]-rank[b.level]||a.minutes-b.minutes);
 const best=order.find(r=>!r.excluded&&r.evidenceAdequate&&!['danger','unknown'].includes(r.level));
 return {schemaVersion:1,kind:'combined_route_decision',asOf:new Date(now).toISOString(),observationTime:Number.isFinite(snapshot.now)?new Date(snapshot.now).toISOString():null,status:best?'recommendation':'insufficient_data',
  recommendation:best?{routeId:best.id,text:`Prefer ${best.name} among evaluated routes${best.level==='caution'?' with caution':''}; ${best.conflicts?'model and observation evidence conflict':'lowest combined concern'}. This is not confirmation that the road is passable.`}:null,
  reason:best?null:'No nonclosed route with adequate observations and below-danger concern; review listed alternatives and current closures',routes:order,
  policy:'Official closures exclude. Existing observed danger is never reduced. Current model wet-area evidence can raise concern; model dry output cannot clear observations or unknowns. Historical SFINCS is context only. No calibrated probability or depth-to-passability conversion.'};
}


// Transparent product policy, not fitted error or probability. Related sources use max, never summed confirmation.
export function simulationReliability(e,{now=Date.now(),clockMode='live'}={}){
 const issue=Date.parse(e.sourceAsOf??e.asOf),valid=Date.parse(e.validAt),ageHours=(now-issue)/3600000;
 const modeOK=e.mode==='forecast'||(clockMode==='simulated_live'&&e.mode==='simulated_forecast');
 const statusOK=['ok','simulated_live'].includes(e.status)&&!(e.status==='simulated_live'&&clockMode!=='simulated_live');
 const supported=modeOK&&statusOK&&Number.isFinite(valid)&&valid>=now-3600000&&valid<=now+24*3600000&&Number.isFinite(ageHours)&&ageHours>=-5/60&&ageHours<=24&&e.spatialSupport!==false;
 const freshness=supported?Math.max(.25,1-Math.max(0,ageHours)/32):0;
 const spatial=supported?Math.max(0,Math.min(1,e.spatialWeight??.5)):0;
 const quality=e.source==='HAND'?.7:.65;
 const limits=e.source==='HAND'?.65:.6;
 const weight=Number((freshness*spatial*quality*limits).toFixed(3));
 return {weight,supported,factors:{freshness,spatial,sourceQuality:quality,modelLimits:limits},explanation:'freshness x spatial support x source quality x model limits',meaning:'Uncalibrated heuristic reliability; not a probability, confidence interval or measured accuracy',policy:'Weight >=0.20 can raise concern only; no model can clear observed hazards or official closures'};
}
