import {acceptQuadtreeGeometry,readQuadtreeArtifact} from './quadtree-output.js';
export function selectedMapCase(search=''){return new URLSearchParams(search).get('case')==='coarse'?'frozen':'refined';}
export async function loadRefinedMapCase({base,fetchImpl=fetch,signal}={}){
 const pointerURL=new URL('data/refined-sfincs-publication.json',base),response=await fetchImpl(pointerURL,{signal,cache:'no-store'});
 if(!response.ok)return {status:'unavailable',reason:'No completed refined model output has been published.'};
 const pointer=await response.json();
 if(!['complete','partial'].includes(pointer.status))return {status:'unavailable',reason:pointer.reason??'Refined case is not available; prepared mesh is not forecast output.'};
 if(!/^data\/[a-zA-Z0-9_-]+\/manifest\.json$/.test(pointer.path)||!/^[a-f0-9]{64}$/.test(pointer.sha256))throw Error('Invalid refined publication pointer');
 const url=new URL(pointer.path,base),r=await fetchImpl(url,{signal});if(!r.ok)throw Error('Refined manifest HTTP '+r.status);
 const bytes=await r.arrayBuffer(),hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');if(hash!==pointer.sha256)throw Error('Refined manifest checksum mismatch');
 const manifest=JSON.parse(new TextDecoder().decode(bytes));
 if(manifest.executionMode!=='simulated_live_frozen_inputs')throw Error('This case route requires explicit frozen-input mode');
 if(manifest.terrainDisplay?.artifactBase&&manifest.terrainDisplay.artifactBase!=='../refined-partial-41339621278/')throw Error('Unexpected terrain artifact base');
 let geometry;
 const readArtifact=(artifact,options={})=>readQuadtreeArtifact(artifact.path.startsWith('terrain-')&&manifest.terrainDisplay?.artifactBase?new URL(manifest.terrainDisplay.artifactBase,url):url,artifact,{fetchImpl,geometry,...options});
 geometry=acceptQuadtreeGeometry(manifest,await readArtifact(manifest.geometry,{signal}));
 const {createRefinedRendererSource}=await import('./geographic-view.js');
 return {status:'complete',source:createRefinedRendererSource({manifest,geometry,readArtifact}),manifest,geometry};
}
