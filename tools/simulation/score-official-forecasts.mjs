import {readFile,writeFile} from 'node:fs/promises';
import {scoreOfficialForecasts} from '../../public/simulation/official-forecast-comparison.js';
const data=JSON.parse(await readFile('public/simulation/data/official-forecast-events.json','utf8'));
const result=scoreOfficialForecasts(data);
await writeFile('public/simulation/data/official-forecast-scores.json',JSON.stringify(result)+'\n');
for(const event of data.events)for(const station of Object.keys(data.protocol.stations)){
 const rows=result.results.filter(r=>r.event===event.id&&r.station===station);
 console.log(event.id,station,'issues',new Set(rows.map(r=>r.issued).filter(Boolean)).size,'complete windows',rows.filter(r=>r.status==='complete').length,'pairs',rows.reduce((s,r)=>s+r.pairs.length,0));
}
