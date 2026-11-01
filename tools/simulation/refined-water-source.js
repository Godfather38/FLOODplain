import * as THREE from 'three';
import {depthColor} from './voxel-water-source.js';

const finite=Number.isFinite;
const geometryTables=new WeakMap();
function nativeTables(geometry){let table=geometryTables.get(geometry);if(table)return table;const ids=new Map(),rings=[];geometry.cells.forEach((c,i)=>{if(typeof c.nativeFaceId!=='string'||ids.has(c.nativeFaceId)||!finite(c.areaM2)||c.areaM2<=0||!finite(c.resolutionM)||c.resolutionM<=0)throw Error('Invalid native face identity/area');ids.set(c.nativeFaceId,i);});
 const getRing=i=>{if(rings[i])return rings[i];const r=geometry.rings[i];if(!Array.isArray(r)||r.length<4||r.some(p=>!Array.isArray(p)||p.length!==2||!p.every(finite)||Math.abs(p[0])>90||Math.abs(p[1])>180))throw Error('Invalid variable footprint');return rings[i]=r.map(([lat,lon])=>[lon,lat]);};
 table={ids,rings,getRing};geometryTables.set(geometry,table);return table;}

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
  if(!/^[a-f0-9]{64}$/.test(manifest.geometry?.sha256)||terrain?.kind!=='native_face_triangle_terrain'||terrain.runId!==manifest.runId||terrain.geometrySha256!==(manifest.compactSource?.geometry?.sha256??manifest.geometry.sha256))throw Error('Source-bound refined terrain unavailable');
  if(typeof manifest.provenance?.verticalDatum!=='string'||!manifest.provenance.verticalDatum||terrain.verticalDatum!==manifest.provenance.verticalDatum)throw Error('Refined terrain/water datum mismatch');
  if(!Array.isArray(geometry.cells)||!geometry.cells.length||geometry.rings?.length!==geometry.cells.length)throw Error('Native geometry shape mismatch');
  const {ids,rings,getRing}=nativeTables(geometry);
  if(!Array.isArray(terrain.vertices)||terrain.vertices.some(p=>!Array.isArray(p)||p.length!==3||!p.every(finite)||Math.abs(p[0])>180||Math.abs(p[1])>90))throw Error('Invalid terrain geographic vertices');
  if(!Array.isArray(terrain.triangles)||terrain.triangleFaceId?.length!==terrain.triangles.length)throw Error('Terrain triangle/face binding required');
  if(terrain.displayResolutionM!==undefined&&(!finite(terrain.displayResolutionM)||terrain.displayResolutionM<=0))throw Error('Invalid terrain display resolution');
  const faceTriangles=[],seen=new Set();
  terrain.triangles.forEach((tri,k)=>{
    const face=ids.get(terrain.triangleFaceId[k]);
    if(face===undefined||!Array.isArray(tri)||tri.length!==3||new Set(tri).size!==3||tri.some(v=>!Number.isInteger(v)||v<0||v>=terrain.vertices.length))throw Error('Invalid terrain triangle or exact face ID');
    const key=face+':'+[...tri].sort((a,b)=>a-b).join(',');if(seen.has(key))throw Error('Duplicate terrain triangle');seen.add(key);
    const points=tri.map(v=>terrain.vertices[v]),ring=getRing(face);
    if(Math.abs(orient(...points))<1e-16||points.some(p=>!inside(p,ring)))throw Error('Terrain triangle extends outside its native face');
    for(let j=0;j<3;j++){const a=points[j],b=points[(j+1)%3];if(!inside([(a[0]+b[0])/2,(a[1]+b[1])/2],ring))throw Error('Terrain edge outside native face');for(let q=0;q<ring.length;q++)if(crosses(a,b,ring[q],ring[(q+1)%ring.length]))throw Error('Terrain triangle crosses native face boundary');}
    (faceTriangles[face]??=[]).push(k);
  });
  return {ids,faceTriangles,rings,getRing};
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

export function createRefinedWater({loaded,geometry,terrain,project,altitude,origin,geometryBudget=80000}){
  const manifest=loaded.manifest,{faceTriangles,rings,getRing}=validateRefinedTerrain(manifest,geometry,terrain),cells=geometry.cells;
  if(!Number.isInteger(geometryBudget)||geometryBudget<1)throw Error('Positive triangle budget required');
  let baseM=Infinity;for(const p of terrain.vertices)baseM=Math.min(baseM,p[2]);if(!finite(baseM))baseM=0;
  const vertices=terrain.vertices.map(p=>{const v=project(p.slice(0,2)).sub(origin);return [v.x,v.y,p[2]];});
  const group=new THREE.Group();group.position.copy(origin);
  const atlas={terrainAtlas:{value:null},atlasBounds:{value:new THREE.Vector4()},atlasReady:{value:0}};
  const landMaterial=new THREE.MeshLambertMaterial({color:'#ffffff',side:THREE.DoubleSide});
  landMaterial.onBeforeCompile=s=>{Object.assign(s.uniforms,atlas);s.vertexShader='varying vec2 terrainXY;\n'+s.vertexShader;s.vertexShader=s.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nterrainXY=position.xy;');s.fragmentShader='uniform sampler2D terrainAtlas;uniform vec4 atlasBounds;uniform float atlasReady;varying vec2 terrainXY;\n'+s.fragmentShader;s.fragmentShader=s.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
    vec2 tex=(terrainXY-atlasBounds.xy)/atlasBounds.zw;
    if(atlasReady>.5&&all(greaterThanEqual(tex,vec2(0.)))&&all(lessThanEqual(tex,vec2(1.))))diffuseColor.rgb=texture2D(terrainAtlas,tex).rgb;else diffuseColor.rgb=vec3(.82,.83,.79);`);};
  const land=new THREE.Mesh(new THREE.BufferGeometry(),landMaterial);
  const waterMaterial=new THREE.ShaderMaterial({transparent:true,depthWrite:true,side:THREE.DoubleSide,vertexColors:true,uniforms:{clock:{value:0}},vertexShader:'varying vec2 xy;varying vec3 tint;void main(){xy=position.xy;tint=color;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:`uniform float clock;varying vec2 xy;varying vec3 tint;void main(){float g=pow(max(0.,sin(xy.x*15.+clock*.64)*cos(xy.y*15.-clock*.48)),10.);gl_FragColor=vec4(mix(tint,vec3(.76,.94,1.),g*.2),.84);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`});
  const water=new THREE.Mesh(new THREE.BufferGeometry(),waterMaterial);water.count=0;water.renderOrder=2;
  const selection=new THREE.LineSegments(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({color:'#fff8a6',depthTest:false}));selection.renderOrder=3;selection.visible=false;
  group.add(land,water,selection);
  let visible=[],frame=null,selected=null,disposed=false,mode='aggregate',landIds=[],waterIds=[];
  function write(mesh,positions,colors){const g=mesh.geometry;let a=g.getAttribute('position');if(!a||a.array.length<positions.length){a=new THREE.BufferAttribute(new Float32Array(Math.ceil(Math.max(positions.length,(a?.array.length||0)*1.5)/9)*9),3);a.setUsage(THREE.DynamicDrawUsage);g.setAttribute('position',a);}a.array.set(positions);a.needsUpdate=true;g.setDrawRange(0,positions.length/3);if(colors){let c=g.getAttribute('color');if(!c||c.array.length<a.array.length){c=new THREE.BufferAttribute(new Float32Array(a.array.length),3);c.setUsage(THREE.DynamicDrawUsage);g.setAttribute('color',c);}c.array.set(colors);c.needsUpdate=true;}g.boundingSphere=null;g.boundingBox=null;mesh.count=positions.length/9;}
  function setDetail(indices=[]){if(disposed)throw Error('Refined renderer disposed');let used=0,omittedFaces=0;visible=[];const seen=new Set();
    for(const i of indices){if(!Number.isInteger(i)||i<0||i>=cells.length||seen.has(i))throw Error('Invalid visible native face');seen.add(i);const count=faceTriangles[i]?.length||0;if(!count||used+count>geometryBudget){omittedFaces++;continue;}visible.push(i);used+=count;}
    const positions=[];landIds=[];for(const i of visible)for(const k of faceTriangles[i]){for(const v of terrain.triangles[k]){const p=vertices[v];positions.push(p[0],p[1],altitude(p[2]-baseM));}landIds.push(i);}
    if(visible.length){const first=vertices[terrain.triangles[faceTriangles[visible[0]][0]][0]];group.position.z=origin.z-altitude(first[2]-baseM);}
    write(land,positions);land.geometry.computeVertexNormals();
    return {instances:used,triangles:used,visibleFaces:visible.length,omittedFaces,resolutionM:terrain.displayResolutionM??null,farResolutionM:terrain.displayResolutionM??null};
  }
  function select(index){selected=Number.isInteger(index)&&index>=0&&index<cells.length?index:null;selection.visible=selected!==null&&!['off','hand'].includes(mode);if(!selection.visible)return;
    const positions=[],z=frame?.waterSurfaceM[selected],fallback=faceTriangles[selected]?.length?vertices[terrain.triangles[faceTriangles[selected][0]][0]][2]:baseM;
    const ring=getRing(selected);for(let j=0;j<ring.length;j++)for(const p of [ring[j],ring[(j+1)%ring.length]]){const v=project(p).sub(origin);positions.push(v.x,v.y,altitude((finite(z)?z:fallback)-baseM));}write(selection,positions);
  }
  function clip(points,z){const out=[];for(let j=0;j<3;j++){const a=points[j],b=points[(j+1)%3],da=z-a[2],db=z-b[2];if(da>0)out.push(a);if((da>0)!==(db>0)){const t=da/(da-db);out.push([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,z]);}}return out;}
  function clearFrame(){water.count=0;water.geometry.setDrawRange(0,0);waterIds=[];frame=null;selection.visible=false;}
  function update(next,nextMode='aggregate'){if(disposed)throw Error('Refined renderer disposed');clearFrame();validateRefinedFrame(manifest,geometry,next);frame=next;mode=nextMode;water.visible=!['off','hand'].includes(mode);
    const positions=[],colors=[];if(water.visible)for(const i of visible){const depth=frame.depthM[i],z=frame.waterSurfaceM[i];if(!finite(depth)||depth<.01||!finite(z))continue;const color=new THREE.Color(depthColor(depth));for(const k of faceTriangles[i]){const poly=clip(terrain.triangles[k].map(v=>vertices[v]),z);for(let j=1;j<poly.length-1;j++){for(const p of [poly[0],poly[j],poly[j+1]]){positions.push(p[0],p[1],altitude(z-baseM)+.00001);colors.push(color.r,color.g,color.b);}waterIds.push(i);}}}
    write(water,positions,colors);select(selected);group.updateMatrixWorld(true);
  }
  function cellInfo(i){if(!frame||!Number.isInteger(i)||i<0||i>=cells.length)return null;const cell=cells[i],d=frame.depthM[i];return {cellIndex:i,nativeFaceId:cell.nativeFaceId,areaM2:cell.areaM2,resolutionM:cell.resolutionM,time:frame.time,depthM:d,depthFt:finite(d)?d*3.280839895:null,nativeVolumeM3:frame.nativeVolumeM3[i],surfaceM:frame.waterSurfaceM[i],datum:terrain.verticalDatum};}
  function pick(ray){group.updateMatrixWorld(true);const h=water.visible?ray.intersectObject(water,false)[0]:null,g=land.visible?ray.intersectObject(land,false)[0]:null;return h&&(!g||h.distance<=g.distance)?waterIds[h.faceIndex]:g?landIds[g.faceIndex]:null;}
  return {group,land,water,baseM,update,clearFrame,select,cellInfo,pick,setDetail,
    setViewMode(value){land.visible=value!=='flat';water.visible=value!=='flat'&&!['off','hand'].includes(mode);},
    setMapTexture(texture,bounds){atlas.terrainAtlas.value?.dispose();atlas.terrainAtlas.value=texture;atlas.atlasBounds.value.copy(bounds);atlas.atlasReady.value=1;},
    animate(seconds){if(!disposed)waterMaterial.uniforms.clock.value=seconds;},
    get frame(){return frame;},get selected(){return selected;},get ids(){return waterIds;},
    dispose(){if(disposed)return;disposed=true;group.removeFromParent();for(const mesh of [land,water,selection]){mesh.geometry.dispose();mesh.material.dispose();}atlas.terrainAtlas.value?.dispose();}
  };
}
