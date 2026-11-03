// One height field for everything: the model's own 10 m lidar wherever the model has a cell,
// public elevation tiles in the model rectangle's empty corners. Ground, water, roads, bridges
// and buildings all read this same field, so nothing can sit on a different ground.
import {GRID} from '../run-data.js';
import {fromUtm} from '../utm.js';
import {loadTile} from '../data-source.js';
export const STEP=GRID.dx/GRID.sub,W=GRID.mmax*GRID.sub,H=GRID.nmax*GRID.sub;
export const SIZE_X=W*STEP,SIZE_Z=H*STEP,E0=GRID.x0+SIZE_X/2,N0=GRID.y0+SIZE_Z/2;
// World metres: x east, y up, z south, centred on the model rectangle.
export const toWorld=(e,n)=>[e-E0,-(n-N0)];
export const worldToUtm=(x,z)=>({e:x+E0,n:N0-z});
const TILE=256,FILL_ZOOM=12;
const worldPixel=(lon,lat,z)=>{const n=TILE*2**z,r=lat*Math.PI/180;return[(lon+180)/360*n,(1-Math.log(Math.tan(r)+1/Math.cos(r))/Math.PI)/2*n];};
async function fillGrid(){
 // Public elevation at every 100 m cell corner, for corners of the rectangle the model leaves empty.
 const cols=GRID.mmax+1,rows=GRID.nmax+1,corners=[];
 for(let j=0;j<rows;j++)for(let i=0;i<cols;i++)corners.push(fromUtm(GRID.x0+i*GRID.dx,GRID.y0+j*GRID.dx));
 const pixels=corners.map(c=>worldPixel(c.lon,c.lat,FILL_ZOOM)),need=new Map();
 for(const [px,py] of pixels){const x=Math.floor(px/TILE),y=Math.floor(py/TILE);for(const [a,b] of [[x,y],[x+1,y],[x,y+1],[x+1,y+1]])need.set(a+'/'+b,{z:FILL_ZOOM,x:a,y:b});}
 const tiles=new Map((await Promise.all([...need.values()].map(loadTile))).map(t=>[t.x+'/'+t.y,t.rgba]));
 const at=(px,py)=>{const t=tiles.get(Math.floor(px/TILE)+'/'+Math.floor(py/TILE)),k=((py%TILE)*TILE+(px%TILE))*4;return t[k]*256+t[k+1]+t[k+2]/256-32768;};
 return Float32Array.from(pixels,([px,py])=>{const i=Math.floor(px),j=Math.floor(py),a=px-i,b=py-j;return(at(i,j)*(1-a)+at(i+1,j)*a)*(1-b)+(at(i,j+1)*(1-a)+at(i+1,j+1)*a)*b;});
}
export async function buildHeights({vertices,terrain},{fill:makeFill=fillGrid}={}){
 const h=new Float32Array(W*H).fill(NaN);
 vertices.forEach((v,k)=>{const m=v[4],n=v[3];for(let r=0;r<GRID.sub;r++)for(let c=0;c<GRID.sub;c++)h[(n*GRID.sub+r)*W+m*GRID.sub+c]=terrain[k*100+r*GRID.sub+c];});
 const fill=await makeFill(),cols=GRID.mmax+1;let filled=0;
 for(let j=0;j<H;j++){const fy=(j+.5)/GRID.sub,cy=Math.min(GRID.nmax-1,Math.floor(fy)),b=fy-cy;for(let i=0;i<W;i++){
  const q=j*W+i;if(!Number.isNaN(h[q]))continue;
  const fx=(i+.5)/GRID.sub,cx=Math.min(GRID.mmax-1,Math.floor(fx)),a=fx-cx,k=cy*cols+cx;
  h[q]=(fill[k]*(1-a)+fill[k+1]*a)*(1-b)+(fill[k+cols]*(1-a)+fill[k+cols+1]*a)*b;filled++;
 }}
 return{heights:h,filled};
}
// Ground height in real metres at a world position, the same bilinear blend the shader uses.
export function groundSampler(h){
 return(x,z)=>{
  const u=Math.min(W-1.001,Math.max(0,(x+SIZE_X/2)/STEP-.5)),v=Math.min(H-1.001,Math.max(0,(SIZE_Z/2-z)/STEP-.5)),i=Math.floor(u),j=Math.floor(v),a=u-i,b=v-j,k=j*W+i;
  return(h[k]*(1-a)+h[k+1]*a)*(1-b)+(h[k+W]*(1-a)+h[k+W+1]*a)*b;
 };
}
// The model's water level on its own 100 m grid for one frame; missing is far below ground.
export function levelGrid(frame,vertices){
 const g=new Float32Array(GRID.mmax*GRID.nmax).fill(-1e5);
 vertices.forEach((v,k)=>{const z=frame.surface[k];if(!Number.isNaN(z))g[v[3]*GRID.mmax+v[4]]=z;});
 return g;
}
// Each model cell's share of its 10 m samples under water deeper than the display limit, for
// one frame: what is shown when the view is too far out to see individual 10 m samples.
export function shareGrid(frame,{vertices,terrain},show){
 const g=new Float32Array(GRID.mmax*GRID.nmax).fill(-2),levels=levelGrid(frame,vertices),cell=(m,n)=>m<0||n<0||m>=GRID.mmax||n>=GRID.nmax?-1e5:levels[n*GRID.mmax+m];
 vertices.forEach((v,k)=>{
  const m=v[4],n=v[3];if(cell(m,n)<-1e4)return;let wet=0;
  for(let r=0;r<GRID.sub;r++)for(let c=0;c<GRID.sub;c++){
   // The same blend between cell centres the shader uses.
   const fx=(c+.5)/GRID.sub-.5,fy=(r+.5)/GRID.sub-.5,i=fx<0?m-1:m,j=fy<0?n-1:n,a=fx<0?fx+1:fx,b=fy<0?fy+1:fy;
   let sum=0,weight=0;for(const [di,dj,w] of [[0,0,(1-a)*(1-b)],[1,0,a*(1-b)],[0,1,(1-a)*b],[1,1,a*b]]){const z=cell(i+di,j+dj);if(z>-1e4&&w>0){sum+=z*w;weight+=w;}}
   if(weight>0&&sum/weight-terrain[k*100+r*GRID.sub+c]>show)wet++;
  }
  g[n*GRID.mmax+m]=wet/100;
 });
 return g;
}
// The model water level at a world position, the same blend the shader uses: bilinear between
// 100 m cell centres, leaving out cells with no level. NaN when nothing is known there.
export function levelSampler(levels){
 return(x,z)=>{
  const u=(x+SIZE_X/2)/GRID.dx-.5,v=(SIZE_Z/2-z)/GRID.dx-.5,i=Math.max(0,Math.min(GRID.mmax-2,Math.floor(u))),j=Math.max(0,Math.min(GRID.nmax-2,Math.floor(v))),a=Math.min(1,Math.max(0,u-i)),b=Math.min(1,Math.max(0,v-j));
  let sum=0,weight=0;
  for(const [di,dj,w] of [[0,0,(1-a)*(1-b)],[1,0,a*(1-b)],[0,1,(1-a)*b],[1,1,a*b]]){const z0=levels[(j+dj)*GRID.mmax+i+di];if(z0>-1e4&&w>0){sum+=z0*w;weight+=w;}}
  return weight>1e-4?sum/weight:NaN;
 };
}
// Whether the model has a cell at a world position. The model's rectangle has corners and
// edges it does not compute; crossings there are outside the model, not dry.
export function modelCells(vertices){
 const active=new Uint8Array(GRID.mmax*GRID.nmax);for(const v of vertices)active[v[3]*GRID.mmax+v[4]]=1;
 return(x,z)=>{const u=worldToUtm(x,z),m=Math.floor((u.e-GRID.x0)/GRID.dx),n=Math.floor((u.n-GRID.y0)/GRID.dx);return m>=0&&n>=0&&m<GRID.mmax&&n<GRID.nmax&&active[n*GRID.mmax+m]===1;};
}
