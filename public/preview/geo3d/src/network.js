// A drainage network for the whole covered area, worked out from live elevation. It
// carves channels into the map's terrain and tells the water where to run. This is a
// picture of where water would tend to collect, not a hydrologic or flood result.
const NEIGHBOURS=[[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]];
export const STREAM_CELLS=1200;
const smooth=t=>{const c=Math.max(0,Math.min(1,t));return c*c*(3-2*c);};
// Lowest-first visits from the edge, so every cell drains out and pits cannot trap flow.
export function drainageNetwork(metres,w,h){
 const n=w*h,filled=new Float32Array(n),receiver=new Int32Array(n).fill(-1),seen=new Uint8Array(n),order=new Int32Array(n),heap=new Int32Array(n);
 let size=0,visited=0;
 const push=k=>{let i=size++;heap[i]=k;while(i>0){const p=(i-1)>>1;if(filled[heap[p]]<=filled[heap[i]])break;[heap[p],heap[i]]=[heap[i],heap[p]];i=p;}};
 const pop=()=>{const top=heap[0];heap[0]=heap[--size];let i=0;for(;;){const a=2*i+1,b=a+1;let m=i;if(a<size&&filled[heap[a]]<filled[heap[m]])m=a;if(b<size&&filled[heap[b]]<filled[heap[m]])m=b;if(m===i)break;[heap[m],heap[i]]=[heap[i],heap[m]];i=m;}return top;};
 for(let j=0;j<h;j++)for(let i=0;i<w;i++)if(i===0||j===0||i===w-1||j===h-1){const k=j*w+i;filled[k]=metres[k];seen[k]=1;push(k);}
 while(size){
  const c=pop();order[visited++]=c;
  const ci=c%w,cj=(c-ci)/w;
  for(const [di,dj] of NEIGHBOURS){
   const i=ci+di,j=cj+dj;if(i<0||j<0||i>=w||j>=h)continue;
   const k=j*w+i;if(seen[k])continue;
   seen[k]=1;filled[k]=Math.max(metres[k],filled[c]+.01);receiver[k]=c;push(k);
  }
 }
 const area=new Float32Array(n).fill(1);
 for(let q=n-1;q>=0;q--){const k=order[q];if(receiver[k]>=0)area[receiver[k]]+=area[k];}
 return{w,h,filled,receiver,area,order};
}
// On a smooth slope, flow routed cell to cell runs in dead-straight parallel lines. A little
// fixed wander in the heights used for routing lets channels meander. The map never sees it.
export function withWander(metres,w,h){
 const hash=(x,y)=>{let v=Math.imul(x,374761393)+Math.imul(y,668265263);v=Math.imul(v^(v>>>13),1274126177);return((v^(v>>>16))>>>0)/4294967295;};
 const value=(x,y)=>{const i=Math.floor(x),j=Math.floor(y);let a=x-i,b=y-j;a=a*a*(3-2*a);b=b*b*(3-2*b);return(hash(i,j)*(1-a)+hash(i+1,j)*a)*(1-b)+(hash(i,j+1)*(1-a)+hash(i+1,j+1)*a)*b;};
 const out=new Float32Array(w*h);
 for(let j=0;j<h;j++)for(let i=0;i<w;i++)out[j*w+i]=metres[j*w+i]+value(i/14,j/14)*7+value(i/5+40,j/5+9)*3;
 return out;
}
const blur=(field,w,h)=>{
 const out=new Float32Array(field.length);
 for(let j=0;j<h;j++)for(let i=0;i<w;i++){
  let sum=0,count=0;
  for(let dj=-1;dj<=1;dj++)for(let di=-1;di<=1;di++){const a=i+di,b=j+dj;if(a>=0&&b>=0&&a<w&&b<h){sum+=field[b*w+a];count++;}}
  out[j*w+i]=sum/count;
 }
 return out;
};
// How deep to cut at each cell. Bigger washes are deeper and wider, and banks taper off.
// ground is the real height. Channels are routed on slightly different heights, so real
// ground can rise along one; each floor is cut to keep running downhill all the way.
export function carveField(net,ground=net.filled,threshold=STREAM_CELLS){
 const {w,h,area,order,receiver}=net,depth=new Float32Array(w*h),incoming=new Float32Array(w*h).fill(Infinity),floor=new Float32Array(w*h);
 for(let q=w*h-1;q>=0;q--){
  const k=order[q];if(area[k]<threshold)continue;
  const size=Math.log2(area[k]/threshold);
  floor[k]=Math.min(ground[k]-Math.min(36,22+4*size),incoming[k]-.02);
  const r=receiver[k];if(r>=0&&floor[k]<incoming[r])incoming[r]=floor[k];
 }
 for(let k=0;k<w*h;k++){
  if(area[k]<threshold)continue;
  const size=Math.log2(area[k]/threshold),D=ground[k]-floor[k],R=Math.min(3.4,1.7+.5*size),ci=k%w,cj=(k-ci)/w,reach=Math.ceil(R);
  for(let dj=-reach;dj<=reach;dj++)for(let di=-reach;di<=reach;di++){
   const i=ci+di,j=cj+dj;if(i<0||j<0||i>=w||j>=h)continue;
   // A flat floor, then banks: the water needs a level bed to sit on continuously.
   const q=j*w+i,cut=D*(1-smooth((Math.hypot(di,dj)/R-.45)/.55));
   if(cut>depth[q])depth[q]=cut;
  }
 }
 return blur(depth,w,h);
}
export const sampleField=(field,w,h,fx,fy)=>{
 if(fx<0||fy<0||fx>=w-1||fy>=h-1)return 0;
 const i=fx|0,j=fy|0,a=fx-i,b=fy-j,k=j*w+i;
 return (field[k]*(1-a)+field[k+1]*a)*(1-b)+(field[k+w]*(1-a)+field[k+w+1]*a)*b;
};
// Stream chains inside a box, upstream first, largest first.
export function streamChains(net,inside,{threshold=STREAM_CELLS,minCells=6,maxChains=6}={}){
 const {w,h,area,receiver}=net,isStream=k=>area[k]>=threshold&&inside(k),hasDonor=new Uint8Array(w*h),done=new Uint8Array(w*h),chains=[];
 for(let k=0;k<w*h;k++)if(isStream(k)&&receiver[k]>=0)hasDonor[receiver[k]]=1;
 const heads=[];for(let k=0;k<w*h;k++)if(isStream(k)&&!hasDonor[k])heads.push(k);
 heads.sort((a,b)=>area[b]-area[a]);
 const all=[];
 for(const head of heads){
  const cells=[];let c=head,joins=-1;
  while(c>=0&&isStream(c)){if(done[c]){joins=c;break;}done[c]=1;cells.push(c);c=receiver[c];}
  if(joins>=0)cells.push(joins);
  if(cells.length>=minCells)all.push({cells,size:area[cells.at(-1)]});
 }
 all.sort((a,b)=>b.size-a.size);
 for(const chain of all.slice(0,maxChains))chains.push(chain);
 return chains;
}
