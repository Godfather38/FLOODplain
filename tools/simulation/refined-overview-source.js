// Display-only screen-space aggregation. Exact native polygons, IDs and values
// remain the picking source. This grid is never a new hydraulic discretization.
export const mercatorY=lat=>Math.log(Math.tan(Math.PI/4+lat*Math.PI/360));
const palette=[[212,239,247],[168,222,240],[88,181,214],[37,133,188],[36,83,165],[64,49,125]];
const depthCuts=[.01,.1,.3,1,2,4],missingTint=[141,150,157];
function area(points,count){let sum=0;for(let i=0,j=count-1;i<count;j=i++)sum+=points[j*2]*points[i*2+1]-points[i*2]*points[j*2+1];return Math.abs(sum)/2;}
// Sutherland-Hodgman clipping into caller-owned interleaved Float64 buffers.
// No point arrays are allocated per edge or per screen-bin intersection.
function clip(points,count,out,axis,bound,greater){let written=0;for(let i=0,j=count-1;i<count;j=i++){
  const ax=points[j*2],ay=points[j*2+1],bx=points[i*2],by=points[i*2+1],a=axis===0?ax:ay,b=axis===0?bx:by;
  const ain=greater?a>=bound:a<=bound,bin=greater?b>=bound:b<=bound;
  if(ain!==bin){const t=(bound-a)/(b-a);out[written++]=ax+t*(bx-ax);out[written++]=ay+t*(by-ay);}
  if(bin){out[written++]=bx;out[written++]=by;}
}return written/2;}
const yieldTask=()=>globalThis.scheduler?.yield?globalThis.scheduler.yield():new Promise(r=>setTimeout(r,0));
export async function buildNativeOverview({geometry,frame,visible,extent,width,height,signal,yieldWork=yieldTask}){
  const started=performance.now();width=Math.max(1,Math.min(256,Math.ceil(width/4)));height=Math.max(1,Math.min(256,Math.ceil(height/4)));
  const count=width*height,coverage=new Float32Array(count),wet=new Float32Array(count),missing=new Float32Array(count),maximum=new Float32Array(count),rgba=new Uint8ClampedArray(count*4);
  const north=mercatorY(extent.ymax),south=mercatorY(extent.ymin),sx=width/(extent.xmax-extent.xmin),sy=height/(north-south);let intersections=0;
  // One scratch set per asynchronous build: concurrent/cancelled builds cannot
  // overwrite each other. Four clipping planes can at worst double vertex count
  // each time, so 32 scalars per source vertex also covers non-convex input.
  let pointCapacity=16,projected=new Float64Array(pointCapacity*2),clipA=new Float64Array(pointCapacity*32),clipB=new Float64Array(pointCapacity*32);
  for(let k=0;k<visible.length;k++){
    if((k&4095)===0){if(signal?.aborted)throw new DOMException('Overview superseded','AbortError');await yieldWork();}
    const i=visible[k],depth=frame.depthM[i],ring=geometry.rings[i],vertices=ring.length;
    if(vertices>pointCapacity){while(pointCapacity<vertices)pointCapacity*=2;projected=new Float64Array(pointCapacity*2);clipA=new Float64Array(pointCapacity*32);clipB=new Float64Array(pointCapacity*32);}
    let xmin=Infinity,ymin=Infinity,xmax=-Infinity,ymax=-Infinity;for(let v=0;v<vertices;v++){const p=ring[v],x=(p[1]-extent.xmin)*sx,y=(north-mercatorY(p[0]))*sy;projected[v*2]=x;projected[v*2+1]=y;xmin=Math.min(xmin,x);xmax=Math.max(xmax,x);ymin=Math.min(ymin,y);ymax=Math.max(ymax,y);}
    const left=Math.max(0,Math.floor(xmin)),right=Math.min(width-1,Math.ceil(xmax)-1),top=Math.max(0,Math.floor(ymin)),bottom=Math.min(height-1,Math.ceil(ymax)-1);
    for(let y=top;y<=bottom;y++)for(let x=left;x<=right;x++){
      let polygon=projected,length=vertices;if(xmin<x||xmax>x+1||ymin<y||ymax>y+1){length=clip(projected,length,clipA,0,x,true);length=clip(clipA,length,clipB,0,x+1,false);length=clip(clipB,length,clipA,1,y,true);length=clip(clipA,length,clipB,1,y+1,false);polygon=clipB;}
      const a=area(polygon,length);if(a<=1e-12)continue;const j=y*width+x;coverage[j]+=a;intersections++;
      if(depth===null)missing[j]+=a;else if(depth>=.01){wet[j]+=a;maximum[j]=Math.max(maximum[j],depth);}
    }
  }
  if(signal?.aborted)throw new DOMException('Overview superseded','AbortError');
  let coveredPixels=0,wetPixels=0,missingPixels=0;
  for(let j=0;j<count;j++){
    if(coverage[j]>0)coveredPixels++;if(wet[j]>0)wetPixels++;if(missing[j]>0)missingPixels++;
    const w=Math.min(1,wet[j]),m=Math.min(1,missing[j]);if(w+m===0)continue;
    let level=0;while(level<depthCuts.length-1&&maximum[j]>=depthCuts[level+1])level++;const rgb=palette[level];
    // Mixed known/missing bins keep depth tint plus an explicit gray hatch. Empty
    // and dry coverage remain transparent, distinguished by the retained masks.
    const hatch=m>0&&(!w||((j%width+Math.floor(j/width))%4<2)),t=hatch?Math.min(1,m/(w+m)+.35):0;
    for(let c=0;c<3;c++)rgba[j*4+c]=rgb[c]*(1-t)+missingTint[c]*t;
    rgba[j*4+3]=Math.round(255*Math.min(.84,.78*w+.4*m));
  }
  return {width,height,extent:{xmin:extent.xmin,ymin:extent.ymin,xmax:extent.xmax,ymax:extent.ymax},projection:'EPSG:3857',rgba,coverage,wet,missing,maximum,stats:{visibleFaces:visible.length,pixels:count,coveredPixels,wetPixels,missingPixels,intersections,buildMs:performance.now()-started,aggregation:'maximum native full-cell mean depth among wet contributors; fractional coverage and missing masks'}};
}
