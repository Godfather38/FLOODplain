// Open-boundary coupling between the saved native transport package
// (docs/BRAWLEY-FLOW-CONTRACT.md) and the junction particle layer.
//
// The closed box was the missing driver: inflow and outflow were simply absent,
// so the water sat at its own equilibrium. This carries signed native
// unit-width discharge across the junction160 perimeter into and out of the
// particle set, with a whole-particle ledger that keeps fractional volume
// instead of rounding it away.
//
// Three boundaries that must not be crossed:
//  * `qM2s` is unit-width discharge, not velocity. Any speed derived from it is
//    labelled, carries its assumption, and is never presented as a native point
//    speed. See `derivedEdgeSpeed`.
//  * Native face identity carries the geometry. Edges are matched to the
//    particle field through `fromFace`/`toFace` and the mask's `inwardSign`, so
//    nothing depends on re-projecting UTM into the tangent plane.
//  * Injected volume never overrides dry or missing terrain. If the native wet
//    support cannot take the water the native budget says arrived, that is
//    reported as a coupling discrepancy, not painted on as flooding.
const finite=Number.isFinite;

export const FLOW_COUPLING_DEFAULTS=Object.freeze({
  minEffectiveDepthM:0.02,maxDerivedSpeedMps:3,
  maxRecyclesPerStep:64});

// UTM is a metric grid, so its north is rotated from true north by the grid
// convergence. Over this 180 m junction that is about a quarter of a metre —
// small against 12.5 m native cells, but there is no reason to carry it. Used
// for reporting edge geometry only; the coupling itself runs on face identity.
export function gridConvergenceRadians(lonDegrees,latDegrees,centralMeridianDegrees=-111){
  if(![lonDegrees,latDegrees,centralMeridianDegrees].every(finite))throw Error('Grid convergence needs finite degrees');
  const rad=Math.PI/180;
  return Math.atan(Math.tan((lonDegrees-centralMeridianDegrees)*rad)*Math.sin(latDegrees*rad));
}

// EPSG:32612 east/north -> scene-local tangent east/north about the scene
// centre, whose exact projection the flow manifest records.
export function utmToSceneLocal(point,{centerUTM,convergenceRadians=0}={}){
  if(!Array.isArray(point)||point.length!==2||!point.every(finite))throw Error('A UTM easting/northing pair is required');
  if(!Array.isArray(centerUTM)||centerUTM.length!==2||!centerUTM.every(finite))throw Error('The projected scene centre is required');
  const dx=point[0]-centerUTM[0],dy=point[1]-centerUTM[1];
  const c=Math.cos(convergenceRadians),s=Math.sin(convergenceRadians);
  return [dx*c-dy*s,dx*s+dy*c];
}

// Depth-averaged speed from unit-width discharge: q has units m2/s, so q/h is a
// DEPTH-AVERAGED speed over the declared effective depth h. It is a derived
// quantity with a stated assumption, never a native point speed, and the native
// package exports no velocity at all.
export function derivedEdgeSpeed(qM2s,effectiveDepthM,options={}){
  const settings={...FLOW_COUPLING_DEFAULTS,...options};
  if(!finite(qM2s))return {status:'unavailable',reason:'No finite native discharge on this edge',speedMps:null};
  if(!finite(effectiveDepthM)||effectiveDepthM<settings.minEffectiveDepthM)
    return {status:'unavailable',speedMps:null,effectiveDepthM:finite(effectiveDepthM)?effectiveDepthM:null,
      reason:'No native depth at or above '+settings.minEffectiveDepthM+' m to divide by; a speed would be an artefact of a tiny denominator'};
  const raw=qM2s/effectiveDepthM;
  const capped=Math.max(-settings.maxDerivedSpeedMps,Math.min(settings.maxDerivedSpeedMps,raw));
  return {status:'derived',speedMps:capped,rawSpeedMps:raw,capped:capped!==raw,
    effectiveDepthM,maxDerivedSpeedMps:settings.maxDerivedSpeedMps,
    quantity:'depth-averaged speed',
    assumption:'Native unit-width discharge divided by the native cell-average depth on the contributing face. Depth-averaged and derived; the saved model exports no velocity and this is not a measured point speed.'};
}

// The junction160 union is 162.5 m across and is NOT centred on the projected
// scene centre: it reaches further north than south. A +/-80 m crop therefore
// holds only the INTERSECTION, silently dropping whole mask faces. Bounds come
// from the actual face rings so every full mask face is inside the domain.
export function maskLocalBounds({scene,maskNativeFaceIds,center=scene?.center}={}){
  if(!scene?.cells?.length)throw Error('The source scene cells are required for mask bounds');
  if(!Array.isArray(maskNativeFaceIds)||!maskNativeFaceIds.length)throw Error('Mask native face IDs are required');
  if(!Array.isArray(center)||center.length!==2||!center.every(finite))throw Error('A geographic centre is required');
  const northScale=111320,eastScale=northScale*Math.cos(center[1]*Math.PI/180);
  const wanted=new Set(maskNativeFaceIds.map(String));
  let minEast=Infinity,minNorth=Infinity,maxEast=-Infinity,maxNorth=-Infinity;
  const found=new Set();let areaM2=0;
  for(const cell of scene.cells){
    const id=String(cell.nativeFaceId);
    if(!wanted.has(id))continue;
    found.add(id);
    if(finite(cell.areaM2))areaM2+=cell.areaM2;
    const ring=cell.ring;
    if(!Array.isArray(ring)||ring.length<3)throw Error('Mask face '+id+' has no usable ring');
    for(const [lon,lat] of ring){
      const east=(lon-center[0])*eastScale,north=(lat-center[1])*northScale;
      if(east<minEast)minEast=east;if(east>maxEast)maxEast=east;
      if(north<minNorth)minNorth=north;if(north>maxNorth)maxNorth=north;
    }
  }
  const missing=maskNativeFaceIds.filter(id=>!found.has(String(id)));
  if(missing.length)throw Error(missing.length+' mask faces are absent from the scene; the domain would be a partial union');
  return {minEast,minNorth,maxEast,maxNorth,
    widthM:maxEast-minEast,depthM:maxNorth-minNorth,faceCount:found.size,areaM2,
    centredOnSceneCentre:Math.abs(minEast+maxEast)<1e-6&&Math.abs(minNorth+maxNorth)<1e-6,
    note:'Local tangent east/north bounds of the whole native-cell union, not a centred crop'};
}

// Split the loader's signed perimeter transport into inflow and outflow edges,
// keeping which native face is inside the mask. `inwardSign` is +1 when
// positive q enters, so the inside face is `toFace`; -1 reverses it.
export function prepareBoundary(transport,{edges,inwardSign}={}){
  if(!transport||!Array.isArray(transport.boundary))throw Error('A native boundary transport result is required');
  if(!Array.isArray(edges)||!Array.isArray(inwardSign))throw Error('Flow geometry edges and the mask inward signs are required');
  const inflow=[],outflow=[];
  for(const entry of transport.boundary){
    const edge=edges[entry.edgeIndex],sign=inwardSign[entry.edgeIndex];
    if(!edge||!(edge.widthM>0)||![1,-1].includes(sign))throw Error('Boundary edge is not a signed native perimeter edge');
    const innerFace=sign===1?edge.toFace:edge.fromFace;
    const outerFace=sign===1?edge.fromFace:edge.toFace;
    const record={edgeIndex:entry.edgeIndex,edgeId:edge.id,innerFace,outerFace,widthM:edge.widthM,
      inwardNormalEN:entry.inwardNormalEN,signedInflowM3s:entry.signedInflowM3s,
      qM2s:entry.signedInflowM3s/(sign*edge.widthM)};
    if(entry.signedInflowM3s>0)inflow.push(record);
    else if(entry.signedInflowM3s<0)outflow.push({...record,outflowM3s:-entry.signedInflowM3s});
  }
  const inflowM3s=inflow.reduce((sum,e)=>sum+e.signedInflowM3s,0);
  const outflowM3s=outflow.reduce((sum,e)=>sum+e.outflowM3s,0);
  // Weighted pick tables, so a wide fast edge carries proportionally more water.
  const cumulative=(list,value)=>{let total=0;return list.map(e=>{total+=value(e);return total;});};
  return {inflow,outflow,inflowM3s,outflowM3s,netInflowM3s:inflowM3s-outflowM3s,
    inflowCumulative:cumulative(inflow,e=>e.signedInflowM3s),
    outflowCumulative:cumulative(outflow,e=>e.outflowM3s)};
}

// Cell-centred velocity from the retained INTERNAL signed transport. On a
// staggered grid the two opposite face-normal unit discharges average to a
// cell-centred unit discharge, which divided by the native depth gives a
// depth-averaged speed. Declared reconstruction, not a native point velocity:
// the package exports no velocity at all.
export function reconstructFaceVelocities({edges,qM2s,faceIds,depthOf,options={}}={}){
  if(!Array.isArray(edges)||!Array.isArray(qM2s)||qM2s.length!==edges.length)throw Error('Flow edges and matching q are required');
  if(!Array.isArray(faceIds)||!faceIds.length)throw Error('Face IDs are required for the velocity reconstruction');
  if(typeof depthOf!=='function')throw Error('A native depth lookup is required');
  const settings={...FLOW_COUPLING_DEFAULTS,...options};
  const wanted=new Set(faceIds);
  // Per face: unit discharge on its east/west and north/south faces.
  const acc=new Map();
  const slot=id=>{let s=acc.get(id);if(!s)acc.set(id,s={ePlus:null,eMinus:null,nPlus:null,nMinus:null});return s;};
  edges.forEach((edge,i)=>{
    const q=qM2s[i];if(!finite(q))return;
    const east=edge.positiveNormalEN?.[0]===1,north=edge.positiveNormalEN?.[1]===1;
    if(!east&&!north)return;
    if(wanted.has(edge.fromFace)){const s=slot(edge.fromFace);if(east)s.ePlus=q;else s.nPlus=q;}
    if(wanted.has(edge.toFace)){const s=slot(edge.toFace);if(east)s.eMinus=q;else s.nMinus=q;}
  });
  const result=new Map();let derived=0,unavailable=0;
  for(const id of faceIds){
    const s=acc.get(id),depth=depthOf(id);
    const average=(a,b)=>a===null&&b===null?null:a===null?b:b===null?a:(a+b)/2;
    const qEast=s?average(s.ePlus,s.eMinus):null,qNorth=s?average(s.nPlus,s.nMinus):null;
    if(qEast===null&&qNorth===null||!finite(depth)||depth<settings.minEffectiveDepthM){
      unavailable++;
      result.set(id,{status:'unavailable',east:0,north:0,
        reason:!finite(depth)||depth<settings.minEffectiveDepthM
          ?'No native depth at or above '+settings.minEffectiveDepthM+' m on this face'
          :'No internal native transport incident on this face'});
      continue;
    }
    const cap=settings.maxDerivedSpeedMps;
    const rawEast=(qEast??0)/depth,rawNorth=(qNorth??0)/depth;
    const east=Math.max(-cap,Math.min(cap,rawEast)),north=Math.max(-cap,Math.min(cap,rawNorth));
    derived++;
    result.set(id,{status:'derived',east,north,rawEast,rawNorth,
      capped:east!==rawEast||north!==rawNorth,effectiveDepthM:depth,
      edgesUsed:[s.ePlus,s.eMinus,s.nPlus,s.nMinus].filter(v=>v!==null).length});
  }
  // What speed the source actually supports here. Without this the measured
  // particle motion has nothing to be judged against, and a fast-looking layer
  // could not be told apart from one that is faster than its own data.
  const speeds=[...result.values()].filter(v=>v.status==='derived')
    .map(v=>Math.hypot(v.east,v.north)).sort((a,b)=>a-b);
  const at=f=>speeds.length?speeds[Math.min(speeds.length-1,Math.floor(f*speeds.length))]:null;
  return {velocities:result,derivedFaces:derived,unavailableFaces:unavailable,
    derivedSpeedMps:{count:speeds.length,
      mean:speeds.length?speeds.reduce((a,b)=>a+b,0)/speeds.length:null,
      median:at(0.5),p90:at(0.9),max:speeds.at(-1)??null},
    quantity:'depth-averaged cell-centred velocity',
    assumption:'Opposite face-normal native unit discharges averaged to the cell centre, then divided by the native cell-average depth. Derived and depth-averaged; the saved model exports no velocity and this is not a measured point speed.'};
}

// One ledger PER EDGE. A chosen edge that has no wet support must not have its
// native discharge quietly re-drawn onto another edge: that would renormalise
// the native budget. Each edge keeps its own target, residual and discrepancy.
export function createEdgeLedger({edges,particleVolumeM3,direction}={}){
  if(!finite(particleVolumeM3)||particleVolumeM3<=0)throw Error('A positive particle volume is required for the flow ledger');
  if(!Array.isArray(edges))throw Error('Edges are required for the per-edge ledger');
  if(!['in','out'].includes(direction))throw Error('Ledger direction must be in or out');
  const books=edges.map(edge=>({edgeRef:edge,edgeId:edge.edgeId,edgeIndex:edge.edgeIndex,innerFace:edge.innerFace,
    rateM3s:direction==='in'?edge.signedInflowM3s:edge.outflowM3s,
    pendingM3:0,targetM3:0,movedM3:0,discrepancyM3:0,moved:0,rejected:0}));
  let simulatedSeconds=0;
  return {direction,books,
    // Accrue each edge's own volume; return the edges that have earned a whole
    // particle, in their own right.
    accrue(dt){
      if(!finite(dt)||dt<=0)throw Error('Flow accrual needs a positive step');
      simulatedSeconds+=dt;const due=[];
      for(const book of books){
        if(!(book.rateM3s>0))continue;
        const volume=book.rateM3s*dt;book.targetM3+=volume;book.pendingM3+=volume;
        const whole=Math.floor(book.pendingM3/particleVolumeM3);
        if(whole>0)due.push({book,count:whole});
      }
      return due;
    },
    // Settle one edge only. A refusal stays that edge's discrepancy.
    settle(book,{moved=0,rejected=0}={}){
      if(!Number.isInteger(moved)||!Number.isInteger(rejected)||moved<0||rejected<0)throw Error('Ledger settlement needs whole particle counts');
      book.movedM3+=moved*particleVolumeM3;book.moved+=moved;
      book.discrepancyM3+=rejected*particleVolumeM3;book.rejected+=rejected;
      book.pendingM3-=(moved+rejected)*particleVolumeM3;
    },
    get stats(){
      const sum=key=>books.reduce((t,b)=>t+b[key],0);
      const targetM3=sum('targetM3'),movedM3=sum('movedM3'),pendingM3=sum('pendingM3'),discrepancyM3=sum('discrepancyM3');
      return {direction,particleVolumeM3,simulatedSeconds,edges:books.length,
        targetM3,movedM3,pendingM3,discrepancyM3,
        moved:sum('moved'),rejected:sum('rejected'),
        edgesWithDiscrepancy:books.filter(b=>b.discrepancyM3>0).length,
        maxEdgePendingM3:books.reduce((m,b)=>Math.max(m,b.pendingM3),0),
        // Per edge and in total: target = moved + pending + discrepancy.
        balanceM3:targetM3-(movedM3+pendingM3+discrepancyM3),
        perEdgeBalanced:books.every(b=>Math.abs(b.targetM3-(b.movedM3+b.pendingM3+b.discrepancyM3))<1e-9)};
    }};
}

export function pickWeighted(cumulative,unitRandom){
  if(!cumulative.length)return -1;
  const total=cumulative[cumulative.length-1];
  if(!(total>0))return -1;
  const target=Math.min(Math.max(unitRandom,0),1)*total;
  for(let i=0;i<cumulative.length;i++)if(target<=cumulative[i])return i;
  return cumulative.length-1;
}

// Whole particles carry whole volumes, but native discharge does not arrive in
// whole particles. The remainder is kept, never rounded away, so the ledger can
// be checked against the native budget exactly.
export function createVolumeLedger({particleVolumeM3,options={}}={}){
  if(!finite(particleVolumeM3)||particleVolumeM3<=0)throw Error('A positive particle volume is required for the flow ledger');
  const settings={...FLOW_COUPLING_DEFAULTS,...options};
  let pendingInM3=0,pendingOutM3=0,injectedM3=0,removedM3=0,
      targetInM3=0,targetOutM3=0,simulatedSeconds=0,discrepancyM3=0,clampedEvents=0;
  return {
    get particleVolumeM3(){return particleVolumeM3;},
    // Accrue the native budget over one simulation step and return how many
    // whole particles that pays for in each direction.
    accrue(inflowM3s,outflowM3s,dt){
      if(![inflowM3s,outflowM3s,dt].every(finite)||dt<=0||inflowM3s<0||outflowM3s<0)throw Error('Flow accrual needs non-negative budgets and a positive step');
      const inVolume=inflowM3s*dt,outVolume=outflowM3s*dt;
      targetInM3+=inVolume;targetOutM3+=outVolume;simulatedSeconds+=dt;
      pendingInM3+=inVolume;pendingOutM3+=outVolume;
      const wanted=Math.floor(pendingInM3/particleVolumeM3);
      const leaving=Math.floor(pendingOutM3/particleVolumeM3);
      const inject=Math.min(wanted,settings.maxRecyclesPerStep);
      const remove=Math.min(leaving,settings.maxRecyclesPerStep);
      if(inject<wanted||remove<leaving)clampedEvents++;
      return {inject,remove};
    },
    // Confirm what the particle set actually managed to do. Anything the wet
    // support could not accept stays in `discrepancyM3` and is reported.
    settle({injected,removed,rejected=0}){
      if(![injected,removed,rejected].every(n=>Number.isInteger(n)&&n>=0))throw Error('Ledger settlement needs whole particle counts');
      pendingInM3-=injected*particleVolumeM3;
      pendingOutM3-=removed*particleVolumeM3;
      injectedM3+=injected*particleVolumeM3;
      removedM3+=removed*particleVolumeM3;
      if(rejected){discrepancyM3+=rejected*particleVolumeM3;pendingInM3-=rejected*particleVolumeM3;}
      return this.stats;
    },
    get stats(){return {particleVolumeM3,simulatedSeconds,
      targetInM3,targetOutM3,injectedM3,removedM3,
      pendingInM3,pendingOutM3,discrepancyM3,clampedEvents,
      netTargetM3:targetInM3-targetOutM3,netMovedM3:injectedM3-removedM3,
      // Every cubic metre the native budget delivered is either in the particle
      // set, waiting as a fraction, or recorded as a discrepancy.
      inBalanceM3:targetInM3-(injectedM3+pendingInM3+discrepancyM3),
      outBalanceM3:targetOutM3-(removedM3+pendingOutM3),
      meaning:'Instantaneous native perimeter transport accrued over simulated time; not a full water balance (rain, infiltration and storage change are separate)'};}};
}
