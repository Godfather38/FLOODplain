import {VectorTile} from '@mapbox/vector-tile';
import Pbf from 'pbf';
import * as maptalks from 'maptalks';

import {wanted,featureStyle,visibleFeature,labelText,labelStyle,featureOrder} from './geographic-feature-style.js';
export {featureStyle} from './geographic-feature-style.js';

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
        feature.bbox=bbox;feature._coordinateCount=count;feature.properties={...feature.properties,_sourceLayer:name,_featureId:name+':'+z+'/'+x+'/'+y+':'+(item.id??'anonymous')+':'+i};result.push(feature);}}
    return {features:result,coordinates};
  }
  function installLabels(list){labels.clear();const labelGeometries=[],occupied=[],named=new Set(),zoom=map.getZoom();
    list=[...list].filter(f=>['waterway','water_name','park','place','transportation_name','poi','housenumber'].includes(f.properties._sourceLayer)).sort((a,b)=>{const rank=n=>['waterway','water_name'].includes(n)?0:n==='place'?1:n==='transportation_name'?2:3;return rank(a.properties._sourceLayer)-rank(b.properties._sourceLayer)});
    for(const f of list){const name=f.properties._sourceLayer,p=f.properties,text=labelText(name,p,zoom);if(!text||named.has(text))continue;
      const g=f.geometry,lines=g.type==='MultiLineString'?[...g.coordinates].sort((a,b)=>b.length-a.length)[0]:g.type==='LineString'?g.coordinates:null;
      let coordinate=g.type==='Point'?g.coordinates:lines?lines[Math.floor(lines.length/2)]:[(f.bbox[0]+f.bbox[2])/2,(f.bbox[1]+f.bbox[3])/2];
      // A clipped named wash can have its midpoint offscreen: choose a real visible vertex.
      if(lines){const size=map.getSize(),inside=lines.filter(c=>{const p=map.coordinateToContainerPoint(new maptalks.Coordinate(c));return p.x>30&&p.x<size.width-30&&p.y>30&&p.y<size.height-30});if(inside.length)coordinate=inside[Math.floor(inside.length/2)];}
      const screen=map.coordinateToContainerPoint(new maptalks.Coordinate(coordinate)),size=map.getSize(),width=Math.min(240,text.length*6.5+10),dy=name==='transportation_name'?-13:0,box={left:screen.x-width/2,right:screen.x+width/2,top:screen.y+dy-10,bottom:screen.y+dy+10};
      if(box.right<0||box.left>size.width||box.bottom<0||box.top>size.height||occupied.some(b=>box.left<b.right+5&&box.right>b.left-5&&box.top<b.bottom+5&&box.bottom>b.top-5))continue;occupied.push(box);named.add(text);
      labelGeometries.push(new maptalks.Marker(coordinate,{id:p._featureId,symbol:{...labelStyle(name,p,zoom),textName:text,textDy:dy}}));if(labelGeometries.length>=100)break;
    }labels.addGeometry(labelGeometries);
  }
  function install(list){vector.clear();vector.config('enableSimplify',map.getZoom()<16);installLabels(list);const geometries=[];
    for(const f of list){const name=f.properties._sourceLayer,p=f.properties;if(['place','transportation_name','water_name','poi','housenumber'].includes(name))continue;
      const geometry=maptalks.GeoJSON.toGeometry(f);if(!geometry||Array.isArray(geometry))continue;
      geometry.setId(p._featureId);geometry.setSymbol(featureStyle(name,p,map.getZoom()));geometry.setProperties(p);geometry.on('click',()=>{onPick({kind:'geographic-feature',id:p._featureId,layer:name,properties:p});});geometries.push(geometry);}
    vector.addGeometry(geometries);
  }
  function texture(list,bounds){if(!onTexture||!textureFactory)return;const sw=project([bounds.west,bounds.south]).sub(origin),ne=project([bounds.east,bounds.north]).sub(origin);
    const canvas=document.createElement('canvas');canvas.width=2048;canvas.height=2048;const ctx=canvas.getContext('2d');ctx.fillStyle='#eeeee7';ctx.fillRect(0,0,2048,2048);
    function point(p){const v=project(p).sub(origin);return [(v.x-sw.x)/(ne.x-sw.x)*2048,(1-(v.y-sw.y)/(ne.y-sw.y))*2048];}
    function path(rings,fill,stroke,width,dash=[],opacity=1){ctx.globalAlpha=1;ctx.setLineDash(dash);ctx.beginPath();for(const ring of rings){ring.forEach((c,i)=>{const p=point(c);i?ctx.lineTo(...p):ctx.moveTo(...p);});if(fill)ctx.closePath();}
      if(fill){ctx.fillStyle=fill;ctx.fill('evenodd');}if(stroke&&width>0){ctx.globalAlpha=opacity;ctx.strokeStyle=stroke;ctx.lineWidth=width;ctx.stroke();}}
    for(const f of list){const name=f.properties._sourceLayer,styles=featureStyle(name,f.properties,map.getZoom()),g=f.geometry;for(const s of (Array.isArray(styles)?styles:[styles])){
      if(g.type==='Polygon')path(g.coordinates,s.polygonFill,s.lineColor,s.lineWidth??1,s.lineDasharray||[],s.lineOpacity??1);
      if(g.type==='MultiPolygon')for(const p of g.coordinates)path(p,s.polygonFill,s.lineColor,s.lineWidth||1);
      if(g.type==='LineString'&&s.lineColor)path([g.coordinates],null,s.lineColor,s.lineWidth||1);
      if(g.type==='MultiLineString'&&s.lineColor)path(g.coordinates,null,s.lineColor,s.lineWidth||1);
      }
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
          for(const f of entry.features){if(!intersects(f.bbox,bounds)||!visibleFeature(f.properties._sourceLayer,f.properties,requestedZoom))continue;drawCoordinates+=f._coordinateCount;if(drawCoordinates>limits.drawCoordinates||out.length>=limits.drawFeatures)throw new Complexity('Visible vector geometry budget');out.push(f);}
        }}
        try{await Promise.all([worker(),worker()]);if(stale())return;features=out.sort((a,b)=>featureOrder(a)-featureOrder(b));install(features);lastBounds=bounds;installedBounds=bounds;installedZoom=requestedZoom;texture(features,lastBounds);report({kind:'geography',status:'ready',featureCount:features.length,coordinateCount:drawCoordinates,cachedTiles:cache.size,cachedCoordinates:cacheCoordinates,cachedFeatures:cacheFeatures,sourceLayers:[...new Set(features.map(f=>f.properties._sourceLayer))],tileZoom:z,displayZoom:requestedZoom,overzoom:Math.max(0,requestedZoom-z),labelCount:labels.getCount(),simplified:map.getZoom()<16});return;
        }catch(error){attempt.abort();if(signal.aborted||dead||token!==generation)return;if(!(error instanceof Complexity))throw error;if(z===0)throw Error('Vector geography exceeds safe draw budget at lowest detail');}
        finally{signal.removeEventListener('abort',cancel);}
      }
    }catch(error){if(error.name!=='AbortError'&&!dead&&token===generation){lastKey='';report({kind:'geography',status:'error',message:error.message});}}
    })().finally(()=>{if(token===generation)pending=null;});return pending;
  }
  return {update,setTextureFactory(factory,nextOrigin){textureFactory=factory;if(nextOrigin)origin=nextOrigin;if(factory&&lastBounds)texture(features,lastBounds);},suspend(){generation++;controller?.abort();lastKey='';pending=null;installedBounds=null;},get status(){return status;},get features(){return features;},get layer(){return vector;},get budgets(){return {...limits,cachedTiles:cache.size,cachedCoordinates:cacheCoordinates,cachedFeatures:cacheFeatures,drawFeatures:features.length};},dispose(){dead=true;generation++;controller?.abort();cache.clear();cacheCoordinates=0;cacheFeatures=0;features=[];pending=null;lastBounds=null;installedBounds=null;textureFactory=null;vector.remove();labels.remove();}};
}
