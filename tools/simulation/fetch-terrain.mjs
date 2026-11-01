// Bounded public-data fetch: 81 USGS points; no keys or paid services.
import { writeFile, mkdir } from 'node:fs/promises';
const center = { lat: 32.43882, lon: -111.30426 };
const rows = 9, cols = 9, cellSizeM = 250;
const cells = [];
for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
  const lat = center.lat + (4 - row) * cellSizeM / 111320;
  const lon = center.lon + (col - 4) * cellSizeM / (111320 * Math.cos(center.lat * Math.PI / 180));
  cells.push({ lat, lon });
}
let next = 0;
await Promise.all(Array.from({ length: 2 }, async () => {
  while (next < cells.length) {
    const i = next++, cell = cells[i];
    const url = `https://epqs.nationalmap.gov/v1/json?x=${cell.lon}&y=${cell.lat}&units=Meters&wkid=4326&includeDate=true`;
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`USGS ${response.status}; stopped, no automatic retries`);
    const raw = await response.json();
    const z = Number(raw.value);
    if (!Number.isFinite(z) || z < -100 || z > 4000) throw new Error(`Missing elevation at ${i}`);
    Object.assign(cell, { elevationM: z, sourceUrl: url, raw });
    console.log(`USGS ${i + 1}/${cells.length}`);
  }
}));
const terrain = { schemaVersion: 1, label: 'Los Robles / Trico local terrain window', kind: 'usgs-epqs',
  retrievedAt: new Date().toISOString(), source: 'USGS 3DEP Elevation Point Query Service',
  license: 'US government public domain; credit USGS', horizontalCRS: 'EPSG:4326',
  verticalUnits: 'm', rows, cols, cellSizeM, center, crossingCell: 40, cells };
await mkdir('public/simulation/data', { recursive: true });
await writeFile('public/simulation/data/terrain.json', JSON.stringify(terrain, null, 2) + '\n');
