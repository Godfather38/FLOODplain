import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=f=>readFileSync(new URL('../public/'+f,import.meta.url),'utf8');

test('the Map tab can show everything, hide most controls, or hide them all, and remembers the choice',()=>{
 const app=read('map-app.js'),css=read('sim.css');
 for(const s of ['data-m-ui','data-m-show-ui','data-m-fold',"localStorage.setItem('mapp-ui'"])assert.ok(app.includes(s),s);
 assert.match(app,/UI_MODES=\['full','focus','none'\]/);
 assert.match(css,/\.mapp\.ui-focus \.mapp-panel/);assert.match(css,/\.mapp\.ui-none>\*:not\(\.mapp-show-ui\)/);
 assert.match(css,/body\.mapp-bare>\.appbar/);
 // On a phone the time bar starts folded to one row.
 assert.match(app,/let folded=matchMedia\('\(max-width: 899px\)'\)\.matches/);
});
