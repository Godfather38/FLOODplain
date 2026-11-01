import {readFile,writeFile} from 'node:fs/promises';import {createHash} from 'node:crypto';
import {createRouteAssessment} from '../../public/simulation/route-assessment.js';
const records={},startedAt=new Date().toISOString();
const fetchImpl=async(url,opts)=>{if(String(url).startsWith('file:'))return new Response(await readFile(new URL(url)));const r=await fetch(url,opts),body=await r.text();records[url]={status:r.status,retrievedAt:new Date().toISOString(),sha256:createHash('sha256').update(body).digest('hex'),body};return new Response(body,{status:r.status})};
const result=await createRouteAssessment({fetchImpl,timeoutMs:20000}).refresh();
for(const h of result.connected.hand)delete h.masks;
await writeFile('public/simulation/data/operating-provider-record.json',JSON.stringify({startedAt,finishedAt:new Date().toISOString(),records})+'\n');
await writeFile('public/simulation/data/operating-route-record.json',JSON.stringify(result)+'\n');
console.log(JSON.stringify({status:result.decision.status,recommendation:result.decision.recommendation,missing:result.observations.missing,errors:result.observations.errors,routes:result.decision.routes.map(r=>({id:r.id,level:r.level,excluded:r.excluded,models:r.sources.length})),sources:result.observations.sources.map(s=>[s.status,s.url]),hand:result.connected.hand.map(h=>[h.junctionId,h.status])},null,2));
