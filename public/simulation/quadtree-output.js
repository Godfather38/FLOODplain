// Opt-in reader only. The existing current/frozen publication is not changed.
export function acceptQuadtreeGeometry(manifest, geometry) {
  if(manifest?.kind!=='quadtree_output_package'||manifest.status!=='complete'||geometry?.runId!==manifest.runId||geometry.geometryKind!=='native_quadtree_faces')throw Error('Completed matching quadtree package required');
  const cells=geometry.cells,rings=geometry.rings;
  if(!Array.isArray(cells)||!cells.length||rings?.length!==cells.length||manifest.resolution?.cellCount!==cells.length)throw Error('Geometry shape mismatch');
  const ids=new Set();
  cells.forEach((c,i)=>{if(typeof c.nativeFaceId!=='string'||ids.has(c.nativeFaceId)||!Number.isFinite(c.areaM2)||c.areaM2<=0||!Number.isFinite(c.lon)||!Number.isFinite(c.lat)||Math.abs(c.lon)>180||Math.abs(c.lat)>90)throw Error('Invalid native face');ids.add(c.nativeFaceId);
    if(!Array.isArray(rings[i])||rings[i].length<4||rings[i].some(p=>p.length!==2||!p.every(Number.isFinite)||Math.abs(p[0])>90||Math.abs(p[1])>180))throw Error('Invalid actual footprint');});
  return geometry;
}
export function acceptQuadtreeFrame(manifest,geometry,frame,expectedTime){
  if(frame?.runId!==manifest.runId||frame.geometrySha256!==manifest.geometry.sha256||frame.time!==expectedTime||!manifest.frames.some(f=>f.time===expectedTime))throw Error('Frame identity/time/geometry mismatch');
  for(const key of ['depthM','nativeVolumeM3','waterSurfaceM'])if(!Array.isArray(frame[key])||frame[key].length!==geometry.cells.length||frame[key].some(v=>v!==null&&!Number.isFinite(v)))throw Error('Native quantity shape/value mismatch');
  frame.depthM.forEach((d,i)=>{const v=frame.nativeVolumeM3[i];if((d===null)!==(v===null)||d!==null&&(d<0||Math.abs(d-Math.max(0,v)/geometry.cells[i].areaM2)>1e-8))throw Error('Depth is not native volume / actual cell area');});
  return frame;
}
export async function readQuadtreeArtifact(base,artifact,{fetchImpl=fetch,signal}={}){
  if(!artifact||!/^[a-zA-Z0-9_-]+\.json\.gz$/.test(artifact.path)||!/^[a-f0-9]{64}$/.test(artifact.sha256))throw Error('Invalid package-relative artifact');
  const r=await fetchImpl(new URL(artifact.path,base),{signal});if(!r.ok)throw Error('Quadtree artifact HTTP '+r.status);
  const bytes=await r.arrayBuffer(),hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');if(hash!==artifact.sha256)throw Error('Quadtree checksum mismatch');
  return JSON.parse(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text());
}
