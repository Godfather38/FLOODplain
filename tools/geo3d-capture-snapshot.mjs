// Development only. Freezes one copy of the 3D prototype's live inputs into dev/,
// which sits outside public/ and so is never published.
// Usage: node tools/geo3d-capture-snapshot.mjs [name]
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {inflateSync} from 'node:zlib';
import {tilesForScene,tileUrl,elevationGrid} from '../public/preview/geo3d/src/elevation.js';
import {inVisible,project} from '../public/preview/geo3d/src/scene-config.js';

// Terrarium tiles are plain 8-bit RGB or RGBA PNGs, so a small decoder avoids a dependency.
export function decodePng(buffer){
 let at=8,width=0,height=0,channels=0;const parts=[];
 while(at<buffer.length){
  const size=buffer.readUInt32BE(at),type=buffer.toString('latin1',at+4,at+8),body=buffer.subarray(at+8,at+8+size);
  if(type==='IHDR'){
   width=body.readUInt32BE(0);height=body.readUInt32BE(4);channels={2:3,6:4}[body[9]];
   if(body[8]!==8||!channels||body[12])throw new Error('Unexpected PNG format');
  }else if(type==='IDAT')parts.push(body);
  at+=12+size;
 }
 const raw=inflateSync(Buffer.concat(parts)),rgba=new Uint8Array(width*height*4),stride=width*channels,row=new Uint8Array(stride);
 let previous=new Uint8Array(stride);
 for(let y=0;y<height;y++){
  const start=y*(stride+1),filter=raw[start];
  for(let x=0;x<stride;x++){
   const a=x>=channels?row[x-channels]:0,b=previous[x],c=x>=channels?previous[x-channels]:0,p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);
   const predict=[0,a,b,(a+b)>>1,pa<=pb&&pa<=pc?a:pb<=pc?b:c][filter];
   row[x]=raw[start+1+x]+predict;
  }
  for(let x=0;x<width;x++){const k=(y*width+x)*4;rgba[k]=row[x*channels];rgba[k+1]=row[x*channels+1];rgba[k+2]=row[x*channels+2];rgba[k+3]=channels===4?row[x*4+3]:255;}
  previous=row.slice();
 }
 return{width,height,rgba};
}
if(import.meta.url===pathToFileURL(process.argv[1]).href){
 const name=process.argv[2]||'gates-pass';
 const tiles=await Promise.all(tilesForScene().map(async({z,x,y})=>{
  const response=await fetch(tileUrl(z,x,y));
  if(!response.ok)throw new Error(`Tile ${z}/${x}/${y} answered ${response.status}`);
  return{x,y,rgba:decodePng(Buffer.from(await response.arrayBuffer())).rgba};
 }));
 const metres=elevationGrid(tiles);
 const routes=JSON.parse(readFileSync(new URL('../public/data/routes.geojson',import.meta.url),'utf8'));
 const crosses=f=>(f.geometry.type==='MultiLineString'?f.geometry.coordinates.flat():f.geometry.coordinates).some(([lon,lat])=>{const p=project(lon,lat);return inVisible(p.x,p.z);});
 mkdirSync(new URL('../dev/geo3d-snapshots/',import.meta.url),{recursive:true});
 writeFileSync(new URL(`../dev/geo3d-snapshots/${name}.json`,import.meta.url),JSON.stringify({
  capturedAt:new Date().toISOString().slice(0,10),
  metres:Buffer.from(metres.buffer).toString('base64'),
  routes:{type:'FeatureCollection',features:routes.features.filter(crosses)},
 }));
 console.log(`dev/geo3d-snapshots/${name}.json: ${tiles.length} tiles, ${metres.length} heights, ${Math.min(...metres).toFixed(0)}-${Math.max(...metres).toFixed(0)} m`);
}
