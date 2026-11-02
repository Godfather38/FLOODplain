import * as THREE from 'three';

// Regional geographic CONTEXT for the 3D map: the actual relief around the
// model domain, so the valley reads as a valley between ranges instead of a
// flat patch. The user's words were "this is not a flat area. Show the
// mountains etc." — and they were right: every elevation asset in the repo
// covers the hydraulic domain only, where the real relief is genuinely small.
//
// WHAT THIS IS NOT. This is public Terrain Tiles data (Mapzen/Tilezen on AWS,
// USGS 3DEP/GMTED2010/SRTM source family), sampled on roughly a 400 m grid at
// source zoom 10. It is scenery and nothing else:
//
//   * It never contributes to water depth, flood extent, crossing safety or
//     source velocity. Those come only from the native model.
//   * Its vertical reference is not asserted equal to the model's NAVD88
//     terrain, so it is never differenced against native heights.
//   * The native domain is CUT OUT of it, so the detailed source ground and
//     the modelled water are never covered or z-fought by context scenery.
//   * It renders at 1x true elevation. Exaggeration is opt-in, labelled, and
//     changes nothing but what is drawn.
//
// Attribution travels with the data and is surfaced by the caller.
export const REGIONAL_CONTEXT_DEFAULTS=Object.freeze({
  path:'data/regional-context/manifest.json',
  // Vertices along the longest edge. The package is 257x257; a phone takes
  // every other sample, which is a quarter of the triangles for scenery that
  // is mostly seen from far away.
  desktopStride:1,mobileStride:2,
  // How far below the native ground the context sits where they meet, in
  // metres. Declared, constant, and only ever downward: context must never
  // rise through the detailed source ground or the modelled water.
  seamDropM:0,
  // Colours for a soft cartoon relief ramp. Hypsometric only — it carries no
  // depth, risk or hydraulic meaning and never reuses the water palette.
  lowColor:[0.839,0.816,0.722],midColor:[0.690,0.647,0.541],highColor:[0.549,0.506,0.447],
  verticalExaggeration:1});

const finite=Number.isFinite;

export async function loadRegionalContext({base,fetchImpl=fetch,signal,options={}}={}){
  if(!base)throw Error('The regional context needs the simulation asset base URL');
  const settings={...REGIONAL_CONTEXT_DEFAULTS,...options};
  const manifestURL=new URL(settings.path,base);
  const manifestResponse=await fetchImpl(manifestURL,{signal});
  if(!manifestResponse.ok)throw Error('Regional context manifest unavailable ('+manifestResponse.status+')');
  const manifest=await manifestResponse.json();
  if(manifest.schemaVersion!==1)throw Error('Unknown regional context schema');
  const artifact=manifest.artifact;
  if(!artifact?.path||!/^[a-f0-9]{64}$/.test(artifact.sha256||''))throw Error('Regional context manifest has no checked artifact');
  const gridURL=new URL(artifact.path,manifestURL);
  const gridResponse=await fetchImpl(gridURL,{signal});
  if(!gridResponse.ok)throw Error('Regional context terrain unavailable ('+gridResponse.status+')');
  const bytes=new Uint8Array(await gridResponse.arrayBuffer());
  // Same integrity check the other packaged assets use: published bytes or
  // nothing. A mismatch is reported, never silently drawn.
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),
    b=>b.toString(16).padStart(2,'0')).join('');
  if(digest!==artifact.sha256)throw Error('Regional context checksum mismatch');
  const text=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  const grid=JSON.parse(text);
  if(!Array.isArray(grid.elevations)||grid.elevations.length!==grid.columns*grid.rows)
    throw Error('Regional context grid is not the size its header declares');
  if(grid.elevationUnit!=='decimetres')throw Error('Unexpected regional context elevation unit: '+grid.elevationUnit);
  return {manifest,grid,
    attribution:manifest.attribution,
    limitations:manifest.limitations??[],
    boundsWSEN:grid.bounds};
}

// Builds the context mesh in the host's own coordinate frame, using the same
// projection and altitude callbacks the native model uses, so it lines up with
// everything else without a transform of its own.
export function createRegionalContext({grid,manifest,project,altitude,origin,
  nativeBounds=null,baseM=0,mobile=false,options={}}={}){
  if(!grid?.elevations)throw Error('The regional context grid is required');
  if(typeof project!=='function'||typeof altitude!=='function')throw Error('The host projection and altitude callbacks are required');
  const settings={...REGIONAL_CONTEXT_DEFAULTS,...options};
  const stride=Math.max(1,Math.floor(mobile?settings.mobileStride:settings.desktopStride));
  const [west,south,east,north]=grid.bounds;
  const cols=grid.columns,rows=grid.rows;
  const sampleCols=Math.floor((cols-1)/stride)+1,sampleRows=Math.floor((rows-1)/stride)+1;
  const exaggeration=Math.max(1,Number(settings.verticalExaggeration)||1);

  // The native domain is removed from the context so detailed source ground
  // and modelled water are never covered by scenery. A vertex inside the
  // native footprint is marked and every triangle touching one is dropped.
  const inNative=(lon,lat)=>!!nativeBounds&&lon>=nativeBounds[0]&&lon<=nativeBounds[2]
    &&lat>=nativeBounds[1]&&lat<=nativeBounds[3];

  const vertexCount=sampleCols*sampleRows;
  const positions=new Float32Array(vertexCount*3);
  const colors=new Float32Array(vertexCount*3);
  const masked=new Uint8Array(vertexCount);
  let minM=Infinity,maxM=-Infinity,sampled=0;
  for(let r=0;r<sampleRows;r++)for(let c=0;c<sampleCols;c++){
    const gr=Math.min(rows-1,r*stride),gc=Math.min(cols-1,c*stride);
    // Rows run south-to-north, columns west-to-east, per the package header.
    const metres=grid.elevations[gr*cols+gc]/10;
    if(!finite(metres))continue;
    if(metres<minM)minM=metres;if(metres>maxM)maxM=metres;
    const lon=west+(east-west)*(gc/(cols-1));
    const lat=south+(north-south)*(gr/(rows-1));
    const i=r*sampleCols+c;
    masked[i]=inNative(lon,lat)?1:0;
    const point=project([lon,lat]);
    // Only ever downward at the seam: context must not rise through native
    // ground or the modelled water.
    const height=altitude(metres*exaggeration-baseM-settings.seamDropM);
    positions[i*3]=point.x-(origin?.x??0);
    positions[i*3+1]=point.y-(origin?.y??0);
    // Match native model local heights; the shared parent applies the live vertical anchor.
    positions[i*3+2]=height;
    sampled++;
  }
  // Hypsometric ramp over the package's own range. Carries no hydraulic,
  // depth or risk meaning and shares no colour with the water palette.
  const span=Math.max(1e-6,maxM-minM);
  for(let r=0;r<sampleRows;r++)for(let c=0;c<sampleCols;c++){
    const gr=Math.min(rows-1,r*stride),gc=Math.min(cols-1,c*stride);
    const t=((grid.elevations[gr*cols+gc]/10)-minM)/span;
    const i=r*sampleCols+c;
    const low=settings.lowColor,mid=settings.midColor,high=settings.highColor;
    const blend=t<0.5
      ?low.map((v,k)=>v+(mid[k]-v)*(t/0.5))
      :mid.map((v,k)=>v+(high[k]-v)*((t-0.5)/0.5));
    colors[i*3]=blend[0];colors[i*3+1]=blend[1];colors[i*3+2]=blend[2];
  }
  // Relief shading baked into the vertex colours from the grid's own slope.
  //
  // Bake slope-based hillshade for a consistent context appearance across
  // devices. The shared scene does supply lights; this unlit material is
  // an independent display choice, not a workaround for missing lights.
  const sunEast=-0.55,sunNorth=0.45,sunUp=0.70;
  const metresAt=(r,c)=>{
    const gr=Math.min(rows-1,Math.max(0,r)*stride),gc=Math.min(cols-1,Math.max(0,c)*stride);
    return grid.elevations[gr*cols+gc]/10;
  };
  // Ground spacing between sampled vertices, so the slope is a true gradient
  // rather than one that changes with the chosen stride.
  const metresPerDegreeNorth=111320,metresPerDegreeEast=metresPerDegreeNorth*Math.cos((south+north)/2*Math.PI/180);
  const dxM=Math.max(1e-6,(east-west)/(cols-1)*stride*metresPerDegreeEast);
  const dzM=Math.max(1e-6,(north-south)/(rows-1)*stride*metresPerDegreeNorth);
  for(let r=0;r<sampleRows;r++)for(let c=0;c<sampleCols;c++){
    const i=r*sampleCols+c;
    const slopeEast=(metresAt(r,c+1)-metresAt(r,c-1))/(2*dxM)*exaggeration;
    const slopeNorth=(metresAt(r+1,c)-metresAt(r-1,c))/(2*dzM)*exaggeration;
    const nx=-slopeEast,nz=-slopeNorth,ny=1;
    const length=Math.hypot(nx,ny,nz)||1;
    const lambert=Math.max(0,(nx*sunEast+ny*sunUp+nz*sunNorth)/length);
    // Soft, cartoon-ish ramp: never fully black, so a shadowed slope still
    // reads as ground rather than as a hole. The range is wide enough that the
    // ranges actually separate from the valley floor against a pale basemap —
    // a narrower one left the relief technically present but invisible.
    const shade=0.46+0.86*lambert;
    colors[i*3]=Math.min(1,colors[i*3]*shade);
    colors[i*3+1]=Math.min(1,colors[i*3+1]*shade);
    colors[i*3+2]=Math.min(1,colors[i*3+2]*shade);
  }
  const indices=[];let droppedForNative=0;
  for(let r=0;r<sampleRows-1;r++)for(let c=0;c<sampleCols-1;c++){
    const a=r*sampleCols+c,b=a+1,d=a+sampleCols,e=d+1;
    if(masked[a]||masked[b]||masked[d]||masked[e]){droppedForNative++;continue;}
    indices.push(a,d,b,b,d,e);
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));
  geometry.setAttribute('color',new THREE.BufferAttribute(colors,3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  // Unlit: the shading is already in the vertex colours, so this does not
  // depend on the host scene having lights and cannot be flattened by them.
  const material=new THREE.MeshBasicMaterial({vertexColors:true,side:THREE.DoubleSide,
    transparent:false,depthWrite:true,depthTest:true});
  const mesh=new THREE.Mesh(geometry,material);
  mesh.name='regional-context-terrain';
  // Drawn before everything the model owns, and never pickable: this is
  // scenery, and the map's own picking keeps working on the native cells.
  mesh.renderOrder=-1;
  mesh.raycast=()=>{};
  const stats={vertices:sampled,triangles:indices.length/3,stride,
    droppedTrianglesOverNativeDomain:droppedForNative,
    elevationRangeM:[finite(minM)?minM:null,finite(maxM)?maxM:null],
    verticalExaggeration:exaggeration,
    seamDropM:settings.seamDropM,
    boundsWSEN:[west,south,east,north],
    attribution:manifest?.attribution??null,
    purpose:'regional geographic context only',
    meaning:'Public Terrain Tiles relief around the model domain, drawn at '
      +(exaggeration===1?'true 1x elevation':exaggeration+'x LABELLED exaggeration')
      +'. The native domain is cut out of it. It never contributes to water depth, flood extent, crossing safety or source velocity.'};
  return {mesh,geometry,material,stats,
    setExaggeration(){/* rebuild required; callers recreate with options */},
    dispose(){mesh.removeFromParent();geometry.dispose();material.dispose();}};
}
