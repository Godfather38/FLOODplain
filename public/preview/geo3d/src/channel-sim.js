// The demo's solver, unedited, given land instead of a seabed. Its ocean boundary
// is switched off; water enters at channel heads and leaves at the grid edge.
import {ShoreSimulation} from '../../coastal-lowcost/src/simulation.js?v=1.3.0';
export const inflowSurge=t=>Math.max(.15,1+.6*Math.sin(t*.83)+.35*Math.sin(t*.31+1.7));
export class ChannelSimulation extends ShoreSimulation{
 constructor(grid,bed,sources){
  super(grid);
  this.bed.set(bed);this.sand.set(bed);
  this.h.fill(0);this.next.fill(0);this.wet.fill(0);this.sponge.fill(0);
  this.sources=sources;
 }
 step(dt=1/60){
  super.step(dt);
  const {nx,nz,dx,dz}=this.g,{h}=this,drain=Math.exp(-dt*6);
  // Constant inflow settles into a still picture, so surges keep the water moving.
  const surge=inflowSurge(this.time);
  for(const {cell,rate} of this.sources)h[cell]+=rate*surge*dt/(dx*dz);
  for(let i=0;i<nx;i++){h[i]*=drain;h[(nz-1)*nx+i]*=drain;}
  for(let j=1;j<nz-1;j++){h[j*nx]*=drain;h[j*nx+nx-1]*=drain;}
 }
}
