import {validateScene} from './scene-data-contract.js';
// Lazy, source-checked input for the existing map's Brawley layer. No camera/UI.
export async function loadBrawleyScene({signal,fetchImpl=fetch}={}){
 const base=new URL('./data/scene-contract/',import.meta.url),manifestResponse=await fetchImpl(new URL('package-manifest.json',base),{signal});if(!manifestResponse.ok)throw Error('Brawley package HTTP '+manifestResponse.status);const manifest=await manifestResponse.json();
 const hash=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
 async function read(path){const entry=manifest.files.find(f=>f.path===path);if(!entry||path.includes('..'))throw Error('Unlisted Brawley asset');const r=await fetchImpl(new URL(path,base),{signal});if(!r.ok)throw Error('Brawley asset HTTP '+r.status);const bytes=await r.arrayBuffer();if(bytes.byteLength!==entry.bytes||await hash(bytes)!==entry.sha256)throw Error('Brawley asset checksum mismatch: '+path);if(signal?.aborted)throw new DOMException('Cancelled','AbortError');return path.endsWith('.gz')?new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).json():JSON.parse(new TextDecoder().decode(bytes));}
 const scene=validateScene(await read(manifest.entrypoint));const [terrainTiles,roads]=await Promise.all([Promise.all(scene.terrain.map(t=>read(t.path))),read('brawley-roads.geojson')]);return {scene,terrainTiles,roads};
}
