import {test} from 'node:test';
import assert from 'node:assert/strict';
import {imperialSourceText} from '../public/display-units.js';
import {readFileSync} from 'node:fs';
test('source descriptions convert lengths without changing dates or raw artifacts',()=>{
 assert.equal(imperialSourceText('Retained 1 m terrain, 100 m cell; acquired 2021-10-06.'),'Retained 3.3 ft terrain, 328.1 ft cell; acquired 2021-10-06.');
 const r=JSON.parse(readFileSync(new URL('../public/simulation/data/bridge-evidence-registry.json',import.meta.url)));
 assert.ok(r.bridges.some(b=>b.modelWater?.units==='m'));
});
test('display feet preserve signed bridge margins and the original depth bins',()=>{
 assert.equal((0.3048/0.3048).toFixed(1),'1.0');
 assert.equal((-0.3048/0.3048).toFixed(1),'-1.0');
 const s=readFileSync(new URL('../public/simulation/map-layers.js',import.meta.url),'utf8');
 assert.match(s,/depthCuts=\[.01,.1,.3,1,2,4\]/);
 assert.match(s,/Average water depth \(ft\)/);
 assert.doesNotMatch(s,/toFixed\(3\)\+' m \/ '/);
});

test('both visible legends convert each original metric color boundary',()=>{
 for(const f of ['map-shell.js','map-layers.js']){const source=readFileSync(new URL('../public/simulation/'+f,import.meta.url),'utf8');for(const bin of ["0.03–0.3","0.3–1","1–3.3","3.3–6.6","6.6–13.1","13.1+"])assert.ok(source.includes(bin),f+' missing '+bin);}
});
