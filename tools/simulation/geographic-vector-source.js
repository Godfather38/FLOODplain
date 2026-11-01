import {VectorTile} from '@mapbox/vector-tile';
import Pbf from 'pbf';
import * as maptalks from 'maptalks';

const wanted=['landcover','landuse','water','waterway','transportation','transportation_name','place','building'];
const order={landcover:0,landuse:1,water:2,building:3,waterway:4,transportation:5,transportation_name:6,place:7};
export function featureStyle(layer,p={}){
  if(layer==='landcover')return {polygonFill:p.class==='wood'?'#d5ddd0':'#e3e6da',polygonOpacity:1,lineOpacity:0};
  if(layer==='landuse')return {polygonFill:p.class==='residential'?'#e7e4dc':p.class==='industrial'?'#dedee1':'#e5e7dc',polygonOpacity:1,lineOpacity:0};
  if(layer==='water')return {polygonFill:'#a8c0c7',polygonOpacity:1,lineOpacity:0};
  if(layer==='waterway')return {lineColor:'#a1bbc4',lineWidth:1.4};
  if(layer==='building')return {polygonFill:'#c9c7bf',polygonOpacity:1,lineColor:'#bbb9b1',lineWidth:.5};
  if(layer==='transportation')return {lineColor:['motorway','trunk'].includes(p.class)?'#c4ab86':'#faf9f3',lineWidth:['motorway','trunk','primary'].includes(p.class)?4:p.class==='secondary'?3:2,lineOpacity:1};
  return {textName:p.name||'',textFill:'#536168',textSize:layer==='place'?13:10,textHaloFill:'#f4f4ed',textHaloRadius:1.5,textAllowOverlap:false};
}

// Geographic geometry is decoded locally. There is no raster basemap source.
export function createVectorGeography({map,project,origin,onTexture,onPick=()=>{},onStatus=()=>{}}){
  let dead=false,generation=0,lastKey='',features=[],controller,lastBounds,textureFactory,status={status:'idle'},installedBounds,installedZoom,pending=null,cacheCoordinates=0,cacheFeatures=0;
  const limits={cacheTiles:24,cacheCoordinates:250000,cacheFeatures:20000,drawCoordinates:100000,drawFeatures:5000,tileBytes:4*1024*1024};
  class Complexity extends Error {}
  const intersects=(a,b)=>a[2]>=b.west&&a[0]<=b.east&&a[3]>=b.south&&a[1]<=b.north;
  const contains=(a,b)=>a&&a.west<=b.west&&a.east>=b.east&&a.south<=b.south&&a.north>=b.north;
  function remember(key,value){if(cache.has(key)){const old=cache.get(key);cacheCoordinates-=old.coordinates;cacheFeatures-=old.features.length;cache.delete(key);}cache.set(key,value);cacheCoordinates+=value.coordinates;cacheFeatures+=value.features.length;while(cache.size>limits.cacheTiles||cacheCoordinates>limits.cacheCoordinates||cacheFeatures>limits.cacheFeatures){const first=cache.keys().next().value,old=cache.get(first);cacheCoordinates-=old.coordinates;cacheFeatures-=old.features.length;cache.delete(first);}}
  const report=value=>{status=value;onStatus(value);};
  const cache=new Map(),vector=new maptalks.VectorLayer('geographic-features',[],{zIndex:-10,geometryEvents:true}).addTo(map);
  const labels=new maptalks.VectorLayer('geographic-labels',[],{zIndex:10,geometryEvents:true}).addTo(map);
  const metadata=fetch('https://tiles.openfreemap.org/planet').then(r=>{if(!r.ok)throw Error('Vector TileJSON HTTP '+r.status);return r.json();});
  const tileX=(lon,z)=>(lon+180)/360*2**z,tileY=(lat,z)=>(1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*2**z;
  const lon=(x,z)=>x/2**z*360-180,lat=(y,z)=>Math.atan(Math.sinh(Math.PI*(1-2*y/2**z)))*180/Math.PI;
  function decode(buffer,x,y,z){if(buffer.byteLength>limits.tileBytes)throw new Complexity('Vector tile byte budget');const tile=new VectorTile(new Pbf(buffer)),result=[];let coordinates=0;
    for(const name of wanted){const layer=tile.layers[name];if(!layer)continue;
      for(let i=0;i<layer.length;i++){const item=layer.feature(i),feature=item.toGeoJSON(x,y,z),bbox=[Infinity,Infinity,-Infinity,-Infinity];let count=0;
        function scan(points){if(typeof points[0]==='number'){count++;bbox[0]=Math.min(bbox[0],points[0]);bbox[1]=Math.min(bbox[1],points[1]);bbox[2]=Math.max(bbox[2],points[0]);bbox[3]=Math.max(bbox[3],points[1]);}else for(const p of points)scan(p);}scan(feature.geometry.coordinates);coordinates+=count;
        if(coordinates>limits.cacheCoordinates||result.length>=limits.cacheFeatures)throw new Complexity('Decoded vector tile budget');
        feature.bbox=bbox;feature._coordinateCount=count;feature.properties={...feature.properties,_sourceLayer:name,_featureId:name+':'+z+'/'+x+'/'+y+':'+(item.id??i)};result.push(feature);}}
    return {features:result,coordinates};
  }
  function installLabels(list){labels.clear();const labelGeometries=[],occupied=[],named=new Set();
    for(const f of list){const name=f.properties._sourceLayer,p=f.properties;if((name==='place'||name==='transportation_name')&&!p.name)continue;
      if(name==='place'||name==='transportation_name'){
        if(named.has(p.name))continue;
        const g=f.geometry,coordinate=g.type==='Point'?g.coordinates:g.type==='LineString'?g.coordinates[Math.floor(g.coordinates.length/2)]:null;
        if(!coordinate)continue;const screen=map.coordinateToContainerPoint(new maptalks.Coordinate(coordinate)),size=map.getSize(),width=Math.min(240,p.name.length*(name==='place'?7.8:6)+10),box={left:screen.x-width/2,right:screen.x+width/2,top:screen.y-12,bottom:screen.y+12};
        if(box.right<0||box.left>size.width||box.bottom<0||box.top>size.height||occupied.some(b=>box.left<b.right+8&&box.right>b.left-8&&box.top<b.bottom+8&&box.bottom>b.top-8))continue;occupied.push(box);named.add(p.name);
        const label=new maptalks.Marker(coordinate,{id:p._featureId,symbol:featureStyle(name,p)});labelGeometries.push(label);continue;
      }
    }labels.addGeometry(labelGeometries);
  }
  function install(list){vector.clear();installLabels(list);const geometries=[];
    for(const f of list){const name=f.properties._sourceLayer,p=f.properties;if(name==='place'||name==='transportation_name')continue;
      const geometry=maptalks.GeoJSON.toGeometry(f);if(!geometry||Array.isArray(geometry))continue;
      geometry.setId(p._featureId);geometry.setSymbol(featureStyle(name,p));geometry.setProperties(p);geometry.on('click',()=>{onPick({kind:'geographic-feature',id:p._featureId,layer:name,properties:p});});geometries.push(geometry);}
    vector.addGeometry(geometries);
  }
  function texture(list,bounds){if(!onTexture||!textureFactory)return;const sw=project([bounds.west,bounds.south]).sub(origin),ne=project([bounds.east,bounds.north]).sub(origin);
    const canvas=document.createElement('canvas');canvas.width=2048;canvas.height=2048;const ctx=canvas.getContext('2d');ctx.fillStyle='#eeeee7';ctx.fillRect(0,0,2048,2048);
    function point(p){const v=project(p).sub(origin);return [(v.x-sw.x)/(ne.x-sw.x)*2048,(1-(v.y-sw.y)/(ne.y-sw.y))*2048];}
    function path(rings,fill,stroke,width){ctx.beginPath();for(const ring of rings){ring.forEach((c,i)=>{const p=point(c);i?ctx.lineTo(...p):ctx.moveTo(...p);});if(fill)ctx.closePath();}
      if(fill){ctx.fillStyle=fill;ctx.fill('evenodd');}if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=width;ctx.stroke();}}
    for(const f of list){const name=f.properties._sourceLayer,s=featureStyle(name,f.properties),g=f.geometry;
      if(g.type==='Polygon')path(g.coordinates,s.polygonFill,s.lineColor,s.lineWidth||1);
      if(g.type==='MultiPolygon')for(const p of g.coordinates)path(p,s.polygonFill,s.lineColor,s.lineWidth||1);
      if(g.type==='LineString'&&s.lineColor)path([g.coordinates],null,s.lineColor,s.lineWidth||1);
      if(g.type==='MultiLineString'&&s.lineColor)path(g.coordinates,null,s.lineColor,s.lineWidth||1);
      // Labels are screen-sized vector symbols in the common geographic camera,
      // never baked into terrain material where zoom would magnify/duplicate them.
    }
    onTexture(...textureFactory(canvas,[sw.x,sw.y,ne.x-sw.x,ne.y-sw.y]));
  }
  function update(extent,zoom){
    const view={west:extent.xmin,east:extent.xmax,south:extent.ymin,north:extent.ymax},requestedZoom=Math.floor(zoom),requestKey=[requestedZoom,view.west,view.east,view.south,view.north].join('/');
    if(dead)return Promise.resolve();if(requestKey===lastKey&&pending)return pending;
    if(installedZoom===requestedZoom&&contains(installedBounds,view)){if(pending){generation++;controller?.abort();pending=null;lastKey='';}installLabels(features);return Promise.resolve();}
    lastKey=requestKey;const token=++generation;controller?.abort();controller=new AbortController();const signal=controller.signal;
    const dx=(view.east-view.west)*.2,dy=(view.north-view.south)*.2,bounds={west:view.west-dx,east:view.east+dx,south:Math.max(-85,view.south-dy),north:Math.min(85,view.north+dy)};
    pending=(async()=>{try{const info=await metadata;if(dead||signal.aborted||token!==generation)return;let z=Math.min(info.maxzoom??14,Math.max(0,requestedZoom));
      report({kind:'geography',status:'loading'});
      for(;z>=0;z--){let a=Math.floor(tileX(bounds.west,z)),b=Math.floor(tileX(bounds.east,z)),c=Math.floor(tileY(bounds.north,z)),d=Math.floor(tileY(bounds.south,z));if((b-a+1)*(d-c+1)>20)continue;
        const attempt=new AbortController(),cancel=()=>attempt.abort();signal.addEventListener('abort',cancel,{once:true});const stale=()=>dead||signal.aborted||attempt.signal.aborted||token!==generation;let cursor=0,drawCoordinates=0;const jobs=[],out=[];
        for(let y=c;y<=d;y++)for(let x=a;x<=b;x++)jobs.push({x,y});
        async function worker(){while(cursor<jobs.length){if(stale())return;const {x,y}=jobs[cursor++],id=z+'/'+x+'/'+y;let entry=cache.get(id);
          if(entry){cache.delete(id);cache.set(id,entry);}else{const url=info.tiles[0].replace('{z}',z).replace('{x}',x).replace('{y}',y),r=await fetch(url,{signal:attempt.signal});if(!r.ok)throw Error('Vector tile HTTP '+r.status);const buffer=await r.arrayBuffer();if(stale())return;entry=decode(new Uint8Array(buffer),x,y,z);if(stale())return;remember(id,entry);}
          for(const f of entry.features){if(!intersects(f.bbox,bounds))continue;drawCoordinates+=f._coordinateCount;if(drawCoordinates>limits.drawCoordinates||out.length>=limits.drawFeatures)throw new Complexity('Visible vector geometry budget');out.push(f);}
        }}
        try{await Promise.all([worker(),worker()]);if(stale())return;features=out.sort((a,b)=>order[a.properties._sourceLayer]-order[b.properties._sourceLayer]);install(features);lastBounds=bounds;installedBounds=bounds;installedZoom=requestedZoom;texture(features,lastBounds);report({kind:'geography',status:'ready',featureCount:features.length,coordinateCount:drawCoordinates,cachedTiles:cache.size,cachedCoordinates:cacheCoordinates,cachedFeatures:cacheFeatures,sourceLayers:[...new Set(features.map(f=>f.properties._sourceLayer))],tileZoom:z});return;
        }catch(error){attempt.abort();if(signal.aborted||dead||token!==generation)return;if(!(error instanceof Complexity))throw error;if(z===0)throw Error('Vector geography exceeds safe draw budget at lowest detail');}
        finally{signal.removeEventListener('abort',cancel);}
      }
    }catch(error){if(error.name!=='AbortError'&&!dead&&token===generation){lastKey='';report({kind:'geography',status:'error',message:error.message});}}
    })().finally(()=>{if(token===generation)pending=null;});return pending;
  }
  return {update,setTextureFactory(factory,nextOrigin){textureFactory=factory;if(nextOrigin)origin=nextOrigin;if(factory&&lastBounds)texture(features,lastBounds);},suspend(){generation++;controller?.abort();lastKey='';pending=null;installedBounds=null;},get status(){return status;},get features(){return features;},get layer(){return vector;},get budgets(){return {...limits,cachedTiles:cache.size,cachedCoordinates:cacheCoordinates,cachedFeatures:cacheFeatures,drawFeatures:features.length};},dispose(){dead=true;generation++;controller?.abort();cache.clear();cacheCoordinates=0;cacheFeatures=0;features=[];pending=null;lastBounds=null;installedBounds=null;textureFactory=null;vector.remove();labels.remove();}};
}
