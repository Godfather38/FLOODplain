import {readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
const files=(await readdir(new URL('../src/',import.meta.url))).filter(x=>x.endsWith('.js'));
for(const file of files){
 const result=spawnSync(process.execPath,['--check',new URL(`../src/${file}`,import.meta.url).pathname],{encoding:'utf8'});
 if(result.status!==0){process.stderr.write(result.stderr);process.exit(result.status||1);}
}
console.log(`Syntax checked ${files.length} source modules.`);
