// Strict reader for this repository's own baked junction GLB
// (public/simulation/data/brawley-baked/brawley-ground-road.glb, written by
// tools/simulation/bake-brawley-ground.mjs). It accepts only that bake's shape:
// one embedded binary buffer, tightly packed float VEC3/VEC2 attributes and
// non-indexed triangle primitives. Nothing here invents geometry, materials,
// elevations or bridge clearance, and no general glTF feature set is implied —
// an unexpected container fails loudly instead of being guessed at. Keeping the
// reader dependency-free also keeps it out of the lazy Three/map chunk.
const MAGIC=0x46546c67,JSON_CHUNK=0x4e4f534a,BIN_CHUNK=0x004e4942,FLOAT=5126,TRIANGLES=4,ARRAY_BUFFER=34962;
const COMPONENTS={VEC2:2,VEC3:3};
const ATTRIBUTES={POSITION:'VEC3',NORMAL:'VEC3',TEXCOORD_0:'VEC2'};

export function readBakedGlb(input){
  const bytes=input instanceof Uint8Array?input:new Uint8Array(input);
  if(bytes.byteLength<20)throw Error('Baked junction GLB is too short to be a container');
  const header=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if(header.getUint32(0,true)!==MAGIC)throw Error('Baked junction asset is not a GLB container');
  if(header.getUint32(4,true)!==2)throw Error('Only glTF 2.0 GLB containers are read');
  if(header.getUint32(8,true)!==bytes.byteLength)throw Error('Declared GLB length does not match the delivered bytes');
  let offset=12,json=null,bin=null;
  while(offset+8<=bytes.byteLength){
    const length=header.getUint32(offset,true),type=header.getUint32(offset+4,true),start=offset+8;
    if(length%4||start+length>bytes.byteLength)throw Error('Truncated or unaligned GLB chunk');
    if(type===JSON_CHUNK){if(json)throw Error('Repeated GLB JSON chunk');json=JSON.parse(new TextDecoder().decode(bytes.subarray(start,start+length)));}
    else if(type===BIN_CHUNK){if(bin)throw Error('Repeated GLB binary chunk');bin=bytes.subarray(start,start+length);}
    offset=start+length;
  }
  if(offset!==bytes.byteLength)throw Error('Trailing bytes after the last GLB chunk');
  if(!json||!bin)throw Error('Baked junction GLB needs both its JSON and binary chunks');
  if(json.asset?.version!=='2.0')throw Error('Only glTF 2.0 asset versions are read');
  if(json.buffers?.length!==1||json.buffers[0].uri!==undefined)throw Error('One embedded GLB buffer is required');
  if(!Number.isInteger(json.buffers[0].byteLength)||json.buffers[0].byteLength>bin.byteLength)throw Error('Declared buffer is longer than the GLB binary chunk');
  for(const key of ['animations','skins','images','textures','cameras'])if(json[key]?.length)throw Error('Unsupported glTF feature in the baked junction asset: '+key);
  if(json.extensionsRequired?.length)throw Error('Baked junction asset requires unsupported glTF extensions');

  function read(index,expected){
    const accessor=json.accessors?.[index];
    if(!accessor)throw Error('Missing baked accessor');
    if(accessor.componentType!==FLOAT||accessor.type!==expected)throw Error('Only tightly packed float '+expected+' baked attributes are read');
    if(accessor.sparse||accessor.normalized)throw Error('Sparse or normalized baked accessors are not read');
    if(!Number.isInteger(accessor.count)||accessor.count<=0)throw Error('Invalid baked accessor count');
    const view=json.bufferViews?.[accessor.bufferView];
    if(!view||view.buffer!==0)throw Error('Missing baked buffer view');
    if(view.target!==undefined&&view.target!==ARRAY_BUFFER)throw Error('Unexpected baked buffer-view target');
    const size=COMPONENTS[expected],needed=accessor.count*size*4;
    if(view.byteStride!==undefined&&view.byteStride!==size*4)throw Error('Interleaved baked buffer views are not read');
    const viewStart=view.byteOffset||0,start=viewStart+(accessor.byteOffset||0);
    if(!Number.isInteger(view.byteLength)||viewStart+view.byteLength>bin.byteLength)throw Error('Baked buffer view falls outside the GLB binary chunk');
    if(start%4||start+needed>viewStart+view.byteLength)throw Error('Baked accessor falls outside its buffer view');
    const source=new DataView(bin.buffer,bin.byteOffset+start,needed),out=new Float32Array(accessor.count*size);
    for(let i=0;i<out.length;i++){const value=source.getFloat32(i*4,true);if(!Number.isFinite(value))throw Error('Non-finite baked vertex value');out[i]=value;}
    return out;
  }

  const nodes=json.scenes?.[json.scene??0]?.nodes;
  if(!Array.isArray(nodes)||!nodes.length)throw Error('Baked junction GLB has no scene nodes');
  const meshes=[];let triangles=0;
  for(const nodeIndex of nodes){
    const node=json.nodes?.[nodeIndex];
    if(!node)throw Error('Missing baked node');
    if(node.children?.length||node.matrix||node.translation||node.rotation||node.scale)throw Error('Baked junction nodes carry no transform or hierarchy');
    const mesh=json.meshes?.[node.mesh];
    if(!mesh||mesh.primitives?.length!==1)throw Error('Each baked node needs exactly one mesh primitive');
    const primitive=mesh.primitives[0];
    if((primitive.mode??TRIANGLES)!==TRIANGLES)throw Error('Only baked triangle primitives are read');
    if(primitive.indices!==undefined)throw Error('The bake writes non-indexed triangles');
    const attributes={};
    for(const name of Object.keys(primitive.attributes||{}))if(!(name in ATTRIBUTES))throw Error('Unexpected baked vertex attribute: '+name);
    for(const [name,type] of Object.entries(ATTRIBUTES))if(primitive.attributes?.[name]!==undefined)attributes[name]=read(primitive.attributes[name],type);
    const positions=attributes.POSITION;
    if(!positions||positions.length%9)throw Error('Baked positions must be whole non-indexed triangles');
    const vertexCount=positions.length/3;
    for(const [name,values] of Object.entries(attributes))if(values.length/COMPONENTS[ATTRIBUTES[name]]!==vertexCount)throw Error('Baked attribute lengths disagree: '+name);
    meshes.push({name:node.name??mesh.name??'baked-'+nodeIndex,material:primitive.material??null,vertexCount,triangleCount:vertexCount/3,
      positions,normals:attributes.NORMAL??null,uv:attributes.TEXCOORD_0??null});
    triangles+=vertexCount/3;
  }
  // The bake records its own placement metadata; the caller must use that rather
  // than assume an axis convention or an exaggerated base elevation.
  return {extras:json.extras??null,meshes,triangles,materials:json.materials??[],generator:json.asset?.generator??null};
}

// The bake writes `positions.push(v.x, v.z, -v.y)` from an east/north/elevation
// projection, so a baked vertex is (east metres, metres above the recorded base
// elevation, south metres). Source elevations are not artistically exaggerated.
export function bakedVertexToLocalMetres(x,y,z,baseElevationM){
  return [x,-z,y+baseElevationM];
}

// Fail rather than place the mesh from assumed metadata. A mismatched centre,
// datum base or axis string would silently sink or float the junction.
export function describeBakedExtras(extras){
  const center=extras?.center;
  if(!Array.isArray(center)||center.length!==2||!center.every(Number.isFinite)||Math.abs(center[0])>180||Math.abs(center[1])>90)throw Error('Baked junction asset is missing a usable geographic centre');
  const baseElevationM=extras.baseElevationNAVD88M;
  if(!Number.isFinite(baseElevationM))throw Error('Baked junction asset is missing its base elevation');
  if(typeof extras.axes!=='string'||!/x east/i.test(extras.axes)||!/z south/i.test(extras.axes))throw Error('Baked junction axes metadata does not match this reader');
  if(extras.nativeTerrainUnmodified!==true)throw Error('Baked junction terrain must declare unmodified native source elevations');
  return {center,baseElevationM,sourceRun:extras.sourceRun??null,axes:extras.axes,imageryNote:extras.imagery??null};
}
