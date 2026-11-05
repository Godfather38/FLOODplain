// The saved all-route SFINCS run: NWM Nov 1 2026 13Z and HRRR 14Z, three separate model areas
// (Northern, Picture Rocks, Gates) on quadtree cells from 6.25 m up to 100 m. The 2D map and the
// 3D view both read it from the display package in data/all-route-13z/, which
// tools/all-route/build_web_package.py writes from the published results on experiment/sfincs-engine.
// - "web": native cells near the routes, 50 m blocks farther away (stored water / block area).
// - "full": every native cell, for the 3D view on High and Ultra.
// Frames load one at a time. Each case keeps its own result: where two model areas overlap, the
// map draws one of them (the viewer chooses which) and a tap lists both. Nothing is averaged.
// Route-point values are the exact native float32 values in every variant.
import {fromUtm,toUtm} from '../preview/geo3d/src/utm.js?v=dev';
export const ALL_ROUTE_DATA=new URL('./data/all-route-13z/',import.meta.url);
const UNIT=6.25,R=6378137,WET_M=.0091;

async function gunzip(bytes){
 if(bytes[0]!==0x1f||bytes[1]!==0x8b)return bytes;
 return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
}
const plainFetch=async url=>{const r=await fetch(url);if(!r.ok)throw new Error(`${String(url).split('/').pop()} answered ${r.status}`);return new Uint8Array(await r.arrayBuffer());};
// One packed file: 'FPQW', header length, JSON header, then the arrays.
function unpack(bytes){
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 if(String.fromCharCode(...bytes.subarray(0,4))!=='FPQW')throw new Error('Not an all-route display file');
 const n=view.getUint32(4,true),header=JSON.parse(new TextDecoder().decode(bytes.subarray(8,8+n)));
 // Copy the body so every array starts on its own aligned buffer.
 const body=bytes.slice(8+n);return{header,body:body.buffer};
}
async function sha256(bytes){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');}

// variant: 'web' or 'full'. fetchBytes(url) -> Uint8Array (raw, maybe gzipped).
export async function openAllRoute({variant='web',fetchBytes=plainFetch}={}){
 const json=async name=>JSON.parse(new TextDecoder().decode(await gunzip(await fetchBytes(new URL(name,ALL_ROUTE_DATA)))));
 const [pkg,points]=await Promise.all([json('package.json'),json('route-points.json')]);
 const cases=await Promise.all(pkg.cases.map(async(info,ci)=>{
  const g=info.variants[variant].geometry,raw=await fetchBytes(new URL(`${info.key}/${g.file}`,ALL_ROUTE_DATA));
  if(await sha256(raw)!==g.sha256)throw new Error(`${info.key} cells failed their checksum`);
  const {header,body}=unpack(await gunzip(raw)),n=header.count;
  const ix=new Uint16Array(body,0,n),iy=new Uint16Array(body,2*n,n),lvl=new Uint8Array(body,4*n,n),flags=new Uint8Array(body,5*n,n);
  const ro=6*n+((-2*n)%4+4)%4,routeIndex=new Uint32Array(body,ro,header.routeCells);
  const slotOf=new Map();routeIndex.forEach((cell,s)=>slotOf.set(cell,s));
  const byTime=new Map(info.frames.map((f,k)=>[f.time,k]));
  return{ci,key:info.key,label:info.label,info,n,ix,iy,lvl,flags,routeIndex,slotOf,byTime,e0:info.e0,n0:info.n0,bit:1<<ci,frames:new Map(),pending:new Map()};
 }));
 // The run's clock: every frame time any case has (the Picture Rocks case stops a frame early).
 const times=[...new Set(pkg.cases.flatMap(c=>c.frames.map(f=>f.time)))].sort().map(t=>Date.parse(t));
 const iso=times.map(t=>new Date(t).toISOString().replace('.000Z','Z'));
 const frameMs=times.length>1?times[1]-times[0]:3600e3;
 // A frame of one case: listed cells (sorted) and their depth in metres. Route cells carry the
 // exact native depth instead of the millimetre value.
 async function load(c,fi){
  const k=c.byTime.get(iso[fi]);if(k==null)return null;
  if(c.frames.has(k))return c.frames.get(k);
  if(c.pending.has(k))return c.pending.get(k);
  const d=c.info.frames[k][variant];
  const p=(async()=>{
   const raw=await fetchBytes(new URL(`${c.key}/${d.file}`,ALL_ROUTE_DATA));
   if(await sha256(raw)!==d.sha256)throw new Error(`${c.key} frame ${iso[fi]} failed its checksum`);
   const {header,body}=unpack(await gunzip(raw)),L=header.listed,rc=header.routeCells;
   const delta=new Uint32Array(body,0,L),mm=new Uint16Array(body,4*L,L),ro=6*L+((-2*L)%4+4)%4;
   const routeDepth=new Float32Array(body,ro,rc),routeZs=new Float32Array(body,ro+4*rc,rc);
   const listed=new Uint32Array(L),depth=new Float32Array(L);let at=0;
   for(let i=0;i<L;i++){at+=delta[i];listed[i]=at;depth[i]=mm[i]/1000;}
   for(let s=0;s<rc;s++){const cell=c.routeIndex[s],j=search(listed,cell);if(j>=0)depth[j]=routeDepth[s];}
   const f={listed,depth,routeDepth,routeZs,time:times[fi]};
   c.frames.set(k,f);c.pending.delete(k);
   // Keep the last dozen frames of each case.
   if(c.frames.size>12)c.frames.delete(c.frames.keys().next().value);
   return f;
  })();
  c.pending.set(k,p);p.catch(()=>c.pending.delete(k));
  return p;
 }
 const peek=(c,fi)=>{const k=c.byTime.get(iso[fi]);return k==null?null:c.frames.get(k)??undefined;};
 // Which case is drawn where model areas overlap. 'nearest' (the default): the area whose own
 // routes are nearest (flag bit 7 from the builder). A case key: that area first, then the rest in
 // the package order. drawn[flags] is 1 where this case's cell is drawn.
 let mode='nearest';
 function setMode(m){
  mode=m;const order=m==='nearest'?pkg.caseOrder:[m,...pkg.caseOrder.filter(k=>k!==m)];
  for(const c of cases){let before=0;for(const key of order){if(key===c.key)break;before|=cases.find(x=>x.key===key).bit;}
   c.drawn=Uint8Array.from({length:256},(_,fl)=>m==='nearest'?((fl&7)===0||(fl&128)?1:0):((fl&before)===0?1:0));}
 }
 setMode(mode);
 // Per frame: wet area and deepest cell, counting each place once under the current order.
 function series(){
  return times.map((t,fi)=>{
   let wet=0,deep=0;
   for(const c of cases){const k=c.byTime.get(iso[fi]);if(k==null)continue;
    for(const [fl,[km2,dm]] of Object.entries(c.info.frames[k].byFlags))if(c.drawn[Number(fl)]){wet+=km2;deep=Math.max(deep,dm);}}
   return{time:t,wetKm2:wet,deepM:deep,rainMmH:0,inflowM3s:0};
  });
 }
 // Cell lookup by place, built on first use: 100 m buckets of cell indices.
 function cellAtUtm(c,e,n){
  if(!c.buckets){
   c.buckets=new Map();
   for(let k=0;k<c.n;k++){const s=1<<c.lvl[k],x0=c.ix[k],y0=c.iy[k];
    for(let bx=Math.floor(x0/16);bx<=Math.floor((x0+s-1)/16);bx++)for(let by=Math.floor(y0/16);by<=Math.floor((y0+s-1)/16);by++){const key=by*65536+bx;let l=c.buckets.get(key);if(!l)c.buckets.set(key,l=[]);l.push(k);}}
  }
  const ux=(e-c.e0)/UNIT,uy=(n-c.n0)/UNIT;if(ux<0||uy<0)return -1;
  const l=c.buckets.get(Math.floor(uy/16)*65536+Math.floor(ux/16));if(!l)return -1;
  for(const k of l){const s=1<<c.lvl[k];if(ux>=c.ix[k]&&ux<c.ix[k]+s&&uy>=c.iy[k]&&uy<c.iy[k]+s)return k;}
  return -1;
 }
 function depthOf(c,f,k){const j=search(f.listed,k);return j<0?0:f.depth[j];}
 // Every case's value at a place for one frame: [{key,label,depth (m) | null when the case has no frame}].
 function valuesAt(lat,lon,fi){
  const u=toUtm(lon,lat),out=[];
  for(const c of cases){const k=cellAtUtm(c,u.e,u.n);if(k<0)continue;
   const hasFrame=c.byTime.has(iso[fi]),f=hasFrame?peek(c,fi):null;
   out.push({key:c.key,label:c.label,cell:k,sizeM:UNIT*(1<<c.lvl[k]),hasFrame,loaded:!!f,depth:f?depthOf(c,f,k):null,drawn:!!c.drawn[c.flags[k]]});}
  return out;
 }
 // Each crossing's water surface per frame, from the exact route-point series of every case that has it.
 function pointSeries(id){
  return cases.map(c=>{const p=points.cases[c.key]?.points?.[id];if(!p)return null;const at=new Map(points.cases[c.key].times.map((t,k)=>[t,k]));
   return{key:c.key,label:c.label,routes:c.info.routes,zs:iso.map(t=>{const k=at.get(t);return k==null||p.zs[k]==null?NaN:p.zs[k];}),depth:iso.map(t=>{const k=at.get(t);return k==null||p.depth[k]==null?NaN:p.depth[k];})};}).filter(Boolean);
 }
 return{pkg,cases,times,iso,frameMs,variant,load,peek,series,valuesAt,pointSeries,cellAtUtm,
  get mode(){return mode;},setMode,
  // Load (or wait for) frame fi of every case that has it.
  ensure(fi){return Promise.all(cases.map(c=>load(c,fi)));},
  missingAt:fi=>cases.filter(c=>!c.byTime.has(iso[fi])),
 };
}
export function search(a,v){let lo=0,hi=a.length-1;while(lo<=hi){const m=(lo+hi)>>1,x=a[m];if(x===v)return m;if(x<v)lo=m+1;else hi=m-1;}return -1;}

// Web Mercator metres (Leaflet's EPSG:3857) for UTM points, through a 500 m grid of exact
// conversions per case: bilinear between them is well under a centimetre off.
function mercatorGrid(c){
 let w=0,h=0;for(let k=0;k<c.n;k++){const s=1<<c.lvl[k];w=Math.max(w,(c.ix[k]+s)*UNIT);h=Math.max(h,(c.iy[k]+s)*UNIT);}
 const S=500,cols=Math.ceil(w/S)+2,rows=Math.ceil(h/S)+2;
 const gx=new Float64Array(cols*rows),gy=new Float64Array(cols*rows);
 for(let j=0;j<rows;j++)for(let i=0;i<cols;i++){const ll=fromUtm(c.e0+i*S,c.n0+j*S);gx[j*cols+i]=R*ll.lon*Math.PI/180;gy[j*cols+i]=R*Math.log(Math.tan(Math.PI/4+ll.lat*Math.PI/360));}
 return(e,n,out,o)=>{const u=e/S,v=n/S,i=Math.min(cols-2,Math.floor(u)),j=Math.min(rows-2,Math.floor(v)),a=u-i,b=v-j,k=j*cols+i;
  out[o]=(gx[k]*(1-a)+gx[k+1]*a)*(1-b)+(gx[k+cols]*(1-a)+gx[k+cols+1]*a)*b;out[o+1]=(gy[k]*(1-a)+gy[k+1]*a)*(1-b)+(gy[k+cols]*(1-a)+gy[k+cols+1]*a)*b;};
}
// Each cell's south-west and north-east corners in Mercator metres, relative to the case origin.
function mercatorBoxes(c){
 if(c.box)return c.box;
 const at=mercatorGrid(c),box=new Float32Array(c.n*4),o=new Float64Array(2);at(0,0,o,0);const ox=o[0],oy=o[1];
 for(let k=0;k<c.n;k++){const s=(1<<c.lvl[k])*UNIT,x=c.ix[k]*UNIT,y=c.iy[k]*UNIT;at(x,y,o,0);box[k*4]=o[0]-ox;box[k*4+1]=o[1]-oy;at(x+s,y+s,o,0);box[k*4+2]=o[0]-ox;box[k*4+3]=o[1]-oy;}
 c.box=box;c.origin=[ox,oy];return box;
}

// The 2D painter: draws the frames at the clock on a Leaflet map's canvas.
// colours: band colours; bandOf(depthM) -> band index or -1.
export function createQuadPainter(run,{colors,bandOf}){
 for(const c of run.cases)mercatorBoxes(c);
 const rects=colors.map(()=>[]);
 let drawnFrames=null;
 // Container pixels from Mercator metres: px = mx * k + bx, py = -my * k + by.
 function transform(map){
  const z=map.getZoom(),S=256*2**z,k=S/(2*Math.PI*R),ref=map.getCenter(),cp=map.latLngToContainerPoint(ref),pp=map.project(ref,z);
  return{k,bx:cp.x-pp.x+S/2,by:cp.y-pp.y+S/2};
 }
 function paint(ctx,map,clock,size){
  const i=Math.min(run.times.length-1,Math.floor(clock)),j=Math.min(run.times.length-1,i+1),f=clock-i,{k,bx,by}=transform(map);
  for(const r of rects)r.length=0;
  let missing=0;const used=[];
  for(const c of run.cases){
   if(!c.byTime.has(run.iso[i]))continue;
   const A=run.peek(c,i),B=j===i?A:run.peek(c,j);
   if(!A){missing++;continue;}
   used.push(c.key+':'+i);
   const box=c.box,cx=c.origin[0]*k+bx,cy=-c.origin[1]*k+by,drawn=c.drawn,flags=c.flags;
   const la=A.listed,da=A.depth,lb=B&&B!==A?B.listed:null,db=lb?B.depth:null;
   let p=0,q=0;
   // Merge the two frames' sorted cell lists so each cell is blended once.
   while(p<la.length||(lb&&q<lb.length)){
    let cell,d;
    if(!lb){cell=la[p];d=da[p++];}
    else if(q>=lb.length||(p<la.length&&la[p]<lb[q])){cell=la[p];d=da[p++]*(1-f);}
    else if(p>=la.length||lb[q]<la[p]){cell=lb[q];d=db[q++]*f;}
    else{cell=la[p];d=da[p++]+(db[q++]-da[p-1])*f;}
    if(!drawn[flags[cell]])continue;
    const band=bandOf(d);if(band<0)continue;
    const x0=box[cell*4]*k+cx,y1=-box[cell*4+1]*k+cy,x1=box[cell*4+2]*k+cx,y0=-box[cell*4+3]*k+cy;
    if(x1<0||y1<0||x0>size.x||y0>size.y)continue;
    rects[band].push(x0,y0,Math.max(1,x1-x0+.5),Math.max(1,y1-y0+.5));
   }
  }
  ctx.globalAlpha=.82;
  rects.forEach((r,b)=>{if(!r.length)return;ctx.fillStyle=colors[b];ctx.beginPath();for(let n=0;n<r.length;n+=4)ctx.rect(r[n],r[n+1],r[n+2],r[n+3]);ctx.fill();});
  ctx.globalAlpha=1;
  drawnFrames=used.join();
  return{missing};
 }
 // The model areas' outlines, dashed.
 function paintOutlines(ctx,map,fi){
  ctx.save();ctx.lineWidth=1.2;
  ctx.strokeStyle='rgba(40,60,80,.45)';ctx.setLineDash([2,4]);
  run.pkg.cases.forEach(info=>{
   ctx.beginPath();
   for(const [[a,b],[c2,d]] of info.outline){const p=map.latLngToContainerPoint([a,b]),q=map.latLngToContainerPoint([c2,d]);ctx.moveTo(p.x,p.y);ctx.lineTo(q.x,q.y);}
   ctx.stroke();
  });
  ctx.restore();
 }
 // Bounds of the cells at least minM deep in the drawn frame.
 function wetBounds(clock,minM){
  const i=Math.min(run.times.length-1,Math.round(clock));let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
  for(const c of run.cases){const A=run.peek(c,i);if(!A)continue;const box=c.box;
   for(let p=0;p<A.listed.length;p++){if(A.depth[p]<minM)continue;const cell=A.listed[p];if(!c.drawn[c.flags[cell]])continue;
    x0=Math.min(x0,box[cell*4]+c.origin[0]);y0=Math.min(y0,box[cell*4+1]+c.origin[1]);x1=Math.max(x1,box[cell*4+2]+c.origin[0]);y1=Math.max(y1,box[cell*4+3]+c.origin[1]);}}
  if(!(x1>x0))return null;
  const ll=(x,y)=>[(2*Math.atan(Math.exp(y/R))-Math.PI/2)*180/Math.PI,x/R*180/Math.PI];
  return[ll(x0,y0),ll(x1,y1)];
 }
 return{paint,paintOutlines,wetBounds,get drawn(){return drawnFrames;}};
}
export {WET_M};

// The 3D view's water picture for one frame: each pixel's depth is the water the drawn cells
// store over it divided by the pixel's area (the same volume / area rule as the cells), coded
// in one byte: 0 = no water, else 1 + 254 * sqrt(depth / 16 m). Row 0 is the north edge.
// box: {e0, n0 (south-west corner, UTM m), w, h (m), cols, rows}. Cases without this frame are
// left empty there.
export function rasterize(run,fi,box,out=new Uint8Array(box.cols*box.rows),acc=new Float32Array(box.cols*box.rows)){
 acc.fill(0);const px=box.w/box.cols,py=box.h/box.rows,north=box.n0+box.h;
 for(const c of run.cases){
  const f=run.peek(c,fi);if(!f)continue;
  const {listed,depth}=f,drawn=c.drawn,flags=c.flags;
  for(let p=0;p<listed.length;p++){
   const k=listed[p];if(!drawn[flags[k]])continue;
   const s=(1<<c.lvl[k])*UNIT,x0=c.e0+c.ix[k]*UNIT-box.e0,x1=x0+s,yTop=north-(c.n0+c.iy[k]*UNIT+s),yBot=yTop+s,d=depth[p];
   const i0=Math.max(0,Math.floor(x0/px)),i1=Math.min(box.cols-1,Math.floor((x1-1e-6)/px)),j0=Math.max(0,Math.floor(yTop/py)),j1=Math.min(box.rows-1,Math.floor((yBot-1e-6)/py));
   for(let j=j0;j<=j1;j++){const oy=Math.min(yBot,(j+1)*py)-Math.max(yTop,j*py);if(oy<=0)continue;
    for(let i=i0;i<=i1;i++){const ox=Math.min(x1,(i+1)*px)-Math.max(x0,i*px);if(ox>0)acc[j*box.cols+i]+=d*ox*oy;}}
  }
 }
 const area=px*py;
 for(let q=0;q<acc.length;q++){const d=acc[q]/area;out[q]=d<WET_M?0:1+Math.round(254*Math.sqrt(Math.min(d,16)/16));}
 return out;
}
