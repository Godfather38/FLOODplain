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

// Geographic host supplies projection/altitude. No independent camera or physics.
export function createVoxelWater({loaded,terrain,footprints,project,altitude,origin,detail,geometryBudget=80000}) {
  const frames=validateVoxelData(loaded,terrain,footprints),n=terrain.vertices.length;
  if(!(detail instanceof Float32Array)||detail.length!==n*100)throw Error('Native 10 m terrain detail unavailable');
  const baseM=Math.floor(Math.min(...terrain.vertices.map(v=>v[2]))/10)*10-10;
  const group=new THREE.Group();group.position.copy(origin);
  const basis=footprints.rings.map(ring=>{const p=ring.map(([lat,lon])=>project([lon,lat]).sub(origin));return {x:p.reduce((s,v)=>s+v.x,0)/4,y:p.reduce((s,v)=>s+v.y,0)/4,ax:p[1].x-p[0].x,ay:p[1].y-p[0].y,bx:p[3].x-p[0].x,by:p[3].y-p[0].y};});
  const cells=new Map(terrain.vertices.map((v,i)=>[v[3]+','+v[4],i]));
  const atlas={terrainAtlas:{value:null},atlasBounds:{value:new THREE.Vector4()},atlasReady:{value:0}};
  const landMaterial=new THREE.MeshLambertMaterial({color:'#ffffff',side:THREE.DoubleSide});
  landMaterial.onBeforeCompile=s=>{Object.assign(s.uniforms,atlas);s.vertexShader='varying vec2 terrainXY;\n'+s.vertexShader;s.vertexShader=s.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nterrainXY=position.xy;');s.fragmentShader='uniform sampler2D terrainAtlas;uniform vec4 atlasBounds;uniform float atlasReady;varying vec2 terrainXY;\n'+s.fragmentShader;s.fragmentShader=s.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
    vec2 tex=(terrainXY-atlasBounds.xy)/atlasBounds.zw;
    if(atlasReady>.5&&all(greaterThanEqual(tex,vec2(0.)))&&all(lessThanEqual(tex,vec2(1.))))diffuseColor.rgb=texture2D(terrainAtlas,tex).rgb;
    else diffuseColor.rgb=vec3(.82,.83,.79);`);};
  const land=new THREE.Mesh(new THREE.BufferGeometry(),landMaterial);
  const waterMaterial=new THREE.ShaderMaterial({transparent:true,depthWrite:true,side:THREE.DoubleSide,vertexColors:true,uniforms:{clock:{value:0}},vertexShader:`varying vec2 worldXY;varying vec3 tint;void main(){worldXY=position.xy;tint=color;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,fragmentShader:`uniform float clock;varying vec2 worldXY;varying vec3 tint;void main(){vec2 q=worldXY*15.;float a=sin(q.x+sin(q.y*.71)+clock*.64);float b=cos(q.y*1.17+sin(q.x*.53)-clock*.48);float glint=pow(max(0.,a*b),10.);gl_FragColor=vec4(mix(tint,vec3(.76,.94,1.),glint*.2),.84);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`});
  const water=new THREE.Mesh(new THREE.BufferGeometry(),waterMaterial);water.renderOrder=2;water.count=0;
  const selection=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(1,1)),new THREE.LineBasicMaterial({color:'#fff8a6',depthTest:false}));selection.matrixAutoUpdate=false;selection.visible=false;selection.renderOrder=3;
  const grid=new THREE.LineSegments(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({color:'#303d45',transparent:true,opacity:.35,depthTest:false}));grid.visible=false;grid.renderOrder=3;
  group.add(land,water,selection,grid);
  let frame=null,native=null,selected=null,disposed=false,mode='aggregate',viewMode='3d',highDetail=null,visible=[],sub=1,landIds=[],ids=[];
  // Shared geographic sample coordinates give identical boundary vertices. Missing
  // neighbours contribute no invented terrain and receive no mesh triangles.
  function elevation(gx,gy,fallback) {
    const hd=highDetail?.metadata,ex=467700+gx*100,ny=3572300+gy*100;
    const fine=hd&&ex>=hd.west+.5&&ny>=hd.south+.5&&ex<=hd.west+hd.width-.5&&ny<=hd.south+hd.height-.5;
    const x=fine?ex-hd.west-.5:gx*10-.5,y=fine?ny-hd.south-.5:gy*10-.5,ix=Math.floor(x),iy=Math.floor(y);let sum=0,weight=0;
    for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++){const xx=ix+dx,yy=iy+dy,w=(dx?x-ix:1-x+ix)*(dy?y-iy:1-y+iy);let z;
      if(fine)z=highDetail.values[yy*hd.width+xx];else {const row=Math.floor(yy/10),col=Math.floor(xx/10),i=cells.get(row+','+col);if(i!==undefined)z=detail[i*100+(yy-row*10)*10+xx-col*10];}
      if(Number.isFinite(z)){sum+=z*w;weight+=w;}}
    return weight?sum/weight:terrain.vertices[fallback][2];
  }
  function point(i,x,y){const b=basis[i],v=terrain.vertices[i];return [b.x+b.ax*(x-.5)+b.bx*(y-.5),b.y+b.ay*(x-.5)+b.by*(y-.5),elevation(v[4]+x,v[3]+y,i),v[4]+x,v[3]+y];}
  function writeGeometry(mesh,positions,colors){const g=mesh.geometry;let a=g.getAttribute('position');if(!a||a.array.length<positions.length){a=new THREE.BufferAttribute(new Float32Array(Math.ceil(Math.max(positions.length,(a?.array.length||0)*1.5)/9)*9),3);a.setUsage(THREE.DynamicDrawUsage);g.setAttribute('position',a);}a.array.set(positions);a.needsUpdate=true;g.setDrawRange(0,positions.length/3);
    if(colors){let c=g.getAttribute('color');if(!c||c.array.length<colors.length){c=new THREE.BufferAttribute(new Float32Array(a.array.length),3);c.setUsage(THREE.DynamicDrawUsage);g.setAttribute('color',c);}c.array.set(colors);c.needsUpdate=true;}
    g.boundingSphere=null;g.boundingBox=null;mesh.count=positions.length/9;
  }
  function setDetail(indices=[],subdivision=1){visible=indices;
    // Anchor the local vertical origin to visible ground, avoiding an artificial
    // elevated slab above the surrounding geographic scene. Relative zs/DEM unchanged.
    if(indices.length)group.position.z=origin.z-altitude(terrain.vertices[indices[0]][2]-baseM);
    const allFine=highDetail&&indices.every(i=>{const v=terrain.vertices[i],h=highDetail.metadata;return 467700+v[4]*100>=h.west&&3572300+v[3]*100>=h.south&&467800+v[4]*100<=h.west+h.width&&3572400+v[3]*100<=h.south+h.height;});
    // One subdivision across the visible patch prevents cracks at LOD boundaries.
    sub=(allFine?[1,2,5,10,20,50,100]:[1,2,5,10]).filter(s=>s<=subdivision&&indices.length*s*s<=geometryBudget).at(-1)||1;
    const positions=[],lines=[];landIds=[];
    for(const i of indices){for(let y=0;y<sub;y++)for(let x=0;x<sub;x++){const q=[point(i,x/sub,y/sub),point(i,(x+1)/sub,y/sub),point(i,(x+1)/sub,(y+1)/sub),point(i,x/sub,(y+1)/sub)];for(const tri of [[0,1,2],[0,2,3]]){for(const j of tri)positions.push(q[j][0],q[j][1],altitude(q[j][2]-baseM));landIds.push(i);}}
      const corners=[point(i,0,0),point(i,1,0),point(i,1,1),point(i,0,1)];for(let j=0;j<4;j++)for(const p of [corners[j],corners[(j+1)%4]])lines.push(p[0],p[1],altitude(p[2]-baseM));}
    writeGeometry(land,positions);land.geometry.computeVertexNormals();writeGeometry(grid,lines);
    return {instances:indices.length*sub*sub,triangles:land.count,resolutionM:100/sub,farResolutionM:100/sub};
  }
  const wet=i=>i!==undefined&&Number.isFinite(frame?.depthM[i])&&frame.depthM[i]>=.01&&Number.isFinite(native?.surfaceM[i]);
  function waterSample(p,i){const gx=p[3]-.5,gy=p[4]-.5,x=Math.floor(gx),y=Math.floor(gy);let sum=0,depth=0,wSum=0;
    // Interpolate only between wet, present source cells. Dry/missing cells never
    // acquire water triangles. Fine terrain still clips every supported triangle.
    for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++){const j=cells.get((y+dy)+','+(x+dx));if(!wet(j))continue;const current=terrain.vertices[i],other=terrain.vertices[j];if(other[3]!==current[3]&&other[4]!==current[4]&&(!wet(cells.get(current[3]+','+other[4]))||!wet(cells.get(other[3]+','+current[4]))))continue;const w=(dx?gx-x:1-gx+x)*(dy?gy-y:1-gy+y);sum+=native.surfaceM[j]*w;depth+=frame.depthM[j]*w;wSum+=w;}
    return {...{x:p[0],y:p[1],ground:p[2]},z:wSum?sum/wSum:native.surfaceM[i],depth:wSum?depth/wSum:frame.depthM[i]};
  }
  function clip(triangle){const out=[];for(let j=0;j<3;j++){const a=triangle[j],b=triangle[(j+1)%3],da=a.z-a.ground,db=b.z-b.ground;if(da>0)out.push(a);if((da>0)!==(db>0)){const t=da/(da-db),p={};for(const key of ['x','y','ground','z','depth'])p[key]=a[key]+(b[key]-a[key])*t;out.push(p);}}return out;}
  const palette=DEPTH_COLORS.map(c=>new THREE.Color(c));
  function tint(d){let k=0;while(k<DEPTH_CUTS.length-1&&d>DEPTH_CUTS[k+1])k++;return palette[k].clone().lerp(palette[Math.min(k+1,palette.length-1)],Math.max(0,Math.min(1,(d-DEPTH_CUTS[k])/((DEPTH_CUTS[k+1]??DEPTH_CUTS[k]+1)-DEPTH_CUTS[k]))));}
  function update(next,nextMode='aggregate'){if(disposed)throw Error('Voxel renderer disposed');water.count=0;water.geometry.setDrawRange(0,0);ids=[];frame=next;mode=nextMode;native=frames.get(next?.time);
    if(!native||next.depthM.length!==n){selection.visible=false;frame=null;throw Error('Native surface unavailable for selected hour');}
    water.visible=!['off','hand'].includes(mode);land.visible=viewMode!=='flat';const positions=[],colors=[];
    if(water.visible)for(const i of visible){if(!wet(i))continue;for(let y=0;y<sub;y++)for(let x=0;x<sub;x++){const q=[point(i,x/sub,y/sub),point(i,(x+1)/sub,y/sub),point(i,(x+1)/sub,(y+1)/sub),point(i,x/sub,(y+1)/sub)].map(p=>waterSample(p,i));for(const tri of [[0,1,2],[0,2,3]]){const polygon=clip(tri.map(j=>q[j]));for(let k=1;k<polygon.length-1;k++){for(const p of [polygon[0],polygon[k],polygon[k+1]]){positions.push(p.x,p.y,viewMode==='flat'?0:altitude(p.z-baseM)+.00001);const c=tint(p.depth);colors.push(c.r,c.g,c.b);}ids.push(i);}}}}
    writeGeometry(water,positions,colors);select(selected);group.updateMatrixWorld(true);
  }
  function select(index){selected=Number.isInteger(index)&&index>=0&&index<n?index:null;selection.visible=selected!==null&&!['off','hand'].includes(mode);if(!selection.visible)return;const b=basis[selected],z=native?.surfaceM[selected];selection.matrix.set(b.ax,b.bx,0,b.x,b.ay,b.by,0,b.y,0,0,1,viewMode==='flat'?0:altitude((Number.isFinite(z)?z:terrain.vertices[selected][2])-baseM),0,0,0,1);selection.matrixWorldNeedsUpdate=true;}
  function cellInfo(i){if(!frame||!Number.isInteger(i)||i<0||i>=n)return null;const d=frame.depthM[i];return {cellIndex:i,row:terrain.vertices[i][3],column:terrain.vertices[i][4],time:frame.time,depthM:d,depthFt:Number.isFinite(d)?d*3.280839895:null,surfaceM:native.surfaceM[i],datum:terrain.verticalDatum,terrainMeanM:terrain.vertices[i][2]};}
  function pick(ray){group.updateMatrixWorld(true);const h=water.visible?ray.intersectObject(water,false)[0]:null,g=land.visible?ray.intersectObject(land,false)[0]:null;return h&&(!g||h.distance<=g.distance)?ids[h.faceIndex]:g?landIds[g.faceIndex]:null;}
  return {group,land,water,basis,baseM,update,select,cellInfo,pick,setDetail,
    setHighDetail(data){if(data.metadata.displayResolutionM!==1||data.metadata.verticalDatum!=='NAVD88'||data.values.length!==data.metadata.width*data.metadata.height)throw Error('High-resolution terrain mismatch');highDetail=data;},
    setViewMode(value){viewMode=value;land.visible=value!=='flat';if(frame)update(frame,mode);},setDiagnosticGrid(value){grid.visible=!!value;},
    setMapTexture(texture,bounds){atlas.terrainAtlas.value?.dispose();atlas.terrainAtlas.value=texture;atlas.atlasBounds.value.copy(bounds);atlas.atlasReady.value=1;},animate(seconds){if(!disposed)waterMaterial.uniforms.clock.value=seconds;},
    get frame(){return frame;},get selected(){return selected;},get ids(){return ids;},
    dispose(){if(disposed)return;disposed=true;group.removeFromParent();for(const o of [land,water,selection,grid]){o.geometry.dispose();o.material.dispose();}atlas.terrainAtlas.value?.dispose();}
  };
}
