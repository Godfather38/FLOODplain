// Scheduled check (GitHub backup): same rules as the app, boiled down to one short message.
// Usage: node tools/notify.mjs ALERT_SNAPSHOT.json   (prints the message JSON)
import { readFileSync } from 'node:fs';
import { evaluate, sourceUrls } from '../public/engine.js';

const UA = { 'user-agent': 'WashWatch/1.0 (github.com/godfather38/floodplain)' };
const get = (url, headers = {}) => fetch(url, { headers: { ...UA, ...headers }, signal: AbortSignal.timeout(30_000) })
  .then((r) => (r.ok ? r.json() : null)).catch(() => null);
const urls = sourceUrls(process.env.USGS_API_KEY);
const sites = Object.keys(urls.usgs);
const [usgs, closures, nws] = await Promise.all([
  Promise.all(sites.map((s) => get(urls.usgs[s]))),
  get(urls.closures),
  get(urls.nws, { accept: 'application/geo+json' }),
]);
const alert = (() => { try { const a = JSON.parse(readFileSync(process.argv[2], 'utf8')); return a.rain ? a : null; } catch { return null; } })();
const routes = JSON.parse(readFileSync(new URL('../public/data/routes.geojson', import.meta.url))).features;
const v = evaluate({ now: Date.now(), usgs: Object.fromEntries(sites.map((s, i) => [s, usgs[i]])), closures, alert, nws, routes });
const { at, text, sms, spoken, off, title } = v;
console.log(JSON.stringify({ at, text, sms, spoken, off, title }));
