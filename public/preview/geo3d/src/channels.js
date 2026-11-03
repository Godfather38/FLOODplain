// Picks a plausible-looking place for the cartoon water from the terrain's shape.
// This chooses where to draw flow. It is not a hydrologic or flood result.
import {inVisible} from './scene-config.js';
const NEIGHBOURS=[[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]];
const CARVE=1.1,MIN_DROP=.07,MIN_LENGTH=12,BANK=3,FEED_EVERY=6,START_DEPTH=.1;
export const SOURCE_RATES=Object.freeze({main:3.2,tributary:1.6});
export function coarseBed(heights,fine,grid,sample){
 const bed=new Float32Array(grid.nx*grid.nz);
 for(let j=0;j<grid.nz;j++)for(let i=0;i<grid.nx;i++)bed[j*grid.nx+i]=sample(heights,fine,grid.x0+i*grid.dx,grid.z0+j*grid.dz);
 return bed;
}
// Priority flood: visit cells lowest-first from the edge, so every cell gets a
// downhill-or-level route out and terrain pits cannot swallow the flow.
export function drainage(bed,{nx,nz}){
 const n=nx*nz,filled=new Float32Array(n),receiver=new Int32Array(n).fill(-1),seen=new Uint8Array(n),order=[],queue=[];
 for(let j=0;j<nz;j++)for(let i=0;i<nx;i++)if(i===0||j===0||i===nx-1||j===nz-1){const k=j*nx+i;filled[k]=bed[k];seen[k]=1;queue.push(k);}
 while(queue.length){
  let best=0;for(let q=1;q<queue.length;q++)if(filled[queue[q]]<filled[queue[best]])best=q;
  const c=queue[best];queue[best]=queue[queue.length-1];queue.pop();order.push(c);
  const ci=c%nx,cj=(c-ci)/nx;
  for(const [di,dj] of NEIGHBOURS){
   const i=ci+di,j=cj+dj;if(i<0||j<0||i>=nx||j>=nz)continue;
   const k=j*nx+i;if(seen[k])continue;
   seen[k]=1;filled[k]=Math.max(bed[k],filled[c]+1e-3);receiver[k]=c;queue.push(k);
  }
 }
 const area=new Float32Array(n).fill(1);
 for(let q=order.length-1;q>=0;q--){const k=order[q];if(receiver[k]>=0)area[receiver[k]]+=area[k];}
 return{filled,receiver,area};
}
function traceUpstream(start,{receiver,area},taken,minArea){
 const donors=new Map();
 receiver.forEach((r,k)=>{if(r>=0&&!taken.has(k)){if(!donors.has(r))donors.set(r,[]);donors.get(r).push(k);}});
 const path=[start];
 for(let c=start;;){
  const next=(donors.get(c)||[]).filter(k=>area[k]>=minArea).sort((a,b)=>area[b]-area[a])[0];
  if(next===undefined)break;path.push(next);c=next;
 }
 return path;
}
// The map layer passes {carve:0,confine:true,towards:{x,z}}. The map's own terrain cannot
// be cut, so water must sit on it, and raised solver banks hold it in the channel instead.
export function pickChannels(bed,grid,maxTributaries=2,{carve=CARVE,minDrop=MIN_DROP,confine=false,towards=null}={}){
 const d=drainage(bed,grid),{nx,nz,x0,z0,dx,dz}=grid,xy=k=>({x:x0+(k%nx)*dx,z:z0+Math.floor(k/nx)*dz});
 // Score by the height the water falls. The biggest catchment here runs along the
 // flat valley floor, where a coarse grid can only draw a wide, shapeless sheet.
 const taken=new Set();let main=[],bestDrop=-1;
 for(let k=0;k<nx*nz;k++){
  const i=k%nx,j=(k-i)/nx;if(!(i===0||j===0||i===nx-1||j===nz-1))continue;
  const cells=traceUpstream(k,d,taken,2);let score=d.filled[cells.at(-1)]-d.filled[k];
  if(towards){let near=Infinity;for(const c of cells){const p=xy(c);near=Math.min(near,Math.hypot(p.x-towards.x,p.z-towards.z));}score/=1+near/10;}
  if(cells.length>=MIN_LENGTH&&score>bestDrop){main=cells;bestDrop=score;}
 }
 main.forEach(k=>taken.add(k));
 const candidates=[];
 for(const c of main)d.receiver.forEach((r,k)=>{if(r===c&&!taken.has(k)&&d.area[k]>=6)candidates.push(k);});
 candidates.sort((a,b)=>d.area[b]-d.area[a]);
 const paths=[{cells:main,rate:SOURCE_RATES.main}];
 for(const start of candidates){
  if(paths.length>maxTributaries)break;if(taken.has(start))continue;
  const cells=traceUpstream(start,d,taken,3);
  if(cells.length<5)continue;
  cells.forEach(k=>taken.add(k));
  cells.unshift(d.receiver[start]);
  paths.push({cells,rate:SOURCE_RATES.tributary});
 }
 // Water starts where it can be seen, not in the hidden margin of the grid.
 for(const path of paths)while(path.cells.length>2&&!inVisible(xy(path.cells.at(-1)).x,xy(path.cells.at(-1)).z))path.cells.pop();
 if(main.length<MIN_LENGTH)throw new Error('No channel long enough in this area');
 const carved=Float32Array.from(d.filled),lines=[];
 for(const {cells} of paths){
  let level=Infinity;const line=[];
  for(let q=cells.length-1;q>=0;q--){
   const k=cells[q];
   level=Math.min(level-minDrop,d.filled[k]-carve);
   carved[k]=Math.min(carved[k],level);
   line.push({...xy(k),level});
  }
  lines.push(line);
 }
 for(const {cells} of paths)for(const k of cells){
  const i=k%nx,j=(k-i)/nx;
  for(const [di,dj] of NEIGHBOURS.slice(0,4)){const a=i+di,b=j+dj;if(a<0||b<0||a>=nx||b>=nz)continue;const q=b*nx+a;if(!taken.has(q))carved[q]=Math.min(carved[q],carved[k]+.3);}
 }
 if(confine){
  const band=new Set();
  for(const {cells} of paths)for(const k of cells){band.add(k);const i=k%nx,j=(k-i)/nx;for(const [di,dj] of NEIGHBOURS.slice(0,4)){const a=i+di,b=j+dj;if(a>=0&&b>=0&&a<nx&&b<nz)band.add(b*nx+a);}}
  for(let k=0;k<nx*nz;k++)if(!band.has(k))carved[k]+=BANK;
 }
 return{bed:carved,paths,lines,sources:paths.map(p=>({cell:p.cells.at(-1),rate:p.rate}))};
}
// Solver setup from stream lines already cut into the terrain: {x,z,level} points running
// downstream. Only cells along the lines can hold water; every other cell is a raised bank.
export function channelsFromLines(lines,heights,fine,grid,sample,sizes){
 const {nx,nz,x0,z0,dx,dz}=grid,bed=new Float32Array(nx*nz),band=new Uint8Array(nx*nz),sources=[];
 for(let j=0;j<nz;j++)for(let i=0;i<nx;i++)bed[j*nx+i]=sample(heights,fine,x0+i*dx,z0+j*dz)+BANK;
 const cellAt=(x,z)=>{const i=Math.max(0,Math.min(nx-1,Math.round((x-x0)/dx))),j=Math.max(0,Math.min(nz-1,Math.round((z-z0)/dz)));return{i,j};};
 // Three cells wide with a level floor. The shader blends depth between cells, so beside a
 // one-cell channel the depth turns negative within metres and the water breaks into pieces.
 const lowerCell=(i,j,level)=>{if(i<0||j<0||i>=nx||j>=nz)return;const k=j*nx+i;bed[k]=band[k]?Math.min(bed[k],level):level;band[k]=1;};
 const lower=(i,j,level)=>{for(let dj=-1;dj<=1;dj++)for(let di=-1;di<=1;di++)lowerCell(i+di,j+dj,level);};
 lines.forEach((line,index)=>{
  let previous=null,rate=0,sinceSource=0;
  for(const p of line){
   const c=cellAt(p.x,p.z);
   // Walk one axis at a time: the solver only passes water between edge-sharing cells.
   if(previous){let {i,j}=previous;while(i!==c.i||j!==c.j){if(i!==c.i)i+=Math.sign(c.i-i);else j+=Math.sign(c.j-j);lower(i,j,p.level);}}
   else{lower(c.i,c.j,p.level);rate=Math.min(SOURCE_RATES.main,SOURCE_RATES.tributary*(1+Math.log2(1+(sizes?.[index]??1)/900)));sources.push({cell:c.j*nx+c.i,rate});}
   // A wet front crawls on flat ground, so inflow also joins along the channel's length.
   if(previous&&++sinceSource>=FEED_EVERY){sinceSource=0;sources.push({cell:c.j*nx+c.i,rate:rate*.5});}
   previous=c;
  }
 });
 // Channels start out wet: the far end would otherwise stay dry for minutes after loading.
 const fill=new Float32Array(nx*nz);
 for(let k=0;k<nx*nz;k++)if(band[k])fill[k]=START_DEPTH;
 return{bed,sources,fill};
}
// The height the toon shader compares water against. It shows water only above this, so a
// trough along the channel clips the water to a ribbon without editing the map's terrain.
export function ribbonMask(heights,fine,lines,halfWidth=2.5,rise=1.2){
 const out=new Float32Array(heights.length);
 for(let j=0;j<fine.nz;j++)for(let i=0;i<fine.nx;i++){
  const x=fine.x0+i*fine.dx,z=fine.z0+j*fine.dz,k=j*fine.nx+i;
  let near=Infinity,level=0;
  for(const line of lines)for(let q=1;q<line.length;q++){
   const a=line[q-1],b=line[q],dx=b.x-a.x,dz=b.z-a.z,t=Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.z)*dz)/(dx*dx+dz*dz))),d=(a.x+dx*t-x)**2+(a.z+dz*t-z)**2;
   if(d<near){near=d;level=a.level+(b.level-a.level)*t;}
  }
  const s=Math.sqrt(near)/halfWidth;
  out[k]=near===Infinity?heights[k]+9:level-.15+s*s*rise+(s>1.6?9:0);
 }
 return out;
}
// Cuts the same channels into the fine visible terrain so water and banks agree.
// The banks must rise past the water inside its coarse cells: then the fine terrain
// shapes the water's edge, not the solver's stair-stepped wet/dry cell boundary.
export function carveFine(heights,fine,lines,halfWidth=1.6,bank=1.6,floor=.2){
 const out=Float32Array.from(heights);
 for(let j=0;j<fine.nz;j++)for(let i=0;i<fine.nx;i++){
  const x=fine.x0+i*fine.dx,z=fine.z0+j*fine.dz;
  let near=Infinity,level=0;
  // Height runs smoothly along each segment; a per-cell height leaves terraces.
  for(const line of lines)for(let q=1;q<line.length;q++){
   const a=line[q-1],b=line[q],dx=b.x-a.x,dz=b.z-a.z,t=Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.z)*dz)/(dx*dx+dz*dz))),d=(a.x+dx*t-x)**2+(a.z+dz*t-z)**2;
   if(d<near){near=d;level=a.level+(b.level-a.level)*t-floor;}
  }
  const distance=Math.sqrt(near);if(distance>=halfWidth+bank)continue;
  const t=Math.min(1,Math.max(0,(halfWidth+bank-distance)/bank)),w=t*t*(3-2*t),k=j*fine.nx+i;
  out[k]+=(Math.min(out[k],level)-out[k])*w;
 }
 return out;
}
