// Verify immutable terrain reuse; never changes frames, manifests or publication pointers.
import {readFile,writeFile,copyFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
const hash=b=>createHash('sha256').update(b).digest('hex');
export function verifyCompletedGeometry(source,target,a,b){
  if(source.kind!=='quadtree_output_package'||target.kind!=='quadtree_output_package'||target.status!=='complete')throw Error('Completed native target required');
  if(!/^[a-f0-9]{64}$/.test(source.provenance?.meshSha256)||source.provenance.meshSha256!==target.provenance?.meshSha256||!source.provenance.verticalDatum||source.provenance.verticalDatum!==target.provenance.verticalDatum)throw Error('Native mesh/datum mismatch');
  if(!/^[a-f0-9]{64}$/.test(source.geometry?.sha256)||!/^[a-f0-9]{64}$/.test(target.geometry?.sha256))throw Error('Native geometry hash required');
  if(a.runId!==source.runId||b.runId!==target.runId||a.geometryKind!=='native_quadtree_faces'||b.geometryKind!==a.geometryKind||a.projectedCrs!==b.projectedCrs||a.cells.length!==b.cells.length||a.rings.length!==b.rings.length||a.cells.length!==a.rings.length||source.resolution.cellCount!==a.cells.length||target.resolution.cellCount!==b.cells.length)throw Error('Native geometry identity/shape/CRS mismatch');
  const canonical=createHash('sha256');
  for(let i=0;i<a.cells.length;i++){
    const x=a.cells[i],y=b.cells[i];
    for(const k of ['nativeFaceId','lon','lat','areaM2','resolutionM'])if(x[k]!==y[k])throw Error('Native face mismatch '+i+':'+k);
    for(const [name,left,right] of [['ring',a.rings[i],b.rings[i]],['edges',x.edgeLengthsM,y.edgeLengthsM]])if(JSON.stringify(left)!==JSON.stringify(right))throw Error('Native '+name+' mismatch '+i);
    canonical.update(JSON.stringify([y.nativeFaceId,y.lon,y.lat,y.areaM2,y.resolutionM,y.edgeLengthsM,b.rings[i]])+'\n');
  }
  return {method:'exact-native-geometry',runId:target.runId,sourceRunId:source.runId,targetRunId:target.runId,sourceGeometrySha256:source.geometry.sha256,targetGeometrySha256:target.geometry.sha256,meshSha256:target.provenance.meshSha256,verticalDatum:target.provenance.verticalDatum,cellCount:b.cells.length,canonicalSha256:canonical.digest('hex'),verifiedFields:['ordered nativeFaceId','lon','lat','areaM2','resolutionM','edgeLengthsM','all native ring vertices','projectedCrs','native mesh SHA256','vertical datum']};
}
export function terrainArtifacts(index,descriptor){
  const artifacts=new Map();
  const add=a=>{if(!a||!/^[a-zA-Z0-9_-]+\.json\.gz$/.test(a.path)||!/^[a-f0-9]{64}$/.test(a.sha256)||!Number.isInteger(a.bytes)||a.bytes<0)throw Error('Invalid terrain artifact');const prior=artifacts.get(a.path);if(prior&&(prior.sha256!==a.sha256||prior.bytes!==a.bytes))throw Error('Conflicting terrain artifact');artifacts.set(a.path,a);};
  add(descriptor);for(const tile of index.tiles)for(const level of tile.levels)add(level.artifact);
  for(const level of index.overviewLevels??[])add(level.artifact);
  if(index.waterSupport)add(index.waterSupport.artifact);
  return artifacts;
}
export async function prepareCompletedTerrain({source,target,reader,descriptor='terrain-display-overview.json',write=false}){
  source=resolve(source);target=resolve(target);if(source===target)throw Error('Distinct immutable source and target directories required');
  const sourceBytes=await readFile(join(source,'manifest.json')),targetBytes=await readFile(join(target,'manifest.json'));
  const original=JSON.parse(sourceBytes),manifest=JSON.parse(targetBytes);
  async function verified(root,a){if(!a||!/^[a-zA-Z0-9_-]+\.(json|bin)\.gz$/.test(a.path))throw Error('Unsafe artifact name');const bytes=await readFile(join(root,a.path));if(bytes.length!==a.bytes||hash(bytes)!==a.sha256)throw Error('Artifact checksum/size mismatch: '+a.path);return bytes;}
  let decoder;
  async function geometry(root,m){const bytes=gunzipSync(await verified(root,m.geometry));if(m.geometry.path.endsWith('.json.gz'))return JSON.parse(bytes);decoder??=(await import(pathToFileURL(resolve(reader)))).decodeCompactQuadtree;return decoder(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));}
  const a=await geometry(source,original),b=await geometry(target,manifest),equivalence=verifyCompletedGeometry(original,manifest,a,b);
  const display=JSON.parse(await readFile(join(source,descriptor)));
  const binding=x=>{if(x.runId!==original.runId||x.geometrySha256!==original.geometry.sha256||x.verticalDatum!==original.provenance.verticalDatum)throw Error('Terrain source binding mismatch');const mesh=x.meshSha256??x.provenance?.meshSha256;if(mesh!==undefined&&mesh!==equivalence.meshSha256)throw Error('Terrain mesh mismatch');};
  binding(display);const indexBytes=await verified(source,display.artifact),index=JSON.parse(gunzipSync(indexBytes));binding(index);
  if(index.kind!=='native_face_terrain_tiles')throw Error('Tiled terrain required');
  const artifacts=terrainArtifacts(index,display.artifact);
  let totalBytes=0;
  // Verify every unchanged payload, even in read-only mode; copy bytes only when requested.
  if(write)await mkdir(target,{recursive:true});
  for(const artifact of artifacts.values()){
    const bytes=await verified(source,artifact),value=JSON.parse(gunzipSync(bytes));binding(value);totalBytes+=bytes.length;
    if(write)await copyFile(join(source,artifact.path),join(target,artifact.path));
  }
  const result={...display,runId:manifest.runId,geometrySha256:manifest.geometry.sha256,geometryEquivalence:equivalence,
    sourceRunId:original.runId,sourceGeometrySha256:original.geometry.sha256,
    provenance:{sourceManifestSha256:hash(sourceBytes),targetManifestSha256:hash(targetBytes),sourceTerrainIndex:display.artifact,method:'Unchanged terrain bytes reused after exact ordered native geometry and mesh/datum comparison'},
    note:'Display terrain reused from identical native mesh; water and time come exclusively from the completed target run. Coarse terrain omits interior detail; no new hydraulics.'};
  if(write)await writeFile(join(target,'terrain-display.json'),JSON.stringify(result,null,2)+'\n');
  return {written:write,target,artifacts:artifacts.size,totalBytes,equivalence,descriptor:result};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const args=process.argv.slice(2),option=(k,d)=>{const i=args.indexOf(k);return i<0?d:args[i+1];};
  const source=option('--source'),target=option('--target');if(!source||!target)throw Error('Explicit --source and --target package directories required');
  console.log(JSON.stringify(await prepareCompletedTerrain({source,target,reader:option('--reader','public/simulation/quadtree-output.js'),descriptor:option('--descriptor','terrain-display-overview.json'),write:args.includes('--write')}),null,2));
}
