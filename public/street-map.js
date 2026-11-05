// The 2D map's street map, in the look of the 3D map page (preview/geo3d/src/world/paint.js on
// experiment/geographic-3d-layer): OpenFreeMap vector tiles painted on the device, warm land
// colours, roads at their real widths, washes as sand beds, and blue kept for model water.
import {VectorTile} from './vendor/vector-tiles/vector-tile/index.js';
import {PbfReader} from './vendor/vector-tiles/pbf/index.js';
import {canvasRatio} from './graphics.js?v=dev';

export const LAND={grass:'#e3e8cc',scrub:'#e1e3c6',wood:'#d3dfba',forest:'#d3dfba',sand:'#f0e5cb',farmland:'#e4e8cf',wetland:'#d5e5d8',rock:'#e2dccf'};
export const LANDUSE={residential:'#ece6dc',commercial:'#ebe2dc',industrial:'#e6e1db',school:'#efe4d8',cemetery:'#dfe6cf',quarry:'#e0d8c8'};
// w: real width in metres. min: the narrowest the road is drawn, in screen pixels, so far roads stay readable.
export const ROAD={motorway:{w:26,min:2.6,fill:'#f6c86a',edge:'#d39a3d',from:5},trunk:{w:20,min:2.2,fill:'#f9d68c',edge:'#d7a85b',from:6},primary:{w:15,min:1.8,fill:'#fff3cf',edge:'#cdbf9a',from:8},secondary:{w:12,min:1.5,fill:'#ffffff',edge:'#c9c3b6',from:9},tertiary:{w:10,min:1.3,fill:'#ffffff',edge:'#ccc6ba',from:10},minor:{w:7,min:1,fill:'#ffffff',edge:'#d0cabe',from:13},service:{w:4,min:.8,fill:'#fbfaf7',edge:'#d6d0c4',from:14},track:{w:3,min:.8,fill:'#efe6d4',edge:'#d6cbb4',from:14}};
export const ORDER=['track','service','minor','tertiary','secondary','primary','trunk','motorway'];
export const BACKGROUND='#efe8d8';
// OpenFreeMap serves tiles up to zoom 14; closer views paint a part of a zoom 14 tile.
export const TILE_MAX_ZOOM=14;
export const ATTRIBUTION='<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';
// Map water areas are beds: dry washes and seasonal rivers in sand, standing water such as canals and ponds in grey-blue.
export const mapWaterColour=p=>p.intermittent===1||p.class==='river'?'#eadcbd':'#c4d3d6';
export const metresPerPixel=(lat,zoom)=>40075016.686*Math.cos(lat*Math.PI/180)/2**(zoom+8);
// Fill width of a road in screen pixels at this scale; the edge adds about 2.5 m, never under a pixel.
export function roadPixels(cls,mpp){const s=ROAD[cls]??ROAD.minor,fill=Math.max(s.min,s.w/mpp);return{fill,edge:fill+Math.max(1,2.5/mpp)};}
// The vector tile that holds a map tile, and where the map tile sits inside it.
export function sourceTile({x,y,z}){
 if(z<=TILE_MAX_ZOOM)return{x,y,z,k:1,sx:0,sy:0};
 const k=2**(z-TILE_MAX_ZOOM),px=Math.floor(x/k),py=Math.floor(y/k);
 return{x:px,y:py,z:TILE_MAX_ZOOM,k,sx:x-px*k,sy:y-py*k};
}
const lonOf=(x,z)=>x/2**z*360-180,latOf=(y,z)=>Math.atan(Math.sinh(Math.PI*(1-2*y/2**z)))*180/Math.PI;
const tileLat=({y,z})=>latOf(y+.5,z);

export function createTileSource(fetchImpl=(...a)=>fetch(...a)){
 let template=null;const cache=new Map();
 const url=async(z,x,y)=>{
  template??=fetchImpl('https://tiles.openfreemap.org/planet').then(r=>{if(!r.ok)throw Error('Map tiles answered '+r.status);return r.json()}).then(j=>j.tiles[0]);
  template.catch(()=>{template=null});
  return(await template).replace('{z}',z).replace('{x}',x).replace('{y}',y);
 };
 // Decoded tiles are kept for this visit; the oldest go once there are more than 160.
 function load({x,y,z}){
  const key=`${z}/${x}/${y}`;
  if(cache.has(key)){const hit=cache.get(key);cache.delete(key);cache.set(key,hit);return hit;}
  const p=(async()=>{const r=await fetchImpl(await url(z,x,y));if(!r.ok)throw Error(`Map tile ${key} answered ${r.status}`);return{x,y,z,tile:new VectorTile(new PbfReader(new Uint8Array(await r.arrayBuffer())))};})();
  p.catch(()=>cache.delete(key));cache.set(key,p);
  while(cache.size>160)cache.delete(cache.keys().next().value);
  return p;
 }
 const loaded=()=>[...cache.values()];
 return{load,loaded};
}

// Paint one map tile. view: {size: canvas pixels, ratio: device pixels per screen pixel, zoom, k, sx, sy, hybrid}.
export function paintTile(ctx,tile,view){
 const {size,ratio=1,zoom,k=1,sx=0,sy=0,hybrid=false}=view,mpp=metresPerPixel(tileLat({y:tile.y*k+sy,z:zoom}),zoom);
 ctx.setTransform(1,0,0,1,0,0);
 if(!hybrid){ctx.fillStyle=BACKGROUND;ctx.fillRect(0,0,size,size);}
 const layer=name=>tile.tile.layers[name];
 // Units per screen pixel inside this layer's coordinates.
 const place=l=>{const s=size*k/l.extent;ctx.setTransform(s,0,0,s,-sx*size,-sy*size);return ratio/s;};
 const each=(name,fn)=>{const l=layer(name);if(!l)return;const unit=place(l);for(let i=0;i<l.length;i++){const f=l.feature(i);fn(f,f.loadGeometry(),unit);}};
 const path=rings=>{ctx.beginPath();for(const ring of rings)ring.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));};
 const fill=(rings,colour)=>{path(rings);ctx.fillStyle=colour;ctx.fill('evenodd');};
 ctx.lineCap='round';ctx.lineJoin='round';
 if(!hybrid){
  each('landcover',(f,g)=>{const c=LAND[f.properties.class];if(c&&f.type===3)fill(g,c);});
  each('landuse',(f,g)=>{const c=LANDUSE[f.properties.class];if(c&&f.type===3)fill(g,c);});
  each('park',(f,g)=>{if(f.type===3)fill(g,'#d6e6c2');});
  each('water',(f,g)=>{if(f.type===3)fill(g,mapWaterColour(f.properties));});
  each('waterway',(f,g,unit)=>{if(f.type!==2)return;path(g);ctx.strokeStyle='#d9c79f';ctx.lineWidth=Math.max(unit*(f.properties.class==='river'?2:1),(f.properties.class==='river'?14:5)/mpp*unit);ctx.stroke();});
  if(zoom>=14)each('building',(f,g,unit)=>{if(f.type!==3)return;fill(g,'#ddd4c6');ctx.strokeStyle='#cfc4b3';ctx.lineWidth=unit*.6;ctx.stroke();});
 }
 const roads=[],l=layer('transportation');
 if(l){const unit=place(l);for(let i=0;i<l.length;i++){const f=l.feature(i),cls=f.properties.class;if(f.type!==2||!ROAD[cls]||f.properties.brunnel==='tunnel'||zoom<ROAD[cls].from)continue;roads.push({f,cls,g:f.loadGeometry()});}
  roads.sort((a,b)=>ORDER.indexOf(a.cls)-ORDER.indexOf(b.cls));
  if(hybrid){ctx.globalAlpha=.55;for(const r of roads){path(r.g);ctx.strokeStyle=r.cls==='motorway'?'#f6c86a':'#ffffff';ctx.lineWidth=roadPixels(r.cls,mpp).fill*.6*unit;ctx.stroke();}ctx.globalAlpha=1;return;}
  // Bridges last, so a road over a wash is drawn over the wash bed.
  const passes=[roads.filter(r=>r.f.properties.brunnel!=='bridge'),roads.filter(r=>r.f.properties.brunnel==='bridge')];
  for(const set of passes)for(const pass of ['edge','fill'])for(const r of set){if(pass==='edge'&&zoom<11&&ORDER.indexOf(r.cls)<ORDER.indexOf('primary'))continue;path(r.g);ctx.strokeStyle=ROAD[r.cls][pass];ctx.lineWidth=roadPixels(r.cls,mpp)[pass]*unit;ctx.setLineDash(r.cls==='track'?[6*unit,5*unit]:[]);ctx.stroke();}
  ctx.setLineDash([]);
  // Centre lines and lane dashes on the bigger roads when close.
  if(zoom>=16)for(const r of roads){if(!['motorway','trunk','primary','secondary'].includes(r.cls))continue;path(r.g);ctx.lineWidth=Math.max(.35/mpp,.6)*unit;if(r.cls==='motorway'||r.f.properties.oneway===1){ctx.strokeStyle='#ffffff';ctx.setLineDash([3/mpp*unit,9/mpp*unit]);}else{ctx.strokeStyle='#e0a429';ctx.setLineDash([]);}ctx.stroke();}
  ctx.setLineDash([]);
 }
 ctx.setTransform(1,0,0,1,0,0);
}

// Names: places, roads and washes, upright, with lower-priority names hidden where they would overlap.
const PLACE_RANK={city:90,town:80,village:70,suburb:60,hamlet:55,neighbourhood:50,locality:45,isolated_dwelling:20};
const PLACE_FROM={city:8,town:9,village:11,suburb:12,hamlet:12,neighbourhood:14,locality:13,isolated_dwelling:15};
const ROAD_RANK={motorway:40,trunk:38,primary:36,secondary:34,tertiary:32,minor:28,service:20,track:15};
const ROAD_FROM={motorway:10,trunk:11,primary:12,secondary:13,tertiary:13,minor:14,service:16,track:16};
export function labelCandidates(entry,zoom){
 const {tile,x,y,z}=entry,out=[];
 const at=(l,p)=>[latOf(y+p.y/l.extent,z),lonOf(x+p.x/l.extent,z)];
 const inside=(l,p)=>p.x>=0&&p.y>=0&&p.x<l.extent&&p.y<l.extent;
 const mid=g=>{let best=null,len=0;for(const line of g)if(line.length>len){len=line.length;best=line;}return best?.[Math.floor(best.length/2)];};
 const places=tile.layers.place;
 if(places)for(let i=0;i<places.length;i++){const f=places.feature(i),cls=f.properties.class,name=f.properties.name_en||f.properties.name;if(!name||!(cls in PLACE_RANK)||zoom<PLACE_FROM[cls])continue;const p=f.loadGeometry()[0]?.[0];if(p&&inside(places,p))out.push({kind:'place',text:name,latlng:at(places,p),priority:PLACE_RANK[cls]});}
 const names=tile.layers.transportation_name;
 if(names)for(let i=0;i<names.length;i++){const f=names.feature(i),cls=f.properties.class,name=f.properties.name;if(!name||!(cls in ROAD_RANK)||zoom<ROAD_FROM[cls])continue;const p=mid(f.loadGeometry());if(p&&inside(names,p))out.push({kind:'road',text:name,latlng:at(names,p),priority:ROAD_RANK[cls]});}
 const ways=tile.layers.waterway;
 if(ways&&zoom>=13)for(let i=0;i<ways.length;i++){const f=ways.feature(i),name=f.properties.name;if(!name)continue;const p=mid(f.loadGeometry());if(p&&inside(ways,p))out.push({kind:'wash',text:name,latlng:at(ways,p),priority:f.properties.class==='river'?42:30});}
 return out;
}
// Greedy placement on a coarse screen grid: the more important label wins; one of each name per 400 px.
export function placeLabels(candidates,toPoint,{width,height,cell=24}){
 const taken=new Set(),shown=[],byName=new Map();
 for(const c of [...candidates].sort((a,b)=>b.priority-a.priority)){
  const p=toPoint(c.latlng);if(p.x<0||p.y<0||p.x>width||p.y>height)continue;
  if((byName.get(c.text)??[]).some(q=>Math.hypot(q.x-p.x,q.y-p.y)<400))continue;
  const w=c.text.length*7+16,keys=[];
  for(let gy=Math.floor((p.y-20)/cell);gy<=Math.floor(p.y/cell);gy++)for(let gx=Math.floor((p.x-w/2)/cell);gx<=Math.floor((p.x+w/2)/cell);gx++)keys.push(gx+','+gy);
  if(keys.some(k=>taken.has(k)))continue;
  keys.forEach(k=>taken.add(k));byName.set(c.text,[...(byName.get(c.text)??[]),p]);shown.push({...c,point:p});
 }
 return shown;
}

// Leaflet layers: the painted street map, satellite with a light road overlay, and the names on top.
export function createStreetMap(L,map,{fetchImpl,onUnavailable}={}){
 const source=createTileSource(fetchImpl);let failures=0,given=false;
 const fail=()=>{if(++failures>=6&&!given){given=true;onUnavailable?.();}};
 const Painted=L.GridLayer.extend({createTile(coords,done){
  const ratio=canvasRatio(),size=Math.round(256*ratio),canvas=document.createElement('canvas');canvas.width=canvas.height=size;
  const at=sourceTile(coords),ctx=canvas.getContext('2d'),hybrid=!!this.options.hybrid;
  if(!hybrid){ctx.fillStyle=BACKGROUND;ctx.fillRect(0,0,size,size);}
  source.load(at).then(tile=>{failures=0;paintTile(ctx,tile,{size,ratio,zoom:coords.z,k:at.k,sx:at.sx,sy:at.sy,hybrid});done(null,canvas);labels.schedule();},()=>{fail();done(null,canvas);});
  return canvas;
 }});
 const street=new Painted({maxZoom:19,maxNativeZoom:19,attribution:ATTRIBUTION,className:'street-tiles'});
 const roadsOverSatellite=new Painted({maxZoom:19,hybrid:true,pane:'overlayPane',className:'street-hybrid'});
 const imagery=L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:19,maxNativeZoom:18,attribution:'Imagery &copy; Esri'});
 const satellite=L.layerGroup([imagery,roadsOverSatellite]);
 if(!map.getPane('mapLabels'))map.createPane('mapLabels').style.zIndex=450;
 const labels={el:null,frame:0,
  schedule(){cancelAnimationFrame(this.frame);this.frame=requestAnimationFrame(()=>this.draw());},
  async draw(){
   if(!this.el)return;const zoom=map.getZoom(),z=Math.min(TILE_MAX_ZOOM,Math.floor(zoom)),size=map.getSize(),b=map.getBounds();
   const n=2**z,col=lon=>Math.floor((lon+180)/360*n),row=lat=>{const r=lat*Math.PI/180;return Math.floor((1-Math.log(Math.tan(r)+1/Math.cos(r))/Math.PI)/2*n);};
   const wanted=[];for(let y=row(b.getNorth());y<=row(b.getSouth());y++)for(let x=col(b.getWest());x<=col(b.getEast());x++)wanted.push({x,y,z});
   if(wanted.length>48)return;
   const tiles=(await Promise.allSettled(wanted.map(t=>source.load(t)))).filter(r=>r.status==='fulfilled').map(r=>r.value);
   if(!this.el||map.getZoom()!==zoom)return;
   const shown=placeLabels(tiles.flatMap(t=>labelCandidates(t,zoom)),ll=>map.latLngToContainerPoint(ll),{width:size.x,height:size.y});
   const origin=map.containerPointToLayerPoint([0,0]);
   this.el.replaceChildren(...shown.map(s=>{const e=document.createElement('div');e.className='map-label '+s.kind;e.textContent=s.text;e.style.transform=`translate(${Math.round(s.point.x+origin.x)}px,${Math.round(s.point.y+origin.y)}px) translate(-50%,-100%)`;return e;}));
  }};
 const Names=L.Layer.extend({
  onAdd(m){labels.el=L.DomUtil.create('div','map-labels leaflet-zoom-hide',m.getPane('mapLabels'));m.on('moveend zoomend',labels.schedule,labels);labels.schedule();},
  onRemove(m){m.off('moveend zoomend',labels.schedule,labels);labels.el?.remove();labels.el=null;}
 });
 const names=new Names();
 return{street,satellite,names,source};
}
