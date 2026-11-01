// Display-only streaming. The injected package reader verifies compressed hashes.
export function createTerrainTileLoader({manifest,geometry,readArtifact,cacheTiles=16,cacheBytes=8*1024*1024,cacheTriangles=320000}){
  let index=null,indexTask=null,generation=0,controller=null,disposed=false,last=null,bytes=0,cachedTriangles=0;
  const cache=new Map();
  function binding(data){if(data?.runId!==manifest.runId||data.geometrySha256!==(manifest.compactSource?.geometry?.sha256??manifest.geometry.sha256)||data.verticalDatum!==manifest.provenance?.verticalDatum)throw Error('Terrain run/geometry/datum mismatch');const mesh=data.meshSha256??data.provenance?.meshSha256;if(mesh!==undefined&&mesh!==manifest.provenance?.meshSha256)throw Error('Terrain native mesh hash mismatch');}
  function artifact(a){if(!a||!/^[a-zA-Z0-9_-]+\.json\.gz$/.test(a.path)||!/^[a-f0-9]{64}$/.test(a.sha256)||!Number.isFinite(a.bytes)||a.bytes<0)throw Error('Invalid terrain artifact descriptor');}
  function validateIndex(data){binding(data);if(data.kind==='native_face_triangle_terrain')return data;if(data.kind!=='native_face_terrain_tiles'||!Array.isArray(data.tiles))throw Error('Invalid native terrain index');
    const ids=new Set();for(const tile of data.tiles){if(typeof tile.id!=='string'||ids.has(tile.id)||tile.bounds?.length!==4||!tile.bounds.every(Number.isFinite)||tile.bounds[0]>=tile.bounds[2]||tile.bounds[1]>=tile.bounds[3]||!Array.isArray(tile.levels)||!tile.levels.length)throw Error('Invalid terrain tile');ids.add(tile.id);const levels=new Set();for(const lod of tile.levels){if(!Number.isInteger(lod.level)||lod.level<0||levels.has(lod.level)||!Number.isInteger(lod.triangles)||lod.triangles<1)throw Error('Invalid terrain LOD');levels.add(lod.level);artifact(lod.artifact);}}
    return data;
  }
  async function getIndex(signal){if(index)return index;if(!indexTask){const descriptor=manifest.terrainDisplay;if(descriptor?.status!=='available'||!descriptor.artifact)throw Error('Source-bound terrain unavailable');indexTask=readArtifact(descriptor.artifact,{signal}).then(validateIndex).then(data=>index=data).finally(()=>{indexTask=null;});}try{return await indexTask;}catch(error){if(error.name==='AbortError'&&!signal.aborted)return getIndex(signal);throw error;}}
  function remember(key,value,size){if(cache.has(key)){bytes-=cache.get(key).size;cachedTriangles-=cache.get(key).value.triangles.length;cache.delete(key);}cache.set(key,{value,size});bytes+=size;cachedTriangles+=value.triangles.length;while(cache.size>cacheTiles||bytes>cacheBytes||cachedTriangles>cacheTriangles){const first=cache.keys().next().value;bytes-=cache.get(first).size;cachedTriangles-=cache.get(first).value.triangles.length;cache.delete(first);}}
  async function load({extent,center,zoom=14,signal,budget=160000,maxTiles=9}={}){
    if(disposed)throw Error('Terrain loader disposed');if(!Number.isInteger(budget)||budget<1||!Number.isInteger(maxTiles)||maxTiles<1)throw Error('Positive terrain budgets required');
    const token=++generation;controller?.abort();const request=controller=new AbortController(),abort=()=>request.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
    const check=()=>{if(disposed||request.signal.aborted||token!==generation)throw new DOMException('Terrain request superseded','AbortError');};
    try{const data=await getIndex(request.signal);check();if(data.kind==='native_face_triangle_terrain')return data;
      if(!extent||![extent.xmin,extent.ymin,extent.xmax,extent.ymax].every(Number.isFinite))throw Error('Visible terrain extent required');
      const cx=Number.isFinite(center?.x)?center.x:(extent.xmin+extent.xmax)/2,cy=Number.isFinite(center?.y)?center.y:(extent.ymin+extent.ymax)/2;
      const visible=data.tiles.filter(t=>t.bounds[2]>=extent.xmin&&t.bounds[0]<=extent.xmax&&t.bounds[3]>=extent.ymin&&t.bounds[1]<=extent.ymax);
      const distance=t=>((t.bounds[0]+t.bounds[2])/2-cx)**2*Math.cos(cy*Math.PI/180)**2+((t.bounds[1]+t.bounds[3])/2-cy)**2;
      visible.sort((a,b)=>distance(a)-distance(b));let triangles=0;const selected=[];
      // Reserve coarse coverage first. Fine detail must not consume the budget
      // needed to show another visible tile with its actual retained terrain.
      for(const tile of visible){if(selected.length>=maxTiles)break;const lod=tile.levels.find(l=>l.level===0);if(!lod||triangles+lod.triangles>budget)continue;selected.push({tile,lod});triangles+=lod.triangles;}
      if(zoom>=16)for(const entry of selected){const finer=[...entry.tile.levels].filter(l=>l.level===1).sort((a,b)=>b.level-a.level)[0];if(finer&&triangles-entry.lod.triangles+finer.triangles<=budget){triangles+=finer.triangles-entry.lod.triangles;entry.lod=finer;}}
      const key=selected.map(({tile,lod})=>tile.id+':'+lod.level+':'+lod.artifact.sha256).join('|');
      if(last?.tileSelectionKey===key){last.stats.visibleTiles=visible.length;last.stats.omittedTiles=visible.length-selected.length;last.stats.downloadedBytes=0;last.stats.cacheHits=selected.length;return last;}
      const parts=[];let downloadedBytes=0,cacheHits=0;
      // Three parallel requests maximum. No eager all-domain terrain download.
      for(let k=0;k<selected.length;k+=3){check();const batch=await Promise.all(selected.slice(k,k+3).map(async({tile,lod})=>{const a=lod.artifact,key=a.sha256;let value;
        if(cache.has(key)){const entry=cache.get(key);cache.delete(key);cache.set(key,entry);value=entry.value;cacheHits++;}else{value=await readArtifact(a,{signal:request.signal});check();binding(value);if(value.kind!=='native_face_triangle_terrain'||value.triangles?.length!==lod.triangles||value.triangleFaceId?.length!==lod.triangles)throw Error('Terrain tile content/count mismatch');if(value.tileId!==undefined&&value.tileId!==tile.id)throw Error('Terrain tile identity mismatch');if(value.level!==undefined&&value.level!==lod.level)throw Error('Terrain tile LOD mismatch');remember(key,value,a.bytes);downloadedBytes+=a.bytes;}return value;}));parts.push(...batch);}
      check();const vertices=[],meshTriangles=[],triangleFaceId=[],faces=new Set();let offset=0;
      for(const part of parts){binding(part);const partFaces=new Set(part.triangleFaceId);for(const id of partFaces){if(faces.has(id))throw Error('Native face duplicated between terrain tiles');faces.add(id);}for(const vertex of part.vertices)vertices.push(vertex);for(const t of part.triangles)meshTriangles.push(t.map(v=>v+offset));for(const id of part.triangleFaceId)triangleFaceId.push(id);offset+=part.vertices.length;}
      const resolutions=parts.map(p=>p.displayResolutionM).filter(Number.isFinite);
      last={kind:'native_face_triangle_terrain',runId:manifest.runId,geometrySha256:(manifest.compactSource?.geometry?.sha256??manifest.geometry.sha256),verticalDatum:manifest.provenance.verticalDatum,vertices,triangles:meshTriangles,triangleFaceId,tileSelectionKey:key,stats:{visibleTiles:visible.length,loadedTiles:selected.length,omittedTiles:visible.length-selected.length,triangles:meshTriangles.length,downloadedBytes,cacheHits,cachedTiles:cache.size,cachedCompressedBytes:bytes,cachedTriangles,levels:selected.map(x=>x.lod.level)}};
      if(resolutions.length===parts.length&&resolutions.length)last.displayResolutionM=Math.max(...resolutions);return last;
    }finally{signal?.removeEventListener('abort',abort);}
  }
  return {load,cancel(){generation++;controller?.abort();},dispose(){disposed=true;generation++;controller?.abort();cache.clear();bytes=0;cachedTriangles=0;last=null;index=null;},get stats(){return {cachedTiles:cache.size,cachedCompressedBytes:bytes,cachedTriangles,indexLoaded:!!index};}};
}
