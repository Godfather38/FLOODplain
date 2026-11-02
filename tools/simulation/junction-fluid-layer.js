import * as THREE from 'three';
import {refinedDepthColor} from './refined-water-source.js';
import {bakedPositionsToLocal,bakedNormalsToLocal} from './junction-placement.js';

// Visual treatment for the one Brawley/Avra Valley Road junction, built as a
// child of the EXISTING refined terrain/water group. Nothing here owns a camera,
// controls, canvas, render loop or map: the host steps and renders it.
//
// Three deliberate choices, because they are the easy ways to lie:
//  * The ground patch is the baked SOURCE terrain, drawn with a depth polygon
//    offset instead of a vertical lift. A lift of even a centimetre would hide
//    shallow native water behind pretty ground; an offset only wins ties.
//  * Blob colour is the existing quantitative depth palette applied to the
//    native cell-average depth under each particle, so the artwork and the
//    legend cannot disagree.
//  * Stretch, jiggle and trails are driven by the compute module's own
//    illustrative velocities. They are never scaled up to look faster, and the
//    host labels them as locally simulated rather than modelled.
export const JUNCTION_BLOB_DEFAULTS=Object.freeze({
  maxParticles:2048,mobileMaxParticles:768,
  // A blob drawn at its physical radius is about half a pixel at the zooms this
  // layer runs at, which is why the first build showed nothing. Size is a
  // DISPLAY size: at least this many screen pixels, never more than a small
  // fraction of the junction, so blobs read as water without pretending to
  // resolve a shoreline the 12.5 m source cells never had.
  minScreenRadiusPx:5,radiusGain:1.35,minRadiusMetres:0.22,maxRadiusMetres:5.5,
  // The simulated drift here is around a millimetre per second — real, and far
  // too small to see. Streaks therefore show DIRECTION at a fixed drawing
  // length; the measured speed stays a number in the legend. Only a fraction of
  // the blobs get one, so it reads as flow rather than fur.
  directionStreakPx:13,streakStride:8,minStreakSpeedMps:1e-6,
  stretch:0.3,wobble:1,opacity:0.95,highlight:0.38,flowCycleSeconds:1.5});

const QUAD_POSITIONS=new Float32Array([-1,-1,0,1,-1,0,1,1,0,-1,-1,0,1,1,0,-1,1,0]);
const LIGHT=new THREE.Vector3(-0.4,0.65,1).normalize();
const finite=Number.isFinite;
// Bound sampler for the ground material before any orthophoto arrives, so the
// shader never samples an unbound texture unit while `imageryReady` is 0.
function placeholderTexture(){
  const texture=new THREE.DataTexture(new Uint8Array([221,216,199,255]),1,1);
  texture.colorSpace=THREE.SRGBColorSpace;texture.needsUpdate=true;return texture;
}

// ---------------------------------------------------------------------------
// Baked junction geography: source terrain patch, cartographic road, markings.
// ---------------------------------------------------------------------------

const GROUND_VERTEX=`
  varying vec2 groundUv;varying vec3 groundNormal;
  void main(){groundUv=uv;groundNormal=normal;
    gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;

// The orthophoto is a REFERENCE, not a picture to paste on the map. Showing it
// raw gave a hard-edged aerial photo floating over the vector map, complete with
// a real pond that read as model water. So it is posterised into a few warm
// desert tones: the washes, tracks and scrub masses it records still shape the
// ground, but nothing in it can read as blue water, and the depth palette stays
// the loudest thing on screen. The patch edge fades into the surrounding map
// tone instead of ending in a rectangle.
const GROUND_FRAGMENT=`
  uniform sampler2D imagery;uniform vec4 imageryTransform;uniform float imageryReady;
  uniform vec3 fallbackColor;uniform vec3 shadowColor;uniform vec3 lightColor;uniform vec3 edgeColor;
  uniform float chroma;uniform float bands;uniform float feather;
  varying vec2 groundUv;varying vec3 groundNormal;
  void main(){
    vec2 tex=groundUv*imageryTransform.zw+imageryTransform.xy;
    vec3 base=fallbackColor;
    if(imageryReady>.5&&all(greaterThanEqual(tex,vec2(0.)))&&all(lessThanEqual(tex,vec2(1.)))){
      vec3 photo=texture2D(imagery,tex).rgb;
      float luma=dot(photo,vec3(.299,.587,.114));
      // Desert orthophotos sit in a narrow mid band, so stretch the contrast
      // before quantising or every tone collapses into one flat sheet. The
      // washes, tracks and scrub masses the photo records have to survive.
      float stretched=clamp((luma-.34)*2.3+.42,0.,1.);
      float stepped=floor(stretched*bands+.5)/bands;
      base=mix(shadowColor,lightColor,stepped)+(photo-vec3(luma))*chroma;
    }
    // Sculpted relief: the dip and channel should read as shape, not as a pad.
    float shade=.78+.26*max(0.,dot(normalize(groundNormal),normalize(vec3(-.4,.65,1.))));
    // Distance to the nearest patch edge, in UV, so the insert dissolves into
    // the surrounding map rather than announcing its own rectangle.
    vec2 toEdge=min(groundUv,vec2(1.)-groundUv);
    float blend=smoothstep(0.,max(feather,1e-4),min(toEdge.x,toEdge.y));
    gl_FragColor=vec4(mix(edgeColor,clamp(base,0.,1.)*shade,blend),1.);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  }`;

function bakedMeshGeometry(mesh,placement,baseElevationM){
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.BufferAttribute(bakedPositionsToLocal(mesh.positions,{placement,baseElevationM}),3));
  if(mesh.normals)geometry.setAttribute('normal',new THREE.BufferAttribute(bakedNormalsToLocal(mesh.normals,{placement}),3));
  else geometry.computeVertexNormals();
  if(mesh.uv)geometry.setAttribute('uv',new THREE.BufferAttribute(mesh.uv.slice(),2));
  geometry.computeBoundingSphere();
  return geometry;
}

// Maps the bake's scene-bounds UV into the orthophoto's own recorded extent, so
// a differently framed reference image would still land in the right place.
export function imageryTransform(sceneBounds,imageryExtent){
  if(!Array.isArray(sceneBounds)||sceneBounds.length!==4||!sceneBounds.every(finite))throw Error('Baked scene bounds are required for imagery placement');
  if(!imageryExtent)return null;
  const {xmin,ymin,xmax,ymax}=imageryExtent;
  if(![xmin,ymin,xmax,ymax].every(finite)||!(xmax>xmin)||!(ymax>ymin))throw Error('Recorded orthophoto extent is unusable');
  const spanLon=sceneBounds[2]-sceneBounds[0],spanLat=sceneBounds[3]-sceneBounds[1];
  if(!(spanLon>0)||!(spanLat>0))throw Error('Degenerate baked scene bounds');
  return [(sceneBounds[0]-xmin)/(xmax-xmin),(sceneBounds[1]-ymin)/(ymax-ymin),spanLon/(xmax-xmin),spanLat/(ymax-ymin)];
}

// The local box the host should stop drawing its own ground in. It is INSET
// from the patch, so the host ground still runs under the patch's feathered rim
// and no background can show through a gap; the thin band where both exist is
// exactly where the patch has faded into the surrounding map tone anyway.
export function junctionGroundExclusion({placement,sceneBounds,baseElevationM,insetMetres=10}={}){
  if(!placement)throw Error('A junction placement is required');
  if(!Array.isArray(sceneBounds)||sceneBounds.length!==4||!sceneBounds.every(finite))throw Error('Baked scene bounds are required for the ground exclusion');
  if(!finite(baseElevationM))throw Error('The baked base elevation is required');
  if(!finite(insetMetres)||insetMetres<0)throw Error('A non-negative ground exclusion inset is required');
  const a=placement.projectExact([sceneBounds[0],sceneBounds[1],baseElevationM]);
  const b=placement.projectExact([sceneBounds[2],sceneBounds[3],baseElevationM]);
  const inset=placement.metresToUnits(insetMetres);
  const xmin=Math.min(a[0],b[0])+inset,xmax=Math.max(a[0],b[0])-inset;
  const ymin=Math.min(a[1],b[1])+inset,ymax=Math.max(a[1],b[1])-inset;
  if(!(xmax>xmin)||!(ymax>ymin))throw Error('The ground exclusion inset is larger than the junction');
  return {xmin,ymin,xmax,ymax,insetMetres};
}

export function createJunctionGeography({baked,placement,baseElevationM,sceneBounds,imageryTexture=null,imageryExtent=null,triangleBudget=14000}={}){
  if(!baked?.meshes?.length)throw Error('A parsed baked junction asset is required');
  if(!placement)throw Error('A junction placement is required');
  if(!Number.isInteger(triangleBudget)||triangleBudget<1)throw Error('A positive junction triangle budget is required');
  if(baked.triangles>triangleBudget)throw Error('Baked junction geometry ('+baked.triangles+' triangles) exceeds the junction budget');
  const transform=imageryTexture?imageryTransform(sceneBounds,imageryExtent):null;
  const group=new THREE.Group();group.name='brawley-junction-geography';
  const materials=[],placeholder=placeholderTexture();
  const stats={groundTriangles:0,roadTriangles:0,markingTriangles:0,otherTriangles:0,imagery:!!imageryTexture&&!!transform};

  for(const mesh of baked.meshes){
    const ground=/terrain/i.test(mesh.name),marking=/marking/i.test(mesh.name),road=!ground&&!marking&&/road/i.test(mesh.name);
    const geometry=bakedMeshGeometry(mesh,placement,baseElevationM);
    let material;
    if(ground){
      material=new THREE.ShaderMaterial({vertexShader:GROUND_VERTEX,fragmentShader:GROUND_FRAGMENT,side:THREE.DoubleSide,
        uniforms:{imagery:{value:imageryTexture??placeholder},imageryTransform:{value:new THREE.Vector4(...(transform||[0,0,1,1]))},
          imageryReady:{value:imageryTexture&&transform?1:0},fallbackColor:{value:new THREE.Color('#e3dac4')},
          // Light, friendly desert tones. Darker ramps turned the junction into
          // a muddy olive pad that fought the blue water instead of carrying it.
          shadowColor:{value:new THREE.Color('#bcb094')},lightColor:{value:new THREE.Color('#f6f0e1')},
          // The surrounding vector map's own ground tone, so the patch edge has
          // something to dissolve into instead of ringing it with a bright halo.
          edgeColor:{value:new THREE.Color('#e7e6de')},
          // Low chroma keeps the photo's per-pixel scrub speckle from reading as
          // noise; the contrast stretch below is what preserves real structure.
          chroma:{value:0.26},bands:{value:4},feather:{value:0.11}}});
      stats.groundTriangles+=mesh.triangleCount;
    }else{
      material=new THREE.MeshBasicMaterial({color:marking?'#f3ead0':'#6f7471',side:THREE.DoubleSide});
      if(marking)stats.markingTriangles+=mesh.triangleCount;else if(road)stats.roadTriangles+=mesh.triangleCount;else stats.otherTriangles+=mesh.triangleCount;
    }
    // Coplanar with the refined land mesh built from the same source terrain:
    // bias the depth comparison rather than moving geometry upward, so native
    // water that sits only millimetres above the bed is never hidden.
    material.polygonOffset=true;material.polygonOffsetFactor=-2;material.polygonOffsetUnits=ground?-4:-6;
    const object=new THREE.Mesh(geometry,material);
    object.name=mesh.name;object.renderOrder=ground?0:1;
    object.userData={sourceBound:true,triangleCount:mesh.triangleCount,cartographicWidth:!ground,inferredClearance:null};
    group.add(object);materials.push(material);
  }
  stats.triangles=baked.triangles;
  group.userData={sourceRun:baked.extras?.sourceRun??null,placement:placement.provenance,
    note:'Baked source terrain and cartographic road centreline; no surveyed width, bridge clearance or imagery-derived height'};
  let disposed=false;
  return {group,stats,
    setImagery(texture){if(disposed||!texture)return false;let applied=false;
      for(const material of materials)if(material.uniforms?.imagery){material.uniforms.imagery.value=texture;material.uniforms.imageryReady.value=transform?1:0;applied=!!transform;}
      stats.imagery=applied;return applied;},
    dispose(){if(disposed)return;disposed=true;group.removeFromParent();
      for(const child of [...group.children]){child.geometry.dispose();child.material.dispose();}
      group.clear();placeholder.dispose();}};
}

// ---------------------------------------------------------------------------
// Soft cartoon blobs and their travel trails.
// ---------------------------------------------------------------------------

const BLOB_VERTEX=`
  attribute vec3 blobOffset;attribute vec3 blobDirection;attribute vec3 blobTint;
  attribute float blobScale;attribute float blobSeed;
  uniform float clock;uniform float stretch;uniform float wobble;
  varying vec2 blobUv;varying vec3 tint;varying vec2 flowDirection;varying float seed;
  void main(){
    // The quad's own corner drives the blob disc, so no UV buffer is uploaded.
    blobUv=position.xy*.5+.5;tint=blobTint;seed=blobSeed;
    vec4 centre=modelViewMatrix*vec4(blobOffset,1.);
    // blobDirection is a UNIT direction, not a speed: squash is a constant cue
    // so a millimetre-per-second drift is still readable as "this way".
    vec3 directionView=(modelViewMatrix*vec4(blobDirection,0.)).xyz;
    float planar=length(directionView.xy);
    vec2 direction=planar>1e-6?directionView.xy/planar:vec2(1.,0.);
    flowDirection=planar>1e-6?direction:vec2(0.);
    float along=1.+stretch*planar,across=inversesqrt(along);
    float jiggle=1.+wobble*.1*sin(clock*2.3+blobSeed*6.28318);
    // blobScale is already a view-space radius, so a scaled model matrix cannot
    // silently shrink the blobs.
    vec2 p=position.xy*blobScale*jiggle;
    vec2 offset=direction*(p.x*along)+vec2(-direction.y,direction.x)*(p.y*across);
    gl_Position=projectionMatrix*vec4(centre.xyz+vec3(offset,0.),1.);}`;

const BLOB_FRAGMENT=`
  uniform float opacity;uniform float highlight;uniform vec3 light;
  uniform float clock;uniform float flowCycle;uniform float wobble;
  varying vec2 blobUv;varying vec3 tint;varying vec2 flowDirection;varying float seed;
  void main(){
    vec2 d=blobUv*2.-1.;float r2=dot(d,d);
    if(r2>1.)discard;
    vec3 normal=vec3(d,sqrt(max(0.,1.-r2)));
    vec3 l=normalize(light);
    float lambert=.55+.45*max(0.,dot(normal,l));
    float rim=pow(1.-normal.z,2.6);
    float spec=pow(max(0.,dot(normal,normalize(l+vec3(0.,0.,1.)))),22.);
    // A darker shoulder gives the cartoon outline that keeps the water body
    // readable against pale desert ground.
    vec3 colour=mix(tint*.62,tint,smoothstep(1.,.74,sqrt(r2)))*lambert;
    // A bright band travelling along the simulated direction. Purely cosmetic
    // and labelled as such: it carries no speed, only which way the local
    // simulation is pushing this blob.
    float travel=flowCycle>0.?fract(clock/flowCycle+seed):0.;
    float band=length(flowDirection)>.5
      ?smoothstep(.34,0.,abs(dot(d,flowDirection)-(travel*2.4-1.2)))
      :0.;
    colour=mix(colour,vec3(.78,.92,.98),.26*rim+.22*band*wobble);
    colour+=vec3(1.)*spec*highlight;
    // A firm core with a short shoulder, so neighbouring blobs merge into one
    // body of water instead of reading as separate dots.
    float alpha=opacity*smoothstep(1.,.78,sqrt(r2));
    gl_FragColor=vec4(colour,alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  }`;

const TRAIL_VERTEX=`
  attribute vec3 trailColor;attribute float trailAlpha;
  varying vec3 colour;varying float alpha;
  void main(){colour=trailColor;alpha=trailAlpha;
    gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
const TRAIL_FRAGMENT=`
  uniform float opacity;varying vec3 colour;varying float alpha;
  void main(){gl_FragColor=vec4(colour,alpha*opacity);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  }`;

// Native cell-average depth under each particle, through the existing
// quantitative palette. Missing cells keep the palette's missing grey; they are
// not coloured as shallow water.
export function junctionBlobTints(cellIndices,depthM,count,out){
  const result=out instanceof Float32Array&&out.length>=count*3?out:new Float32Array(count*3);
  const cache=new Map();
  for(let i=0;i<count;i++){
    const index=cellIndices[i];
    let colour=cache.get(index);
    if(!colour){
      const depth=index>=0&&index<depthM.length?depthM[index]:null;
      const value=refinedDepthColor(depth===null?NaN:depth);
      cache.set(index,colour=[value.r,value.g,value.b]);
    }
    result[i*3]=colour[0];result[i*3+1]=colour[1];result[i*3+2]=colour[2];
  }
  return result;
}

export function createJunctionBlobs({placement,maxParticles=JUNCTION_BLOB_DEFAULTS.maxParticles,options={}}={}){
  if(!placement)throw Error('A junction placement is required');
  const settings={...JUNCTION_BLOB_DEFAULTS,...options};
  const capacity=Math.floor(maxParticles);
  if(!Number.isInteger(capacity)||capacity<1||capacity>4096)throw Error('Junction blob capacity must be 1-4096 particles');

  const geometry=new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position',new THREE.BufferAttribute(QUAD_POSITIONS.slice(),3));
  const attribute=(name,size)=>{const a=new THREE.InstancedBufferAttribute(new Float32Array(capacity*size),size);a.setUsage(THREE.DynamicDrawUsage);geometry.setAttribute(name,a);return a;};
  const offsets=attribute('blobOffset',3),directions=attribute('blobDirection',3),tints=attribute('blobTint',3),scales=attribute('blobScale',1),seeds=attribute('blobSeed',1);
  for(let i=0;i<capacity;i++)seeds.array[i]=((i*2654435761)%1000)/1000;
  seeds.needsUpdate=true;
  geometry.instanceCount=0;
  geometry.boundingSphere=new THREE.Sphere(new THREE.Vector3(),Infinity);

  const material=new THREE.ShaderMaterial({vertexShader:BLOB_VERTEX,fragmentShader:BLOB_FRAGMENT,transparent:true,
    depthTest:true,depthWrite:false,
    uniforms:{clock:{value:0},stretch:{value:settings.stretch},wobble:{value:settings.wobble},opacity:{value:settings.opacity},
      highlight:{value:settings.highlight},light:{value:LIGHT.clone()},flowCycle:{value:settings.flowCycleSeconds}}});
  // Blobs keep a plain depth test against the solid terrain and road, so terrain
  // still hides water behind a ridge. They are NOT depth-biased: the host turns
  // off depth writing on the native water sheet instead (setParticleOverlay),
  // which removes the only thing that could conceal them without letting a blob
  // leak through the ground.
  const blobs=new THREE.Mesh(geometry,material);blobs.name='brawley-junction-blobs';blobs.renderOrder=4;blobs.frustumCulled=false;

  // Only every Nth blob carries a direction streak, so the cloud reads as flow
  // rather than as fur on every particle.
  const stride=Math.max(1,Math.floor(settings.streakStride)),streakCapacity=Math.ceil(capacity/stride);
  const trailGeometry=new THREE.BufferGeometry();
  const trailPositions=new THREE.BufferAttribute(new Float32Array(streakCapacity*6),3);trailPositions.setUsage(THREE.DynamicDrawUsage);
  const trailColors=new THREE.BufferAttribute(new Float32Array(streakCapacity*6),3);trailColors.setUsage(THREE.DynamicDrawUsage);
  const trailAlpha=new THREE.BufferAttribute(new Float32Array(streakCapacity*2),1);trailAlpha.setUsage(THREE.DynamicDrawUsage);
  trailGeometry.setAttribute('position',trailPositions);
  trailGeometry.setAttribute('trailColor',trailColors);
  trailGeometry.setAttribute('trailAlpha',trailAlpha);
  trailGeometry.setDrawRange(0,0);
  trailGeometry.boundingSphere=new THREE.Sphere(new THREE.Vector3(),Infinity);
  const trailMaterial=new THREE.ShaderMaterial({vertexShader:TRAIL_VERTEX,fragmentShader:TRAIL_FRAGMENT,transparent:true,
    depthTest:true,depthWrite:false,uniforms:{opacity:{value:0.55}}});
  const trails=new THREE.LineSegments(trailGeometry,trailMaterial);trails.name='brawley-junction-travel';trails.renderOrder=3;trails.frustumCulled=false;

  const group=new THREE.Group();group.name='brawley-junction-fluid';group.add(trails,blobs);
  group.userData={motionMeaning:'Illustrative locally simulated motion from the published native depth and water surface; the source package has no velocity vector',
    palette:'Existing quantitative native depth palette'};

  let disposed=false,count=0,tintBuffer=null,showTrails=true,metresPerPixel=0,physicalRadiusM=0,lastMoving=false;
  const stats={capacity,count:0,blobTriangles:0,streakSegments:0,trailSegments:0,
    physicalRadiusMetres:0,radiusMetres:0,screenRadiusPx:0,streakMetres:0,streakStride:stride,
    metresPerPixel:0,trailsVisible:true,sizing:'display size: at least '+settings.minScreenRadiusPx+' screen pixels, capped at '+settings.maxRadiusMetres+' m',
    travel:'direction only, drawn at a fixed screen length; the measured speed is reported separately'};

  // Display radius, in metres. A blob at its physical radius is subpixel here,
  // so the screen floor decides at normal zooms; the metre cap stops the cloud
  // from ever claiming a wet extent far beyond the 12.5 m source cells.
  function displayRadiusMetres(){
    const physical=(finite(physicalRadiusM)?physicalRadiusM:0)*settings.radiusGain;
    const screenFloor=metresPerPixel>0?settings.minScreenRadiusPx*metresPerPixel:0;
    return Math.min(settings.maxRadiusMetres,Math.max(settings.minRadiusMetres,physical,screenFloor));
  }
  function applyScales(){
    const radius=displayRadiusMetres(),units=placement.metresToUnits(radius),scaleArray=scales.array;
    for(let i=0;i<count;i++)scaleArray[i]=units*(0.8+0.4*seeds.array[i]);
    scales.needsUpdate=true;
    stats.radiusMetres=radius;stats.metresPerPixel=metresPerPixel;
    stats.screenRadiusPx=metresPerPixel>0?radius/metresPerPixel:0;
    return radius;
  }
  function streakLengthUnits(){
    const metres=metresPerPixel>0?settings.directionStreakPx*metresPerPixel:settings.minRadiusMetres*4;
    stats.streakMetres=metres;
    return placement.metresToUnits(metres);
  }

  function update({positions,velocities:particleVelocities,cellIndices,depthM,count:next,radiusMetres,moving=true}={}){
    if(disposed)throw Error('Junction blobs disposed');
    count=Math.max(0,Math.min(capacity,Math.floor(next||0)));
    geometry.instanceCount=count;
    stats.count=count;stats.blobTriangles=count*2;lastMoving=moving;
    if(!count){trailGeometry.setDrawRange(0,0);stats.streakSegments=stats.trailSegments=0;return stats;}
    if(!positions||positions.length<count*3)throw Error('Junction particle positions are shorter than the declared count');
    physicalRadiusM=finite(radiusMetres)?radiusMetres:settings.minRadiusMetres;
    stats.physicalRadiusMetres=physicalRadiusM;
    // Absent native depth stays the palette's missing grey; it never becomes a
    // shallow-water colour because the lookup failed.
    tintBuffer=junctionBlobTints(cellIndices??[],depthM??[],count,tintBuffer);
    const streakUnits=streakLengthUnits();
    const offsetArray=offsets.array,directionArray=directions.array,tintArray=tints.array;
    const trailPositionArray=trailPositions.array,trailColorArray=trailColors.array,trailAlphaArray=trailAlpha.array;
    const hasVelocity=!!particleVelocities&&particleVelocities.length>=count*3;
    let streaks=0;
    for(let i=0;i<count;i++){
      const local=placement.toLocal([positions[i*3],positions[i*3+1],positions[i*3+2]]);
      offsetArray[i*3]=local[0];offsetArray[i*3+1]=local[1];offsetArray[i*3+2]=local[2];
      // A UNIT direction, never a speed. The solver's drift here is around a
      // millimetre per second: scaling the drawing by it would hide the
      // direction entirely, so only its sense is carried into the shader.
      let dx=0,dy=0,dz=0;
      if(moving&&hasVelocity){
        const vx=particleVelocities[i*3],vy=particleVelocities[i*3+1],vz=particleVelocities[i*3+2];
        const speed=Math.hypot(vx,vy,vz);
        if(speed>settings.minStreakSpeedMps){
          dx=vx/speed*placement.unitsPerMetre.east;
          dy=vy/speed*placement.unitsPerMetre.north;
          dz=vz/speed*placement.unitsPerMetre.up;
          const length=Math.hypot(dx,dy,dz)||1;
          dx/=length;dy/=length;dz/=length;
        }
      }
      directionArray[i*3]=dx;directionArray[i*3+1]=dy;directionArray[i*3+2]=dz;
      tintArray[i*3]=tintBuffer[i*3];tintArray[i*3+1]=tintBuffer[i*3+1];tintArray[i*3+2]=tintBuffer[i*3+2];
      if(i%stride)continue;
      const k=streaks*6;
      const drawn=dx||dy||dz?1:0;
      trailPositionArray[k]=local[0]-dx*streakUnits;trailPositionArray[k+1]=local[1]-dy*streakUnits;trailPositionArray[k+2]=local[2]-dz*streakUnits;
      trailPositionArray[k+3]=local[0];trailPositionArray[k+4]=local[1];trailPositionArray[k+5]=local[2];
      const r=tintArray[i*3]*0.65+0.3,g=tintArray[i*3+1]*0.65+0.35,b=tintArray[i*3+2]*0.65+0.4;
      trailColorArray[k]=r;trailColorArray[k+1]=g;trailColorArray[k+2]=b;
      trailColorArray[k+3]=r;trailColorArray[k+4]=g;trailColorArray[k+5]=b;
      trailAlphaArray[streaks*2]=0;trailAlphaArray[streaks*2+1]=drawn?0.95:0;
      streaks++;
    }
    applyScales();
    offsets.needsUpdate=directions.needsUpdate=tints.needsUpdate=true;
    trailPositions.needsUpdate=trailColors.needsUpdate=trailAlpha.needsUpdate=true;
    trails.visible=showTrails&&moving&&streaks>0;
    trailGeometry.setDrawRange(0,trails.visible?streaks*2:0);
    stats.streakSegments=trails.visible?streaks:0;
    stats.trailSegments=stats.streakSegments;
    stats.trailsVisible=trails.visible;
    return stats;
  }

  return {group,blobs,trails,stats,update,
    setClock(seconds){if(!disposed&&finite(seconds))material.uniforms.clock.value=seconds;},
    // The camera moved or the window resized: re-apply the screen-size floor
    // without touching particle positions or the native frame.
    setViewScale(nextMetresPerPixel){
      if(disposed||!finite(nextMetresPerPixel)||nextMetresPerPixel<=0)return stats;
      if(Math.abs(nextMetresPerPixel-metresPerPixel)<metresPerPixel*0.02)return stats;
      metresPerPixel=nextMetresPerPixel;
      if(count)applyScales();else{stats.metresPerPixel=metresPerPixel;}
      return stats;},
    setReducedMotion(reduced){if(disposed)return;showTrails=!reduced;material.uniforms.wobble.value=reduced?0:settings.wobble;
      trails.visible=!reduced&&lastMoving&&stats.streakSegments>0;if(reduced){trailGeometry.setDrawRange(0,0);stats.trailsVisible=false;}},
    setVisible(visible){if(!disposed)group.visible=!!visible;},
    get count(){return count;},
    get metresPerPixel(){return metresPerPixel;},
    dispose(){if(disposed)return;disposed=true;group.removeFromParent();
      geometry.dispose();material.dispose();trailGeometry.dispose();trailMaterial.dispose();group.clear();tintBuffer=null;}};
}
