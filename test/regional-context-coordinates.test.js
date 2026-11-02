import test from 'node:test';
import assert from 'node:assert/strict';
import {createRegionalContext} from '../tools/simulation/regional-context-source.js';
const grid={bounds:[0,0,2,2],columns:3,rows:3,elevations:Array(9).fill(6000)};
const options={grid,project:([x,y])=>({x,y}),altitude:m=>m,origin:{x:0,y:0,z:7},baseM:500};
test('regional ground shares native local elevation origin without an arbitrary offset',()=>{
 const scene=createRegionalContext(options);
 assert.equal(scene.geometry.getAttribute('position').array[2],100);
 assert.equal(scene.stats.verticalExaggeration,1);
 assert.equal(scene.stats.seamDropM,0);
 scene.dispose();
});
test('regional geometry excludes native bounds instead of covering modeled water',()=>{
 const scene=createRegionalContext({...options,nativeBounds:[.9,.9,1.1,1.1]});
 assert.equal(scene.stats.triangles,0,'all four test quads touch the native center vertex');
 assert.equal(scene.stats.droppedTrianglesOverNativeDomain,4);
 scene.dispose();
});
