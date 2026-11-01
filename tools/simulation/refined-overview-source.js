// Display-only screen-space aggregation. Exact native polygons, IDs and values
// remain the picking source. This grid is never a new hydraulic discretization.
export const mercatorY=lat=>Math.log(Math.tan(Math.PI/4+lat*Math.PI/360));
const palette=[[212,239,247],[168,222,240],[88,181,214],[37,133,188],[36,83,165],[64,49,125]];
function area(p){let sum=0;for(let i=0,j=p.length-1;i<p.length;j=i++)sum+=p[j][0]*p[i][1]-p[i][0]*p[j][1];return Math.abs(sum)/2;}
function clip(poly,axis,bound,greater){const out=[];for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[j],b=poly[i],ain=greater?a[axis]>=bound:a[axis]<=bound,bin=greater?b[axis]>=bound:b[axis]<=bound;if(ain!==bin){const t=(bound-a[axis])/(b[axis]-a[axis]);out.push([a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])]);}if(bin)out.push(b);}return out;}
const yieldTask=()=>globalThis.scheduler?.yield?globalThis.scheduler.yield():new Promise(r=>setTimeout(r,0));
export async function buildNativeOverview({geometry,frame,visible,extent,width,height,signal,yieldWork=yieldTask}){
  const started=performance.now();width=Math.max(1,Math.min(256,Math.ceil(width/4)));height=Math.max(1,Math.min(256,Math.ceil(height/4)));
  const count=width*height,coverage=new Float32Array(count),wet=new Float32Array(count),missing=new Float32Array(count),maximum=new Float32Array(count),rgba=new Uint8ClampedArray(count*4);
  const north=mercatorY(extent.ymax),south=mercatorY(extent.ymin),sx=width/(extent.xmax-extent.xmin),sy=height/(north-south);let intersections=0;
  for(let k=0;k<visible.length;k++){
    if((k&4095)===0){if(signal?.aborted)throw new DOMException('Overview superseded','AbortError');await yieldWork();}
    const i=visible[k],depth=frame.depthM[i],poly=geometry.rings[i].map(([lat,lon])=>[(lon-extent.xmin)*sx,(north-mercatorY(lat))*sy]);
    let xmin=Infinity,ymin=Infinity,xmax=-Infinity,ymax=-Infinity;for(const p of poly){xmin=Math.min(xmin,p[0]);xmax=Math.max(xmax,p[0]);ymin=Math.min(ymin,p[1]);ymax=Math.max(ymax,p[1]);}
    const left=Math.max(0,Math.floor(xmin)),right=Math.min(width-1,Math.ceil(xmax)-1),top=Math.max(0,Math.floor(ymin)),bottom=Math.min(height-1,Math.ceil(ymax)-1);
    for(let y=top;y<=bottom;y++)for(let x=left;x<=right;x++){
      let polygon=poly;if(xmin<x||xmax>x+1||ymin<y||ymax>y+1){polygon=clip(polygon,0,x,true);polygon=clip(polygon,0,x+1,false);polygon=clip(polygon,1,y,true);polygon=clip(polygon,1,y+1,false);}
      const a=area(polygon);if(a<=1e-12)continue;const j=y*width+x;coverage[j]+=a;intersections++;
      if(depth===null)missing[j]+=a;else if(depth>=.01){wet[j]+=a;maximum[j]=Math.max(maximum[j],depth);}
    }
  }
  if(signal?.aborted)throw new DOMException('Overview superseded','AbortError');
  let coveredPixels=0,wetPixels=0,missingPixels=0;
  for(let j=0;j<count;j++){
    if(coverage[j]>0)coveredPixels++;if(wet[j]>0)wetPixels++;if(missing[j]>0)missingPixels++;
    const w=Math.min(1,wet[j]),m=Math.min(1,missing[j]);if(w+m===0)continue;
    const level=Math.max(0,[.01,.1,.3,1,2,4].filter(c=>maximum[j]>=c).length-1),rgb=palette[level];
    // Mixed known/missing bins keep depth tint plus an explicit gray hatch. Empty
    // and dry coverage remain transparent, distinguished by the retained masks.
    const hatch=m>0&&(!w||((j%width+Math.floor(j/width))%4<2)),t=hatch?Math.min(1,m/(w+m)+.35):0;
    for(let c=0;c<3;c++)rgba[j*4+c]=rgb[c]*(1-t)+[141,150,157][c]*t;
    rgba[j*4+3]=Math.round(255*Math.min(.84,.78*w+.4*m));
  }
  return {width,height,extent:{xmin:extent.xmin,ymin:extent.ymin,xmax:extent.xmax,ymax:extent.ymax},projection:'EPSG:3857',rgba,coverage,wet,missing,maximum,stats:{visibleFaces:visible.length,pixels:count,coveredPixels,wetPixels,missingPixels,intersections,buildMs:performance.now()-started,aggregation:'maximum native full-cell mean depth among wet contributors; fractional coverage and missing masks'}};
}
