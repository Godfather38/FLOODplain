import * as cfg from './config.js';
import {
  parseContinuous, summarizeFlow, rateFailurePoint, rateRoutes, recommend, googleMapsUrl,
  riskScore, routeScore, goodSigns, againstIt,
} from './logic.js';

const { SOURCES, USGS_SITES, FAILURE_POINTS, NAV, LINKS, STALE_MS, ROUTE_INFO, RIVER_EARLY } = cfg;
const COLOR = { 1: '#3f8f4a', 2: '#5b8fd0', 3: '#e0a030', 4: '#e06a2c', 5: '#c8372d', null: '#9a9890' };
const LEVEL_WORD = { ok: 'nothing pointing at water', watch: 'some water around', caution: 'water likely near the road', danger: 'closed or flooding', unknown: 'missing data' };
const KIND_ICON = { dip: '〰️', bridge: '🌉', river: '🌉', road: '🛣️' };
const SRC = { county: 'County barricade', nws: 'Weather service', river: 'River flow', 'river-early': 'Creeks upstream', wash: 'Wash flow', 'rain-local': 'Rain right here', 'rain-basin': 'Rain upstream', 'rain-road': 'Rain' };
const REFRESH_MS = 5 * 60 * 1000;
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};
const pips = (n) => `<span class="pips" data-n="${n ?? '?'}" role="img" aria-label="Risk factor ${n ?? 'unknown'} of 5"><i></i><i></i><i></i><i></i><i></i></span><span class="score">${n ?? '?'}/5</span>`;

// ---------------- map ----------------
const map = L.map('map', { zoomSnap: 0.25, zoomControl: false }).setView([32.42, -111.22], 12);
L.control.zoom({ position: 'bottomright' }).addTo(map);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
const baseLayer = L.layerGroup().addTo(map); // routes, neutral
const stretchLayer = L.layerGroup().addTo(map); // colored stretches + numbered dots
const scopeLayer = L.layerGroup().addTo(map); // whatever evidence is open
const routeLines = {};
let allBounds;

// Pieces of a route line within `m` metres of a point: the "stretch" around a failure point.
function stretchAround(coords, lat, lon, m = 450) {
  const near = ([x, y]) => Math.hypot((x - lon) * 94_000, (y - lat) * 111_000) <= m;
  const runs = [];
  let cur = [];
  for (const c of coords) {
    if (near(c)) cur.push([c[1], c[0]]);
    else if (cur.length) { runs.push(cur); cur = []; }
  }
  if (cur.length) runs.push(cur);
  return runs.filter((r) => r.length > 1);
}
const lineCoords = (g) => (g.type === 'LineString' ? [g.coordinates] : g.coordinates);

// ---------------- data ----------------
async function getJson(url, opts) {
  const r = await fetch(url, { cache: 'no-store', ...opts });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
async function loadUsgs(site) {
  const key = store.get('apiKey');
  return parseContinuous(await getJson(`${SOURCES.usgs}/collections/continuous/items?f=json&monitoring_location_id=USGS-${site}`
    + '&parameter_code=00060&time=PT6H&limit=500&skipGeometry=true&properties=time,value,parameter_code'
    + (key ? `&api_key=${encodeURIComponent(key)}` : '')));
}
async function loadClosures() {
  const q = new URLSearchParams({
    where: '1=1', outFields: 'Location,Status,timeUpdated', returnGeometry: 'true', outSR: '4326', f: 'json',
    geometry: '-111.45,32.25,-111.10,32.50', geometryType: 'esriGeometryEnvelope', inSR: '4326', spatialRel: 'esriSpatialRelIntersects',
  });
  const j = await getJson(`${SOURCES.closures}/query?${q}`);
  if (j.error) throw new Error(j.error.message);
  return j.features.map((f) => ({ location: f.attributes.Location?.trim(), status: f.attributes.Status ?? '', updated: f.attributes.timeUpdated, lat: f.geometry.y, lon: f.geometry.x }));
}
async function loadNws() {
  const j = await getJson(SOURCES.nws, { headers: { Accept: 'application/geo+json' } });
  return (j.features ?? []).map((f) => ({ event: f.properties.event, headline: f.properties.headline }));
}
async function gather() {
  const now = Date.now();
  const errors = [];
  const settle = async (name, p) => { try { return await p; } catch { errors.push(name); return null; } };
  const sites = Object.keys(USGS_SITES);
  const [flowsArr, closures, alert, nws] = await Promise.all([
    Promise.all(sites.map((s) => settle('river gauges', loadUsgs(s)))),
    settle('county barricades', loadClosures()),
    settle('rain gauges', getJson(SOURCES.alert)),
    settle('weather service', loadNws()),
  ]);
  const flows = Object.fromEntries(sites.map((s, i) => [s, summarizeFlow(flowsArr[i], now, STALE_MS)]));
  return { now, flows, closures, alert, nws, errors: [...new Set(errors)] };
}

// ---------------- state ----------------
let routeFeatures = [];
let data = null;
let view = null; // computed per check
const ui = { openRoute: null, openStretch: null, openEv: null }; // what the user has opened

function compute(d) {
  const fpResults = Object.fromEntries(FAILURE_POINTS.map((fp) => [fp.id, rateFailurePoint(fp, d, cfg)]));
  const rated = rateRoutes(routeFeatures, fpResults, FAILURE_POINTS).map((r) => ({ ...r, score: routeScore(r) }));
  const rec = recommend(rated);
  const nwsQuiet = Array.isArray(d.nws) && !d.nws.some((a) => /flood/i.test(a.event));
  return { fpResults, rated, rec, nwsQuiet };
}

// ---------------- panel ----------------
function angelText(r, nwsQuiet) {
  const good = goodSigns(r, nwsQuiet);
  if (r.level === 'unknown' && !good.length) return 'I can’t vouch for this one: too much data is missing.';
  if (!good.length) return 'Honestly, not much going for it right now.';
  const list = good.length > 1 ? `${good.slice(0, -1).join(', ')} and ${good.at(-1)}` : good[0];
  return `${cap(list)}.`;
}

function evidenceHtml(fpRes, r) {
  return fpRes.checks.map((c, i) => `
    <details class="ev" data-route="${r.id}" data-fp="${fpRes.id}" data-ev="${i}">
      <summary><span class="dot ${c.level}"></span><span class="src">${SRC[c.src] ?? c.src}</span><span class="s">${esc(shortWhy(c))}</span><span class="chev">›</span></summary>
      <div class="detail"><p>${esc(c.why)}</p>${c.detail ? `<p>${esc(c.detail)}</p>` : ''}<p class="fine">${scopeNote(c.src)}</p></div>
    </details>`).join('');
}
const shortWhy = (c) => (c.why.length > 46 ? `${c.why.slice(0, 44).replace(/[ ,:;]+\S*$/, '')}…` : c.why);
const scopeNote = (src) => ({
  county: 'Map: the county’s barricade point(s) at this spot.',
  'rain-local': 'Map: the rain gauges nearest this spot, with inches in the last 6 hours.',
  'rain-basin': 'Map: rain gauges across the watershed that drains here.',
  'rain-road': 'Map: the rain gauges nearest this road.',
  river: 'Map: the river gauges used for this bridge.',
  'river-early': 'Map: creeks that feed the Santa Cruz upstream.',
  wash: 'Map: the wash flow sensors upstream.',
  nws: 'Covers all of Avra Valley.',
}[src] ?? '');

function routeCard(r, { hero, nwsQuiet, dest }) {
  const info = ROUTE_INFO[r.id];
  const against = againstIt(r);
  const open = hero ? ui.openRoute !== `-${r.id}` : ui.openRoute === r.id;
  const teaser = against.length ? `${esc(against[0].short)}: ${esc(LEVEL_WORD[against[0].level])}` : 'Nothing working against it';
  return `
  <article class="card ${hero ? 'hero' : ''} ${open ? 'open' : ''}" data-route="${r.id}">
    <button class="plain card-head" data-toggle="${r.id}" aria-expanded="${open}">
      ${hero ? `<div class="pick">${r.score != null && r.score <= 2 ? 'Suggested this morning' : 'Lowest risk right now'}</div>` : ''}
      <div class="top"><span class="name">${esc(info.name)}</span>${pips(r.score)}</div>
      <div class="via">${esc(info.via)} · <span class="time">~${Math.round(r.minutes)} min</span></div>
      <div class="teaser">${teaser}</div>
    </button>
    <div class="card-body">
      <div class="angel"><span class="face" aria-hidden="true">😇</span><p>${esc(angelText(r, nwsQuiet))}</p></div>
      ${against.length ? `<ul class="against">${against.slice(0, 3).map((a) => `<li><span class="dot ${a.level}"></span><span><b>${esc(a.short)}:</b> ${esc(a.why)}</span></li>`).join('')}</ul>` : ''}
      ${stretchList(r)}
      <a class="gmaps ${hero ? '' : 'secondary'}" href="${googleMapsUrl(NAV[r.id], dest)}" target="_blank" rel="noopener">Drive this in Google Maps</a>
    </div>
  </article>`;
}

function stretchHtml(r, p) {
  const fp = FAILURE_POINTS.find((f) => f.id === p.id);
  return `
    <details class="stretch" data-route="${r.id}" data-fp="${p.id}" ${ui.openStretch === `${r.id}|${p.id}` ? 'open' : ''}>
      <summary><span class="k" aria-hidden="true">${KIND_ICON[p.kind]}</span><span class="n">${esc(p.short)}</span>${pips(riskScore(p))}<span class="chev">›</span></summary>
      <div class="stretch-body">
        <p class="lead">${cap(LEVEL_WORD[p.level])}: ${esc(p.why)}.</p>
        <p class="where">${esc(fp.name)}, ${esc(fp.where)}.</p>
        ${evidenceHtml(p, r)}
      </div>
    </details>`;
}

// Only stretches with something going on are listed; normal ones fold into one line.
function stretchList(r) {
  const flagged = r.points.filter((p) => riskScore(p) !== 1);
  const normal = r.points.filter((p) => riskScore(p) === 1);
  const normalOpen = normal.some((p) => ui.openStretch === `${r.id}|${p.id}`);
  return `
    ${flagged.length ? `<div class="stretches-h">Worth a look</div>${flagged.map((p) => stretchHtml(r, p)).join('')}` : ''}
    ${normal.length ? `
      <details class="normals" ${normalOpen ? 'open' : ''}>
        <summary>${flagged.length ? `${normal.length} more` : `All ${normal.length}`} ${normal.length > 1 ? 'stretches look' : 'stretch looks'} normal <span class="chev">›</span></summary>
        ${normal.map((p) => stretchHtml(r, p)).join('')}
      </details>` : ''}`;
}

function renderPanel() {
  const { rated, rec, nwsQuiet } = view;
  const dest = store.get('dest');
  const others = rec.order.filter((r) => r.id !== rec.best.id);
  $('#hero').innerHTML = routeCard(rec.best, { hero: true, nwsQuiet, dest });
  $('#others').innerHTML = others.map((r) => routeCard(r, { hero: false, nwsQuiet, dest })).join('');
  void rated;

  document.querySelectorAll('[data-toggle]').forEach((b) => b.addEventListener('click', () => {
    const id = b.dataset.toggle;
    const isHero = id === rec.best.id;
    const isOpen = b.closest('.card').classList.contains('open');
    ui.openRoute = isOpen ? (isHero ? `-${id}` : null) : id;
    ui.openStretch = null; ui.openEv = null;
    renderPanel(); renderScope();
  }));
  document.querySelectorAll('details.stretch').forEach((d) => d.addEventListener('toggle', () => {
    const key = `${d.dataset.route}|${d.dataset.fp}`;
    if (d.open) {
      document.querySelectorAll('details.stretch[open]').forEach((o) => { if (o !== d) o.open = false; });
      ui.openStretch = key; ui.openEv = null;
    } else if (ui.openStretch === key) { ui.openStretch = null; ui.openEv = null; }
    renderScope();
  }));
  document.querySelectorAll('details.ev').forEach((d) => d.addEventListener('toggle', () => {
    if (d.open) {
      d.parentElement.querySelectorAll('details.ev[open]').forEach((o) => { if (o !== d) o.open = false; });
      ui.openEv = { fp: d.dataset.fp, i: Number(d.dataset.ev) };
    } else if (ui.openEv?.fp === d.dataset.fp && ui.openEv.i === Number(d.dataset.ev)) ui.openEv = null;
    renderScope();
  }));
}

// ---------------- map rendering ----------------
function renderBase() {
  const { fpResults, rec } = view;
  baseLayer.clearLayers();
  stretchLayer.clearLayers();
  const focus = activeRouteId();
  for (const f of routeFeatures) {
    const id = f.properties.id;
    const isFocus = id === focus;
    routeLines[id] = L.geoJSON(f, { style: { color: isFocus ? '#2b2b2b' : '#8d8b84', weight: isFocus ? 6 : 3.5, opacity: isFocus ? 0.85 : 0.45 } })
      .bindTooltip(ROUTE_INFO[id].name).addTo(baseLayer);
  }
  // Colored stretches + numbered dots, only where something is off (or the stretch you opened).
  const coordsOf = (id) => lineCoords(routeFeatures.find((f) => f.properties.id === id).geometry);
  for (const fp of FAILURE_POINTS) {
    const res = fpResults[fp.id];
    const s = riskScore(res);
    const sel = ui.openStretch?.endsWith(`|${fp.id}`);
    if (s === 1 && !sel) continue; // normal: no dot, no color
    for (const rid of fp.routes) {
      for (const line of coordsOf(rid)) {
        for (const run of stretchAround(line, fp.lat, fp.lon, fp.kind === 'road' ? 2500 : 450)) {
          L.polyline(run, { color: COLOR[s], weight: rid === focus ? 9 : 6, opacity: 0.9, lineCap: 'round' }).addTo(stretchLayer);
        }
      }
    }
    L.marker([fp.lat, fp.lon], { icon: L.divIcon({ className: '', html: `<div class="fp-icon ${s ? `s${s}` : 'sq'} ${sel ? 'sel' : ''}">${s ?? '?'}</div>`, iconSize: [22, 22], iconAnchor: [11, 11] }), zIndexOffset: sel ? 1000 : 0 })
      .bindTooltip(`${fp.short}: ${s ?? '?'}/5`)
      .on('click', () => openStretchFromMap(fp.id))
      .addTo(stretchLayer);
  }
  void rec;
}
const activeRouteId = () => {
  if (ui.openStretch) return ui.openStretch.split('|')[0];
  if (ui.openRoute && !ui.openRoute.startsWith('-')) return ui.openRoute;
  return view.rec.best.id;
};

function openStretchFromMap(fpId) {
  const fp = FAILURE_POINTS.find((f) => f.id === fpId);
  const rid = fp.routes.includes(activeRouteId()) ? activeRouteId() : fp.routes[0];
  if (rid !== view.rec.best.id) ui.openRoute = rid;
  ui.openStretch = `${rid}|${fpId}`; ui.openEv = null;
  renderPanel(); renderScope();
  document.querySelector(`details.stretch[data-route="${rid}"][data-fp="${fpId}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// Fit the map to whatever is open: route -> whole route, stretch -> that spot, evidence -> its sensors.
function renderScope() {
  renderBase();
  scopeLayer.clearLayers();
  const pad = { padding: [28, 28], maxZoom: 15, animate: false };
  if (!ui.openStretch) {
    const rid = activeRouteId();
    const b = ui.openRoute && !ui.openRoute.startsWith('-') ? routeLines[rid].getBounds() : allBounds;
    map.fitBounds(b, pad);
    return;
  }
  const fpId = ui.openStretch.split('|')[1];
  const fp = FAILURE_POINTS.find((f) => f.id === fpId);
  const res = view.fpResults[fpId];
  const pts = [[fp.lat, fp.lon]];
  if (ui.openEv && ui.openEv.fp === fpId) {
    const c = res.checks[ui.openEv.i];
    for (const s of scopePoints(fp, res, c)) {
      pts.push([s.lat, s.lon]);
      L.marker([s.lat, s.lon], { icon: L.divIcon({ className: 'scope-pin', html: `<span class="scope-label">${esc(s.label)}</span>`, iconSize: [0, 0] }) }).addTo(scopeLayer);
    }
  }
  if (pts.length === 1) map.setView(pts[0], 15, { animate: false });
  else map.fitBounds(pts, { paddingTopLeft: [24, 24], paddingBottomRight: [24, 34], maxZoom: 14, animate: false }); // room for labels
}

function scopePoints(fp, res, c) {
  const rainIds = { 'rain-local': fp.rain?.local, 'rain-basin': fp.rain?.basin, 'rain-road': fp.rain?.road }[c.src];
  if (rainIds) {
    return (data.alert?.rain ?? []).filter((g) => rainIds.includes(g.site)).map((g) => ({ lat: g.lat, lon: g.lon, label: `☂ ${g.in?.h6 == null ? '–' : g.in.h6.toFixed(2)}" · ${cfg.RAIN_GAUGES[g.site] ?? g.name}` }));
  }
  const usgs = (ids) => ids.map((id) => ({ lat: USGS_SITES[id].lat, lon: USGS_SITES[id].lon, label: `${data.flows[id]?.fresh ? `${Math.round(data.flows[id].cfs).toLocaleString()} cfs` : 'no data'} · ${USGS_SITES[id].name}` }));
  if (c.src === 'river') return usgs(fp.river);
  if (c.src === 'river-early') return usgs(RIVER_EARLY);
  if (c.src === 'wash') {
    const a = (data.alert?.stream ?? []).filter((s) => fp.wash.alert?.includes(s.site)).map((s) => ({ lat: s.lat, lon: s.lon, label: `${s.flow_cfs ?? '–'} cfs · ${s.name.replace(/ \(PT\)$/, '')}` }));
    return [...a, ...usgs(fp.wash.usgs ?? [])];
  }
  if (c.src === 'county') return res.closurePts.map((p) => ({ lat: p.lat, lon: p.lon, label: `⛔ ${p.status}` }));
  return [];
}

// ---------------- run ----------------
async function check() {
  $('#status').textContent = 'Checking…';
  data = await gather();
  view = compute(data);
  renderPanel();
  renderScope();
  const t = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const bits = [`Checked ${t(data.now)}`];
  if (data.alert?.fetched_at) bits.push(`rain as of ${t(Date.parse(data.alert.fetched_at))}`);
  if (data.errors.length) bits.push(`no ${data.errors.join(', ')}`);
  $('#status').textContent = bits.join(' · ');
}

async function init() {
  routeFeatures = (await getJson('data/routes.geojson')).features;
  allBounds = L.geoJSON({ type: 'FeatureCollection', features: routeFeatures }).getBounds();
  map.fitBounds(allBounds, { padding: [10, 10], animate: false });
  $('#links').innerHTML = LINKS.map(([t, u]) => `<a href="${u}" target="_blank" rel="noopener">${t}</a>`).join('');
  for (const [id, key] of [['#apikey', 'apiKey'], ['#dest', 'dest']]) {
    $(id).value = store.get(key) ?? '';
    $(id).addEventListener('change', (e) => { store.set(key, e.target.value.trim() || null); check(); });
  }
  $('#refresh').addEventListener('click', check);
  await check();
  setInterval(check, REFRESH_MS);
}

init().catch((e) => { $('#status').textContent = `Couldn't load: ${e.message}`; });
