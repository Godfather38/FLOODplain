// Deliberately reads only a selected pre-2014 event. No benchmark observations are loaded here.
import { readFile,writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { routeGauge } from '../../public/simulation/routing.js';
import { compareDischarge } from '../../public/simulation/observations.js';
const root='public/simulation/data/';
const year=process.argv[2]??'2013';
if(!['2006','2013'].includes(year))throw new Error('Only predeclared calibration years 2006 or 2013 allowed');
const paths=[`cortaro-calibration-${year}-07.json`,`trico-calibration-${year}-07.json`];
const texts=await Promise.all(paths.map(p=>readFile(root+p,'utf8')));
const [up,down]=texts.map(s=>JSON.parse(s).normalized);
if(up.points.some(p=>!p.time.startsWith(year+'-'))||down.points.some(p=>!p.time.startsWith(year+'-')))throw new Error('Calibration file year mismatch');
const warmupEnd=Date.parse(up.points[0].time)+24*3600000;
const observed={...down,points:down.points.filter(p=>Date.parse(p.time)>=warmupEnd)};
let best;
// Prespecified bounded grid: lag 0–12 h, reservoir K 0–12 h, both 15-min spacing.
// Transmission fixed to 1: isolate routing and avoid inferring extrapolated channel loss from a small storm.
for(let lagMinutes=0;lagMinutes<=720;lagMinutes+=15)for(let kMinutes=0;kMinutes<=720;kMinutes+=15){
 const parameters={lagMinutes,kMinutes,transmission:1};
 const model=routeGauge(up,parameters),score=compareDischarge(model,observed);
 if(!best||score.rmseM3s<best.score.rmseM3s)best={parameters,score};
}
const frozen={schemaVersion:1,frozenAt:new Date().toISOString(),model:'lag + linear reservoir',selection:year==='2006'?'PRIMARY: July 2006 large flood brackets 2014 upstream discharge scale. Chosen before scoring 2014; retain estimated-value caveats and channel changes.':'SECONDARY: July 20–21 2013 smaller flood; independent sensitivity test. Not selected by 2014 performance.',
 objective:'Minimum RMSE on approved unqualified exact UTC pairs after 24h warm-up',grid:{lagMinutes:[0,720,15],kMinutes:[0,720,15],transmission:1},
 inputs:paths.map((path,i)=>({path,sha256:createHash('sha256').update(texts[i].replace(/\r\n/g,'\n')).digest('hex')})),...best,
 warning:'Retrospective held-out event, not blinded: 2014 target peak/time were already known in research. Parameters fitted only to separate pre-2014 observations. Small-storm extrapolation / channel changes are limitations.'};
await writeFile(root+`routing-frozen-${year}.json`,JSON.stringify(frozen,null,2)+'\n');console.log(JSON.stringify(frozen,null,2));
