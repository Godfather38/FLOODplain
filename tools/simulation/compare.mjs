import { readFile } from 'node:fs/promises';
import { compareDischarge } from '../../public/simulation/observations.js';
const [modelPath,observationPath]=process.argv.slice(2);
if(!modelPath||!observationPath)throw new Error('Usage: node tools/simulation/compare.mjs modeled-at-gauge.json observations.json');
const model=JSON.parse(await readFile(modelPath,'utf8')),observation=JSON.parse(await readFile(observationPath,'utf8'));
console.log(JSON.stringify(compareDischarge(model,observation.normalized??observation),null,2));
