// The ground and the water are one surface, drawn by one shader. Each vertex sits on the
// ground, or on the model's water surface where water stands deeper than the display limit;
// each pixel decides water or ground from the same data. With no second surface hovering a
// few centimetres above the first, there is nothing to flicker.
import * as THREE from 'three/webgpu';
import {Fn,uniform,float,vec2,vec3,vec4,ivec2,color,texture,textureLoad,attribute,positionLocal,modelWorldMatrix,varying,mix,smoothstep,clamp,max,floor,normalize,dot,select,fwidth} from 'three/tsl';
import {GRID} from '../run-data.js';
import {W,H,STEP,SIZE_X,SIZE_Z} from './heights.js';
export function createSurface({heights,levelA,levelB,noise,exaggeration,showDepth}){
 const U={alpha:uniform(0),time:uniform(0),E:uniform(exaggeration),show:uniform(showDepth),sun:uniform(new THREE.Vector3(-.45,.8,-.35).normalize())};
 const heightTex=new THREE.DataTexture(heights,W,H,THREE.RedFormat,THREE.FloatType);heightTex.needsUpdate=true;
 const levelTex=data=>{const t=new THREE.DataTexture(data,GRID.mmax,GRID.nmax,THREE.RedFormat,THREE.FloatType);t.needsUpdate=true;return t;};
 const texA=levelTex(levelA),texB=levelTex(levelB);
 // Ground: bilinear between 10 m samples, read exactly (float textures are not filtered).
 const ground=Fn(([xz])=>{
  const u=xz.x.add(SIZE_X/2).div(STEP).sub(.5),v=float(SIZE_Z/2).sub(xz.y).div(STEP).sub(.5);
  const i=clamp(floor(u),0,W-2),j=clamp(floor(v),0,H-2),a=clamp(u.sub(i),0,1),b=clamp(v.sub(j),0,1);
  const t=(di,dj)=>textureLoad(heightTex,ivec2(i.add(di),j.add(dj))).r;
  return mix(mix(t(0,0),t(1,0),a),mix(t(0,1),t(1,1),a),b);
 });
 // Water level: bilinear between 100 m model cells, leaving out cells with no level.
 const levelIn=tex=>Fn(([xz])=>{
  const u=xz.x.add(SIZE_X/2).div(GRID.dx).sub(.5),v=float(SIZE_Z/2).sub(xz.y).div(GRID.dx).sub(.5);
  const i=clamp(floor(u),0,GRID.mmax-2),j=clamp(floor(v),0,GRID.nmax-2),a=clamp(u.sub(i),0,1),b=clamp(v.sub(j),0,1);
  const z=(di,dj)=>textureLoad(tex,ivec2(i.add(di),j.add(dj))).r,known=x=>select(x.greaterThan(-1e4),float(1),float(0));
  const z00=z(0,0),z10=z(1,0),z01=z(0,1),z11=z(1,1);
  const w00=a.oneMinus().mul(b.oneMinus()).mul(known(z00)),w10=a.mul(b.oneMinus()).mul(known(z10)),w01=a.oneMinus().mul(b).mul(known(z01)),w11=a.mul(b).mul(known(z11));
  const sum=w00.add(w10).add(w01).add(w11);
  return select(sum.greaterThan(1e-4),z00.mul(w00).add(z10.mul(w10)).add(z01.mul(w01)).add(z11.mul(w11)).div(max(sum,1e-4)),float(-1e5));
 });
 const levelA_=levelIn(texA),levelB_=levelIn(texB);
 const level=Fn(([xz])=>{const a=levelA_(xz),b=levelB_(xz);return select(a.lessThan(-1e4),b,select(b.lessThan(-1e4),a,mix(a,b,U.alpha)));});
 const worldXZ=modelWorldMatrix.mul(vec4(positionLocal,1)).xz;
 // One material for every chunk, so one shader program; each chunk brings its own painted map.
 const blank=new THREE.DataTexture(new Uint8Array([239,232,216,255]),1,1);blank.needsUpdate=true;
 const mapNode=texture(blank).onObjectUpdate(({object})=>object.userData.map??blank);
 const make=()=>{
  const material=new THREE.MeshBasicNodeMaterial({side:THREE.DoubleSide});
  const g=ground(worldXZ),s=level(worldXZ);
  const top=select(s.sub(g).greaterThan(U.show),s,g);
  // Skirts hang below chunk edges to close any crack where detail levels meet.
  material.positionNode=vec3(positionLocal.x,top.mul(U.E).sub(attribute('skirt','float').mul(60)),positionLocal.z);
  const p=varying(worldXZ,'worldXZ'),uv=varying(positionLocal.xz.div(1000),'chunkUV');
  material.colorNode=Fn(()=>{
   const here=ground(p),water=level(p),depth=water.sub(here);
   const dx=ground(p.add(vec2(STEP,0))).sub(ground(p.sub(vec2(STEP,0)))),dz=ground(p.add(vec2(0,STEP))).sub(ground(p.sub(vec2(0,STEP))));
   const normal=normalize(vec3(dx.mul(U.E).negate(),STEP*2,dz.mul(U.E).negate()));
   const light=dot(normal,U.sun).max(0).mul(.5).add(.58);
   const land=mapNode.sample(uv).rgb.mul(light);
   // Toon water: depth bands, a light shore line, and a pattern drifting downhill.
   const flow=vec2(level(p.add(vec2(50,0))).sub(level(p.sub(vec2(50,0)))),level(p.add(vec2(0,50))).sub(level(p.sub(vec2(0,50))))).negate();
   const drift=texture(noise,p.mul(.006).sub(normalize(flow.add(vec2(1e-5,0))).mul(U.time.mul(.04)))).r;
   const streak=smoothstep(.6,.66,drift).mul(smoothstep(.15,.6,depth)).mul(.28);
   const shore=float(1).sub(smoothstep(U.show,.35,depth));
   const wet=mix(color('#4cc3c6'),color('#1f6f9c'),smoothstep(.2,3,depth)).mul(mix(1,light,.35));
   const waterColour=mix(wet,color('#eef8f2'),max(shore.mul(.75),streak));
   // The shoreline blends over about one pixel, as engines antialias edges, so thin water does
   // not blink as it crosses pixel boundaries. The data and the threshold are unchanged.
   const edge=max(fwidth(depth),.002);
   return mix(land,waterColour,smoothstep(U.show.sub(edge),U.show.add(edge),depth));
  })();
  return material;
 };
 return{U,make,setLevels:(a,b)=>{texA.image.data=a;texB.image.data=b;texA.needsUpdate=texB.needsUpdate=true;}};
}
