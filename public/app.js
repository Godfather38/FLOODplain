import { routeModelText } from './road-forecast.js?v=dev';
import {mountDiagnostics} from './diagnostics.js?v=dev';
import { RISK_COLORS, UNKNOWN_COLOR, installRiskColors } from './semantic-colors.js?v=dev';
import './show-me-how.js?v=dev';
import {mountRouteTracking} from './simulation/route-tracking.js?v=dev';
installRiskColors();
import { imperialSourceText } from './display-units.js?v=dev';
import {loadBridgeEvidence,bridgeRecordFor,bridgeHistory} from './simulation/bridge-evidence.js?v=dev';
import {mountFloodLayers} from './simulation/map-layers.js?v=dev';
import {mountLiveMap} from './live-map.js?v=dev';
import {createStreetMap} from './street-map.js?v=dev';
import {routeRowsHtml,crossingCardHtml} from './map-routes.js?v=dev';
import {mountMapApp} from './map-app.js?v=dev';
import { savedRoutes, toggleSavedRoute, checkAge, countyTime, plainAge, plainWords } from './preferences.js?v=dev';
import * as cfg from './config.js?v=dev';
import { getJson } from './network.js?v=dev';
import { loadGaugeReadings } from './gauge-feed.js?v=dev';
import { resolveScreen, routeAreaForHash } from './routing.js?v=dev';
import { conditionsNotEstablished, groupRoutePoints } from './route-status.js?v=dev';
import { UNDERPASSES } from './underpasses.js?v=dev';
import { shareText, shareCheck } from './share.js?v=dev';
import {
  parseContinuous, summarizeFlow, rateFailurePoint, rateRoutes, recommend, googleMapsUrl, parseCountyClosures,
  riskScore, routeScore, goodSigns, againstIt, routeClosures, worst, roadEventActive, roadEventTiming, roadEventLabel, driveSummary, bridgeHeightComparison, crossingLead,
} from './logic.js?v=dev';

// Error and freeze logging first, so the rest of startup is covered (diagnostics.js).
mountDiagnostics();
const { SOURCES, USGS_SITES, FAILURE_POINTS, NAV, LINKS, STALE_MS, ROUTE_INFO, RIVER_EARLY, PLACES, AREAS } = cfg;
const WORD = { 1: 'Low', 2: 'Minor', 3: 'Moderate', 4: 'High', 5: 'Severe' };
const COLOR = RISK_COLORS;
const LEVEL_SENTENCE = { ok: 'Nothing in the data points to water here.', watch: 'Some water around. Usually passable; look as you go.', caution: 'Water likely at or near the road.', danger: 'Closed, or a flood is running.', unknown: 'Missing data. That is not the same as fine.' };
const SRC = {
  none: ['…', 'Live readings'], county: ['🚧', 'County barricade'], nws: ['📢', 'Weather service'], river: ['🌊', 'River'], 'river-early': ['⤴️', 'Creeks upstream'],
  hand: ['🗺️', 'Flood model'], sfincs: ['🌊', 'Flood model along the road (SFINCS)'], 'road-event': ['🚧', 'TransView'], wash: ['〰️', 'Wash flow upstream'], 'road-status': ['🛑', 'This crossing itself'], 'rain-local': ['🌧️', 'Rain here'], 'rain-basin': ['🌧️', 'Rain upstream'], 'rain-road': ['🌧️', 'Rain'],
};
const KIND_ICON = { dip: '〰️', flat: '〰️', bridge: '🌉', river: '🌉', road: '🛣️' };
const REFRESH_MS = 5 * 60 * 1000;
const HAND_DOWN = 'Flood model not responding';
const SFINCS_DOWN = 'Road flood forecast (SFINCS) not responding';
const NAV_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 4.5 20.3l.7.7L12 18l6.8 3 .7-.7z"/></svg>';
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};
let favorites = savedRoutes(store.get('savedRoutes'), Object.keys(ROUTE_INFO));
let saveNotice = '';
const saveButton = (id) => `<button type="button" class="btn btn-text save-route" data-save-route="${esc(id)}" aria-pressed="${favorites.includes(id)}">${favorites.includes(id) ? 'Saved route' : 'Save route'}</button>`;
// The engine's number plus any half point from HAND.
const pointScore = (p) => { const s = riskScore(p); return s == null ? s : Math.min(5,s + (p.handAdd ?? 0)); };
const badge = (n, lg) => `<span class="badge ${lg ? 'lg' : ''} ${n ? `s${Math.floor(n)}` : 'sq'}" role="img" aria-label="Risk factor ${n ?? 'unknown'} of 5">${n ?? '?'}</span>`;
const badgeWithWord = (n) => `<span class="badge-wrap">${badge(n, true)}<span class="badge-word">${n ? WORD[Math.floor(n)] : 'No data'}</span></span>`;

// ---------------- data ----------------
// River gauges. USGS limits how often one phone may ask without a key, so:
//  1. ask our alert service first (it already pulls every gauge each minute: one request),
//  2. otherwise ask USGS directly, but reuse each gauge's reading for 10 minutes,
//  3. if USGS refuses, fall back to the last saved reading (its age is judged like any other).
let usgsBusy = false;
async function loadUsgsAll(sites, sharedFeed) {
  const key = store.get('apiKey');
  const proxy = cfg.TEXT_API ? `${cfg.TEXT_API}?feed=usgs` : null;
  const result = await loadGaugeReadings(sites, {
    // The combined feed answers for the service; direct USGS requests are the fallback.
    fetchJson: async (url) => { if (url !== proxy) return getJson(url); const usgs = (await sharedFeed)?.usgs; if (!usgs) throw new Error('No shared gauge feed'); return usgs; },
    store, parse: parseContinuous,
    proxyUrl: proxy,
    directUrl: (site) => `${SOURCES.usgs}/collections/continuous/items?f=json&monitoring_location_id=USGS-${site}`
      + '&parameter_code=00060&time=PT6H&limit=500&skipGeometry=true&properties=time,value,parameter_code'
      + (key ? `&api_key=${encodeURIComponent(key)}` : ''),
  });
  usgsBusy = result.busy;
  return result.series;
}
async function loadClosures() {
  const q = new URLSearchParams({
    where: '1=1', outFields: 'Location,Status,Direction,timeUpdated', returnGeometry: 'true', outSR: '4326', f: 'json',
    geometry: cfg.CLOSURE_BOUNDS, geometryType: 'esriGeometryEnvelope', inSR: '4326', spatialRel: 'esriSpatialRelIntersects',
  });
  const j = await getJson(`${SOURCES.closures}/query?${q}`);
  return parseCountyClosures(j);
}
// County rain/stream feed: live through the alert service when it's connected, else GitHub's copy.
async function loadAlert(sharedFeed) {
  const a = (await sharedFeed)?.alert;
  return a?.rain ? a : getJson(SOURCES.alert);
}
// TransView closures and construction, through the alert service (TransView blocks browsers).
const ROAD_EVENTS_KEEP_MS = 6 * 3600000;
async function loadRoadEvents(sharedFeed, now) {
  if (!cfg.TEXT_API) return null;
  const feed = (await sharedFeed)?.roadEvents;
  if (Array.isArray(feed?.events)) {
    store.set('roadEventsGood', { at: feed.fetchedAt ?? now, events: feed.events });
    return feed.events;
  }
  // Keep the last answer for a few hours: a TransView-only closure shouldn't vanish in an outage.
  const saved = store.get('roadEventsGood');
  if (saved && now - saved.at < ROAD_EVENTS_KEEP_MS) return saved.events;
  throw new Error('no road events');
}
async function loadNws() {
  const j = await getJson(SOURCES.nws, { headers: { Accept: 'application/geo+json' } });
  return (j.features ?? []).map((f) => ({ event: f.properties.event, headline: f.properties.headline }));
}
async function gather() {
  const now = Date.now();
  const errors = [];
  const settle = async (name, p) => { try { return await p; } catch { errors.push(`${name} not responding`); return null; } };
  const sites = Object.keys(USGS_SITES);
  // One request for everything the alert service provides. Each reader has its own fallback.
  const sharedFeed = cfg.TEXT_API ? getJson(`${cfg.TEXT_API}?feed=all`).catch(() => null) : Promise.resolve(null);
  const [flowsArr, county, alert, nws, roadEvents] = await Promise.all([
    loadUsgsAll(sites, sharedFeed),
    settle('county barricades', loadClosures()),
    settle('rain gauges', loadAlert(sharedFeed)),
    settle('weather service', loadNws()),
    settle('TransView closures', loadRoadEvents(sharedFeed, now)),
  ]);
  const closures = county?.points ?? null;
  if (county?.reason) errors.push(county.reason);
  const flows = Object.fromEntries(sites.map((s, i) => [s, summarizeFlow(flowsArr[i], now, STALE_MS)]));
  if (!Object.values(flows).some((f) => f.fresh)) errors.push(usgsBusy ? 'river gauges busy, retrying' : 'river gauges not responding');
  const service = await sharedFeed;
  reportFailures({ service: cfg.TEXT_API && !service, county: !county?.complete, rain: !alert, weather: !nws, closures: cfg.TEXT_API && !roadEvents });
  return { now, flows, closures, alert, nws, roadEvents, drive: service?.drive ?? data?.drive ?? [], errors: [...new Set(errors)] };
}

// Counts of feeds that failed on a phone, once per visit per feed. Nothing about who.
function reportFailures(failed) {
  if (!cfg.TEXT_API) return;
  try {
    const names = Object.keys(failed).filter((k) => failed[k] && !sessionStorage.getItem(`failed-${k}`));
    if (!names.length) return;
    names.forEach((k) => sessionStorage.setItem(`failed-${k}`, '1'));
    fetch(`${cfg.TEXT_API}?fail=${names.join(',')}`).catch(() => {});
  } catch { /* private mode */ }
}

// ---------------- state ----------------
let allRoutes = [];     // every route, all areas
let routeFeatures = []; // routes in the chosen area
let area = 'avra';
const areaInfo = () => AREAS.find((x) => x.id === area) ?? AREAS[0];
function useArea(id) {
  area = AREAS.some((x) => x.id === id) ? id : 'avra';
  store.set('area', area);
  routeFeatures = allRoutes.filter((f) => (f.properties.area ?? 'avra') === area);
  allBounds = L.geoJSON({ type: 'FeatureCollection', features: routeFeatures }).getBounds();
}
let data = null;
let view = null;
let openSource = null; // index of the source row expanded on the stretch screen
// Direction is never a setting: the risk is the same both ways. Navigate works out
// which way you're headed when tapped. In Avra Valley (west of the Santa Cruz) means
// toward I-10; anywhere else means into the valley, to Trico & El Tiro. No location: before noon = toward I-10.
const viaText = (rid) => ROUTE_INFO[rid].via;
function headingIntoValley() {
  const byClock = () => new Date().getHours() >= 12;
  if (!navigator.geolocation) return Promise.resolve(byClock());
  return new Promise((done) => {
    navigator.geolocation.getCurrentPosition(
      (p) => done(!(p.coords.longitude < -111.2 && p.coords.latitude > 32.3 && p.coords.latitude < 32.52)),
      () => done(byClock()),
      { timeout: 4000, maximumAge: 300000 },
    );
  });
}
async function navigate(rid) {
  if (routeClosures(view.byId[rid]).length) return; // No directions down a closed road.
  const intoValley = await headingIntoValley();
  const url = googleMapsUrl(NAV[rid], intoValley ? null : store.get('dest'), intoValley ? 'valley' : 'toI10');
  location.href = url;
}

// HAND loads after the first screen, so slow or failing NOAA calls can't hold it up.
let handModel = null;
let handRun = 0;
async function refreshHand() {
  const run = ++handRun;
  let hand = null;
  try {
    handModel ??= await import('./hand-model.js?v=dev');
    hand = await handModel.loadHand(FAILURE_POINTS, { sharedFeed: cfg.TEXT_API ? `${cfg.TEXT_API}?feed=forecasts` : null });
  } catch { /* shown below as not responding */ }
  if (run !== handRun || !data) return;
  // The HAND row comes first in the list, so an open row would point at the wrong source.
  if (Boolean(data.hand) !== Boolean(hand)) openSource = null;
  data.hand = hand;
  data.errors = data.errors.filter((e) => e !== HAND_DOWN);
  if (!hand) data.errors.push(HAND_DOWN);
  view = compute(data);
  // Redrawing would clear a form someone is typing in; the next check picks it up.
  if (!['report', 'alerts'].includes(where().screen)) render();
}

// The SFINCS road forecast: the hourly live run compared with lidar road heights along every
// route (simulation/route-prediction.js). It loads after the first screen like HAND, and counts in
// the route ratings whenever the run covers the current time. docs/SFINCS-ROUTE-PREDICTION.md.
let sfincsModel = null;
let sfincsRun = 0;
async function refreshSfincs() {
  const run = ++sfincsRun;
  let sfincs = null;
  try {
    sfincsModel ??= await import('./simulation/route-prediction.js?v=dev');
    sfincs = await sfincsModel.loadLivePrediction();
  } catch (e) { sfincs = { status: 'unavailable', reason: `The road flood forecast did not load (${e.message}).` }; }
  if (run !== sfincsRun || !data) return;
  data.sfincs = sfincs;
  data.errors = data.errors.filter((e) => e !== SFINCS_DOWN);
  if (sfincs.status === 'unavailable') data.errors.push(SFINCS_DOWN);
  view = compute(data);
  if (!['report', 'alerts'].includes(where().screen)) render();
}
// One rating row per route from the SFINCS forecast, while the run covers now. It can only raise
// the route's level: worst() keeps a closure or a gauge reading where it was.
function addSfincs(r, d) {
  const s = d.sfincs;
  if (s?.status !== 'ok' || !sfincsModel) return { ...r, sfincs: { status: s?.status || 'loading', reason: s?.reason } };
  const forecast = s.routes?.[r.id];
  if (!forecast) return { ...r, sfincs: { status: 'unavailable', reason: s.routeStatus?.[r.id]?.reason || 'This route has no current model coverage.' } };
  const point = sfincsModel.roadForecastPoint(r.id, forecast);
  return { ...r, sfincs: { ...forecast, status: 'current' }, points: [...r.points, point], level: worst([r.level, point.level]) };
}

function compute(d) {
  const structureRecords=Object.fromEntries(FAILURE_POINTS.map(fp=>[fp.id,bridgeRecordFor(fp,bridgeEvidence?.registry)]));
  const fpResults = Object.fromEntries(FAILURE_POINTS.map((fp) => [fp.id, rateFailurePoint(fp, {...d,bridgeEvidence:structureRecords}, cfg)]));
  // HAND only adds to the result, so a fault in it can't take the ratings down with it.
  try { handModel?.applyHand(fpResults, d.hand); } catch { /* ratings stand without it */ }
  const rated = rateRoutes(routeFeatures, fpResults, FAILURE_POINTS, { closures: d.closures, radiusM: cfg.CLOSURE_RADIUS_M, roadEvents: d.roadEvents, now: d.now }).map((r) => addSfincs(r, d)).map((r) => { const score = routeScore(r); return { ...r, score: score == null ? score : Math.max(score, ...r.points.map((p) => pointScore(p) ?? 1)) }; });
  const nwsQuiet = Array.isArray(d.nws) && !d.nws.some((a) => /flood/i.test(a.event));
  const underpasses = UNDERPASSES.map((up) => ({ ...up, result: rateFailurePoint(up, d, cfg) }));
  // Readable times and names for the screen; alerts keep the source wording.
  const plain = (o) => { o.why = plainWords(o.why, d.now); if (o.detail) o.detail = plainWords(o.detail, d.now); };
  for (const p of new Set([...Object.values(fpResults), ...rated.flatMap((r) => r.points), ...underpasses.map((u) => u.result)])) { plain(p); p.checks?.forEach(plain); }
  // Every official closure for the map, whether or not a route uses it.
  const closedPoints = (d.closures ?? []).filter((c) => c.statusKnown !== false && /clos/i.test(c.status ?? '') && Number.isFinite(c.lat)).map((c) => ({ lat: c.lat, lon: c.lon, title: `Closed: ${c.location}${c.direction ? `, ${c.direction.toLowerCase()}` : ''}${c.updated ? ` (updated ${c.updated})` : ''}` }));
  const closedEvents = (d.roadEvents ?? []).filter((e) => e.closed && roadEventTiming(e, d.now) === 'active');
  const repeated = (lon, lat) => closedPoints.some((c) => Math.hypot((c.lon - lon) * 94000, (c.lat - lat) * 110574) <= 15);
  for (const e of closedEvents) if (!e.type.includes('LINE')) for (const part of e.parts) for (const [lon, lat] of part) if (!repeated(lon, lat)) closedPoints.push({ lat, lon, title: `Closed: ${e.headline.trim()}` });
  const closedLines = closedEvents.filter((e) => e.type.includes('LINE')).flatMap((e) => e.parts.map((part) => ({ title: `Closed: ${e.headline.trim()}`, coords: part.map(([lon, lat]) => [lat, lon]) })));
  return { closedPoints, closedLines, fpResults, underpasses, rated, rec: recommend(rated), nwsQuiet, byId: Object.fromEntries(rated.map((r) => [r.id, r])) };
}

// Screens are addressed by the URL hash so the phone's back button works:
//   #/               home
//   #/r/<route>      one route
//   #/r/<route>/<fp> one stretch on that route
//   #/how  #/settings  #/sources
function where() {
  return resolveScreen(location.hash, view?.byId ?? {});
}

// ---------------- words ----------------
function angelText(r) {
  const good = goodSigns(r, view.nwsQuiet);
  if (r.level === 'unknown' && !good.length) return 'I can’t vouch for this one. Too much data is missing.';
  if (!good.length) return 'Not much going for it right now.';
  const list = good.length > 1 ? `${good.slice(0, -1).join(', ')} and ${good.at(-1)}` : good[0];
  return `${cap(list)}.`;
}
const topIssue = (r) => {
  const a = againstIt(r)[0];
  return a ? `${a.short}: ${a.why}` : r.points.some(conditionsNotEstablished) ? 'Conditions not established' : 'No warning in available data';
};
function bridgeCardEvidence(p) {
  const c=p.checks.find(c=>c.heightComparison?.status==='estimated'),h=c?.heightComparison;
  if(!h)return '';
  const time=new Date(h.time).toLocaleString('en-US',{timeZone:'America/Phoenix',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
  const label={below_warning:'Water stays below the road',warning:'Water is nearing the road',roadway_concern:'Water reaches the road',likely_closed:'Likely closed',unavailable:'Height comparison unavailable'}[h.assessment];
  const tone=h.assessment==='below_warning'?'calm':h.assessment==='warning'?'watch':'concern';
  const ratio=h.heightAboveChannelM>0?Math.max(0,Math.min(1.1,(h.waterM-h.channelM)/h.heightAboveChannelM)):0;
  return `<div class="angel bridge-angel ${tone}"><span class="face" aria-hidden="true">${tone==='calm'?'&#128519;':'!'}</span><div class="bridge-bubble"><div class="bridge-kicker">${esc(p.short)}</div><strong class="bridge-status">${esc(label)}</strong><div class="bridge-reading"><div><span class="bridge-gap">${(Math.abs(h.differenceM)/0.3048).toFixed(1)} <small>ft</small></span><span class="bridge-relation">${h.differenceM>=0?'below':'above'} roadway</span></div><div class="bridge-diagram" aria-hidden="true" style="--water:${Math.min(100,ratio/1.1*100).toFixed(1)}%"><span class="bridge-road">ROAD</span><span class="bridge-water"></span></div></div><div class="bridge-time">Model estimate · ${esc(time)} Arizona${c.bridgePoints>0?` · +${c.bridgePoints} route risk`: ''}</div></div></div>`;

}
const routeBridgeEvidence=r=>r.points.map(bridgeCardEvidence).join('');
const minutes = (r) => `${Math.round(r.minutes)} min`;
const navBtn = (r, cls = 'btn btn-primary') => {
  if (!routeClosures(r).length) return `<button type="button" class="${cls}" data-nav="${r.id}">${NAV_ICON}Navigate</button>`;
  // Google Maps doesn't know about county closures, so a closed route gets no directions.
  const open = view.rec.order.find((x) => !routeClosures(x).length);
  return `<p class="closed-note">A closure is reported on this route. Check its timing before driving; directions are withheld.</p>${open ? `<button type="button" class="${cls}" data-nav="${open.id}">${NAV_ICON}Navigate ${esc(ROUTE_INFO[open.id].name)} instead</button>` : ''}`;
};
// The closures on this area's routes, at the top of the screen.
const closureBanner = (routes) => {
  const byPlace = new Map();
  for (const r of routes) for (const p of routeClosures(r)) {
    if (!byPlace.has(p.short)) byPlace.set(p.short, []);
    byPlace.get(p.short).push(ROUTE_INFO[r.id].name);
  }
  if (!byPlace.size) return '';
  return `<section class="closure-banner" role="alert"><h2><span aria-hidden="true">⛔</span> Reported road closure</h2><ul>${[...byPlace].map(([place, names]) => `<li><b>${esc(place)}</b>. Blocks ${esc(names.join(', '))}.</li>`).join('')}</ul><a href="#/closures">All road closures</a></section>`;
};

// ---------------- screens ----------------
function homeScreen() {
  const { rec } = view;
  const best = rec.best;
  const info = ROUTE_INFO[best.id];
  const against = againstIt(best).slice(0, 2);
  const others = rec.order.filter((r) => r.id !== best.id);
  const allClosed = routeClosures(best).length > 0;
  const overline = allClosed ? 'Every route has a closure report' : best.score <= 2 ? 'Best route right now' : 'Least going against it';
  const areaSwitch = `<div class="seg" role="tablist" aria-label="Area">${AREAS.map((x) => `<button type="button" role="tab" data-area="${x.id}" aria-selected="${x.id === area}">${esc(x.name)}</button>`).join('')}</div>`;
  return `
    ${areaSwitch}
    ${closureBanner(rec.order)}
    <article class="hero">
      <p class="overline">${overline}</p>
      <div class="hero-top"><h2>${esc(info.name)}</h2>${badgeWithWord(best.score)}</div>
      <p class="meta">${minutes(best)} · ${esc(viaText(best.id))}</p>
      ${allClosed ? '' : `<div class="angel"><span class="face" aria-hidden="true">😇</span><p>${esc(angelText(best))}</p></div>`}
      ${against.length ? `<ul class="against">${against.map((a) => `<li><span class="dot ${a.level}"></span><span>${esc(a.short)}: ${esc(a.why)}</span></li>`).join('')}</ul>` : ''}
      <p class="meta model-prediction">${esc(routeModelText(best))}</p>
      ${routeBridgeEvidence(best)}
      <div class="actions">${navBtn(best)}<a class="btn btn-text" href="#/r/${best.id}">Details</a><button type="button" class="btn btn-text" data-share>Share this check</button></div>
      <p id="share-notice" class="meta" role="status"></p>
    </article>
    <section class="saved-routes" aria-labelledby="saved-title"><h3 id="saved-title" class="section">Your saved routes</h3>
    ${favorites.some((id) => view.byId[id]) ? `<div class="list">${favorites.filter((id) => view.byId[id]).map((id) => `<a class="row" href="#/r/${id}">${badge(view.byId[id].score)}<span class="text"><span class="t">${esc(ROUTE_INFO[id].name)}</span><span class="st">${esc(topIssue(view.byId[id]))}</span><span class="st model-prediction">${esc(routeModelText(view.byId[id]))}</span>${routeBridgeEvidence(view.byId[id])}</span><span class="chev" aria-hidden="true">›</span></a>`).join('')}</div>` : '<p class="meta">Open a route and choose Save route to keep it here for this area.</p>'}
    <p class="meta">Saved on this browser. Ratings still use the current check.</p></section>
    <h3 class="section">Other routes</h3>
    <div class="list">
      ${others.map((r) => `
        <a class="row" href="#/r/${r.id}">
          ${badge(r.score)}
          <span class="text"><div class="t">${esc(ROUTE_INFO[r.id].name)}</div><div class="st">${minutes(r)} · ${esc(topIssue(r))}</div><div class="st model-prediction">${esc(routeModelText(r))}</div>${routeBridgeEvidence(r)}</span>
          <span class="chev">›</span>
        </a>`).join('')}
    </div>
    <h3 class="section">More</h3>
    <div class="list">
      <a class="row small" href="#/closures"><span class="lead-icon">🚧</span><span class="text"><div class="t">Road closures</div><div class="st">Closed and caution points near you</div></span><span class="chev">›</span></a>
      <a class="row small" href="#/alerts"><span class="lead-icon">🔔</span><span class="text"><div class="t">Alerts</div><div class="st">Get this sent to your phone at a time you pick</div></span><span class="chev">›</span></a>
      <a class="row small" href="#/report"><span class="lead-icon">✍️</span><span class="text"><div class="t">Help fill the gaps</div><div class="st">Tell us what a crossing is really like in the rain</div></span><span class="chev">›</span></a>
      <a class="row small" href="#/underpasses"><span class="lead-icon">🛣️</span><span class="text"><div class="t">I-10 underpasses</div><div class="st">Marana, Orange Grove, Grant, Speedway</div></span><span class="chev">›</span></a>
      <a class="row small" href="#/how"><span class="lead-icon">❓</span><span class="text"><div class="t">How to read this</div></span><span class="chev">›</span></a>
      <a class="row small" href="#/updates"><span class="lead-icon">📝</span><span class="text"><div class="t">What's new</div></span><span class="chev">›</span></a>
      <a class="row small" href="#/settings"><span class="lead-icon">⚙️</span><span class="text"><div class="t">Settings</div></span><span class="chev">›</span></a>
      <a class="row small" href="#/sources"><span class="lead-icon">ℹ️</span><span class="text"><div class="t">Sources</div></span><span class="chev">›</span></a>
      <a class="row small" href="#/privacy"><span class="lead-icon">🔒</span><span class="text"><div class="t">Privacy &amp; terms</div></span><span class="chev">›</span></a>
    </div>
    <p class="fine">A guide built from public data, not a safety guarantee. Water over the road: turn around.</p>`;
}

function routeScreen(rid) {
  const r = view.byId[rid];
  const info = ROUTE_INFO[rid];
  const { concerns, unestablished, quiet } = groupRoutePoints(r.points, pointScore);
  // A barricade between crossings has no stretch page; its row states the county's own words.
  const row = (p) => p.routeBarricade ? `
    <div class="row">
      ${badge(pointScore(p))}
      <span class="text"><div class="t">${esc(p.short)}</div><div class="st">${esc(p.why)}</div></span>
    </div>` : `
    <a class="row" href="#/r/${rid}/${p.id}">
      ${badge(pointScore(p))}
      <span class="text"><div class="t">${esc(p.short)}</div>${bridgeCardEvidence(p)}${p.why===p.checks.find(c=>c.heightComparison)?.why?'':`<div class="st">${esc(p.why)}</div>`}</span>
      <span class="chev">›</span>
    </a>`;
  const closed = routeClosures(r).length > 0;
  // The SFINCS road forecast's state when it isn't in the rating: loading, unreachable, stale or outside the run.
  const sf = data.sfincs, sfNote = !sf ? 'Loading the road flood forecast.' : sf.status !== 'ok' ? sf.reason : r.sfincs && r.sfincs.status !== 'current' ? r.sfincs.reason : '';
  if (r.sfincs?.maxOver > sfincsModel?.COVER_M) import('./model-acknowledgement.js?v=dev').then((m) => m.showAcknowledgement('modelRun')).catch(() => {});
  return `
    ${closureBanner([r])}
    <article class="hero">
      <div class="hero-top"><div style="flex:1"><p class="meta" style="margin:0">${minutes(r)} · ${esc(viaText(rid))}</p></div>${badgeWithWord(r.score)}</div>
      ${closed ? '' : `<div class="angel"><span class="face" aria-hidden="true">😇</span><p>${esc(angelText(r))}</p></div>`}
      <p class="meta model-prediction">${esc(routeModelText(r))}</p>
    </article>
    ${saveButton(rid)}<p id="save-notice" class="meta" role="status">${esc(saveNotice)}</p>
    ${concerns.length ? `<h3 class="section">Warnings and concerns</h3><div class="list">${concerns.map(row).join('')}</div>` : ''}
    ${unestablished.length ? `<h3 class="section">Conditions not established</h3><div class="list">${unestablished.map(row).join('')}</div>` : ''}
    ${quiet.length ? `<h3 class="section">No warning in available data</h3><div class="list">${quiet.map(row).join('')}</div>` : ''}
    ${sfNote ? `<p class="fine">Flood model along this road (SFINCS): ${esc(sfNote)}</p>` : ''}
    <div class="bottom-bar">${navBtn(r)}</div>`;
}

let bridgeEvidence=null;
function bridgeEvidencePlaceholder(fp){
 if(!['bridge','river'].includes(fp.kind))return '';
 const record=bridgeRecordFor(fp,bridgeEvidence?.registry),history=bridgeHistory(record);
 const height=bridgeHeightComparison(record,Date.now(),cfg.BRIDGE_POLICY),road=record?.roadwayEstimate,water=record?.modelWater;
 const heightHtml=road?`<dt>Estimated roadway height</dt><dd>About ${(road.elevationM/0.3048).toFixed(1)} ft (${esc(road.verticalDatum)} elevation reference). Approach samples: ${road.approachElevationsM.map(v=>(v/0.3048).toFixed(1)).join(' and ')} ft. <a href="${esc(road.source)}" target="_blank" rel="noopener noreferrer">Road profile source</a>. ${esc(imperialSourceText(road.method))}</dd>`:'<dt>Roadway height</dt><dd>No site-linked estimate available.</dd>';
 const waterHtml=height.status==='estimated'?`<dt>Highest water still in the forecast</dt><dd>${(height.waterM/0.3048).toFixed(1)} ft ${esc(height.datum)} at ${esc(new Date(height.time).toLocaleString('en-US',{timeZone:'America/Phoenix'}))} Arizona time. Estimated road is ${(Math.abs(height.differenceM)/0.3048).toFixed(1)} ft ${height.differenceM>=0?'above':'below'} that modeled water surface. This compares water with the road surface. It does not measure space under the bridge.</dd><dt>Water source and period</dt><dd>SFINCS water estimate for the 328 ft model cell ${water.cellIndex} containing this bridge. Issued ${esc(water.issuedAt)}; forecast ${esc(water.validFrom)} through ${esc(water.validTo)}. ${esc(imperialSourceText(water.method))} <a href="simulation/data/current-sfincs-manifest.json">Model source</a>.</dd>`:`<dt>Water elevation comparison</dt><dd>${esc(height.reason)}</dd>`;
 const historyHtml=history.length?history.map(h=>`<p><a href="${esc(h.source)}" target="_blank" rel="noopener noreferrer">${esc(h.date)} report and photographs</a>: ${esc(h.summary)}</p><p>${esc(h.siteMatch||'')}</p><p>${esc(h.interpretationLimit||'')}</p>`).join(''):'No confirmed flood report is linked to this bridge. '+esc(record?.historyLimit||'This does not mean it has never flooded.');
 return `${bridgeCardEvidence(view.fpResults[fp.id])}<details class="bridge-evidence" data-bridge-evidence data-crossing-id="${esc(fp.id)}"><summary>Sources &amp; warning levels</summary><div class="bridge-evidence-body">${bridgeEvidence?.status==='unavailable'?`<p role="status">Evidence package unavailable: ${esc(bridgeEvidence.reason)}. Missing fields below are not proof of no flood history.</p>`:''}<dl>${heightHtml}${waterHtml}<dt>When the warning changes</dt><dd>${height.thresholds?`Channel elevation ${(height.channelM/0.3048).toFixed(1)} ft NAVD88; estimated road height above channel ${(height.heightAboveChannelM/0.3048).toFixed(1)} ft. Warning at ${(height.thresholds.warningM/0.3048).toFixed(1)} ft; roadway concern at ${(height.thresholds.roadwayM/0.3048).toFixed(1)} ft; likely closed — model estimate at ${(height.thresholds.likelyClosedM/0.3048).toFixed(1)} ft. ${esc(height.assessmentLabel)}. Warnings begin when water reaches 90% of the channel-to-road height; road-level concern begins at 100%, and likely closed at 110%. These are warning rules, not measured accuracy. <a href="${esc(record.channelReference.source)}">Channel terrain source</a>. ${esc(imperialSourceText(record.channelReference.method))}`:esc(height.assessmentLabel||height.reason)}</dd><dt>Under-bridge clearance</dt><dd>We do not have the height of the bridge underside. The road height cannot tell us the clearance beneath it.</dd><dt>Documented flooding or overtopping</dt><dd>${historyHtml}</dd></dl><p>Current readings and county barricade reports are below. River flow alone cannot tell us whether this bridge is underwater.</p>${record?`<details><summary>Evidence source</summary><p>Structure matched by its recorded coordinates; map tag, not survey confirmation. Registry ${esc(bridgeEvidence.source.sourceCommit)}. Structure evidence is separate from model coverage and current official closures.</p></details>`:''}</div></details>`;
}

function stretchScreen(rid, fpId) {
  const p = view.fpResults[fpId];
  const fp = FAILURE_POINTS.find((f) => f.id === fpId);
  const s = pointScore(p);
  return `
    <div class="summary">${badgeWithWord(s)}<div><p>${esc(['bridge','river'].includes(fp.kind)?(p.checks.some(c=>c.src==='county'&&c.level==='danger')?p.why:'Bridge forecast & current reports'):p.why === p.checks[0]?.why && p.checks[0]?.src === 'hand' ? 'The HAND model estimates water here. It can\'t say what the road is like; look as you go.' : p.level === 'ok' && p.checks[0]?.some ? handModel.CALM_WITH_FLOW : crossingLead(p) ?? LEVEL_SENTENCE[p.level])}</p><p class="where">${esc(fp.name)}, ${esc(fp.where)}.</p></div></div>
    ${bridgeEvidencePlaceholder(fp)}
    <h3 class="section">What each source says</h3>
    <div class="list">
      ${p.checks.map((c, i) => {
        const [icon, label] = SRC[c.src] ?? ['•', c.src];
        return `
        <details class="src" data-i="${i}" ${openSource === i ? 'open' : ''}>
          <summary class="row"><span class="lead-icon">${icon}</span>
            <span class="text"><div class="t">${label}</div><div class="st"><span class="dot ${c.level}" style="display:inline-block;margin-right:6px"></span>${esc(c.why)}</div></span>
            <span class="chev">›</span></summary>
          <div class="more"><p>${esc(c.why)}</p>${c.detail ? `<p>${esc(c.detail)}</p>` : ''}${c.src === 'hand' && data.hand?.byFp[fpId]?.status === 'supported' ? `<p><a href="#/map">See predicted water on the map</a></p>` : ''}</div>
        </details>`;
      }).join('')}
    </div>
    ${driveBlock(fpId)}
    <a class="btn btn-text" style="margin-top:12px" href="#/report/${fpId}">Drive this one? Tell us what it's really like</a>
    <div class="bottom-bar">${navBtn(view.byId[rid])}</div>`;
}

let reportMsg = '';
function reportScreen(fpId) {
  const ids = new Set(routeFeatures.map((f) => f.properties.id));
  const here = FAILURE_POINTS.filter((fp) => fp.routes.some((r) => ids.has(r)));
  const others = FAILURE_POINTS.filter((fp) => !here.includes(fp));
  const sel = FAILURE_POINTS.find((f) => f.id === fpId);
  const opt = (fp) => `<option value="${fp.id}" ${fp.id === fpId ? 'selected' : ''}>${esc(fp.short)}</option>`;
  return `<div class="page">
    ${reportMsg ? `<p class="note">${esc(reportMsg)}</p>` : ''}
    <p>You drive these roads in the rain; the maps don't. A minute of your answers makes the ratings better for everyone.</p>
    <label class="field">Which crossing?
      <select id="rp-fp">
        <option value="" ${fpId ? '' : 'selected'}>Pick one…</option>
        <optgroup label="${esc(areaInfo().name)}">${here.map(opt).join('')}</optgroup>
        <optgroup label="Other area">${others.map(opt).join('')}</optgroup>
        <option value="other" ${fpId === 'other' ? 'selected' : ''}>Somewhere not on this list</option>
      </select>
    </label>
    ${sel ? `<p class="fine" style="text-align:left;margin:0 0 6px">${esc(sel.name)}, ${esc(sel.where)}.${/not confirmed/.test(sel.name) ? ' <b>We\'re not sure this one floods at all, so any answer helps.</b>' : ''}</p>` : ''}
    ${fpId === 'other' ? '<label class="field">Where is it? (road and nearest cross street)<input id="rp-where" type="text" autocomplete="off"></label>' : ''}
    ${cfg.REPORT_QUESTIONS.map((q) => `
      <label class="field">${esc(q.q)}
        <select data-q="${q.id}"><option value="">Skip</option>${q.a.map((a) => `<option>${esc(a)}</option>`).join('')}</select>
      </label>`).join('')}
    <label class="field">Last time you saw water here (if you remember)
      <input id="rp-date" type="date">
    </label>
    <label class="field">Anything else? (e.g. "floods before the river does", "the edge washes out", "worse at night")
      <textarea id="rp-note" rows="3"></textarea>
    </label>
    <button type="button" class="btn btn-primary" id="rp-send">Send</button>
    <p class="fine" style="text-align:left">No name or number needed. Please don't include personal details.</p>
  </div>`;
}

function howScreen() {
  return `<div class="page">
    <button type="button" class="btn btn-primary" data-show-me-how>Show me how: 3 steps</button><h4>The number</h4>
    <ul class="legend">
      ${[1, 2, 3, 4, 5].map((n) => `<li>${badge(n)}<span><b>${WORD[n]}.</b> ${['Nothing in the data points to water.', 'Some water around; usually passable. Look as you go.', 'Water likely at or near the road.', 'Several signs agree water is at the road.', 'The county closed it, or a flood is running.'][n - 1]}</span></li>`).join('')}
      <li>${badge(null)}<span><b>No data.</b> Not the same as fine.</span></li>
    </ul>
    <h4>The flood model (NOAA HAND)</h4>
    <p>Where NOAA's stream data matches a crossing, the first source shown is HAND, an estimate of how high forecast flow reaches above the stream bed. It never overrides a gauge: where a river gauge is reporting, HAND is shown but doesn't change the number. Without one, a well-matched estimate showing water adds to the number your other sources gave: 1 point on the Santa Cruz, half a point on washes, based on how often its alarms failed at the gauges we track. A low or zero flow never lowers one, because local runoff isn't included. It's an estimate, not a reading, and it isn't depth on a road.</p>
    <h4>Using it</h4>
    <p>The top card is the route with the least going against it. The numbers are the same whichever way you're driving. Tap <b>Navigate</b> to drive it in Google Maps; it heads for I-10 when you're in Avra Valley, and back to Trico &amp; El Tiro when you're not. Tap <b>Details</b> or any route to see its stretches, then any stretch to see what each source says. The map follows along.</p>
    <p>A route's number is its worst stretch. The map only marks stretches that aren't normal.</p>
    <h4>Limits</h4>
    <p>Built from public, provisional data that can be late or wrong. What you see at the crossing comes first.</p>
  </div>`;
}
// Drivers' reports show beside the ratings. They never change a rating.
function driveBlock(fpId) {
  const now = Date.now(), s = driveSummary(data.drive, fpId, now), mine = store.get(`drove-${fpId}`);
  const recent = mine && now - mine.at < 1800000;
  const seen = s ? `<p><b>${s.state === 'water' ? 'Latest driver report: water over the road' : 'Latest driver report: no water over the road'}</b>, ${esc(plainAge(s.at, now))}.${s.water && s.clear ? ` ${s.water} saw water and ${s.clear} did not in the last 6 hours.` : ''} From drivers, not checked, and not part of the rating.</p>` : '<p>No driver reports here in the last 6 hours.</p>';
  return `<section class="drive-report" aria-label="Driver reports">${seen}${recent ? '<p>Thanks for your report.</p>' : `<p>Just drove it?</p><div class="drive-actions"><button type="button" class="btn" data-drive="water">Water over road</button><button type="button" class="btn" data-drive="clear">No water</button></div>`}</section>`;
}
function wireDrive(fpId) {
  document.querySelectorAll('[data-drive]').forEach((b) => b.addEventListener('click', async () => {
    document.querySelectorAll('[data-drive]').forEach((x) => { x.disabled = true; });
    store.set(`drove-${fpId}`, { at: Date.now() });
    try {
      const r = await textApi({ action: 'drive', fp: fpId, state: b.dataset.drive });
      if (r?.reports) data.drive = r.reports;
    } catch { store.set(`drove-${fpId}`, null); }
    render();
  }));
}

const milesBetween = (a, b) => Math.hypot((a.lat - b.lat) * 69, (a.lon - b.lon) * 58.4);
function closuresScreen() {
  const [lat, lon] = areaInfo().hubAt, hub = { lat, lon }, now = Date.now();
  const blocks = new Map();
  for (const r of view.rated) for (const p of routeClosures(r)) blocks.set(p.short, [...(blocks.get(p.short) ?? []), ROUTE_INFO[r.id].name]);
  const county = (data.closures ?? []).filter((c) => c.statusKnown !== false && /clos|caution/i.test(c.status ?? '') && c.location).map((c) => ({ place: c.location, closed: /clos/i.test(c.status), status: c.status, direction: c.direction, age: plainAge(countyTime(c.updated), now), lat: c.lat, lon: c.lon }));
  const known = (lat2, lon2) => county.some((c) => Math.hypot((c.lon - lon2) * 94000, (c.lat - lat2) * 110574) <= 15);
  const other = (data.roadEvents ?? []).filter((e) => e.closed && e.parts?.[0]?.[0]).map((e) => ({ place: e.headline.trim(), closed: roadEventTiming(e, now) === 'active', status: roadEventLabel(e, now), age: null, lon: e.parts[0][0][0], lat: e.parts[0][0][1] })).filter((e) => !known(e.lat, e.lon));
  const rows = [...county, ...other].map((c) => ({ ...c, miles: milesBetween(hub, c) })).filter((c) => c.miles <= 40).sort((a, b) => Number(b.closed) - Number(a.closed) || a.miles - b.miles);
  const missing = !data.closures ? '<p class="note">The county closure feed isn\'t answering right now. That does not mean roads are open.</p>' : '';
  return `<div class="page"><p>Near ${esc(areaInfo().hub)}, closed first, then nearest. From Pima County and TransView. Scheduled closures are shown separately from closures in their listed window. Missing timing is unverified, not proof a road is open. Barricades can stay listed after a road reopens.</p>${missing}</div>
    ${rows.length ? `<div class="list">${rows.map((c) => `<div class="row"><span class="lead-icon" aria-hidden="true">${c.closed ? '⛔' : '⚠️'}</span><span class="text"><div class="t">${esc(c.place)}</div><div class="st"><span class="closure-status">${esc(c.status)}</span>${c.direction ? ` · ${esc(c.direction.toLowerCase())}` : ''} · ${Math.round(c.miles)} mi away${c.age ? ` · updated ${esc(c.age)}` : ''}${blocks.has(c.place) ? ` · Blocks ${esc(blocks.get(c.place).join(', '))}` : ''}</div></span></div>`).join('')}</div>` : '<div class="page"><p>None listed within 40 miles right now.</p></div>'}`;
}
function settingsScreen() {
  return `<div class="page">
    <label class="field">Where you go in town, e.g. work (blank = stop at I-10)
      <input id="dest" type="text" autocomplete="off" placeholder="Address" value="${esc(store.get('dest') ?? '')}">
    </label>
    <label class="field">USGS key (optional; free at api.waterdata.usgs.gov/signup)
      <input id="apikey" type="password" autocomplete="off" placeholder="Paste key" value="${esc(store.get('apiKey') ?? '')}">
    </label>
    <p class="fine" style="text-align:left;margin:0">Saved only on this phone.</p>
  </div>`;
}
// Any minute of the day, as HH:MM.
function snapTime(t) {
  const m = /^(\d{1,2}):(\d{2})/.exec(t || '');
  return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? `${m[1].padStart(2, '0')}:${m[2]}` : null;
}
// Days: "w:1,2,3,4,5" (weekdays, 1 = Monday) or "m:1,15" (dates of the month).
const DAY_NAMES = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const daysKind = (d) => (String(d).startsWith('m:') ? 'm' : 'w');
const daysList = (d) => (/^[wm]:/.test(d) ? d.slice(2).split(',').map(Number).filter(Boolean) : d === 'all' ? [1, 2, 3, 4, 5, 6, 7] : [1, 2, 3, 4, 5]);
const daysOptions = (d) => (daysKind(d) === 'w'
  ? [1, 2, 3, 4, 5, 6, 7].map((n) => `<option value="${n}" ${daysList(d).includes(n) ? 'selected' : ''}>${DAY_NAMES[n]}</option>`).join('')
  : Array.from({ length: 31 }, (_, i) => i + 1).map((n) => `<option value="${n}" ${daysList(d).includes(n) ? 'selected' : ''}>${n}</option>`).join(''));
function daysSummary(d) {
  const l = daysList(d);
  const ord = (n) => n + (n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th');
  const and = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : xs[0]);
  if (daysKind(d) === 'm') return l.length ? `the ${and(l.map(ord))} of each month` : 'none picked';
  if (l.join() === '1,2,3,4,5') return 'weekdays';
  if (l.length === 7) return 'every day';
  return l.map((n) => DAY_NAMES[n].slice(0, 3)).join(', ') || 'none picked';
}
function pushTopic() {
  let t = store.get('pushTopic');
  if (!t) {
    const r = new Uint8Array(8); crypto.getRandomValues(r);
    t = `washwatch-${Array.from(r, (b) => (b % 36).toString(36)).join('')}`;
    store.set('pushTopic', t);
  }
  return t;
}
const clock = (t) => new Date(`2000-01-01T${t}:00`).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
let textFlow = { step: 'start', phone: '', msg: '' };

function alertsScreen() {
  const a = { times: ['05:45'], days: 'w:1,2,3,4,5', mode: 'all', ...(store.get('alerts') ?? {}) };
  const timeRows = a.times.map((t, i) => `
    <div class="time-row">
      <input type="time" data-ti="${i}" value="${t}" aria-label="Alert time ${i + 1}">
      ${a.times.length > 1 ? `<button type="button" class="btn btn-text small" data-rm="${i}" aria-label="Remove">Remove</button>` : ''}
    </div>`).join('');
  const textCard = !cfg.TEXT_API
    ? '<p class="fine" style="text-align:left;margin:0">Text sign-up is being connected. Use the free phone notification below until then.</p>'
    : textFlow.step === 'confirm'
      ? `<label class="field">Code we texted to ${esc(textFlow.phone)}<input id="t-code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="4"></label>
         <button type="button" class="btn btn-primary" id="t-confirm">Start texts</button>`
      : textFlow.step === 'done'
        ? `<p>Texts are on for ${esc(textFlow.phone)}. A confirmation text is on its way.</p>`
        : `<label class="field">${textFlow.sender === 'any' ? 'Mobile number' : 'Mobile number on Verizon’s towers'}<input id="t-phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="520 555 0123" value="${esc(textFlow.phone)}"></label>
           <label class="field">Access key (optional, for more than 2 texts a day)<input id="t-key" type="text" autocomplete="off" value="${esc(textFlow.key ?? '')}"></label>
           <p class="consent">By tapping <b>Text me a code</b>, you agree to get recurring FLOODplain road-flooding texts: one text at each time you pick, at most 4 msgs/day, plus a one-time sign-up code. Msg &amp; data rates may apply. Reply STOP to cancel, HELP for help. No marketing; your number is never shared. <a href="#/privacy">Privacy &amp; terms</a></p>
           <button type="button" class="btn btn-primary" id="t-signup">Text me a code</button>
           <button type="button" class="btn btn-text" id="t-stop">Stop texts for this number</button>`;
  return `<div class="page">
    <h4>When</h4>
    ${timeRows}
    ${a.times.length < 4 ? '<button type="button" class="btn btn-text" id="add-time">+ Add another time</button>' : ''}
    <label class="field">Repeat on
      <select id="a-rep"><option value="w" ${daysKind(a.days) === 'w' ? 'selected' : ''}>Days of the week</option><option value="m" ${daysKind(a.days) === 'm' ? 'selected' : ''}>Days of the month</option></select>
    </label>
    <label class="field">${daysKind(a.days) === 'w' ? 'Days' : 'Dates'} <small>(${esc(daysSummary(a.days))})</small>
      <select id="a-dsel" multiple size="${daysKind(a.days) === 'w' ? 7 : 8}">${daysOptions(a.days)}</select>
    </label>
    <label class="field">Send it
      <select id="a-mode"><option value="all" ${a.mode === 'all' ? 'selected' : ''}>Every time</option><option value="off" ${a.mode === 'off' ? 'selected' : ''}>Only when something's off (any route 2 or higher)</option></select>
    </label>
    <p class="fine" style="text-align:left;margin:0">Arizona time.</p>
  </div>
  <p class="fine" style="text-align:left;margin:12px 4px 0">These alerts are for <b>${esc(areaInfo().name)}</b> routes. Switch area on the home screen to sign up for the other.</p>
  <h3 class="section">Push notification (any phone, free)</h3>
  <div class="page">
    ${textFlow.pushMsg ? `<p class="note">${esc(textFlow.pushMsg)}</p>` : ''}
    ${store.get('pushOn')
      ? `<p><b>Push alerts are on for this phone:</b> ${a.times.map(clock).join(' & ')}, ${esc(daysSummary(a.days))}. Changes above save by themselves.</p>
         <label class="check"><input type="checkbox" id="a-instant"${a.instant ? ' checked' : ''}> Also tell me right away when a road closes or reopens on this area's routes</label>
         <button type="button" class="btn btn-primary" id="p-test">Send a test alert now</button>
         <a class="btn btn-text" href="ntfy://ntfy.sh/${pushTopic()}">Open my channel in ntfy again</a>
         <button type="button" class="btn btn-text" id="p-stop">Turn off push alerts</button>`
      : `<p>Needs the free <b>ntfy</b> app (<a href="https://play.google.com/store/apps/details?id=io.heckel.ntfy" target="_blank" rel="noopener">Android</a> · <a href="https://apps.apple.com/us/app/ntfy/id1625396347" target="_blank" rel="noopener">iPhone</a>). Pick your times and days above, then:</p>
         <a class="btn btn-primary" id="p-on" href="ntfy://ntfy.sh/${pushTopic()}">Turn on push alerts</a>
         <p class="fine" style="text-align:left">One tap saves your schedule and opens ntfy. Tap <b>Subscribe</b> there and you're done.</p>`}
  </div>
  <h3 class="section">Text message</h3>
  <div class="page">
    <p class="note">${textFlow.sender === 'any'
      ? '<b>Texts are on</b> for any US mobile number.'
      : textFlow.sender === 'verizon'
        ? '<b>Texts are in beta.</b> Right now they only reach phones on <b>Verizon’s towers</b>. Other carriers: coming once our text sender is approved. Until then, use push alerts above. They work on any phone.'
        : 'Checking whether texts are available…'}</p>
    ${textFlow.sender === 'verizon' ? `<details class="beta-phones">
      <summary>Whose phones work in beta?</summary>
      <p><b>Tested and working:</b> Xfinity Mobile.</p>
      <p><b>Should work, not tested yet:</b> Verizon, Visible, Spectrum Mobile, Total Wireless.</p>
      <p><b>Depends on your SIM:</b> Straight Talk, Tracfone, US Mobile and others that use more than one network. They need to be on Verizon’s towers.</p>
      <p><b>Not yet:</b> AT&amp;T, T-Mobile, Metro, Cricket, Boost.</p>
      <p>To check yours, tap <b>Text me a code</b>. If the code arrives, your phone works.</p>
    </details>` : ''}
    ${textFlow.msg ? `<p class="note">${esc(textFlow.msg)}</p>` : ''}
    ${textCard}
  </div>
  ${cfg.TEXT_API && textFlow.sender === 'verizon' ? `<h3 class="section">Not on Verizon’s towers? Join the text waitlist</h3>
  <div class="page">
    ${textFlow.waitMsg ? `<p class="note">${esc(textFlow.waitMsg)}</p>` : ''}
    ${textFlow.waitDone ? '' : `<p>Leave your number and we'll send <b>one text</b> when texts work on every carrier. Then you sign up here like anyone else.</p>
    <label class="field">Mobile number<input id="w-phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="520 555 0123"></label>
    <p class="consent">By tapping <b>Join the waitlist</b>, you agree to get one FLOODplain text when texts open to all carriers. No other texts unless you sign up. Msg &amp; data rates may apply. Your number is never shared. <a href="#/privacy">Privacy &amp; terms</a></p>
    <button type="button" class="btn btn-primary" id="w-join">Join the waitlist</button>`}
  </div>` : ''}
  ${cfg.TEXT_API ? `<h3 class="section">Need more texts?</h3>
  <div class="page">
    ${textFlow.reqMsg ? `<p class="note">${esc(textFlow.reqMsg)}</p>` : ''}
    <p>Without a key, texts are limited to 2 a day. Ask the person who runs FLOODplain for an access key:</p>
    <label class="field">How to reach you<input id="r-contact" type="text" autocomplete="off" placeholder="Name, phone or email"></label>
    <label class="field">Message<textarea id="r-msg" rows="3" placeholder="How many texts a day, and why"></textarea></label>
    <button type="button" class="btn btn-primary" id="r-send">Send request</button>
  </div>` : ''}
`;
}

async function textApi(body) {
  const r = await fetch(cfg.TEXT_API, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'text/plain;charset=utf-8' } });
  return r.json();
}
function wireAlerts() {
  // Wakes the alert service (it starts its own every-minute timer on first contact).
  // Ask the alert service how it sends texts ('any' = Twilio, 'verizon' = Verizon only). This also
  // wakes it (it starts its own every-minute timer on first contact).
  if (cfg.TEXT_API && !wireAlerts.pinged) {
    wireAlerts.pinged = true;
    fetch(cfg.TEXT_API).then((r) => r.json()).then((j) => { textFlow.sender = j.sender; if (where().screen === 'alerts') render(); })
      .catch(() => { textFlow.sender = 'verizon'; if (where().screen === 'alerts') render(); });
  }
  const a = { times: ['05:45'], days: 'w:1,2,3,4,5', mode: 'all', ...(store.get('alerts') ?? {}) };
  // Save the push schedule to the alert service. keepalive lets it finish even
  // while the page hands off to the ntfy app.
  const savePush = () => fetch(cfg.TEXT_API, { method: 'POST', keepalive: true, headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'push', topic: pushTopic(), area, times: a.times, days: a.days, mode: a.mode, instant: a.instant === true }) }).catch(() => {});
  const save = () => { store.set('alerts', a); if (store.get('pushOn') && cfg.TEXT_API) savePush(); render(); };
  document.querySelectorAll('input[data-ti]').forEach((el) => el.addEventListener('change', () => {
    const t = snapTime(el.value);
    if (t) { a.times[Number(el.dataset.ti)] = t; a.times = [...new Set(a.times)].sort(); }
    save();
  }));
  document.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => { a.times.splice(Number(b.dataset.rm), 1); save(); }));
  $('#add-time')?.addEventListener('click', () => { a.times.push(snapTime('16:15')); a.times = [...new Set(a.times)].sort(); save(); });
  $('#a-rep')?.addEventListener('change', (e) => { a.days = e.target.value === 'm' ? 'm:1' : 'w:1,2,3,4,5'; save(); });
  $('#a-dsel')?.addEventListener('change', (e) => {
    const picked = Array.from(e.target.selectedOptions, (o) => Number(o.value));
    if (picked.length) { a.days = `${daysKind(a.days)}:${picked.join(',')}`; save(); }
  });
  // One tap: save the schedule, then the link itself opens ntfy on this phone's channel.
  $('#p-on')?.addEventListener('click', () => {
    if (!cfg.TEXT_API) return;
    store.set('alerts', a);
    savePush();
    store.set('pushOn', true);
    textFlow.pushMsg = `Push alerts on: ${a.times.map(clock).join(' & ')}, ${daysSummary(a.days)}. Tap Subscribe in ntfy if it asks.`;
    setTimeout(render, 300);
  });
  // Test: send this area's current verdict to this phone's channel right now.
  $('#p-test')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget; btn.disabled = true;
    const { best, order } = view.rec;
    const word = { 1: 'Low', 2: 'Minor', 3: 'Moderate', 4: 'High', 5: 'Severe' };
    const nm = (r) => ROUTE_INFO[r.id].name;
    const body = `Test alert. Right now: take ${nm(best)} (${best.score}/5 ${word[Math.floor(best.score)]}, ${Math.round(best.minutes)} min). `
      + `Others: ${order.filter((r) => r !== best).map((r) => `${nm(r)} ${r.score}`).join(', ')}. Your real alerts come at ${a.times.map(clock).join(' & ')}, ${daysSummary(a.days)}.`;
    try {
      const r = await fetch(`https://ntfy.sh/${pushTopic()}`, { method: 'POST', body, headers: { Title: `FLOODplain test (${areaInfo().name})`, Tags: 'droplet', Click: location.origin + location.pathname } });
      textFlow.pushMsg = r.ok ? 'Test sent. It should pop up on your phone within a few seconds.' : 'The notification service didn’t accept it. Try again in a minute.';
    } catch { textFlow.pushMsg = 'Couldn’t reach the notification service. Check your connection.'; }
    render();
  });
  $('#p-stop')?.addEventListener('click', async () => {
    try { await textApi({ action: 'pushstop', topic: pushTopic() }); store.set('pushOn', false); textFlow.pushMsg = 'Push alerts are off for this phone.'; } catch { textFlow.pushMsg = 'Couldn’t reach the alert service. Try again in a minute.'; }
    render();
  });
  $('#a-mode')?.addEventListener('change', (e) => { a.mode = e.target.value; save(); });
  $('#a-instant')?.addEventListener('change', (e) => { a.instant = e.target.checked; save(); });
  const run = async (body, next) => {
    textFlow.msg = 'Working…'; render();
    try {
      const r = await textApi(body);
      textFlow = r.ok ? { ...textFlow, step: next, msg: '' } : { ...textFlow, msg: r.error || 'Something went wrong.' };
    } catch { textFlow.msg = 'Couldn’t reach the text service. Try again in a minute.'; }
    render();
  };
  $('#t-signup')?.addEventListener('click', () => {
    textFlow.phone = $('#t-phone').value.trim(); textFlow.key = $('#t-key')?.value.trim() ?? '';
    run({ action: 'signup', phone: textFlow.phone, area, key: textFlow.key, times: a.times, days: a.days, mode: a.mode }, 'confirm');
  });
  $('#r-send')?.addEventListener('click', async () => {
    try {
      const r = await textApi({ action: 'request', contact: $('#r-contact').value, message: $('#r-msg').value });
      textFlow.reqMsg = r.ok ? 'Sent. You’ll hear back directly.' : (r.error || 'Something went wrong.');
    } catch { textFlow.reqMsg = 'Couldn’t reach the text service. Try again in a minute.'; }
    render();
  });
  $('#w-join')?.addEventListener('click', async () => {
    const phone = $('#w-phone').value.trim();
    try {
      const r = await textApi({ action: 'waitlist', phone, area });
      textFlow.waitMsg = r.ok ? `You're on the waitlist (${phone}). One text when texts work on every carrier.` : (r.error || 'Something went wrong.');
      textFlow.waitDone = !!r.ok;
    } catch { textFlow.waitMsg = 'Couldn’t reach the text service. Try again in a minute.'; }
    render();
  });
  $('#t-stop')?.addEventListener('click', () => { textFlow.phone = $('#t-phone').value.trim(); run({ action: 'stop', phone: textFlow.phone }, 'start').then(() => { textFlow.msg = 'If that number was signed up, its texts are stopped.'; render(); }); });
  $('#t-confirm')?.addEventListener('click', () => run({ action: 'confirm', phone: textFlow.phone, code: $('#t-code').value.trim() }, 'done'));
}

function wireReport() {
  $('#rp-fp')?.addEventListener('change', (e) => { reportMsg = ''; location.replace(`#/report/${e.target.value}`); });
  $('#rp-send')?.addEventListener('click', async () => {
    const fpId = $('#rp-fp').value;
    if (!fpId) { reportMsg = 'Pick a crossing first.'; render(); return; }
    const fp = FAILURE_POINTS.find((f) => f.id === fpId);
    const answers = Object.fromEntries(Array.from(document.querySelectorAll('select[data-q]')).filter((x) => x.value).map((x) => [x.dataset.q, x.value]));
    const report = { fp: fpId, crossing: fp ? fp.short : ($('#rp-where')?.value || 'not on the list'), area, answers, lastSeen: $('#rp-date').value, note: $('#rp-note').value.slice(0, 1500) };
    if (!Object.keys(answers).length && !report.note) { reportMsg = 'Answer at least one question.'; render(); return; }
    try {
      if (cfg.TEXT_API) {
        const r = await textApi({ action: 'report', ...report });
        if (!r.ok) throw new Error(r.error);
      } else {
        const body = [`${report.crossing} (${areaInfo().name})`, ...cfg.REPORT_QUESTIONS.filter((q) => answers[q.id]).map((q) => `${q.q} ${answers[q.id]}`),
          report.lastSeen && `Last saw water: ${report.lastSeen}`, report.note && `Note: ${report.note}`].filter(Boolean).join('\n');
        const r = await fetch(`https://ntfy.sh/${cfg.REPORT_TOPIC}`, { method: 'POST', body, headers: { Title: `Crossing report: ${report.crossing}` } });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
      }
      reportMsg = "Thanks! Sent. It goes straight to the person who runs FLOODplain.";
      location.replace('#/report');
    } catch (e) { reportMsg = 'Couldn’t send just now. Try again in a minute.'; }
    render();
  });
}

// Newest first. Add a line here whenever something people can notice changes.
const UPDATES = [
  ['November 11, 2026', [
    'Share this check: the home screen has a button that sends the current rating, in the same words as the text alerts, to anyone you pick.',
    'On phones the top bar is one row, so the rating sits higher on the screen. Feed problems are listed once, in the box under it.',
    'The Map tab\'s route list gives distances in miles.',
  ]],
  ['November 5, 2026', [
    'Back: SFINCS road flood forecast on every route. The hourly SFINCS run is compared with the lidar road surface along the whole route, not only the listed crossings. When it shows water over a road during the forecast hours, that route\'s number goes up and the route screen says where, how deep and when. It can raise a number but never lower one.',
    'The Map tab lists every route with water over the road at the hour shown, for the live run and the saved runs.',
    'Texts and push alerts use the SFINCS road forecast too, so they give the same number as the app.',
  ]],
  ['November 1, 2026', [
    'New: accessible colors on every map icon, visible Back and Refresh labels, a 3-step guide, heights in feet, and coverage and gauge tracking for every location on a route.',
    'New: Road closures list, one-tap driver reports, instant closure alerts you can turn on, and the app now opens with the last check when there is no signal.',
    'Fixed: road closures now show at the top of the screen and on the map, and a closed route no longer offers directions.',
    'New: closures and utility work from TransView are checked against each route line. County barricades count only on the part of a road the route uses.',
    'Changed: a county closure anywhere along a route now counts, not only near a listed crossing. Proceed with Caution alone is now a 2, and distant gauges no longer raise it; a live sign at the road brings it back to a 3 or more. Where we know the road height, the flood model is compared with the road itself.',
    'New: I-10 underpasses at Marana, Orange Grove, Grant and Speedway. Each gets the usual 1 to 5 number from nearby rain gauges, county closures and flood alerts. We have not found a public water sensor in any of them.',
    'New: the HAND flood model. Where NOAA\'s stream data matches a crossing, you can see how high forecast flow is estimated to reach, with a map of the estimated area. It\'s an estimate, not a reading.',
    'HAND adds to the number your other sources gave: 1 point on the Santa Cruz, half a point on washes, so you may see a number like 1.5. It never lowers a number, and it doesn\'t change a crossing where a river gauge is reporting.',
    'Texts and push alerts don\'t use HAND yet, so they can show a different number than the app.',
    'Saved routes: keep your favorites on this phone.',
    'The app now shows when it last checked, and it recovers better when one gauge or source stops answering.',
    'What\'s new: this page.',
  ]],
  ['October 31, 2026', [
    'Text alerts are in beta and reach phones on Verizon\'s towers. Everyone else can join the waitlist or use free push alerts.',
    'Fixed gaps in county closure coverage and stuck data feeds.',
    'Picture Rocks routes, custom alert times and days, the Help fill the gaps form, and the FLOODplain name.',
  ]],
];

function underpassesScreen() {
  return `<p class="note"><b>We haven't found a public water sensor in any of these underpasses.</b> The number comes from the nearest county rain gauges, county closures and National Weather Service flood alerts. Water can pool from a storm the gauges miss, and a 1 doesn't confirm the underpass is clear. County closures may not include city, Marana or ADOT roads. Water over the road: turn around.</p>
  ${view.underpasses.map(({ short, name, where: place, lat, lon, result }) => `<h3 class="section">${esc(short)}</h3>
  <div class="summary">${badgeWithWord(riskScore(result))}<div><p>${esc(LEVEL_SENTENCE[result.level])}</p><p class="where">${esc(name)}, ${esc(place)}.</p></div></div>
  <div class="list">${result.checks.map((c) => { const [icon, label] = SRC[c.src] ?? ['•', c.src]; return `<div class="row"><span class="lead-icon">${icon}</span><span class="text"><div class="t">${label}</div><div class="st" style="white-space:normal"><span class="dot ${c.level}" style="display:inline-block;margin-right:6px"></span>${esc(c.why)}</div>${c.detail ? `<div class="st" style="white-space:normal">${esc(c.detail)}</div>` : ''}</span></div>`; }).join('')}</div>
  <a class="btn btn-text" href="https://www.google.com/maps/search/?api=1&query=${lat},${lon}" target="_blank" rel="noopener">Open in Google Maps</a>`).join('')}
  <a class="btn btn-text" href="https://az511.gov/map" target="_blank" rel="noopener">State road conditions and cameras (AZ 511)</a>`;
}

function updatesScreen() {
  return UPDATES.map(([date, items]) => `<h3 class="section">${esc(date)}</h3>
  <div class="page"><ul>${items.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>`).join('');
}

function privacyScreen() {
  return `<div class="page">
    <h4>What you get</h4>
    <p>FLOODplain is a free, non-commercial road-flooding guide for Avra Valley, AZ. If you sign up for texts, you get a short message with the current flood risk for the routes between Avra Valley and I-10, one text at each time you choose, at most 4 texts a day, plus a one-time sign-up code. No marketing.</p>
    <h4>Signing up and stopping</h4>
    <p>You sign up on the Alerts page and confirm with a 4-digit code we text you. To stop, reply <b>STOP</b> to any message or use <b>Stop texts</b> on the Alerts page. Reply <b>HELP</b> for help. Message and data rates may apply. Carriers aren't liable for delayed or undelivered messages.</p>
    <h4>Your information</h4>
    <p>We keep only your phone number, the times and days you chose, and when we last texted you. It's stored privately by the person who runs FLOODplain and used only to send these texts. It's never sold, shared or used for marketing. Stopping texts deletes your number.</p>
    <h4>Error reports</h4>
    <p>When the app hits an error, a download fails or the page freezes, it sends a short report so the problem can be fixed: the kind of device and browser, the screen size, what was tapped just before, and the error. It never includes your location, phone number or anything you typed. Reports go to a public notification channel, so nothing private is ever put in them.</p>
    <h4>Text waitlist</h4>
    <p>If you join the waitlist, we keep your number and the date you joined, and send you exactly one text when texts work on every carrier. Nothing else unless you then sign up. To leave the waitlist, use <b>Stop texts for this number</b> on the Alerts page.</p>
    <h4>No guarantee</h4>
    <p>Ratings come from public, provisional data (USGS, Pima County, National Weather Service) and can be late or wrong. What you see at the crossing comes first. Never drive into water crossing the road.</p>
    <h4>Contact</h4>
    <p>Reply HELP to any FLOODplain text to reach the person who runs it.</p>
  </div>`;
}
function sourcesScreen() {
  return `<div class="page"><h4>Where the readings come from</h4>
    <p>These are regional gauges, not sensors at every crossing. Brawley Wash drains into Los Robles, but upstream flow does not tell us the water depth or arrival time at the Los Robles crossing on Trico Road.</p>
    <p>County rain is reported in inches and stream flow in cubic feet per second (cfs). A sensor may report only every 12 hours when nothing changes; an older reading does not by itself mean the sensor has failed.</p>
    <p><a href="https://www.pima.gov/about-alert-system-sensor-data" target="_blank" rel="noopener">County sensor units and reporting</a></p></div>
    <div class="list">${LINKS.map(([t, u]) => `<a class="row small" href="${u}" target="_blank" rel="noopener"><span class="text"><div class="t">${esc(t)}</div></span><span class="chev">↗</span></a>`).join('')}</div>
    <p class="fine">River gauges: USGS. Rain and stream sensors: Pima County Regional Flood Control District. Barricades: Pima County DOT. Alerts: National Weather Service. Roads © OpenStreetMap contributors. All provisional.</p>`;
}

// ---------------- render ----------------
function render() {
  if (!view) return;
  const linkedArea = routeAreaForHash(location.hash, allRoutes);
  if (linkedArea && linkedArea !== area) {
    useArea(linkedArea);
    mapRoute = null;
    mapCrossing = null;
    mapCameraSet = false;
    view = compute(data);
  }
  const w = where();
  const sub = w.screen !== 'home';
  $('.appbar').classList.toggle('sub', sub);
  $('#back').hidden = !sub;
  $('#logo').hidden = sub;
  $('#refresh').hidden = sub && !['route', 'stretch'].includes(w.screen);
  const titles = {
    home: ["FLOODplain", subtitle()], map: ['Flood map', 'Live readings, model estimates and simulated water'],
    route: [ROUTE_INFO[w.route]?.name, 'Route'],
    stretch: [view.fpResults[w.fp]?.short, ROUTE_INFO[w.route]?.name],
    closures: ['Road closures', 'Closed and caution points'], how: ['How to read this', ''], settings: ['Settings', ''], sources: ['Sources', ''], alerts: ['Alerts', 'Text or phone notification'], report: ['Help fill the gaps', 'Tell us about a crossing'], privacy: ['Privacy & terms', "FLOODplain texts"], updates: ["What's new", ''], underpasses: ['I-10 underpasses', 'Rain nearby, not a reading from the underpass'],
  }[w.screen];
  $('#title').textContent = titles[0] ?? '';
  $('#subtitle').textContent = titles[1] ?? '';
  $('#map').hidden = ['closures', 'how', 'settings', 'sources', 'alerts', 'privacy', 'report', 'updates', 'underpasses'].includes(w.screen);
  window.dispatchEvent(new Event('flood-before-screen-render'));
  $('#screen').innerHTML = plainWords({
    map: () => '', home: homeScreen, route: () => routeScreen(w.route), stretch: () => stretchScreen(w.route, w.fp),
    closures: closuresScreen, how: howScreen, settings: settingsScreen, sources: sourcesScreen, alerts: alertsScreen, privacy: privacyScreen, updates: updatesScreen, underpasses: underpassesScreen, report: () => reportScreen(w.fp),
  }[w.screen](), Date.now());
  if (['home', 'route', 'stretch'].includes(w.screen)) {
    const status = document.createElement('aside');
    status.className = 'check-status';
    status.innerHTML = '<strong id="check-age"></strong><p>Check time is not the age of every reading. Open a crossing for source details.</p>' + (data.errors.length ? `<p>${esc(data.errors.join('; '))}.</p>` : '');
    $('#screen').prepend(status);
    updateCheckAge();
  }
  wire(w);
  if (['route', 'stretch'].includes(w.screen)) {
    const tracking = document.createElement('section');
    tracking.setAttribute('aria-label', 'Route coverage and gauge tracking');
    const bottom = $('#screen .bottom-bar');
    if (bottom) bottom.before(tracking); else $('#screen').append(tracking);
    mountRouteTracking(tracking, { routeId: w.route, entryId: w.screen === 'stretch' ? w.fp : null, flows: data.flows, alert: data.alert, closures: data.closures });
  }
  drawMap(w);
  liveMap.update({active:w.screen==='map',data,view});
  window.dispatchEvent(new Event('flood-screen-rendered'));
}
function subtitle() {
  const t = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return `${areaInfo().name} ↔ I-10 · ${t(data.now)}`;
}
function updateCheckAge() {
  const el = $('#check-age');
  if (el && data) el.textContent = checkAge(data.now, Date.now(), navigator.onLine);
}
function wire(w) {
  document.querySelectorAll('.bridge-evidence > summary').forEach(summary=>summary.addEventListener('click',event=>{
    if(!matchMedia('(min-width: 900px)').matches)return;
    event.preventDefault();
    const dialog=document.createElement('dialog');
    dialog.className='bridge-evidence-dialog';
    dialog.setAttribute('aria-label','Bridge sources and warning levels');
    dialog.innerHTML='<header><h2>Bridge sources &amp; warning levels</h2><button type="button" aria-label="Close bridge details">&times;</button></header><div class="bridge-evidence-body">'+summary.parentElement.querySelector('.bridge-evidence-body').innerHTML+'</div>';
    document.body.append(dialog);
    dialog.querySelector('button').addEventListener('click',()=>dialog.close());
    dialog.addEventListener('close',()=>{dialog.remove();summary.focus();});
    dialog.showModal();
  }));
  document.querySelectorAll('[data-save-route]').forEach((b) => b.addEventListener('click', () => {
    favorites = toggleSavedRoute(favorites, b.dataset.saveRoute, Object.keys(ROUTE_INFO));
    try {
      localStorage.setItem('savedRoutes', JSON.stringify(favorites));
      saveNotice = favorites.includes(b.dataset.saveRoute) ? 'Saved on this browser. Find it on the home screen.' : 'Removed from your saved routes.';
    } catch { saveNotice = 'This change applies to this visit only. Browser storage is unavailable.'; }
    b.setAttribute('aria-pressed', String(favorites.includes(b.dataset.saveRoute)));
    b.textContent = favorites.includes(b.dataset.saveRoute) ? 'Saved route' : 'Save route';
    $('#save-notice').textContent = saveNotice;
  }));
  document.querySelectorAll('[data-area]').forEach((b) => b.addEventListener('click', () => {
    useArea(b.dataset.area);
    view = compute(data);
    render();
  }));
  document.querySelectorAll('details.src').forEach((d) => d.addEventListener('toggle', () => {
    const i = Number(d.dataset.i);
    if (d.open) {
      document.querySelectorAll('details.src[open]').forEach((o) => { if (o !== d) o.open = false; });
      openSource = i;
    } else if (openSource === i) openSource = null;
    drawMap(where());
  }));
  document.querySelectorAll('[data-share]').forEach((b) => b.addEventListener('click', async () => { const said = await shareCheck(shareText(view, data, area)); const note = $('#share-notice'); if (note) note.textContent = said; }));
  document.querySelectorAll('[data-nav]').forEach((b) => b.addEventListener('click', () => navigate(b.dataset.nav)));
  if (w.screen === 'alerts') wireAlerts();
  if (w.screen === 'stretch') wireDrive(w.fp);
  if (w.screen === 'report') wireReport();
  for (const [id, key] of [['#apikey', 'apiKey'], ['#dest', 'dest']]) {
    const el = $(id);
    if (el) el.addEventListener('change', (e) => { store.set(key, e.target.value.trim() || null); if (key === 'apiKey') check(); });
  }
  void w;
}

// ---------------- map ----------------
const map = L.map('map', { zoomSnap: 0.25, zoomControl: false, attributionControl: true });
// Base maps: the street map painted from OpenFreeMap vector tiles in the 3D map's look, the
// plain OpenStreetMap tiles, and satellite. If the painted tiles stop answering, OpenStreetMap
// takes the street map's place.
const osmTiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© OpenStreetMap' });
const baseMaps = createStreetMap(L, map, { onUnavailable: () => {
  if (map.hasLayer(baseMaps.street)) { map.removeLayer(baseMaps.street); map.addLayer(osmTiles); map.removeLayer(baseMaps.names); }
  baseMaps.street = osmTiles;
} });
baseMaps.osm = osmTiles;
baseMaps.street.addTo(map);
baseMaps.names.addTo(map);
map.attributionControl.setPrefix(false);
const layer = L.layerGroup().addTo(map);
const liveObservations=L.layerGroup().addTo(map);
const rendererRoutes=L.layerGroup([layer,liveObservations]).addTo(map);
mountFloodLayers(map,{routeLayer:rendererRoutes,baseMaps});
document.querySelector('[data-home]').onclick=()=>map.fitBounds(allBounds,{paddingTopLeft:[24,30],paddingBottomRight:[24,30],animate:false});
const liveMap=mountLiveMap(map,{refresh:()=>check(),observations:liveObservations,embedded:true});
// The Map tab in a maps-app layout, with the 2D and 3D model layers (map-app.js).
const mapApp=mountMapApp({L,map,baseMaps,routeLayer:layer,liveLayer:liveObservations,roadForecast:()=>data?.sfincs,
  fitRoutes:(opts)=>allBounds&&map.fitBounds(allBounds,opts),
  targets:()=>[...FAILURE_POINTS.map((fp)=>({kind:'crossing',id:fp.id,name:fp.short??fp.name,lat:fp.lat,lon:fp.lon})),...PLACES.map((p)=>({kind:'place',name:p.name,lat:p.lat,lon:p.lon}))],
  openCrossing:(id)=>{mapCrossing=id;drawMap(where());revealCrossing();},points:FAILURE_POINTS});
let allBounds;
const lineCoords = (g) => (g.type === 'LineString' ? [g.coordinates] : g.coordinates);
function stretchAround(coords, lat, lon, m) {
  const runs = [];
  let cur = [];
  for (const [x, y] of coords) {
    if (Math.hypot((x - lon) * 94_000, (y - lat) * 111_000) <= m) cur.push([y, x]);
    else if (cur.length) { runs.push(cur); cur = []; }
  }
  if (cur.length) runs.push(cur);
  return runs.filter((r) => r.length > 1);
}
let mapCameraSet=false;
// The Map tab's own choice of route and crossing, as on the 3D map page's routes panel.
let mapRoute = null, mapCrossing = null;
function renderMapRoutes() {
  const root = $('[data-map-routes]');
  if (!root || !view) return;
  const fp = mapCrossing && FAILURE_POINTS.find((x) => x.id === mapCrossing);
  if (fp) {
    const routeId = fp.routes.includes(mapRoute) ? mapRoute : fp.routes.find((rid) => view.byId[rid]) ?? fp.routes[0];
    root.innerHTML = `<div class="crossing-view">${crossingCardHtml({ fp, result: view.fpResults[fp.id], score: pointScore(view.fpResults[fp.id]), routeId, sources: SRC, sentence: LEVEL_SENTENCE })}</div>`;
    root.querySelector('[data-map-close]').addEventListener('click', () => { mapCrossing = null; drawMap(where()); });
    return;
  }
  root.innerHTML = routeRowsHtml({ areas: AREAS, area, routes: view.rated, info: ROUTE_INFO, features: routeFeatures, crossings: FAILURE_POINTS, selected: mapRoute, issue: topIssue });
  root.querySelectorAll('[data-map-area]').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.mapArea === area) return;
    mapRoute = null; useArea(b.dataset.mapArea); view = compute(data); mapCameraSet = false; render();
  }));
  root.querySelectorAll('[data-map-route]').forEach((b) => b.addEventListener('click', () => {
    mapRoute = mapRoute === b.dataset.mapRoute ? null : b.dataset.mapRoute;
    drawMap(where());
    const f = routeFeatures.find((x) => x.properties.id === mapRoute);
    map.fitBounds(f ? L.geoJSON(f).getBounds() : allBounds, { paddingTopLeft: [24, 30], paddingBottomRight: [24, 30] });
  }));
}
// The crossing card sits beside the map, or under it on a phone: bring it into view.
function revealCrossing() {
  mapApp.reveal();
  const card = $('[data-map-routes]'), side = card?.closest('.mapp-panel-body') ?? $('.map-side');
  if (!card || !side) return;
  if (!side.classList.contains('mapp-panel-body') && matchMedia('(max-width: 899px)').matches) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  else side.scrollTo({ top: card.offsetTop - side.offsetTop - 16, behavior: 'smooth' });
}
function drawMap(w) {
  if ($('#map').hidden) return;
  map.invalidateSize();
  layer.clearLayers();
  const onMap = w.screen === 'map';
  if (!onMap) mapCrossing = null;
  if (mapRoute && !routeFeatures.some((f) => f.properties.id === mapRoute)) mapRoute = null;
  // Routes in blue as on the 3D map: the chosen one darker and wider, the rest lighter beside it.
  const focus = onMap ? mapRoute : w.route ?? view.rec.best.id;
  for (const f of [...routeFeatures].sort((a, b) => (a.properties.id === focus) - (b.properties.id === focus))) {
    const on = f.properties.id === focus;
    L.geoJSON(f, { style: { color: on ? '#0b5cad' : focus ? '#8fb1d6' : '#2f76c4', weight: on ? 6 : 4, opacity: 0.9, lineCap: 'round', lineJoin: 'round' }, interactive: false }).addTo(layer);
  }
  // The fixed places: valley hub and the two I-10 exits.
  for (const pl of PLACES.filter((x) => (x.area ?? 'avra') === area)) {
    L.marker([pl.lat, pl.lon], { icon: L.divIcon({ className: 'place-pin', html: `<span class="place ${pl.side ?? 'right'}">${esc(pl.name)}</span>`, iconSize: [0, 0] }), interactive: false }).addTo(layer);
  }
  // Keep every mapped junction in the selected area visible across route views.
  const inArea = new Set(routeFeatures.map((f) => f.properties.id));
  const visible = FAILURE_POINTS.filter(fp => fp.routes.some(rid => inArea.has(rid)));
  for (const fp of visible) {
    const s = pointScore(view.fpResults[fp.id]);
    for (const rid of fp.routes.filter((x) => inArea.has(x))) {
      for (const line of lineCoords(routeFeatures.find((f) => f.properties.id === rid).geometry)) {
        for (const run of stretchAround(line, fp.lat, fp.lon, fp.kind === 'road' ? 2500 : 450)) {
          // A white edge keeps the rating colour apart from the blue route under it.
          L.polyline(run, { color: '#fff', weight: (rid === focus ? 9 : 5) + 3, opacity: 0.9, lineCap: 'round', interactive: false }).addTo(layer);
          L.polyline(run, { color: COLOR[Math.floor(s)] ?? UNKNOWN_COLOR, weight: rid === focus ? 9 : 5, opacity: 0.95, lineCap: 'round', interactive: false }).addTo(layer);
        }
      }
    }
    const rid = fp.routes.includes(focus) ? focus : fp.routes.find((x) => inArea.has(x));
    // Drop pins as on the 3D map, in the rating's colour with its number.
    L.marker([fp.lat, fp.lon], { color: COLOR[Math.floor(s)] ?? UNKNOWN_COLOR, title: fp.short, alt: fp.short, riseOnHover: true, icon: L.divIcon({ className: '', html: `<div class="pin drop-pin ${s ? `s${Math.floor(s)}` : 'sq'}${fp.id === mapCrossing ? ' open' : ''}"><span class="glyph">${s ?? '?'}</span></div>`, iconSize: [32, 40], iconAnchor: [16, 40] }) })
      .on('click', () => { if (onMap) { mapCrossing = fp.id; drawMap(w); revealCrossing(); } else location.hash = `#/r/${rid}/${fp.id}`; })
      .addTo(layer);
  }
  // Official closures, whether or not a route uses them, near this area's routes.
  const areaBounds = L.latLngBounds(routeFeatures.flatMap((f) => lineCoords(f.geometry).flat().map(([lon, lat]) => [lat, lon]))).pad(0.1);
  for (const c of view.closedLines) {
    if (!c.coords.some((q) => areaBounds.contains(q))) continue;
    L.polyline(c.coords, { color: '#fff', weight: 11, opacity: 0.9, interactive: false }).addTo(layer);
    L.polyline(c.coords, { color: COLOR[5], weight: 8, opacity: 0.95 }).bindPopup(esc(c.title)).addTo(layer);
  }
  for (const c of view.closedPoints) {
    if (!areaBounds.contains([c.lat, c.lon])) continue;
    L.marker([c.lat, c.lon], { color: COLOR[5], title: c.title, alt: c.title, zIndexOffset: 1000, icon: L.divIcon({ className: '', html: '<div class="pin closure-pin" aria-hidden="true">⛔</div>', iconSize: [30, 30], iconAnchor: [15, 15] }) }).bindPopup(esc(c.title)).addTo(layer);
  }
  // Fit to what's on screen: everything, a route, a stretch, or a source's own gauges.
  const opts = { paddingTopLeft: [24, 30], paddingBottomRight: [24, 30], animate: false };
  if (w.screen === 'stretch') {
    const fp = FAILURE_POINTS.find((f) => f.id === w.fp);
    const pts = [[fp.lat, fp.lon]];
    if (openSource != null) {
      for (const g of gaugesFor(fp, view.fpResults[fp.id].checks[openSource])) {
        pts.push([g.lat, g.lon]);
        L.marker([g.lat, g.lon], { icon: L.divIcon({ className: 'gauge-pin', html: `<span class="gauge">${esc(g.label)}</span>`, iconSize: [0, 0] }), interactive: false }).addTo(layer);
      }
    }
    if (pts.length > 1) map.fitBounds(pts, { padding: [40, 40], maxZoom: 14, animate: false });
    else map.setView(pts[0], 15, { animate: false });
  } else if (w.screen === 'route') {
    map.fitBounds(L.geoJSON(routeFeatures.find((f) => f.properties.id === w.route)).getBounds(), opts);
  } else if(w.screen!=='map'||!mapCameraSet) {
    map.fitBounds(allBounds, w.screen==='map' ? mapApp.padding() : opts);
    // The Map screen keeps wherever the driver moved it after this first fit.
    if(w.screen==='map')mapCameraSet=true;
  }
  if (onMap) renderMapRoutes();
}
function gaugesFor(fp, c) {
  if (!c) return [];
  const rain = { 'rain-local': fp.rain?.local, 'rain-basin': fp.rain?.basin, 'rain-road': fp.rain?.road }[c.src];
  if (rain) return (data.alert?.rain ?? []).filter((g) => rain.includes(g.site)).map((g) => ({ lat: g.lat, lon: g.lon, label: `${g.in?.h6 == null ? '–' : g.in.h6.toFixed(2)}″ in 6 h` }));
  const usgs = (ids) => ids.map((id) => ({ lat: USGS_SITES[id].lat, lon: USGS_SITES[id].lon, label: data.flows[id]?.fresh ? `${Math.round(data.flows[id].cfs).toLocaleString()} cfs` : 'no data' }));
  if (c.src === 'river') return usgs(fp.river);
  if (c.src === 'river-early') return usgs(RIVER_EARLY);
  if (c.src === 'wash') {
    return [...(data.alert?.stream ?? []).filter((s) => fp.wash.alert?.includes(s.site)).map((s) => ({ lat: s.lat, lon: s.lon, label: `${s.flow_cfs ?? '–'} cfs` })), ...usgs(fp.wash.usgs ?? [])];
  }
  if (c.src === 'county') return view.fpResults[fp.id].closurePts.map((p) => ({ lat: p.lat, lon: p.lon, label: p.status }));
  return [];
}

// ---------------- run ----------------
let checking = false;
async function check() {
  if (checking) return;
  checking = true;
  $('#refresh').classList.add('spin');
  $('#refresh').disabled = true;
  $('#refresh').setAttribute('aria-label', 'Checking conditions');
  try {
    const next = await gather();
    // With nothing answering, keep showing the last good check instead of an empty one.
    if (data && !next.closures && !next.alert && !next.nws && !Object.values(next.flows).some((f) => f.fresh)) throw new Error('No feeds answered');
    next.hand = data?.hand ?? null; // Keep the last HAND result until the new one arrives.
    next.sfincs = data?.sfincs ?? null; // And the last SFINCS road forecast.
    const nextView = compute(next);
    data = next;
    view = nextView;
    $('#load-status').hidden = true;
    store.set('lastCheck', { now: next.now, flows: next.flows, closures: next.closures, alert: next.alert, nws: next.nws, roadEvents: next.roadEvents, drive: next.drive, errors: [] });
    render();
    refreshHand();
    refreshSfincs();
  } catch (e) {
    if (!view) throw e;
    $('#load-status').textContent = 'Couldn’t update conditions. Showing the previous check. Tap Check again to retry.';
    $('#load-status').hidden = false;
  } finally {
    checking = false;
    $('#refresh').classList.remove('spin');
    $('#refresh').disabled = false;
    $('#refresh').setAttribute('aria-label', 'Check again');
  }
}
const LAST_CHECK_KEEP_MS = 24 * 3600000;
function registerOffline() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('sw.js').then(() => navigator.serviceWorker.ready).then((reg) => {
    const urls = [location.origin + location.pathname, ...performance.getEntriesByType('resource').map((e) => e.name)];
    reg.active?.postMessage({ type: 'cache-files', urls: [...new Set(urls)] });
  }).catch(() => { /* The app still works online. */ });
}
async function init() {
  loadBridgeEvidence().then(result=>{bridgeEvidence=result;if(data&&view){view=compute(data);if(!['report','alerts'].includes(where().screen))render()}});
  allRoutes = (await getJson('data/routes.geojson')).features;
  useArea(routeAreaForHash(location.hash, allRoutes) ?? store.get('area') ?? 'avra');
  map.fitBounds(allBounds, { animate: false });
  window.addEventListener('hashchange', () => { saveNotice = ''; openSource = null; render(); window.scrollTo(0, 0); });
  $('#back').addEventListener('click', () => {
    const w = where();
    // Go back through the app's own history; if the app was opened deep, go to the parent screen.
    if (history.length > 1) history.back();
    else location.replace(w.screen === 'stretch' ? `#/r/${w.route}` : '#/');
  });
  $('#refresh').addEventListener('click', check);
  // Count this visit (once per visit; "new" the first time on this device). Counts only.
  try {
    if (cfg.TEXT_API && !sessionStorage.getItem('counted')) {
      sessionStorage.setItem('counted', '1');
      const isNew = !store.get('seen'); store.set('seen', true);
      fetch(`${cfg.TEXT_API}?hit=1${isNew ? '&new=1' : ''}`).catch(() => {});
    }
  } catch { /* private mode */ }
  registerOffline();
  // Show the last check at once. It keeps its own "Checked" time until a new one arrives.
  const saved = store.get('lastCheck');
  if (saved && Date.now() - saved.now < LAST_CHECK_KEEP_MS) {
    try { data = { ...saved, hand: null }; view = compute(data); render(); } catch { data = null; view = null; }
  }
  await check();
  setInterval(check, REFRESH_MS);
  setInterval(updateCheckAge, 30000);
  window.addEventListener('offline', updateCheckAge);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && (!data || Date.now() - data.now >= REFRESH_MS)) check();
  });
  window.addEventListener('online', check);
}
init().catch((e) => {
  $('#screen').innerHTML = `<p class="loading">Couldn't load: ${esc(e.message)}</p><button type="button" class="btn btn-primary" id="retry-load">Try again</button>`;
  $('#retry-load').addEventListener('click', () => location.reload());
});

