// Builds public/data/road-cells.json: for every route, each 100 m SFINCS model cell its road passes
// through, with the lowest lidar road height in that cell, the cell's ground (bed) height and where
// that lowest point is. The alert service (public/road-forecast.js, bundled into the Apps Script)
// compares the live SFINCS water with it. See docs/SFINCS-ROUTE-PREDICTION.md.
// Usage: node tools/build_road_cells.mjs   (re-run when road heights or the model grid change)
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { decodeRoadHeights } from '../public/preview/geo3d/src/road-package.js';
import { toUtm } from '../public/preview/geo3d/src/utm.js';
import { routeStations } from '../public/simulation/route-prediction.js';

const root = new URL('../', import.meta.url);
const GRID = { x0: 467700, y0: 3572300 }; // the same origin as simulation/sim-2d.js
const display = JSON.parse(gunzipSync(readFileSync(new URL('public/simulation/data/frozen-terrain-display.json.gz', root))));
const index = new Map(), bed = display.vertices.map((v) => v[2]);
display.vertices.forEach((v, i) => index.set(Math.floor(v[0] / 100) * 1000 + Math.floor(v[1] / 100), i));
const cellOf = (lon, lat) => { const u = toUtm(lon, lat); return index.get(Math.floor((u.e - GRID.x0) / 100) * 1000 + Math.floor((u.n - GRID.y0) / 100)) ?? -1; };

const b = gunzipSync(readFileSync(new URL('public/simulation/data/road-heights/routes.bin.gz', root)));
const stations = routeStations(decodeRoadHeights(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)).lines);
const r5 = (x) => Math.round(x * 1e5) / 1e5, r3 = (x) => Math.round(x * 1e3) / 1e3;
const routes = {};
for (const [id, list] of stations) {
  const low = new Map();
  for (const s of list) {
    const cell = cellOf(s.lon, s.lat);
    if (cell < 0) continue;
    const prior = low.get(cell);
    if (!prior || s.roadM < prior.roadM) low.set(cell, s);
  }
  routes[id] = [...low].sort((a, c) => a[0] - c[0]).map(([cell, s]) => [cell, r3(s.roadM), r3(bed[cell]), r5(s.lon), r5(s.lat), s.deck ? 1 : 0]);
}
const out = {
  schema: 'floodplain-road-cells-v1',
  meaning: 'Per route: [model cell, lowest lidar road or deck height in the cell (m NAVD88), cell ground height (m), lon, lat, deck 1/0]. Cell indices follow the live SFINCS water.json cellOrder.',
  cellCount: display.vertices.length,
  gridSha256: display.sourceSha256 ?? null,
  routes,
};
writeFileSync(new URL('public/data/road-cells.json', root), JSON.stringify(out));
console.log('public/data/road-cells.json:', Object.entries(routes).map(([k, v]) => `${k} ${v.length}`).join(', '));
