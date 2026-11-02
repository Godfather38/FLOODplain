import * as THREE from 'three';

// Screen-space particle surface for the Brawley junction, adapted from the
// screen-space-fluid approach in the pinned upstream prototype
// (jizhouxu/3d-fluid-simulation @ 7d66406, MIT — notice retained in
// public/simulation/fluid-prototype/vendor/LICENSE and UPSTREAM.md). Upstream
// rendered particle depth into an offscreen target, smoothed it, rebuilt
// normals from the smoothed depth and composited; only the solver was vendored
// here, so that was lost and the particles read as separate balls.
//
// Two deliberate differences from a textbook screen-space fluid:
//
//  * The smoothed surface is fed BACK INTO the real instanced spheres instead
//    of being composited as a fullscreen quad. The spheres keep ordinary depth
//    testing, so host terrain, roads and risk overlays occlude the water
//    exactly as before and no `gl_FragDepth` or scene depth texture is needed.
//    That is what makes this safe inside the shared map renderer.
//  * The blur is narrow-range: a neighbour whose eye depth differs by more than
//    `depthThresholdM` is not blended in, and background texels are skipped
//    entirely. Separate native wet areas therefore stay separate — the filter
//    can smooth water that is already touching, never bridge dry ground into
//    one invented river.
export const JUNCTION_SURFACE_DEFAULTS=Object.freeze({
  resolutionScale:0.5,mobileResolutionScale:0.35,
  maxTextureSize:1024,radiusTexels:5,depthThresholdM:1.4,falloff:0.18});

const FULLSCREEN=new Float32Array([-1,-1,3,-1,-1,3]);

const CAPTURE_VERTEX=`
  attribute vec3 blobOffset;attribute float blobScale;attribute float blobActive;
  attribute float blobDepthM;
  varying float eyeDepth;varying float chord;varying float nativeDepth;
  void main(){
    if(blobActive<.5){gl_Position=vec4(2.,2.,2.,1.);eyeDepth=0.;chord=0.;nativeDepth=0.;return;}
    vec3 world=blobOffset+position*blobScale;
    vec4 mv=modelViewMatrix*vec4(world,1.);
    eyeDepth=-mv.z;
    // How much sphere this fragment looks through, in PARTICLE RADII rather
    // than in scene units. Scene units change with zoom, so a coverage
    // threshold expressed in them would make the water fade in and out as the
    // camera moved. In radii, "one particle thick" means the same at any zoom
    // and overlapping particles push it above one.
    chord=abs(normalize(normalMatrix*position).z)*2.;
    // The model's own mean depth for the cell this particle stands in, carried
    // through so the composite keeps the quantitative depth palette instead of
    // inventing a colour of its own.
    nativeDepth=blobDepthM;
    gl_Position=projectionMatrix*mv;}`;

// R = eye depth in view units, G = chord through the nearest particle,
// B = the model's own water depth in metres, A = 1 marks a texel with water.
const CAPTURE_FRAGMENT=`
  varying float eyeDepth;varying float chord;varying float nativeDepth;
  void main(){gl_FragColor=vec4(eyeDepth,chord,nativeDepth,1.);}`;

const BLUR_VERTEX=`attribute vec2 corner;void main(){gl_Position=vec4(corner,0.,1.);}`;

const BLUR_FRAGMENT=`
  precision highp float;
  uniform sampler2D source;uniform vec2 texel;uniform vec2 direction;
  uniform float radiusTexels;uniform float depthThreshold;uniform float falloff;
  void main(){
    vec2 uv=gl_FragCoord.xy*texel;
    vec4 centre=texture2D(source,uv);
    if(centre.a<.5){gl_FragColor=vec4(0.);return;}
    // Depth and the native value are averaged — that is what smooths the
    // surface. Thickness is NOT: it takes the maximum across the kernel.
    //
    // Averaging thickness diluted it. The kernel is far wider than one
    // particle, so a lone particle's chord was averaged down against its own
    // thinner edges and the result fell under the coverage threshold, which
    // discarded it. That is why the water rendered as a narrow broken strip
    // while the particles themselves covered a wide area, and why switching the
    // depth test off changed nothing. A maximum keeps "how thick is the water
    // near here", which is what coverage actually means, so sparse particles
    // stay visible and overlapping ones still merge.
    float depthSum=centre.r,chordMax=centre.g,nativeSum=centre.b,weight=1.;
    for(int i=1;i<=8;i++){
      if(float(i)>radiusTexels)break;
      for(int side=0;side<2;side++){
        // 'sample' is reserved in GLSL ES and 'step' shadows a builtin.
        vec2 offset=direction*texel*float(i)*(side==0?1.:-1.);
        vec4 neighbour=texture2D(source,uv+offset);
        // Background, or a depth step: a different body of water, or empty
        // ground. Never blend across it.
        if(neighbour.a<.5)continue;
        if(abs(neighbour.r-centre.r)>depthThreshold)continue;
        float w=exp(-float(i)*float(i)*falloff);
        depthSum+=neighbour.r*w;nativeSum+=neighbour.b*w;weight+=w;
        chordMax=max(chordMax,neighbour.g*w);
      }
    }
    gl_FragColor=vec4(depthSum/weight,chordMax,nativeSum/weight,1.);}`;

// The composite. This is the piece upstream had and the port had lost: the
// water's SILHOUETTE comes from the smoothed particle depth, not from each
// sphere's own circular outline, which is why the layer read as a tray of
// beads however hard the normals were smoothed.
//
// It is drawn as a screen-filling triangle inside the shared scene, writing
// gl_FragDepth from the smoothed eye depth. That matters: ordinary depth
// testing then resolves it against the host terrain, the road and the risk
// overlays exactly as a solid surface would, with no scene depth texture and
// no change to anything else's render path. Texels the particles never covered
// are discarded, so native wet-support clipping is untouched — the water can
// only appear where particles are, and particles can only be where the saved
// run supports water.
const COMPOSITE_VERTEX=`
  precision highp float;
  attribute vec2 corner;
  varying vec2 vUv;
  void main(){vUv=corner*.5+.5;gl_Position=vec4(corner,0.,1.);}`;

const COMPOSITE_FRAGMENT=`
  precision highp float;
  uniform sampler2D surfaceTexture;uniform vec2 surfaceTexel;
  uniform mat4 inverseProjection;uniform mat4 projection;
  uniform vec3 light;uniform float opacity;uniform float highlight;
  uniform float coverMetres;uniform float slopeScale;uniform float debugMask;
  uniform vec3 depthColors[6];uniform float depthCuts[6];uniform vec3 missingColor;
  varying vec2 vUv;
  // GLSL ES 3.00: the fragment output is declared here. Three does not alias
  // gl_FragColor in GLSL3 mode, and gl_FragDepth is only available here.
  out vec4 fragColour;

  // View-space position of a texel, from its smoothed eye depth.
  vec3 viewAt(vec2 uv,float eyeDepth){
    vec4 ndc=vec4(uv*2.-1.,0.,1.);
    vec4 ray=inverseProjection*ndc;
    vec3 direction=ray.xyz/ray.w;
    // Scale the ray so its view-space z is exactly -eyeDepth.
    return direction*(eyeDepth/max(1e-5,-direction.z));
  }
  // The model's own depth palette, with its band boundaries eased rather than
  // stepped. The colours and the cuts are exactly the legend's, so the reading
  // is unchanged; only the last quarter of each band cross-fades into the next.
  // Hard steps over a continuous depth field were a large part of why the water
  // read as cells rather than as a body of water.
  vec3 depthColour(float metres){
    if(metres<=0.)return missingColor;
    vec3 picked=depthColors[0],next=depthColors[0];
    float blend=0.;
    for(int i=0;i<6;i++){
      if(metres>=depthCuts[i]){
        int j=i<5?i+1:5;
        picked=depthColors[i];next=depthColors[j];
        float upper=i<5?depthCuts[j]:depthCuts[i]*2.;
        float span=max(1e-4,upper-depthCuts[i]);
        blend=i<5?smoothstep(.75,1.,(metres-depthCuts[i])/span):0.;
      }
    }
    return mix(picked,next,blend);
  }
  void main(){
    vec4 here=texture2D(surfaceTexture,vUv);
    // No particle ever covered this texel: there is no water here, and none is
    // invented. The host scene shows through untouched.
    if(here.a<.5)discard;
    // Diagnostic only, never on in normal use: paint the raw coverage mask and
    // the thickness that drives it, so "the field is sparse" can be told apart
    // from "the shading threw it away". Numeric readback of this half-float
    // target returns zeros on this software GPU, so this is read by eye.
    if(debugMask>.5){
      gl_FragDepth=0.0;
      fragColour=vec4(debugMask>1.5?vec3(clamp(here.g*.5,0.,1.),0.,0.):vec3(0.,1.,0.),1.);
      return;
    }
    float eyeDepth=here.r;
    if(eyeDepth<=0.)discard;

    // Normal from the smoothed depth field, with one-sided differences at the
    // edge of the body so the rim does not pick up the background.
    vec2 dx=vec2(surfaceTexel.x,0.),dy=vec2(0.,surfaceTexel.y);
    vec4 r=texture2D(surfaceTexture,vUv+dx),l=texture2D(surfaceTexture,vUv-dx);
    vec4 u=texture2D(surfaceTexture,vUv+dy),d=texture2D(surfaceTexture,vUv-dy);
    float gx=(r.a>.5?r.r:eyeDepth)-(l.a>.5?l.r:eyeDepth);
    float gy=(u.a>.5?u.r:eyeDepth)-(d.a>.5?d.r:eyeDepth);
    vec3 normal=normalize(vec3(-gx*slopeScale,-gy*slopeScale,1.));

    vec3 viewPosition=viewAt(vUv,eyeDepth);
    vec3 eye=normalize(-viewPosition);
    vec3 lightDir=normalize(light);
    // Soft, few-banded shading: a cartoon body of water rather than a glassy
    // render. The colour itself is the model's own depth palette.
    float lambert=max(0.,dot(normal,lightDir));
    float shade=.58+.42*smoothstep(0.,.7,lambert);
    float rim=pow(1.-max(0.,dot(normal,eye)),2.2);
    float spec=smoothstep(.86,.98,dot(normal,normalize(lightDir+eye)));
    vec3 base=depthColour(here.b);
    vec3 colour=base*shade;
    // A restrained rim. Mixing hard toward white here washed the depth palette
    // out, and the palette is the quantitative part of this picture.
    colour=mix(colour,vec3(.82,.94,.99),.12*rim);
    colour+=vec3(1.)*spec*highlight;

    // Thin water at the edge of the body fades instead of ending on a hard
    // line, which is what lets it read as a bloopy body rather than a cut-out.
    // The G channel is in particle radii: how many particles thick this is.
    float cover=clamp(here.g/max(1e-4,coverMetres),0.,1.);
    // The coverage flag is now linearly filtered, so it ramps across the
    // silhouette instead of flipping between two texels. Feathering on that
    // ramp is what turns a staircase edge into a rounded one.
    float edge=smoothstep(.5,.92,here.a);
    float alpha=opacity*smoothstep(0.,1.,cover)*edge;
    if(alpha<.02)discard;

    // Write the real depth so the shared scene occludes this surface exactly as
    // it occludes solid geometry.
    vec4 clip=projection*vec4(viewPosition,1.);
    gl_FragDepth=clamp((clip.z/clip.w)*.5+.5,0.,1.);
    fragColour=linearToOutputTexel(vec4(colour,alpha));
  }`;

// gl_FragDepth is core in GLSL ES 3.00. Rather than juggling the WebGL1
// extension spelling, the composite simply needs WebGL2; without it the layer
// keeps the lit spheres it already had, which is the existing fallback.
export function junctionCompositeSupported(renderer){
  return !!renderer?.capabilities?.isWebGL2&&junctionSurfaceSupported(renderer);
}

// Half-float render targets are what make a depth-carrying colour buffer
// possible. Without them the layer keeps its plain lit spheres.
export function junctionSurfaceSupported(renderer){
  if(!renderer)return false;
  const capabilities=renderer.capabilities;
  if(capabilities?.isWebGL2)return true;
  const extensions=renderer.extensions;
  return !!(extensions?.has?.('OES_texture_half_float')&&extensions.has('OES_texture_half_float_linear'));
}

export function createJunctionSurface({renderer,captureGeometry,captureObject=null,options={}}={}){
  if(!renderer)throw Error('The host Three renderer is required for the junction surface');
  if(!captureGeometry)throw Error('The particle geometry is required for the junction surface');
  const settings={...JUNCTION_SURFACE_DEFAULTS,...options};
  if(!junctionSurfaceSupported(renderer))throw Error('Half-float render targets are unavailable for the junction surface');

  const type=renderer.capabilities?.isWebGL2?THREE.HalfFloatType:THREE.HalfFloatType;
  const targetOptions={type,minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter,
    depthBuffer:true,stencilBuffer:false,generateMipmaps:false};
  let captureTarget=new THREE.WebGLRenderTarget(2,2,targetOptions);
  // The capture stays NEAREST: the blur reads it at explicit texel offsets and
  // tests the coverage flag, so interpolating across a silhouette would smear
  // one particle's depth into empty ground.
  //
  // The smoothed targets must NOT. They are half resolution (0.35 on a phone)
  // and the composite samples them at full screen resolution, so with NEAREST
  // every texel showed up as a hard square — that is the blockiness, not the
  // particle field. Linear filtering interpolates between smoothed texels and
  // the silhouette becomes a curve instead of a staircase.
  const smoothedOptions={...targetOptions,depthBuffer:false,
    minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter};
  let blurTarget=new THREE.WebGLRenderTarget(2,2,smoothedOptions);
  let smoothTarget=new THREE.WebGLRenderTarget(2,2,smoothedOptions);

  const captureMaterial=new THREE.ShaderMaterial({vertexShader:CAPTURE_VERTEX,fragmentShader:CAPTURE_FRAGMENT,
    depthTest:true,depthWrite:true,side:THREE.FrontSide});
  const captureMesh=new THREE.Mesh(captureGeometry,captureMaterial);
  captureMesh.frustumCulled=false;captureMesh.name='brawley-junction-surface-capture';
  const captureScene=new THREE.Scene();captureScene.add(captureMesh);

  const blurGeometry=new THREE.BufferGeometry();
  blurGeometry.setAttribute('corner',new THREE.BufferAttribute(FULLSCREEN.slice(),2));
  // Coordinator fix: without position/index, Three skips an infinite default draw range.
  blurGeometry.setDrawRange(0,3);
  const blurMaterial=new THREE.ShaderMaterial({vertexShader:BLUR_VERTEX,fragmentShader:BLUR_FRAGMENT,
    depthTest:false,depthWrite:false,
    uniforms:{source:{value:null},texel:{value:new THREE.Vector2()},direction:{value:new THREE.Vector2(1,0)},
      radiusTexels:{value:settings.radiusTexels},depthThreshold:{value:settings.depthThresholdM},
      falloff:{value:settings.falloff}}});
  const blurMesh=new THREE.Mesh(blurGeometry,blurMaterial);blurMesh.frustumCulled=false;
  const blurScene=new THREE.Scene();blurScene.add(blurMesh);
  const blurCamera=new THREE.Camera();

  let disposed=false,width=0,height=0,mobile=false;
  const stats={supported:true,width:0,height:0,resolutionScale:0,renders:0,
    technique:'particle depth captured offscreen, narrow-range smoothed, normals rebuilt and fed back into the real spheres',
    upstream:'screen-space fluid pass adapted from jizhouxu/3d-fluid-simulation (MIT)'};

  function resize(nextWidth,nextHeight){
    const scale=mobile?settings.mobileResolutionScale:settings.resolutionScale;
    const cap=settings.maxTextureSize;
    const w=Math.max(2,Math.min(cap,Math.round(nextWidth*scale)));
    const h=Math.max(2,Math.min(cap,Math.round(nextHeight*scale)));
    if(w===width&&h===height)return;
    width=w;height=h;
    captureTarget.setSize(w,h);blurTarget.setSize(w,h);smoothTarget.setSize(w,h);
    blurMaterial.uniforms.texel.value.set(1/w,1/h);
    stats.width=w;stats.height=h;stats.resolutionScale=scale;
  }

  function render(camera,drawingBufferSize){
    if(disposed||!camera)return null;
    if(!captureGeometry.instanceCount)return null;
    resize(drawingBufferSize.x,drawingBufferSize.y);
    // Instance offsets are local to the map's translated model group.
    // The offscreen scene has no such parent: copy the live source object's
    // full world transform or the capture silently renders elsewhere.
    if(captureObject){
      captureObject.updateWorldMatrix(true,false);
      captureMesh.matrixAutoUpdate=false;
      captureMesh.matrix.copy(captureObject.matrixWorld);
      captureMesh.updateMatrixWorld(true);
    }
    // Save and restore everything we touch: this runs inside the map's own
    // frame and must leave its renderer exactly as it was found.
    const previousTarget=renderer.getRenderTarget();
    const previousActiveCubeFace=renderer.getActiveCubeFace();
    const previousActiveMipmapLevel=renderer.getActiveMipmapLevel();
    const previousAutoClear=renderer.autoClear;
    const previousClearColor=renderer.getClearColor(new THREE.Color());
    const previousClearAlpha=renderer.getClearAlpha();
    try{
      renderer.autoClear=true;
      renderer.setRenderTarget(captureTarget);
      renderer.setClearColor(0x000000,0);
      renderer.clear(true,true,false);
      renderer.render(captureScene,camera);
      // Separable narrow-range smoothing.
      blurMaterial.uniforms.source.value=captureTarget.texture;
      blurMaterial.uniforms.direction.value.set(1,0);
      renderer.setRenderTarget(blurTarget);
      renderer.clear(true,false,false);
      renderer.render(blurScene,blurCamera);
      blurMaterial.uniforms.source.value=blurTarget.texture;
      blurMaterial.uniforms.direction.value.set(0,1);
      renderer.setRenderTarget(smoothTarget);
      renderer.clear(true,false,false);
      renderer.render(blurScene,blurCamera);
      stats.renders++;
      return smoothTarget.texture;
    }finally{
      renderer.setRenderTarget(previousTarget,previousActiveCubeFace,previousActiveMipmapLevel);
      renderer.autoClear=previousAutoClear;
      renderer.setClearColor(previousClearColor,previousClearAlpha);
    }
  }

  // The screen-filling composite mesh, for the caller to put in the shared
  // scene group. Null when the device cannot write fragment depth, in which
  // case the lit spheres remain.
  function createComposite({depthColors,depthCuts,missingColor,options:compositeOptions={}}={}){
    if(!junctionCompositeSupported(renderer))return null;
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('corner',new THREE.BufferAttribute(FULLSCREEN.slice(),2));
    // Coordinator fix: without position/index, Three skips an infinite default draw range.
    geometry.setDrawRange(0,3);
    // A screen-filling triangle is never inside any bounding volume the map
    // might cull against, and it must never be picked.
    geometry.boundingSphere=new THREE.Sphere(new THREE.Vector3(),Infinity);
    const material=new THREE.ShaderMaterial({
      glslVersion:THREE.GLSL3,
      vertexShader:COMPOSITE_VERTEX,fragmentShader:COMPOSITE_FRAGMENT,
      transparent:true,depthTest:true,depthWrite:true,side:THREE.DoubleSide,
      uniforms:{surfaceTexture:{value:smoothTarget.texture},
        surfaceTexel:{value:new THREE.Vector2()},
        inverseProjection:{value:new THREE.Matrix4()},projection:{value:new THREE.Matrix4()},
        light:{value:new THREE.Vector3(-0.4,0.65,1).normalize()},
        opacity:{value:compositeOptions.opacity??0.97},
        highlight:{value:compositeOptions.highlight??0.26},
        // In particle radii. Smoothing averages the chord down across the
        // kernel, so a threshold near one particle broke the channel into
        // disconnected patches. A third of a radius keeps a single line of
        // particles reading as continuous water while still fading the rim.
        coverMetres:{value:compositeOptions.coverThicknessRadii??0.3},
        // How strongly the smoothed depth gradient shapes the normal. Higher
        // picks up more of the body's own undulation, which is what gives the
        // surface a rounded, soft look instead of a flat painted sheet. It
        // changes shading only; the silhouette and extent are untouched.
        slopeScale:{value:compositeOptions.slopeScale??24},
        debugMask:{value:0},
        depthColors:{value:depthColors},depthCuts:{value:depthCuts},
        missingColor:{value:missingColor}}});
    const mesh=new THREE.Mesh(geometry,material);
    mesh.name='brawley-junction-water-surface';
    mesh.frustumCulled=false;
    // Drawn after the particles so it replaces them, and never pickable: the
    // map's own picking keeps working on the geography underneath.
    mesh.renderOrder=5;
    mesh.raycast=()=>{};
    stats.composite='fullscreen particle-derived surface with written fragment depth';
    return {mesh,
      // Called each frame from the host render hook, after the smoothing pass.
      sync(camera){
        if(disposed||!camera)return false;
        material.uniforms.surfaceTexture.value=smoothTarget.texture;
        material.uniforms.surfaceTexel.value.set(width?1/width:0,height?1/height:0);
        material.uniforms.projection.value.copy(camera.projectionMatrix);
        material.uniforms.inverseProjection.value.copy(camera.projectionMatrixInverse);
        mesh.visible=stats.renders>0&&width>0;
        return mesh.visible;},
      setVisible(value){mesh.visible=!!value;},
      // Diagnostics. How much water the capture and smoothing actually produce,
      // and how much of it clears the coverage threshold — measured off the
      // smoothed target itself, so a narrow strip on screen can be told apart
      // from a narrow strip in the field that feeds it.
      probeCoverage(){
        if(disposed||!width||!height)return null;
        // A half-float target cannot be read back into a Float32Array here —
        // the first attempt returned all zeros while water was plainly on
        // screen, which is a broken probe rather than an empty field. The
        // smoothed field is therefore encoded into an 8-bit target first:
        // R = coverage mask, G = thickness, B = normalised eye depth.
        const probe=new THREE.WebGLRenderTarget(width,height,
          {type:THREE.UnsignedByteType,minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter,
            depthBuffer:false,stencilBuffer:false,generateMipmaps:false});
        const encodeMaterial=new THREE.ShaderMaterial({
          vertexShader:'attribute vec2 corner;varying vec2 vUv;void main(){vUv=corner*.5+.5;gl_Position=vec4(corner,0.,1.);}',
          fragmentShader:`precision highp float;uniform sampler2D source;uniform float depthScale;varying vec2 vUv;
            void main(){vec4 t=texture2D(source,vUv);
              gl_FragColor=vec4(t.a,clamp(t.g*.25,0.,1.),clamp(t.r/depthScale,0.,1.),1.);}`,
          depthTest:false,depthWrite:false,
          uniforms:{source:{value:smoothTarget.texture},depthScale:{value:2000}}});
        const probeGeometry=new THREE.BufferGeometry();
        probeGeometry.setAttribute('corner',new THREE.BufferAttribute(FULLSCREEN.slice(),2));
        // Coordinator fix: without position/index, Three skips an infinite default draw range.
        probeGeometry.setDrawRange(0,3);
        const probeMesh=new THREE.Mesh(probeGeometry,encodeMaterial);probeMesh.frustumCulled=false;
        const probeScene=new THREE.Scene();probeScene.add(probeMesh);
        const pixels=new Uint8Array(width*height*4);
        const previousTarget=renderer.getRenderTarget();
        const previousAutoClear=renderer.autoClear;
        let failure=null;
        try{
          renderer.autoClear=true;
          renderer.setRenderTarget(probe);
          renderer.render(probeScene,new THREE.Camera());
          renderer.readRenderTargetPixels(probe,0,0,width,height,pixels);
        }catch(error){failure=error.message;}
        finally{
          renderer.setRenderTarget(previousTarget);renderer.autoClear=previousAutoClear;
          probeGeometry.dispose();encodeMaterial.dispose();probe.dispose();
        }
        if(failure)return {error:failure};
        const threshold=material.uniforms.coverMetres.value;
        let covered=0,opaque=0,belowThreshold=0,thicknessSum=0;
        for(let i=0;i<width*height;i++){
          if(pixels[i*4]<128)continue;
          covered++;
          const radii=(pixels[i*4+1]/255)*4;
          thicknessSum+=radii;
          if(radii/threshold>=1)opaque++;else belowThreshold++;
        }
        return {targetTexels:width*height,coveredTexels:covered,
          coveredShare:covered/(width*height),
          opaqueTexels:opaque,belowThresholdTexels:belowThreshold,
          meanThicknessRadii:covered?thicknessSum/covered:0,coverThresholdRadii:threshold,
          encoding:'8-bit re-encode of the half-float smoothed field; a direct float readback of a half-float target returns zeros here'};},
      // Flip depth testing to separate "the fragments never existed" from "the
      // fragments were rejected by the depth test against terrain".
      setDepthTest(value){material.depthTest=!!value;material.needsUpdate=true;},
      // 0 normal, 1 flat coverage mask, 2 thickness.
      setDebugMask(mode){material.uniforms.debugMask.value=Number(mode)||0;},
      // Coverage is counted in overlapping particles, so it depends on how many
      // particles there are. The phone budget is 768 against the desktop's
      // 2,048: at the desktop threshold the phone's thinner overlap fell below
      // it and the water nearly vanished. The threshold therefore scales with
      // the actual particle count rather than being a fixed constant.
      setParticleBudget(count,reference=2048){
        if(disposed||!(count>0))return;
        const scale=Math.max(0.3,Math.min(1,count/reference));
        material.uniforms.coverMetres.value=(compositeOptions.coverThicknessRadii??0.3)*scale;
        stats.compositeCoverRadii=material.uniforms.coverMetres.value;},
      dispose(){geometry.dispose();material.dispose();mesh.removeFromParent();}};
  }

  return {render,stats,createComposite,
    get texture(){return smoothTarget.texture;},
    get texelSize(){return new THREE.Vector2(width?1/width:0,height?1/height:0);},
    setMobile(value){mobile=!!value;width=height=0;},
    dispose(){if(disposed)return;disposed=true;
      captureScene.remove(captureMesh);captureMaterial.dispose();
      blurGeometry.dispose();blurMaterial.dispose();
      captureTarget.dispose();blurTarget.dispose();smoothTarget.dispose();}};
}
