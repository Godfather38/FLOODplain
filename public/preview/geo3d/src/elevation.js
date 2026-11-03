// Web-mercator tile arithmetic and Terrarium decoding, shared by the page and
// the development snapshot tool. Terrarium PNG: metres = R*256 + G + B/256 - 32768.
import {SCENE,fineGrid,unproject,demZoomForPlace} from './scene-config.js';
const TILE=256;
export const tileUrl=(z,x,y)=>`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
const worldPixel=(lon,lat,z)=>{const n=TILE*2**z,r=lat*Math.PI/180;return{px:(lon+180)/360*n,py:(1-Math.log(Math.tan(r)+1/Math.cos(r))/Math.PI)/2*n};};
export function tilesForScene(z=demZoomForPlace()){
 const g=fineGrid(),a=unproject(g.x0,g.z0),b=unproject(g.x0+(g.nx-1)*g.dx,g.z0+(g.nz-1)*g.dz);
 const nw=worldPixel(a.lon,b.lat,z),se=worldPixel(b.lon,a.lat,z),out=[];
 // One pixel of margin keeps bilinear sampling inside the fetched tiles.
 for(let y=Math.floor((nw.py-1)/TILE);y<=Math.floor((se.py+1)/TILE);y++)for(let x=Math.floor((nw.px-1)/TILE);x<=Math.floor((se.px+1)/TILE);x++)out.push({z,x,y});
 return out;
}
// tiles: [{x,y,rgba}] with rgba a 256 x 256 x 4 byte array.
export function elevationGrid(tiles,z=demZoomForPlace()){
 const lookup=new Map(tiles.map(t=>[`${t.x}/${t.y}`,t.rgba]));
 const at=(px,py)=>{
  const rgba=lookup.get(`${Math.floor(px/TILE)}/${Math.floor(py/TILE)}`);
  if(!rgba)throw new Error('Elevation tile missing for this area');
  const k=((py%TILE)*TILE+(px%TILE))*4;
  return rgba[k]*256+rgba[k+1]+rgba[k+2]/256-32768;
 };
 const g=fineGrid(),metres=new Float32Array(g.nx*g.nz);
 for(let j=0;j<g.nz;j++)for(let i=0;i<g.nx;i++){
  const {lon,lat}=unproject(g.x0+i*g.dx,g.z0+j*g.dz),{px,py}=worldPixel(lon,lat,z);
  const ix=Math.floor(px),iy=Math.floor(py),a=px-ix,b=py-iy;
  metres[j*g.nx+i]=(at(ix,iy)*(1-a)+at(ix+1,iy)*a)*(1-b)+(at(ix,iy+1)*(1-a)+at(ix+1,iy+1)*a)*b;
 }
 return metres;
}
export function sceneHeights(metres){
 let low=Infinity;for(const m of metres)low=Math.min(low,m);
 return Float32Array.from(metres,m=>SCENE.baseHeight+(m-low)/SCENE.metresPerUnit*SCENE.verticalExaggeration);
}
export function sampleHeights(heights,grid,x,z){
 const fx=Math.max(0,Math.min(grid.nx-1.001,(x-grid.x0)/grid.dx)),fz=Math.max(0,Math.min(grid.nz-1.001,(z-grid.z0)/grid.dz));
 const i=fx|0,j=fz|0,a=fx-i,b=fz-j,k=j*grid.nx+i;
 return (heights[k]*(1-a)+heights[k+1]*a)*(1-b)+(heights[k+grid.nx]*(1-a)+heights[k+grid.nx+1]*a)*b;
}
