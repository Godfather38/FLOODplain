import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {loadBridgeEvidence,bridgeRecordFor,bridgeHistory} from '../public/simulation/bridge-evidence.js';
import {bridgeHeightComparison,rateFailurePoint,riskScore,recommend} from '../public/logic.js';
import {applyHand,handCheck,matchFailurePoints} from '../public/hand-model.js';
import * as cfg from '../public/config.js';
const read=p=>JSON.parse(readFileSync(new URL('../public/'+p,import.meta.url)));
const archived=read('simulation/data/bridge-evidence-registry.json');
const source=read('simulation/data/bridge-evidence-source.json');
const bridge=cfg.FAILURE_POINTS.find(p=>p.id==='sc-trico-marana');
const now=Date.parse('2026-11-03T12:00:00Z');
async function load(registry){
 const bytes=JSON.stringify(registry),requests=[];
 const result=await loadBridgeEvidence(async url=>{
  const name=url.pathname.split('/').pop();requests.push(name);
  if(name==='bridge-evidence-registry.json')return new Response(bytes);
  if(name==='bridge-evidence-source.json')return Response.json({...source,sha256:createHash('sha256').update(bytes).digest('hex')});
  // A matching manifest must not rescue saved evidence, even if it would be available.
  if(name==='current-sfincs-manifest.json')return Response.json({runId:registry.bridges.find(b=>b.modelWater)?.modelWater.runId});
  throw Error('Unexpected request '+name);
 });
 assert.equal(result.status,'ok');
 assert.deepEqual(requests.sort(),['bridge-evidence-registry.json','bridge-evidence-source.json']);
 return result.registry;
}
for(const period of ['expired','future'])test(`production excludes ${period} saved water and retains all static evidence`,async()=>{
 const input=structuredClone(archived);
 if(period==='future')for(const b of input.bridges)if(b.modelWater){
  Object.assign(b.modelWater,{issuedAt:'2026-11-03T11:00:00Z',validFrom:'2026-11-03T12:00:00Z',validTo:'2026-11-04T12:00:00Z',frames:[{time:'2026-11-03T13:00:00Z',elevationM:999}]});
 }
 const record=input.bridges.find(b=>b.id==='bridge-2');
 record.documentedHistory=[{date:'2020-01-01',summary:'Test site history',source:'https://example.org/history'}];
 assert.ok(record.roadwayEstimate&&record.channelReference&&record.modelWater);
 const result=await load(input),expected=structuredClone(input);
 for(const b of expected.bridges)delete b.modelWater;
 assert.deepEqual(result,expected);
 assert.equal(bridgeHistory(bridgeRecordFor(bridge,result)).length,1);
 assert.equal(bridgeHeightComparison(bridgeRecordFor(bridge,result),now,cfg.BRIDGE_POLICY).status,'unavailable');
 assert.ok(record.modelWater,'archive input is preserved');
});
test('production missing water remains unknown while current gauge, HAND and official evidence still work',async()=>{
 const registry=await load(archived),record=bridgeRecordFor(bridge,registry);
 const d={now,bridgeEvidence:{[bridge.id]:record},flows:{'09486500':{fresh:true,cfs:4350,risingFast:false,time:now}},closures:[],nws:[],alert:{rain:[],stream:[]}};
 const rated=rateFailurePoint(bridge,d,cfg),river=rated.checks.find(c=>c.src==='river');
 assert.equal(river.heightComparison.status,'unavailable');assert.equal(river.level,'unknown');
 assert.equal(river.modeledRoadConcern,false);assert.equal(river.bridgeClearance,'unknown');
 assert.equal(river.dischargeLevel,'caution');assert.equal(riskScore(rated),1);
 assert.equal(recommend([{level:rated.level,minutes:10,points:[rated]}]).clear,false);
 const row=matchFailurePoints(cfg.FAILURE_POINTS,read('inundation/data/coverage.json').points)[bridge.id];
 const peak={flowM3s:5000*0.028316846592,time:'2026-11-03T13:00:00Z'};
 const hand=handCheck(row,{status:'ok',issueAgeHours:1,peak,points:[peak]},now);
 const results={[bridge.id]:rated};applyHand(results,{checks:{[bridge.id]:hand}});
 assert.equal(hand.level,'watch');assert.match(hand.why,/5,000 cfs/);
 assert.ok(results[bridge.id].checks.some(c=>c.src==='hand'&&c.why===hand.why));
 assert.equal(riskScore(results[bridge.id]),1,'HAND does not replace bridge elevation assessment');
 assert.equal(bridgeHeightComparison(record,now,cfg.BRIDGE_POLICY).status,'unavailable','HAND is not a NAVD88 replacement');
 d.closures=[{lat:bridge.lat,lon:bridge.lon,status:'Closed',location:'Trico bridge'}];
 assert.equal(riskScore(rateFailurePoint(bridge,d,cfg)),5);
});
