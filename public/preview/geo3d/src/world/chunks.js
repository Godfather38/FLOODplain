// Level of detail without missing data: the ground is split into 1 km chunks, and each chunk
// draws the same height field at a resolution that suits its distance. Detail changes step by
// step with hysteresis, skirts close any gap, and the map paint follows at its own pace.
import * as THREE from 'three/webgpu';
import {SIZE_X,SIZE_Z,toWorld,worldToUtm} from './heights.js';
import {fromUtm} from '../utm.js';
import {loadVectorTile,tileRange} from './tiles.js';
import {paintChunk} from './paint.js';
import {buildStructures} from './structures.js';
import {CHUNK,LODS,lodFor} from './detail.js';
export {CHUNK,LODS,lodFor};
export function chunkGeometry(n){
 const s=n+3,positions=new Float32Array(s*s*3),skirt=new Float32Array(s*s),indices=new Uint32Array((s-1)*(s-1)*6);let w=0;
 for(let j=0;j<s;j++)for(let i=0;i<s;i++){
  const k=j*s+i,ci=Math.min(n,Math.max(0,i-1)),cj=Math.min(n,Math.max(0,j-1));
  positions[k*3]=ci/n*CHUNK;positions[k*3+2]=cj/n*CHUNK;skirt[k]=i===0||j===0||i===s-1||j===s-1?1:0;
  if(i<s-1&&j<s-1){const a=k,b=a+1,c=a+s,d=c+1;indices[w++]=a;indices[w++]=c;indices[w++]=b;indices[w++]=b;indices[w++]=c;indices[w++]=d;}
 }
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(positions,3));g.setAttribute('skirt',new THREE.BufferAttribute(skirt,1));g.setIndex(new THREE.BufferAttribute(indices,1));
 // Heights come from the shader, so the bounds cover the full exaggerated range.
 g.boundingSphere=new THREE.Sphere(new THREE.Vector3(CHUNK/2,1800,CHUNK/2),2200);
 return g;
}
const toLonLat=(x,z)=>{const u=worldToUtm(x,z);return fromUtm(u.e,u.n);};
export function createChunks(scene,material,{ground,E,structureMaterial,onChange}){
 const geometries=LODS.map(l=>chunkGeometry(l.n)),cols=Math.ceil(SIZE_X/CHUNK),rows=Math.ceil(SIZE_Z/CHUNK),list=[];
 for(let j=0;j<rows;j++)for(let i=0;i<cols;i++){
  const x0=-SIZE_X/2+i*CHUNK,z0=-SIZE_Z/2+j*CHUNK,mesh=new THREE.Mesh(geometries[3],material);
  mesh.position.set(x0,0,z0);mesh.matrixAutoUpdate=false;mesh.updateMatrix();mesh.userData.map=null;scene.add(mesh);
  list.push({x0,z0,mesh,lod:null,paintedLod:null,painting:null,structures:null,structuresLod:null});
 }
 const queue=new Set();let busy=0;
 async function paint(c,lod){
  const L=LODS[lod],tiles=await Promise.all(tileRange(c.x0,c.z0,c.x0+CHUNK,c.z0+CHUNK,L.zoom,toLonLat).map(loadVectorTile));
  if(c.lod!==lod)return;
  const canvas=document.createElement('canvas');canvas.width=canvas.height=L.px;
  paintChunk(canvas,c.x0,c.z0,CHUNK,tiles,lod<=1);
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=4;texture.flipY=false;
  c.mesh.userData.map?.dispose();c.mesh.userData.map=texture;c.paintedLod=lod;
  if(L.structures&&c.structuresLod===null){
   const features={bridges:[],buildings:[]},seen=new Set(),inside=([x,z])=>x>=c.x0&&x<c.x0+CHUNK&&z>=c.z0&&z<c.z0+CHUNK;
   for(const t of tiles){
    for(const f of t.layers.transportation??[])if(f.type===2&&f.properties.brunnel==='bridge'){const p=f.parts[0]?.[0];const key='b'+f.properties.class+Math.round(p?.[0])+','+Math.round(p?.[1]);if(p&&inside(p)&&!seen.has(key)){seen.add(key);features.bridges.push(f);}}
    for(const f of t.layers.building??[])if(f.type===3){const p=f.parts[0]?.[0];const key='h'+Math.round(p?.[0])+','+Math.round(p?.[1]);if(p&&inside(p)&&!seen.has(key)){seen.add(key);features.buildings.push(f);}}
   }
   const s=buildStructures(features,ground,E);
   if(s.indices.length){
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(s.positions,3));g.setAttribute('color',new THREE.BufferAttribute(s.colors,3));g.setIndex(new THREE.BufferAttribute(s.indices,1));g.computeBoundingSphere();
    c.structures=new THREE.Mesh(g,structureMaterial);scene.add(c.structures);
   }
   c.structuresLod=lod;c.bridgeCount=s.bridgeCount;c.buildingCount=s.buildingCount;
  }
  onChange?.();
 }
 function pump(){
  while(busy<4&&queue.size){
   // Nearest first.
   const c=[...queue].sort((a,b)=>a.distance-b.distance)[0];queue.delete(c);busy++;
   c.painting=paint(c,c.lod).catch(e=>console.warn(e)).finally(()=>{busy--;c.painting=null;if(c.paintedLod!==c.lod)queue.add(c);pump();});
  }
 }
 return{
  list,
  update(camera){
   const p=camera.position;
   for(const c of list){
    const dx=Math.max(c.x0-p.x,0,p.x-(c.x0+CHUNK)),dz=Math.max(c.z0-p.z,0,p.z-(c.z0+CHUNK));
    c.distance=Math.hypot(dx,dz,Math.max(0,p.y-2400));
    const lod=lodFor(c.distance,c.lod);
    if(lod!==c.lod){c.lod=lod;c.mesh.geometry=geometries[lod];if(c.paintedLod!==lod&&!c.painting)queue.add(c);}
    if(c.structures)c.structures.visible=c.lod<=1;
   }
   pump();
  },
  // Paint every chunk again, for example after the chosen routes change.
  repaint(){for(const c of list){c.paintedLod=null;if(!c.painting&&c.lod!==null)queue.add(c);}pump();},
  stats(){const levels=[0,0,0,0];let painted=0,bridges=0,buildings=0;for(const c of list){levels[c.lod]++;if(c.paintedLod===c.lod)painted++;bridges+=c.bridgeCount??0;buildings+=c.buildingCount??0;}return{chunks:list.length,levels,painted,queued:queue.size+busy,bridges,buildings};},
 };
}
