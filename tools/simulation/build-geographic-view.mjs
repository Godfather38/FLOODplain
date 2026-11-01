import {build} from 'esbuild';
import {readFile,writeFile} from 'node:fs/promises';
await build({entryPoints:['tools/simulation/geographic-view-source.js'],outfile:'public/simulation/geographic-view.js',bundle:true,format:'esm',minify:true,legalComments:'eof'});
const notices=await Promise.all(['three/LICENSE','maptalks/LICENSE','maptalks.three/LICENSE'].map(async path=>`${path}\n${await readFile('node_modules/'+path,'utf8')}`));
await writeFile('public/simulation/vendor/VOXEL-RENDERER-LICENSES.txt',notices.join('\n\n'));
