import { readFile, writeFile } from 'node:fs/promises';
import { importMrmsCsv } from '../../public/simulation/radar.js';
const [input, source, output] = process.argv.slice(2);
if (!input || !source || !output) throw new Error('Usage: node tools/simulation/import-radar.mjs local.csv https://source.example/original-files rainfall.json');
const terrain = JSON.parse(await readFile('public/simulation/data/terrain.json', 'utf8'));
const rain = importMrmsCsv(await readFile(input, 'utf8'), terrain, source);
await writeFile(output, JSON.stringify(rain, null, 2) + '\n');
console.log(`Wrote ${rain.frames.length} radar-estimate intervals; no prediction published.`);
