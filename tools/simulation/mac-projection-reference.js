// A plain-JS reference of the three pressure operators the junction solver runs
// on the GPU: divergence, the Jacobi pressure iteration, and the gradient
// subtraction. It exists so the discretisation can be checked against a known
// (manufactured) field on an anisotropic grid, which cannot be done by reading
// a shader.
//
// The junction grid is a shallow-water grid: cells are roughly 2.94 m across
// and 0.093 m tall, about 32:1. Velocity is in world metres per second, because
// advection integrates world positions with it. So every difference has to be
// divided by the real world spacing on its own axis. The upstream tank divided
// by 1.0 throughout, which is only right when one cell is one world unit.
//
// Layout matches the shaders: a cell (i,j,k) reads its low faces at index
// (i,j,k) and its high faces at (i+1,j,k) / (i,j+1,k) / (i,j,k+1).

const face=(res,i,j,k)=>((k*(res[1]+1)+j)*(res[0]+1)+i);
const cell=(res,i,j,k)=>((k*res[1]+j)*res[0]+i);

export function createMacGrid({resolution,cellSizeM}){
  if(!Array.isArray(resolution)||resolution.length!==3)throw Error('resolution must be [nx,ny,nz]');
  if(!Array.isArray(cellSizeM)||cellSizeM.length!==3)throw Error('cellSizeM must be [hx,hy,hz] in metres');
  if(cellSizeM.some(h=>!(h>0)))throw Error('every cell size must be a positive number of metres');
  const faces=(resolution[0]+1)*(resolution[1]+1)*(resolution[2]+1);
  const cells=resolution[0]*resolution[1]*resolution[2];
  return {resolution:[...resolution],cellSizeM:[...cellSizeM],
    u:new Float64Array(faces),v:new Float64Array(faces),w:new Float64Array(faces),
    pressure:new Float64Array(cells),divergence:new Float64Array(cells),
    faceIndex:(i,j,k)=>face(resolution,i,j,k),cellIndex:(i,j,k)=>cell(resolution,i,j,k)};
}

// divergence.frag, in world units: 1/s.
export function computeDivergence(grid,{unitSpacing=false}={}){
  const [nx,ny,nz]=grid.resolution;
  const [hx,hy,hz]=unitSpacing?[1,1,1]:grid.cellSizeM;
  for(let k=0;k<nz;k++)for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){
    const lowX=grid.u[face(grid.resolution,i,j,k)],highX=grid.u[face(grid.resolution,i+1,j,k)];
    const lowY=grid.v[face(grid.resolution,i,j,k)],highY=grid.v[face(grid.resolution,i,j+1,k)];
    const lowZ=grid.w[face(grid.resolution,i,j,k)],highZ=grid.w[face(grid.resolution,i,j,k+1)];
    grid.divergence[cell(grid.resolution,i,j,k)]=
      (highX-lowX)/hx+(highY-lowY)/hy+(highZ-lowZ)/hz;
  }
  return grid.divergence;
}

// jacobi.frag. Solid neighbours reflect the centre pressure, which is the
// no-flux wall the shader applies; here every cell is fluid and the domain
// edge reflects, matching an all-wall box.
export function jacobiIterations(grid,iterations,{unitSpacing=false}={}){
  const [nx,ny,nz]=grid.resolution;
  const [hx,hy,hz]=unitSpacing?[1,1,1]:grid.cellSizeM;
  const wx=1/(hx*hx),wy=1/(hy*hy),wz=1/(hz*hz);
  // Upstream averaged the six neighbours equally; that is this same expression
  // with wx=wy=wz, which only holds on a cube.
  const denominator=unitSpacing?6:2*(wx+wy+wz);
  let next=new Float64Array(grid.pressure.length);
  for(let n=0;n<iterations;n++){
    for(let k=0;k<nz;k++)for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){
      const c=cell(grid.resolution,i,j,k),centre=grid.pressure[c];
      const at=(a,b,d)=>a<0||a>=nx||b<0||b>=ny||d<0||d>=nz?centre:grid.pressure[cell(grid.resolution,a,b,d)];
      const left=at(i-1,j,k),right=at(i+1,j,k);
      const bottom=at(i,j-1,k),top=at(i,j+1,k);
      const back=at(i,j,k-1),front=at(i,j,k+1);
      next[c]=unitSpacing
        ?(left+right+bottom+top+back+front-grid.divergence[c])/denominator
        :((left+right)*wx+(bottom+top)*wy+(back+front)*wz-grid.divergence[c])/denominator;
    }
    const swap=grid.pressure;grid.pressure=next;next=swap;
  }
  return grid.pressure;
}

// subtract.frag. A face takes the pressure difference across it, divided by the
// spacing along that face's own axis.
export function subtractPressureGradient(grid,{unitSpacing=false}={}){
  const [nx,ny,nz]=grid.resolution;
  const [hx,hy,hz]=unitSpacing?[1,1,1]:grid.cellSizeM;
  const u=Float64Array.from(grid.u),v=Float64Array.from(grid.v),w=Float64Array.from(grid.w);
  const at=(i,j,k)=>i<0||i>=nx||j<0||j>=ny||k<0||k>=nz?null:grid.pressure[cell(grid.resolution,i,j,k)];
  for(let k=0;k<=nz;k++)for(let j=0;j<=ny;j++)for(let i=0;i<=nx;i++){
    const f=face(grid.resolution,i,j,k);
    const here=at(i,j,k);
    const beforeX=at(i-1,j,k),beforeY=at(i,j-1,k),beforeZ=at(i,j,k-1);
    // A face on the domain edge has fluid on one side only; no flux crosses it.
    if(here!==null&&beforeX!==null)u[f]-=(here-beforeX)/hx;
    if(here!==null&&beforeY!==null)v[f]-=(here-beforeY)/hy;
    if(here!==null&&beforeZ!==null)w[f]-=(here-beforeZ)/hz;
  }
  grid.u=u;grid.v=v;grid.w=w;
  return grid;
}

export function rootMeanSquare(values){
  let sum=0;for(const value of values)sum+=value*value;
  return values.length?Math.sqrt(sum/values.length):0;
}

// One projection pass, as the solver runs it.
export function project(grid,iterations,options={}){
  computeDivergence(grid,options);
  grid.pressure.fill(0);
  jacobiIterations(grid,iterations,options);
  subtractPressureGradient(grid,options);
  return computeDivergence(grid,options);
}
