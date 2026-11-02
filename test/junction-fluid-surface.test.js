// Contract for the scoped particle-only screen-space pass. No GPU here: these
// cover the capability gate, the renderer-state restore and disposal, which are
// the parts that can quietly break the shared map renderer.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createJunctionSurface,junctionSurfaceSupported,JUNCTION_SURFACE_DEFAULTS} from '../tools/simulation/junction-fluid-surface.js';

function fakeRenderer({webgl2=true,halfFloat=true}={}){
  const calls=[];
  let target=null,cubeFace=0,mipmap=0,clearColor=new THREE.Color(0x123456),clearAlpha=0.65;
  return {calls,
    capabilities:{isWebGL2:webgl2},
    extensions:{has:name=>halfFloat&&/half_float/.test(name)},
    autoClear:false,
    getRenderTarget(){return target;},
    getActiveCubeFace(){return cubeFace;},
    getActiveMipmapLevel(){return mipmap;},
    setRenderTarget(next){target=next;calls.push(['setRenderTarget',next&&next.width]);},
    getClearColor(out){return out.copy(clearColor);},
    getClearAlpha(){return clearAlpha;},
    setClearColor(color,alpha){clearColor.set(color);clearAlpha=alpha;calls.push(['setClearColor']);},
    clear(){calls.push(['clear']);},
    render(scene){calls.push(['render',scene.children.length]);},
    getDrawingBufferSize(v){return v.set(1280,730);}};
}
const geometry=(instanceCount=2048)=>{
  const g=new THREE.InstancedBufferGeometry();
  g.setAttribute('position',new THREE.BufferAttribute(new Float32Array(9),3));
  g.setAttribute('blobOffset',new THREE.InstancedBufferAttribute(new Float32Array(3),3));
  g.setAttribute('blobScale',new THREE.InstancedBufferAttribute(new Float32Array(1),1));
  g.instanceCount=instanceCount;return g;
};

test('the pass refuses to run without half-float targets, so the device falls back to lit spheres',()=>{
  assert.equal(junctionSurfaceSupported(null),false);
  assert.equal(junctionSurfaceSupported(fakeRenderer({webgl2:false,halfFloat:false})),false);
  assert.equal(junctionSurfaceSupported(fakeRenderer({webgl2:false,halfFloat:true})),true);
  assert.equal(junctionSurfaceSupported(fakeRenderer({webgl2:true})),true);
  assert.throws(()=>createJunctionSurface({renderer:fakeRenderer({webgl2:false,halfFloat:false}),captureGeometry:geometry()}),
    /Half-float render targets are unavailable/);
  assert.throws(()=>createJunctionSurface({captureGeometry:geometry()}),/Three renderer is required/);
  assert.throws(()=>createJunctionSurface({renderer:fakeRenderer()}),/particle geometry is required/);
});

test('one capture and two separable smoothing passes run, at a scaled resolution',()=>{
  const renderer=fakeRenderer(),surface=createJunctionSurface({renderer,captureGeometry:geometry()});
  const texture=surface.render(new THREE.PerspectiveCamera(),new THREE.Vector2(1280,730));
  assert.ok(texture,'a smoothed field is produced');
  const renders=renderer.calls.filter(c=>c[0]==='render');
  assert.equal(renders.length,3,'capture plus a horizontal and a vertical smoothing pass');
  assert.equal(surface.stats.width,640,'half resolution by default');
  assert.equal(surface.stats.height,365);
  assert.equal(surface.stats.resolutionScale,JUNCTION_SURFACE_DEFAULTS.resolutionScale);
  assert.equal(surface.stats.renders,1);
  const texel=surface.texelSize;
  assert.ok(Math.abs(texel.x-1/640)<1e-9&&Math.abs(texel.y-1/365)<1e-9);
  surface.dispose();
});

test('the phone budget uses a smaller target',()=>{
  const renderer=fakeRenderer(),surface=createJunctionSurface({renderer,captureGeometry:geometry(768)});
  surface.setMobile(true);
  surface.render(new THREE.PerspectiveCamera(),new THREE.Vector2(390,844));
  assert.equal(surface.stats.resolutionScale,JUNCTION_SURFACE_DEFAULTS.mobileResolutionScale);
  assert.ok(surface.stats.width<=Math.round(390*JUNCTION_SURFACE_DEFAULTS.mobileResolutionScale));
  surface.dispose();
});

test('the host renderer is handed back exactly as it was found',()=>{
  const renderer=fakeRenderer();
  const hostTarget={width:99};
  renderer.setRenderTarget(hostTarget);
  renderer.autoClear=false;
  const surface=createJunctionSurface({renderer,captureGeometry:geometry()});
  surface.render(new THREE.PerspectiveCamera(),new THREE.Vector2(1280,730));
  assert.equal(renderer.getRenderTarget(),hostTarget,'the map keeps the render target it was using');
  assert.equal(renderer.autoClear,false,'autoClear is restored');
  assert.equal(renderer.getClearColor(new THREE.Color()).getHex(),0x123456);
  assert.equal(renderer.getClearAlpha(),0.65);
  // Even when the render throws part-way, the target must be put back.
  renderer.render=()=>{throw Error('simulated device loss');};
  assert.throws(()=>surface.render(new THREE.PerspectiveCamera(),new THREE.Vector2(1280,730)),/simulated device loss/);
  assert.equal(renderer.getRenderTarget(),hostTarget,'a failed pass still restores the map renderer');
  assert.equal(renderer.getClearColor(new THREE.Color()).getHex(),0x123456);
  assert.equal(renderer.getClearAlpha(),0.65);
  surface.dispose();
});

test('an empty particle set skips the pass entirely',()=>{
  const renderer=fakeRenderer(),surface=createJunctionSurface({renderer,captureGeometry:geometry(0)});
  assert.equal(surface.render(new THREE.PerspectiveCamera(),new THREE.Vector2(1280,730)),null);
  assert.equal(renderer.calls.length,0,'no offscreen work for water that is not there');
  surface.dispose();
  assert.equal(surface.render(new THREE.PerspectiveCamera(),new THREE.Vector2(1280,730)),null,'a disposed pass stays quiet');
});

test('the narrow-range filter is declared, so separate wet areas cannot be bridged',()=>{
  assert.ok(JUNCTION_SURFACE_DEFAULTS.depthThresholdM>0,'a depth step larger than this is never blended across');
  assert.ok(JUNCTION_SURFACE_DEFAULTS.radiusTexels>=1&&JUNCTION_SURFACE_DEFAULTS.radiusTexels<=8);
  const renderer=fakeRenderer(),surface=createJunctionSurface({renderer,captureGeometry:geometry()});
  assert.match(surface.stats.technique,/narrow-range/);
  assert.match(surface.stats.upstream,/jizhouxu\/3d-fluid-simulation \(MIT\)/,'upstream attribution travels with the technique');
  surface.dispose();
});

test('offscreen capture follows the live map transform, including later movement',()=>{
  const renderer=fakeRenderer(),g=geometry();
  const parent=new THREE.Group(),source=new THREE.Mesh(g,new THREE.MeshBasicMaterial());
  parent.position.set(-162236,50159,0.2);
  parent.rotation.z=0.17;source.position.set(3,4,0.1);parent.add(source);
  const captured=[];
  renderer.render=scene=>{
    if(scene.children[0]?.name==='brawley-junction-surface-capture'){
      scene.updateMatrixWorld(true);
      captured.push(scene.children[0].matrixWorld.clone());
    }
  };
  const surface=createJunctionSurface({renderer,captureGeometry:g,captureObject:source});
  const camera=new THREE.PerspectiveCamera(),size=new THREE.Vector2(1280,730);
  surface.render(camera,size);
  assert.deepEqual(captured[0].elements,source.matrixWorld.elements,
    'an offscreen scene must not drop the map model parent transform');
  parent.position.x+=19;parent.rotation.z=-0.23;
  surface.render(camera,size);
  assert.deepEqual(captured[1].elements,source.matrixWorld.elements,
    'capture must follow camera/map model changes instead of caching an old transform');
  assert.notDeepEqual(captured[0].elements,captured[1].elements);
  surface.dispose();source.material.dispose();g.dispose();
});

test('fullscreen passes submit a finite triangle even without a position attribute',()=>{
  const renderer=fakeRenderer(),seen=[];
  renderer.render=scene=>{
    for(const mesh of scene.children){
      const g=mesh.geometry;
      if(g?.getAttribute('corner')){
        const count=Math.min(g.drawRange.count,g.index?.count??g.getAttribute('position')?.count??Infinity);
        assert.equal(count,3,'Three skips an unbounded draw when neither position nor index supplies its count');
        seen.push(g);
      }
    }
  };
  const surface=createJunctionSurface({renderer,captureGeometry:geometry()});
  surface.render(new THREE.PerspectiveCamera(),new THREE.Vector2(1280,730));
  const composite=surface.createComposite({depthColors:Array.from({length:6},()=>new THREE.Color()),depthCuts:[0,.1,.3,1,2,4]});
  const scene=new THREE.Scene();scene.add(composite.mesh);renderer.render(scene);
  assert.equal(seen.length,3,'both blur passes and the final composite submit triangles');
  surface.dispose();
});
