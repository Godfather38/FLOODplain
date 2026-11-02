// The junction solver's pressure operators, checked against manufactured fields
// on the real anisotropic shallow-water grid. The grid the app actually built
// at 22:00 is 2.9449524825424263 x 0.09269393920898139 x 2.9220942453560537 m
// per cell — about 32:1 — so operators that assume a unit cube are wrong by up
// to that factor. These tests fail for the unit-spacing version, which is what
// makes them worth having.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createMacGrid,computeDivergence,project,rootMeanSquare}
  from '../tools/simulation/mac-projection-reference.js';

// The measured cell size from junction-fluid-verification.json.
const CELL=[2.9449524825424263,0.09269393920898139,2.9220942453560537];
const RESOLUTION=[8,6,7];

const grid=()=>createMacGrid({resolution:RESOLUTION,cellSizeM:CELL});

test('a uniform velocity has no divergence, whatever the cell shape',()=>{
  const g=grid();
  g.u.fill(0.37);g.v.fill(-0.11);g.w.fill(0.52);
  const divergence=computeDivergence(g);
  assert.ok(Math.max(...[...divergence].map(Math.abs))<1e-12,
    'a field that is the same everywhere cannot be compressing anything');
});

test('divergence recovers the true rate of stretch in metres per second',()=>{
  // u grows by exactly `slope` metres per second for every metre travelled
  // east, so du/dx is `slope` and the divergence must be `slope` — not
  // `slope * cellWidth`, which is what dividing by 1.0 produced.
  const slope=0.4;
  const g=grid();
  for(let k=0;k<=RESOLUTION[2];k++)for(let j=0;j<=RESOLUTION[1];j++)for(let i=0;i<=RESOLUTION[0];i++)
    g.u[g.faceIndex(i,j,k)]=slope*(i*CELL[0]);
  // computeDivergence writes into the grid's own buffer, so each reading is
  // copied out before the next one overwrites it.
  const correct=Array.from(computeDivergence(g));
  assert.ok(Math.abs(correct[g.cellIndex(3,2,4)]-slope)<1e-12,
    'east-west stretch must come back as '+slope+' per second, got '+correct[g.cellIndex(3,2,4)]);
  // The unit-spacing version reports the same stretch scaled by the cell width.
  const wrong=Array.from(computeDivergence(g,{unitSpacing:true}));
  assert.ok(Math.abs(wrong[g.cellIndex(3,2,4)]-slope*CELL[0])<1e-9,
    'the old operator is off by exactly the cell width, which is what this guards against');
  assert.ok(Math.abs(wrong[g.cellIndex(3,2,4)]-correct[g.cellIndex(3,2,4)])>0.5,
    'the two disagree by more than half a unit per second on this grid');
});

test('vertical stretch is the axis the old operator got most wrong',()=>{
  const slope=0.4;
  const g=grid();
  for(let k=0;k<=RESOLUTION[2];k++)for(let j=0;j<=RESOLUTION[1];j++)for(let i=0;i<=RESOLUTION[0];i++)
    g.v[g.faceIndex(i,j,k)]=slope*(j*CELL[1]);
  assert.ok(Math.abs(computeDivergence(g)[g.cellIndex(3,2,4)]-slope)<1e-12);
  const wrong=computeDivergence(g,{unitSpacing:true})[g.cellIndex(3,2,4)];
  // 0.0927 m cells: the vertical term was weighed about eleven times too little.
  assert.ok(Math.abs(slope/wrong-1/CELL[1])<1e-6,
    'the vertical error factor is 1/cellHeight = '+(1/CELL[1]).toFixed(2)+'x');
});

test('the projection removes divergence from a manufactured field',()=>{
  const g=grid();
  // A divergent interior field with no flux through the walls, so the Poisson
  // problem is solvable with the reflecting boundary the shader applies.
  let seed=7;
  const next=()=>{seed=(seed*1103515245+12345)%2147483648;return seed/2147483648-0.5;};
  const [nx,ny,nz]=RESOLUTION;
  for(let k=0;k<=nz;k++)for(let j=0;j<=ny;j++)for(let i=0;i<=nx;i++){
    if(i>0&&i<nx)g.u[g.faceIndex(i,j,k)]=next();
    if(j>0&&j<ny)g.v[g.faceIndex(i,j,k)]=next()*0.05;
    if(k>0&&k<nz)g.w[g.faceIndex(i,j,k)]=next();
  }
  const before=rootMeanSquare(Array.from(computeDivergence(g)));
  assert.ok(before>0.1,'the manufactured field must actually be divergent: '+before);
  const snapshot=()=>({u:Float64Array.from(g.u),v:Float64Array.from(g.v),w:Float64Array.from(g.w)});
  const restore=s=>{g.u=Float64Array.from(s.u);g.v=Float64Array.from(s.v);g.w=Float64Array.from(s.w);};
  const start=snapshot();
  const after=rootMeanSquare(Array.from(project(g,400)));
  assert.ok(after<before*0.3,
    'four hundred iterations must remove most of the divergence: '
    +before.toFixed(4)+' -> '+after.toFixed(4));
  // It must keep converging rather than stalling at some residual, which is
  // what a mis-scaled operator does. Jacobi is slow on a 32:1 grid, so this is
  // stated as a convergence property, not as a one-shot tolerance.
  restore(start);
  const longer=rootMeanSquare(Array.from(project(g,6000)));
  assert.ok(longer<after*0.5,
    'more iterations must keep reducing it, not stall: '+after.toFixed(5)+' -> '+longer.toFixed(5));
});

// Correcting the operators makes the system much stiffer: the Poisson weights
// go as 1/h^2, so a 32:1 grid weighs the vertical direction about 1,000 times
// the horizontal. Jacobi converges slowly on that. The solver runs 24
// iterations, and this records what 24 iterations actually achieve, so the
// limitation is measured rather than assumed.
// REFERENCE DOMAIN, NOT THE RUNTIME SCENE. This is a regular all-fluid box at
// the real cell spacing with a manufactured divergent field. The actual GPU
// scene is irregular: it has a measured bed, dry cells, a free surface and a
// marker that discards air cells, and its residual has not been read back off
// the GPU. The number below says what this discretisation costs on a grid of
// this shape; it is not a measurement of the live solver's residual.
test('reference domain: twenty-four Jacobi iterations are far from converged at this cell spacing',()=>{
  const build=()=>{
    const g=grid();
    let seed=11;
    const next=()=>{seed=(seed*1103515245+12345)%2147483648;return seed/2147483648-0.5;};
    const [nx,ny,nz]=RESOLUTION;
    for(let k=0;k<=nz;k++)for(let j=0;j<=ny;j++)for(let i=0;i<=nx;i++){
      if(i>0&&i<nx)g.u[g.faceIndex(i,j,k)]=next();
      if(j>0&&j<ny)g.v[g.faceIndex(i,j,k)]=next()*0.05;
      if(k>0&&k<nz)g.w[g.faceIndex(i,j,k)]=next();
    }
    return g;
  };
  const residual=(iterations)=>{
    const g=build();
    const before=rootMeanSquare(Array.from(computeDivergence(g)));
    const after=rootMeanSquare(Array.from(project(g,iterations)));
    return after/before;
  };
  const atSolverSetting=residual(24);
  const converged=residual(6000);
  assert.ok(atSolverSetting>0.1,
    'on this REFERENCE domain twenty-four iterations leave a double-digit share of the divergence in place '
    +'at 35:1 cell spacing: '+(atSolverSetting*100).toFixed(1)+'% remains. '
    +'This is the cost of the discretisation on a grid of this shape, not a measured residual of the live GPU scene.');
  assert.ok(converged<atSolverSetting*0.2,
    'the same operator does converge given enough iterations, so this is a budget limit, not a broken operator: '
    +(converged*100).toFixed(2)+'% remains at 6000');
});

test('the shaders use the real per-axis cell size, not one world unit',async()=>{
  const base='public/simulation/fluid-prototype/vendor/shaders/';
  const divergence=await readFile(base+'divergence.frag','utf8');
  const jacobi=await readFile(base+'jacobi.frag','utf8');
  const subtract=await readFile(base+'subtract.frag','utf8');
  for(const [name,source] of [['divergence',divergence],['jacobi',jacobi],['subtract',subtract]])
    assert.match(source,/uniform vec3 u_cellSize/,name+'.frag must take the world cell size');
  assert.match(divergence,/\(rightX - leftX\) \/ u_cellSize\.x/);
  assert.match(divergence,/\(topY - bottomY\) \/ u_cellSize\.y/);
  assert.match(divergence,/\(frontZ - backZ\) \/ u_cellSize\.z/);
  assert.doesNotMatch(divergence,/\+ \(frontZ - backZ\)\) \/ 1\.0/,
    'the unit-spacing divergence must not come back');
  assert.match(jacobi,/w\.x.*w\.y.*w\.z/s,'the Poisson stencil must be weighted per axis');
  assert.doesNotMatch(jacobi,/front\) \/ 6\.0/,'the equal six-neighbour average must not come back');
  assert.match(subtract,/\(right - left\) \/ u_cellSize\.x/);
  assert.doesNotMatch(subtract,/back\) \/ 1\.0/,'the unit-spacing gradient must not come back');
  const simulator=await readFile('public/simulation/fluid-prototype/vendor/js/simulator.js','utf8');
  assert.match(simulator,/var cellSize = \[/,'the simulator must compute the world cell size');
  assert.equal((simulator.match(/uniform3f\('u_cellSize'/g)??[]).length,3,
    'all three projection stages must receive it');
});
