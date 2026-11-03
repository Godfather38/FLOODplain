// The saved SFINCS run from Test flood mode: its 100 m grid, hourly water surfaces (zs,
// NAVD88) and the 10 m lidar terrain inside each cell that the model itself used.
// Nothing here is made up or smoothed for looks; missing water levels stay missing.
import {toUtm} from './utm.js';
export const GRID=Object.freeze({x0:467700,y0:3572300,dx:100,mmax:320,nmax:346,sub:10});
const SUB=GRID.dx/GRID.sub;
export function buildIndex(vertices){
 const at=new Int32Array(GRID.mmax*GRID.nmax).fill(-1);
 vertices.forEach((v,k)=>{at[v[3]*GRID.mmax+v[4]]=k;});
 return at;
}
// data: {vertices,frames:[{time,surface:Float32Array (NaN = missing)}],terrain:Float32Array}
export function makeSampler({vertices,terrain},index=buildIndex(vertices)){
 const cellOf=(m,n)=>m<0||n<0||m>=GRID.mmax||n>=GRID.nmax?-1:index[n*GRID.mmax+m];
 // One 10 m terrain sample, by global subcell column and row (south to north, west to east).
 const sub=(si,sj)=>{
  const k=cellOf(Math.floor(si/GRID.sub),Math.floor(sj/GRID.sub));
  if(k<0)return NaN;
  return terrain[k*100+(((sj%GRID.sub)+GRID.sub)%GRID.sub)*GRID.sub+((si%GRID.sub)+GRID.sub)%GRID.sub];
 };
 // Bilinear between subcell centres. Outside the case it is NaN, never invented.
 const ground=(e,n)=>{
  const fi=(e-GRID.x0)/SUB-.5,fj=(n-GRID.y0)/SUB-.5,i=Math.floor(fi),j=Math.floor(fj),u=fi-i,v=fj-j;
  let sum=0,weight=0;
  for(const [di,dj,w] of [[0,0,(1-u)*(1-v)],[1,0,u*(1-v)],[0,1,(1-u)*v],[1,1,u*v]]){const z=sub(i+di,j+dj);if(!Number.isNaN(z)&&w>0){sum+=z*w;weight+=w;}}
  return weight>0?sum/weight:NaN;
 };
 // Water surface between native cell centres. Cells with no water level are left out of the
 // blend; with none at all the answer is NaN (unknown), not dry.
 const surface=(zs,e,n)=>{
  const fi=(e-GRID.x0)/GRID.dx-.5,fj=(n-GRID.y0)/GRID.dx-.5,i=Math.floor(fi),j=Math.floor(fj),u=fi-i,v=fj-j;
  let sum=0,weight=0;
  for(const [di,dj,w] of [[0,0,(1-u)*(1-v)],[1,0,u*(1-v)],[0,1,(1-u)*v],[1,1,u*v]]){const k=cellOf(i+di,j+dj);if(k<0||w<=0)continue;const z=zs[k];if(Number.isNaN(z))continue;sum+=z*w;weight+=w;}
  return weight>0?sum/weight:NaN;
 };
 const cellAt=(e,n)=>cellOf(Math.floor((e-GRID.x0)/GRID.dx),Math.floor((n-GRID.y0)/GRID.dx));
 return{ground,surface,cellAt,cellOf,sub,groundAtLonLat:(lon,lat)=>{const u=toUtm(lon,lat);return ground(u.e,u.n);}};
}
export function parseFrames(display){
 return display.waterFrames.map(f=>({time:f.time,surface:Float32Array.from(f.surfaceM,z=>z==null?NaN:z)}));
}
