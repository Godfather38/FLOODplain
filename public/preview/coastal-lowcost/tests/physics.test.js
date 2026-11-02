import test from 'node:test';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {ShoreSimulation,spongeWeight} from '../src/simulation.js';
import {smooth} from '../src/coast.js';
import {GRID_PRESETS,PRESETS,resolveTrial} from '../src/trial-config.js';

const close=(actual,expected,eps=1e-6)=>assert.ok(Math.abs(actual-expected)<=eps,`${actual} != ${expected}`);
const expected={original:[241,401],small:[48,80],tiny:[24,40]};
test('grid presets keep origin, endpoints and cell counts without shrinking the coast',()=>{
 for(const [name,[nx,nz]] of Object.entries(expected)){
  const g=GRID_PRESETS[name];assert.equal(g.nx,nx);assert.equal(g.nz,nz);
  close(g.x0,-14);close(g.z0,-92);close(g.x0+(nx-1)*g.dx,58);close(g.z0+(nz-1)*g.dz,28);
 }
 close(GRID_PRESETS.original.nx*GRID_PRESETS.original.nz/(GRID_PRESETS.tiny.nx*GRID_PRESETS.tiny.nz),100.6677083333);
 for(const key of ['baseline','original-cheap','tiny-original','tiny-cheap','small-cheap']){
  assert.ok(PRESETS[key]);const trial=resolveTrial(`?preset=${key}`);assert.equal(trial.id,key);assert.ok(trial.grid.nx>0);
 }
 assert.ok(resolveTrial('?preset=not-real').grid.nx>0,'unknown selection has a safe default');
});
test('world-space sponge matches original grid strips and keeps coarse interiors unforced',()=>{
 const g=GRID_PRESETS.original;
 for(let j=0;j<g.nz;j++)for(let i=0;i<g.nx;i++){
  const expected=Math.max(smooth(g.nx-26,g.nx-2,i),smooth(12,0,j),smooth(g.nz-13,g.nz-1,j));
  close(spongeWeight(g.x0+i*g.dx,g.z0+j*g.dz),expected,1e-12);
 }
 for(const g of Object.values(GRID_PRESETS)){
  const sim=new ShoreSimulation(g);let forced=0;
  for(let j=0;j<g.nz;j++)for(let i=0;i<g.nx;i++){
   const x=g.x0+i*g.dx,z=g.z0+j*g.dz,w=sim.sponge[j*g.nx+i];
   close(w,spongeWeight(x,z));if(w>0)forced++;
   if(x<=50.5&&z>=-88.4&&z<=24.4)assert.equal(w,0);
  }
  assert.ok(forced/sim.n<.25,`boundary strip remains a minority: ${forced/sim.n}`);
 }
 close(spongeWeight(50.5,0),0);close(spongeWeight(57.7,0),1);
 close(spongeWeight(0,-88.4),0);close(spongeWeight(0,-92),1);
 close(spongeWeight(0,24.4),0);close(spongeWeight(0,28),1);
});
for(const [name,g] of Object.entries(GRID_PRESETS))test(`${name}: deterministic 2,160-step JavaScript warmup, finite fields and reusable packet dimensions`,()=>{
 const at=performance.now(),sim=new ShoreSimulation(g);assert.equal(sim.kernels,undefined);
 for(let i=0;i<2160;i++)sim.step(1/60);
 close(sim.time,36,1e-9);assert.equal(sim.steps,2160);
 assert.equal(sim.metrics().nonfinite,0);
 for(const key of ['h','u','v','foam','old','wet','film','qx','qz']){
  assert.equal(sim[key].length,g.nx*g.nz);
  assert.ok(sim[key].every(Number.isFinite),`${key} contains nonfinite entries`);
 }
 assert.ok(sim.h.every(x=>x>=0));assert.ok(sim.foam.some(x=>x>0),'moving wash produces foam');
 const packet=sim.pack(),identity={surface:packet.surface,material:packet.material,flow:packet.flow};
 for(const key of ['surface','material','flow']){
  assert.equal(packet[key].length,g.nx*g.nz*4);assert.ok(packet[key].every(Number.isFinite));
 }
 const before=packet.surface.slice();sim.step(1/60);const next=sim.pack(packet);
 for(const key of ['surface','material','flow'])assert.equal(next[key],identity[key]);
 assert.ok(next.time>36);assert.ok(next.surface.some((x,i)=>x!==before[i]),'surface advances continuously');
 assert.throws(()=>sim.pack({surface:new Float32Array(4),material:packet.material,flow:packet.flow}),/dimensions/);
 console.log(JSON.stringify({test:'warmup',grid:name,cells:sim.n,milliseconds:performance.now()-at,metrics:sim.metrics()}));
});
test('tiny deterministic state reproduces exactly at fixed elapsed simulation time',()=>{
 const a=new ShoreSimulation(GRID_PRESETS.tiny),b=new ShoreSimulation(GRID_PRESETS.tiny);
 for(let i=0;i<240;i++){a.step(1/60);b.step(1/60);}
 for(const key of ['h','u','v','foam','old','wet','film','qx','qz'])assert.deepEqual(a[key],b[key]);
});
