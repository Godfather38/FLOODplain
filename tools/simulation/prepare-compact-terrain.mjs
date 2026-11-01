// Display preparation only. Does not modify a publication pointer or model manifest.
import {readFile,writeFile,copyFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';import {gunzipSync} from 'node:zlib';
const args=process.argv.slice(2),option=(key,fallback)=>{const i=args.indexOf(key);return i<0?fallback:args[i+1];};
const source=resolve(option('--source','public/simulation/data/refined-partial-41339621278'));
const target=resolve(option('--target','public/simulation/data/refined-compact-41339621278'));
const reader=resolve(option('--reader','public/simulation/quadtree-output.js'));
const descriptorName=option('--descriptor','terrain-display-coarse.json'),hash=b=>createHash('sha256').update(b).digest('hex');
const {decodeCompactQuadtree}=await import(pathToFileURL(reader));
const originalBytes=await readFile(join(source,'manifest.json')),original=JSON.parse(originalBytes),manifest=JSON.parse(await readFile(join(target,'manifest.json')));
if(manifest.runId!==original.runId||manifest.provenance.verticalDatum!==original.provenance.verticalDatum||manifest.compactSource?.manifestSha256!==hash(originalBytes)||manifest.compactSource?.geometry.sha256!==original.geometry.sha256)throw Error('Compact source manifest/run/datum binding mismatch');
async function verified(root,a){if(!/^[a-zA-Z0-9_-]+\.(json|bin)\.gz$/.test(a.path))throw Error('Unsafe artifact name');const b=await readFile(join(root,a.path));if(hash(b)!==a.sha256||b.length!==a.bytes)throw Error('Artifact hash/size mismatch: '+a.path);return b;}
const oldGeometry=JSON.parse(gunzipSync(await verified(source,original.geometry))),raw=gunzipSync(await verified(target,manifest.geometry));
const geometry=decodeCompactQuadtree(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength));
if(geometry.geometryKind!==oldGeometry.geometryKind||geometry.projectedCrs!==oldGeometry.projectedCrs||geometry.cells.length!==oldGeometry.cells.length||geometry.rings.length!==oldGeometry.rings.length)throw Error('Native geometry shape/CRS mismatch');
const canonical=createHash('sha256');
for(let i=0;i<geometry.cells.length;i++){
 const a=oldGeometry.cells[i],b=geometry.cells[i];
 for(const k of ['nativeFaceId','lon','lat','areaM2','resolutionM'])if(a[k]!==b[k])throw Error('Native face mismatch '+i+':'+k);
 for(const [name,x,y]of [['ring',oldGeometry.rings[i],geometry.rings[i]],['edges',a.edgeLengthsM,b.edgeLengthsM]])if(JSON.stringify(x)!==JSON.stringify(y))throw Error('Native '+name+' mismatch '+i);
 canonical.update(JSON.stringify([b.nativeFaceId,b.lon,b.lat,b.areaM2,b.resolutionM,b.edgeLengthsM,geometry.rings[i]])+'\n');
}
const display=JSON.parse(await readFile(join(source,descriptorName))),indexBytes=await verified(source,display.artifact),index=JSON.parse(gunzipSync(indexBytes));
if(display.geometrySha256!==original.geometry.sha256||index.geometrySha256!==original.geometry.sha256||index.runId!==manifest.runId)throw Error('Terrain source mismatch');
const equivalence={method:'exact-native-geometry',runId:manifest.runId,sourceGeometrySha256:original.geometry.sha256,targetGeometrySha256:manifest.geometry.sha256,cellCount:geometry.cells.length,canonicalSha256:canonical.digest('hex'),verifiedFields:['ordered nativeFaceId','lon','lat','areaM2','resolutionM','edgeLengthsM','all native ring vertices','projectedCrs']};
const result={...display,geometrySha256:manifest.geometry.sha256,geometryEquivalence:equivalence};
let artifacts=1,totalBytes=indexBytes.length;
if(args.includes('--write')){
 await mkdir(target,{recursive:true});await copyFile(join(source,display.artifact.path),join(target,display.artifact.path));
 const seen=new Set();for(const tile of index.tiles)for(const level of tile.levels){const a=level.artifact;if(seen.has(a.path))continue;seen.add(a.path);const bytes=await verified(source,a);await writeFile(join(target,a.path),bytes);artifacts++;totalBytes+=bytes.length;}
 await writeFile(join(target,'terrain-display.json'),JSON.stringify(result,null,2)+'\n');
}
console.log(JSON.stringify({written:args.includes('--write'),target,artifacts,totalBytes,equivalence,descriptor:result,note:'Terrain files only. Parent binds terrainDisplay into its verified manifest; no frame or publication changes.'},null,2));
