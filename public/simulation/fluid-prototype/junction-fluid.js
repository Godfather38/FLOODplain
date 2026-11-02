import WrappedGL from './vendor/js/wrappedgl.js';
import Simulator from './vendor/js/simulator.js';

export const FLUID_UPSTREAM={repository:'https://github.com/jizhouxu/3d-fluid-simulation',commit:'7d6640693745591ff37eadd4276cde3ecba51ac4',license:'MIT'};

// Shallow-water sizing. The water here is about 0.2 m deep. The first build
// sized one 3.33 m cube per axis from the 160 m box, which left the pressure
// grid three cells tall and quantised the bed into 3.33 m steps: the wash was
// invisible to the solver, so nothing could pool or travel. These numbers fit
// the solver box to the frame's own wet area and give the sheet cells it can be
// resolved in.
export const SHALLOW_GRID=Object.freeze({
  targetParticlesPerCell:4,
  maxHorizontalCells:96,maxVerticalCells:32,minCells:16,
  minVerticalCellM:0.05,maxVerticalCellM:0.4,verticalCellsPerDepth:2.5,
  minHorizontalCellM:0.4,maxHorizontalCellM:4,
  marginM:6,headroomM:0.3,floorClearanceM:0.12,
  // Bounded, declared headroom above the native water surface so the free
  // surface can be found by the particles instead of being pinned flat. The
  // native surface stays the authoritative risk reference and is reported
  // separately; this is an illustrative excursion limit, not a hazard extent.
  surfaceExcursionM:0.06,
  // One readback costs ~450 ms under SwiftShader against ~2 ms of solve, so the
  // readback — not the physics — set how much simulated time passed per second.
  // Sharing it across more steps advances the simulation closer to real time.
  // This is not a velocity boost: each step still uses the same dt.
  stepsPerReadback:8,
  // How hard the horizontal grid velocity is held toward the saved run's own
  // reconstructed cell velocity, per simulated second. A relaxation rate, not a
  // speed: it decides how fast the water returns to the source-derived field
  // after the pressure solve pushes it off, and never what that field says.
  // Measured, not guessed. At 1.5/s the driven water runs at 0.060 m/s against
  // a source field of 0.141 m/s; quadrupling the rate to 6/s moves it only to
  // 0.067 m/s. The relaxation rate is therefore not what limits the speed — the
  // incompressibility projection removes most of the reconstructed field, which
  // is not divergence-free on this grid — so the gentler rate is kept, because
  // the stronger one overrides the solver more for no measured gain.
  sourceFlowStrengthPerSecond:1.5,
  // How absorbing the native-supported lateral box edge is. 0 is the upstream
  // closed tank, which forbade any net horizontal flux across the box edge even
  // where the saved run runs water straight through it. 1 is a fully absorbing
  // outflow, which imposes no pressure of its own and would let the junction
  // drain itself. This is a partially absorbing edge: enough for flux to cross,
  // little enough that it does not manufacture a head. The drainage it causes
  // is measured (`openBoundary.edgeShare`) rather than assumed.
  openBoundaryStrength:0.25});
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const abort=()=>new DOMException('Junction fluid disposed','AbortError');

// IEEE 754 binary16, for uploading into the solver's half-float textures.
const halfView=new DataView(new ArrayBuffer(4));
export function toHalfFloat(source){
 const out=new Uint16Array(source.length);
 for(let i=0;i<source.length;i++){
  halfView.setFloat32(0,source[i]);
  const bits=halfView.getUint32(0),sign=(bits>>>16)&0x8000;
  let exponent=(bits>>>23)&0xff,mantissa=bits&0x7fffff;
  if(exponent===255){out[i]=sign|0x7c00|(mantissa?0x200:0);continue;}
  exponent=exponent-127+15;
  if(exponent>=31){out[i]=sign|0x7c00;continue;}
  if(exponent<=0){out[i]=sign;continue;}
  out[i]=sign|(exponent<<10)|(mantissa>>>13);
 }
 return out;
}

// Rasterize ONLY the supplied, source-bound terrain triangles. No DEM download,
// native-velocity inference, synthetic tank, inlet jet, or terrain extrapolation.
// `maskNativeFaceIds` aligns the particle domain to an exact native-cell union
// (the flow package's junction160 mask), instead of the old raster square that
// the native perimeter budget does not describe. Faces outside the union are
// treated as unsupported, so no particle and no injected volume can land there.
export function createJunctionField(options0){
 const {scene,terrainTiles,center=scene.center,extentMeters=[160,160],fieldResolution=128,maskNativeFaceIds=null}=options0;
 if(scene.schema!=='floodplain-scene-v1'||scene.verticalDatum!=='NAVD88'||scene.coordinates?.order!=='longitude,latitude')throw Error('A metric NAVD88 scene contract is required');
 if(!Array.isArray(terrainTiles)||!terrainTiles.length)throw Error('Actual source terrain is required');
 if(!scene.cells?.length||!scene.frames?.length)throw Error('Native source cells and frames are required');
 // `localBounds` (minEast, minNorth, maxEast, maxNorth) describes an ASYMMETRIC
 // box. The native-cell union is not centred on the scene centre, so a centred
 // extent would clip whole mask faces and leave only the intersection.
 const bounds=options0.localBounds;
 const width=bounds?bounds.maxEast-bounds.minEast:extentMeters[0];
 const depth=bounds?bounds.maxNorth-bounds.minNorth:extentMeters[1];
 const originEast=bounds?bounds.minEast:-extentMeters[0]/2;
 const originNorth=bounds?bounds.minNorth:-extentMeters[1]/2;
 if(!(width>0&&depth>0&&width<=500&&depth<=500))throw Error('One junction extent must be within 500 m');
 const resolution=clamp(Math.floor(fieldResolution),32,256),eastScale=111320*Math.cos(center[1]*Math.PI/180),northScale=111320;
 const project=([lon,lat,z])=>[(lon-center[0])*eastScale-originEast,(lat-center[1])*northScale-originNorth,z];
 const beds=new Float32Array(resolution*resolution).fill(NaN),faces=new Int32Array(beds.length).fill(-1),ids=new Map(scene.cells.map((c,i)=>[String(c.nativeFaceId),i]));
 // Exact native-cell union. Membership is by native face ID, so the particle
 // domain is the same set of whole faces the perimeter budget was summed over.
 let maskCells=null;
 if(maskNativeFaceIds){
  if(!Array.isArray(maskNativeFaceIds)||!maskNativeFaceIds.length)throw Error('A native-cell union needs face IDs');
  maskCells=new Set();
  for(const id of maskNativeFaceIds){const cell=ids.get(String(id));if(cell!==undefined)maskCells.add(cell);}
  if(!maskCells.size)throw Error('No scene face matched the supplied native-cell union');
 }
 let acceptedTriangles=0;
 for(const tile of terrainTiles){
  const cert=scene.terrainGeometryEquivalence;
  const same=tile.runId===scene.runId&&tile.geometrySha256===scene.geometrySha256;
  const certified=cert?.method==='exact-native-geometry'&&cert.targetRunId===scene.runId&&cert.targetGeometrySha256===scene.geometrySha256&&tile.runId===cert.sourceRunId&&tile.geometrySha256===cert.sourceGeometrySha256;
  if(tile.kind!=='native_face_triangle_terrain'||tile.verticalDatum!=='NAVD88'||!same&&!certified)throw Error('Terrain does not match the native scene geometry');
  if(tile.triangles.length!==tile.triangleFaceId.length)throw Error('Terrain face identity mismatch');
  const vertices=tile.vertices.map(project);
  tile.triangles.forEach((triangle,t)=>{
   const cell=ids.get(String(tile.triangleFaceId[t]));if(cell===undefined)return;
   const [a,b,c]=triangle.map(i=>vertices[i]);if(!a||!b||!c)return;
   const denominator=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);if(Math.abs(denominator)<1e-12)return;
   const x0=clamp(Math.floor(Math.min(a[0],b[0],c[0])/width*resolution),0,resolution-1),x1=clamp(Math.floor(Math.max(a[0],b[0],c[0])/width*resolution),0,resolution-1);
   const z0=clamp(Math.floor(Math.min(a[1],b[1],c[1])/depth*resolution),0,resolution-1),z1=clamp(Math.floor(Math.max(a[1],b[1],c[1])/depth*resolution),0,resolution-1);
   for(let z=z0;z<=z1;z++)for(let x=x0;x<=x1;x++){
    const px=(x+.5)/resolution*width,pz=(z+.5)/resolution*depth;
    const u=((b[1]-c[1])*(px-c[0])+(c[0]-b[0])*(pz-c[1]))/denominator,v=((c[1]-a[1])*(px-c[0])+(a[0]-c[0])*(pz-c[1]))/denominator,w=1-u-v;
    if(Math.min(u,v,w)<-1e-7)continue;const k=z*resolution+x;beds[k]=u*a[2]+v*b[2]+w*c[2];faces[k]=cell;
   }acceptedTriangles++;
  });
 }
 const valid=beds.filter(Number.isFinite);if(!valid.length)throw Error('No source terrain in this junction extent');
 const baseM=Math.floor(Math.min(...valid))-1;
 function frameField(index){
  const frame=scene.frames[index];if(!frame||frame.depthM.length!==scene.cells.length||frame.waterSurfaceM.length!==scene.cells.length)throw Error('Native frame unavailable');
  const data=new Float32Array(beds.length*4),weights=[],area=width*depth/beds.length;let volume=0,maxY=1;
  // The solver box is fitted to THIS frame's own wet area. Sizing a 160 m cube
  // around 0.2 m of water is what left the pressure grid three cells tall with
  // the bed quantised into 3.33 m steps, so nothing could pool or travel.
  let wetMinX=Infinity,wetMaxX=-Infinity,wetMinZ=Infinity,wetMaxZ=-Infinity,wetMinBed=Infinity,wetMaxZs=-Infinity,wetSamples=0;
  for(let k=0;k<beds.length;k++){
   const i=faces[k],inMask=i>=0&&(!maskCells||maskCells.has(i));
   const bed=beds[k],zs=!inMask?null:frame.waterSurfaceM[i],d=!inMask?null:frame.depthM[i],wet=Number.isFinite(bed)&&Number.isFinite(zs)&&Number.isFinite(d)&&d>=.01&&zs-bed>.005;
   data[k*4]=Number.isFinite(bed)?bed-baseM:1e4;data[k*4+1]=wet?zs-baseM:data[k*4];data[k*4+2]=wet?1:0;data[k*4+3]=i;
   if(wet){volume+=(zs-bed)*area;weights.push([k,volume]);maxY=Math.max(maxY,zs-baseM);
    const px=((k%resolution)+.5)/resolution*width,pz=(Math.floor(k/resolution)+.5)/resolution*depth;
    if(px<wetMinX)wetMinX=px;if(px>wetMaxX)wetMaxX=px;
    if(pz<wetMinZ)wetMinZ=pz;if(pz>wetMaxZ)wetMaxZ=pz;
    if(bed<wetMinBed)wetMinBed=bed;if(zs>wetMaxZs)wetMaxZs=zs;
    wetSamples++;}
  }
  const wetArea=wetSamples*area;
  return {frame,data,weights,volume,maxY,wetSamples,wetArea,
   wetBounds:wetSamples?[wetMinX,wetMinZ,wetMaxX,wetMaxZ]:null,
   wetMinBedM:wetSamples?wetMinBed:null,wetMaxZsM:wetSamples?wetMaxZs:null,
   meanDepthM:wetArea>0?volume/wetArea:0};
 }
 // Field cells grouped by native scene cell, so an edge's inner native face can
 // be turned into real places to put or take water without any re-projection.
 let faceCells=null;
 function cellsForFace(){
  if(faceCells)return faceCells;
  faceCells=new Map();
  for(let k=0;k<faces.length;k++){const i=faces[k];if(i<0)continue;
   if(!maskCells||maskCells.has(i)){let list=faceCells.get(i);if(!list)faceCells.set(i,list=[]);list.push(k);}}
  return faceCells;
 }
 // Coverage proof: every mask face must actually be represented by field cells,
 // or the domain silently holds less than the union the budget was summed over.
 function maskCoverage(){
  if(!maskCells)return null;
  const cells=cellsForFace();const perFace=[];let covered=0,areaCovered=0,areaTotal=0;
  const cellArea=width*depth/beds.length;
  for(const cell of maskCells){
   const list=cells.get(cell)||[],face=scene.cells[cell];
   areaTotal+=face?.areaM2??0;areaCovered+=list.length*cellArea;
   if(list.length)covered++;else perFace.push({cellIndex:cell,nativeFaceId:face?.nativeFaceId??null,fieldCells:0});
  }
  return {maskFaces:maskCells.size,facesWithFieldCells:covered,facesWithoutFieldCells:maskCells.size-covered,
   uncovered:perFace,nativeAreaM2:areaTotal,rasterisedAreaM2:areaCovered,
   coverageRatio:areaTotal>0?areaCovered/areaTotal:0};
 }
 return {scene,center,width,depth,resolution,beds,faces,baseM,frameField,acceptedTriangles,cellsForFace,maskCoverage,
  originEast,originNorth,localBounds:{minEast:originEast,minNorth:originNorth,maxEast:originEast+width,maxNorth:originNorth+depth},
  maskCellCount:maskCells?maskCells.size:null,maskNativeFaceIds:maskNativeFaceIds||null,
  faceIndexOf:id=>{const cell=ids.get(String(id));return cell===undefined?-1:cell;},
  // Field cell centre in local east/north metres, for edge-local placement.
  cellCentre:k=>[((k%resolution)+.5)/resolution*width+originEast,(Math.floor(k/resolution)+.5)/resolution*depth+originNorth],
  localToGeographic:([east,north,z])=>[center[0]+east/eastScale,center[1]+north/northScale,z],
  provenance:{runId:scene.runId,geometrySha256:scene.geometrySha256,verticalDatum:'NAVD88',terrainEquivalence:scene.terrainGeometryEquivalence,fieldSpacingM:[width/resolution,depth/resolution]}};
}

// Compute-only context: no visible canvas, camera, map, controls or animation loop.
// The caller steps and renders the returned native-metric particle positions in
// the EXISTING geographic scene. The local solver owns its illustrative velocity.
export async function createJunctionFluid(options){
 const field=createJunctionField(options),maxParticles=clamp(Math.floor((options.maxParticles??2048)/64)*64,64,4096);
 const canvas=typeof OffscreenCanvas==='function'?new OffscreenCanvas(1,1):document.createElement('canvas');canvas.width=canvas.height=1;
 const wgl=new WrappedGL(canvas,{alpha:false,antialias:false}),gl=wgl.gl;
 for(const name of ['ANGLE_instanced_arrays','OES_texture_float','OES_texture_float_linear','OES_texture_half_float','OES_texture_half_float_linear'])if(!wgl.getExtension(name))throw Error('PIC/FLIP requires '+name);
 gl.getExtension('WEBGL_color_buffer_float');gl.getExtension('EXT_color_buffer_half_float');wgl.assertRenderable(gl.FLOAT);wgl.assertRenderable(wgl.getExtension('OES_texture_half_float').HALF_FLOAT_OES);
 const simulator=new Simulator(wgl,()=>{});await simulator.ready;
 simulator.terrainTexture=wgl.createTexture();simulator.flipness=.88;simulator.pressureIterations=24;
 let disposed=false,count=0,positions=new Float32Array(),velocities=new Float32Array(),nativeCellIndices=new Int32Array(),raw=new Float32Array(),lastPositions=new Float32Array(),current,elapsed=0,steps=0,readbackMs=0,solveMs=0,clippedVolumeM3=0,radiusM=0,frameIndex=0,solverBox=null;
 // Explicit identity: a particle's generation increments every time the open
 // boundary moves it. Continuous-motion measurement excludes those exactly,
 // instead of guessing at outliers.
 let generations=new Int32Array(),lastGenerations=new Int32Array(),free=[];
 const stats={solver:'PIC/FLIP',sourceVelocityAvailable:false,motionMeaning:'Illustrative locally simulated pressure/gravity motion initialized from native terrain and water; not native forecast velocity',boundaryMeaning:'Closed bounded junction; dry/missing/native-water support is impermeable; no inferred inlet or discharge',upstream:FLUID_UPSTREAM,steps:0};
 function readPositions(){
  const t=performance.now();wgl.framebufferTexture2D(simulator.simulationFramebuffer,gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,simulator.particlePositionTexture,0);
  wgl.readPixels(wgl.createReadState().bindFramebuffer(simulator.simulationFramebuffer),0,0,64,count/64,gl.RGBA,gl.FLOAT,raw);
  const error=gl.getError();if(error!==gl.NO_ERROR)throw Error('Particle readback unavailable: WebGL '+error);
  // Solver coordinates are relative to the fitted box; convert back to the
  // field's own centred east/north and absolute NAVD88 before anyone sees them.
  const ox=solverBox?solverBox.x0:0,oz=solverBox?solverBox.z0:0,base=solverBox?solverBox.baseM:field.baseM;
  for(let i=0;i<count;i++){
   const fx=raw[i*4]+ox,fz=raw[i*4+2]+oz;
   positions[i*3]=fx+field.originEast;positions[i*3+1]=fz+field.originNorth;positions[i*3+2]=raw[i*4+1]+base;
   const x=clamp(Math.floor(fx/field.width*field.resolution),0,field.resolution-1),y=clamp(Math.floor(fz/field.depth*field.resolution),0,field.resolution-1);
   nativeCellIndices[i]=field.faces[y*field.resolution+x];}
  readbackMs=performance.now()-t;
 }
 function initializeFrame(index){
  if(disposed)throw abort();current=field.frameField(index);frameIndex=index;elapsed=steps=0;clippedVolumeM3=current.volume;count=current.volume>0?maxParticles:0;
  positions=new Float32Array(count*3);velocities=new Float32Array(count*3);nativeCellIndices=new Int32Array(count);lastPositions=new Float32Array(count*3);raw=new Float32Array(count*4);
  generations=new Int32Array(count);lastGenerations=new Int32Array(count);
  free=[];flowStats=null;activeCount=count;momentumUnavailable=0;
  // A new frame has a new solver box, so the previous frame's source-flow field
  // no longer lines up. It stays off until this frame's reconstruction is given.
  simulator.sourceFlowStrength=0;
  Object.assign(stats,{sourceTime:current.frame.validTime,sourceSha256:current.frame.sourceSha256,sourceFrameIndex:index,particleCount:count,clippedInitialVolumeM3:current.volume,wetFieldSamples:current.weights.length,steps:0,elapsedSeconds:0,solveSubmissionMs:0,readbackMs:0,readbackBytes:raw.byteLength,meanSimulatedHorizontalVelocityMps:[0,0],maxStepDisplacementM:0});
  if(!count||!current.wetBounds){count=0;radiusM=0;solverBox=null;return stats;}
  const R=field.resolution,G=SHALLOW_GRID;
  // 1. Fit the solver box to this frame's wet area, with a margin so water can
  //    move inside it. Dry ground outside stays untouched and unsimulated.
  const [wx0,wz0,wx1,wz1]=current.wetBounds;
  const bx0=Math.max(0,wx0-G.marginM),bz0=Math.max(0,wz0-G.marginM);
  const bx1=Math.min(field.width,wx1+G.marginM),bz1=Math.min(field.depth,wz1+G.marginM);
  const boxW=Math.max(4,bx1-bx0),boxD=Math.max(4,bz1-bz0);
  // 2. Vertical extent spans only the wet bed-to-surface band, not the whole
  //    junction's relief, so the cells can be centimetres rather than metres.
  const solverBase=current.wetMinBedM-G.floorClearanceM;
  const boxH=Math.max(.4,current.wetMaxZsM+G.surfaceExcursionM+G.headroomM-solverBase);
  // 3. Vertical cell from the water depth; horizontal cell from the particle
  //    volume so the transfer has enough particles per cell to be stable.
  const dyWanted=clamp(current.meanDepthM/G.verticalCellsPerDepth,G.minVerticalCellM,G.maxVerticalCellM);
  const cellVolume=current.volume/count*G.targetParticlesPerCell;
  const dxzWanted=clamp(Math.sqrt(cellVolume/dyWanted),G.minHorizontalCellM,G.maxHorizontalCellM);
  const gx=clamp(Math.ceil(boxW/dxzWanted),G.minCells,G.maxHorizontalCells);
  const gz=clamp(Math.ceil(boxD/dxzWanted),G.minCells,G.maxHorizontalCells);
  const gy=clamp(Math.ceil(boxH/dyWanted),6,G.maxVerticalCells);
  const grid=[gx,gy,gz],size=[boxW,boxH,boxD];
  const dx=boxW/gx,dy=boxH/gy,dz=boxD/gz;
  // 4. Re-rasterise the terrain/support field so the texture spans exactly the
  //    solver box. junctionField divides by the box size, so no shader change is
  //    needed and the bed cannot end up stretched across the wrong ground.
  const boxData=new Float32Array(R*R*4);
  for(let z=0;z<R;z++)for(let x=0;x<R;x++){
   const px=bx0+(x+.5)/R*boxW,pz=bz0+(z+.5)/R*boxD;
   const sx=clamp(Math.floor(px/field.width*R),0,R-1),sz=clamp(Math.floor(pz/field.depth*R),0,R-1);
   const s=(sz*R+sx)*4,d=(z*R+x)*4,support=current.data[s+2];
   const bedRel=current.data[s];
   boxData[d]=bedRel>=1e3?1e4:bedRel+field.baseM-solverBase;
   // G is a bounded ceiling, never a flat pin: the surface is found by the
   // particles between the measured bed and this limit.
   boxData[d+1]=support>.5?current.data[s+1]+field.baseM-solverBase+G.surfaceExcursionM:boxData[d];
   boxData[d+2]=support;boxData[d+3]=current.data[s+3];
  }
  solverBox={x0:bx0,z0:bz0,width:boxW,depth:boxD,height:boxH,baseM:solverBase,cellM:[dx,dy,dz]};
  // How much of the water actually reaches the wall of the Eulerian box. The
  // pressure grid is a closed tank: junctionSolid treats everything outside the
  // grid as solid, so no net horizontal flux can cross the box edge. Where wet
  // ground runs right up to that edge — which is where the wash leaves the
  // junction — a steady through-current is forbidden by the grid itself, not by
  // the data. This counts it rather than leaving it as an assertion.
  let edgeTexels=0,wetEdgeTexels=0,wetTexels=0;
  for(let z=0;z<R;z++)for(let x=0;x<R;x++){
   const wet=boxData[(z*R+x)*4+2]>.5;
   if(wet)wetTexels++;
   if(x===0||z===0||x===R-1||z===R-1){edgeTexels++;if(wet)wetEdgeTexels++;}
  }
  // A new frame means a new box: any perimeter flux belongs to the old one and
  // must be rebuilt from this frame's snapshot before it is used again.
  simulator.perimeterFluxStrength=0;perimeterFlux=null;
  closedTank={edgeSamples:edgeTexels,wetEdgeSamples:wetEdgeTexels,wetSamples:wetTexels,
   wetEdgeShare:edgeTexels?wetEdgeTexels/edgeTexels:0,
   lateralBoundary:'closed; flux enters through prescribed native perimeter faces',
   meaning:'The grid itself stays closed on all sides, as upstream. Water crosses the junction through the native perimeter faces, where the saved run\'s own signed discharge prescribes the face velocity directly. Nothing is drained toward an invented outside pressure.'};
  wgl.rebuildTexture(simulator.terrainTexture,wgl.RGBA,wgl.FLOAT,R,R,boxData,wgl.CLAMP_TO_EDGE,wgl.CLAMP_TO_EDGE,wgl.NEAREST,wgl.NEAREST);
  const particles=[];let cursor=0;const fract=x=>x-Math.floor(x);
  for(let i=0;i<count;i++){
   const target=(i+.5)/count*current.volume;while(current.weights[cursor][1]<target)cursor++;
   const k=current.weights[cursor][0],x=k%R,z=Math.floor(k/R);
   const bed=current.data[k*4]+field.baseM-solverBase,surface=current.data[k*4+1]+field.baseM-solverBase;
   const px=(x+.15+.7*fract((i+1)*.61803398875))/R*field.width-bx0;
   const pz=(z+.15+.7*fract((i+1)*.569840291))/R*field.depth-bz0;
   particles.push([clamp(px,.01,boxW-.01),bed+.005+Math.max(0,surface-bed-.005)*fract((i+1)*.754877666),clamp(pz,.01,boxD-.01)]);
  }
  // 5. Expected splat weight for a FULL cell of water. The previous value
  //    assumed the water filled whole cells, so it came out about 16x too high
  //    and the incompressibility term never fired at all.
  const density=count*(dx*dy*dz)/Math.max(.001,current.volume);
  simulator.reset(64,count/64,particles,size,grid,density);
  // simulator.reset writes w=0 for every particle, but w is now the ACTIVITY
  // flag, so every seeded particle must be marked active or the whole frame
  // would be treated as empty slots.
  {const seeded=new Float32Array(count*4);
   for(let i=0;i<count;i++){seeded[i*4]=particles[i][0];seeded[i*4+1]=particles[i][1];seeded[i*4+2]=particles[i][2];seeded[i*4+3]=1;}
   wgl.rebuildTexture(simulator.particlePositionTexture,wgl.RGBA,wgl.FLOAT,64,count/64,seeded,wgl.CLAMP_TO_EDGE,wgl.CLAMP_TO_EDGE,wgl.NEAREST,wgl.NEAREST);
   raw.set(seeded);activeCount=count;}
  radiusM=Math.cbrt(3*current.volume/count/(4*Math.PI));
  Object.assign(stats,{gridResolution:grid,gridCellM:dx,gridCellMetres:[dx,dy,dz],
   solverBoxM:[boxW,boxH,boxD],verticalCellsPerWaterDepth:current.meanDepthM/dy,
   cellAspectRatio:dx/dy,closedTank,
   discretisation:'Divergence, the pressure Poisson stencil and the gradient subtraction all use the real world metres per cell on each axis. Velocity is world metres per second, so on this '+(dx/dy).toFixed(0)+':1 shallow grid a unit-cell operator would be wrong by that factor.',
   meanDepthM:current.meanDepthM,wetAreaM2:current.wetArea,particlesPerCell:density,
   surfaceExcursionM:G.surfaceExcursionM,
   surfaceMeaning:'Free surface is found by the particles between the measured bed and the native water surface plus a declared '+G.surfaceExcursionM+' m illustrative excursion; the native surface remains the risk reference',
   particleVolumeM3:current.volume/count,physicalRadiusM:radiusM,renderRadiusRecommendationM:clamp(radiusM*1.25,.2,1.6)});
  readPositions();return stats;
 }
 // The synchronous particle readback measured 157-458 ms against 0.5-0.7 ms of
 // solve submission, so one readback per solver step throttled the simulation to
 // roughly a twentieth of real time. Several solver steps now share one readback.
 function step(dt=1/60,repeat=SHALLOW_GRID.stepsPerReadback){
  if(disposed)throw abort();if(!count||!Number.isFinite(dt)||dt<=0)return positions;
  const n=clamp(Math.floor(repeat)||1,1,16);
  dt=Math.min(dt,1/30);lastPositions.set(positions);lastGenerations.set(generations);
  const span=dt*n,t=performance.now();
  for(let s=0;s<n;s++)simulator.simulate(dt,[0,0,0],[0,0,0],[0,1,0]);
  solveMs=performance.now()-t;readPositions();elapsed+=span;steps+=n;
  // Two different questions, measured separately. Net drift is a vector mean,
  // so opposing motion inside the junction cancels out — it answers "which way
  // is the water going overall", never "how fast are the blobs moving". Mean
  // speed answers that one. Slots that are not water, and slots a boundary
  // exchange just teleported, are excluded from both: counting a recycle as
  // travel would invent motion, and counting an empty slot as still would hide
  // it.
  let east=0,north=0,speedSum=0,sampled=0,maxDisplacement=0;
  let drivenSum=0,drivenCount=0,drivenTargetSum=0,undrivenSum=0,undrivenCount=0;
  // Does the open lateral edge drain the junction? If it manufactured a head,
  // water would pile against the box edge and the interior would empty. This
  // counts the active water sitting within one horizontal cell of the edge, so
  // the question is answered by measurement rather than by assertion.
  let edgeParticles=0,activeSampled=0;
  const [cellX,,cellZ]=solverBox.cellM;
  for(let i=0;i<count;i++){
   const recycled=generations[i]!==lastGenerations[i],idle=raw[i*4+3]<.5;
   if(!idle){
    activeSampled++;
    const bx=raw[i*4],bz=raw[i*4+2];
    if(bx<cellX||bz<cellZ||bx>solverBox.width-cellX||bz>solverBox.depth-cellZ)edgeParticles++;
   }
   if(recycled||idle){velocities[i*3]=velocities[i*3+1]=velocities[i*3+2]=0;continue;}
   const dx=positions[i*3]-lastPositions[i*3],dy=positions[i*3+1]-lastPositions[i*3+1],
    dz=positions[i*3+2]-lastPositions[i*3+2];
   velocities[i*3]=dx/span;velocities[i*3+1]=dy/span;velocities[i*3+2]=dz/span;
   const flat=Math.hypot(dx,dy);
   east+=dx;north+=dy;speedSum+=flat;sampled++;
   maxDisplacement=Math.max(maxDisplacement,Math.hypot(dx,dy,dz));
   // Split by whether the saved run gives this particle's cell a velocity at
   // all. Water it says nothing about is not driven and must not be counted as
   // evidence that the driving works — or that it does not.
   const cell=drivenCells?nativeCellIndices[i]:-1;
   if(cell>=0&&drivenCells[cell]){drivenSum+=flat;drivenTargetSum+=drivenTargetSpeed[cell];drivenCount++;}
   else if(cell>=0){undrivenSum+=flat;undrivenCount++;}}
  const divisor=Math.max(1,sampled);
  Object.assign(stats,{steps,elapsedSeconds:elapsed,solveSubmissionMs:solveMs,readbackMs,readbackBytes:raw.byteLength,stepsPerReadback:n,simulatedSecondsPerReadback:span,
   meanSimulatedHorizontalVelocityMps:[east/divisor/span,north/divisor/span],
   meanSimulatedSpeedMps:speedSum/divisor/span,
   motionSamples:sampled,motionExcluded:count-sampled,
   openBoundary:{strength:simulator.openBoundaryStrength??0,
    edgeParticles,activeParticles:activeSampled,
    edgeShare:activeSampled?edgeParticles/activeSampled:0,
    meaning:'Share of the live water sitting within one horizontal cell of the box edge. A boundary that manufactured a pressure head would pull the water against the edge and empty the interior, so this is how the open edge is judged.'},
   sourceDrivenMotion:drivenCount?{particles:drivenCount,
    measuredMeanSpeedMps:drivenSum/drivenCount/span,
    sourceMeanSpeedMps:drivenTargetSum/drivenCount,
    undrivenParticles:undrivenCount,
    undrivenMeanSpeedMps:undrivenCount?undrivenSum/undrivenCount/span:null,
    meaning:'Water in cells the saved run gives a velocity for, measured against what it says, and separately the water it says nothing about, which is not driven at all'}:null,
   motionMeaning:'Net drift is a vector mean over the water that stayed in place across the step, so opposing motion cancels; mean speed is how fast those same blobs actually moved. Slots emptied by outflow and slots a boundary exchange teleported are excluded from both.',
   maxStepDisplacementM:maxDisplacement});return positions;
 }
 // Open boundary. Signed native perimeter discharge decides how much water
 // crosses in and out over the simulated step; the ledger turns that into whole
 // particles and keeps the remainder. Water leaves at outflow edges and enters
 // at inflow edges, which is the driver the closed box was missing.
 //
 // No velocity is imposed here. The native package exports none, so the motion
 // still comes from the solver's own pressure response to water arriving on one
 // side and leaving on the other.
 let flowStats=null,velocityInit=null,activeCount=0,momentumUnavailable=0,activeFlags=new Float32Array(0);
 // Per scene cell: whether the saved run supplies a velocity there, and how
 // fast it says the water goes. Only cells it covers are driven.
 let drivenCells=null,drivenTargetSpeed=null,closedTank=null,perimeterFlux=null;
 // Per particle, the saved run's own direction for the cell it is standing in.
 // Kept entirely apart from `velocities`, which is the solver's illustrative
 // motion. east, north, and 1 where the run actually prescribes a direction.
 let sourceDirections=new Float32Array(0),cellDirections=null;
 // Scoped single-texel uploads. Only the injected particle's own texel changes;
 // every other particle keeps its evolved FLIP velocity and position. The
 // vendored editing bind is reused so WrappedGL's state cache stays coherent.
 const texelRGBA16=new Uint16Array(4),texelRGBA32=new Float32Array(4);
 function writeParticleTexel(texture,index,values,type){
  const x=index%64,y=Math.floor(index/64);
  const half=type!==gl.FLOAT;
  const data=half?texelRGBA16:texelRGBA32;
  if(half){const converted=toHalfFloat(Float32Array.from(values));data.set(converted);}
  else data.set(values);
  wgl.bindTextureForEditing(gl.TEXTURE_2D,texture);
  gl.texSubImage2D(gl.TEXTURE_2D,0,x,y,1,1,gl.RGBA,type,data);
  const error=gl.getError();
  if(error!==gl.NO_ERROR)throw Error('Scoped particle texel upload failed: WebGL '+error);
 }
 // Activity lives in the position texture's alpha. The solver's mark, transfer
 // and advect stages all skip alpha<0.5, so an emptied slot contributes no
 // volume, no pressure and no visible water until inflow reactivates it.
 function setParticleActivity(index,active,position){
  raw[index*4+3]=active?1:0;
  if(position){raw[index*4]=position[0];raw[index*4+1]=position[1];raw[index*4+2]=position[2];}
  writeParticleTexel(simulator.particlePositionTexture,index,
   [raw[index*4],raw[index*4+1],raw[index*4+2],active?1:0],gl.FLOAT);
 }
 function setParticleVelocity(index,east,north){
  // Solver axes: x east, y up, z NORTH. See initializeVelocities for why the
  // old negation here drove injected inlet water the wrong way.
  setVelocityTexel(index,[east,0,north,0]);
  velocities[index*3]=east;velocities[index*3+1]=north;velocities[index*3+2]=0;
 }
 function setVelocityTexel(index,values){
  writeParticleTexel(simulator.particleVelocityTexture,index,values,simulator.simulationNumberType??gl.FLOAT);
 }
 // Source-derived directional initialisation. The retained INTERNAL native
 // transport gives each face a reconstructed depth-averaged velocity; writing
 // it into the particle velocity texture starts the visual solver moving the
 // way the saved model's own edge signs say, instead of from rest. The
 // reconstruction is declared by the caller; q is not a native point velocity.
 function initializeVelocities(velocityOf){
  if(disposed)throw abort();
  if(!count||typeof velocityOf!=='function')return null;
  const data=new Float32Array(count*4);let seeded=0,unavailable=0;
  for(let i=0;i<count;i++){
   const cell=nativeCellIndices[i];
   const face=cell>=0?field.scene.cells[cell]?.nativeFaceId:null;
   const v=face===null||face===undefined?null:velocityOf(Number(face));
   if(!v||v.status!=='derived'){unavailable++;continue;}
   // Solver axes: x east, y up, z NORTH.
   //
   // The field projects z from (latitude - centre) * northScale (project(),
   // ~line 88), the rasteriser indexes its rows by that same value (~line 112),
   // seeding derives solver pz from that row index (~line 285), and
   // readPositions turns solver z straight back into north with NO sign change
   // (~line 207). Positions were therefore always right, which is why the water
   // lands on the wash correctly. Negating north here wrote the velocity
   // backwards against positions that were already correct, so the saved run's
   // northward crossing pushed the water south. This was the first stage that
   // reversed it; the force and boundary stages repeated the same mistake.
   data[i*4]=v.east;data[i*4+1]=0;data[i*4+2]=v.north;
   velocities[i*3]=v.east;velocities[i*3+1]=v.north;velocities[i*3+2]=0;
   seeded++;
  }
  // The solver's velocity texture is HALF_FLOAT_OES. Uploading Float32 into it
  // is an invalid operation that poisons the context and breaks the next
  // particle readback, so convert to half precision first.
  const type=simulator.simulationNumberType??gl.FLOAT;
  const payload=type===gl.FLOAT?data:toHalfFloat(data);
  wgl.rebuildTexture(simulator.particleVelocityTexture,wgl.RGBA,type,64,count/64,payload,wgl.CLAMP_TO_EDGE,wgl.CLAMP_TO_EDGE,wgl.NEAREST,wgl.NEAREST);
  const uploadError=gl.getError();
  if(uploadError!==gl.NO_ERROR){
   velocityInit={seeded:0,unavailable:count,particles:count,
    reason:'The solver velocity texture rejected the source-derived field (WebGL '+uploadError+'); particles start from rest'};
   Object.assign(stats,{velocityInitialisation:velocityInit});
   return velocityInit;
  }
  // Seeding alone was washed out by gravity and the pressure solve within a few
  // seconds, leaving the bulk settling rather than travelling. The same
  // reconstruction is therefore also laid out as a grid field the solver holds
  // the horizontal velocity toward every step.
  Object.assign(velocityInit={seeded,unavailable,particles:count,
   meaning:'Initial particle velocities reconstructed from the saved run\'s own internal edge discharges; depth-averaged and derived, never a native point velocity'},
   buildSourceFlowField(velocityOf));
  Object.assign(stats,{velocityInitialisation:velocityInit});
  return velocityInit;
 }
 // The native perimeter as prescribed face velocities. Each inflow/outflow edge
 // carries its OWN signed discharge; q divided by the run's own depth on that
 // face is the declared depth-averaged normal speed, pointed along that edge's
 // signed inward normal. A zero-discharge edge prescribes a still face. Edges
 // whose inner face has no cell in this domain are recorded as unsupported,
 // never redistributed onto a different edge.
 function applyPerimeterFlux({edges,speedOf}={}){
  if(disposed)throw abort();
  if(!solverBox||!Array.isArray(edges)||!edges.length){
   simulator.perimeterFluxStrength=0;
   return perimeterFlux={status:'unavailable',reason:'No native perimeter edges for this frame',prescribedCells:0};
  }
  const R=field.resolution,data=new Float32Array(R*R*4);
  // Which scene cell each perimeter edge drives, and with what normal velocity.
  const byCell=new Map();const unsupported=[];
  let prescribed=0,zeroQ=0,imposedInM3s=0,imposedOutM3s=0,unimposed=0;
  let publishedInM3s=0,publishedOutM3s=0;
  for(const edge of edges){const s=edge.signedInflowM3s??0;
   if(s>0)publishedInM3s+=s;else publishedOutM3s+=-s;}
  for(const edge of edges){
   const cell=field.faceIndexOf(edge.innerFace);
   const signedM3s=edge.signedInflowM3s??0;
   if(cell<0){unsupported.push({edgeId:edge.edgeId,innerFace:edge.innerFace,signedM3s,
    reason:'inner face has no cell in this domain'});
    unimposed+=Math.abs(signedM3s);continue;}
   const speed=speedOf(edge);
   if(!speed||speed.status!=='derived'){
    unsupported.push({edgeId:edge.edgeId,innerFace:edge.innerFace,signedM3s,
     reason:speed?.reason??'no derived speed for this edge'});
    unimposed+=Math.abs(signedM3s);continue;}
   // Signed along this edge's own inward normal. q of zero gives zero: a wet
   // edge with no discharge must not acquire a current.
   const east=edge.inwardNormalEN[0]*speed.speedMps,north=edge.inwardNormalEN[1]*speed.speedMps;
   if(speed.speedMps===0)zeroQ++;
   const signed=edge.signedInflowM3s??0;
   if(signed>0)imposedInM3s+=signed;else imposedOutM3s+=-signed;
   const existing=byCell.get(cell);
   // Two edges on the same cell: sum their signed contributions rather than
   // letting the last one win.
   if(existing){existing.east+=east;existing.north+=north;existing.edges++;}
   else byCell.set(cell,{east,north,edges:1});
  }
  for(let z=0;z<R;z++)for(let x=0;x<R;x++){
   const px=solverBox.x0+(x+.5)/R*solverBox.width,pz=solverBox.z0+(z+.5)/R*solverBox.depth;
   const fx=Math.floor(px/field.width*R),fz=Math.floor(pz/field.depth*R);
   if(fx<0||fz<0||fx>=R||fz>=R)continue;
   const cell=field.faces[fz*R+fx];
   const entry=cell>=0?byCell.get(cell):null;
   if(!entry)continue;
   const d=(z*R+x)*4;
   data[d]=entry.east;data[d+1]=entry.north;data[d+2]=1;
   prescribed++;
  }
  if(!simulator.perimeterFluxTexture)simulator.perimeterFluxTexture=wgl.createTexture();
  wgl.rebuildTexture(simulator.perimeterFluxTexture,wgl.RGBA,wgl.FLOAT,R,R,data,
   wgl.CLAMP_TO_EDGE,wgl.CLAMP_TO_EDGE,wgl.NEAREST,wgl.NEAREST);
  const error=gl.getError();
  if(error!==gl.NO_ERROR){
   simulator.perimeterFluxStrength=0;
   return perimeterFlux={status:'unavailable',reason:'The solver rejected the perimeter flux field (WebGL '+error+')',prescribedCells:0};
  }
  simulator.perimeterFluxStrength=1;
  return perimeterFlux={status:'applied',edges:edges.length,
   prescribedCells:prescribed,drivenCells:byCell.size,
   zeroDischargeEdges:zeroQ,unsupportedEdges:unsupported.length,unsupported,
   imposedInflowM3s:imposedInM3s,imposedOutflowM3s:imposedOutM3s,
   imposedNetM3s:imposedInM3s-imposedOutM3s,
   // The published totals, and the part of them no face could carry. An edge
   // without a supported cell or without a depth to divide by imposes nothing;
   // its discharge is recorded here rather than pushed onto another edge.
   publishedInflowM3s:publishedInM3s,publishedOutflowM3s:publishedOutM3s,
   unimposedM3s:unimposed,
   imposedShare:(publishedInM3s+publishedOutM3s)>0
    ?(imposedInM3s+imposedOutM3s)/(publishedInM3s+publishedOutM3s):0,
   quantity:'depth-averaged normal velocity prescribed on the native perimeter faces',
   assumption:'Each edge\'s own signed unit-width discharge divided by the saved run\'s own water depth on that face, pointed along that edge\'s signed inward normal. A derived depth-averaged speed, never a native point velocity. A zero-discharge edge prescribes a still face. Pressure keeps the same no-flux treatment a wall gets, so the imposed flux is not undone by the projection and nothing is drained toward an invented outside pressure.'};
 }
 // The reconstruction as a solver-box field: R east m/s, G north m/s, B = 1
 // where the saved run actually supports a velocity here. Cells with no
 // reconstruction are left at zero support and are not driven at all.
 function buildSourceFlowField(velocityOf){
  if(!solverBox)return {sourceFlowField:{status:'unavailable',reason:'No solver box'}};
  const R=field.resolution,data=new Float32Array(R*R*4);
  let supported=0,unsupported=0,fastest=0;
  for(let z=0;z<R;z++)for(let x=0;x<R;x++){
   // Field cell under this solver-box texel.
   const east=(x+.5)/R*solverBox.width+solverBox.x0,north=(z+.5)/R*solverBox.depth+solverBox.z0;
   const fx=Math.floor(east/field.width*R),fz=Math.floor(north/field.depth*R);
   const d=(z*R+x)*4;
   if(fx<0||fz<0||fx>=R||fz>=R){unsupported++;continue;}
   const cell=field.faces[fz*R+fx];
   const face=cell>=0?field.scene.cells[cell]?.nativeFaceId:null;
   const v=face===null||face===undefined?null:velocityOf(Number(face));
   if(!v||v.status!=='derived'){unsupported++;continue;}
   data[d]=v.east;data[d+1]=v.north;data[d+2]=1;
   fastest=Math.max(fastest,Math.hypot(v.east,v.north));supported++;
  }
  // Which scene cells the source actually drives, so the measured motion can be
  // split into water the saved run gives a velocity for and water it does not.
  drivenCells=new Uint8Array(field.scene.cells.length);
  drivenTargetSpeed=new Float32Array(field.scene.cells.length);
  // The saved run's own direction per cell, kept for the DISPLAY cues. This is
  // never mixed into `velocities`, which stays the solver's illustrative
  // motion; a cell the run says nothing about gets no direction at all.
  cellDirections=new Float32Array(field.scene.cells.length*3);
  for(let c=0;c<field.scene.cells.length;c++){
   const face=field.scene.cells[c]?.nativeFaceId;
   const v=face===null||face===undefined?null:velocityOf(Number(face));
   if(v&&v.status==='derived'){drivenCells[c]=1;drivenTargetSpeed[c]=Math.hypot(v.east,v.north);
    const speed=Math.hypot(v.east,v.north);
    // Unit direction only. The speed is reported as a number; drawing it would
    // be invisible at these rates and exaggerating it would be a fabrication.
    if(speed>0){cellDirections[c*3]=v.east/speed;cellDirections[c*3+1]=v.north/speed;cellDirections[c*3+2]=1;}
   }
  }
  if(!simulator.sourceFlowTexture)simulator.sourceFlowTexture=wgl.createTexture();
  wgl.rebuildTexture(simulator.sourceFlowTexture,wgl.RGBA,wgl.FLOAT,R,R,data,
   wgl.CLAMP_TO_EDGE,wgl.CLAMP_TO_EDGE,wgl.LINEAR,wgl.LINEAR);
  const error=gl.getError();
  if(error!==gl.NO_ERROR){
   simulator.sourceFlowStrength=0;
   return {sourceFlowField:{status:'unavailable',reason:'The solver rejected the source flow field (WebGL '+error+')'}};
  }
  simulator.sourceFlowStrength=SHALLOW_GRID.sourceFlowStrengthPerSecond;
  return {sourceFlowField:{status:'applied',supportedCells:supported,unsupportedCells:unsupported,
   fastestSupportedSpeedMps:fastest,strengthPerSecond:SHALLOW_GRID.sourceFlowStrengthPerSecond,
   meaning:'Horizontal grid velocity is relaxed toward the saved run\'s own reconstructed depth-averaged cell velocity at '
    +SHALLOW_GRID.sourceFlowStrengthPerSecond+' per second, only where that reconstruction exists. It is a relaxation the pressure solve still works against, not an imposed speed, and it is derived from unit discharge rather than a native point velocity.'}};
 }
 // Per-edge open boundary. Each edge spends only its OWN accrued volume at its
 // OWN place on the perimeter. An edge without wet support records its own
 // discrepancy; its native discharge is never re-drawn onto another edge.
 function applyBoundaryTransport({inflowLedger,outflowLedger,dt,seed=0}={}){
  if(disposed)throw abort();
  if(!count||!inflowLedger||!outflowLedger)return flowStats;
  const cells=field.cellsForFace();
  // Boundary edges carry NATIVE face IDs; the field indexes scene cells. Mixing
  // the two silently rejects every exchange, so resolve once per call.
  const cellOf=new Map();
  const innerCell=edge=>{let c=cellOf.get(edge.innerFace);
   if(c===undefined)cellOf.set(edge.innerFace,c=field.faceIndexOf(edge.innerFace));return c;};
  // Which particles are currently sitting in which scene cell.
  const byFace=new Map();
  for(let i=0;i<count;i++){
   if(raw[i*4+3]<.5)continue; // inactive slots are not water and cannot drain
   const f=nativeCellIndices[i];if(f<0)continue;let list=byFace.get(f);if(!list)byFace.set(f,list=[]);list.push(i);}
  const ox=solverBox.x0,oz=solverBox.z0,base=solverBox.baseM;
  let random=(seed*9301+49297)%233280/233280;
  const next=()=>{random=(random*9301+49297)%1;return random<0?random+1:random;};

  // Cells of an inner face, ordered by distance to THIS edge, so water enters
  // and leaves at the supported part of the real boundary rather than anywhere
  // on the face.
  function edgeCells(edge){
   if(edge.cellsNearEdge)return edge.cellsNearEdge;
   const cell=innerCell(edge);
   const list=cell>=0?(cells.get(cell)||[]):[];
   const mid=edge.localMidpoint;
   const ranked=mid?[...list].sort((a,b)=>{
    const ca=field.cellCentre(a),cb=field.cellCentre(b);
    return Math.hypot(ca[0]-mid[0],ca[1]-mid[1])-Math.hypot(cb[0]-mid[0],cb[1]-mid[1]);
   }):list;
   edge.cellsNearEdge=ranked;edge.innerCellIndex=cell;
   return ranked;
  }

  // OUTFLOW: take particles that are actually on this edge's inner face.
  for(const {book,count:due} of outflowLedger.accrue(dt)){
   const source=book.edgeRef;
   const cell=source?innerCell(source):-1;
   const list=cell>=0?byFace.get(cell):null;
   let moved=0,rejected=0;
   for(let n=0;n<due;n++){
    // No water on the face this edge drains: that is this edge's own
    // discrepancy. It is never charged to a different edge.
    if(!list||!list.length){rejected++;continue;}
    const particle=list.pop();
    // The slot leaves the water: deactivated, so it stops contributing volume
    // and pressure. A free list alone would keep simulating it.
    setParticleActivity(particle,false);
    activeCount--;free.push(particle);generations[particle]++;moved++;
   }
   outflowLedger.settle(book,{moved,rejected});
  }

  // INFLOW: place water only at this edge's own supported cells. A particle
  // comes from the free list that outflow released; if the budget asks for more
  // than the bounded particle set can carry, that is this edge's discrepancy.
  for(const {book,count:due} of inflowLedger.accrue(dt)){
   const target=book.edgeRef;
   let moved=0,rejected=0;
   const ranked=target?edgeCells(target):[];
   for(let n=0;n<due;n++){
    if(!free.length||!ranked.length){rejected++;continue;}
    // Nearest supported cells to the edge, with a little spread.
    const span=Math.min(ranked.length,8);
    let k=-1;
    for(let a=0;a<span;a++){const candidate=ranked[Math.floor(next()*span)%span];
     if(current.data[candidate*4+1]>current.data[candidate*4]){k=candidate;break;}}
    if(k<0){rejected++;continue;}
    const particle=free.pop();
    const bed=current.data[k*4],ceiling=current.data[k*4+1];
    const x=clamp(((k%field.resolution)+.15+.7*next())/field.resolution*field.width-ox,.01,solverBox.width-.01);
    const z=clamp((Math.floor(k/field.resolution)+.15+.7*next())/field.resolution*field.depth-oz,.01,solverBox.depth-.01);
    const y=bed+.005+Math.max(0,ceiling-bed-.005)*next();
    // Reactivate the slot at this edge's own supported cell.
    setParticleActivity(particle,true,[x,y,z]);
    activeCount++;
    // Continuous inlet momentum, from THIS edge's declared reconstruction.
    // Only this particle's velocity texel changes; every other particle keeps
    // its evolved FLIP velocity.
    const inlet=target.inletVelocity;
    if(inlet&&inlet.status==='derived')setParticleVelocity(particle,inlet.east,inlet.north);
    else momentumUnavailable++;
    positions[particle*3]=x+ox+field.originEast;
    positions[particle*3+1]=z+oz+field.originNorth;
    positions[particle*3+2]=y+base;
    nativeCellIndices[particle]=target.innerCellIndex;
    generations[particle]++;moved++;
   }
   inflowLedger.settle(book,{moved,rejected});
  }

  const inStats=inflowLedger.stats,outStats=outflowLedger.stats;
  // Net storage: what the native perimeter says the junction gained or lost,
  // against what the bounded particle set actually carried. Particles released
  // by outflow and not yet taken by inflow are held, counted and reported —
  // they are still simulated, so the difference is never hidden.
  flowStats={inflow:inStats,outflow:outStats,
   // Only ACTIVE particles represent water. An emptied slot contributes no
   // volume, no pressure and no visible blob, so this is the real participating
   // storage rather than a count of allocated slots.
   activeParticles:activeCount,inactiveSlots:count-activeCount,capacity:count,
   activeVolumeM3:activeCount*(current.volume/count),seededVolumeM3:current.volume,
   heldParticles:free.length,momentumUnavailable,
   momentumMeaning:'Injected particles carry their own inflow edge\'s reconstructed depth-averaged velocity, written to that particle\'s texel only; every other particle keeps its evolved solver velocity',
   netTargetM3:inStats.targetM3-outStats.targetM3,
   netMovedM3:inStats.movedM3-outStats.movedM3,
   netStorageResidualM3:(inStats.targetM3-outStats.targetM3)-(inStats.movedM3-outStats.movedM3),
   // The net residual is accounted for, not waved away. Volume only ever moves
   // one whole particle at a time, so it splits exactly into the slots outflow
   // released and inflow has not retaken (held), plus the native net the
   // perimeter has accrued without a whole particle yet having carried it.
   netStorageQuantumM3:inStats.particleVolumeM3,
   netStorageHeldM3:free.length*inStats.particleVolumeM3,
   netStorageUnspentM3:inStats.targetM3-outStats.targetM3,
   netStorageAccounted:Math.abs(((inStats.targetM3-outStats.targetM3)-(inStats.movedM3-outStats.movedM3))
    -((inStats.targetM3-outStats.targetM3)+free.length*inStats.particleVolumeM3))<1e-9,
   netStorageMeaning:'Net storage moves in whole particles: the residual is exactly the held slots (released by outflow, not yet retaken by inflow) plus the sub-particle native net not yet carried. Neither part is topped up with fabricated mass',
   discrepancyM3:inStats.discrepancyM3+outStats.discrepancyM3,
   perEdgeBalanced:inStats.perEdgeBalanced&&outStats.perEdgeBalanced,
   coupling:'Each perimeter edge spends only its own accrued native volume at its own supported cells. Unsupported edges keep their own discrepancy and are never re-drawn onto another edge. Motion between edges is the solver\'s own pressure response.'};
  return flowStats;
 }
 initializeFrame(options.frameIndex??0);
 return {initializeFrame,step,get positions(){return positions;},get velocities(){return velocities;},get nativeCellIndices(){return nativeCellIndices;},get count(){return count;},get radiusM(){return radiusM;},get sourceTime(){return current.frame.validTime;},get frameIndex(){return frameIndex;},get stats(){return {...stats,provenance:field.provenance,flow:flowStats};},field,get solverBox(){return solverBox;},
  applyBoundaryTransport,initializeVelocities,get flowStats(){return flowStats;},get generations(){return generations;},
  // The saved run's own direction under each particle, rebuilt from the cell it
  // is standing in right now. [east, north, available] per particle, a UNIT
  // direction, never a speed. Entirely separate from `velocities`: that is the
  // solver's illustrative drift and stays available for the physics and for
  // honest labelling. A particle over a cell the run says nothing about gets
  // availability 0 and must not be given a direction.
  get sourceDirections(){
   if(sourceDirections.length!==count*3)sourceDirections=new Float32Array(count*3);
   for(let i=0;i<count;i++){
    const cell=nativeCellIndices[i];
    const ok=cellDirections&&cell>=0&&cellDirections[cell*3+2]>.5&&raw[i*4+3]>=.5;
    sourceDirections[i*3]=ok?cellDirections[cell*3]:0;
    sourceDirections[i*3+1]=ok?cellDirections[cell*3+1]:0;
    sourceDirections[i*3+2]=ok?1:0;
   }
   return sourceDirections;},
  applyPerimeterFlux,get perimeterFlux(){return perimeterFlux;},
  // Activity flag per slot, straight from the position texture's alpha. One
  // reused buffer: this is read every drawn frame.
  get active(){if(activeFlags.length!==count)activeFlags=new Float32Array(count);
   for(let i=0;i<count;i++)activeFlags[i]=raw[i*4+3];return activeFlags;},
  get activeCount(){return activeCount;},
  get maskCoverage(){return field.maskCoverage();},get localBounds(){return field.localBounds;},
  dispose(){if(disposed)return;disposed=true;simulator.sourceFlowStrength=0;
   if(simulator.sourceFlowTexture){gl.deleteTexture(simulator.sourceFlowTexture);simulator.sourceFlowTexture=null;}
   gl.getExtension('WEBGL_lose_context')?.loseContext();positions=velocities=lastPositions=raw=new Float32Array();nativeCellIndices=new Int32Array();count=0;}};
}
