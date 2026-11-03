// Water geometry from the saved SFINCS run, the way map and game engines draw water: the
// data is fixed and only the drawing varies. One quad per native 100 m cell carries the
// water surface; each pixel compares it with the 10 m lidar terrain from a texture, so the
// shoreline, the wet area and the volume are the same at every zoom.
import {GRID} from './run-data.js';
export const SHOW_DEPTH_M=.05;
const SUB=GRID.dx/GRID.sub;
// Cells where water stands at least SHOW_DEPTH_M over some 10 m sample in any frame.
export function wetCells({vertices,terrain},frames,threshold=SHOW_DEPTH_M){
 const out=[];
 for(let k=0;k<vertices.length;k++){
  let low=Infinity;for(let q=0;q<100;q++)low=Math.min(low,terrain[k*100+q]);
  if(frames.some(f=>f.surface[k]-low>threshold))out.push(k);
 }
 return out;
}
// The 10 m terrain of those cells packed 10 x 10 per cell into one float texture.
export function terrainAtlas(cells,{terrain}){
 const across=Math.ceil(Math.sqrt(cells.length)),size=across*GRID.sub,data=new Float32Array(size*size);
 cells.forEach((k,slot)=>{
  const ox=(slot%across)*GRID.sub,oy=Math.floor(slot/across)*GRID.sub;
  for(let r=0;r<GRID.sub;r++)for(let c=0;c<GRID.sub;c++)data[(oy+r)*size+ox+c]=terrain[k*100+r*GRID.sub+c];
 });
 return{data,size,across};
}
// toLocal(e,n) -> [x,y] in the renderer's frame. Per vertex: where the cell sits in the
// atlas, and the position inside the cell in 10 m subcells (0 to 10).
export function buildWaterMesh(cells,{vertices,terrain},toLocal,across){
 const n=cells.length,positions=new Float32Array(n*4*2),utm=new Float64Array(n*4*2),atlas=new Float32Array(n*4*2),inside=new Float32Array(n*4*2),top=new Float32Array(n*4),indices=new Uint32Array(n*6);
 cells.forEach((k,slot)=>{
  // The highest 10 m sample in the cell: where the zoomed-out summary sits, above coarse terrain.
  let high=-Infinity;for(let q=0;q<100;q++)high=Math.max(high,terrain[k*100+q]);top.fill(high,slot*4,slot*4+4);
  const m=vertices[k][4],row=vertices[k][3],ox=(slot%across)*GRID.sub,oy=Math.floor(slot/across)*GRID.sub;
  [[0,0],[1,0],[0,1],[1,1]].forEach(([c,r],corner)=>{
   const v=slot*4+corner,e=GRID.x0+(m+c)*GRID.dx,nn=GRID.y0+(row+r)*GRID.dx,[x,y]=toLocal(e,nn);
   positions[v*2]=x;positions[v*2+1]=y;utm[v*2]=e;utm[v*2+1]=nn;
   atlas[v*2]=ox;atlas[v*2+1]=oy;inside[v*2]=c*GRID.sub;inside[v*2+1]=r*GRID.sub;
  });
  const b=slot*4;indices.set([b,b+1,b+2,b+1,b+3,b+2],slot*6);
 });
 return{positions,utm,atlas,inside,top,indices,vertexCount:n*4,cells};
}
// Per-vertex surface for one frame (a cell corner blends the cells that have a level), and
// its downhill direction for the moving pattern. Unknown becomes far below ground.
export function frameSurface(mesh,sampler,frame){
 const n=mesh.vertexCount,surface=new Float32Array(n),flow=new Float32Array(n*2),d=50;
 for(let v=0;v<n;v++){
  const e=mesh.utm[v*2],nn=mesh.utm[v*2+1],z=sampler.surface(frame.surface,e,nn);
  surface[v]=Number.isNaN(z)?-1e5:z;
  const gx=sampler.surface(frame.surface,e+d,nn)-sampler.surface(frame.surface,e-d,nn),gy=sampler.surface(frame.surface,e,nn+d)-sampler.surface(frame.surface,e,nn-d),size=Math.hypot(gx,gy);
  if(size>1e-6&&Number.isFinite(size)){flow[v*2]=-gx/size;flow[v*2+1]=-gy/size;}
 }
 return{surface,flow};
}
// The share of each mesh cell's 10 m samples under visible water, for one frame. Zoomed out,
// that share is drawn over the whole cell instead of strips too thin to see: the same data,
// summarised. Four values per cell, one for each corner vertex.
export function wetShare(mesh,{vertices,terrain},sampler,frame,threshold=SHOW_DEPTH_M){
 const out=new Float32Array(mesh.vertexCount);
 mesh.cells.forEach((k,slot)=>{
  const m=vertices[k][4],row=vertices[k][3];let wet=0;
  for(let r=0;r<GRID.sub;r++)for(let c=0;c<GRID.sub;c++){
   const z=sampler.surface(frame.surface,GRID.x0+m*GRID.dx+(c+.5)*SUB,GRID.y0+row*GRID.dx+(r+.5)*SUB);
   if(z-terrain[k*100+r*GRID.sub+c]>threshold)wet++;
  }
  out.fill(wet/100,slot*4,slot*4+4);
 });
 return out;
}
// What one pixel of that drawing shows: the same bilinear surface and 10 m terrain the shader
// uses. Volume over a cell, from these, does not involve the view at all.
export function cellVolumeM3(k,{vertices,terrain},sampler,frame,threshold=SHOW_DEPTH_M){
 const m=vertices[k][4],row=vertices[k][3];let sum=0;
 for(let r=0;r<GRID.sub;r++)for(let c=0;c<GRID.sub;c++){
  const e=GRID.x0+m*GRID.dx+(c+.5)*SUB,nn=GRID.y0+row*GRID.dx+(r+.5)*SUB,depth=sampler.surface(frame.surface,e,nn)-terrain[k*100+r*GRID.sub+c];
  if(depth>threshold)sum+=depth*SUB*SUB;
 }
 return sum;
}
