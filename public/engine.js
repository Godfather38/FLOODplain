// The whole check in one place, independent of where it runs (browser, Node, Google Apps Script).
// Inputs are already-fetched raw responses; output is the rated routes plus a short message.
import * as cfg from './config.js';
import {
  parseContinuous, summarizeFlow, rateFailurePoint, rateRoutes, recommend, routeScore, againstIt, routeClosures, parseCountyClosures,
  worst, alertTimeIso,
} from './logic.js';
import { roadForecastPoint } from './road-forecast.js';

const WORD = { 1: 'Low', 2: 'Minor', 3: 'Moderate', 4: 'High', 5: 'Severe' };
const RAIN_KEYS = ['m10', 'm30', 'h1', 'h3', 'h6', 'd1', 'd3', 'd7', 'd30'];
const BOX = [-111.50, 32.05, -110.95, 32.56];

// Pima ALERT currain.php / currentstream.php "data" arrays -> the snapshot shape the rules use.
// Same as tools/snapshot_alert.py. ALERT times are Arizona local (UTC-7, no DST) unless they carry a zone.
// An unreadable time becomes null; a future time is kept as sent and the rules refuse to use it.
export function alertSnapshot(rainData, streamData, fetchedAt) {
  const inside = (d) => { const x = Number(d.longitude); const y = Number(d.latitude); return x >= BOX[0] && x <= BOX[2] && y >= BOX[1] && y <= BOX[3]; };
  const ours = (d) => inside(d) && (d.source === 'pima' || d.source === 'pinal');
  const iso = alertTimeIso;
  const num = (v) => { if (v == null || String(v).trim() === '') return null; const n = Number(v); return Number.isFinite(n) && n > -90 ? n : null; };
  return {
    fetched_at: new Date(fetchedAt).toISOString(),
    rain: (rainData ?? []).filter(ours).map((d) => ({
      site: d.site, name: String(d.name).trim(), lat: Number(d.latitude), lon: Number(d.longitude), last_rpt: iso(d.last_rpt),
      maintenance: !!d.UnderMaintenance, in: Object.fromEntries(RAIN_KEYS.map((k, i) => [k, num((d.rain ?? [])[i])])),
    })),
    stream: (streamData ?? []).filter(ours).map((d) => ({
      site: d.site, name: String(d.name).trim(), lat: Number(d.latitude), lon: Number(d.longitude), last_rpt: iso(d.last_rpt),
      maintenance: !!d.UnderMaintenance, stage_ft: num(d.stage), flow_cfs: num(d.flow),
    })),
  };
}

// raw = { now, usgs: {site: json|null}, closures: arcgisJson|null, alert: snapshot|null, nws: geojson|null, roadEvents: [normalized]|null, routes: [features],
//         sfincs: roadForecast() result | null }
// The SFINCS road forecast adds one row per route while the live run covers now (road-forecast.js).
// It can raise a route's level, never lower it. docs/SFINCS-ROUTE-PREDICTION.md: do not remove.
export function evaluate(raw, area = 'avra') {
  const now = raw.now;
  const flows = Object.fromEntries(Object.keys(cfg.USGS_SITES).map((s) => [s, summarizeFlow(raw.usgs?.[s] ? parseContinuous(raw.usgs[s]) : {}, now, cfg.STALE_MS)]));
  const county = parseCountyClosures(raw.closures);
  const closures = county.points;
  const nws = raw.nws ? (raw.nws.features ?? []).map((f) => ({ event: f.properties.event })) : null;
  const d = { now, flows, closures, alert: raw.alert, nws };
  const fpResults = Object.fromEntries(cfg.FAILURE_POINTS.map((fp) => [fp.id, rateFailurePoint(fp, d, cfg)]));
  const routes = raw.routes.filter((f) => (f.properties.area ?? 'avra') === area);
  const rated = rateRoutes(routes, fpResults, cfg.FAILURE_POINTS, { closures, radiusM: cfg.CLOSURE_RADIUS_M, roadEvents: raw.roadEvents ?? null, now })
    .map((r) => withRoadForecast(r, raw.sfincs)).map((r) => ({ ...r, score: routeScore(r) }));
  const { best, order } = recommend(rated);
  const missing = [!county.complete && 'county', !raw.alert && 'rain', !Object.values(flows).some((f) => f.fresh) && 'river', raw.sfincs && (raw.sfincs.status !== 'ok' || rated.some((r) => !(raw.sfincs.routes?.[r.id]?.cells > 0))) && 'flood model'].filter(Boolean);
  const closed = [...new Set(rated.flatMap((r) => routeClosures(r).map((p) => p.short)))].sort();
  return { rated, best, order, missing, closed, closuresKnown: county.complete, sfincs: raw.sfincs ? raw.sfincs.status : 'not_loaded', ...message(best, order, rated, missing, now, area, !county.complete && closures !== null) };
}

export function withRoadForecast(r, sfincs) {
  const f = sfincs && sfincs.status === 'ok' ? sfincs.routes[r.id] : null;
  if (!f || !f.cells) return r;
  const point = roadForecastPoint(r.id, f);
  return { ...r, points: [...r.points, point], level: worst([r.level, point.level]) };
}

export function message(best, order, rated, missing, now, area = 'avra', countyIncomplete = false) {
  const areaName = area === 'avra' ? '' : ` (${(cfg.AREAS.find((a) => a.id === area) ?? {}).name})`;
  const name = (r) => cfg.ROUTE_INFO[r.id].name;
  const issue = (r) => { const a = againstIt(r)[0]; return a ? `${a.short}: ${a.why}` : null; };
  const unavailable = countyIncomplete ? missing.filter(id => id !== 'county') : missing;
  const text = [
    routeClosures(best).length ? `FLOODplain${areaName}: every route has a reported road closure; check timing in the app.` : `FLOODplain${areaName}: take ${name(best)} (${best.score}/5 ${WORD[best.score]}, ${Math.round(best.minutes)} min).`,
    issue(best) ? `Watch for ${issue(best)}.` : null,
    `Others: ${order.filter((r) => r !== best).map((r) => `${name(r)} ${r.score}`).join(', ')}.`,
    ...order.filter((r) => r !== best && r.score >= 4).map((r) => `${name(r)}: ${issue(r)}.`),
    countyIncomplete ? '(County data is incomplete.)' : null,
    unavailable.length ? `(No live ${unavailable.join('/')} data.)` : null,
    'https://godfather38.github.io/FLOODplain/',
  ].filter(Boolean).join(' ');
  return {
    at: new Date(now).toISOString(),
    text,
    sms: text.replace(/^FLOODplain(?: \(([^)]+)\))?: /, (m, ar) => (ar ? `${ar}: ` : '')).replace(/ https:\S+/, ''),
    spoken: text.replace(/ https:\S+/, '').replace(/(\d)\/5/g, '$1 out of 5').replace(/–/g, ' and '),
    off: rated.some((r) => r.score >= 2),
    title: `FLOODplain${areaName}: ${name(best)} ${best.score}/5`,
  };
}

// Where to fetch each input from (shared by Node and Apps Script).
export function sourceUrls(usgsKey) {
  const q = new URLSearchParams({
    where: '1=1', outFields: 'Location,Status,Direction,timeUpdated', returnGeometry: 'true', outSR: '4326', f: 'json',
    geometry: cfg.CLOSURE_BOUNDS, geometryType: 'esriGeometryEnvelope', inSR: '4326', spatialRel: 'esriSpatialRelIntersects',
  });
  return {
    usgs: Object.fromEntries(Object.keys(cfg.USGS_SITES).map((s) => [s, `${cfg.SOURCES.usgs}/collections/continuous/items?f=json&monitoring_location_id=USGS-${s}`
      + '&parameter_code=00060&time=PT6H&limit=500&skipGeometry=true&properties=time,value,parameter_code' + (usgsKey ? `&api_key=${usgsKey}` : '')])),
    closures: `${cfg.SOURCES.closures}/query?${q}`,
    rain: 'https://alertmap.rfcd.pima.gov/gmap/gmap_files/php/currain.php',
    stream: 'https://alertmap.rfcd.pima.gov/gmap/gmap_files/php/currentstream.php',
    nws: cfg.SOURCES.nws,
  };
}

