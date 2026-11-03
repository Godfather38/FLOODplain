// Drapes production's route lines over the terrain as one ribbon mesh.
import {project,inVisible} from './scene-config.js';
const lines=feature=>feature.geometry.type==='MultiLineString'?feature.geometry.coordinates:[feature.geometry.coordinates];
export function visibleRoadRuns(routes){
 const runs=[];
 for(const feature of routes.features)for(const line of lines(feature)){
  let run=[];
  for(const [lon,lat] of line){
   const p=project(lon,lat);
   if(inVisible(p.x,p.z))run.push(p);
   else{if(run.length>1)runs.push(run);run=[];}
  }
  if(run.length>1)runs.push(run);
 }
 return runs;
}
export function ribbonMesh(runs,heightAt,{width=.42,step=.5,lift=.14}={}){
 const positions=[],indices=[];
 for(const run of runs){
  const points=[];
  for(let q=1;q<run.length;q++){
   const a=run[q-1],b=run[q],parts=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.z-a.z)/step));
   for(let s=q===1?0:1;s<=parts;s++)points.push({x:a.x+(b.x-a.x)*s/parts,z:a.z+(b.z-a.z)*s/parts});
  }
  const base=positions.length/3;
  points.forEach((p,q)=>{
   const a=points[Math.max(0,q-1)],b=points[Math.min(points.length-1,q+1)],dx=b.x-a.x,dz=b.z-a.z,size=Math.hypot(dx,dz)||1,nx=-dz/size*width/2,nz=dx/size*width/2;
   positions.push(p.x+nx,heightAt(p.x+nx,p.z+nz)+lift,p.z+nz,p.x-nx,heightAt(p.x-nx,p.z-nz)+lift,p.z-nz);
   if(q<points.length-1){const k=base+q*2;indices.push(k,k+1,k+2,k+1,k+3,k+2);}
  });
 }
 return{positions:new Float32Array(positions),indices:new Uint32Array(indices)};
}
