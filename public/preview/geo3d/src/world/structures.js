// What stands up from the ground: bridges and buildings, built from the map's own data on the
// one shared height field. Bridges run between their real abutments and stand on piers.
import * as THREE from 'three/webgpu';
import {roadWidth} from './paint.js';
const SUN=new THREE.Vector3(-.45,.8,-.35).normalize();
const shade=(rgb,nx,ny,nz)=>{const l=.6+.4*Math.max(0,nx*SUN.x+ny*SUN.y+nz*SUN.z);return[rgb[0]*l,rgb[1]*l,rgb[2]*l];};
const hex=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16)/255);
const DECK=hex('#f7f3ea'),SIDE=hex('#c4beb2'),PIER=hex('#b9b3a8'),WALL=hex('#e1d8c9'),ROOF=hex('#efe9de'),MOTORWAY=hex('#f6c86a');
export function buildStructures(features,ground,E,{bridges=true,buildings=true}={}){
 const positions=[],colors=[],indices=[];
 const tri=(a,b,c,rgb)=>{
  const ux=b[0]-a[0],uy=b[1]-a[1],uz=b[2]-a[2],vx=c[0]-a[0],vy=c[1]-a[1],vz=c[2]-a[2];
  let nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;const l=Math.hypot(nx,ny,nz)||1;nx/=l;ny/=l;nz/=l;if(ny<0){nx=-nx;ny=-ny;nz=-nz;}
  const col=shade(rgb,nx,ny,nz),base=positions.length/3;
  for(const p of [a,b,c]){positions.push(p[0],p[1],p[2]);colors.push(...col);}
  indices.push(base,base+1,base+2);
 };
 const quad=(a,b,c,d,rgb)=>{tri(a,b,c,rgb);tri(b,d,c,rgb);};
 const box=(x,z,y0,y1,hu,hv,ca,sa,rgb)=>{
  const k=[[-hu,-hv],[hu,-hv],[hu,hv],[-hu,hv]].map(([u,v])=>[x+ca*u-sa*v,z+sa*u+ca*v]);
  for(let i=0;i<4;i++){const p=k[i],q=k[(i+1)%4];quad([p[0],y1,p[1]],[q[0],y1,q[1]],[p[0],y0,p[1]],[q[0],y0,q[1]],rgb);}
  quad([k[0][0],y1,k[0][1]],[k[1][0],y1,k[1][1]],[k[3][0],y1,k[3][1]],[k[2][0],y1,k[2][1]],rgb);
 };
 let bridgeCount=0,buildingCount=0;
 if(bridges)for(const f of features.bridges){
  for(const line of f.parts){
   if(line.length<2)continue;
   // Resample every 10 m along the deck.
   const pts=[line[0]];for(let i=1;i<line.length;i++){const a=line[i-1],b=line[i],n=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/10));for(let s=1;s<=n;s++)pts.push([a[0]+(b[0]-a[0])*s/n,a[1]+(b[1]-a[1])*s/n]);}
   const ends=[ground(...pts[0]),ground(...pts.at(-1))],half=roadWidth(f.properties.class)/2,thick=1.4;
   const top=pts.map((p,i)=>{const t=i/(pts.length-1),straight=ends[0]*(1-t)+ends[1]*t;return Math.max(straight,ground(...p)+1)*E+.6;});
   const top3=top.map((y,i)=>{const p=pts[Math.max(0,i-1)],q=pts[Math.min(pts.length-1,i+1)],dx=q[0]-p[0],dz=q[1]-p[1],l=Math.hypot(dx,dz)||1;return{x:pts[i][0],z:pts[i][1],y,nx:-dz/l,nz:dx/l,ca:dx/l,sa:dz/l};});
   const surface=f.properties.class==='motorway'?MOTORWAY:DECK;
   for(let i=1;i<top3.length;i++){
    const a=top3[i-1],b=top3[i];
    const L=(r,o,dy=0)=>[r.x+r.nx*o,r.y+dy,r.z+r.nz*o];
    quad(L(a,-half),L(a,half),L(b,-half),L(b,half),surface);
    for(const side of [-1,1]){quad(L(a,side*half),L(b,side*half),L(a,side*half,-thick),L(b,side*half,-thick),SIDE);quad(L(a,side*half),L(b,side*half),L(a,side*half,1.1*E),L(b,side*half,1.1*E),SIDE);}
    quad(L(a,-half,-thick),L(a,half,-thick),L(b,-half,-thick),L(b,half,-thick),SIDE);
   }
   top3.forEach((r,i)=>{if(i%3||i===0||i===top3.length-1)return;const g=ground(r.x,r.z)*E;if(r.y-thick-g<1.5)return;box(r.x,r.z,g-1,r.y-thick,.9,half*.75,r.ca,r.sa,PIER);});
   bridgeCount++;
  }
 }
 if(buildings)for(const f of features.buildings){
  for(const poly of f.polygons??[]){
   const outer=poly[0];if(!outer||outer.length<3)continue;
   let base=Infinity;for(const [x,z] of outer)base=Math.min(base,ground(x,z));
   const y0=base*E-.5,y1=base*E+Math.max(3,Number(f.properties.render_height)||5)*E;
   const shape=outer.map(([x,z])=>new THREE.Vector2(x,z)),holes=poly.slice(1).map(r=>r.map(([x,z])=>new THREE.Vector2(x,z)));
   for(const [a,b,c] of THREE.ShapeUtils.triangulateShape(shape,holes)){const all=[...shape,...holes.flat()];tri([all[a].x,y1,all[a].y],[all[b].x,y1,all[b].y],[all[c].x,y1,all[c].y],ROOF);}
   for(const ring of poly)for(let i=0;i<ring.length;i++){const p=ring[i],q=ring[(i+1)%ring.length];quad([p[0],y1,p[1]],[q[0],y1,q[1]],[p[0],y0,p[1]],[q[0],y0,q[1]],WALL);}
   buildingCount++;
  }
 }
 return{positions:new Float32Array(positions),colors:new Float32Array(colors),indices:new Uint32Array(indices),bridgeCount,buildingCount};
}
