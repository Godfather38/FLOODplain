import { readFile } from 'node:fs/promises';
import { selectAugust2014 } from './selection.mjs';
const record = JSON.parse(await readFile('public/simulation/data/cortaro-selection-2014-08.json', 'utf8'));
console.log(JSON.stringify({ retrievedAt: record.retrievedAt, evidenceStatus: record.evidenceStatus,
  contemporaneousSelectionRecordRetained: record.contemporaneousSelectionRecordRetained,
  selection: selectAugust2014(record.raw) }, null, 2));
