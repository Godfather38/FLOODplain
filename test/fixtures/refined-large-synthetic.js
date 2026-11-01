// SYNTHETIC LOAD/SEMANTICS FIXTURE ONLY. No real model, terrain or forecast data.
export function syntheticLargeRefinedPackage({size=320}={}){
  const runId='SYNTHETIC-LARGE-OVERVIEW-NOT-A-FORECAST',sha='c'.repeat(64),west=-111.4,south=32.2,dx=.00106,dy=.0009;
  const cells=[],rings=[],samples={},tags=[];
  for(let row=0;row<size;row++)for(let col=0;col<size;col++){
    if(row>=size/2-8&&row<size/2+8&&col>=size/2-8&&col<size/2+8)continue;
    const sub=(row+col)%50===0?1:2;
    for(let sy=0;sy<sub;sy++)for(let sx=0;sx<sub;sx++){
      const x=west+(col+sx/sub)*dx,y=south+(row+sy/sub)*dy,w=dx/sub,h=dy/sub;
      const nativeFaceId=`SYNTHETIC:${row}:${col}:${sx}:${sy}`,areaM2=10000/(sub*sub);
      const ring=sub===1?[[y,x],[y,x+w/2],[y,x+w],[y+h/2,x+w],[y+h,x+w],[y+h,x+w/2],[y+h,x],[y+h/2,x]]:[[y,x],[y,x+w],[y+h,x+w],[y+h,x]];
      const tag=row>=100&&row<112?'dry':col>=240&&col<252?'missing':'wet';
      const i=cells.length;cells.push({nativeFaceId,areaM2,resolutionM:100/sub,lon:x+w/2,lat:y+h/2});rings.push(ring);tags.push(tag);
      if(!samples[tag]&&((tag==='wet'&&row===50&&col===50)||(tag==='dry'&&row===105&&col===50)||(tag==='missing'&&row===50&&col===245)))samples[tag]={index:i,nativeFaceId,lat:y+h/2,lon:x+w/2};
    }
  }
  samples.hole={lat:south+size/2*dy,lon:west+size/2*dx};
  const times=['2026-11-01T17:00:00Z','2026-11-01T17:15:00Z','2026-11-01T18:00:00Z'];
  const manifest={kind:'quadtree_output_package',status:'complete',runId,geometry:{path:'geometry.json.gz',sha256:sha},frames:times.map((time,i)=>({time,path:`frame-${i}.json.gz`,sha256:String(i+1).repeat(64)})),resolution:{minimumM:50,maximumM:100,cellCount:cells.length},provenance:{verticalDatum:'NAVD88',negativeVolumeDisplayToleranceM3:0},terrainDisplay:{status:'unavailable'},coverage:{status:'native_geometry_only',crossingRegistry:null}};
  const geometry={geometryKind:'native_quadtree_faces',runId,cells,rings};
  function frame(index){const depthM=new Array(cells.length),nativeVolumeM3=new Array(cells.length),waterSurfaceM=new Array(cells.length);for(let i=0;i<cells.length;i++){const tag=tags[i],depth=tag==='missing'?null:tag==='dry'?0:.1+(i%13)/2+index*.25;depthM[i]=depth;nativeVolumeM3[i]=depth===null?null:depth*cells[i].areaM2;waterSurfaceM[i]=depth===null?null:600+depth;}return {runId,geometrySha256:sha,time:times[index],depthM,nativeVolumeM3,waterSurfaceM};}
  return {manifest,geometry,frame,samples,bounds:{xmin:west,ymin:south,xmax:west+size*dx,ymax:south+size*dy},notice:'SYNTHETIC PERFORMANCE/SEMANTICS FIXTURE - NOT A FORECAST'};
}
