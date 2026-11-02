import * as THREE from 'three';
import {readBakedGlb,describeBakedExtras} from './baked-glb-reader.js';
import {createJunctionPlacement} from './junction-placement.js';
import {createJunctionGeography,createJunctionBlobs,junctionGroundExclusion,JUNCTION_BLOB_DEFAULTS} from './junction-fluid-layer.js';
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
  fastStepMs:8,slowStepMs:22,skipStepMs:70,reportEverySteps:12,
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
  let host=null,placement=null,placementCheck=null,geography=null,blobs=null,fluid=null,fluidModule=null;
  let status='off',reason=null,frameTime=null,frameIndex=-1,clockSeconds=0,generation=0;
  let substeps=1,lastStepMs=0,skippedSteps=0,lastFluidStats=null,source=null,hostTerrainOverview=null;
  let activeMaxParticles=0,metresPerPixel=0,stepsSinceReport=0;

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
    blobs?.dispose();blobs=null;
    geography?.dispose();geography=null;
    placement=null;placementCheck=null;host=null;lastFluidStats=null;
    frameIndex=-1;substeps=1;lastStepMs=0;skippedSteps=0;
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
      geography=createJunctionGeography({baked:loaded.baked,placement,baseElevationM:loaded.bakedMeta.baseElevationM,
        sceneBounds:loaded.scene.bounds,imageryTexture,imageryExtent:loaded.imagery?.extent??null,triangleBudget:settings.triangleBudget});
      activeMaxParticles=maxParticles();
      blobs=createJunctionBlobs({placement,maxParticles:activeMaxParticles});
      blobs.setReducedMotion(reducedMotion());
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
        fluid=await module.createJunctionFluid({scene:loaded.scene,terrainTiles:loaded.terrainTiles,
          frameIndex:index,center:loaded.scene.center,extentMeters:settings.particleExtentMetres,maxParticles:maxParticles()});
        if(superseded(token))return report();
        frameIndex=index;
        applyParticles({moving:false});
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
      moving:moving&&!reducedMotion()});
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
    const started=performance.now();
    for(let i=0;i<substeps;i++)fluid.step(settings.substepSeconds);
    lastStepMs=(performance.now()-started)/Math.max(1,substeps);
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
    release(){generation++;teardownScene();assetController?.abort();assetController=null;assetTask=null;
      assets?.imagery?.bitmap?.close?.();assets=null;assetError=null;fluidModule=null;status='off';reason=null;report();},
    dispose(){generation++;teardownScene();assetController?.abort();assets?.imagery?.bitmap?.close?.();assets=null;
      pointer=null;pointerTask=null;fluidModule=null;status='off';legend?.dispose();},
    inspect(){return {status,reason,frameTime,frameIndex,substeps,lastStepMs,skippedSteps,
      maxParticles:activeMaxParticles,budget:maxParticles(),metresPerPixel,hostTerrainOverview,
      placement:placementCheck,geography:geography?.stats??null,blobs:blobs?.stats??null,
      fluid:lastFluidStats,assets:assets?{runId:assets.scene.runId,frames:assets.scene.frames.length,
        cells:assets.scene.cells.length,bakedTriangles:assets.baked.triangles,imagery:!!assets.imagery,imageryError:assets.imageryError}:null};}};
}
