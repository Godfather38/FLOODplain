// SYNTHETIC CONTRACT FIXTURE. Not a forecast, survey, completed run or public asset.
export function syntheticRefinedPackage(){
  const hash='a'.repeat(64),runId='SYNTHETIC-NOT-A-FORECAST';
  const times=['2026-11-01T17:00:00Z','2026-11-01T17:15:00Z','2026-11-01T18:00:00Z'];
  const manifest={kind:'quadtree_output_package',status:'complete',runId,geometry:{path:'geometry.json.gz',sha256:hash},frames:times.map((time,i)=>({time,path:`frame-${i}.json.gz`,sha256:String(i+1).repeat(64)})),resolution:{minimumM:50,maximumM:100,cellCount:2},provenance:{verticalDatum:'NAVD88',negativeVolumeDisplayToleranceM3:0},terrainDisplay:{status:'unavailable'},coverage:{status:'native_geometry_only',crossingRegistry:null}};
  const geometry={geometryKind:'native_quadtree_faces',runId,cells:[{nativeFaceId:'9007199254740997',areaM2:10000,resolutionM:100,lat:32.4205,lon:-111.1605},{nativeFaceId:'small-face',areaM2:2500,resolutionM:50,lat:32.42025,lon:-111.15975}],rings:[[[32.42,-111.161],[32.42,-111.16],[32.4205,-111.16],[32.421,-111.16],[32.421,-111.161]],[[32.42,-111.16],[32.42,-111.1595],[32.4205,-111.1595],[32.4205,-111.16]]]};
  const frames=times.map((time,i)=>({runId,geometrySha256:hash,time,depthM:[i+1,i===1?null:0],nativeVolumeM3:[(i+1)*10000,i===1?null:0],waterSurfaceM:[600+i,i===1?null:599]}));
  return {manifest,geometry,frames};
}
