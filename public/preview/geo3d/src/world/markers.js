// Small HTML markers that stay on their place on the 3D ground: the app's places (the valley hub
// and the I-10 exits) and the model's river inflow points with their flow this hour.
import * as THREE from 'three/webgpu';
export function createMarkers(root,camera,ground,E){
 const layer=document.createElement('div');layer.className='markers';root.appendChild(layer);
 let items=[];const v=new THREE.Vector3();
 // list: [{x,z,html,className}]; replaces what is shown.
 function set(list){
  layer.replaceChildren();
  items=list.map(m=>{const el=document.createElement('div');el.className='marker '+(m.className??'');el.innerHTML=m.html;layer.appendChild(el);return{...m,el};});
 }
 function update(){
  const w=root.clientWidth,h=root.clientHeight;
  for(const m of items){
   const g=ground(m.x,m.z);v.set(m.x,(Number.isFinite(g)?g:0)*E,m.z).project(camera);
   const on=v.z<1&&Math.abs(v.x)<1.05&&Math.abs(v.y)<1.05;m.el.style.display=on?'':'none';
   if(on)m.el.style.transform=`translate(${(v.x+1)/2*w}px,${(1-v.y)/2*h}px)`;
  }
 }
 return{set,update};
}
