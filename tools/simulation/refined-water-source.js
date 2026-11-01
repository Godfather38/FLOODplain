import * as THREE from 'three';
import {DEPTH_COLORS,DEPTH_CUTS} from './voxel-water-source.js';

const finite=Number.isFinite;
const depthPalette=DEPTH_COLORS.map(value=>new THREE.Color(value));
// 3D display transfer function only: interpolate color in linear RGB between
// the existing quantitative palette stops. Each face keeps its own native depth;
// no neighbouring depth, surface, geometry or wet extent is interpolated here.
export function refinedDepthColor(depth){
  if(!finite(depth))return new THREE.Color('#8d969d');
  if(depth<=DEPTH_CUTS[0])return depthPalette[0].clone();
  for(let i=1;i<DEPTH_CUTS.length;i++)if(depth<=DEPTH_CUTS[i])return depthPalette[i-1].clone().lerp(depthPalette[i],(depth-DEPTH_CUTS[i-1])/(DEPTH_CUTS[i]-DEPTH_CUTS[i-1]));
  return depthPalette.at(-1).clone();
}
const geometryTables=new WeakMap();
const terrainTables=new WeakMap(),supportTables=new WeakMap(),groundTables=new WeakMap(),validatedFrames=new WeakMap();
function nativeTables(geometry){let table=geometryTables.get(geometry);if(table)return table;const ids=new Map();geometry.cells.forEach((c,i)=>{if(typeof c.nativeFaceId!=='string'||ids.has(c.nativeFaceId)||!finite(c.areaM2)||c.areaM2<=0||!finite(c.resolutionM)||c.resolutionM<=0)throw Error('Invalid native face identity/area');ids.set(c.nativeFaceId,i);});
 table={ids};geometryTables.set(geometry,table);return table;}

function inside(p,ring){
  let result=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const a=ring[j],b=ring[i],cross=(p[0]-a[0])*(b[1]-a[1])-(p[1]-a[1])*(b[0]-a[0]);
    if(Math.abs(cross)<1e-12&&p[0]>=Math.min(a[0],b[0])-1e-10&&p[0]<=Math.max(a[0],b[0])+1e-10&&p[1]>=Math.min(a[1],b[1])-1e-10&&p[1]<=Math.max(a[1],b[1])+1e-10)return true;
    if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])result=!result;
  }return result;
}
const orient=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
function crosses(a,b,c,d){const aa=orient(a,b,c),bb=orient(a,b,d),cc=orient(c,d,a),dd=orient(c,d,b);return aa*bb<0&&cc*dd<0&&Math.min(Math.abs(aa),Math.abs(bb),Math.abs(cc),Math.abs(dd))>1e-14;}

// A native terrain mesh is a separately verified artifact, never a legacy array
// whose length merely happens to match the refined output.
export function validateRefinedTerrain(manifest,geometry,terrain){
  if(manifest?.kind!=='quadtree_output_package'||!['complete','partial'].includes(manifest.status)||geometry?.runId!==manifest.runId||geometry.geometryKind!=='native_quadtree_faces')throw Error('Completed matching native geometry required');
  if(!/^[a-f0-9]{64}$/.test(manifest.geometry?.sha256)||terrain?.kind!=='native_face_triangle_terrain'||terrain.runId!==manifest.runId||terrain.geometrySha256!==manifest.geometry.sha256)throw Error('Source-bound refined terrain unavailable');
  if(typeof manifest.provenance?.verticalDatum!=='string'||!manifest.provenance.verticalDatum||terrain.verticalDatum!==manifest.provenance.verticalDatum)throw Error('Refined terrain/water datum mismatch');
  if(!Array.isArray(geometry.cells)||!geometry.cells.length||geometry.rings?.length!==geometry.cells.length)throw Error('Native geometry shape mismatch');
  // Package-reader objects are immutable, checksum-bound artifacts. Reuse a
  // validation only for the same terrain/geometry objects and binding metadata.
  const cached=terrainTables.get(terrain);if(cached?.geometry===geometry&&cached.hash===manifest.geometry.sha256&&cached.runId===manifest.runId&&cached.datum===terrain.verticalDatum)return cached.result;
  const {ids}=nativeTables(geometry),rings=[];
  // Converted rings belong to this bounded terrain model, not the whole dataset.
  // Replacing a visible mesh must release rings visited on earlier pans.
  const getRing=i=>{if(rings[i])return rings[i];const r=geometry.rings[i];if(!Array.isArray(r)||r.length<4||r.some(p=>!Array.isArray(p)||p.length!==2||!p.every(finite)||Math.abs(p[0])>90||Math.abs(p[1])>180))throw Error('Invalid variable footprint');return rings[i]=r.map(([lat,lon])=>[lon,lat]);};
  if(!Array.isArray(terrain.vertices)||terrain.vertices.some(p=>!Array.isArray(p)||p.length!==3||!p.every(finite)||Math.abs(p[0])>180||Math.abs(p[1])>90))throw Error('Invalid terrain geographic vertices');
  if(!Array.isArray(terrain.triangles)||terrain.triangleFaceId?.length!==terrain.triangles.length)throw Error('Terrain triangle/face binding required');
  if(terrain.displayResolutionM!==undefined&&(!finite(terrain.displayResolutionM)||terrain.displayResolutionM<=0))throw Error('Invalid terrain display resolution');
  const faceTriangles=[],seen=new Set(),convex=[],checkedVertices=[];
  const isConvex=face=>{if(convex[face]!==undefined)return convex[face];const ring=getRing(face);let sign=0;for(let i=0;i<ring.length;i++){const c=orient(ring[i],ring[(i+1)%ring.length],ring[(i+2)%ring.length]);if(Math.abs(c)<=1e-15)continue;const s=Math.sign(c);if(sign&&sign!==s)return convex[face]=false;sign=s;}return convex[face]=!!sign;};
  terrain.triangles.forEach((tri,k)=>{
    const face=ids.get(terrain.triangleFaceId[k]);
    if(face===undefined||!Array.isArray(tri)||tri.length!==3||new Set(tri).size!==3||tri.some(v=>!Number.isInteger(v)||v<0||v>=terrain.vertices.length))throw Error('Invalid terrain triangle or exact face ID');
    const key=face+':'+[...tri].sort((a,b)=>a-b).join(',');if(seen.has(key))throw Error('Duplicate terrain triangle');seen.add(key);
    const points=tri.map(v=>terrain.vertices[v]),ring=getRing(face);
    if(Math.abs(orient(...points))<1e-16)throw Error('Terrain triangle extends outside its native face');
    const checked=checkedVertices[face]??=new Set();for(let j=0;j<3;j++)if(!checked.has(tri[j])){if(!inside(points[j],ring))throw Error('Terrain triangle extends outside its native face');checked.add(tri[j]);}
    if(!isConvex(face))for(let j=0;j<3;j++){const a=points[j],b=points[(j+1)%3];if(!inside([(a[0]+b[0])/2,(a[1]+b[1])/2],ring))throw Error('Terrain edge outside native face');for(let q=0;q<ring.length;q++)if(crosses(a,b,ring[q],ring[(q+1)%ring.length]))throw Error('Terrain triangle crosses native face boundary');}
    (faceTriangles[face]??=[]).push(k);
  });
  const result={ids,faceTriangles,rings,getRing};terrainTables.set(terrain,{geometry,hash:manifest.geometry.sha256,runId:manifest.runId,datum:terrain.verticalDatum,result});return result;
}

function boundArtifact(manifest,artifact,kind){if(artifact?.kind!==kind||artifact.runId!==manifest.runId||artifact.geometrySha256!==manifest.geometry?.sha256||artifact.verticalDatum!==manifest.provenance?.verticalDatum||artifact.meshSha256!==undefined&&artifact.meshSha256!==manifest.provenance?.meshSha256)throw Error('Source-bound '+kind+' unavailable');}
function decodeArray(field,type){if(field?.type!==type||typeof field.base64!=='string')throw Error('Invalid native water-support encoding');const raw=atob(field.base64),bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);const C=type==='Float32Array'?Float32Array:type==='Uint32Array'?Uint32Array:Uint8Array;if(bytes.length%C.BYTES_PER_ELEMENT)throw Error('Invalid native water-support byte length');return new C(bytes.buffer);}
export function validateWaterSupport(manifest,geometry,support){
  boundArtifact(manifest,support,'native_face_water_support');const prior=supportTables.get(support);if(prior?.geometry===geometry)return prior.value;
  if(support.faceOrder!=='geometry.cells-order'||support.faceCount!==geometry.cells.length||support.byteOrder!=='little-endian')throw Error('Native water-support order/byte order mismatch');
  if(new Uint8Array(new Uint32Array([1]).buffer)[0]!==1)throw Error('Native little-endian typed-array reader required');
  const e=support.encoding,heights=decodeArray(e?.boundaryElevationM,'Float32Array'),vertexOffsets=decodeArray(e?.faceVertexOffsets,'Uint32Array'),triangleOffsets=decodeArray(e?.faceTriangleOffsets,'Uint32Array'),indices=decodeArray(e?.localTriangleIndices,'Uint8Array'),n=geometry.cells.length;
  const decodedBytes=heights.byteLength+vertexOffsets.byteLength+triangleOffsets.byteLength+indices.byteLength;
  if(decodedBytes>20*1024*1024||support.decodedBytes!==undefined&&support.decodedBytes!==decodedBytes||vertexOffsets.length!==n+1||triangleOffsets.length!==n+1||vertexOffsets[0]!==0||triangleOffsets[0]!==0||vertexOffsets[n]!==heights.length||triangleOffsets[n]*3!==indices.length)throw Error('Native water-support offsets/size mismatch');
  for(let i=0;i<n;i++){const count=vertexOffsets[i+1]-vertexOffsets[i],start=triangleOffsets[i]*3,end=triangleOffsets[i+1]*3;if(count!==geometry.rings[i].length||end<start||end>indices.length||count<3)throw Error('Native face ring/triangle offsets mismatch');for(let j=start;j<end;j+=3){const a=indices[j],b=indices[j+1],c=indices[j+2];if(a>=count||b>=count||c>=count||a===b||a===c||b===c)throw Error('Native local triangle index mismatch');}}
  if(heights.some(v=>!finite(v)))throw Error('Missing native boundary terrain');
  const value={heights,vertexOffsets,triangleOffsets,indices,decodedBytes};supportTables.set(support,{geometry,value});return value;
}
function validateOverviewGround(manifest,ground){boundArtifact(manifest,ground,'native_domain_terrain_overview');if(groundTables.has(ground))return ground;
  if(ground.coverage?.exactNativeDomain!==true)throw Error('Exact native domain overview required');
  if(!Array.isArray(ground.vertices)||!Array.isArray(ground.triangles)||ground.vertices.some(p=>!Array.isArray(p)||p.length!==3||!p.every(finite)||Math.abs(p[0])>180||Math.abs(p[1])>90)||ground.triangles.some(t=>!Array.isArray(t)||t.length!==3||t.some(i=>!Number.isInteger(i)||i<0||i>=ground.vertices.length)))throw Error('Invalid source-bound overview ground');groundTables.set(ground,true);return ground;
}

export function validateRefinedFrame(manifest,geometry,frame){
  const n=geometry.cells.length;
  if(frame?.runId!==manifest.runId||frame.geometrySha256!==manifest.geometry.sha256||!manifest.frames.some(f=>f.time===frame.time))throw Error('Native frame identity/time mismatch');
  for(const key of ['depthM','nativeVolumeM3','waterSurfaceM'])if(!Array.isArray(frame[key])||frame[key].length!==n||frame[key].some(v=>v!==null&&!finite(v)))throw Error('Native quantity shape/value mismatch');
  const tolerance=manifest.provenance.negativeVolumeDisplayToleranceM3??0;
  if(!finite(tolerance)||tolerance<0)throw Error('Invalid declared native-volume tolerance');
  frame.depthM.forEach((d,i)=>{const v=frame.nativeVolumeM3[i];if((d===null)!==(v===null)||v!==null&&v < -tolerance||d!==null&&(d<0||Math.abs(d-Math.max(0,v)/geometry.cells[i].areaM2)>1e-8))throw Error('Depth must be native volume / actual polygon area');});
  return frame;
}

export function createRefinedWater({loaded,geometry,terrain,project,altitude,origin,geometryBudget=80000,waterGeometryBudget=geometryBudget*2}){
  const manifest=loaded.manifest,overviewMode=terrain.kind==='native_face_water_support',cells=geometry.cells;
  if(manifest?.kind!=='quadtree_output_package'||!['complete','partial'].includes(manifest.status)||geometry.runId!==manifest.runId||geometry.geometryKind!=='native_quadtree_faces')throw Error('Matching native package required');
  if(overviewMode)boundArtifact(manifest,terrain,'native_face_water_support');
  const support=overviewMode?validateWaterSupport(manifest,geometry,terrain.waterSupport):null;
  const ground=overviewMode?validateOverviewGround(manifest,terrain.overviewGround):terrain;
  const validated=overviewMode?null:validateRefinedTerrain(manifest,geometry,terrain),faceTriangles=validated?.faceTriangles;
  const rings=[];const getRing=validated?.getRing||(i=>rings[i]??=geometry.rings[i].map(([lat,lon])=>[lon,lat]));
  if(!Number.isInteger(geometryBudget)||geometryBudget<1||!Number.isInteger(waterGeometryBudget)||waterGeometryBudget<1)throw Error('Positive triangle budgets required');
  let baseM=Infinity;for(const p of ground.vertices)baseM=Math.min(baseM,p[2]);if(!finite(baseM))baseM=0;
  const keyFor=(lon,lat)=>lon.toFixed(9)+','+lat.toFixed(9);
  const vertices=ground.vertices.map(p=>{const v=project(p.slice(0,2)).sub(origin);return [v.x,v.y,p[2],keyFor(p[0],p[1])];});
  const group=new THREE.Group();group.position.copy(origin);
  const atlas={terrainAtlas:{value:null},atlasBounds:{value:new THREE.Vector4()},atlasReady:{value:0}};
  // Preserve the vector map's readable colors with restrained cartographic relief.
  // Full Lambert lighting made the entire model domain a dark gray silhouette.
  const landMaterial=new THREE.MeshBasicMaterial({color:'#ffffff',side:THREE.DoubleSide});
  landMaterial.onBeforeCompile=s=>{Object.assign(s.uniforms,atlas);s.vertexShader='varying vec2 terrainXY;varying vec3 terrainNormal;\n'+s.vertexShader;s.vertexShader=s.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nterrainXY=position.xy;terrainNormal=normal;');s.fragmentShader='uniform sampler2D terrainAtlas;uniform vec4 atlasBounds;uniform float atlasReady;varying vec2 terrainXY;varying vec3 terrainNormal;\n'+s.fragmentShader;s.fragmentShader=s.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
    vec2 tex=(terrainXY-atlasBounds.xy)/atlasBounds.zw;
    if(atlasReady>.5&&all(greaterThanEqual(tex,vec2(0.)))&&all(lessThanEqual(tex,vec2(1.))))diffuseColor.rgb=texture2D(terrainAtlas,tex).rgb;else diffuseColor.rgb=vec3(.85,.85,.80);
    diffuseColor.rgb*=.82+.18*max(0.,dot(normalize(terrainNormal),normalize(vec3(-.4,.65,1.))));`);};
  const land=new THREE.Mesh(new THREE.BufferGeometry(),landMaterial);
  const metricUnit=Math.abs(altitude(1)-altitude(0));
  const waterMaterial=new THREE.ShaderMaterial({transparent:true,depthWrite:true,side:THREE.DoubleSide,vertexColors:true,
    uniforms:{clock:{value:0},unitsToMetres:{value:finite(metricUnit)&&metricUnit>0?1/metricUnit:1}},
    vertexShader:`varying vec2 xy;varying vec3 tint;varying vec3 viewDirection;
      varying vec3 surfaceX;varying vec3 surfaceY;varying vec3 surfaceUp;varying vec3 sunlight;
      void main(){xy=position.xy;tint=color;vec4 viewed=modelViewMatrix*vec4(position,1.);
        viewDirection=-viewed.xyz;surfaceX=normalize(normalMatrix*vec3(1.,0.,0.));
        surfaceY=normalize(normalMatrix*vec3(0.,1.,0.));surfaceUp=normalize(normalMatrix*vec3(0.,0.,1.));
        sunlight=normalize(normalMatrix*normalize(vec3(-.4,.65,1.)));
        gl_Position=projectionMatrix*viewed;}`,
    fragmentShader:`uniform float clock;uniform float unitsToMetres;varying vec2 xy;varying vec3 tint;
      varying vec3 viewDirection;varying vec3 surfaceX;varying vec3 surfaceY;varying vec3 surfaceUp;varying vec3 sunlight;
      void main(){
        // Cosmetic standing-ripple normals, continuous in geographic metres.
        // No vertex displacement, moving wavefront, velocity or shoreline effect.
        vec2 metres=xy*unitsToMetres,directionA=vec2(.87,.49),directionB=vec2(-.41,.91);
        float slopeA=.07*cos(dot(metres,directionA)*.65)*cos(clock*.58);
        float slopeB=.035*cos(dot(metres,directionB)*1.37)*cos(clock*.83+1.2);
        vec2 slope=slopeA*directionA+slopeB*directionB;
        vec3 normal=normalize(surfaceUp-slope.x*surfaceX-slope.y*surfaceY);
        vec3 eye=normalize(viewDirection),light=normalize(sunlight);
        float facing=clamp(abs(dot(normal,eye)),0.,1.);
        float fresnel=pow(1.-facing,3.);
        float specular=pow(max(0.,dot(normal,normalize(eye+light))),28.);
        // Keep the native quantitative depth tint dominant, including at grazing angles.
        vec3 waterColor=mix(tint,vec3(.69,.85,.94),.015+.12*fresnel);
        waterColor=mix(waterColor,vec3(.91,.97,1.),.16*specular);
        gl_FragColor=vec4(waterColor,.84);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`});
  const water=new THREE.Mesh(new THREE.BufferGeometry(),waterMaterial);water.count=0;water.renderOrder=2;
  const selection=new THREE.LineSegments(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({color:'#fff8a6',depthTest:false}));selection.renderOrder=3;selection.visible=false;
  group.add(land,water,selection);
  let visible=[],frame=null,selected=null,disposed=false,mode='aggregate',landIds=[],waterIds=[],detailRevision=0,builtRevision=-1,builtFrame=null,builtMode=null,builtCount=0,builtIds=[];
  let detailStats={overviewMode,groundTriangles:0,waterTriangles:0,visibleWetFaces:0,omittedWetFaces:0,budgetLimited:false,supportDecodedBytes:support?.decodedBytes||0};
  const projectedFaces=new Map();let projectedBytes=0,overviewLandBuilt=false;
  function write(mesh,positions,colors){const g=mesh.geometry;let a=g.getAttribute('position');if(!a||a.array.length<positions.length){a=new THREE.BufferAttribute(new Float32Array(Math.ceil(Math.max(positions.length,(a?.array.length||0)*1.5)/9)*9),3);a.setUsage(THREE.DynamicDrawUsage);g.setAttribute('position',a);}a.array.set(positions);a.needsUpdate=true;g.setDrawRange(0,positions.length/3);if(colors){let c=g.getAttribute('color');if(!c||c.array.length<a.array.length){c=new THREE.BufferAttribute(new Float32Array(a.array.length),3);c.setUsage(THREE.DynamicDrawUsage);g.setAttribute('color',c);}c.array.set(colors);c.needsUpdate=true;}g.boundingSphere=null;g.boundingBox=null;mesh.count=positions.length/9;}
  function facePoints(i){let points=projectedFaces.get(i);if(points)return points;const ring=geometry.rings[i],offset=support.vertexOffsets[i];points=ring.map(([lat,lon],j)=>{const v=project([lon,lat]).sub(origin);return [v.x,v.y,support.heights[offset+j],keyFor(lon,lat)];});projectedFaces.set(i,points);projectedBytes+=points.length*112;while(projectedBytes>8*1024*1024&&projectedFaces.size>1){const key=projectedFaces.keys().next().value,old=projectedFaces.get(key);projectedBytes-=old.length*112;projectedFaces.delete(key);}return points;}
  function forTriangles(face,visit){if(overviewMode){const p=face.points,ind=support.indices;for(let k=support.triangleOffsets[face.i]*3;k<support.triangleOffsets[face.i+1]*3;k+=3)visit(p[ind[k]],p[ind[k+1]],p[ind[k+2]]);}else for(const k of faceTriangles[face.i]){const t=terrain.triangles[k];visit(vertices[t[0]],vertices[t[1]],vertices[t[2]]);}}
  function setDetail(indices=[]){if(disposed)throw Error('Refined renderer disposed');let used=0,omittedFaces=0;const next=[],seen=new Set();for(const i of indices){if(!Number.isInteger(i)||i<0||i>=cells.length||seen.has(i))throw Error('Invalid visible native face');seen.add(i);const count=overviewMode?0:faceTriangles[i]?.length||0;if(!overviewMode&&(!count||used+count>geometryBudget)){omittedFaces++;continue;}next.push(i);used+=count;}
    const unchanged=next.length===visible.length&&next.every((v,i)=>v===visible[i]);visible=next;if(unchanged&&detailRevision)return {...detailStats,instances:land.count,triangles:land.count,visibleFaces:visible.length,omittedFaces};detailRevision++;
    if(!overviewMode||!overviewLandBuilt){const positions=[];landIds=[];if(overviewMode){for(const t of ground.triangles)for(const v of t){const p=vertices[v];positions.push(p[0],p[1],altitude(p[2]-baseM));}}else for(const i of visible)for(const k of faceTriangles[i]){for(const v of terrain.triangles[k]){const p=vertices[v];positions.push(p[0],p[1],altitude(p[2]-baseM));}landIds.push(i);}write(land,positions);land.geometry.computeVertexNormals();overviewLandBuilt=overviewMode;}
    if(visible.length){const h=overviewMode?support.heights[support.vertexOffsets[visible[0]]]:vertices[terrain.triangles[faceTriangles[visible[0]][0]][0]][2];group.position.z=origin.z-altitude(h-baseM);}
    detailStats={...detailStats,groundTriangles:land.count,omittedFaces,visibleFaces:visible.length};return {...detailStats,instances:land.count,triangles:land.count,resolutionM:ground.displayResolutionM??ground.samplingM??null,farResolutionM:ground.displayResolutionM??ground.samplingM??null};
  }
  function select(index){selected=Number.isInteger(index)&&index>=0&&index<cells.length?index:null;selection.visible=selected!==null&&!!frame&&!['off','hand'].includes(mode);if(!selection.visible)return;const positions=[],z=frame.waterSurfaceM[selected],fallback=overviewMode?support.heights[support.vertexOffsets[selected]]:faceTriangles[selected]?.length?vertices[terrain.triangles[faceTriangles[selected][0]][0]][2]:baseM;const ring=getRing(selected);for(let j=0;j<ring.length;j++)for(const p of [ring[j],ring[(j+1)%ring.length]]){const v=project(p).sub(origin);positions.push(v.x,v.y,altitude((finite(z)?z:fallback)-baseM));}write(selection,positions);}
  // Display colors join only along a shared terrain edge that is wet on BOTH
  // native faces at the vertex. Point-only contacts and dry/missing barriers
  // cannot connect their tint components. Native zs and shoreline never move.
  function sharedTints(faces){const edges=new Map(),links=new Map(),colors=new Map(faces.map(f=>[f.i,f.color]));
    const link=(p,a,b)=>{if(!(frame.waterSurfaceM[a]>p[2]&&frame.waterSurfaceM[b]>p[2]))return;let node=links.get(p[3]);if(!node)links.set(p[3],node=new Map());if(!node.has(a))node.set(a,a);if(!node.has(b))node.set(b,b);const root=x=>{while(node.get(x)!==x)x=node.get(x);return x;};node.set(root(a),root(b));};
    for(const face of faces)forTriangles(face,(a,b,c)=>{const p=[a,b,c];for(let j=0;j<3;j++){const x=p[j],y=p[(j+1)%3],key=x[3]<y[3]?x[3]+'|'+y[3]:y[3]+'|'+x[3],prior=edges.get(key);if(!prior){edges.set(key,{face:face.i,a:x,b:y});continue;}edges.delete(key);if(prior.face!==face.i){const pa=prior.a[3]===x[3]?prior.a:prior.b,pb=prior.a[3]===y[3]?prior.a:prior.b;link([x[0],x[1],Math.max(x[2],pa[2]),x[3]],prior.face,face.i);link([y[0],y[1],Math.max(y[2],pb[2]),y[3]],prior.face,face.i);}}});
    const result=new Map();for(const [key,node]of links){const sums=new Map(),root=x=>{while(node.get(x)!==x)x=node.get(x);return x;};for(const i of node.keys()){const r=root(i),s=sums.get(r)||[0,0,0,0],c=colors.get(i);s[0]+=c.r;s[1]+=c.g;s[2]+=c.b;s[3]++;sums.set(r,s);}const map=new Map();for(const i of node.keys()){const s=sums.get(root(i));map.set(i,[s[0]/s[3],s[1]/s[3],s[2]/s[3]]);}result.set(key,map);}return result;
  }
  function colored(p,i,color,tints){const tint=tints.get(p[3])?.get(i);return [p[0],p[1],p[2],tint?.[0]??color.r,tint?.[1]??color.g,tint?.[2]??color.b];}
  function clip(points,z){const out=[];for(let j=0;j<3;j++){const a=points[j],b=points[(j+1)%3],da=z-a[2],db=z-b[2];if(da>0)out.push(a);if((da>0)!==(db>0)){const t=da/(da-db);out.push([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,z,a[3]+(b[3]-a[3])*t,a[4]+(b[4]-a[4])*t,a[5]+(b[5]-a[5])*t]);}}return out;}
  function clearFrame(){water.count=0;water.geometry.setDrawRange(0,0);waterIds=[];frame=null;selection.visible=false;}
  function update(next,nextMode='aggregate'){if(disposed)throw Error('Refined renderer disposed');clearFrame();const valid=validatedFrames.get(next);if(valid?.geometry!==geometry||valid.manifest!==manifest){validateRefinedFrame(manifest,geometry,next);validatedFrames.set(next,{geometry,manifest});}frame=next;mode=nextMode;water.visible=!['off','hand'].includes(mode);
    if(next===builtFrame&&nextMode===builtMode&&builtRevision===detailRevision){water.count=builtCount;waterIds=builtIds;water.geometry.setDrawRange(0,builtCount*3);select(selected);group.updateMatrixWorld(true);return;}
    const faces=[];let sourceTriangles=0;if(water.visible)for(const i of visible){const depth=frame.depthM[i],z=frame.waterSurfaceM[i];if(!finite(depth)||depth<.01||!finite(z))continue;const count=overviewMode?support.triangleOffsets[i+1]-support.triangleOffsets[i]:faceTriangles[i]?.length||0;if(!count)continue;sourceTriangles+=count;faces.push({i,color:refinedDepthColor(depth),points:overviewMode?facePoints(i):null});}
    const tints=sharedTints(faces),maximum=Math.min(sourceTriangles*2,waterGeometryBudget)*9,g=water.geometry;
    for(const name of ['position','color']){let a=g.getAttribute(name);if(!a||a.array.length<maximum){a=new THREE.BufferAttribute(new Float32Array(Math.min(waterGeometryBudget*9,Math.ceil(Math.max(maximum,(a?.array.length||0)*1.5)/9)*9)),3);a.setUsage(THREE.DynamicDrawUsage);g.setAttribute(name,a);}}
    const positions=g.attributes.position.array,colors=g.attributes.color.array;let count=0,limited=false;waterIds=[];
    for(const face of faces){if(limited)break;const i=face.i,z=frame.waterSurfaceM[i],height=altitude(z-baseM)+.00001;forTriangles(face,(a,b,c)=>{if(limited)return;const poly=clip([colored(a,i,face.color,tints),colored(b,i,face.color,tints),colored(c,i,face.color,tints)],z);for(let j=1;j<poly.length-1;j++){if(count>=waterGeometryBudget){limited=true;break;}let k=count*9;for(const p of [poly[0],poly[j],poly[j+1]]){positions[k]=p[0];positions[k+1]=p[1];positions[k+2]=height;colors[k]=p[3];colors[k+1]=p[4];colors[k+2]=p[5];k+=3;}waterIds.push(i);count++;}});}
    if(limited){count=0;waterIds=[];}water.count=count;g.setDrawRange(0,count*3);g.attributes.position.needsUpdate=true;g.attributes.color.needsUpdate=true;g.boundingSphere=null;g.boundingBox=null;
    detailStats={...detailStats,waterTriangles:count,visibleWetFaces:faces.length,omittedWetFaces:limited?faces.length:0,budgetLimited:limited,zoomInRequired:limited,sourceWaterTriangles:sourceTriangles,projectedCacheEstimatedBytes:projectedBytes};builtFrame=next;builtMode=nextMode;builtRevision=detailRevision;builtCount=count;builtIds=waterIds;select(selected);group.updateMatrixWorld(true);
  }
  function cellInfo(i){if(!frame||!Number.isInteger(i)||i<0||i>=cells.length)return null;const cell=cells[i],d=frame.depthM[i];return {cellIndex:i,nativeFaceId:cell.nativeFaceId,areaM2:cell.areaM2,resolutionM:cell.resolutionM,time:frame.time,depthM:d,depthFt:finite(d)?d*3.280839895:null,nativeVolumeM3:frame.nativeVolumeM3[i],surfaceM:frame.waterSurfaceM[i],datum:terrain.verticalDatum};}
  function pick(ray){group.updateMatrixWorld(true);const h=water.visible?ray.intersectObject(water,false)[0]:null,g=land.visible&&!overviewMode?ray.intersectObject(land,false)[0]:null;return h&&(!g||h.distance<=g.distance)?waterIds[h.faceIndex]:g?landIds[g.faceIndex]:null;}
  return {group,land,water,baseM,update,clearFrame,select,cellInfo,pick,setDetail,
    setViewMode(value){land.visible=value!=='flat';water.visible=value!=='flat'&&!['off','hand'].includes(mode);},
    setMapTexture(texture,bounds){atlas.terrainAtlas.value?.dispose();atlas.terrainAtlas.value=texture;atlas.atlasBounds.value.copy(bounds);atlas.atlasReady.value=1;},animate(seconds){if(!disposed)waterMaterial.uniforms.clock.value=seconds;},
    get detailStats(){return detailStats;},get frame(){return frame;},get selected(){return selected;},get ids(){return waterIds;},
    dispose(){if(disposed)return;disposed=true;group.removeFromParent();projectedFaces.clear();for(const mesh of [land,water,selection]){mesh.geometry.dispose();mesh.geometry=new THREE.BufferGeometry();mesh.material.dispose();}atlas.terrainAtlas.value?.dispose();atlas.terrainAtlas.value=null;}
  };
}
