import {buildNativeOverview} from './refined-overview-source.js';
// Opt-in adapter only. Never replaces the published frozen run or its manifest.
// readArtifact must be the checksum-verifying quadtree package reader.
export function createRefinedRendererSource({manifest,geometry,readArtifact,maxVisibleFaces=4096}) {
  if(manifest?.kind!=='quadtree_output_package'||!['complete','partial'].includes(manifest.status)||geometry?.geometryKind!=='native_quadtree_faces'||geometry.runId!==manifest.runId)throw Error('Completed matching native package required');
  if(typeof readArtifact!=='function'||!/^[a-f0-9]{64}$/.test(manifest.geometry?.sha256))throw Error('Checksum package reader and geometry hash required');
  if(!Number.isInteger(maxVisibleFaces)||maxVisibleFaces<1)throw Error('Positive visible-face budget required');
  const cells=geometry.cells,rings=geometry.rings,ids=new Set();
  if(!Array.isArray(cells)||!cells.length||rings?.length!==cells.length||manifest.resolution?.cellCount!==cells.length)throw Error('Native geometry shape mismatch');
  const bounds=cells.map((c,i)=>{
    if(typeof c.nativeFaceId!=='string'||ids.has(c.nativeFaceId)||!Number.isFinite(c.areaM2)||c.areaM2<=0||!Number.isFinite(c.resolutionM)||c.resolutionM<=0||!Number.isFinite(c.lon)||!Number.isFinite(c.lat)||Math.abs(c.lat)>90||Math.abs(c.lon)>180)throw Error('Invalid exact native face identity or area');ids.add(c.nativeFaceId);
    const ring=rings[i];if(!Array.isArray(ring)||ring.length<4||ring.some(p=>p.length!==2||!p.every(Number.isFinite)||Math.abs(p[0])>90||Math.abs(p[1])>180))throw Error('Invalid native polygon');
    return [Math.min(...ring.map(p=>p[1])),Math.min(...ring.map(p=>p[0])),Math.max(...ring.map(p=>p[1])),Math.max(...ring.map(p=>p[0]))];
  });
  const descriptors=new Map();for(const f of manifest.frames||[]){if(typeof f.time!=='string'||!f.time.endsWith('Z')||!Number.isFinite(Date.parse(f.time))||descriptors.has(f.time))throw Error('Explicit unique native frame time required');descriptors.set(f.time,f);}
  if(!descriptors.size)throw Error('Native frame descriptors required');
  const cache=new Map();let controller=null,generation=0,disposed=false;
  function validateFrame(frame,time){
    if(frame?.runId!==manifest.runId||frame.geometrySha256!==manifest.geometry.sha256||frame.time!==time||!descriptors.has(time))throw Error('Native frame identity/time/geometry mismatch');
    for(const key of ['depthM','nativeVolumeM3','waterSurfaceM'])if(!Array.isArray(frame[key])||frame[key].length!==cells.length||frame[key].some(v=>v!==null&&!Number.isFinite(v)))throw Error('Native quantity shape/value mismatch');
    const tolerance=manifest.provenance?.negativeVolumeDisplayToleranceM3??0;
    if(!Number.isFinite(tolerance)||tolerance<0)throw Error('Invalid negative-volume tolerance');
    frame.depthM.forEach((d,i)=>{const v=frame.nativeVolumeM3[i];if((d===null)!==(v===null)||v!==null&&v < -tolerance||d!==null&&(d<0||Math.abs(d-Math.max(0,v)/cells[i].areaM2)>1e-8))throw Error('Depth must equal native volume / individual face area');});
    return frame;
  }
  async function loadFrame(value,{signal}={}){
    if(disposed)throw Error('Refined source disposed');const time=typeof value==='string'?value:value?.time;
    if(!descriptors.has(time))throw Error('Native frame time unavailable');
    const token=++generation;controller?.abort();controller=new AbortController();const request=controller;
    const abort=()=>request.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
    try{let frame=Array.isArray(value?.depthM)?validateFrame(value,time):cache.get(time);if(!frame){frame=validateFrame(await readArtifact(descriptors.get(time),{signal:request.signal}),time);}
      if(request.signal.aborted||token!==generation||disposed)throw new DOMException('Superseded native frame','AbortError');
      cache.delete(time);cache.set(time,frame);while(cache.size>2)cache.delete(cache.keys().next().value);return frame;
    }finally{signal?.removeEventListener('abort',abort);}
  }
  function visibleIndices(extent){const out=[];for(let i=0;i<bounds.length;i++){const b=bounds[i];if(b[2]>=extent.xmin&&b[0]<=extent.xmax&&b[3]>=extent.ymin&&b[1]<=extent.ymax)out.push(i);}return out;}
  function flatFeatures(frame,extent){validateFrame(frame,frame?.time);const visible=visibleIndices(extent);
    return visible.filter(i=>frame.depthM[i]===null||frame.depthM[i]>=.01).map(i=>({type:'Feature',properties:{nativeFaceId:cells[i].nativeFaceId,cellIndex:i,depthM:frame.depthM[i],missing:frame.depthM[i]===null,depthClass:Math.max(0,[.01,.1,.3,1,2,4].filter(c=>frame.depthM[i]>=c).length-1)},geometry:{type:'Polygon',coordinates:[rings[i].map(([lat,lon])=>[lon,lat])]}}));
  }
  async function flatDisplay(frame,extent,{width=1024,height=768,signal}={}){validateFrame(frame,frame?.time);const visible=visibleIndices(extent);if(visible.length>maxVisibleFaces)return {kind:'overview',overview:await buildNativeOverview({geometry,frame,visible,extent,width,height,signal})};return {kind:'native',features:flatFeatures(frame,extent)};}
  async function loadTerrain({signal}={}){const display=manifest.terrainDisplay;if(display?.status!=='available'||!display.artifact)throw Error('3D terrain unavailable for this native run. The full-cell mean-depth map remains available.');
    const terrain=await readArtifact(display.artifact,{signal});if(terrain.kind!=='native_face_triangle_terrain'||terrain.runId!==manifest.runId||terrain.geometrySha256!==manifest.geometry.sha256||terrain.verticalDatum!==manifest.provenance?.verticalDatum)throw Error('Terrain does not match native run/geometry/datum');return terrain;}
  return {kind:'refined-native',manifest,geometry,loaded:{manifest,run:{cells,frames:manifest.frames}},footprints:{rings,sourceSha256:manifest.geometry.sha256},loadFrame,validateFrame,visibleIndices,flatFeatures,flatDisplay,loadTerrain,
    cellInfo(i,frame){if(!frame||!cells[i])return null;return {cellIndex:i,nativeFaceId:cells[i].nativeFaceId,areaM2:cells[i].areaM2,resolutionM:cells[i].resolutionM,time:frame.time,depthM:frame.depthM[i],depthFt:frame.depthM[i]===null?null:frame.depthM[i]*3.280839895,nativeVolumeM3:frame.nativeVolumeM3[i],surfaceM:frame.waterSurfaceM[i],datum:manifest.provenance.verticalDatum};},
    cancel(){generation++;controller?.abort();},dispose(){disposed=true;generation++;controller?.abort();cache.clear();},get cachedFrames(){return cache.size;}};
}
