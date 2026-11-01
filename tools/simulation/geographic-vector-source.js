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
  let dead=false,generation=0,lastKey='',features=[],controller,lastBounds,textureFactory,status={status:'idle'};
  const report=value=>{status=value;onStatus(value);};
  const cache=new Map(),vector=new maptalks.VectorLayer('geographic-features',[],{zIndex:-10,geometryEvents:true}).addTo(map);
  const labels=new maptalks.VectorLayer('geographic-labels',[],{zIndex:10,geometryEvents:true}).addTo(map);
  const metadata=fetch('https://tiles.openfreemap.org/planet').then(r=>{if(!r.ok)throw Error('Vector TileJSON HTTP '+r.status);return r.json();});
  const tileX=(lon,z)=>(lon+180)/360*2**z,tileY=(lat,z)=>(1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*2**z;
  const lon=(x,z)=>x/2**z*360-180,lat=(y,z)=>Math.atan(Math.sinh(Math.PI*(1-2*y/2**z)))*180/Math.PI;
  function decode(buffer,x,y,z){const tile=new VectorTile(new Pbf(buffer)),result=[];
    for(const name of wanted){const layer=tile.layers[name];if(!layer)continue;
      for(let i=0;i<layer.length;i++){const item=layer.feature(i),feature=item.toGeoJSON(x,y,z);
        feature.properties={...feature.properties,_sourceLayer:name,_featureId:`${name}:${z}/${x}/${y}:${item.id??i}`};result.push(feature);}}
    return result;
  }
  function install(list){const geometries=[],labelGeometries=[],occupied=new Set(),named=new Set();
    for(const f of list){const name=f.properties._sourceLayer,p=f.properties;if((name==='place'||name==='transportation_name')&&!p.name)continue;
      if(name==='place'||name==='transportation_name'){
        if(named.has(p.name))continue;
        const g=f.geometry,coordinate=g.type==='Point'?g.coordinates:g.type==='LineString'?g.coordinates[Math.floor(g.coordinates.length/2)]:null;
        if(!coordinate)continue;const screen=map.coordinateToContainerPoint(new maptalks.Coordinate(coordinate)),key=Math.floor(screen.x/140)+','+Math.floor(screen.y/45);
        if(occupied.has(key))continue;occupied.add(key);named.add(p.name);
        const label=new maptalks.Marker(coordinate,{id:p._featureId,symbol:featureStyle(name,p)});labelGeometries.push(label);continue;
      }
      const geometry=maptalks.GeoJSON.toGeometry(f);if(!geometry||Array.isArray(geometry))continue;
      geometry.setId(p._featureId);geometry.setSymbol(featureStyle(name,p));geometry.setProperties(p);geometry.on('click',()=>{onPick({kind:'geographic-feature',id:p._featureId,layer:name,properties:p});});geometries.push(geometry);}
    vector.clear();vector.addGeometry(geometries);labels.clear();labels.addGeometry(labelGeometries);
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
  async function update(extent,zoom){const info=await metadata;if(dead)return;
    let z=Math.min(info.maxzoom??14,Math.max(8,Math.floor(zoom))),a,b,c,d;
    do{a=Math.floor(tileX(extent.xmin,z));b=Math.floor(tileX(extent.xmax,z));c=Math.floor(tileY(extent.ymax,z));d=Math.floor(tileY(extent.ymin,z));if((b-a+1)*(d-c+1)<=20)break;z--;}while(z>0);
    const key=[z,a,b,c,d].join('/');if(key===lastKey)return;lastKey=key;const token=++generation;controller?.abort();controller=new AbortController();const signal=controller.signal;
    report({kind:'geography',status:'loading'});const jobs=[];for(let y=c;y<=d;y++)for(let x=a;x<=b;x++)jobs.push({x,y});let cursor=0;const out=[];
    async function worker(){while(cursor<jobs.length){const {x,y}=jobs[cursor++],id=`${z}/${x}/${y}`;if(dead||token!==generation)return;let list=cache.get(id);
      if(!list){const url=info.tiles[0].replace('{z}',z).replace('{x}',x).replace('{y}',y),r=await fetch(url,{signal});if(!r.ok)throw Error('Vector tile HTTP '+r.status);list=decode(new Uint8Array(await r.arrayBuffer()),x,y,z);cache.set(id,list);while(cache.size>48)cache.delete(cache.keys().next().value);}out.push(...list);}}
    try{await Promise.all([worker(),worker(),worker(),worker()]);if(dead||token!==generation)return;features=out.sort((a,b)=>order[a.properties._sourceLayer]-order[b.properties._sourceLayer]);install(features);
      lastBounds={west:lon(a,z),east:lon(b+1,z),north:lat(c,z),south:lat(d+1,z)};texture(features,lastBounds);report({kind:'geography',status:'ready',featureCount:features.length,sourceLayers:[...new Set(features.map(f=>f.properties._sourceLayer))],tileZoom:z});
    }catch(error){if(error.name!=='AbortError'&&!dead){lastKey='';report({kind:'geography',status:'error',message:error.message});}}
  }
  return {update,setTextureFactory(factory,nextOrigin){textureFactory=factory;if(nextOrigin)origin=nextOrigin;if(factory&&lastBounds)texture(features,lastBounds);},suspend(){generation++;controller?.abort();lastKey='';},get status(){return status;},get features(){return features;},get layer(){return vector;},dispose(){dead=true;generation++;controller?.abort();cache.clear();vector.remove();labels.remove();}};
}
