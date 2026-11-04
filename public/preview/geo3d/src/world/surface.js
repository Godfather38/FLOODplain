// The ground and the water are one surface, drawn by one shader, so nothing hovers to flicker.
// The ground keeps its own shape. Water is shown as a tint whose strength follows the model's
// depth: shallow sheets read as wet ground, deeper channels as solid water. Only deep water
// lifts the surface, and smoothly. Zoomed out, each model cell's share of wet ground shows
// instead of specks too small to see: the same data, summarised.
import * as THREE from 'three/webgpu';
import {Fn,uniform,float,fract,vec2,vec3,vec4,ivec2,color,texture,textureLoad,attribute,positionLocal,modelWorldMatrix,varying,mix,smoothstep,clamp,max,floor,normalize,dot,select,fwidth,reflect,pow,cameraPosition} from 'three/tsl';
import {GRID} from '../run-data.js';
import {W,H,STEP,SIZE_X,SIZE_Z} from './heights.js';
export function createSurface({heights,levelA,levelB,shareA,shareB,noise,exaggeration,showDepth,handPx=1600,finePx=2048}){
 // water: 1 draws the SFINCS water, 0 leaves bare ground. hand: strength of the HAND extent tint.
 // fine: 1 draws the all-route run's water from the fine depth pictures instead of the 100 m grid.
 const U={alpha:uniform(0),time:uniform(0),E:uniform(exaggeration),show:uniform(showDepth),water:uniform(1),hand:uniform(0),fine:uniform(0),sun:uniform(new THREE.Vector3(-.45,.8,-.35).normalize())};
 // The all-route run's water for two frames: depth per pixel over the whole rectangle, coded in
 // one byte (0 = no water, 1-255 = sqrt of depth up to 16 m), mipmapped so it reads zoomed out.
 const fineW=finePx,fineH=Math.round(finePx*SIZE_Z/SIZE_X);
 const fineTex=()=>{const t=new THREE.DataTexture(new Uint8Array(fineW*fineH),fineW,fineH,THREE.RedFormat,THREE.UnsignedByteType);t.magFilter=THREE.LinearFilter;t.minFilter=THREE.LinearMipmapLinearFilter;t.generateMipmaps=true;t.needsUpdate=true;return t;};
 const fineA=fineTex(),fineB=fineTex();
 // The HAND modeled extent for the hour, painted on a canvas over the whole model rectangle.
 const handCanvas=document.createElement('canvas');handCanvas.width=handPx;handCanvas.height=Math.round(handPx*SIZE_Z/SIZE_X);
 const handTex=new THREE.CanvasTexture(handCanvas);handTex.flipY=false;
 const heightTex=new THREE.DataTexture(heights,W,H,THREE.RedFormat,THREE.FloatType);heightTex.needsUpdate=true;
 const gridTex=data=>{const t=new THREE.DataTexture(data,GRID.mmax,GRID.nmax,THREE.RedFormat,THREE.FloatType);t.needsUpdate=true;return t;};
 const texA=gridTex(levelA),texB=gridTex(levelB),shareTexA=gridTex(shareA),shareTexB=gridTex(shareB);
 // Ground: bilinear between 10 m samples, read exactly (float textures are not filtered).
 const ground=Fn(([xz])=>{
  const u=xz.x.add(SIZE_X/2).div(STEP).sub(.5),v=float(SIZE_Z/2).sub(xz.y).div(STEP).sub(.5);
  const i=clamp(floor(u),0,W-2),j=clamp(floor(v),0,H-2),a=clamp(u.sub(i),0,1),b=clamp(v.sub(j),0,1);
  const t=(di,dj)=>textureLoad(heightTex,ivec2(i.add(di),j.add(dj))).r;
  return mix(mix(t(0,0),t(1,0),a),mix(t(0,1),t(1,1),a),b);
 });
 // Values on the 100 m model grid: bilinear, leaving out cells with nothing recorded.
 const cellValue=(tex,missingBelow)=>Fn(([xz])=>{
  const u=xz.x.add(SIZE_X/2).div(GRID.dx).sub(.5),v=float(SIZE_Z/2).sub(xz.y).div(GRID.dx).sub(.5);
  const i=clamp(floor(u),0,GRID.mmax-2),j=clamp(floor(v),0,GRID.nmax-2),a=clamp(u.sub(i),0,1),b=clamp(v.sub(j),0,1);
  const z=(di,dj)=>textureLoad(tex,ivec2(i.add(di),j.add(dj))).r,known=x=>select(x.greaterThan(missingBelow),float(1),float(0));
  const z00=z(0,0),z10=z(1,0),z01=z(0,1),z11=z(1,1);
  const w00=a.oneMinus().mul(b.oneMinus()).mul(known(z00)),w10=a.mul(b.oneMinus()).mul(known(z10)),w01=a.oneMinus().mul(b).mul(known(z01)),w11=a.mul(b).mul(known(z11));
  const sum=w00.add(w10).add(w01).add(w11);
  return select(sum.greaterThan(1e-4),z00.mul(w00).add(z10.mul(w10)).add(z01.mul(w01)).add(z11.mul(w11)).div(max(sum,1e-4)),float(-1e5));
 });
 const pick=(a,b)=>select(a.lessThan(-1e4),b,select(b.lessThan(-1e4),a,mix(a,b,U.alpha)));
 const levelA_=cellValue(texA,-1e4),levelB_=cellValue(texB,-1e4),shareA_=cellValue(shareTexA,-1),shareB_=cellValue(shareTexB,-1);
 const level=Fn(([xz])=>pick(levelA_(xz),levelB_(xz)));
 const fineUv=xz=>vec2(xz.x.add(SIZE_X/2).div(SIZE_X),xz.y.add(SIZE_Z/2).div(SIZE_Z));
 const decode=v=>select(v.lessThan(.5/255),float(-1),pow(v.mul(255).sub(1).div(254).max(0),2).mul(16));
 const fineDepth=Fn(([xz])=>{const uv=fineUv(xz);return mix(decode(texture(fineA,uv).r),decode(texture(fineB,uv).r),U.alpha);});
 const share=Fn(([xz])=>max(pick(shareA_(xz),shareB_(xz)),0));
 const worldXZ=modelWorldMatrix.mul(vec4(positionLocal,1)).xz;
 const blank=new THREE.DataTexture(new Uint8Array([239,232,216,255]),1,1);blank.needsUpdate=true;
 // One material for every chunk, so one shader program; each chunk brings its own painted map.
 const mapNode=texture(blank).onObjectUpdate(({object})=>object.userData.map??blank);
 const make=()=>{
  const material=new THREE.MeshBasicNodeMaterial({side:THREE.DoubleSide});
  const g=ground(worldXZ),depthHere=select(U.fine.greaterThan(.5),fineDepth(worldXZ),level(worldXZ).sub(g)).mul(U.water);
  // Deep water lifts the surface smoothly; shallow water leaves the ground's shape alone.
  const lift=smoothstep(.4,1.5,depthHere).mul(max(depthHere,0));
  material.positionNode=vec3(positionLocal.x,g.add(lift).mul(U.E).sub(attribute('skirt','float').mul(60)),positionLocal.z);
  const p=varying(worldXZ,'worldXZ'),uv=varying(positionLocal.xz.div(1000),'chunkUV');
  material.colorNode=Fn(()=>{
   const here=ground(p),water=level(p),depth=select(U.water.greaterThan(.5),select(U.fine.greaterThan(.5),fineDepth(p),water.sub(here)),float(-1));
   const dx=ground(p.add(vec2(STEP,0))).sub(ground(p.sub(vec2(STEP,0)))),dz=ground(p.add(vec2(0,STEP))).sub(ground(p.sub(vec2(0,STEP))));
   const normal=normalize(vec3(dx.mul(U.E).negate(),STEP*2,dz.mul(U.E).negate()));
   const light=dot(normal,U.sun).max(0).mul(.5).add(.58);
   const land=mapNode.sample(uv).rgb.mul(light);
   // Water: downhill direction from the model's surface, ripples and a sun glint on top.
   const flowRaw=vec2(level(p.add(vec2(50,0))).sub(level(p.sub(vec2(50,0)))),level(p.add(vec2(0,50))).sub(level(p.sub(vec2(0,50))))).negate();
   const flow=normalize(flowRaw.add(vec2(1e-5,0)));
   const n1=texture(noise,p.mul(.03).sub(flow.mul(U.time.mul(.12)))).ga.sub(.5),n2=texture(noise,p.mul(.011).add(vec2(U.time.mul(.01),U.time.mul(-.007)))).ga.sub(.5);
   const waterNormal=normalize(vec3(n1.x.add(n2.x).mul(.35),1,n1.y.add(n2.y).mul(.35)));
   const view=normalize(cameraPosition.sub(vec3(p.x,water.mul(U.E),p.y)));
   // The glint fades as pixels grow, so it never sparkles from one frame to the next.
   const footprint=max(fwidth(p.x),fwidth(p.y));
   const glint=pow(max(dot(reflect(U.sun.negate(),waterNormal),view),0),24).mul(.3).mul(float(1).sub(smoothstep(1.5,6,footprint)));
   const streak=smoothstep(.62,.7,texture(noise,p.mul(.008).sub(flow.mul(U.time.mul(.05)))).r).mul(smoothstep(.15,.6,depth)).mul(.22);
   const deepColour=mix(color('#3fb6c8'),color('#165f93'),smoothstep(.3,3,depth));
   const strength=clamp(smoothstep(U.show,.6,depth).mul(.75).add(.25),0,1);
   const shore=float(1).sub(smoothstep(U.show,.25,depth)).mul(.5);
   const tinted=mix(land.mul(.86),deepColour,strength);
   const waterColour=mix(tinted,color('#f2fbf7'),max(shore,streak)).add(glint);
   // A soft edge a few centimetres deep: shallow sheets over bumpy ground shade smoothly
   // instead of speckling wet and dry from pixel to pixel. The data is unchanged.
   const edge=max(fwidth(depth).mul(1.5),.03);
   const close=mix(land,waterColour,smoothstep(U.show.sub(edge),U.show.add(edge),depth));
   // Zoomed out, a pixel covers many 10 m samples: show the model cell's wet share instead.
   const summary=mix(land,mix(land.mul(.86),color('#2f8fb8'),.8),smoothstep(.02,.35,share(p)));
   const modelled=mix(close,summary,smoothstep(10,30,footprint).mul(U.water).mul(float(1).sub(U.fine)));
   // HAND keeps its own depth colours from the window images, with light diagonal stripes
   // (fading out when zoomed far out) so it never reads as SFINCS water.
   const handPx=texture(handTex,vec2(p.x.add(SIZE_X/2).div(SIZE_X),p.y.add(SIZE_Z/2).div(SIZE_Z)));
   const stripe=smoothstep(.45,.55,fract(p.x.add(p.y).div(24))).mul(float(1).sub(smoothstep(2,8,footprint))).mul(.35);
   const handColour=mix(handPx.rgb,color('#f6fff9'),stripe);
   // Window images carry alpha 205/255; overlapping windows must not read darker.
   return mix(modelled,handColour,handPx.a.div(205/255).clamp(0,1).mul(U.hand).mul(.8));
  })();
  return material;
 };
 // polygons: lists of rings in world coordinates, or null to clear.
 function setHand(polygons){
  const c=handCanvas.getContext('2d'),sx=handCanvas.width/SIZE_X,sz=handCanvas.height/SIZE_Z;c.clearRect(0,0,handCanvas.width,handCanvas.height);
  if(polygons?.length){c.fillStyle='#000';c.beginPath();for(const rings of polygons)for(const ring of rings)ring.forEach(([x,z],k)=>c[k?'lineTo':'moveTo']((x+SIZE_X/2)*sx,(z+SIZE_Z/2)*sz));c.fill('evenodd');}
  handTex.needsUpdate=true;
 }
 // items: {canvas,north,south,west,east} in lat/lon, one per HAND window; toWorld(lon,lat)->[x,z].
 // Each window image is stretched over its world rectangle (axis-aligned; windows are 3 km).
 function setHandImages(items,toWorld){
  const c=handCanvas.getContext('2d'),sx=handCanvas.width/SIZE_X,sz=handCanvas.height/SIZE_Z;c.imageSmoothingEnabled=false;c.clearRect(0,0,handCanvas.width,handCanvas.height);
  for(const it of items??[]){
   const [x0,z0]=toWorld(it.west,it.north),[x1,z1]=toWorld(it.east,it.south),img=it.canvas;
   c.save();c.translate((x0+SIZE_X/2)*sx,(z0+SIZE_Z/2)*sz);c.scale((x1-x0)*sx/img.width,(z1-z0)*sz/img.height);c.drawImage(img,0,0);c.restore();
  }
  handTex.needsUpdate=true;
 }
 // a, b: Uint8Array depth codes (fineW × fineH, row 0 = north) for this frame and the next.
 function setFine(a,b){fineA.image.data=a;fineB.image.data=b;fineA.needsUpdate=true;fineB.needsUpdate=true;}
 return{U,make,setHand,setHandImages,handCanvas,setFine,fineSize:{w:fineW,h:fineH},setLevels:(a,b,sa,sb)=>{texA.image.data=a;texB.image.data=b;shareTexA.image.data=sa;shareTexB.image.data=sb;for(const t of [texA,texB,shareTexA,shareTexB])t.needsUpdate=true;}};
}
