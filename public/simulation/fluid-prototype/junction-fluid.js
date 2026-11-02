import WrappedGL from './vendor/js/wrappedgl.js';
import Simulator from './vendor/js/simulator.js';

export const FLUID_UPSTREAM={repository:'https://github.com/jizhouxu/3d-fluid-simulation',commit:'7d6640693745591ff37eadd4276cde3ecba51ac4',license:'MIT'};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const abort=()=>new DOMException('Junction fluid disposed','AbortError');

// Rasterize ONLY the supplied, source-bound terrain triangles. No DEM download,
// native-velocity inference, synthetic tank, inlet jet, or terrain extrapolation.
export function createJunctionField({scene,terrainTiles,center=scene.center,extentMeters=[160,160],fieldResolution=128}){
 if(scene.schema!=='floodplain-scene-v1'||scene.verticalDatum!=='NAVD88'||scene.coordinates?.order!=='longitude,latitude')throw Error('A metric NAVD88 scene contract is required');
 if(!Array.isArray(terrainTiles)||!terrainTiles.length)throw Error('Actual source terrain is required');
 if(!scene.cells?.length||!scene.frames?.length)throw Error('Native source cells and frames are required');
 const [width,depth]=extentMeters;if(!(width>0&&depth>0&&width<=500&&depth<=500))throw Error('One junction extent must be within 500 m');
 const resolution=clamp(Math.floor(fieldResolution),32,256),eastScale=111320*Math.cos(center[1]*Math.PI/180),northScale=111320;
 const project=([lon,lat,z])=>[(lon-center[0])*eastScale+width/2,(lat-center[1])*northScale+depth/2,z];
 const beds=new Float32Array(resolution*resolution).fill(NaN),faces=new Int32Array(beds.length).fill(-1),ids=new Map(scene.cells.map((c,i)=>[String(c.nativeFaceId),i]));
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
  for(let k=0;k<beds.length;k++){
   const i=faces[k],bed=beds[k],zs=i<0?null:frame.waterSurfaceM[i],d=i<0?null:frame.depthM[i],wet=Number.isFinite(bed)&&Number.isFinite(zs)&&Number.isFinite(d)&&d>=.01&&zs-bed>.005;
   data[k*4]=Number.isFinite(bed)?bed-baseM:1e4;data[k*4+1]=wet?zs-baseM:data[k*4];data[k*4+2]=wet?1:0;data[k*4+3]=i;
   if(wet){volume+=(zs-bed)*area;weights.push([k,volume]);maxY=Math.max(maxY,zs-baseM);}
  }
  return {frame,data,weights,volume,maxY};
 }
 return {scene,center,width,depth,resolution,beds,faces,baseM,frameField,acceptedTriangles,
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
 let disposed=false,count=0,positions=new Float32Array(),velocities=new Float32Array(),nativeCellIndices=new Int32Array(),raw=new Float32Array(),lastPositions=new Float32Array(),current,elapsed=0,steps=0,readbackMs=0,solveMs=0,clippedVolumeM3=0,radiusM=0,frameIndex=0;
 const stats={solver:'PIC/FLIP',sourceVelocityAvailable:false,motionMeaning:'Illustrative locally simulated pressure/gravity motion initialized from native terrain and water; not native forecast velocity',boundaryMeaning:'Closed bounded junction; dry/missing/native-water support is impermeable; no inferred inlet or discharge',upstream:FLUID_UPSTREAM,steps:0};
 function readPositions(){
  const t=performance.now();wgl.framebufferTexture2D(simulator.simulationFramebuffer,gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,simulator.particlePositionTexture,0);
  wgl.readPixels(wgl.createReadState().bindFramebuffer(simulator.simulationFramebuffer),0,0,64,count/64,gl.RGBA,gl.FLOAT,raw);
  const error=gl.getError();if(error!==gl.NO_ERROR)throw Error('Particle readback unavailable: WebGL '+error);
  for(let i=0;i<count;i++){positions[i*3]=raw[i*4]-field.width/2;positions[i*3+1]=raw[i*4+2]-field.depth/2;positions[i*3+2]=raw[i*4+1]+field.baseM;const x=clamp(Math.floor(raw[i*4]/field.width*field.resolution),0,field.resolution-1),y=clamp(Math.floor(raw[i*4+2]/field.depth*field.resolution),0,field.resolution-1);nativeCellIndices[i]=field.faces[y*field.resolution+x];}
  readbackMs=performance.now()-t;
 }
 function initializeFrame(index){
  if(disposed)throw abort();current=field.frameField(index);frameIndex=index;elapsed=steps=0;clippedVolumeM3=current.volume;count=current.volume>0?maxParticles:0;
  positions=new Float32Array(count*3);velocities=new Float32Array(count*3);nativeCellIndices=new Int32Array(count);lastPositions=new Float32Array(count*3);raw=new Float32Array(count*4);
  Object.assign(stats,{sourceTime:current.frame.validTime,sourceSha256:current.frame.sourceSha256,sourceFrameIndex:index,particleCount:count,clippedInitialVolumeM3:current.volume,wetFieldSamples:current.weights.length,steps:0,elapsedSeconds:0,solveSubmissionMs:0,readbackMs:0,readbackBytes:raw.byteLength,meanSimulatedHorizontalVelocityMps:[0,0],maxStepDisplacementM:0});
  if(!count){radiusM=0;return stats;}
  const spacing=Math.max(field.width,field.depth)/48,grid=[Math.ceil(field.width/spacing),Math.max(3,Math.ceil((current.maxY+spacing)/spacing)),Math.ceil(field.depth/spacing)],size=[field.width,grid[1]*spacing,field.depth];
  wgl.rebuildTexture(simulator.terrainTexture,wgl.RGBA,wgl.FLOAT,field.resolution,field.resolution,current.data,wgl.CLAMP_TO_EDGE,wgl.CLAMP_TO_EDGE,wgl.NEAREST,wgl.NEAREST);
  const particles=[];let cursor=0;const fract=x=>x-Math.floor(x);
  for(let i=0;i<count;i++){
   const target=(i+.5)/count*current.volume;while(current.weights[cursor][1]<target)cursor++;
   const k=current.weights[cursor][0],x=k%field.resolution,z=Math.floor(k/field.resolution),bed=current.data[k*4],surface=current.data[k*4+1];
   particles.push([(x+.15+.7*fract((i+1)*.61803398875))/field.resolution*field.width,bed+.005+(surface-bed-.005)*fract((i+1)*.754877666),(z+.15+.7*fract((i+1)*.569840291))/field.resolution*field.depth]);
  }
  const density=count/Math.max(.001,current.volume/(spacing**3));simulator.reset(64,count/64,particles,size,grid,density);
  radiusM=Math.cbrt(3*current.volume/count/(4*Math.PI));Object.assign(stats,{gridResolution:grid,gridCellM:spacing,particleVolumeM3:current.volume/count,physicalRadiusM:radiusM,renderRadiusRecommendationM:clamp(radiusM*1.25,.2,1.6)});
  readPositions();return stats;
 }
 function step(dt=1/60){
  if(disposed)throw abort();if(!count||!Number.isFinite(dt)||dt<=0)return positions;
  dt=Math.min(dt,1/30);lastPositions.set(positions);const t=performance.now();simulator.simulate(dt,[0,0,0],[0,0,0],[0,1,0]);solveMs=performance.now()-t;readPositions();elapsed+=dt;steps++;
  let east=0,north=0,maxDisplacement=0;for(let i=0;i<count;i++){const dx=positions[i*3]-lastPositions[i*3],dy=positions[i*3+1]-lastPositions[i*3+1];velocities[i*3]=dx/dt;velocities[i*3+1]=dy/dt;velocities[i*3+2]=(positions[i*3+2]-lastPositions[i*3+2])/dt;east+=dx;north+=dy;maxDisplacement=Math.max(maxDisplacement,Math.hypot(dx,dy,positions[i*3+2]-lastPositions[i*3+2]));}
  Object.assign(stats,{steps,elapsedSeconds:elapsed,solveSubmissionMs:solveMs,readbackMs,readbackBytes:raw.byteLength,meanSimulatedHorizontalVelocityMps:[east/count/dt,north/count/dt],maxStepDisplacementM:maxDisplacement});return positions;
 }
 initializeFrame(options.frameIndex??0);
 return {initializeFrame,step,get positions(){return positions;},get velocities(){return velocities;},get nativeCellIndices(){return nativeCellIndices;},get count(){return count;},get radiusM(){return radiusM;},get sourceTime(){return current.frame.validTime;},get frameIndex(){return frameIndex;},get stats(){return {...stats,provenance:field.provenance};},field,
  dispose(){if(disposed)return;disposed=true;gl.getExtension('WEBGL_lose_context')?.loseContext();positions=velocities=lastPositions=raw=new Float32Array();nativeCellIndices=new Int32Array();count=0;}};
}
