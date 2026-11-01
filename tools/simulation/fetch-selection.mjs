import { writeFile } from 'node:fs/promises';
import { selectAugust2014 } from './selection.mjs';
const sourceUrl = 'https://api.waterdata.usgs.gov/ogcapi/v1/collections/daily/items?f=json&monitoring_location_id=USGS-09486500&parameter_code=00060&statistic_id=00003&time=2014-08-01%2F2014-08-31&limit=100';
const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(45000) });
if (!response.ok) throw new Error(`USGS HTTP ${response.status}; no automatic retries`);
const raw = await response.json();
const selection = selectAugust2014(raw);
const record = { schemaVersion: 1, sourceUrl, retrievedAt: new Date().toISOString(),
  evidenceStatus: 'Retrospective source retrieval after event scoring',
  contemporaneousSelectionRecordRetained: false,
  caveat: 'An earlier tool query reported August 19 as the highest Cortaro daily mean, but its full response and a committed pre-evaluation selection record were not retained. This later retrieval reproduces the rule; it does not establish when the original selection occurred.',
  selection, raw };
await writeFile('public/simulation/data/cortaro-selection-2014-08.json', JSON.stringify(record, null, 2) + '\n');
console.log(JSON.stringify({ retrievedAt: record.retrievedAt, evidenceStatus: record.evidenceStatus, selection }, null, 2));
