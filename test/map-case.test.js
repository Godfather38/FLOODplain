import test from 'node:test';import assert from 'node:assert/strict';
import {selectedMapCase,loadRefinedMapCase} from '../public/simulation/map-case.js';
test('refined opt-in never substitutes frozen output for an unavailable publication',async()=>{
 assert.equal(selectedMapCase(''),'frozen');assert.equal(selectedMapCase('?case=refined'),'refined');assert.equal(selectedMapCase('?case=unknown'),'frozen');
 let calls=0;const result=await loadRefinedMapCase({base:'https://example.test/simulation/',fetchImpl:async()=>{calls++;return new Response(JSON.stringify({status:'unavailable',reason:'No completed native output'}))}});
 assert.equal(result.status,'unavailable');assert.equal(calls,1);assert.equal(result.source,undefined);
 await assert.rejects(()=>loadRefinedMapCase({base:'https://example.test/simulation/',fetchImpl:async()=>new Response(JSON.stringify({status:'complete',path:'https://unrelated.test/manifest.json',sha256:'a'.repeat(64)}))}),/pointer/);
});
