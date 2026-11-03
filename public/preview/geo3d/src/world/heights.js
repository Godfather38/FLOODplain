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
