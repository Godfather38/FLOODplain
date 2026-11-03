// Rain from the run's own rainfall input (hourly mm/h), shown as falling streaks wherever and
// whenever the grid has rain. Streak density follows intensity; streak size follows the view
// distance so rain reads the same zoomed in or out. The fall itself runs on the GPU: the CPU
// only places drops, a slice per frame, when the view moves well away or the hour changes.
import * as THREE from 'three/webgpu';
import {Fn,uniform,attribute,positionLocal,vec3,fract,select} from 'three/tsl';
import {rainAtUtm} from './rain-data.js';
import {worldToUtm} from './heights.js';
export {parseRain,rainAt} from './rain-data.js';
const COUNT=9000,LENGTH=.03,FALL=.07,FULL_MMH=6,SLICE=1000,STEP=1.35;
export function createRain(scene,{E}){
 // Two vertices per drop: position (x, 0 bottom / 1 top, z) and drop (ground height, phase, shown).
 const positions=new Float32Array(COUNT*6),drop=new Float32Array(COUNT*6),geometry=new THREE.BufferGeometry();
 for(let k=0;k<COUNT;k++){positions[k*6+4]=1;const phase=Math.random();drop[k*6+1]=drop[k*6+4]=phase;}
 geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));geometry.setAttribute('drop',new THREE.BufferAttribute(drop,3));
 const U={time:uniform(0),column:uniform(1000)};
 const material=new THREE.LineBasicNodeMaterial({color:'#4f7593',transparent:true,opacity:.6,depthWrite:false});
 material.positionNode=Fn(()=>{
  const d=attribute('drop','vec3'),top=positionLocal.y,len=U.column.mul(LENGTH).mul(top);
  const y=d.x.add(fract(d.y.sub(U.time.mul(FALL))).mul(U.column)).add(len);
  return select(d.z.greaterThan(.5),vec3(positionLocal.x.add(len.mul(.07)),y,positionLocal.z.add(len.mul(.04))),vec3(0,-1e5,0));
 })();
 const lines=new THREE.LineSegments(geometry,material);lines.frustumCulled=false;lines.visible=false;scene.add(lines);
 let centre=null,level=null,hour=null,cursor=COUNT,strongest=0,next=0,job=null;
 function place(k,{rain,time,groundAt,move,radius,cx,cz}){
  const q=k*6;let x=positions[q],z=positions[q+2];
  if(move){const a=Math.random()*Math.PI*2,r=Math.sqrt(Math.random())*radius;x=cx+Math.cos(a)*r;z=cz+Math.sin(a)*r;positions[q]=positions[q+3]=x;positions[q+2]=positions[q+5]=z;drop[q]=drop[q+3]=(groundAt(x,z)||0)*E;}
  const u=worldToUtm(x,z),mmh=rainAtUtm(rain,time,u.e,u.n),shown=drop[q+1]<Math.min(1,mmh/FULL_MMH)?1:0;
  drop[q+2]=drop[q+5]=shown;if(shown)next=Math.max(next,mmh);
 }
 return{
  lines,
  update(dt,{rain,time,target,cameraDistance,groundAt,enabled}){
   lines.visible=enabled&&!!rain;if(!lines.visible)return 0;
   U.time.value+=dt;U.column.value=Math.max(300,cameraDistance*.6);
   const lv=Math.round(Math.log(Math.max(800,cameraDistance*1.1))/Math.log(STEP)),radius=Math.min(9000,STEP**lv);
   const h=rain.frames.find(f=>time>=f.start&&time<f.end)?.start??-1;
   const far=!centre||Math.hypot(target.x-centre.x,target.z-centre.z)>radius*.35;
   // A new placement when the view moved or zoomed a step; only a rate check when the hour changed.
   if(far||lv!==level){centre={x:target.x,z:target.z};level=lv;hour=h;job={move:true,radius,cx:target.x,cz:target.z};cursor=0;next=0;}
   else if(h!==hour){hour=h;job={move:false};cursor=0;next=0;}
   if(cursor<COUNT){
    const end=Math.min(COUNT,cursor+SLICE);
    for(let k=cursor;k<end;k++)place(k,{rain,time,groundAt,...job});
    cursor=end;geometry.attributes.position.needsUpdate=true;geometry.attributes.drop.needsUpdate=true;
    if(cursor===COUNT)strongest=next;
   }
   return strongest;
  },
 };
}
