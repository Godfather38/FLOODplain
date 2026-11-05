import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileRoadEvents,reconciliationCompatibility} from '../worker/reconcile-road-events.js';
const now=Date.parse('2026-11-04T20:00:00-07:00');
const a={source:'AZ511',id:'az511-1',sourceId:'shared-looking-id',scope:'ramp',direction:'Westbound',
  roadway:'Cortaro ramp',type:'LINESTRING',parts:[[[-111.1,32.4],[-111.1,32.401]]],
  closed:true,start:now+86400000,stop:now+172800000,dailyStart:null,dailyEnd:null};
const b={...a,source:'TransView',id:'work-2'};
const ref=e=>({source:e.source,id:e.id});
const link=(left=a,right=b)=>({left:ref(left),right:ref(right),evidence:'https://example.test/synthetic-verified-crosswalk'});
const run=(events,links=[])=>reconcileRoadEvents(events,{verifiedLinks:links,now});

test('matching sourceId, headline or location alone never deduplicates; county remains',()=>{
  const county={...a,source:'County',id:'county-3',scope:'local'};
  const result=run([a,b,county]);
  assert.deepEqual(result.events,[a,b,county]); assert.equal(result.decisions.length,0);
});
test('explicit verified pair with equivalent scope/direction/geometry/timing preserves both provenances',()=>{
  const result=run([a,b],[link()]);
  assert.equal(result.events.length,1);assert.deepEqual(result.groups[0].originals,[a,b]);
  assert.deepEqual(result.groups[0].sources,['AZ511','TransView']);
  assert.equal(result.decisions[0].status,'equivalent');
});
test('ramp, mainline, frontage and local roads never become interchangeable',()=>{
  for(const scope of ['mainline','frontage','local','unknown',undefined]){
    const other={...b,scope},result=run([a,other],[link(a,other)]);
    assert.equal(result.events.length,2);assert.match(result.decisions[0].reasons.join(),/scope-/);
  }
});
test('nearby parallel geometry, opposite travel and unknown direction retain conflicts',()=>{
  for(const change of [{parts:[[[-111.10001,32.4],[-111.10001,32.401]]]},{direction:'Eastbound'},{direction:'Unknown'},{roadway:'I-10 mainline'},{parts:[]},{type:'POINT',parts:[[[-111.1,32.4]]]}]){
    const other={...b,...change}; const result=run([a,other],[link(a,other)]);
    assert.equal(result.events.length,2);assert.equal(result.decisions[0].status,'retained-conflict');
  }
});
test('reverse vertex order is allowed only with compatible travel direction',()=>{
  const reversed={...b,parts:[[...b.parts[0]].reverse()]};
  assert.equal(reconciliationCompatibility(a,reversed,now).compatible,true);
  assert.equal(reconciliationCompatibility(a,{...reversed,direction:'Eastbound'},now).compatible,false);
});
test('unknown duplicate never overrides scheduled record; conflicting bounds and closure stay visible',()=>{
  for(const change of [{start:null,stop:null},{timingUnknown:true},{start:a.start+1000},{closed:false},{recurrence:'night work'}]) {
    const other={...b,...change}; const result=run([a,other],[link(a,other)]);
    assert.equal(result.events.length,2);assert.deepEqual(result.groups.map(g=>g.originals[0]),[a,other]);
    assert.equal(result.decisions[0].status,'retained-conflict');
  }
});
test('missing evidence, missing identities and ambiguous duplicate identities cannot authorize merges',()=>{
  for(const links of [[{...link(),evidence:''}],[link(a,{...b,id:'absent'})],[link(a,a)]])
    assert.equal(run([a,b],links).events.length,2);
  assert.equal(run([a,b,{...b}], [link()]).events.length,3);
});
test('transitive conflicting records and unrelated county barricades are retained',()=>{
  const c={...b,source:'Other',id:'other-3',timingUnknown:true};
  const county={...a,source:'County',id:'county-4',scope:'local'};
  const result=run([a,b,c,county],[link(),link(b,c)]);
  assert.equal(result.events.length,3);
  assert.equal(result.groups.flatMap(g=>g.originals).length,4);
  assert.deepEqual(result.decisions.map(d=>d.status),['equivalent','retained-conflict']);
  assert.ok(result.events.includes(county));assert.ok(result.events.includes(c));
});
test('policy rejects unbounded inputs and missing source identities',()=>{
  assert.throws(()=>run(Array(5001).fill(a)));
  assert.throws(()=>run([{id:'1'}]));
  assert.throws(()=>reconcileRoadEvents([a],{now:NaN}));
});
