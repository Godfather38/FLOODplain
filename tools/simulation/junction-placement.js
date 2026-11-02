// Places the baked Brawley junction and its source-bound particles inside the
// EXISTING shared geographic camera. There is no independent camera, controls,
// scene graph root or alternate CRS here: the caller passes the same
// `project([lon,lat])`, `altitude(metres)`, `origin` and `baseM` that the
// refined water/terrain model already uses, so the junction lands in exactly
// that frame and cannot be pushed through the ground by a private transform.
//
// Static baked geometry is projected vertex by vertex, so it carries no
// linearization error at all. Per-step particle positions use one bounded local
// tangent plane at the scene centre (the same approximation the compute module
// documents) because projecting thousands of particles per frame through the
// map is not affordable; `verifyLinearization` measures that error against the
// real projection and refuses to run if it exceeds the declared tolerance.
const finite=Number.isFinite;
export const METRES_PER_DEGREE_LATITUDE=111320;

export function createJunctionPlacement({center,baseElevationM,project,altitude,origin,baseM,
  particleExtentMetres=[160,160],toleranceM=0.1,probeMetres=50}={}){
  if(!Array.isArray(center)||center.length!==2||!center.every(finite)||Math.abs(center[0])>180||Math.abs(center[1])>90)throw Error('A geographic junction centre is required');
  if(!finite(baseElevationM))throw Error('The baked base elevation is required');
  if(typeof project!=='function'||typeof altitude!=='function')throw Error('The existing map project/altitude callbacks are required');
  if(!origin||![origin.x,origin.y,origin.z].every(finite))throw Error('The existing renderer origin is required');
  if(!finite(baseM))throw Error('The existing terrain base elevation is required');
  if(!finite(toleranceM)||toleranceM<=0||!finite(probeMetres)||probeMetres<=0)throw Error('Positive placement tolerance and probe distance required');
  const [particleWidth,particleDepth]=particleExtentMetres;
  if(!(particleWidth>0&&particleDepth>0&&particleWidth<=500&&particleDepth<=500))throw Error('One junction particle extent must be within 500 m');

  const northScale=METRES_PER_DEGREE_LATITUDE,eastScale=northScale*Math.cos(center[1]*Math.PI/180);
  if(!(eastScale>0))throw Error('Degenerate junction longitude scale');
  const geographicAt=([east,north])=>[center[0]+east/eastScale,center[1]+north/northScale];
  const localToGeographic=([east,north,navd88])=>[...geographicAt([east,north]),navd88];

  // Vertical units come straight from the host altitude callback. A non-linear
  // callback would silently stretch or sink the junction, so reject it here.
  const zeroZ=altitude(0),unitZ=altitude(1)-zeroZ,farZ=altitude(100)-zeroZ;
  if(!finite(zeroZ)||!finite(unitZ)||unitZ===0)throw Error('The map altitude callback did not return a usable vertical scale');
  if(Math.abs(farZ-unitZ*100)>Math.abs(unitZ)*1e-6)throw Error('Non-linear map altitude callback cannot place absolute NAVD88 geometry');
  const elevationToLocalZ=navd88=>altitude(navd88-baseM);

  const probe=p=>{const v=project(p);if(!v||![v.x,v.y].every(finite))throw Error('The map projection returned a non-finite junction point');return v;};
  const centreVector=probe(center);
  const east=probe(geographicAt([probeMetres,0])),north=probe(geographicAt([0,probeMetres]));
  const unitsPerMetre={
    east:(east.x-centreVector.x)/probeMetres,
    north:(north.y-centreVector.y)/probeMetres,
    up:unitZ};
  if(!(Math.abs(unitsPerMetre.east)>0)||!(Math.abs(unitsPerMetre.north)>0))throw Error('Degenerate horizontal map scale at the junction');
  const horizontalUnitsPerMetre=(Math.abs(unitsPerMetre.east)+Math.abs(unitsPerMetre.north))/2;
  const metresToUnits=m=>{if(!finite(m))throw Error('Non-finite junction distance');return m*horizontalUnitsPerMetre;};

  const localX=p=>p.x-origin.x,localY=p=>p.y-origin.y;
  // Exact path: one real projection per supplied geographic vertex.
  const projectExact=([lon,lat,navd88])=>{const v=probe([lon,lat]);return [localX(v),localY(v),elevationToLocalZ(navd88)];};
  // Bounded linear path for per-step particle state.
  const centreLocal=[localX(centreVector),localY(centreVector)];
  const toLocal=([e,n,navd88])=>[centreLocal[0]+e*unitsPerMetre.east,centreLocal[1]+n*unitsPerMetre.north,elevationToLocalZ(navd88)];

  function verifyLinearization(extentMetres=[particleWidth,particleDepth]){
    const [width,depth]=extentMetres;
    let maxDeviationUnits=0,worst=null;
    for(const e of [-width/2,-width/4,0,width/4,width/2])for(const n of [-depth/2,-depth/4,0,depth/4,depth/2]){
      const exact=projectExact([...geographicAt([e,n]),baseElevationM]),linear=toLocal([e,n,baseElevationM]);
      const deviation=Math.hypot(exact[0]-linear[0],exact[1]-linear[1]);
      if(deviation>maxDeviationUnits){maxDeviationUnits=deviation;worst=[e,n];}
    }
    const maxDeviationM=maxDeviationUnits/horizontalUnitsPerMetre;
    if(!(maxDeviationM<=toleranceM))throw Error('Junction particle placement deviates '+maxDeviationM.toFixed(3)+' m from the real map projection, above the '+toleranceM+' m tolerance');
    return {maxDeviationM,maxDeviationUnits,worstOffsetMetres:worst,extentMetres:[width,depth],toleranceM};
  }

  return {center,baseElevationM,baseM,origin,unitsPerMetre,horizontalUnitsPerMetre,metresToUnits,
    geographicAt,localToGeographic,projectExact,toLocal,elevationToLocalZ,verifyLinearization,
    provenance:{frame:'Existing shared geographic renderer frame; no independent camera or CRS',
      verticalDatum:'NAVD88 absolute, converted through the host altitude callback',
      tangentPlane:'Bounded local tangent plane at the junction centre for per-step particles only',
      metresPerDegree:[eastScale,northScale]}};
}

// Convert one baked mesh (x east, y above base, z south) into the host frame.
// `out` is filled in place so a 10k-triangle bake allocates one Float32Array.
export function bakedPositionsToLocal(positions,{placement,baseElevationM,exact=true,out}={}){
  if(!(positions instanceof Float32Array)||positions.length%3)throw Error('Baked positions must be whole XYZ triples');
  if(!placement)throw Error('A junction placement is required');
  if(!finite(baseElevationM))throw Error('The baked base elevation is required');
  const result=out instanceof Float32Array&&out.length===positions.length?out:new Float32Array(positions.length);
  for(let i=0;i<positions.length;i+=3){
    const east=positions[i],north=-positions[i+2],navd88=positions[i+1]+baseElevationM;
    const local=exact?placement.projectExact([...placement.geographicAt([east,north]),navd88]):placement.toLocal([east,north,navd88]);
    result[i]=local[0];result[i+1]=local[1];result[i+2]=local[2];
  }
  return result;
}

// Baked normals share the same axis swap but carry no translation or datum.
export function bakedNormalsToLocal(normals,{placement,out}={}){
  if(!(normals instanceof Float32Array)||normals.length%3)throw Error('Baked normals must be whole XYZ triples');
  if(!placement)throw Error('A junction placement is required');
  const {east,north,up}=placement.unitsPerMetre;
  const result=out instanceof Float32Array&&out.length===normals.length?out:new Float32Array(normals.length);
  for(let i=0;i<normals.length;i+=3){
    const x=normals[i]*east,y=-normals[i+2]*north,z=normals[i+1]*up;
    const length=Math.hypot(x,y,z)||1;
    result[i]=x/length;result[i+1]=y/length;result[i+2]=z/length;
  }
  return result;
}
