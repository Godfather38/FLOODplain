// Parent/UI integration helper. Default is read-only; --write binds only the
// terrain descriptor and refreshes the existing publication manifest checksum.
import {readFile,writeFile} from 'node:fs/promises';import {createHash} from 'node:crypto';import {gunzipSync} from 'node:zlib';
const root='public/simulation/',publicationPath=root+'data/refined-sfincs-publication.json';
const hash=b=>createHash('sha256').update(b).digest('hex');
const publication=JSON.parse(await readFile(publicationPath)),manifestPath=root+publication.path;
if(publication.path!=='data/refined-partial-41339621278/manifest.json')throw Error('Unexpected publication: refusing to bind terrain to another run');
const original=await readFile(manifestPath);if(hash(original)!==publication.sha256)throw Error('Existing publication manifest checksum mismatch');
const manifest=JSON.parse(original),base=manifestPath.slice(0,manifestPath.lastIndexOf('/')+1),display=JSON.parse(await readFile(base+'terrain-display.json'));
if(display.runId!==manifest.runId||display.geometrySha256!==manifest.geometry.sha256||display.verticalDatum!==manifest.provenance.verticalDatum)throw Error('Terrain descriptor source binding mismatch');
const bytes=await readFile(base+display.artifact.path);if(hash(bytes)!==display.artifact.sha256||bytes.length!==display.artifact.bytes)throw Error('Terrain index checksum/size mismatch');
const index=JSON.parse(gunzipSync(bytes));if(index.runId!==manifest.runId||index.geometrySha256!==manifest.geometry.sha256||index.verticalDatum!==manifest.provenance.verticalDatum)throw Error('Terrain index identity mismatch');
const next=JSON.stringify({...manifest,terrainDisplay:display},null,2)+'\n',sha256=hash(next);
if(process.argv.includes('--write')){await writeFile(manifestPath,next);await writeFile(publicationPath,JSON.stringify({...publication,sha256},null,2)+'\n');}
console.log(JSON.stringify({written:process.argv.includes('--write'),runId:manifest.runId,status:manifest.status,validFrom:manifest.validFrom,validTo:manifest.validTo,frames:manifest.frames.length,oldManifestSha256:publication.sha256,newManifestSha256:sha256,terrainIndex:display.artifact},null,2));
