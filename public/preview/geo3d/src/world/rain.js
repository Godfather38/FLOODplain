// Rain from the run's own rainfall input (hourly mm/h on a latitude/longitude grid), shown as
// falling streaks wherever and whenever the grid has rain. Streak density follows intensity.
import * as THREE from 'three/webgpu';
import {rainAt} from './rain-data.js';
export {parseRain,rainAt} from './rain-data.js';
const COUNT=9000,LENGTH=22,FALL=55,HEIGHT=900,FULL_MMH=8;
export function createRain(scene,{toLonLat,E}){
 const positions=new Float32Array(COUNT*6),geometry=new THREE.BufferGeometry();
 geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));
 const material=new THREE.LineBasicNodeMaterial({color:'#dbe7ef',transparent:true,opacity:.55,depthWrite:false});
 const lines=new THREE.LineSegments(geometry,material);lines.frustumCulled=false;lines.visible=false;scene.add(lines);
 const drops=Array.from({length:COUNT},()=>({x:0,z:0,y:Math.random()*HEIGHT,seed:Math.random()}));
 let anchor=null,radius=0;
 return{
  lines,
  update(dt,{rain,time,target,cameraDistance,groundAt,enabled}){
   lines.visible=enabled&&!!rain;if(!lines.visible)return 0;
   radius=Math.min(9000,Math.max(800,cameraDistance*1.1));
   let active=0,strongest=0;
   for(let k=0;k<COUNT;k++){
    const d=drops[k];
    // New drops are placed around the view; a drop shows only where the grid has rain, and
    // more of them show where it is heavier.
    if(!anchor||d.y<0||Math.hypot(d.x-target.x,d.z-target.z)>radius){
     const a=Math.random()*Math.PI*2,r=Math.sqrt(Math.random())*radius;d.x=target.x+Math.cos(a)*r;d.z=target.z+Math.sin(a)*r;d.y=HEIGHT*(.4+Math.random()*.6);d.seed=Math.random();
     const ll=toLonLat(d.x,d.z);d.mmh=rainAt(rain,time,ll.lon,ll.lat);
    }
    d.y-=FALL*dt;
    const show=d.seed<Math.min(1,d.mmh/FULL_MMH),q=k*6;
    if(show){active++;strongest=Math.max(strongest,d.mmh);const base=(groundAt(d.x,d.z)||0)*E+d.y;positions[q]=d.x;positions[q+1]=base+LENGTH;positions[q+2]=d.z;positions[q+3]=d.x+1.5;positions[q+4]=base;positions[q+5]=d.z+.8;}
    else positions.fill(0,q,q+6);
   }
   anchor=true;geometry.attributes.position.needsUpdate=true;
   return strongest;
  },
 };
}
