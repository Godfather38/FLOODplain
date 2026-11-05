// Extract only the pure owner-health validator; never bundle Apps Script side effects.
import { readFileSync, writeFileSync } from 'node:fs';
const root = new URL('../', import.meta.url);
const source = readFileSync(new URL('apps-script/Code.gs', root), 'utf8');
const start = source.indexOf('function expectedInputHealth_(');
const end = source.indexOf('function noteOwnerHealth_(', start);
if (start < 0 || end < 0) throw Error('Owner-health extraction boundary missing');
writeFileSync(new URL('worker/generated/input-health.js', root),
  '// GENERATED from apps-script/Code.gs by tools/build_worker.mjs. Do not edit.\n' +
  "import { FAILURE_POINTS, USGS_SITES, STALE_MS, RAIN, RAIN_GAUGES } from '../../public/config.js';\n" +
  'export ' + source.slice(start, end));
const routes = JSON.parse(readFileSync(new URL('public/data/routes.geojson', root))).features
  .map(({properties}) => ({properties}));
writeFileSync(new URL('worker/generated/routes.json', root), JSON.stringify(routes));
