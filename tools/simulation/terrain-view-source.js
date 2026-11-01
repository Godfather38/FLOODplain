import * as THREE from '../../../map-render-runtime/node_modules/three/build/three.module.js';
import {OrbitControls} from '../../../map-render-runtime/node_modules/three/examples/jsm/controls/OrbitControls.js';

// Display only: actual mean terrain, colored by the selected mean-depth frame.
export async function createTerrainView(loaded,get){
 const response=await get('data/frozen-terrain-display.json.gz');
 if(!response.ok)throw Error('Terrain HTTP '+response.status);
 const data=JSON.parse(await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).text());
 if(data.runId!==loaded.manifest.runId||data.sourceSha256!==loaded.manifest.artifact.sha256)throw Error('Terrain belongs to another run');
 const dialog=document.createElement('dialog');dialog.className='terrain-dialog';
 dialog.innerHTML='<header class="terrain-header"><div><h2>The shape of the floodplain</h2><p data-time></p></div><button aria-label="Close terrain view">Close</button></header><div class="terrain-stage" aria-label="Interactive 3D terrain"></div><footer class="terrain-footer"><strong>Drag to orbit · Scroll or pinch to zoom · Right-drag to pan</strong><br>Terrain relief ×3 for readability · 100 m cells<br>Blue = modeled mean depth; gray = missing. Colors are not a water-surface height. Frozen simulation.</footer>';
 document.body.append(dialog);dialog.querySelector('button').onclick=()=>dialog.close();
 const stage=dialog.querySelector('.terrain-stage'),scene=new THREE.Scene();scene.background=new THREE.Color('#10232d');
 const camera=new THREE.PerspectiveCamera(40,1,.01,200),renderer=new THREE.WebGLRenderer({antialias:true,alpha:false});
 renderer.setPixelRatio(Math.min(devicePixelRatio,2));stage.append(renderer.domElement);
 const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.maxPolarAngle=Math.PI*.49;controls.minDistance=6;controls.maxDistance=100;
 const vertices=data.vertices,positions=new Float32Array(vertices.length*3),colors=new Float32Array(vertices.length*3),lookup=new Map();
 vertices.forEach(([x,y,z,r,c],i)=>{positions.set([(x-16000)/1000,(z-570)/1000*3,-(y-17300)/1000],i*3);lookup.set(r+','+c,i)});
 const indices=[];vertices.forEach((v,i)=>{const r=v[3],c=v[4],east=lookup.get(r+','+(c+1)),north=lookup.get((r+1)+','+c),ne=lookup.get((r+1)+','+(c+1));if(east!==undefined&&north!==undefined)indices.push(i,east,north);if(east!==undefined&&north!==undefined&&ne!==undefined)indices.push(east,ne,north)});
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));geometry.setAttribute('color',new THREE.BufferAttribute(colors,3));geometry.setIndex(indices);geometry.computeVertexNormals();
 const material=new THREE.MeshStandardMaterial({vertexColors:true,roughness:1,metalness:0,side:THREE.DoubleSide});scene.add(new THREE.Mesh(geometry,material));
 scene.add(new THREE.HemisphereLight('#ecf9ff','#5d6758',2));const sun=new THREE.DirectionalLight('#fff4dc',2.5);sun.position.set(-20,35,10);scene.add(sun);
 function reset(){camera.position.set(23,26,32);controls.target.set(0,.5,0);controls.update()}
 const resetButton=document.createElement('button');resetButton.textContent='Reset view';resetButton.style.cssText='position:absolute;bottom:12px;right:16px;padding:10px;border-radius:8px;border:1px solid #fff5;background:#10232d;color:white';resetButton.onclick=reset;stage.append(resetButton);
 const color=new THREE.Color(),low=new THREE.Color('#b4b38c'),high=new THREE.Color('#f0e5c8');
 function update(frame){vertices.forEach((v,i)=>{const d=frame.depthM[i];if(d===null)color.set('#667980');else if(d>=.1)color.set(d>=4?'#40317d':d>=2?'#2453a5':d>=1?'#2585bc':d>=.3?'#58b5d6':'#a8def0');else color.copy(low).lerp(high,Math.min(1,(v[2]-570)/700));color.toArray(colors,i*3)});geometry.attributes.color.needsUpdate=true;dialog.querySelector('[data-time]').textContent=new Date(frame.time).toLocaleString('en-US',{timeZone:'America/Phoenix',month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'})+' MST · simulation';}
 function resize(){if(!dialog.open)return;const w=stage.clientWidth,h=stage.clientHeight;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix()}
 new ResizeObserver(resize).observe(stage);renderer.setAnimationLoop(()=>{if(dialog.open){controls.update();renderer.render(scene,camera)}});
 reset();return {update,open(frame){update(frame);dialog.showModal();resize()}};
}
