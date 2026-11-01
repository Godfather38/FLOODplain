import * as THREE from 'three';

export const DEPTH_COLORS = ['#d4eff7', '#a8def0', '#58b5d6', '#2585bc', '#2453a5', '#40317d'];
export const DEPTH_CUTS = [.01, .1, .3, 1, 2, 4];
export function depthColor(depth) {
  if (!Number.isFinite(depth)) return '#8d969d';
  return DEPTH_COLORS[Math.max(0, DEPTH_CUTS.filter(n => depth >= n).length - 1)];
}
export function validateVoxelData(loaded, terrain, footprints) {
  const n = loaded.run.cells.length;
  if (terrain.sourceSha256 !== loaded.manifest.artifact.sha256 || footprints.sourceSha256 !== terrain.sourceSha256)
    throw Error('3D data does not match the verified model run');
  if (terrain.vertices.length !== n || footprints.rings.length !== n || terrain.cellSizeM !== 100)
    throw Error('3D native grid mismatch');
  if (!terrain.verticalDatum?.includes('NAVD88')) throw Error('Native vertical datum unavailable');
  const frames = new Map(terrain.waterFrames.map(f => [f.time, f]));
  for (const f of loaded.run.frames) {
    const z = frames.get(f.time);
    if (!z || z.surfaceM.length !== n || f.depthM.length !== n) throw Error('Native water frame mismatch');
    if (z.surfaceM.some(v => v !== null && !Number.isFinite(v))) throw Error('Invalid native water level');
  }
  terrain.vertices.forEach((v, i) => {
    if (!Number.isFinite(v[2]) || footprints.rings[i].length !== 4) throw Error('Invalid native terrain cell');
  });
  return frames;
}

// No camera, map dependency, physics, or DOM ownership. Host units are supplied explicitly.
export function createVoxelWater({ loaded, terrain, footprints, project, altitude, origin, detail }) {
  const frames = validateVoxelData(loaded, terrain, footprints), n = terrain.vertices.length;
  const baseM = Math.floor(Math.min(...terrain.vertices.map(v => v[2])) / 10) * 10 - 10;
  const group = new THREE.Group(); group.position.copy(origin);
  const basis = footprints.rings.map(ring => {
    const p = ring.map(([lat, lon]) => project([lon, lat]).sub(origin));
    return { x: p.reduce((s, v) => s + v.x, 0) / 4, y: p.reduce((s, v) => s + v.y, 0) / 4,
      ax: p[1].x - p[0].x, ay: p[1].y - p[0].y, bx: p[3].x - p[0].x, by: p[3].y - p[0].y };
  });
  const matrix = new THREE.Matrix4(), color = new THREE.Color();
  const setMatrix = (b, z, h = 1) => matrix.set(b.ax,b.bx,0,b.x, b.ay,b.by,0,b.y, 0,0,h,z, 0,0,0,1);
  const landGeometry = new THREE.BoxGeometry(1,1,1);
  if(!(detail instanceof Float32Array)||detail.length!==n*100)throw Error('Native 10 m terrain detail unavailable');
  const landMaterial = new THREE.MeshLambertMaterial({ color:'#ffffff' });
  const atlasUniforms={terrainAtlas:{value:null},atlasBounds:{value:new THREE.Vector4()},atlasReady:{value:0}};
  landMaterial.onBeforeCompile=shader=>{
    Object.assign(shader.uniforms,atlasUniforms);
    shader.vertexShader='varying vec2 terrainXY;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nterrainXY=(instanceMatrix*vec4(position,1.)).xy;');
    shader.fragmentShader='uniform sampler2D terrainAtlas;uniform vec4 atlasBounds;uniform float atlasReady;varying vec2 terrainXY;\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
      vec2 atlasUV=(terrainXY-atlasBounds.xy)/atlasBounds.zw;
      if(atlasReady>.5 && all(greaterThanEqual(atlasUV,vec2(0.))) && all(lessThanEqual(atlasUV,vec2(1.))))
        diffuseColor.rgb=texture2D(terrainAtlas,atlasUV).rgb;
      else diffuseColor.rgb=vec3(.82,.83,.79);`);
  };
  const land = new THREE.InstancedMesh(landGeometry, landMaterial, Math.max(n,80000));
  let landIds=[];
  function setDetail(visibleIndices=null, subdivision=1) {
    const indices=visibleIndices||Array.from({length:n},(_,i)=>i);
    // Limit geometry count; finer terrain appears progressively as the camera approaches.
    const sub=[1,2,5,10].filter(s=>s<=subdivision&&indices.length*s*s<=80000).at(-1)||1;
    const stride=10/sub;landIds=[];let k=0;
    for(const i of indices){const b=basis[i];
      for(let sy=0;sy<sub;sy++)for(let sx=0;sx<sub;sx++){
        let z=0;for(let y=0;y<stride;y++)for(let x=0;x<stride;x++)z+=detail[i*100+(sy*stride+y)*10+sx*stride+x];
        z/=stride*stride;
        const ox=(sx+.5)/sub-.5,oy=(sy+.5)/sub-.5;
        const small={x:b.x+b.ax*ox+b.bx*oy,y:b.y+b.ay*ox+b.by*oy,ax:b.ax/sub,ay:b.ay/sub,bx:b.bx/sub,by:b.by/sub};
        const h=altitude(z-baseM);land.setMatrixAt(k,setMatrix(small,h/2,h));
        land.setColorAt(k,color.set('#ffffff'));landIds.push(i);k++;
      }
    }
    land.count=k;land.instanceMatrix.needsUpdate=true;land.instanceColor.needsUpdate=true;land.boundingSphere=null;
    return {instances:k,resolutionM:100/sub};
  }
  setDetail();
  const waterGeometry = new THREE.PlaneGeometry(1,1);
  const waterMaterial = new THREE.ShaderMaterial({
    transparent:true, depthWrite:true, depthTest:true, side:THREE.DoubleSide,
    uniforms:{clock:{value:0}},
    vertexShader:`varying vec2 tileUV; varying vec2 worldXY; varying vec3 depthTint;
      void main(){tileUV=uv; depthTint=instanceColor; vec4 local=instanceMatrix*vec4(position,1.);
        worldXY=local.xy; gl_Position=projectionMatrix*modelViewMatrix*local;}`,
    fragmentShader:`uniform float clock; varying vec2 tileUV; varying vec2 worldXY; varying vec3 depthTint;
      void main(){
        // Cosmetic standing glints only: no displacement, advection or velocity inference.
        vec2 q=tileUV*24.;
        float a=sin(q.x+sin(q.y*.71)+clock*.64);
        float b=cos(q.y*1.17+sin(q.x*.53)-clock*.48);
        float glint=pow(max(0.,a*b),10.);
        float rim=smoothstep(.012,.025,min(min(tileUV.x,1.-tileUV.x),min(tileUV.y,1.-tileUV.y)));
        vec3 c=mix(depthTint,vec3(.76,.94,1.),glint*.48);
        c=mix(c*.78,c,rim);
        gl_FragColor=vec4(c,.82);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`
  });
  const water = new THREE.InstancedMesh(waterGeometry,waterMaterial,n);
  // Allocate before the first render, including when the first frame is all missing.
  water.setColorAt(0,new THREE.Color()); water.count=0;
  water.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  water.renderOrder=2; land.frustumCulled=false; water.frustumCulled=false;
  const selectionGeometry=new THREE.EdgesGeometry(new THREE.PlaneGeometry(1,1));
  const selectionMaterial=new THREE.LineBasicMaterial({color:'#fff8a6',depthTest:false});
  const selection=new THREE.LineSegments(selectionGeometry,selectionMaterial);
  selection.matrixAutoUpdate=false; selection.visible=false; selection.renderOrder=3;
  group.add(land,water,selection);
  let frame=null, native=null, selected=null, ids=[], disposed=false, mode='aggregate';
  function select(index) {
    selected=Number.isInteger(index)&&index>=0&&index<n ? index : null;
    selection.visible=selected!==null && mode!=='off' && mode!=='hand';
    if(!selection.visible)return;
    const z=native?.surfaceM[selected];
    selection.matrix.copy(setMatrix(basis[selected],altitude((Number.isFinite(z)?z:terrain.vertices[selected][2])-baseM)));
    selection.matrixWorldNeedsUpdate=true;
  }
  function update(next,nextMode='aggregate') {
    if(disposed)throw Error('Voxel renderer disposed');
    // Clear first: never retain a preceding hour if the requested hour is absent.
    water.count=0; ids=[]; frame=next; mode=nextMode; native=frames.get(next?.time);
    if(!native||next.depthM.length!==n){selection.visible=false;throw Error('Native surface unavailable for selected hour');}
    group.visible=!['off','hand'].includes(mode);
    for(let i=0;i<n;i++) {
      const d=next.depthM[i],z=native.surfaceM[i];
      if(!Number.isFinite(d)||!Number.isFinite(z)||d<.01)continue;
      const k=ids.length;ids.push(i);
      water.setMatrixAt(k,setMatrix(basis[i],altitude(z-baseM)));
      water.setColorAt(k,color.set(depthColor(d)));
    }
    water.count=ids.length;water.instanceMatrix.needsUpdate=true;water.instanceColor.needsUpdate=true;
    water.boundingSphere=null; select(selected);group.updateMatrixWorld(true);
  }
  function cellInfo(i) {
    if(!frame||!Number.isInteger(i)||i<0||i>=n)return null;
    const depth=frame.depthM[i],z=native.surfaceM[i];
    return {cellIndex:i,row:terrain.vertices[i][3],column:terrain.vertices[i][4],time:frame.time,
      depthM:depth,depthFt:Number.isFinite(depth)?depth*3.280839895:null,
      surfaceM:z,datum:terrain.verticalDatum,terrainMeanM:terrain.vertices[i][2]};
  }
  function pick(raycaster) {
    if(!group.visible)return null;
    group.updateMatrixWorld(true);
    const hit=raycaster.intersectObject(water,false)[0];
    const ground=raycaster.intersectObject(land,false)[0];
    if(hit&&(!ground||hit.distance<=ground.distance))return ids[hit.instanceId];
    return ground?landIds[ground.instanceId]:null;
  }
  return {group,water,land,basis,baseM,update,select,cellInfo,pick,setDetail,
    setMapTexture(texture,bounds){atlasUniforms.terrainAtlas.value?.dispose();atlasUniforms.terrainAtlas.value=texture;atlasUniforms.atlasBounds.value.copy(bounds);atlasUniforms.atlasReady.value=1;},
    animate(seconds){if(!disposed)waterMaterial.uniforms.clock.value=seconds;},
    get frame(){return frame;},get selected(){return selected;},get ids(){return ids;},
    dispose(){if(disposed)return;disposed=true;group.removeFromParent();
      for(const o of [land,water]){o.geometry.dispose();o.material.dispose();o.dispose();}
      atlasUniforms.terrainAtlas.value?.dispose();selectionGeometry.dispose();selectionMaterial.dispose();}
  };
}
