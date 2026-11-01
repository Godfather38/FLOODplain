import {createTerrainTileLoader} from './refined-terrain-tiles-source.js';
import {buildNativeOverview} from './refined-overview-source.js';
// Opt-in adapter only. Never replaces the published frozen run or its manifest.
// readArtifact must be the checksum-verifying quadtree package reader.
export function createRefinedRendererSource({manifest,geometry,readArtifact,maxVisibleFaces=4096}) {
  if(manifest?.kind!=='quadtree_output_package'||!['complete','partial'].includes(manifest.status)||geometry?.geometryKind!=='native_quadtree_faces'||geometry.runId!==manifest.runId)throw Error('Completed matching native package required');
  if(typeof readArtifact!=='function'||!/^[a-f0-9]{64}$/.test(manifest.geometry?.sha256))throw Error('Checksum package reader and geometry hash required');
  if(!Number.isInteger(maxVisibleFaces)||maxVisibleFaces<1)throw Error('Positive visible-face budget required');
  const cells=geometry.cells,rings=geometry.rings,ids=new Set();
  if(!Array.isArray(cells)||!cells.length||rings?.length!==cells.length||manifest.resolution?.cellCount!==cells.length)throw Error('Native geometry shape mismatch');
  const bounds=new Float64Array(cells.length*4);let west=Infinity,south=Infinity,east=-Infinity,north=-Infinity;
  cells.forEach((c,i)=>{
    if(typeof c.nativeFaceId!=='string'||ids.has(c.nativeFaceId)||!Number.isFinite(c.areaM2)||c.areaM2<=0||!Number.isFinite(c.resolutionM)||c.resolutionM<=0||!Number.isFinite(c.lon)||!Number.isFinite(c.lat)||Math.abs(c.lat)>90||Math.abs(c.lon)>180)throw Error('Invalid exact native face identity or area');ids.add(c.nativeFaceId);
    const ring=rings[i];if(!Array.isArray(ring)||ring.length<4||ring.some(p=>p.length!==2||!p.every(Number.isFinite)||Math.abs(p[0])>90||Math.abs(p[1])>180))throw Error('Invalid native polygon');
    let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
    for(const [lat,lon] of ring){x0=Math.min(x0,lon);y0=Math.min(y0,lat);x1=Math.max(x1,lon);y1=Math.max(y1,lat);}
    bounds.set([x0,y0,x1,y1],i*4);west=Math.min(west,x0);south=Math.min(south,y0);east=Math.max(east,x1);north=Math.max(north,y1);
  });
  ids.clear();
  const side=Math.max(1,Math.min(512,Math.ceil(Math.sqrt(cells.length/16)))),dx=(east-west)/side||1,dy=(north-south)/side||1;
  const bx=x=>Math.max(0,Math.min(side-1,Math.floor((x-west)/dx))),by=y=>Math.max(0,Math.min(side-1,Math.floor((y-south)/dy)));
  const bins=new Map();
  for(let i=0;i<cells.length;i++){const k=i*4;for(let y=by(bounds[k+1]);y<=by(bounds[k+3]);y++)for(let x=bx(bounds[k]);x<=bx(bounds[k+2]);x++){const key=y*side+x;let bin=bins.get(key);if(!bin)bins.set(key,bin=[]);bin.push(i);}}
  for(const [key,bin] of bins)bins.set(key,Uint32Array.from(bin));
  const seen=new Uint32Array(cells.length),validatedLoadedFrames=new WeakSet();let queryId=0,lastExtent=null,lastVisible=null;
  const descriptors=new Map();for(const f of manifest.frames||[]){if(typeof f.time!=='string'||!f.time.endsWith('Z')||!Number.isFinite(Date.parse(f.time))||descriptors.has(f.time))throw Error('Explicit unique native frame time required');descriptors.set(f.time,f);}
  if(!descriptors.size)throw Error('Native frame descriptors required');
  const terrainLoader=createTerrainTileLoader({manifest,geometry,readArtifact});
  const cache=new Map();let controller=null,generation=0,disposed=false;
  function validateFrame(frame,time){
    if(frame?.runId!==manifest.runId||frame.geometrySha256!==manifest.geometry.sha256||frame.time!==time||!descriptors.has(time))throw Error('Native frame identity/time/geometry mismatch');
    if(validatedLoadedFrames.has(frame))return frame;
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
    try{let frame=Array.isArray(value?.depthM)?validateFrame(value,time):cache.get(time);if(!frame){frame=validateFrame(await readArtifact(descriptors.get(time),{signal:request.signal}),time);
      // Only reader-owned frames are made immutable; mutable caller frames stay fully validated.
      for(const key of ['depthM','nativeVolumeM3','waterSurfaceM'])Object.freeze(frame[key]);Object.freeze(frame);validatedLoadedFrames.add(frame);}
      if(request.signal.aborted||token!==generation||disposed)throw new DOMException('Superseded native frame','AbortError');
      cache.delete(time);cache.set(time,frame);while(cache.size>2)cache.delete(cache.keys().next().value);return frame;
    }finally{signal?.removeEventListener('abort',abort);}
  }
  function visibleIndices(extent){
    const {xmin,ymin,xmax,ymax}=extent;
    if(lastExtent&&lastExtent[0]===xmin&&lastExtent[1]===ymin&&lastExtent[2]===xmax&&lastExtent[3]===ymax)return lastVisible.slice();
    const out=[];
    if(xmax>=west&&xmin<=east&&ymax>=south&&ymin<=north){
      queryId=(queryId+1)>>>0;if(!queryId){seen.fill(0);queryId=1;}
      for(let y=by(ymin);y<=by(ymax);y++)for(let x=bx(xmin);x<=bx(xmax);x++){
        const bin=bins.get(y*side+x);if(!bin)continue;
        for(const i of bin){if(seen[i]===queryId)continue;seen[i]=queryId;const k=i*4;if(bounds[k+2]>=xmin&&bounds[k]<=xmax&&bounds[k+3]>=ymin&&bounds[k+1]<=ymax)out.push(i);}
      }out.sort((a,b)=>a-b);
    }
    lastExtent=[xmin,ymin,xmax,ymax];lastVisible=out;return out.slice();
  }
  function findNativeCell(lat,lon){
    if(!Number.isFinite(lat)||!Number.isFinite(lon)||lon<west||lon>east||lat<south||lat>north)return null;
    const bin=bins.get(by(lat)*side+bx(lon));if(!bin)return null;
    for(const i of bin){const k=i*4;if(lon<bounds[k]||lon>bounds[k+2]||lat<bounds[k+1]||lat>bounds[k+3])continue;
      const ring=rings[i];let inside=false;
      for(let j=0,k=ring.length-1;j<ring.length;k=j++){
        const [ay,ax]=ring[k],[by,bx]=ring[j],cross=(lon-ax)*(by-ay)-(lat-ay)*(bx-ax);
        if(Math.abs(cross)<=1e-12&&lon>=Math.min(ax,bx)&&lon<=Math.max(ax,bx)&&lat>=Math.min(ay,by)&&lat<=Math.max(ay,by))return i;
        if((ay>lat)!==(by>lat)&&lon<(bx-ax)*(lat-ay)/(by-ay)+ax)inside=!inside;
      }if(inside)return i;
    }return null;
  }
  function featuresForVisible(frame,visible){
    return visible.filter(i=>frame.depthM[i]===null||frame.depthM[i]>=.01).map(i=>({type:'Feature',properties:{nativeFaceId:cells[i].nativeFaceId,cellIndex:i,depthM:frame.depthM[i],missing:frame.depthM[i]===null,depthClass:Math.max(0,[.01,.1,.3,1,2,4].filter(c=>frame.depthM[i]>=c).length-1)},geometry:{type:'Polygon',coordinates:[rings[i].map(([lat,lon])=>[lon,lat])]}}));
  }
  function flatFeatures(frame,extent){validateFrame(frame,frame?.time);return featuresForVisible(frame,visibleIndices(extent));}
  async function flatDisplay(frame,extent,{width=1024,height=768,signal}={}){validateFrame(frame,frame?.time);const visible=visibleIndices(extent);if(visible.length>maxVisibleFaces)return {kind:'overview',overview:await buildNativeOverview({geometry,frame,visible,extent,width,height,signal})};return {kind:'native',features:featuresForVisible(frame,visible)};}
  async function loadTerrain(options={}){return terrainLoader.load(options);}
  return {kind:'refined-native',manifest,geometry,loaded:{manifest,run:{cells,frames:manifest.frames}},footprints:{rings,sourceSha256:manifest.geometry.sha256},loadFrame,validateFrame,visibleIndices,findNativeCell,flatFeatures,flatDisplay,loadTerrain,cancelTerrain:()=>terrainLoader.cancel(),get terrainStats(){return terrainLoader.stats;},
    cellInfo(i,frame){if(!frame||!cells[i])return null;return {cellIndex:i,nativeFaceId:cells[i].nativeFaceId,areaM2:cells[i].areaM2,resolutionM:cells[i].resolutionM,time:frame.time,depthM:frame.depthM[i],depthFt:frame.depthM[i]===null?null:frame.depthM[i]*3.280839895,nativeVolumeM3:frame.nativeVolumeM3[i],surfaceM:frame.waterSurfaceM[i],datum:manifest.provenance.verticalDatum};},
    cancel(){generation++;controller?.abort();},dispose(){disposed=true;generation++;controller?.abort();terrainLoader.dispose();cache.clear();bins.clear();lastExtent=lastVisible=null;},get cachedFrames(){return cache.size;}};
}
