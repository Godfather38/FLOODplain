// Frozen model runs are for development only. This runs on the deploy copy of public/,
// removes everything frozen, and fails the deploy if any of it remains.
import {existsSync,readdirSync,rmSync,statSync} from 'node:fs';
import {join} from 'node:path';

const root=process.argv[2]??'public';
const dataDir=join(root,'simulation/data');
// The only simulation data the published app may read. None of it is model output.
export const PUBLISHED_DATA=new Set(['bridge-evidence-registry.json','bridge-evidence-source.json','route-tracking.json']);
const DEV_ONLY=['simulation/preview','ux-preview'];

if(existsSync(dataDir))for(const name of readdirSync(dataDir))if(!PUBLISHED_DATA.has(name))rmSync(join(dataDir,name),{recursive:true,force:true});
for(const path of DEV_ONLY)rmSync(join(root,path),{recursive:true,force:true});

function walk(dir){return readdirSync(dir).flatMap(name=>{const path=join(dir,name);return statSync(path).isDirectory()?walk(path):[path]})}
const banned=walk(root).filter(path=>/frozen|refined|retained|sfincs|silverbell|road-replay|all-route|scene-contract|frame-\d+/i.test(path.replaceAll('\\','/').replace(/simulation\/[a-z-]+\.(js|css)$/,'')));
if(banned.length){console.error('Frozen data would be published:\n'+banned.join('\n'));process.exit(1)}
console.log('Published copy holds no frozen model data.');
