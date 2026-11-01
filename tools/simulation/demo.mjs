import { readFile } from 'node:fs/promises';
import { simulate, syntheticRain } from '../../public/simulation/model.js';
const terrain=JSON.parse(await readFile('public/simulation/data/terrain.json','utf8'));
const result=simulate(terrain,syntheticRain(terrain));
console.log(JSON.stringify({label:'Synthetic rainfall on recorded USGS terrain; uncalibrated local-window runoff',parameters:result.parameters,totals:result.totals,peakCrossingM3s:Math.max(...result.series.map(s=>s.crossingM3s)),contributingCells:result.network.accumulation[terrain.crossingCell]},null,2));
