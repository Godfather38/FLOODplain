// Saved model runs reach the public only through Test flood mode. This runs on the deploy copy of
// public/, keeps exactly that package, removes all other model data, and fails if any remains.
import {existsSync,readdirSync,rmSync,statSync} from 'node:fs';
import {join,relative} from 'node:path';

const root=process.argv[2]??'public';
const dataDir=join(root,'simulation/data');
// Reference data the live app reads. None of it is model output.
const LIVE_DATA=new Set(['bridge-evidence-registry.json','bridge-evidence-source.json','route-tracking.json']);
// The files Test flood mode requests, and only those.
const TEST_FLOOD_PACKAGE=new Set(['retained-sfincs-manifest.json','frozen-map-context.json','frozen-map-polygons.json.gz','frozen-cell-footprints.json.gz','current-crossing-coverage.json','frozen-20261101-nwm13z-41327417204.json.gz','frozen-terrain-display.json.gz','frozen-voxel-terrain.f32.gz','frozen-voxel-terrain.json']);
const isTestFloodFile=name=>TEST_FLOOD_PACKAGE.has(name)||/^water-footprints-\d+\.json\.gz$/.test(name);
const DEV_ONLY=['simulation/preview','ux-preview'];

if(existsSync(dataDir))for(const name of readdirSync(dataDir))if(!LIVE_DATA.has(name)&&!isTestFloodFile(name))rmSync(join(dataDir,name),{recursive:true,force:true});
for(const path of DEV_ONLY)rmSync(join(root,path),{recursive:true,force:true});

function walk(dir){return readdirSync(dir).flatMap(name=>{const path=join(dir,name);return statSync(path).isDirectory()?walk(path):[path]})}
const banned=walk(root).map(path=>relative(root,path).replaceAll('\\','/')).filter(path=>{
 if(path.startsWith('simulation/data/')&&isTestFloodFile(path.slice('simulation/data/'.length)))return false;
 return /frozen|refined|retained|sfincs|silverbell|road-replay|all-route|scene-contract|frame-\d+/i.test(path.replace(/^simulation\/[a-z-]+\.(js|css)$/,''));
});
if(banned.length){console.error('Model data outside Test flood would be published:\n'+banned.join('\n'));process.exit(1)}
console.log('Published copy holds no model data outside Test flood.');
