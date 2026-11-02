import bindings from '../../public/simulation/data/coarse-terrain-detail-bindings.json' with {type:'json'};
const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',typeof value==='string'?new TextEncoder().encode(value):value)),b=>b.toString(16).padStart(2,'0')).join('');
export async function validateCoarseTerrainDetail(loaded,terrain,metadata,buffer){
 const hash=loaded.manifest.artifact.sha256;
 if(metadata.sourceSha256===hash)return;
 const b=bindings.find(b=>b.modelArtifactSha256===hash&&b.detailSourceSha256===metadata.sourceSha256);
 if(!b||terrain.sourceSha256!==hash||terrain.terrainSourceSha256!==b.terrainSourceSha256||terrain.verticalDatum!==b.verticalDatum||terrain.cellSizeM!==100||terrain.vertices.length!==b.cellCount||loaded.run.cells.length!==b.cellCount||metadata.cellCount!==b.cellCount||buffer.byteLength!==b.cellCount*100*4)throw Error('Terrain detail provenance mismatch');
 const [vertices,meta,detail]=await Promise.all([digest(JSON.stringify(terrain.vertices)),digest(JSON.stringify(metadata)),digest(buffer)]);
 if(vertices!==b.verticesSha256||meta!==b.metadataSha256||detail!==b.decodedDetailSha256)throw Error('Terrain detail reuse checksum mismatch');
}
