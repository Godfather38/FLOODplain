// Real WebGL regression for unknown design-storm cells during frame interpolation.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join,normalize,extname} from 'node:path';
import {chromium} from 'playwright';
const root=fileURLToPath(new URL('../public/',import.meta.url));
const html=`<!doctype html><script type="importmap">{"imports":{"three/webgpu":"/preview/coastal-lowcost/vendor/three.webgpu.js","three/tsl":"/preview/coastal-lowcost/vendor/three.tsl.js"}}</script>`;
const server=createServer((req,res)=>{const path=new URL(req.url,'http://x').pathname;if(path==='/shader'){res.setHeader('Content-Type','text/html');return res.end(html);}const file=normalize(join(root,path));if(!file.startsWith(root)||!existsSync(file)){res.writeHead(404);return res.end();}res.setHeader('Content-Type',extname(file)==='.js'?'text/javascript':'application/octet-stream');res.end(readFileSync(file));});
await new Promise(r=>server.listen(0,r));
const browser=await chromium.launch({channel:'chrome',args:['--enable-unsafe-swiftshader']});
try{const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://localhost:'+server.address().port+'/shader');
 const result=await page.evaluate(async()=>{
  const THREE=await import('/preview/coastal-lowcost/vendor/three.webgpu.js'),{createSurface}=await import('/preview/geo3d/src/world/surface.js'),{W,H}=await import('/preview/geo3d/src/world/heights.js'),{GRID}=await import('/preview/geo3d/src/run-data.js');
  const renderer=new THREE.WebGPURenderer({forceWebGL:true});await renderer.init();renderer.setSize(64,64);renderer.toneMapping=THREE.NoToneMapping;
  const n=GRID.mmax*GRID.nmax,z=new Float32Array(n),noise=new THREE.DataTexture(new Uint8Array([128,128,128,128]),1,1);noise.needsUpdate=true;
  const s=createSurface({heights:new Float32Array(W*H),levelA:z,levelB:z,shareA:z,shareB:z,noise,exaggeration:1,showDepth:.01,handPx:4,finePx:4});s.U.fine.value=1;
  const geo=new THREE.PlaneGeometry(20,20);geo.rotateX(-Math.PI/2);geo.setAttribute('skirt',new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count),1));
  const scene=new THREE.Scene();scene.add(new THREE.Mesh(geo,s.make()));const camera=new THREE.OrthographicCamera(-5,5,5,-5,.1,100);camera.position.set(0,40,.01);camera.lookAt(0,0,0);
  const target=new THREE.RenderTarget(64,64);renderer.setRenderTarget(target);
  const size=s.fineSize.w*s.fineSize.h,depth=new Uint8Array(size).fill(200),known={depth,unknown:new Uint8Array(size)},unknown={depth,unknown:new Uint8Array(size).fill(255)};
  async function draw(a,b,alpha){s.setFine(a,b);s.U.alpha.value=alpha;await renderer.renderAsync(scene,camera);return Array.from(await renderer.readRenderTargetPixelsAsync(target,32,32,1,1));}
  const wet=await draw(known,known,0),dry=await draw(unknown,unknown,0),forward=[],reverse=[];
  for(const alpha of [0,.5,1]){forward.push(await draw(unknown,known,alpha));reverse.push(await draw(known,unknown,alpha));}
  renderer.dispose();return{wet,dry,forward,reverse};
 });
 assert.deepEqual(errors,[]);assert.notDeepEqual(result.wet,result.dry,'test must distinguish drawn water from unknown');
 assert.deepEqual(result.forward,[result.dry,result.dry,result.wet]);assert.deepEqual(result.reverse,[result.wet,result.dry,result.dry]);console.log('PASS:3D unknown→wet and wet→unknown interpolation; exact endpoints preserved');
}finally{await browser.close();server.close();}
