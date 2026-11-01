// Actual output audit: exact clipped native triangle count for every full-run frame.
import {readFile,writeFile} from 'node:fs/promises';import {gunzipSync} from 'node:zlib';import {createHash} from 'node:crypto';
import {decodeCompactQuadtree} from '../../public/simulation/quadtree-output.js';
const root='public/simulation/data/refined-full-compact-41344983607/',terrainRoot='public/simulation/data/refined-partial-41339621278/';
const manifest=JSON.parse(await readFile(root+'manifest.json')),digest=b=>createHash('sha256').update(b).digest('hex');
async function checked(base,a){const b=await readFile(base+a.path);if(digest(b)!==a.sha256||b.length!==a.bytes)throw Error('Hash/size mismatch '+a.path);return gunzipSync(b);}
const geometryRaw=await checked(root,manifest.geometry),geometry=decodeCompactQuadtree(geometryRaw.buffer.slice(geometryRaw.byteOffset,geometryRaw.byteOffset+geometryRaw.byteLength));
const index=JSON.parse(await checked(terrainRoot,manifest.terrainDisplay.artifact)),support=JSON.parse(await checked(terrainRoot,index.waterSupport.artifact));
const array=(name,C)=>{const b=Buffer.from(support.encoding[name].base64,'base64');return new C(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));};
const heights=array('boundaryElevationM',Float32Array),vertices=array('faceVertexOffsets',Uint32Array),triangles=array('faceTriangleOffsets',Uint32Array),indices=array('localTriangleIndices',Uint8Array),frames=[];
for(const descriptor of manifest.frames){const raw=await checked(root,descriptor),frame=decodeCompactQuadtree(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength),geometry);let wetFaces=0,waterTriangles=0,missingSurfaceWetFaces=0;
 for(let i=0;i<geometry.cells.length;i++){if(!(frame.depthM[i]>=.01))continue;const z=frame.waterSurfaceM[i];if(!Number.isFinite(z)){missingSurfaceWetFaces++;continue;}wetFaces++;const offset=vertices[i];for(let j=triangles[i]*3;j<triangles[i+1]*3;j+=3){const wet=(z>heights[offset+indices[j]]?1:0)+(z>heights[offset+indices[j+1]]?1:0)+(z>heights[offset+indices[j+2]]?1:0);waterTriangles+=wet===2?2:wet?1:0;}}
 frames.push({time:frame.time,wetFaces,waterTriangles,missingSurfaceWetFaces});
}
const maximum=frames.reduce((a,b)=>b.waterTriangles>a.waterTriangles?b:a),result={runId:manifest.runId,geometrySha256:manifest.geometry.sha256,frames:frames.length,phoneBudget:120000,allFramesFitPhone:frames.every(f=>f.waterTriangles<=120000),maximum,frameCounts:frames,method:'Native depth threshold0.01m, finite native zs, original face-local support triangles clipped by retained boundary elevations; no interpolation between times.'};
await writeFile('public/simulation/preview/upgraded-full-water-budget.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({...result,frameCounts:undefined},null,2));if(!result.allFramesFitPhone)process.exitCode=1;
