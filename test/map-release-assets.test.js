import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync,readFileSync,existsSync} from 'node:fs';
import path from 'node:path';
test('published map modules include their relative static and lazy chunks',()=>{
 const root=path.resolve('public/simulation');let checked=0;
 function inspect(dir){for(const item of readdirSync(dir,{withFileTypes:true})){
  const file=path.join(dir,item.name);if(item.isDirectory()){inspect(file);continue}if(!file.endsWith('.js'))continue;
  const text=readFileSync(file,'utf8');for(const match of text.matchAll(/(?:from\s*|import\s*\()\s*['"](\.[^'"]+)['"]/g)){
   const target=path.resolve(path.dirname(file),match[1].split('?')[0]);assert.ok(existsSync(target),`${file} requires missing ${target}`);checked++;
  }
 }}inspect(root);assert.ok(checked>10);
});
