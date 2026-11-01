import * as THREE from 'three';
import * as maptalks from 'maptalks';
import { ThreeLayer } from 'maptalks.three';
import { createVoxelWater } from './voxel-water-source.js';
import { createVectorGeography } from './geographic-vector-source.js';

export async function createGeographicView({leaflet,loaded,get,footprints,routeLayer,sharedState,onError=()=>{},onSelectCell=()=>{},onStatus=()=>{},onPick=()=>{}}){
  async function read(path,gzip=false){const r=await get(path);if(!r.ok)throw Error(path+' HTTP '+r.status);
    return gzip?new Response(r.body.pipeThrough(new DecompressionStream('gzip'))):r;}
  const [terrain,detailBuffer,detailMeta]=await Promise.all([
    read('data/frozen-terrain-display.json.gz',true).then(r=>r.json()),
    read('data/frozen-voxel-terrain.f32.gz',true).then(r=>r.arrayBuffer()),
    read('data/frozen-voxel-terrain.json').then(r=>r.json())]);
  if(detailMeta.sourceSha256!==loaded.manifest.artifact.sha256)throw Error('Terrain detail provenance mismatch');
  if(!document.querySelector('[data-voxel-style]')){const link=document.createElement('link');link.rel='stylesheet';
    link.href=new URL('./geographic-view.css',import.meta.url);link.dataset.voxelStyle='';document.head.append(link);}
  const parent=leaflet.getContainer(),surface=document.createElement('div');surface.className='geographic-3d voxel-geographic';
  surface.setAttribute('aria-label','Voxel terrain and model water map');parent.append(surface);
  const stop=e=>e.stopPropagation();for(const type of ['mousedown','pointerdown','touchstart','dblclick','wheel','click'])surface.addEventListener(type,stop);
  const note=document.createElement('div');note.className='voxel-map-note';note.textContent='10 m lidar terrain · 100 m water levels · animated highlights are cosmetic';surface.append(note);
  const popup=document.createElement('div');popup.className='voxel-cell-info';popup.hidden=true;surface.append(popup);
  const mapNode=document.createElement('div');mapNode.className='voxel-map-surface';surface.prepend(mapNode);
  let active=true,dead=false,model=null,frame=null,mode='aggregate',context=null,map,layer,timer,timeout,selected=null,lastDetail='',mapTexture,viewMode='3d',syncing=false,highDetailTask;
  let resolveReady,rejectReady,cameraReady=false,geographyReady=false;const ready=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});
  function finishReady(){if(cameraReady&&geographyReady&&!dead){clearTimeout(timeout);resolveReady();}}
  const c=leaflet.getCenter(),motion=matchMedia('(prefers-reduced-motion: reduce)');
  const coverageBins=new Map(),binKey=(lat,lon)=>Math.floor(lat/.01)+','+Math.floor(lon/.01);
  footprints.rings.forEach((ring,i)=>{const ys=ring.map(p=>p[0]),xs=ring.map(p=>p[1]);for(let y=Math.floor(Math.min(...ys)/.01);y<=Math.floor(Math.max(...ys)/.01);y++)for(let x=Math.floor(Math.min(...xs)/.01);x<=Math.floor(Math.max(...xs)/.01);x++){const key=y+','+x;if(!coverageBins.has(key))coverageBins.set(key,[]);coverageBins.get(key).push(i);}});
  function findNativeCell(lat,lon){for(const index of coverageBins.get(binKey(lat,lon))||[]){const ring=footprints.rings[index];let inside=false;for(let i=0,j=3;i<4;j=i++){const [yi,xi]=ring[i],[yj,xj]=ring[j];if((yi>lat)!==(yj>lat)&&lon<(xj-xi)*(lat-yi)/(yj-yi)+xi)inside=!inside;}if(inside)return index;}return null;}
  const routeContext=new maptalks.VectorLayer('original-route-context',[],{zIndex:20,enableAltitude:false});
  const extraContext=new maptalks.VectorLayer('original-model-context',[],{zIndex:21});
  function fail(error){if(dead)return;const message=error instanceof Error?error.message:String(error);hide();rejectReady(Error(message));onError('3D unavailable: '+message+'. The 2D map remains available.');}
  try{
    map=new maptalks.Map(mapNode,{center:[c.lng,c.lat],zoom:leaflet.getZoom(),pitch:58,bearing:0,maxPitch:75,
      devicePixelRatio:Math.min(globalThis.devicePixelRatio||1,1.5),attribution:{content:'OpenFreeMap © OpenMapTiles · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> · USGS 3DEP'},
      layers:[routeContext,extraContext]});
    layer=new ThreeLayer('native-voxel-water',{forceRenderOnMoving:true,forceRenderOnRotating:true,forceRenderOnZooming:true,geometryEvents:false});
    layer.prepareToDraw=function(gl,scene){try{
      if(model)return;
      const origin=layer.coordinateToVector3([-111.2,32.44]);
      const altitude=m=>map.altitudeToPoint(m,map.getGLRes(),new maptalks.Coordinate(-111.2,32.44));
      model=createVoxelWater({loaded,terrain,footprints,detail:new Float32Array(detailBuffer),origin,
        project:p=>layer.coordinateToVector3(p),altitude});
      mapTexture=createVectorGeography({map,project:p=>layer.coordinateToVector3(p),origin,onPick,onStatus:status=>{onStatus(status);if(status.status==='ready'){geographyReady=true;finishReady();}else if(status.status==='error')fail('Vector geography: '+status.message);},onTexture:(texture,bounds)=>{model.setMapTexture(texture,bounds);layer.renderScene();}});
      scene.add(new THREE.HemisphereLight(0xffffff,0x777777,1.2));
      const sun=new THREE.DirectionalLight(0xffffff,1.2);sun.position.set(-1,-2,4);scene.add(sun);
      layer.addMesh(model.group);refreshDetail();if(frame)update(frame,mode,context);syncRoutes();
      (gl.canvas||gl.domElement).addEventListener('webglcontextlost',lost);
      // The initial prepare callback precedes Maptalks' final camera extent.
      // Rebuild after its first two layout/render turns, not from that provisional extent.
      requestAnimationFrame(()=>requestAnimationFrame(()=>{if(dead)return;refreshDetail();cameraReady=true;finishReady();startAnimation();}));
    }catch(error){fail(error);}};
    layer.addTo(map);parent.classList.add('map-has-3d');
  }catch(error){surface.remove();map?.remove();throw error;}
  timeout=setTimeout(()=>{if(!cameraReady||!geographyReady)fail('Geographic renderer initialization timed out');},30000);
  function lost(event){event.preventDefault();fail('Graphics context was lost');}
  function eachLeaf(group,callback){group?.eachLayer?.(l=>l.eachLayer?eachLeaf(l,callback):callback(l));}
  function syncGroup(group,target,withClicks=false){target.clear();if(!group)return;
    eachLeaf(group,l=>{const feature=l.toGeoJSON?.();if(!feature?.geometry)return;
      let geometry;
      if(feature.geometry.type==='Point'){
        const icon=l.options?.icon?.options;let label='';if(icon?.html){const el=document.createElement('div');el.innerHTML=icon.html;label=el.textContent.trim();}
        geometry=new maptalks.Marker(feature.geometry.coordinates,{symbol:{markerType:'ellipse',markerFill:l.options?.color||'#24444b',markerLineColor:'#ffffff',markerLineWidth:2,markerWidth:label?26:12,markerHeight:label?26:12,textName:label,textFill:'#ffffff',textSize:12}});
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
  function refreshDetail(){if(!model||!active)return;const zoom=map.getZoom(),extent=map.getExtent();
    const indices=[],pad=.006;
    loaded.run.cells.forEach((c,i)=>{if(c.lon>=extent.xmin-pad&&c.lon<=extent.xmax+pad&&c.lat>=extent.ymin-pad&&c.lat<=extent.ymax+pad)indices.push(i);});
    const centre=map.getCenter(),distance=i=>{const c=loaded.run.cells[i];return (c.lon-centre.x)**2*Math.cos(centre.y*Math.PI/180)**2+(c.lat-centre.y)**2;};indices.sort((a,b)=>distance(a)-distance(b));
    if(zoom>=18&&!highDetailTask)highDetailTask=Promise.all([read('data/voxel-detail-1m.json').then(r=>r.json()),read('data/voxel-detail-1m.f32.gz',true).then(r=>r.arrayBuffer())]).then(([metadata,buffer])=>{if(dead)return;model.setHighDetail({metadata,values:new Float32Array(buffer)});lastDetail='';refreshDetail();}).catch(error=>onStatus({kind:'terrain-detail',status:'error',message:error.message}));
    const sub=zoom>=18?100:zoom>=14?10:zoom>=12?5:zoom>=10?2:1,key=sub+':'+indices.join(',');
    if(key!==lastDetail){lastDetail=key;const detail=model.setDetail(indices,sub);if(frame)model.update(frame,mode);note.textContent=`${detail.resolutionM} m terrain near centre / ${detail.farResolutionM} m far · overview water shows native 100 m cells · cosmetic animation`;}
    mapTexture?.update(extent,zoom).catch(error=>fail('Vector geography: '+error.message));
    layer.renderScene();
  }
  function showCell(index,notify=true){selected=index;model?.select(index);const info=model?.cellInfo(index);if(!info)return;
    const title=document.createElement('strong');title.textContent=`SFINCS cell ${index} · row ${info.row}, col ${info.column}`;
    const body=document.createElement('div');body.textContent=`${new Date(info.time).toLocaleString('en-US',{timeZone:'America/Phoenix',month:'short',day:'numeric',hour:'numeric'})} MST · ${info.depthM===null?'No model depth result':info.depthM.toFixed(3)+' m / '+info.depthFt.toFixed(2)+' ft cell-average depth'}`;
    const level=document.createElement('div');level.textContent=info.surfaceM===null?'Native water surface unavailable':`Native water surface ${info.surfaceM.toFixed(2)} m NAVD88`;
    const caveat=document.createElement('small');caveat.textContent='Terrain intersection is a downscaled display, not surveyed road depth or a fine-grid hydraulic solution.';
    const close=document.createElement('button');close.type='button';close.textContent='Close';close.onclick=()=>{popup.hidden=true;};
    popup.replaceChildren(title,body,level,caveat,close);popup.hidden=false;if(notify)onSelectCell(index);layer.renderScene();
  }
  function update(next,nextMode='aggregate',contextGroup){const request=sharedState?.snapshot().requested;
    if(request&&(!sharedState.isCurrent(request.requestId)||request.time!==next.time||request.model!==nextMode))return Promise.reject(Error('Renderer request no longer matches selected frame'));
    frame=next;mode=nextMode;context=contextGroup??context;
    if(!model)return ready.then(()=>update(next,nextMode,contextGroup));
    try{model.update(next,nextMode);}catch(error){frame=null;popup.hidden=true;layer.renderScene();throw error;}
    syncGroup(context,extraContext);syncRoutes();if(selected!==null){model.select(selected);if(!popup.hidden)showCell(selected,false);}layer.renderScene();
    return Promise.resolve({time:frame.time,model:mode,view:viewMode});
  }
  // Use the browser click emitted by the geographic host before its time-threshold
  // filter. A slow GPU/vector hit-test must not turn an ordinary completed tap into
  // a missing selection. Browser click still excludes a drag gesture.
  map.on('dom:click',event=>{if(!model||!frame||mode==='off'||mode==='hand'||map.isInteracting())return;const p=event.containerPoint,size=map.getSize();
    const ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2(p.x/size.width*2-1,1-p.y/size.height*2),layer.getCamera());
    const index=model.pick(ray)??findNativeCell(event.coordinate.y,event.coordinate.x);if(index!==null)showCell(index);else{popup.textContent='No native model coverage at this location. This is not a dry or safe-road result.';popup.hidden=false;sharedState?.select({kind:'location',lat:event.coordinate.y,lon:event.coordinate.x});}});
  map.on('moveend zoomend pitchend rotateend',refreshDetail);
  const syncFromLeaflet=()=>{if(active&&!dead&&!syncing){const c=leaflet.getCenter();map.setCenterAndZoom([c.lng,c.lat],leaflet.getZoom());syncRoutes();}};
  map.on('moveend zoomend',()=>{if(!active||dead||syncing)return;const c=map.getCenter(),e=map.getExtent();syncing=true;
    try{leaflet.setView([c.y,c.x],map.getZoom(),{animate:false});sharedState?.setViewport({center:[c.x,c.y],zoom:map.getZoom(),bounds:[e.xmin,e.ymin,e.xmax,e.ymax]});}finally{syncing=false;}});
  const routesChanged=()=>{if(active)syncRoutes();};leaflet.on('moveend',syncFromLeaflet);leaflet.on('layeradd layerremove',routesChanged);routeLayer.on?.('layeradd layerremove',routesChanged);
  function startAnimation(){clearInterval(timer);if(!active||dead||motion.matches||document.hidden)return;
    timer=setInterval(()=>{if(model&&active){model.animate(performance.now()/1000);layer.renderScene();}},1000/24);}
  function visibility(){startAnimation();}document.addEventListener('visibilitychange',visibility);motion.addEventListener('change',visibility);
  function hide(){if(!active||dead)return;active=false;clearInterval(timer);const c=map.getCenter(),z=map.getZoom();surface.hidden=true;parent.classList.remove('map-has-3d');leaflet.invalidateSize();leaflet.setView([c.y,c.x],z,{animate:false});popup.hidden=true;}
  function show(){if(dead)throw Error('3D map disposed');active=true;surface.hidden=false;parent.classList.add('map-has-3d');map.checkSize();syncFromLeaflet();refreshDetail();if(selected!==null)model?.select(selected);startAnimation();}
  const resize=new ResizeObserver(()=>{if(active&&!dead){map.checkSize();refreshDetail();}});resize.observe(parent);
  const unsubscribe=sharedState?.subscribe(state=>{const i=state.selection?.kind==='cell'?state.selection.cellIndex:null;if(i!==selected){selected=i;model?.select(i);if(i!==null&&frame&&!popup.hidden)showCell(i,false);}});
  function dispose(){if(dead)return;hide();dead=true;clearInterval(timer);clearTimeout(timeout);resize.disconnect();
    leaflet.off('moveend',syncFromLeaflet);leaflet.off('layeradd layerremove',routesChanged);routeLayer.off?.('layeradd layerremove',routesChanged);
    unsubscribe?.();document.removeEventListener('visibilitychange',visibility);motion.removeEventListener('change',visibility);window.removeEventListener('pagehide',dispose);
    layer?.getThreeRenderer?.()?.domElement?.removeEventListener('webglcontextlost',lost);mapTexture?.dispose();model?.dispose();map.remove();surface.remove();}
  window.addEventListener('pagehide',dispose);
  return {ready,update,show,hide,dispose,get active(){return active;},zoom(delta){map.setZoom(map.getZoom()+delta);},select:showCell,
    get viewMode(){return viewMode;},
    setViewMode(value){if(!['flat','3d'].includes(value))throw Error('Unknown geographic view');viewMode=value;map.setPitch(value==='flat'?0:58);model?.setViewMode(value);refreshDetail();},
    inspect(){return {map,layer,model,selected,frame,active,dead,geography:mapTexture};}};
}
