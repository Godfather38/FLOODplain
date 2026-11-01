// Isolated upgraded-app integration. No solver execution or source artifact edits.
import {prepareCompletedTerrain} from './prepare-completed-terrain.mjs';
import {readFile,writeFile} from 'node:fs/promises';import {createHash} from 'node:crypto';import {resolve} from 'node:path';
const args=process.argv.slice(2),arg=(name,fallback)=>{const i=args.indexOf(name);return i<0?fallback:args[i+1];};
const source=arg('--source');if(!source)throw Error('Explicit immutable terrain source directory required');
const root='public/simulation/',relative='data/refined-full-compact-41344983607/',target=root+relative;
const bytes=await readFile(target+'manifest.json'),manifest=JSON.parse(bytes),hash=value=>createHash('sha256').update(value).digest('hex');
if(manifest.runId!=='refined-full-41344983607'||manifest.status!=='complete'||manifest.frames.length!==57||manifest.executionMode!=='simulated_live_frozen_inputs'||manifest.validFrom!=='2026-11-01T17:00:00Z'||manifest.validTo!=='2026-11-02T07:00:00Z')throw Error('Completed supplied run identity/time mismatch');
const binding=await prepareCompletedTerrain({source:resolve(source),target:resolve(target),reader:resolve(root+'quadtree-output.js'),descriptor:'terrain-display-overview.json',write:false});
const terrainDisplay={...binding.descriptor,artifactBase:'../refined-partial-41339621278/'};
const next=JSON.stringify({...manifest,terrainDisplay},null,2)+'\n';
const pointer={status:'complete',path:relative+'manifest.json',sha256:hash(next),runId:manifest.runId,executionMode:manifest.executionMode,validFrom:manifest.validFrom,validTo:manifest.validTo,frames:57,note:'Completed native output using original frozen model inputs; not an automatic current-weather refresh.'};
if(args.includes('--write')){await writeFile(target+'terrain-display.json',JSON.stringify(terrainDisplay,null,2)+'\n');await writeFile(target+'manifest.json',next);await writeFile(root+'data/refined-sfincs-publication.json',JSON.stringify(pointer,null,2)+'\n');}
const report={written:args.includes('--write'),sourceModelManifestSha256:hash(bytes),integratedManifestSha256:pointer.sha256,pointer,verifiedArtifacts:binding.artifacts,verifiedTerrainBytes:binding.totalBytes,geometryEquivalence:binding.equivalence};
await writeFile(root+'preview/upgraded-completed-binding.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
