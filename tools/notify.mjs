// Scheduled check: same rules as the app, boiled down to one short message.
// Usage: node tools/notify.mjs ALERT_SNAPSHOT.json   (prints the message; the workflow delivers it)
import { readFileSync } from 'node:fs';
import * as cfg from '../public/config.js';
import {
  parseContinuous, summarizeFlow, rateFailurePoint, rateRoutes, recommend, routeScore, againstIt,
} from '../public/logic.js';

const UA = { 'user-agent': 'WashWatch/1.0 (github.com/godfather38/floodplain)' };
const WORD = { 1: 'Low', 2: 'Minor', 3: 'Moderate', 4: 'High', 5: 'Severe' };
const get = async (url, headers = {}) => {
  const r = await fetch(url, { headers: { ...UA, ...headers }, signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw new Error(`${new URL(url).host} ${r.status}`);
  return r.json();
};
const safe = (p) => p.catch(() => null);

const now = Date.now();
const alert = (() => { try { return JSON.parse(readFileSync(process.argv[2], 'utf8')); } catch { return null; } })();
const sites = Object.keys(cfg.USGS_SITES);
const [series, closuresJson, nwsJson] = await Promise.all([
  Promise.all(sites.map((s) => safe(get(`${cfg.SOURCES.usgs}/collections/continuous/items?f=json&monitoring_location_id=USGS-${s}`
    + '&parameter_code=00060&time=PT6H&limit=500&skipGeometry=true&properties=time,value,parameter_code'
    + (process.env.USGS_API_KEY ? `&api_key=${process.env.USGS_API_KEY}` : ''))))),
  safe(get(`${cfg.SOURCES.closures}/query?${new URLSearchParams({
    where: '1=1', outFields: 'Location,Status,timeUpdated', returnGeometry: 'true', outSR: '4326', f: 'json',
    geometry: '-111.45,32.25,-111.10,32.50', geometryType: 'esriGeometryEnvelope', inSR: '4326', spatialRel: 'esriSpatialRelIntersects',
  })}`)),
  safe(get(cfg.SOURCES.nws, { accept: 'application/geo+json' })),
]);
const flows = Object.fromEntries(sites.map((s, i) => [s, summarizeFlow(series[i] ? parseContinuous(series[i]) : {}, now, cfg.STALE_MS)]));
const closures = closuresJson?.features?.map((f) => ({ location: f.attributes.Location?.trim(), status: f.attributes.Status ?? '', updated: f.attributes.timeUpdated, lat: f.geometry.y, lon: f.geometry.x })) ?? null;
const nws = nwsJson ? (nwsJson.features ?? []).map((f) => ({ event: f.properties.event })) : null;

const d = { now, flows, closures, alert, nws };
const fpResults = Object.fromEntries(cfg.FAILURE_POINTS.map((fp) => [fp.id, rateFailurePoint(fp, d, cfg)]));
const routes = JSON.parse(readFileSync(new URL('../public/data/routes.geojson', import.meta.url))).features;
const rated = rateRoutes(routes, fpResults, cfg.FAILURE_POINTS).map((r) => ({ ...r, score: routeScore(r) }));
const { best, order } = recommend(rated);

const name = (r) => cfg.ROUTE_INFO[r.id].name;
const sc = (r) => (r.score == null ? '?' : r.score);
const issue = (r) => { const a = againstIt(r)[0]; return a ? `${a.short}: ${a.why}` : null; };
const missing = [!closures && 'county', !alert && 'rain', !Object.values(flows).some((f) => f.fresh) && 'river'].filter(Boolean);

const lines = [
  `Wash Watch: take ${name(best)} (${sc(best)}/5 ${WORD[best.score] ?? 'no data'}, ${Math.round(best.minutes)} min).`,
  issue(best) ? `Watch for ${issue(best)}.` : null,
  `Others: ${order.filter((r) => r !== best).map((r) => `${name(r)} ${sc(r)}`).join(', ')}.`,
  ...order.filter((r) => r !== best && (r.score ?? 0) >= 4).map((r) => `${name(r)}: ${issue(r)}.`),
  missing.length ? `No ${missing.join('/')} data.` : null,
  'https://godfather38.github.io/FLOODplain/',
].filter(Boolean);
const text = lines.join(' ');
// Spoken version for a phone call: no link, no slashes.
const spoken = text.replace(/ https:\S+/, '').replace(/(\d)\/5/g, '$1 out of 5').replace(/–/g, ' and ');
// Text message version: no link, fits in one 160-character SMS where possible.
const sms = text.replace(/^Wash Watch: /, '').replace(/ https:\S+/, '');
// "Something's off" = any route at 2 or higher, or missing data.
const off = rated.some((r) => r.score == null || r.score >= 2);
console.log(JSON.stringify({ at: new Date(now).toISOString(), text, sms, spoken, off, title: `Wash Watch: ${name(best)} ${sc(best)}/5` }));
