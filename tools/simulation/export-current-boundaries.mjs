import {readFile,writeFile} from 'node:fs/promises';import {resolve,join} from 'node:path';import {createHash} from 'node:crypto';
import {normalizeNwm,nwmUrl} from '../../public/simulation/nwm-context.js';
const directory=resolve(process.argv[2]),registry=JSON.parse((await readFile(join(directory,'boundary-registry.json'),'utf8')).replace(/^\uFEFF/,'')),manifest=JSON.parse(await readFile(join(directory,'manifest.json'),'utf8')),now=Date.parse(manifest.asOf),series=[],sources=[];
for(const reachId of [...new Set(registry.sources.map(s=>s.reachId))]){
 const url=nwmUrl(reachId),response=await fetch(url,{signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error(`Inlet ${reachId} HTTP ${response.status}`);const body=await response.text(),sha256=createHash('sha256').update(body).digest('hex'),rawFile=`raw/boundary-${reachId}-${sha256}.json`,retrievedAt=new Date().toISOString();await writeFile(join(directory,rawFile),body);
 const normalized=normalizeNwm(JSON.parse(body),{reachId,now,retrievedAt:manifest.asOf});normalized.retrievedAt=retrievedAt;if(normalized.status!=='ok'||Date.parse(normalized.issuedAt)>now)throw Error(`Boundary unavailable at package cutoff: ${normalized.status}`);
 series.push(normalized);sources.push({reachId,url,rawFile,sha256,retrievedAt});
}
const completedAt=new Date().toISOString();let start=Math.max(Date.parse(manifest.candidateWindow.start),Math.ceil(Date.parse(completedAt)/3600000)*3600000),end=Date.parse(manifest.candidateWindow.end);for(const s of series){start=Math.max(start,Date.parse(s.points[0].time));end=Math.min(end,Date.parse(s.points.at(-1).time))}if(start>=end)throw Error('No boundary overlap');
for(const s of series)s.points=s.points.filter(p=>Date.parse(p.time)>=start&&Date.parse(p.time)<=end);
const timeGrid=series[0].points.map(p=>p.time);if(series.some(s=>JSON.stringify(s.points.map(p=>p.time))!==JSON.stringify(timeGrid)))throw Error('Inlet timestamp grids differ');
await writeFile(join(directory,'boundary-snapshot.json'),JSON.stringify({schemaVersion:1,asOf:completedAt,issueCutoffAt:manifest.issueCutoffAt??manifest.asOf,start:new Date(start).toISOString(),end:new Date(end).toISOString(),series,sources,registrySource:'solver branch b15eb25',note:'Exact registry reach forecasts only; internal Cortaro/Trico candidates are not boundary substitutions.'},null,2)+'\n');
console.log('Actual inlet snapshot',series.map(s=>[s.reachId,s.issuedAt,s.points.length,s.peak]),new Date(start).toISOString(),new Date(end).toISOString());
