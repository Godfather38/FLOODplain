// Runs on the deploy copy after version stamping. Lists every module the app needs at startup in
// index.html, so browsers fetch them together instead of discovering them one level at a time.
// Modules can't simply be bundled: many find their data with import.meta.url.
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname,join,relative} from 'node:path';

const root=process.argv[2]??'public';
const STATIC_IMPORT=/^\s*(?:import\s+(?:[^'"]*?from\s+)?|export\s+[^'"]*?from\s+)['"](\.[^'"]+)['"]/gm;
export function moduleGraph(entry,base=root){
 const seen=new Set();
 const walk=(spec,from)=>{
  const [path,query]=spec.split('?');
  const file=join(from,path);
  if(!existsSync(file))throw Error('Missing module: '+file);
  const name=relative(base,file).replaceAll('\\','/')+(query?'?'+query:'');
  if(seen.has(name))return;
  seen.add(name);
  for(const m of readFileSync(file,'utf8').matchAll(STATIC_IMPORT))walk(m[1],dirname(file));
 };
 walk(entry,base);
 return [...seen];
}
const page=join(root,'index.html');
const html=readFileSync(page,'utf8');
const entry=/<script type="module" src="([^"]+)"/.exec(html)?.[1];
if(!entry)throw Error('No module entry in index.html');
const links=moduleGraph(entry).map(m=>`  <link rel="modulepreload" href="${m}">`).join('\n');
writeFileSync(page,html.replace('</head>',links+'\n</head>'));
console.log(`Preloading ${links.split('\n').length} modules.`);
