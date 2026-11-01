// Actual compact partial-run frame, not a synthetic forecast or browser benchmark.
// Compares only overview projection/clipping against the checked-in baseline.
import {readFile,writeFile} from 'node:fs/promises';import {resolve} from 'node:path';import {gunzipSync} from 'node:zlib';import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';import assert from 'node:assert/strict';
import {decodeCompactQuadtree,acceptQuadtreeGeometry,acceptQuadtreeFrame} from '../public/simulation/quadtree-output.js';
import {buildNativeOverview} from '../tools/simulation/refined-overview-source.js';
const root=resolve('public/simulation/data/refined-compact-41339621278');
const manifest=JSON.parse(await readFile(resolve(root,'manifest.json'),'utf8'));
async function artifact(a,geometry){const bytes=await readFile(resolve(root,a.path));assert.equal(createHash('sha256').update(bytes).digest('hex'),a.sha256);const raw=gunzipSync(bytes);return decodeCompactQuadtree(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength),geometry);}
const geometry=acceptQuadtreeGeometry(manifest,await artifact(manifest.geometry)),frame=acceptQuadtreeFrame(manifest,geometry,await artifact(manifest.frames[0],geometry),manifest.frames[0].time);
const baselineRef=process.env.OVERVIEW_BASELINE_REF||'4aeb3100fb67591a4aef5de9d0d68c7239a4466e';
const beforeSource=execFileSync('C:/Program Files/Git/cmd/git.exe',['show',baselineRef+':tools/simulation/refined-overview-source.js'],{encoding:'utf8'});
const baseline=await import('data:text/javascript;base64,'+Buffer.from(beforeSource).toString('base64'));
const bounds={xmin:Infinity,ymin:Infinity,xmax:-Infinity,ymax:-Infinity};for(const ring of geometry.rings)for(const [lat,lon]of ring){bounds.xmin=Math.min(bounds.xmin,lon);bounds.xmax=Math.max(bounds.xmax,lon);bounds.ymin=Math.min(bounds.ymin,lat);bounds.ymax=Math.max(bounds.ymax,lat);}
const dx=bounds.xmax-bounds.xmin,dy=bounds.ymax-bounds.ymin,visible=geometry.cells.map((_,i)=>i),samples=[];
for(const pan of [-.02,-.01,0,.01]){const extent={xmin:bounds.xmin+dx*(pan-.05),xmax:bounds.xmax+dx*(pan+.05),ymin:bounds.ymin-dy*.05,ymax:bounds.ymax+dy*.05};const args={geometry,frame,visible,extent,width:1200,height:800,yieldWork:async()=>{}};
 globalThis.gc?.();const before=await baseline.buildNativeOverview(args),after=await buildNativeOverview(args);
 for(const key of ['coverage','wet','missing','maximum','rgba'])assert.deepEqual(after[key],before[key],`${key} changed for actual frame at pan ${pan}`);
 assert.equal(after.stats.intersections,before.stats.intersections);samples.push({pan,extent,visibleFaces:visible.length,intersections:after.stats.intersections,baselineMs:before.stats.buildMs,typedScratchMs:after.stats.buildMs,byteEquivalent:true});
}
const mean=key=>samples.reduce((s,x)=>s+x[key],0)/samples.length;
const evidence={environment:'Node.js '+process.version+'; projection/clipping only; cooperative waits disabled identically; not integrated browser acceptance',baselineRef,runId:manifest.runId,publicationStatus:manifest.status,time:frame.time,geometrySha256:manifest.geometry.sha256,frameSha256:manifest.frames[0].sha256,cells:geometry.cells.length,baselineMeanMs:mean('baselineMs'),typedScratchMeanMs:mean('typedScratchMs'),samples};
const output=resolve(process.env.OVERVIEW_EVIDENCE_PATH||'public/simulation/preview/refined-overview-allocation-evidence.json');await writeFile(output,JSON.stringify(evidence,null,2));console.log(JSON.stringify({output,...evidence},null,2));
