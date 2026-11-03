// Level of detail without missing data: the ground is split into 1 km chunks, and each chunk
// draws the same height field at a resolution that suits its distance. Detail changes step by
// step with hysteresis, skirts close any gap, and the map paint follows at its own pace.
import * as THREE from 'three/webgpu';
import {SIZE_X,SIZE_Z,toWorld,worldToUtm} from './heights.js';
import {fromUtm} from '../utm.js';
import {loadVectorTile,loadImageryTile,tileRange} from './tiles.js';
import {paintChunk,baseMap} from './paint.js';
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
// lods, anisotropy and imagery ([zoom above the street tiles, highest zoom]) come from the graphics
// preset; setDetail changes them and paints again.
export function createChunks(scene,material,{ground,E,structureMaterial,onChange,lods=LODS,anisotropy=4,imagery:satellite=[2,17]}){
 let geometries=lods.map(l=>chunkGeometry(l.n)),gen=0;const cols=Math.ceil(SIZE_X/CHUNK),rows=Math.ceil(SIZE_Z/CHUNK),list=[];
 for(let j=0;j<rows;j++)for(let i=0;i<cols;i++){
  const x0=-SIZE_X/2+i*CHUNK,z0=-SIZE_Z/2+j*CHUNK,mesh=new THREE.Mesh(geometries[3],material);
  mesh.position.set(x0,0,z0);mesh.matrixAutoUpdate=false;mesh.updateMatrix();mesh.userData.map=null;scene.add(mesh);
  list.push({x0,z0,mesh,lod:null,paintedLod:null,painting:null,structures:null,structuresLod:null,maps:[]});
 }
 // Painted maps are kept per detail level, so zooming back shows them at once. New painting waits
 // while the camera moves (the coarser map stays meanwhile) and starts one chunk per frame.
 const queue=new Set(),last=new THREE.Vector3(),lastQ=new THREE.Quaternion();let busy=0,stillSince=0,moving=false;
 async function paint(c,lod){
  const L=lods[lod],kind=baseMap.kind,ticket=gen,tiles=await Promise.all(tileRange(c.x0,c.z0,c.x0+CHUNK,c.z0+CHUNK,L.zoom,toLonLat).map(loadVectorTile));
  const imagery=kind==='satellite'?await Promise.all(tileRange(c.x0,c.z0,c.x0+CHUNK,c.z0+CHUNK,Math.min(satellite[1],L.zoom+satellite[0]),toLonLat).map(loadImageryTile)):null;
  if(c.lod!==lod||kind!==baseMap.kind||ticket!==gen)return;
  const canvas=document.createElement('canvas');canvas.width=canvas.height=L.px;
  paintChunk(canvas,c.x0,c.z0,CHUNK,tiles,lod<=1,imagery);
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=anisotropy;texture.flipY=false;
  c.maps[lod]?.dispose();c.maps[lod]=texture;c.mesh.userData.map=texture;c.paintedLod=lod;
  // Keep the levels next to the current one; finer maps far from the camera are let go.
  for(let k=0;k<lod-1;k++)if(c.maps[k]&&c.maps[k]!==c.mesh.userData.map){c.maps[k].dispose();c.maps[k]=null;}
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
 function pump(hold=moving){
  let started=0;
  while(busy<4&&queue.size&&started<1&&!hold){started++;
   // Nearest first.
   const c=[...queue].sort((a,b)=>a.distance-b.distance)[0];queue.delete(c);busy++;
   c.painting=paint(c,c.lod).catch(e=>console.warn(e)).finally(()=>{busy--;c.painting=null;if(c.paintedLod!==c.lod)queue.add(c);pump();});
  }
 }
 return{
  list,
  update(camera){
   const p=camera.position,now=performance.now();
   if(p.distanceToSquared(last)>1e-4||camera.quaternion.angleTo(lastQ)>1e-5){stillSince=now;last.copy(p);lastQ.copy(camera.quaternion);}
   moving=now-stillSince<180;
   for(const c of list){
    const dx=Math.max(c.x0-p.x,0,p.x-(c.x0+CHUNK)),dz=Math.max(c.z0-p.z,0,p.z-(c.z0+CHUNK));
    c.distance=Math.hypot(dx,dz,Math.max(0,p.y-2400));
    const lod=lodFor(c.distance,c.lod,lods);
    if(lod!==c.lod){
     c.lod=lod;c.mesh.geometry=geometries[lod];
     for(let k=0;k<lod-1;k++)if(c.maps[k]&&c.maps[k]!==c.mesh.userData.map){c.maps[k].dispose();c.maps[k]=null;}
     if(c.maps[lod]){c.mesh.userData.map=c.maps[lod];c.paintedLod=lod;}
     else if(!c.painting)queue.add(c);
    }
    if(c.structures)c.structures.visible=c.lod<=1;
   }
   // A chunk with no map at all is painted even while moving.
   pump(moving&&![...queue].some(c=>!c.mesh.userData.map));
  },
  // Paint every chunk again, for example after the chosen routes change.
  repaint(){for(const c of list){c.paintedLod=null;c.maps.forEach((m,k)=>{if(m&&k!==c.lod){m.dispose();c.maps[k]=null;}});if(!c.painting&&c.lod!==null)queue.add(c);}pump(false);},
  // A new graphics preset: new ground meshes and map resolution, painted again from the nearest.
  setDetail(detail){
   gen++;geometries.forEach(g=>g.dispose());lods=detail.lods??lods;anisotropy=detail.anisotropy??anisotropy;satellite=detail.imagery??satellite;
   geometries=lods.map(l=>chunkGeometry(l.n));queue.clear();
   for(const c of list){c.maps.forEach(m=>m?.dispose());c.maps=[];c.mesh.userData.map=null;c.paintedLod=null;c.lod=null;c.mesh.geometry=geometries[geometries.length-1];}
  },
  stats(){const levels=[0,0,0,0];let painted=0,bridges=0,buildings=0;for(const c of list){levels[c.lod]++;if(c.paintedLod===c.lod)painted++;bridges+=c.bridgeCount??0;buildings+=c.buildingCount??0;}return{chunks:list.length,levels,painted,queued:queue.size+busy,bridges,buildings};},
 };
}
