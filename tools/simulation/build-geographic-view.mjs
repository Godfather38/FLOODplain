import {build} from 'esbuild';
import {readFile,writeFile,readdir} from 'node:fs/promises';
await build({entryPoints:['tools/simulation/geographic-view-source.js'],outfile:'public/simulation/geographic-view.js',bundle:true,format:'esm',minify:true,legalComments:'eof'});
const notices=[],seen=new Set();
async function collect(name){if(seen.has(name)||name.startsWith('@types/'))return;seen.add(name);const root='node_modules/'+name;
  const pkg=JSON.parse(await readFile(root+'/package.json','utf8')),files=await readdir(root),licenses=files.filter(f=>/^licen[cs]e(?:\.|$)/i.test(f));
  notices.push(`${name}@${pkg.version} — ${pkg.license||'See license text below'}\n${(await Promise.all(licenses.map(f=>readFile(root+'/'+f,'utf8')))).join('\n')}`);
  for(const dep of Object.keys(pkg.dependencies||{}))await collect(dep);
}
for(const name of ['three','maptalks','maptalks.three','@mapbox/vector-tile','pbf'])await collect(name);
await writeFile('public/simulation/vendor/VOXEL-RENDERER-LICENSES.txt',notices.join('\n\n'));
