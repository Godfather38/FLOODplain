import {acceptQuadtreeGeometry,acceptQuadtreeFrame,readQuadtreeArtifact} from './quadtree-output.js';
import {modelFreshness} from './scene-data-contract.js';

// Opt-in backend loader; no renderer import, default-case switch or publication mutation.
export async function loadSilverbellData({base,now,fetchImpl=fetch,signal}={}) {
  const pointerURL=new URL('data/silverbell-scene-publication.json',base);
  const pr=await fetchImpl(pointerURL,{signal});if(!pr.ok)throw Error('Silverbell pointer HTTP '+pr.status);
  const pointer=await pr.json();
  if(pointer.status!=='complete'||pointer.runId!=='silverbell-full-41370039087'||pointer.path!=='data/silverbell-full-41370039087/compact/manifest.json'||!/^[a-f0-9]{64}$/.test(pointer.sha256))throw Error('Invalid Silverbell binding');
  const url=new URL(pointer.path,base),r=await fetchImpl(url,{signal});if(!r.ok)throw Error('Silverbell manifest HTTP '+r.status);
  const bytes=await r.arrayBuffer();const actual=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  if(actual!==pointer.sha256)throw Error('Silverbell manifest checksum mismatch');
  const manifest=JSON.parse(new TextDecoder().decode(bytes));
  if(manifest.status!=='complete'||manifest.runId!==pointer.runId||manifest.executionMode!=='simulated_live_frozen_inputs'||manifest.geometry.sha256!==pointer.geometrySha256)throw Error('Silverbell run/geometry mismatch');
  const geometry=acceptQuadtreeGeometry(manifest,await readQuadtreeArtifact(url,manifest.geometry,{fetchImpl,signal}));
  const freshness=modelFreshness({...manifest,clockMode:'frozen_replay'},now);
  async function readFrame(index,{signal:frameSignal=signal}={}) {
    if(!Number.isInteger(index)||index<0||index>=manifest.frames.length)throw Error('Native frame index out of range');
    const descriptor=manifest.frames[index];
    return acceptQuadtreeFrame(manifest,geometry,await readQuadtreeArtifact(url,descriptor,{fetchImpl,signal:frameSignal,geometry}),descriptor.time);
  }
  return {status:'complete',manifest,geometry,readFrame,freshness,
    terrain:{status:'unavailable',reason:'No source-bound terrain for this geometry; old face ordering must not be reused'},
    flow:{status:'unavailable',velocityMps:null,direction:null}};
}
