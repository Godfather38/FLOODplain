// Opt-in reader only. The existing current/frozen publication is not changed.
export function acceptQuadtreeGeometry(manifest, geometry) {
  if(manifest?.kind!=='quadtree_output_package'||!['complete','partial'].includes(manifest.status)||geometry?.runId!==manifest.runId||geometry.geometryKind!=='native_quadtree_faces')throw Error('Completed matching quadtree package required');
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
export function decodeCompactQuadtree(buffer,geometry){
  const view=new DataView(buffer),headerSize=view.getUint32(0,true);
  if(headerSize>buffer.byteLength-4)throw Error('Invalid compact header');
  const h=JSON.parse(new TextDecoder().decode(new Uint8Array(buffer,4,headerSize)));
  if(h.format!=='floodplain-columns-v1')throw Error('Unknown compact format');
  const column=name=>{const c=h.columns[name],width={d:8,f:4,I:4}[c?.type];
    if(!width||!Number.isInteger(c.count)||c.count<0||!Number.isInteger(c.offset)||c.offset<0||4+headerSize+c.offset+c.count*width>buffer.byteLength)throw Error('Invalid compact column');
    const read={d:'getFloat64',f:'getFloat32',I:'getUint32'}[c.type],start=4+headerSize+c.offset;
    return Array.from({length:c.count},(_,i)=>view[read](start+i*width,true));};
  const result=h.metadata;
  if(result.geometryKind==='native_quadtree_faces'){
    const ids=result.nativeFaceIds,lon=column('lon'),lat=column('lat'),area=column('areaM2'),resolution=column('resolutionM'),vertices=column('vertices'),offsets=column('ringOffsets'),indices=column('ringIndices'),eo=column('edgeOffsets'),edges=column('edges');
    if([lon,lat,area,resolution].some(a=>a.length!==ids.length)||offsets.length!==ids.length+1||eo.length!==ids.length+1)throw Error('Compact geometry shape mismatch');
    const points=Array.from({length:vertices.length/2},(_,i)=>[vertices[2*i],vertices[2*i+1]]);
    result.cells=ids.map((nativeFaceId,i)=>({nativeFaceId,lon:lon[i],lat:lat[i],areaM2:area[i],resolutionM:resolution[i],edgeLengthsM:edges.slice(eo[i],eo[i+1])}));
    result.rings=ids.map((_,i)=>indices.slice(offsets[i],offsets[i+1]).map(v=>{if(!points[v])throw Error('Invalid compact vertex');return points[v]}));
    delete result.nativeFaceIds;
  }else{
    if(!geometry)throw Error('Compact frame requires matching geometry');
    for(const key of ['nativeVolumeM3','waterSurfaceM'])result[key]=column(key).map(v=>Number.isNaN(v)?null:v);
    if(result.nativeVolumeM3.length!==geometry.cells.length)throw Error('Compact frame size mismatch');
    result.depthM=result.nativeVolumeM3.map((v,i)=>v===null?null:Math.max(0,v)/geometry.cells[i].areaM2);
  }
  return result;
}
export async function readQuadtreeArtifact(base,artifact,{fetchImpl=fetch,signal,geometry}={}){
  if(!artifact||!/^[a-zA-Z0-9_-]+\.(json|bin)\.gz$/.test(artifact.path)||!/^[a-f0-9]{64}$/.test(artifact.sha256))throw Error('Invalid package-relative artifact');
  const r=await fetchImpl(new URL(artifact.path,base),{signal});if(!r.ok)throw Error('Quadtree artifact HTTP '+r.status);
  const bytes=await r.arrayBuffer(),hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');if(hash!==artifact.sha256)throw Error('Quadtree checksum mismatch');
  const decoded=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  return artifact.path.endsWith('.bin.gz')?decodeCompactQuadtree(decoded,geometry):JSON.parse(new TextDecoder().decode(decoded));
}
