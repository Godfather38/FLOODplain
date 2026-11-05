// OpenFreeMap vector tiles, decoded once and kept, with geometry turned into world metres.
// A tile is a few kilometres across, where UTM is almost linear, so four corner conversions
// place every point in it to well under a metre.
import {VectorTile,classifyRings} from '../../vendor/vector-tile/index.js';
import {PbfReader} from '../../vendor/pbf/index.js';
import {toUtm} from '../utm.js';
import {toWorld} from './heights.js';
let template=null;
const cache=new Map();
async function urlFor(z,x,y){
 template??=fetch('https://tiles.openfreemap.org/planet').then(r=>{if(!r.ok)throw new Error('Map tiles answered '+r.status);return r.json();}).then(j=>j.tiles[0]);
 return(await template).replace('{z}',z).replace('{x}',x).replace('{y}',y);
}
const lonOf=(x,z)=>x/2**z*360-180,latOf=(y,z)=>Math.atan(Math.sinh(Math.PI*(1-2*y/2**z)))*180/Math.PI;
export function tileRange(x0,z0,x1,z1,zoom,toLonLat){
 const a=toLonLat(x0,z0),b=toLonLat(x1,z1),n=2**zoom,col=lon=>Math.floor((lon+180)/360*n),row=lat=>{const r=lat*Math.PI/180;return Math.floor((1-Math.log(Math.tan(r)+1/Math.cos(r))/Math.PI)/2*n);};
 const out=[];
 for(let y=row(Math.max(a.lat,b.lat));y<=row(Math.min(a.lat,b.lat));y++)for(let x=col(Math.min(a.lon,b.lon));x<=col(Math.max(a.lon,b.lon));x++)out.push({z:zoom,x,y});
 return out;
}
// Resolves to {layers:{name:[{type,properties,parts:[[[x,z],...]],polygons}]}} in world metres.
export function loadVectorTile({z,x,y}){
 const key=`${z}/${x}/${y}`;
 if(!cache.has(key))cache.set(key,(async()=>{
  const response=await fetch(await urlFor(z,x,y));
  if(!response.ok)throw new Error(`Map tile ${key} answered ${response.status}`);
  const tile=new VectorTile(new PbfReader(new Uint8Array(await response.arrayBuffer())));
  const corner=(cx,cy)=>{const u=toUtm(lonOf(x+cx,z),latOf(y+cy,z));return toWorld(u.e,u.n);};
  const c00=corner(0,0),c10=corner(1,0),c01=corner(0,1),c11=corner(1,1);
  const layers={};
  for(const [name,layer] of Object.entries(tile.layers)){
   const extent=layer.extent,place=p=>{const u=p.x/extent,v=p.y/extent;return[(c00[0]*(1-u)+c10[0]*u)*(1-v)+(c01[0]*(1-u)+c11[0]*u)*v,(c00[1]*(1-u)+c10[1]*u)*(1-v)+(c01[1]*(1-u)+c11[1]*u)*v];};
   const features=[];
   for(let i=0;i<layer.length;i++){
    const f=layer.feature(i),geometry=f.loadGeometry();
    features.push({type:f.type,properties:f.properties,parts:geometry.map(ring=>ring.map(place)),polygons:f.type===3?classifyRings(geometry).map(poly=>poly.map(ring=>ring.map(place))):null});
   }
   layers[name]=features;
  }
  return{layers,key};
 })());
 return cache.get(key);
}
// Esri World Imagery, the satellite view the app's 2D map offers, with each tile's corners in
// world metres so it can be drawn into a chunk with one affine transform.
const imagery=new Map();
export function loadImageryTile({z,x,y}){
 const key=`${z}/${x}/${y}`;
 if(!imagery.has(key))imagery.set(key,(async()=>{
  const response=await fetch(`https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`);
  if(!response.ok)throw new Error(`Imagery tile ${key} answered ${response.status}`);
  const image=await createImageBitmap(await response.blob());
  const corner=(cx,cy)=>{const u=toUtm(lonOf(x+cx,z),latOf(y+cy,z));return toWorld(u.e,u.n);};
  return{image,nw:corner(0,0),ne:corner(1,0),sw:corner(0,1),key};
 })());
 return imagery.get(key);
}
