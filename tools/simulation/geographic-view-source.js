import * as maptalks from 'maptalks';
import { createVectorGeography } from './geographic-vector-source.js';
import {createMapClickGuard} from '../../public/simulation/map-click-guard.js';
export {createRefinedRendererSource} from './refined-renderer-source.js';

export async function createGeographicView({leaflet,loaded,get,footprints,source,routeLayer,sharedState,initialView='flat',onError=()=>{},onSelectCell=()=>{},onStatus=()=>{},onPick=()=>{}}){
  if(source){if(source.kind!=='refined-native')throw Error('Unsupported renderer source');loaded=source.loaded;footprints=source.footprints;}
  const flatLabel=source?'Native full-cell mean depth; footprint is not resolved wet extent; gray means missing':'33 ft terrain-intersected display; 328 ft hydraulic grid';
  let restoreSelectedPopup=false,dataGeneration=0,runtime3D,origin3D,altitude3D,terrainSelectionKey,terrainInfo,terrainViewKey='',terrainTask=null,terrainGeneration=0,terrainReadyKey='',terrainModelBudgetKey='',lastDetailIndices=null,detailQueryKey='',detailQueryIndices=null,modelDetailInfo=null;
  async function read(path,gzip=false,signal=assetController.signal){
    if(signal.aborted)throw new DOMException('Cancelled','AbortError');
    let abort;const pending=get(path,{signal});
    try{const r=await Promise.race([pending,new Promise((_,reject)=>{abort=()=>reject(new DOMException('Cancelled','AbortError'));signal.addEventListener('abort',abort,{once:true});})]);
      if(signal.aborted){r.body?.cancel().catch(()=>{});throw new DOMException('Cancelled','AbortError');}if(!r.ok)throw Error(path+' HTTP '+r.status);
      return gzip?new Response(r.body.pipeThrough(new DecompressionStream('gzip'))):r;
    }finally{if(abort)signal.removeEventListener('abort',abort);}
  }
  if(!document.querySelector('[data-voxel-style]')){const link=document.createElement('link');link.rel='stylesheet';
    link.href=new URL('./geographic-view.css',import.meta.url);link.dataset.voxelStyle='';document.head.append(link);}
  const parent=leaflet.getContainer(),surface=document.createElement('div');surface.className='geographic-3d voxel-geographic';
  surface.setAttribute('aria-label','Voxel terrain and model water map');parent.append(surface);
  const stop=e=>e.stopPropagation();for(const type of ['mousedown','pointerdown','touchstart','dblclick','wheel','click'])surface.addEventListener(type,stop);
  const note=document.createElement('div');note.className='voxel-map-note';note.textContent=flatLabel;surface.append(note);
  const popup=document.createElement('div');popup.className='voxel-cell-info';popup.hidden=true;surface.append(popup);
  const mapNode=document.createElement('div');mapNode.className='voxel-map-surface';surface.prepend(mapNode);
  let active=true,dead=false,model=null,frame=null,mode='aggregate',context=null,map,layer,timer,timeout,selected=null,lastDetail='',last3DMode=null,mapTexture,viewMode=initialView==='3d'?'3d':'flat',syncing=false,highDetailTask,THREE,threeTask,modeGeneration=0,assetController=new AbortController();
  let resolveReady,rejectReady,cameraReady=false,geographyReady=false;const ready=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});
  function finishReady(){if(cameraReady&&geographyReady&&!dead){clearTimeout(timeout);resolveReady();}}
  const c=leaflet.getCenter(),motion=matchMedia('(prefers-reduced-motion: reduce)');
  const coverageBins=new Map(),binKey=(lat,lon)=>Math.floor(lat/.01)+','+Math.floor(lon/.01);
  if(!source?.findNativeCell)footprints.rings.forEach((ring,i)=>{const ys=ring.map(p=>p[0]),xs=ring.map(p=>p[1]);for(let y=Math.floor(Math.min(...ys)/.01);y<=Math.floor(Math.max(...ys)/.01);y++)for(let x=Math.floor(Math.min(...xs)/.01);x<=Math.floor(Math.max(...xs)/.01);x++){const key=y+','+x;if(!coverageBins.has(key))coverageBins.set(key,[]);coverageBins.get(key).push(i);}});
  function findNativeCell(lat,lon){if(source?.findNativeCell)return source.findNativeCell(lat,lon);for(const index of coverageBins.get(binKey(lat,lon))||[]){const ring=footprints.rings[index];let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const [yi,xi]=ring[i],[yj,xj]=ring[j];if((yi>lat)!==(yj>lat)&&lon<(xj-xi)*(lat-yi)/(yj-yi)+xi)inside=!inside;}if(inside)return index;}return null;}
  const flatWater=new maptalks.VectorLayer('native-flat-water',[],{zIndex:1,geometryEvents:false});
  const overview={layer:source?new maptalks.CanvasLayer('native-screen-overview',{zIndex:1,animation:false}):null,data:null,canvas:null};
  let overviewKey='',overviewInstalledKey='',overviewTask=null,overviewController=null,overviewPending=null,overviewActiveKey='';
  const counters={overviewStarted:0,overviewInstalled:0,overviewCancelled:0,overviewDeduped:0,overviewMaxActive:0,refreshEvents:0,refreshRuns:0,detailQueries:0,detailInstalls:0,terrainInstalls:0};
  let overviewActive=0,refreshRAF=0,textureFactory=null,textureOrigin=null;
  function count(key){counters[key]=Math.min(Number.MAX_SAFE_INTEGER,counters[key]+1);}
  function cancelOverview(){overviewKey='';overviewInstalledKey='';overviewPending=null;overviewController?.abort();}
  function installOverview(display,key){if(key===overviewInstalledKey){count('overviewDeduped');return;}flatWater.clear();
    if(display.kind==='overview'){const d=display.overview,canvas=overview.canvas||document.createElement('canvas');canvas.width=d.width;canvas.height=d.height;canvas.getContext('2d').putImageData(new ImageData(d.rgba,d.width,d.height),0,0);overview.data=d;overview.canvas=canvas;overview.layer.redraw();note.textContent='Overview: maximum native cell-average depth per screen bin; gray hatch means missing; not hydraulic refinement';onStatus({kind:'native-overview',status:'ready',...d.stats});}
    else{overview.data=null;overview.canvas=null;overview.layer.redraw();flatWater.addGeometry(display.features.map(f=>new maptalks.Polygon(f.geometry.coordinates,{symbol:{polygonFill:f.properties.missing?'#8d969d':colors[f.properties.depthClass],polygonOpacity:f.properties.missing?.25:.78,lineOpacity:0}})));note.textContent=flatLabel;}
    overviewInstalledKey=key;count('overviewInstalled');
  }
  async function drainOverview(){
    while(overviewTask||overviewPending){
      if(!overviewTask)overviewTask=(async()=>{
        while(overviewPending){const job=overviewPending;overviewPending=null;overviewActiveKey=job.key;overviewController=new AbortController();overviewActive=1;counters.overviewMaxActive=Math.max(counters.overviewMaxActive,overviewActive);count('overviewStarted');
          try{const display=await source.flatDisplay(job.frame,job.extent,{width:job.width,height:job.height,signal:overviewController.signal});
            if(!dead&&active&&viewMode==='flat'&&job.key===overviewKey&&frame===job.frame)installOverview(display,job.key);
          }catch(error){if(error.name==='AbortError')count('overviewCancelled');else if(job.key===overviewKey){clearFlat();throw error;}}
          finally{overviewActive=0;overviewActiveKey='';overviewController=null;}
        }
      })().finally(()=>{overviewTask=null;});
      await overviewTask;
    }
  }
  async function requestOverview(){
    while(!dead&&active&&viewMode==='flat'&&frame&&!['off','hand'].includes(mode)){
      const extent=map.getExtent(),size=map.getSize(),key=[frame.time,mode,extent.xmin,extent.ymin,extent.xmax,extent.ymax,size.width,size.height].join(':');
      if(key===overviewInstalledKey){count('overviewDeduped');return;}
      if(key!==overviewKey){overviewKey=key;overviewPending={key,frame,extent,width:size.width,height:size.height};if(overviewActiveKey&&overviewActiveKey!==key)overviewController?.abort();}
      else if(!overviewTask&&!overviewPending)overviewPending={key,frame,extent,width:size.width,height:size.height};
      await drainOverview();
      // Recheck the live viewport before acknowledging, including a camera event
      // whose coalesced refresh has not reached its animation frame yet.
    }
    throw new DOMException('Native display superseded','AbortError');
  }
  function clearFlat(){flatWater.clear();overview.data=null;overview.canvas=null;overview.layer?.redraw();}
  if(overview.layer)overview.layer.draw=function(ctx){if(!overview.canvas||viewMode!=='flat')return;const d=overview.data,e=d.extent,nw=map.coordinateToContainerPoint(new maptalks.Coordinate(e.xmin,e.ymax)),ne=map.coordinateToContainerPoint(new maptalks.Coordinate(e.xmax,e.ymax)),sw=map.coordinateToContainerPoint(new maptalks.Coordinate(e.xmin,e.ymin));ctx.save();ctx.transform((ne.x-nw.x)/d.width,(ne.y-nw.y)/d.width,(sw.x-nw.x)/d.height,(sw.y-nw.y)/d.height,nw.x,nw.y);ctx.drawImage(overview.canvas,0,0);ctx.restore();};
  const routeContext=new maptalks.VectorLayer('original-route-context',[],{zIndex:20,enableAltitude:false});
  const extraContext=new maptalks.VectorLayer('original-model-context',[],{zIndex:21});
  function fail(error){if(dead)return;const message=error instanceof Error?error.message:String(error);hide();rejectReady(Error(message));onError('3D unavailable: '+message+'. The 2D map remains available.');}
  try{
    map=new maptalks.Map(mapNode,{center:[c.lng,c.lat],zoom:leaflet.getZoom(),pitch:0,bearing:0,maxPitch:75,
      devicePixelRatio:Math.min(globalThis.devicePixelRatio||1,innerWidth<600?1:1.5),attribution:{content:'OpenFreeMap © OpenMapTiles · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> · USGS 3DEP'},
      layers:[routeContext,extraContext]});
    flatWater.addTo(map);overview.layer?.addTo(map);
    mapTexture=createVectorGeography({map,project:p=>layer.coordinateToVector3(p),origin:null,onPick,
      onStatus:status=>{onStatus(status);if(status.status==='ready'){geographyReady=true;finishReady();}else if(status.status==='error')fail('Vector geography: '+status.message);},
      onTexture:(texture,bounds)=>{model?.setMapTexture(texture,bounds);layer?.renderScene();}});
    parent.classList.add('map-has-3d');
    requestAnimationFrame(()=>requestAnimationFrame(()=>{if(dead)return;refreshDetail();cameraReady=true;finishReady();}));
  }catch(error){surface.remove();map?.remove();throw error;}
  timeout=setTimeout(()=>{if(!cameraReady||!geographyReady)fail('Geographic renderer initialization timed out');},30000);
  function terrainOptions(){return {extent:map.getExtent(),center:map.getCenter(),zoom:map.getZoom(),budget:innerWidth<600?60000:160000,overviewBudget:260000,maxTiles:12,signal:assetController.signal};}
  function terrainKey(options=terrainOptions()){const e=options.extent;return [e.xmin,e.ymin,e.xmax,e.ymax,options.zoom,options.budget,options.overviewBudget].join(':');}
  function waterBudget(){return innerWidth<600?120000:240000;}
  function reportTerrain(){
    if(!source||!model)return;
    const detail=model.detailStats||modelDetailInfo||{},ground=terrainInfo||{},omitted=detail.omittedWetFaces??detail.omittedFaces??0;
    if(ground.overviewMode){
      note.textContent=`Domain terrain overview; native wet-face water support; ${omitted} wet faces omitted by display budget${detail.budgetLimited?'; zoom in for native detail':''}; cosmetic highlights`;
    }else{
      note.textContent=`Source-bound terrain; ${ground.loadedTiles??'native'} / ${ground.visibleTiles??'native'} visible detail tiles; ${detail.omittedFaces||0} faces outside loaded detail; cosmetic highlights`;
    }
    onStatus({kind:'terrain-tiles',status:detail.budgetLimited||omitted||ground.completeVisibleCoverage===false||(!ground.overviewMode&&ground.omittedTiles)?'partial':'ready',...ground,water:detail});
  }
  function refreshTerrain(){
    if(!source||!model||!active||dead||viewMode!=='3d')return Promise.resolve();
    const options=terrainOptions(),key=terrainKey(options);if(key===terrainViewKey)return terrainTask||Promise.resolve();terrainViewKey=key;const token=++terrainGeneration;
    onStatus({kind:'terrain-tiles',status:'loading'});
    const task=source.loadTerrain(options).then(terrain=>{if(dead||!active||viewMode!=='3d'||token!==terrainGeneration)return;terrainInfo={...terrain.stats,overviewMode:terrain.overviewMode===true||terrain.stats?.overviewMode===true,terrainKind:terrain.kind};const budgetKey=options.budget+':'+waterBudget();
      if(terrain.tileSelectionKey!==terrainSelectionKey||terrainModelBudgetKey!==budgetKey){const next=runtime3D.createRefinedWater({loaded,geometry:source.geometry,terrain,origin:origin3D,project:p=>layer.coordinateToVector3(p),altitude:altitude3D,geometryBudget:options.budget,waterGeometryBudget:waterBudget()});layer.removeMesh(model.group,false);model.dispose();model=next;layer.addMesh(model.group,false);terrainSelectionKey=terrain.tileSelectionKey;terrainModelBudgetKey=budgetKey;
        if(active&&viewMode==='3d')mapTexture.setTextureFactory(textureFactory,textureOrigin);lastDetail='';lastDetailIndices=null;modelDetailInfo=null;count('terrainInstalls');}
      applyDetail();terrainReadyKey=key;if(selected!==null)model.select(selected);layer.renderScene();reportTerrain();
    }).catch(error=>{if(token===terrainGeneration)terrainViewKey='';if(error.name==='AbortError')return;throw error;}).finally(()=>{if(terrainTask===task)terrainTask=null;});terrainTask=task;return task;
  }
  async function awaitCurrentTerrain(){
    if(!source)return;
    while(active&&!dead&&viewMode==='3d'){
      await refreshTerrain();
      if(terrainReadyKey===terrainViewKey&&terrainViewKey===terrainKey())return;
    }
    throw new DOMException('Terrain display superseded','AbortError');
  }
  async function ensure3D(token=modeGeneration){
    if(model)return;
    if(source&&source.manifest.terrainDisplay?.status!=='available')throw Error('3D terrain unavailable for this native run; native mean-depth map remains available.');
    if(threeTask)return threeTask;
    threeTask=(async()=>{
      const [runtime,terrain,detailBuffer,detailMeta]=await (source?Promise.all([import('./geographic-3d-runtime.js'),source.loadTerrain(terrainOptions())]):Promise.all([
        import('./geographic-3d-runtime.js'),
        read('data/frozen-terrain-display.json.gz',true).then(r=>r.json()),
        read('data/frozen-voxel-terrain.f32.gz',true).then(r=>r.arrayBuffer()),
        read('data/frozen-voxel-terrain.json').then(r=>r.json())]));
      if(dead||!active||token!==modeGeneration)return false;
      if(!source&&detailMeta.sourceSha256!==loaded.manifest.artifact.sha256)throw Error('Terrain detail provenance mismatch');
      THREE=runtime.THREE;runtime3D=runtime;terrainSelectionKey=terrain.tileSelectionKey;terrainInfo={...terrain.stats,overviewMode:terrain.overviewMode===true||terrain.stats?.overviewMode===true,terrainKind:terrain.kind};terrainModelBudgetKey=terrainOptions().budget+':'+waterBudget();
      await new Promise((resolve,reject)=>{
        layer=new runtime.ThreeLayer('native-voxel-water',{forceRenderOnMoving:true,forceRenderOnRotating:true,forceRenderOnZooming:true,geometryEvents:false});
        layer.prepareToDraw=function(gl,scene){try{
          if(model)return;
          if(dead||!active||token!==modeGeneration){layer.remove();resolve();return;}
          const anchor=source?[source.geometry.cells[0].lon,source.geometry.cells[0].lat]:[-111.2,32.44];
          const origin=layer.coordinateToVector3(anchor);
          const altitude=m=>map.altitudeToPoint(m,map.getGLRes(),new maptalks.Coordinate(...anchor));origin3D=origin;altitude3D=altitude;
          const args={loaded,terrain,footprints,geometry:source?.geometry,origin,project:p=>layer.coordinateToVector3(p),altitude,geometryBudget:source?(innerWidth<600?60000:160000):(innerWidth<600?30000:80000),waterGeometryBudget:waterBudget()};
          model=source?runtime.createRefinedWater(args):runtime.createVoxelWater({...args,detail:new Float32Array(detailBuffer)});
          scene.add(new THREE.HemisphereLight(0xe9f3ff,0x777267,.75));
          const sun=new THREE.DirectionalLight(0xfff4df,.85);sun.position.set(-1,-2,4);scene.add(sun);
          layer.addMesh(model.group);
          textureFactory=(canvas,bounds)=>{const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=2;return [texture,new THREE.Vector4(...bounds)];};textureOrigin=origin;if(active&&viewMode==='3d')mapTexture.setTextureFactory(textureFactory,textureOrigin);
          (gl.canvas||gl.domElement).addEventListener('webglcontextlost',lost);
          resolve();
        }catch(error){reject(error);}};
        layer.addTo(map);
      });
      return !!model;
    })().catch(error=>{if(error.name==='AbortError')return false;throw error;}).finally(()=>{if(!model)threeTask=null;});
    return threeTask;
  }
  const colors=['#d4eff7','#a8def0','#58b5d6','#2585bc','#2453a5','#40317d'];
  const flatCache=new Map();let flatController=new AbortController(),flatTask=null,flatTime=null,flatGeneration=0;
  async function renderFlat(){
    if(viewMode!=='flat'||!active)return;
    const time=frame?.time;
    if(!frame||['off','hand'].includes(mode)){flatGeneration++;flatController.abort();flatTime=null;flatTask=null;clearFlat();cancelOverview();return;}
    if(flatTime!==time){flatController.abort();flatController=new AbortController();flatTime=time;flatTask=null;flatGeneration++;flatWater.clear();}
    const token=flatGeneration,signal=flatController.signal;
    if(source){await requestOverview();return;}
    if(!flatCache.has(time)&&!flatTask){
      const index=loaded.run.frames.findIndex(f=>f.time===time);
      flatTask=read(`data/water-footprints-${index}.json.gz`,true,signal).then(r=>r.json()).then(data=>{
        if(data.sourceSha256!==loaded.manifest.artifact.sha256||data.time!==time||data.type!=='FeatureCollection')throw Error('Flat water footprint provenance mismatch');
        flatCache.set(time,data);while(flatCache.size>3)flatCache.delete(flatCache.keys().next().value);return data;
      });
    }
    let data;try{data=flatCache.get(time)||await flatTask;}catch(error){if(error.name==='AbortError')return;if(token===flatGeneration){flatTime=null;flatTask=null;flatWater.clear();}throw error;}
    if(dead||!active||viewMode!=='flat'||token!==flatGeneration||frame?.time!==time||['off','hand'].includes(mode))return;
    const extent=map.getExtent(),geometries=[];
    for(const feature of data.features){
      const polygons=feature.geometry.type==='MultiPolygon'?feature.geometry.coordinates:[feature.geometry.coordinates];
      for(const polygon of polygons){const outer=polygon[0];let xmin=Infinity,xmax=-Infinity,ymin=Infinity,ymax=-Infinity;for(const [x,y] of outer){xmin=Math.min(xmin,x);xmax=Math.max(xmax,x);ymin=Math.min(ymin,y);ymax=Math.max(ymax,y);}if(xmax<extent.xmin||xmin>extent.xmax||ymax<extent.ymin||ymin>extent.ymax)continue;
        geometries.push(new maptalks.Polygon(polygon,{symbol:{polygonFill:colors[feature.properties.depthClass]||colors[0],polygonOpacity:.78,lineOpacity:0}}));
      }
    }
    flatWater.clear();flatWater.addGeometry(geometries);
  }
  function lost(event){event.preventDefault();fail('Graphics context was lost');}
  function eachLeaf(group,callback){group?.eachLayer?.(l=>l.eachLayer?eachLeaf(l,callback):callback(l));}
  function syncGroup(group,target,withClicks=false){target.clear();if(!group)return;const occupied=[];
    eachLeaf(group,l=>{const feature=l.toGeoJSON?.();if(!feature?.geometry)return;
      let geometry;
      if(feature.geometry.type==='Point'){
        const icon=l.options?.icon?.options;let label='';if(icon?.html){const el=document.createElement('div');el.innerHTML=icon.html;label=el.textContent.trim();}
        const numeric=/^\d$/.test(label),point=map.coordinateToContainerPoint(new maptalks.Coordinate(feature.geometry.coordinates));
        const width=numeric?26:Math.min(220,label.length*7+12),dy=numeric?0:-19,box={left:point.x-width/2,right:point.x+width/2,top:point.y+dy-10,bottom:point.y+dy+10};
        const showLabel=label&&(numeric||!occupied.some(b=>box.left<b.right+6&&box.right>b.left-6&&box.top<b.bottom+4&&box.bottom>b.top-4));if(showLabel)occupied.push(box);
        geometry=new maptalks.Marker(feature.geometry.coordinates,{symbol:{markerType:'ellipse',markerFill:l.options?.color||'#24444b',markerLineColor:'#ffffff',markerLineWidth:2,markerWidth:numeric?26:12,markerHeight:numeric?26:12,textName:showLabel?label:'',textFill:numeric?'#ffffff':'#263d44',textHaloFill:'#f4f4ed',textHaloRadius:numeric?0:2,textDy:dy,textSize:12}});
      }else{
        geometry=maptalks.GeoJSON.toGeometry(feature);if(Array.isArray(geometry))return;
        geometry?.setSymbol({lineColor:l.options?.color||'#344b51',lineWidth:l.options?.weight||3,lineOpacity:.95,polygonFill:l.options?.fillColor||l.options?.color||'#628593',polygonOpacity:l.options?.fillOpacity??.2});
      }
      if(!geometry)return;
      if(withClicks)geometry.on('click',()=>{l.fire?.('click');const content=l.getPopup?.()?.getContent?.();if(content){popup.replaceChildren();if(content instanceof Node)popup.append(content.cloneNode(true));else popup.innerHTML=String(content);popup.hidden=false;}return false;});
      target.addGeometry(geometry);
    });
  }
  function syncRoutes(){if(dead||!map)return;syncGroup(leaflet.hasLayer(routeLayer)?routeLayer:null,routeContext,true);}
  function refreshDetail(){count('refreshEvents');if(!active||dead||refreshRAF)return;refreshRAF=requestAnimationFrame(()=>{refreshRAF=0;runRefreshDetail();});}
  function runRefreshDetail(){if(!active||dead)return;count('refreshRuns');const zoom=map.getZoom(),extent=map.getExtent();
    mapTexture?.update(extent,zoom).catch(error=>fail('Vector geography: '+error.message));
    syncGroup(context,extraContext);syncRoutes();
    if(viewMode==='flat'){renderFlat().catch(error=>{if(error.name!=='AbortError')onError(error.message);});return;}
    if(!model)return;
    if(source)refreshTerrain().catch(error=>onError('Terrain tiles: '+error.message));
    applyDetail();
  }
  function applyDetail(){if(!model||!active||dead||viewMode!=='3d')return;const zoom=map.getZoom(),extent=map.getExtent();
    const centre=map.getCenter(),queryKey=[extent.xmin,extent.ymin,extent.xmax,extent.ymax,centre.x,centre.y].join(':');
    if(queryKey!==detailQueryKey){
      detailQueryKey=queryKey;detailQueryIndices=source?source.visibleIndices(extent):[];const pad=.002;
      if(!source)loaded.run.cells.forEach((c,i)=>{if(c.lon>=extent.xmin-pad&&c.lon<=extent.xmax+pad&&c.lat>=extent.ymin-pad&&c.lat<=extent.ymax+pad)detailQueryIndices.push(i);});
      const cosine=Math.cos(centre.y*Math.PI/180)**2,distance=i=>{const c=loaded.run.cells[i];return (c.lon-centre.x)**2*cosine+(c.lat-centre.y)**2;};detailQueryIndices.sort((a,b)=>distance(a)-distance(b));count('detailQueries');
    }
    const indices=detailQueryIndices;
    if(!source&&zoom>=18&&!highDetailTask)highDetailTask=Promise.all([read('data/voxel-detail-1m.json').then(r=>r.json()),read('data/voxel-detail-1m.f32.gz',true).then(r=>r.arrayBuffer())]).then(([metadata,buffer])=>{if(dead)return;model.setHighDetail({metadata,values:new Float32Array(buffer)});lastDetail='';refreshDetail();}).catch(error=>onStatus({kind:'terrain-detail',status:'error',message:error.message}));
    const sub=zoom>=18?100:zoom>=14?10:zoom>=12?5:zoom>=10?2:1,key=String(sub);
    const sameIndices=lastDetailIndices===indices||(lastDetailIndices?.length===indices.length&&indices.every((value,i)=>value===lastDetailIndices[i]));
    if(key!==lastDetail||!sameIndices){lastDetail=key;lastDetailIndices=indices;modelDetailInfo=model.setDetail(indices,sub);count('detailInstalls');if(frame){model.update(frame,mode);last3DMode=mode;}
      if(source)reportTerrain();else note.textContent=`${(modelDetailInfo.resolutionM/.3048).toFixed(0)} ft terrain near centre / ${(modelDetailInfo.farResolutionM/.3048).toFixed(0)} ft far; native 328 ft water, terrain intersection; cosmetic animation`;
    }
    if(frame&&(model.frame!==frame||last3DMode!==mode)){model.update(frame,mode);last3DMode=mode;if(source)reportTerrain();}
    layer?.renderScene();
  }
  function showCell(index,notify=true){selected=index;model?.select(index);const cell=loaded.run.cells[index],depth=frame?.depthM[index];const info=(viewMode==='3d'?model?.cellInfo(index):null)||source?.cellInfo(index,frame)|| (frame&&cell?{row:cell.row??'�',column:cell.col??'�',time:frame.time,depthM:depth,depthFt:Number.isFinite(depth)?depth*3.280839895:null,surfaceM:null}:null);if(!info)return;
    const title=document.createElement('strong');title.textContent=source?`Native face ${info.nativeFaceId} · ${(info.areaM2/4046.8564224).toFixed(3)} acres · ${(info.resolutionM/.3048).toFixed(1)} ft equivalent-square resolution`:`SFINCS cell ${index} · row ${info.row}, col ${info.column}`;
    const body=document.createElement('div');body.textContent=`${new Date(info.time).toLocaleString('en-US',{timeZone:'America/Phoenix',month:'short',day:'numeric',hour:'numeric',minute:source?'2-digit':undefined})} MST · ${info.depthM===null?'No model depth result':info.depthFt.toFixed(2)+' ft average water depth'}`;
    const level=document.createElement('div');level.textContent=info.surfaceM===null?'Native water surface unavailable':`Native water surface ${(info.surfaceM/.3048).toFixed(1)} ft ${info.datum||'NAVD88'}`;
    const caveat=document.createElement('small');caveat.textContent=source?'Average depth spreads the modeled water across the whole cell. The shaded area is not a resolved shoreline or a measurement of water on the road.':'Terrain intersection is a downscaled display, not surveyed road depth or a fine-grid hydraulic solution.';
    const close=document.createElement('button');close.type='button';close.textContent='Close';close.onclick=()=>{popup.hidden=true;};
    const details=document.createElement('details'),summary=document.createElement('summary');details.open=popup.querySelector('details')?.open??false;summary.textContent='Cell details';details.append(summary,title,level,caveat);
    body.className='cell-depth-readout';close.className='cell-close';close.setAttribute('aria-label','Close selected cell');
    popup.replaceChildren(body,details,close);popup.hidden=false;if(notify)onSelectCell(index);layer?.renderScene();
  }
  async function update(next,nextMode='aggregate',contextGroup){const request=sharedState?.snapshot().requested;
    if(request&&(!sharedState.isCurrent(request.requestId)||request.time!==next.time||request.model!==nextMode))return Promise.reject(Error('Renderer request no longer matches selected frame'));
    const updateToken=++dataGeneration;
    if(source){restoreSelectedPopup=restoreSelectedPopup||!popup.hidden;const token=updateToken;frame=null;clearFlat();cancelOverview();model?.clearFrame?.();popup.hidden=true;layer?.renderScene();next=await source.loadFrame(next);if(dead||!active||token!==dataGeneration||(request&&!sharedState.isCurrent(request.requestId)))throw new DOMException('Superseded native frame','AbortError');}
    if(!loaded.run.frames.some(f=>f.time===next?.time)||!Array.isArray(next?.depthM)||next.depthM.length!==loaded.run.cells.length){flatGeneration++;flatController.abort();flatTime=null;flatTask=null;flatWater.clear();frame=null;popup.hidden=true;if(model){try{model.update(next,nextMode);}catch{}}layer?.renderScene();throw Error('Native depth unavailable for selected hour');}
    frame=next;mode=nextMode;context=contextGroup??context;
    try{if(viewMode==='3d'){if(!model)await ensure3D();if(!model||!active||dead)throw new DOMException('3D request cancelled','AbortError');await awaitCurrentTerrain();if(updateToken!==dataGeneration||frame!==next||mode!==nextMode)throw new DOMException('Frame superseded during terrain load','AbortError');if(model.frame!==next||last3DMode!==nextMode){model.update(next,nextMode);last3DMode=nextMode;}if(source)reportTerrain();}else await renderFlat();}catch(error){if(error.name!=='AbortError'&&updateToken===dataGeneration&&frame===next){frame=null;popup.hidden=true;layer?.renderScene();}throw error;}
    syncGroup(context,extraContext);syncRoutes();if(selected!==null){model?.select(selected);if(!popup.hidden||restoreSelectedPopup){showCell(selected,false);restoreSelectedPopup=false;}}layer?.renderScene();
    if(!active||dead||updateToken!==dataGeneration||frame?.time!==next.time||mode!==nextMode||(request&&!sharedState.isCurrent(request.requestId)))throw Error('Renderer frame request superseded');
    return {time:next.time,model:nextMode,view:viewMode};
  }
  // Use the browser click emitted by the geographic host before its time-threshold
  // filter. A slow GPU/vector hit-test must not turn an ordinary completed tap into
  // a missing selection. Browser click still excludes a drag gesture.
  const clickGuard=createMapClickGuard(),guardNode=map.getContainer();
  const guardDown=e=>clickGuard.down(e),guardMove=e=>clickGuard.move(e),guardCancel=()=>clickGuard.cancel();
  guardNode.addEventListener('pointerdown',guardDown,true);guardNode.addEventListener('pointermove',guardMove,true);guardNode.addEventListener('pointerup',guardMove,true);guardNode.addEventListener('pointercancel',guardCancel,true);map.on('dragstart',guardCancel);
  map.on('dom:click',event=>{if(!clickGuard.allow(event.domEvent)||!frame||mode==='off'||mode==='hand'||map.isInteracting())return;const p=event.containerPoint,size=map.getSize();
    let picked=null;if(viewMode==='3d'&&model){const ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2(p.x/size.width*2-1,1-p.y/size.height*2),layer.getCamera());picked=model.pick(ray);}
    const index=picked??findNativeCell(event.coordinate.y,event.coordinate.x);if(index!==null)showCell(index);else{popup.textContent='No native model coverage at this location. This is not a dry or safe-road result.';popup.hidden=false;sharedState?.select({kind:'location',lat:event.coordinate.y,lon:event.coordinate.x});}});
  map.on('moveend zoomend pitchend rotateend',refreshDetail);
  const syncFromLeaflet=()=>{if(active&&!dead&&!syncing){const c=leaflet.getCenter();map.setCenterAndZoom([c.lng,c.lat],leaflet.getZoom());syncRoutes();}};
  map.on('moveend zoomend',()=>{if(!active||dead||syncing)return;const c=map.getCenter(),e=map.getExtent();syncing=true;
    try{leaflet.setView([c.y,c.x],map.getZoom(),{animate:false});sharedState?.setViewport({center:[c.x,c.y],zoom:map.getZoom(),bounds:[e.xmin,e.ymin,e.xmax,e.ymax]});}finally{syncing=false;}});
  const routesChanged=()=>{if(active)syncRoutes();};leaflet.on('moveend',syncFromLeaflet);leaflet.on('layeradd layerremove',routesChanged);routeLayer.on?.('layeradd layerremove',routesChanged);
  function startAnimation(){clearInterval(timer);timer=null;if(!active||dead||viewMode!=='3d'||motion.matches||document.hidden)return;
    timer=setInterval(()=>{if(!active||dead||viewMode!=='3d'||motion.matches||document.hidden){clearInterval(timer);timer=null;return;}if(model){model.animate(performance.now()/1000);layer?.renderScene();}},1000/15);}
  function visibility(){startAnimation();}document.addEventListener('visibilitychange',visibility);motion.addEventListener('change',visibility);
  function hide(){if(!active||dead)return;active=false;cancelAnimationFrame(refreshRAF);refreshRAF=0;mapTexture?.setTextureFactory(null);restoreSelectedPopup=false;modeGeneration++;dataGeneration++;source?.cancel();source?.cancelTerrain?.();terrainGeneration++;terrainViewKey='';terrainReadyKey='';cancelOverview();flatGeneration++;flatController.abort();flatTime=null;flatTask=null;if(!model){assetController.abort();assetController=new AbortController();}mapTexture?.suspend();clearInterval(timer);const c=map.getCenter(),z=map.getZoom();surface.hidden=true;parent.classList.remove('map-has-3d');leaflet.invalidateSize();leaflet.setView([c.y,c.x],z,{animate:false});popup.hidden=true;}
  function show(){if(dead)throw Error('3D map disposed');active=true;surface.hidden=false;parent.classList.add('map-has-3d');map.checkSize();if(viewMode==='3d'&&textureFactory)mapTexture?.setTextureFactory(textureFactory,textureOrigin);syncFromLeaflet();refreshDetail();if(selected!==null)model?.select(selected);startAnimation();}
  const resize=new ResizeObserver(()=>{if(active&&!dead){map.setDevicePixelRatio(Math.min(globalThis.devicePixelRatio||1,innerWidth<600?1:1.5));map.checkSize();refreshDetail();}});resize.observe(parent);
  const unsubscribe=sharedState?.subscribe(state=>{const i=state.selection?.kind==='cell'?state.selection.cellIndex:null;if(i!==selected){selected=i;model?.select(i);if(i!==null&&frame&&!popup.hidden)showCell(i,false);}});
  function dispose(){if(dead)return;hide();clearFlat();dead=true;detailQueryIndices=null;lastDetailIndices=null;source?.dispose();assetController.abort();clearInterval(timer);clearTimeout(timeout);resize.disconnect();
    leaflet.off('moveend',syncFromLeaflet);leaflet.off('layeradd layerremove',routesChanged);routeLayer.off?.('layeradd layerremove',routesChanged);
    guardNode.removeEventListener('pointerdown',guardDown,true);guardNode.removeEventListener('pointermove',guardMove,true);guardNode.removeEventListener('pointerup',guardMove,true);guardNode.removeEventListener('pointercancel',guardCancel,true);map.off('dragstart',guardCancel);
    unsubscribe?.();document.removeEventListener('visibilitychange',visibility);motion.removeEventListener('change',visibility);window.removeEventListener('pagehide',dispose);
    layer?.getThreeRenderer?.()?.domElement?.removeEventListener('webglcontextlost',lost);mapTexture?.dispose();model?.dispose();map.remove();surface.remove();}
  window.addEventListener('pagehide',dispose);
  async function setViewMode(value){if(!['flat','3d'].includes(value))throw Error('Unknown geographic view');const token=++modeGeneration;
    if(value==='flat'){source?.cancelTerrain?.();terrainGeneration++;terrainViewKey='';terrainReadyKey='';}if(value==='flat'&&!model){assetController.abort();assetController=new AbortController();}
    if(value==='3d'){await ensure3D(token);if(dead||!active||token!==modeGeneration)return;if(!model)await ensure3D(token);if(dead||!active||token!==modeGeneration)return;}
    viewMode=value;mapTexture?.setTextureFactory(value==='3d'?textureFactory:null,textureOrigin);value==='flat'?flatWater.show():flatWater.hide();if(overview.layer){value==='flat'?overview.layer.show():overview.layer.hide();if(value!=='flat')cancelOverview();}
    if(model)model.group.visible=value==='3d';
    map.setPitch(value==='flat'?0:45);cancelAnimationFrame(refreshRAF);refreshRAF=0;runRefreshDetail();if(value==='flat')await renderFlat();else{flatGeneration++;flatController.abort();flatTime=null;flatTask=null;if(source)await awaitCurrentTerrain();}if(token!==modeGeneration||dead||!active)return;startAnimation();
    if(value==='flat'&&!overview.data)note.textContent=flatLabel;
  }
  if(initialView==='3d')await ready.then(()=>setViewMode('3d'));
  return {ready,update,show,hide,dispose,get active(){return active;},zoom(delta){map.setZoom(map.getZoom()+delta);},select:showCell,
    get viewMode(){return viewMode;},
    setViewMode,
    inspect(){return {map,layer,model,selected,frame,active,dead,geography:mapTexture,flatWater,overview,terrainInfo,modelDetailInfo:model?.detailStats||modelDetailInfo,terrainLoading:terrainTask,counters:{...counters,overviewActive,overviewPending:overviewPending?1:0,refreshPending:refreshRAF?1:0,coverageBinCount:coverageBins.size,effectiveDPR:map.getDevicePixelRatio?.()??map.options.devicePixelRatio},animationActive:!!timer&&active&&viewMode==='3d'&&!motion.matches};}};
}
