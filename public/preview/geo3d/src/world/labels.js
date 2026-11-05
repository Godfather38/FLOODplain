// Names on the map: places, road names, wash names and the route crossings, drawn as screen
// labels that stay upright and readable. Labels that would overlap a more important one are
// hidden, and everything fades out with distance, the way map apps keep the view legible.
import * as THREE from 'three/webgpu';
const CELL=24;
export function createLabels(root,camera,ground,E){
 const items=[],layer=document.createElement('div');layer.className='labels';root.appendChild(layer);
 const add=(text,x,z,{kind,priority,reach,lift=0})=>{
  const el=document.createElement('div');el.className='label '+kind;el.textContent=text;el.style.display='none';layer.appendChild(el);
  items.push({el,x,z,y:(ground(x,z)+lift)*E,priority,reach,shown:false,width:text.length*7+16});
 };
 const v=new THREE.Vector3();
 function update(){
  const w=root.clientWidth,h=root.clientHeight,taken=new Set(),order=[...items].sort((a,b)=>b.priority-a.priority);
  for(const it of order){
   v.set(it.x,it.y,it.z);const distance=v.distanceTo(camera.position);v.project(camera);
   let show=v.z<1&&v.z>-1&&distance<it.reach&&Math.abs(v.x)<1.05&&Math.abs(v.y)<1.05;
   const sx=(v.x+1)/2*w,sy=(1-v.y)/2*h;
   if(show){
    // Greedy overlap check on a coarse screen grid: the more important label wins.
    const x0=Math.floor((sx-it.width/2)/CELL),x1=Math.floor((sx+it.width/2)/CELL),y0=Math.floor((sy-10)/CELL),y1=Math.floor((sy+10)/CELL);
    const keys=[];for(let gy=y0;gy<=y1;gy++)for(let gx=x0;gx<=x1;gx++)keys.push(gx+','+gy);
    if(keys.some(k=>taken.has(k)))show=false;else keys.forEach(k=>taken.add(k));
   }
   if(show){it.el.style.transform=`translate(${sx}px,${sy}px) translate(-50%,-100%)`;it.el.style.opacity=String(Math.min(1,(it.reach-distance)/(it.reach*.25)));}
   if(show!==it.shown){it.el.style.display=show?'':'none';it.shown=show;}
  }
 }
 return{add,update,get count(){return items.length;}};
}
