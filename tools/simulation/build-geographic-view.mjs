import {build} from 'esbuild';
import {readFile,writeFile,readdir,unlink} from 'node:fs/promises';
const result=await build({entryPoints:{'geographic-view':'tools/simulation/geographic-view-source.js'},outdir:'public/simulation',splitting:true,chunkNames:'renderer-chunks/[name]-[hash]',bundle:true,format:'esm',minify:true,legalComments:'eof',metafile:true});
// Only remove obsolete, generated hash-named chunks inside this owned directory.
const chunkRoot='public/simulation/renderer-chunks/';
for(const name of await readdir(chunkRoot))if(/^(?:chunk|geographic-3d-runtime|junction-fluid-controller|regional-context-source)-[A-Z0-9]+\.js$/.test(name)&&!result.metafile.outputs[chunkRoot+name])await unlink(chunkRoot+name);
const notices=[],seen=new Set();
async function collect(name){if(seen.has(name)||name.startsWith('@types/'))return;seen.add(name);const root='node_modules/'+name;
  const pkg=JSON.parse(await readFile(root+'/package.json','utf8')),files=await readdir(root),licenses=files.filter(f=>/^licen[cs]e(?:\.|$)/i.test(f));
  notices.push(`${name}@${pkg.version} — ${pkg.license||'See license text below'}\n${(await Promise.all(licenses.map(f=>readFile(root+'/'+f,'utf8')))).join('\n')}`);
  for(const dep of Object.keys(pkg.dependencies||{}))await collect(dep);
}
for(const name of ['three','maptalks','maptalks.three','@mapbox/vector-tile','pbf'])await collect(name);
await writeFile('public/simulation/vendor/VOXEL-RENDERER-LICENSES.txt',notices.join('\n\n'));
