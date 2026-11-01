import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createIntegratedEngine,routeHandPayload} from '../../public/simulation/integrated-engine.js';
const records={};
const fetchImpl=async(url,options)=>{
 if(String(url).startsWith('file:'))return new Response(await readFile(new URL(url)));
 const r=await fetch(url,options),body=await r.text();records[url]={status:r.status,retrievedAt:new Date().toISOString(),sha256:createHash('sha256').update(body).digest('hex'),body};return new Response(body,{status:r.status});
};
const startedAt=new Date().toISOString();
const bundle=await createIntegratedEngine({enabled:true,fetchImpl,timeoutMs:30000}).evaluate({siteId:'SCTA3'});
await writeFile('public/simulation/data/connected-provider-record.json',JSON.stringify({startedAt,finishedAt:new Date().toISOString(),records})+'\n');
await writeFile('public/simulation/data/connected-stack-record.json',JSON.stringify({...bundle,hand:routeHandPayload(bundle).hand})+'\n');
console.log(JSON.stringify({official:bundle.official.status,nwm:bundle.nwm.reaches.map(r=>[r.reachId,r.relationship,r.status,r.peak]),hefs:bundle.ensemble.status,qpf:bundle.rainfall.status,hand:bundle.hand.map(h=>[h.junctionId,h.status,h.extent?.wetCells]),handStatus:bundle.handStatus},null,2));
