import * as THREE from 'three';
import {readBakedGlb,describeBakedExtras} from './baked-glb-reader.js';
import {createJunctionPlacement} from './junction-placement.js';
import {createJunctionGeography,createJunctionBlobs,junctionGroundExclusion,JUNCTION_BLOB_DEFAULTS} from './junction-fluid-layer.js';
import {createJunctionSurface,junctionSurfaceSupported} from './junction-fluid-surface.js';
import {DEPTH_COLORS,DEPTH_CUTS} from './voxel-water-source.js';
import {prepareBoundary,createEdgeLedger,maskLocalBounds,reconstructFaceVelocities,
  derivedEdgeSpeed,utmToSceneLocal,gridConvergenceRadians} from './junction-flow-coupling.js';
import {createJunctionLegend} from './junction-fluid-legend.js';

// Drives the one Brawley junction layer inside the existing geographic
// renderer. It owns no camera, canvas, controls, animation loop or page: the
// host renderer decides when this is visible and calls `step` on its own timer.
//
// The prepared scene loader and the PIC/FLIP compute module are imported at
// runtime from their real public paths rather than bundled, because both
// resolve their own assets (package manifest, terrain tiles, GLSL programs)
// relative to their module URL. Bundling them would silently break those paths.
export const JUNCTION_DEFAULTS=Object.freeze({
  minimumZoom:15,                  // below this the junction is a few pixels wide
  viewportPaddingDegrees:0.002,
  particleExtentMetres:[160,160],
  desktopParticles:JUNCTION_BLOB_DEFAULTS.maxParticles,
  mobileParticles:JUNCTION_BLOB_DEFAULTS.mobileMaxParticles,
  substepSeconds:1/30,
  // Playback speed, and nothing else. The native flow is genuinely slow — the
  // saved run's own reconstructed speeds here average 0.17 m/s — so at real
  // time there is nothing to see. Running MORE SIMULATED SECONDS per wall
  // second makes that travel readable without touching the water: every solver
  // step still uses the same dt, and the per-edge ledger still spends the same
  // q x width per SIMULATED second. The achieved ratio is measured and shown.
  playbackScale:2,maxPlaybackScale:4,
  fastStepMs:8,slowStepMs:22,skipStepMs:70,reportEverySteps:12,solverStepsPerReadback:8,
  triangleBudget:14000});

const finite=Number.isFinite;
const hex=bytes=>Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');

export function junctionInView(bounds,extent,{padding=JUNCTION_DEFAULTS.viewportPaddingDegrees}={}){
  if(!Array.isArray(bounds)||bounds.length!==4||!bounds.every(finite))return false;
  if(!extent||![extent.xmin,extent.ymin,extent.xmax,extent.ymax].every(finite))return false;
  return extent.xmax>=bounds[0]-padding&&extent.xmin<=bounds[2]+padding
    &&extent.ymax>=bounds[1]-padding&&extent.ymin<=bounds[3]+padding;
}

// The junction package is only honest about the run it came from. A matching
// cell count or nearby centre is not enough; the run and geometry hash must be
// the ones the live map is displaying.
export function sceneMatchesSource(scene,source){
  if(!scene||!source?.manifest)return {matched:false,reason:'No completed native package is loaded.'};
  if(scene.runId!==source.manifest.runId)return {matched:false,reason:'The prepared junction package belongs to model run '+scene.runId+', not the displayed run.'};
  if(scene.geometrySha256!==source.manifest.geometry?.sha256)return {matched:false,reason:'The prepared junction geometry does not match the displayed run’s geometry.'};
  if(scene.verticalDatum!==source.manifest.provenance?.verticalDatum)return {matched:false,reason:'The junction package and the displayed run use different vertical datums.'};
  return {matched:true,reason:null};
}

export function frameIndexForTime(scene,time){
  if(!scene?.frames?.length||typeof time!=='string')return -1;
  return scene.frames.findIndex(frame=>frame.validTime===time);
}

// Cheap first question: is the camera anywhere near the prepared junction? Only
// the small bake report is fetched, so entering 3D elsewhere in the domain never
// downloads the scene package, terrain tiles, GLB or orthophoto.
export async function loadJunctionPointer({base,signal,fetchImpl=fetch,gateRadiusDegrees=0.004}={}){
  if(!base)throw Error('A junction asset base URL is required');
  if(!finite(gateRadiusDegrees)||gateRadiusDegrees<=0)throw Error('A positive junction gate radius is required');
  const response=await fetchImpl(new URL('data/brawley-baked/bake-report.json',base),{signal});
  if(!response.ok)throw Error('Junction pointer HTTP '+response.status);
  const report=await response.json();
  const center=report?.center;
  if(!Array.isArray(center)||center.length!==2||!center.every(finite))throw Error('The bake report carries no junction centre');
  return {center,sourceRun:report.sourceRun??null,sourceGeometrySha256:report.sourceGeometrySha256??null,
    gateBounds:[center[0]-gateRadiusDegrees,center[1]-gateRadiusDegrees,center[0]+gateRadiusDegrees,center[1]+gateRadiusDegrees]};
}

export async function loadJunctionAssets({base,signal,fetchImpl=fetch,importModule=specifier=>import(specifier),loadScene}={}){
  if(!base)throw Error('A junction asset base URL is required');
  const sceneLoader=loadScene??(await importModule(new URL('brawley-scene-loader.js',base).href)).loadBrawleyScene;
  if(typeof sceneLoader!=='function')throw Error('The prepared Brawley scene loader is unavailable');
  const bakedBase=new URL('data/brawley-baked/',base);
  async function readJson(url){const r=await fetchImpl(url,{signal});if(!r.ok)throw Error('Junction asset HTTP '+r.status+': '+url);return r.json();}
  const [scenePackage,report,provenance]=await Promise.all([
    sceneLoader({signal,fetchImpl}),
    readJson(new URL('bake-report.json',bakedBase)),
    readJson(new URL('imagery-provenance.json',bakedBase))]);
  if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
  if(!/^[a-f0-9]{64}$/.test(report?.sha256||''))throw Error('The bake report carries no baked-asset checksum');
  if(report.sourceRun!==scenePackage.scene.runId||report.sourceGeometrySha256!==scenePackage.scene.geometrySha256)throw Error('The baked junction asset is not bound to this scene’s model run');
  const glbResponse=await fetchImpl(new URL('brawley-ground-road.glb',bakedBase),{signal});
  if(!glbResponse.ok)throw Error('Baked junction GLB HTTP '+glbResponse.status);
  const glbBytes=await glbResponse.arrayBuffer();
  if(glbBytes.byteLength!==report.bytes)throw Error('Baked junction GLB byte length does not match the bake report');
  if(hex(await crypto.subtle.digest('SHA-256',glbBytes))!==report.sha256)throw Error('Baked junction GLB checksum mismatch');
  if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
  const baked=readBakedGlb(glbBytes);
  const bakedMeta=describeBakedExtras(baked.extras);
  if(Math.abs(bakedMeta.center[0]-scenePackage.scene.center[0])>1e-9||Math.abs(bakedMeta.center[1]-scenePackage.scene.center[1])>1e-9)throw Error('Baked junction centre disagrees with the scene centre');
  // The orthophoto is presentation only: if it fails, the layer keeps running
  // with a flat ground colour rather than inventing a surface.
  let imagery=null,imageryError=null;
  try{
    const r=await fetchImpl(new URL('usgs-naip-reference.jpg',bakedBase),{signal});
    if(!r.ok)throw Error('HTTP '+r.status);
    const bitmap=await createImageBitmap(await r.blob());
    if(bitmap.width!==provenance.width||bitmap.height!==provenance.height){bitmap.close?.();throw Error('Orthophoto size does not match its recorded provenance');}
    imagery={bitmap,extent:provenance.extent,attribution:provenance.serviceCopyright??provenance.provider??null};
  }catch(error){if(error.name==='AbortError')throw error;imageryError=error.message;}
  return {...scenePackage,baked,bakedMeta,report,provenance,imagery,imageryError};
}

export function createJunctionFluidController({base,onStatus=()=>{},document:doc=globalThis.document,container=null,
  fetchImpl,importModule,loadScene,reducedMotion=()=>false,mobile=()=>false,defaults={}}={}){
  if(!base)throw Error('A junction asset base URL is required');
  const settings={...JUNCTION_DEFAULTS,...defaults};
  const legend=doc?createJunctionLegend({document:doc,container}):null;
  let assets=null,assetTask=null,assetController=null,assetError=null,pointer=null,pointerTask=null;
  let host=null,placement=null,placementCheck=null,geography=null,blobs=null,fluid=null,fluidModule=null,surface=null,surfaceError=null,composite=null;
  let status='off',reason=null,frameTime=null,frameIndex=-1,clockSeconds=0,generation=0;
  let substeps=1,lastStepMs=0,skippedSteps=0,lastFluidStats=null,source=null,hostTerrainOverview=null;
  let activeMaxParticles=0,metresPerPixel=0,stepsSinceReport=0;
  // Measured playback ratio: how many SIMULATED seconds the viewer sees per
  // second of their own time. Not a physical quantity; a display speed.
  let playbackWallSeconds=0,playbackSimulatedSeconds=0,lastPlaybackSteps=0,playbackLastFrameMs=0;
  // Native transport. Flow snapshots are hourly; water frames are quarter-hour.
  // There is no interpolation and no nearest-time substitution: an unmatched
  // water time reports the boundary as unavailable and the particles keep
  // running closed, which is stated rather than hidden.
  let flowPackage=null,flowTask=null,boundary=null,inflowLedger=null,outflowLedger=null,
      flowTime=null,flowStatus='unloaded',flowReason=null,flowReconstruction=null,flowBindToken=0,
      flowPerimeter=null;

  function report(){
    const stats=lastFluidStats;
    const view={status,reason,
      sourceTime:stats?.sourceTime??null,
      frameIndex:frameIndex>=0?frameIndex:null,
      frameCount:assets?.scene?.frames?.length??null,
      particleCount:blobs?.stats.count??0,
      radiusMetres:blobs?.stats.radiusMetres??0,
      physicalRadiusMetres:blobs?.stats.physicalRadiusMetres??null,
      screenRadiusPx:blobs?.stats.screenRadiusPx??null,
      meanVelocityMps:stats?.meanSimulatedHorizontalVelocityMps??[0,0],
      meanSpeedMps:stats?.meanSimulatedSpeedMps??null,
      // The readout has to say what the saved run is actually supplying right
      // now, including while a snapshot is still loading.
      coupling:flowStatus,flowTime,
      // Display speed, kept apart from the saved source time above. Never a
      // claim about how fast the real water moves.
      playback:playbackWallSeconds>0?{
        simulatedSecondsPerDisplaySecond:playbackSimulatedSeconds/playbackWallSeconds,
        simulatedSeconds:playbackSimulatedSeconds,displaySeconds:playbackWallSeconds,
        solverStepsPerFrame:lastPlaybackSteps,
        requestedScale:settings.playbackScale,
        deviceLimited:playbackSimulatedSeconds/playbackWallSeconds<1,
        deviceNote:'The achieved ratio is what this device manages. Where it is below 1 the device cannot keep up and nothing is claimed about a speed-up.',
        meaning:'Playback speed only. Each solver step uses the same time step and the native per-edge discharge is still spent per SIMULATED second, so the water\'s own speed is unchanged; only how much simulated time passes per second of your time has changed.'}:null,
      maxStepDisplacementM:stats?.maxStepDisplacementM??null,
      wetVolumeM3:stats?.clippedInitialVolumeM3??null,
      reducedMotion:reducedMotion(),
      simulationSteps:stats?.steps??0,
      runId:assets?.scene?.runId??null,
      triangles:geography?.stats.triangles??null,
      imagery:geography?geography.stats.imagery:null,
      placementDeviationM:placementCheck?.maxDeviationM??null,
      hostTerrainOverview:hostTerrainOverview,
      stepMilliseconds:lastStepMs||null,substeps,skippedSteps};
    legend?.update(view);
    // Deliberately not `status:'error'`: the UI maps that to "the geographic map
    // is unavailable", which would be false — the map and its native numbers
    // keep working when only the blob layer cannot run.
    onStatus({kind:'junction-fluid',...view});
    return view;
  }

  // The native water sheet must stop writing depth only while blobs are
  // actually drawn, so the rest of the 3D map keeps its existing behaviour.
  function syncOverlay(){host?.setParticleOverlay?.(!!blobs&&blobs.stats.count>0);}

  function teardownScene(){
    host?.setParticleOverlay?.(false);
    host?.setGroundExclusion?.(null);
    activeMaxParticles=0;
    fluid?.dispose();fluid=null;
    composite?.dispose();composite=null;
    surface?.dispose();surface=null;surfaceError=null;
    blobs?.dispose();blobs=null;
    geography?.dispose();geography=null;
    placement=null;placementCheck=null;host=null;lastFluidStats=null;
    frameIndex=-1;substeps=1;lastStepMs=0;skippedSteps=0;
    playbackWallSeconds=0;playbackSimulatedSeconds=0;lastPlaybackSteps=0;playbackLastFrameMs=0;
    // The binding belonged to the solver that has just been disposed. Leaving
    // the status behind is what let a rebuilt phone layer keep reporting a
    // coupling it no longer had.
    flowBindToken++;
    boundary=null;inflowLedger=null;outflowLedger=null;flowTime=null;flowReconstruction=null;
    if(flowStatus!=='unavailable')flowStatus=flowPackage?'idle':'unloaded';
    if(flowStatus!=='unavailable')flowReason=null;
  }

  function prepare({signal}={}){
    if(pointer)return Promise.resolve(pointer);
    if(!pointerTask)pointerTask=loadJunctionPointer({base,signal,fetchImpl})
      .then(value=>pointer=value)
      .catch(error=>{if(error.name!=='AbortError')assetError=error.message;return null;})
      .finally(()=>{pointerTask=null;});
    return pointerTask;
  }
  const bounds=()=>assets?.scene?.bounds??pointer?.gateBounds??null;

  async function ensureAssets(signal){
    if(assets)return assets;
    if(!assetTask){
      assetController=new AbortController();
      const abort=()=>assetController.abort();
      signal?.addEventListener('abort',abort,{once:true});
      assetTask=loadJunctionAssets({base,signal:assetController.signal,fetchImpl,importModule,loadScene})
        .then(value=>{assets=value;return value;})
        .catch(error=>{if(error.name!=='AbortError')assetError=error.message;throw error;})
        .finally(()=>{signal?.removeEventListener('abort',abort);assetTask=null;});
    }
    return assetTask;
  }

  // Opt-in, lazy, and never fatal: without it the junction simply runs closed
  // and says so.
  async function ensureFlow(scene,signal){
    if(flowPackage||flowStatus==='unavailable')return flowPackage;
    if(!flowTask){
      const specifier=new URL('brawley-flow.js',base).href;
      flowTask=(async()=>{
        const module=await (importModule?importModule(specifier):import(/* @vite-ignore */ specifier));
        if(typeof module?.loadBrawleyFlow!=='function')throw Error('The native flow loader is unavailable');
        flowPackage=await module.loadBrawleyFlow({base,scene,fetchImpl,signal});
        flowStatus='loaded';
        return flowPackage;
      })().catch(error=>{if(error.name!=='AbortError'){flowStatus='unavailable';flowReason=error.message;}return null;})
        .finally(()=>{flowTask=null;});
    }
    return flowTask;
  }

  // The flow package only accepts an exact hourly snapshot. Water frame times
  // that have no snapshot are reported, never approximated.
  function bindBoundary(waterTime){
    // Clearing the binding without clearing the status left the layer reporting
    // "coupled" with no flow time and no ledger — a stale claim that survived a
    // resize rebuild. The status now always describes the binding that exists
    // right now, including while the snapshot is still being read.
    boundary=null;inflowLedger=null;outflowLedger=null;flowTime=null;flowReconstruction=null;flowPerimeter=null;
    const token=++flowBindToken,boundGeneration=generation,boundFluid=fluid;
    // A callback that outlives its own fluid, its own generation or a newer bind
    // must not touch anything: it would seed a different solver from a different
    // time and then call it coupled.
    const stale=()=>token!==flowBindToken||generation!==boundGeneration||fluid!==boundFluid;
    if(!flowPackage||!fluid||!fluid.count){
      flowStatus=flowPackage?'idle':flowStatus==='unavailable'?'unavailable':'unloaded';
      flowReason=flowPackage?'No simulated water to couple at this time.':flowReason;
      return null;}
    let index;
    try{index=flowPackage.exactFrameIndex(waterTime);}
    catch{flowStatus='no-exact-snapshot';
      flowReason='Flow snapshots are hourly and this water frame is not on the hour, so no native transport is applied here. No interpolation or nearest-time substitution is performed.';
      return null;}
    flowStatus='binding';
    flowReason='Reading the exact native flow snapshot for '+waterTime+'.';
    return flowPackage.readFrame(index).then(frame=>{
      if(stale())return null;
      // The snapshot must be the same instant as the water frame. Anything else
      // is a substitution, so it is refused rather than coupled.
      if(frame.time!==waterTime){
        flowStatus='no-exact-snapshot';
        flowReason='The flow snapshot read back as '+frame.time+' for water frame '+waterTime+'; no substitution is made.';
        return null;}
      const geometry=flowPackage.geometry,mask=geometry.masks.junction160;
      const transport=flowPackage.boundaryTransport(frame,'junction160');
      boundary=prepareBoundary(transport,{edges:geometry.edges,inwardSign:mask.inwardSign});
      // Each perimeter edge needs its real place on the ground, so water enters
      // and leaves at the supported part of that edge rather than anywhere on
      // the face. UTM east/north with grid convergence removed.
      const centerUTM=flowPackage.manifest.spatialMasks?.junction160?.centerUTM;
      const convergenceRadians=gridConvergenceRadians(assets.scene.center[0],assets.scene.center[1]);
      for(const edge of [...boundary.inflow,...boundary.outflow]){
        const ends=geometry.edges[edge.edgeIndex].endpointsUTM;
        if(!centerUTM||!ends)continue;
        const a=utmToSceneLocal(ends[0],{centerUTM,convergenceRadians});
        const b=utmToSceneLocal(ends[1],{centerUTM,convergenceRadians});
        edge.localMidpoint=[(a[0]+b[0])/2,(a[1]+b[1])/2];
      }
      // Continuous inlet momentum: each inflow edge carries its OWN declared
      // reconstruction, so an injected particle enters moving the way the saved
      // model's edge signs say rather than at rest.
      const waterNow=assets.scene.frames[frameIndex];
      const cellIndexOf=new Map(assets.scene.cells.map((c,i)=>[Number(c.nativeFaceId),i]));
      for(const edge of boundary.inflow){
        const cell=cellIndexOf.get(edge.innerFace);
        const depth=cell===undefined?null:waterNow?.depthM?.[cell];
        const speed=derivedEdgeSpeed(Math.abs(edge.qM2s),depth);
        edge.inletVelocity=speed.status==='derived'
          ?{status:'derived',east:edge.inwardNormalEN[0]*speed.speedMps,
            north:edge.inwardNormalEN[1]*speed.speedMps,
            effectiveDepthM:speed.effectiveDepthM,assumption:speed.assumption}
          :{status:'unavailable',reason:speed.reason};
      }
      inflowLedger=createEdgeLedger({edges:boundary.inflow,particleVolumeM3:fluid.stats.particleVolumeM3,direction:'in'});
      outflowLedger=createEdgeLedger({edges:boundary.outflow,particleVolumeM3:fluid.stats.particleVolumeM3,direction:'out'});
      // Internal signed transport drives the initial direction field. q is not a
      // native point velocity; the reconstruction and its assumption are carried
      // with the numbers.
      const waterFrame=assets.scene.frames[frameIndex];
      const cellOfFace=new Map(assets.scene.cells.map((c,i)=>[Number(c.nativeFaceId),i]));
      flowReconstruction=reconstructFaceVelocities({edges:geometry.edges,qM2s:frame.qM2s,
        faceIds:mask.nativeFaceIds,
        depthOf:id=>{const i=cellOfFace.get(id);return i===undefined?null:waterFrame?.depthM?.[i];}});
      fluid.initializeVelocities?.(face=>flowReconstruction.velocities.get(face));
      // The native perimeter as a prescribed-flux boundary. Only ever from an
      // exact hourly snapshot: an off-hour frame never reaches this line, so it
      // cannot silently switch a native-flow boundary on.
      const depthForEdge=edge=>{
        const cell=cellIndexOf.get(edge.innerFace);
        return cell===undefined?null:waterNow?.depthM?.[cell];};
      flowPerimeter=fluid.applyPerimeterFlux?.({
        edges:[...boundary.inflow,...boundary.outflow],
        speedOf:edge=>{
          // Signed: the sign lives in the edge's own inward normal, so a zero
          // discharge gives a still face rather than a direction.
          const speed=derivedEdgeSpeed(Math.abs(edge.qM2s),depthForEdge(edge));
          return speed.status==='derived'
            ?{status:'derived',speedMps:edge.signedInflowM3s<0?-speed.speedMps:speed.speedMps,
              effectiveDepthM:speed.effectiveDepthM}
            :speed;}})??null;
      flowTime=frame.time;flowStatus='coupled';flowReason=null;
      report();
      return boundary;
    }).catch(error=>{
      if(stale())return null;
      flowStatus='unavailable';flowReason=error.message;return null;});
  }

  async function ensureFluidModule(){
    if(fluidModule)return fluidModule;
    const specifier=new URL('fluid-prototype/junction-fluid.js',base).href;
    const loaded=await (importModule?importModule(specifier):import(/* @vite-ignore */ specifier));
    if(typeof loaded?.createJunctionFluid!=='function')throw Error('The junction fluid compute module is unavailable');
    return fluidModule=loaded;
  }

  function maxParticles(){
    const value=mobile()?settings.mobileParticles:settings.desktopParticles;
    return Math.max(64,Math.min(4096,Math.floor(value)));
  }

  // Any await can be overtaken by a pan, mode change or teardown. A superseded
  // activation must leave nothing attached to the renderer's scene graph.
  function superseded(token){
    if(token===generation)return false;
    teardownScene();status='off';reason=null;
    return true;
  }

  async function activate(nextHost,{signal}={}){
    if(!nextHost?.group)throw Error('The junction layer needs the existing renderer group');
    if(host&&host.group===nextHost.group&&host.baseM===nextHost.baseM&&status!=='off'&&activeMaxParticles===maxParticles())return report();
    const token=++generation;
    if(host)teardownScene();
    status='loading';reason=null;report();
    try{
      const loaded=await ensureAssets(signal);
      if(superseded(token))return report();
      const binding=sceneMatchesSource(loaded.scene,source);
      if(!binding.matched){status='unavailable';reason=binding.reason;return report();}
      placement=createJunctionPlacement({center:loaded.bakedMeta.center,baseElevationM:loaded.bakedMeta.baseElevationM,
        project:nextHost.project,altitude:nextHost.altitude,origin:nextHost.origin,baseM:nextHost.baseM,
        particleExtentMetres:settings.particleExtentMetres});
      placementCheck=placement.verifyLinearization();
      let imageryTexture=null;
      if(loaded.imagery){
        imageryTexture=new THREE.Texture(loaded.imagery.bitmap);
        imageryTexture.colorSpace=THREE.SRGBColorSpace;
        imageryTexture.anisotropy=2;
        imageryTexture.needsUpdate=true;
      }
      // The host can replace its terrain model while this activation is still
      // awaiting the solver — a window-resize changes the terrain budget and
      // rebuilds it. Attaching to that disposed group is silent: the layer
      // reports "ready" with full stats and draws nothing, which is exactly the
      // phone defect. A disposed model group has been removed from the scene,
      // so refuse to attach to an orphan.
      if(!nextHost.group.parent){status='off';reason=null;teardownScene();return report();}
      geography=createJunctionGeography({baked:loaded.baked,placement,baseElevationM:loaded.bakedMeta.baseElevationM,
        sceneBounds:loaded.scene.bounds,imageryTexture,imageryExtent:loaded.imagery?.extent??null,triangleBudget:settings.triangleBudget});
      activeMaxParticles=maxParticles();
      blobs=createJunctionBlobs({placement,maxParticles:activeMaxParticles});
      blobs.setReducedMotion(reducedMotion());
      // Scoped particle-only screen-space pass. If the device cannot give us a
      // half-float target the spheres simply light themselves, which is the
      // documented fallback rather than a failure.
      const renderer=nextHost.getRenderer?.();
      try{
        if(renderer&&junctionSurfaceSupported(renderer)){
          surface=createJunctionSurface({renderer,captureGeometry:blobs.geometry,captureObject:blobs.blobs});
          surface.setMobile(mobile());
          // The composite is what makes the water one body rather than a tray
          // of beads: its silhouette comes from the smoothed particle depth and
          // it writes fragment depth, so the shared scene occludes it normally.
          // Without WebGL2 there is no fragment depth and the lit spheres stay.
          // Capture now follows the live map world transform on both budgets.
          composite=surface.createComposite({
            depthColors:DEPTH_COLORS.map(c=>new THREE.Color(c)),
            depthCuts:DEPTH_CUTS.slice(),
            missingColor:new THREE.Color(0x9aa0a6)});
          if(composite){blobs.useComposite(composite.mesh);
            composite.setParticleBudget(activeMaxParticles,settings.desktopParticles);}
          else surfaceError='This device cannot write fragment depth; particles are lit individually.';
        }else surfaceError='This device has no half-float render targets; particles are lit individually.';
      }catch(error){surface=null;composite=null;surfaceError=error.message;}
      if(metresPerPixel>0)blobs.setViewScale(metresPerPixel);
      nextHost.group.add(geography.group,blobs.group);
      host=nextHost;
      // Stop the host drawing its own ground under the finer baked patch, so
      // two samplings of the same terrain cannot interpenetrate.
      try{nextHost.setGroundExclusion?.(junctionGroundExclusion({placement,sceneBounds:loaded.scene.bounds,
        baseElevationM:loaded.bakedMeta.baseElevationM}));}catch{/* keep the layer; the ground simply stays whole */}
      try{
        const module=await ensureFluidModule();
        if(superseded(token))return report();
        const index=Math.max(0,frameIndexForTime(loaded.scene,frameTime));
        // Align the particle domain to the exact native-cell union the
        // perimeter budget was summed over, when the flow package is available.
        await ensureFlow(loaded.scene,signal);
        const maskNativeFaceIds=flowPackage?.geometry?.masks?.junction160?.nativeFaceIds??null;
        // The union is 162.5 m across and is not centred on the scene centre, so
        // its own bounds decide the domain. A centred crop would keep only the
        // intersection and quietly drop whole mask faces from the budget.
        let localBounds=null;
        if(maskNativeFaceIds){
          try{localBounds=maskLocalBounds({scene:loaded.scene,maskNativeFaceIds});}
          catch(error){flowStatus='unavailable';flowReason='Mask bounds unavailable: '+error.message;}
        }
        fluid=await module.createJunctionFluid({scene:loaded.scene,terrainTiles:loaded.terrainTiles,
          frameIndex:index,center:loaded.scene.center,extentMeters:settings.particleExtentMetres,
          maxParticles:maxParticles(),maskNativeFaceIds:localBounds?maskNativeFaceIds:null,localBounds});
        if(superseded(token))return report();
        frameIndex=index;
        applyParticles({moving:false});
        bindBoundary(loaded.scene.frames[index]?.validTime);
        status=fluid.count?'ready':'dry';
        reason=fluid.count?null:'The model holds no supported water inside this junction at this time.';
      }catch(error){
        if(error.name==='AbortError')throw error;
        // Never swap in decorative trajectories. Keep the real baked geography
        // and the model's own numbers, and say the simulation cannot run.
        fluid?.dispose();fluid=null;
        status='unavailable';
        reason='The water simulation cannot run on this device: '+error.message;
      }
      return report();
    }catch(error){
      if(error.name==='AbortError'){status='off';reason=null;teardownScene();return report();}
      teardownScene();
      status='unavailable';reason=assetError||error.message;
      return report();
    }
  }

  function applyParticles({moving=true}={}){
    if(!fluid||!blobs||!assets)return;
    const frame=assets.scene.frames[frameIndex];
    lastFluidStats=fluid.stats;
    blobs.update({positions:fluid.positions,velocities:fluid.velocities,cellIndices:fluid.nativeCellIndices,
      depthM:frame?.depthM,count:fluid.count,radiusMetres:fluid.stats.renderRadiusRecommendationM??fluid.radiusM,
      moving:moving&&!reducedMotion(),active:fluid.active,
      // The direction cues are drawn from the SAVED RUN's own edge-flow
      // reconstruction, not from the solver's drift. `velocities` above stays
      // the illustrative solver motion and is still what the speed numbers and
      // the physics use.
      sourceDirections:flowStatus==='coupled'?fluid.sourceDirections:null});
    syncOverlay();
  }

  function setFrame(time){
    frameTime=typeof time==='string'?time:null;
    if(!assets||!fluid)return report();
    const index=frameIndexForTime(assets.scene,frameTime);
    if(index<0){
      // A selected hour outside the prepared junction package is reported, never
      // approximated with the nearest frame.
      blobs?.update({count:0});syncOverlay();
      status='unavailable';
      reason='This time is not in the prepared junction package; the model’s own map still shows it.';
      return report();
    }
    if(index===frameIndex&&status!=='unavailable')return report();
    frameIndex=index;
    fluid.initializeFrame(index);
    clockSeconds=0;
    applyParticles({moving:false});
    bindBoundary(assets.scene.frames[index]?.validTime);
    status=fluid.count?'ready':'dry';
    reason=fluid.count?null:'The model holds no supported water inside this junction at this time.';
    return report();
  }

  function step(seconds){
    if(status!=='ready'||!fluid||!blobs)return null;
    clockSeconds+=finite(seconds)&&seconds>0?seconds:settings.substepSeconds;
    blobs.setClock(clockSeconds);
    if(reducedMotion()){applyParticles({moving:false});return lastFluidStats;}
    if(lastStepMs>settings.skipStepMs){skippedSteps++;lastStepMs*=0.75;substeps=1;return lastFluidStats;}
    // One readback now covers several solver steps, so simulated time advances
    // at a usable rate instead of being throttled by the synchronous transfer.
    const started=performance.now(),batch=Math.max(1,Math.round(settings.solverStepsPerReadback));
    // Playback only: more simulated seconds per wall second. dt per solver step
    // is untouched, and the ledger below still spends the same native q x width
    // per SIMULATED second, so nothing about the water's own speed changes.
    // Bounded by the same step-time budget that protects the phone.
    const playback=Math.max(1,Math.min(settings.maxPlaybackScale,
      lastStepMs>settings.slowStepMs?1:Math.round(settings.playbackScale)));
    const solverSteps=batch*substeps*playback;
    fluid.step(settings.substepSeconds,solverSteps);
    // Cross the native perimeter for the simulated time that just elapsed.
    if(inflowLedger&&outflowLedger){
      try{fluid.applyBoundaryTransport({inflowLedger,outflowLedger,
        dt:settings.substepSeconds*solverSteps,seed:fluid.stats.steps});}
      catch(error){flowStatus='unavailable';flowReason=error.message;boundary=null;inflowLedger=outflowLedger=null;}
    }
    const finished=performance.now();
    lastStepMs=(finished-started)/Math.max(1,solverSteps);
    // The ratio the viewer ACTUALLY sees: simulated seconds against real
    // elapsed time between frames, not against time spent computing. On a
    // software GPU this comes out below 1, and the readout then says nothing
    // about a speed-up, because there is not one.
    if(playbackLastFrameMs>0)playbackWallSeconds+=(finished-playbackLastFrameMs)/1000;
    playbackLastFrameMs=finished;
    playbackSimulatedSeconds+=settings.substepSeconds*solverSteps;
    lastPlaybackSteps=solverSteps;
    if(lastStepMs<settings.fastStepMs&&substeps<2)substeps=2;
    else if(lastStepMs>settings.slowStepMs)substeps=1;
    applyParticles({moving:true});
    // Refresh the readout roughly once a second. Without this the legend keeps
    // showing the zero drift a frame reseed leaves behind, which reads as a
    // broken layer even while the solver is running.
    if(++stepsSinceReport>=settings.reportEverySteps||(lastFluidStats?.steps??0)<=1){stepsSinceReport=0;report();}
    return lastFluidStats;
  }

  return {
    get status(){return status;},
    get active(){return !!host&&status!=='off';},
    setSource(value){source=value;},
    // The host replaced its terrain model. Supersede any in-flight activation
    // and let go of the old group, so nothing is left attached to a disposed
    // parent while still reporting itself as ready.
    invalidateHost(){generation++;if(host||status!=='off'){teardownScene();status='off';reason=null;report();}},
    // Run the particle-only offscreen pass for this frame, then hand the
    // smoothed field to the spheres. Called by the host immediately before it
    // renders the shared scene, so the renderer state is restored in time.
    prepareFrame(camera,drawingBufferSize){
      if(!surface||!blobs||status!=='ready')return false;
      const texture=surface.render(camera,drawingBufferSize);
      const merged=blobs.setSurface(texture,surface.texelSize);
      // The composite reads the same smoothed field and needs this camera's
      // projection to turn eye depth back into a scene depth it can write.
      composite?.sync(camera);
      return merged;},
    get surfaceStats(){return surface?surface.stats:{supported:false,reason:surfaceError};},
    get attached(){return !!host&&!!host.group&&!!host.group.parent;},
    // Camera zoom or window size changed: blobs are sized with a screen floor,
    // so they must be re-scaled even when the solver is not stepping.
    setViewScale(value){if(!finite(value)||value<=0)return;metresPerPixel=value;blobs?.setViewScale(value);},
    // The phone budget must actually take effect on a resize, not only when the
    // host happens to rebuild its terrain model.
    needsRebuild(){return !!host&&activeMaxParticles>0&&activeMaxParticles!==maxParticles();},
    // The surrounding terrain may be the host's coarse whole-domain overview.
    // That does not move the junction, but it is recorded so the backdrop's
    // coarseness is reported rather than passed off as close detail.
    setHostTerrain(info){const next=info?.overviewMode===true;if(next===hostTerrainOverview)return;hostTerrainOverview=next;if(status!=='off')report();},
    prepare,
    get bounds(){return bounds();},
    get center(){return assets?.scene?.center??pointer?.center??null;},
    inView(extent){return junctionInView(bounds(),extent,{padding:settings.viewportPaddingDegrees});},
    setReducedMotion(reduced){blobs?.setReducedMotion(reduced);if(blobs&&fluid)applyParticles({moving:!reduced});report();},
    setVisible(visible){blobs?.setVisible(visible);geography&&(geography.group.visible=!!visible);},
    activate,setFrame,step,
    get frameTime(){return frameTime;},
    // Called when the junction leaves the view or 3D is left: stop all work and
    // release the GPU/compute resources, keeping the fetched assets for re-entry.
    // The selected source time is kept so re-entry seeds the same native frame.
    deactivate(){if(!host&&status==='off')return;generation++;teardownScene();status='off';reason=null;report();},
    // Called on hide/flat/dispose: additionally drop the fetched package so an
    // inactive map holds no junction scene, terrain tiles or orthophoto.
    release(){generation++;teardownScene();boundary=null;inflowLedger=null;outflowLedger=null;flowTime=null;
      assetController?.abort();assetController=null;assetTask=null;
      assets?.imagery?.bitmap?.close?.();assets=null;assetError=null;fluidModule=null;status='off';reason=null;report();},
    dispose(){generation++;teardownScene();assetController?.abort();assets?.imagery?.bitmap?.close?.();assets=null;
      pointer=null;pointerTask=null;fluidModule=null;status='off';legend?.dispose();},
    // Live solver and ledger handles, for diagnostics that have to exercise the
    // real boundary code path rather than a reimplementation of it.
    // `refreshRender` pushes the CURRENT solver state into the renderer without
    // advancing the boundary, so a diagnostic can compare what the device says
    // is water against what is actually drawn, without the 15 Hz loop
    // interleaving its own transport.
    internals(){return {fluid,inflowLedger,outflowLedger,boundary,surface,composite,
      refreshRender:()=>{applyParticles({moving:true});return blobs?.stats??null;}};},
    inspect(){return {status,reason,frameTime,frameIndex,substeps,lastStepMs,skippedSteps,
      maxParticles:activeMaxParticles,budget:maxParticles(),metresPerPixel,hostTerrainOverview,
      generations:fluid?Array.from(fluid.generations):null,
      surface:surface?surface.stats:{supported:false,reason:surfaceError},
      flow:{status:flowStatus,reason:flowReason,flowTime,
        maskFaces:flowPackage?.geometry?.masks?.junction160?.nativeFaceIds?.length??null,
        inflowM3s:boundary?.inflowM3s??null,outflowM3s:boundary?.outflowM3s??null,
        inflowEdges:boundary?.inflow?.length??null,outflowEdges:boundary?.outflow?.length??null,
        ledger:fluid?.flowStats??null,
        maskCoverage:fluid?.maskCoverage??null,localBounds:fluid?.localBounds??null,
        reconstruction:flowReconstruction?{derivedFaces:flowReconstruction.derivedFaces,
          unavailableFaces:flowReconstruction.unavailableFaces,quantity:flowReconstruction.quantity,
          derivedSpeedMps:flowReconstruction.derivedSpeedMps??null,
          assumption:flowReconstruction.assumption}:null,
        velocityInitialisation:fluid?.stats?.velocityInitialisation??null,
        perimeter:flowPerimeter,
        cadence:'native flow snapshots hourly, water frames quarter-hour; exact matches only'},
      placement:placementCheck,geography:geography?.stats??null,blobs:blobs?.stats??null,
      fluid:lastFluidStats,assets:assets?{runId:assets.scene.runId,frames:assets.scene.frames.length,
        cells:assets.scene.cells.length,bakedTriangles:assets.baked.triangles,imagery:!!assets.imagery,imageryError:assets.imageryError}:null};}};
}
