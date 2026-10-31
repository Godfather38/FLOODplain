import * as cfg from './config.js';
import { parseContinuous, summarizeFlow, rateFailurePoint, rateRoutes, recommend, googleMapsUrl } from './logic.js';

const { SOURCES, USGS_SITES, FAILURE_POINTS, NAV, LINKS, STALE_MS } = cfg;
const COLORS = { ok: '#2e7d32', watch: '#1565c0', caution: '#ef8f00', danger: '#c62828', unknown: '#757575' };
const LABEL = { ok: 'Low risk', watch: 'Some risk', caution: 'Elevated risk', danger: 'High risk', unknown: 'Unknown' };
const SRC = { county: 'County', nws: 'NWS', river: 'River', 'river-early': 'Upstream creeks', wash: 'Wash flow', 'rain-local': 'Rain here', 'rain-basin': 'Rain upstream', 'rain-road': 'Rain' };
const evidence = (p) => `<ul class="ev">${p.checks.map((c) => `<li><span class="dot ${c.level}"></span><b>${SRC[c.src] ?? c.src}:</b> ${esc(c.why)}${c.detail ? `<br><small>${esc(c.detail)}</small>` : ''}</li>`).join('')}</ul>`;
const KIND = { dip: 'dip (water crosses the road)', bridge: 'bridge', river: 'river bridge', road: 'road drainage' };
const REFRESH_MS = 5 * 60 * 1000;
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};

// ---------- map ----------
const map = L.map('map', { zoomSnap: 0.25 }).setView([32.42, -111.22], 12);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
const routeLayers = {};
const dynamic = L.layerGroup().addTo(map);

// ---------- data ----------
async function getJson(url, opts) {
  const r = await fetch(url, { cache: 'no-store', ...opts });
  if (!r.ok) throw new Error(`HTTP ${r.status}${r.status === 429 ? ' (rate limited, so add your USGS key)' : ''}`);
  return r.json();
}

async function loadUsgs(site) {
  const key = store.get('apiKey');
  const url = `${SOURCES.usgs}/collections/continuous/items?f=json&monitoring_location_id=USGS-${site}`
    + '&parameter_code=00060&time=PT6H&limit=500&skipGeometry=true&properties=time,value,parameter_code'
    + (key ? `&api_key=${encodeURIComponent(key)}` : '');
  return parseContinuous(await getJson(url));
}

async function loadClosures() {
  const q = new URLSearchParams({
    where: '1=1', outFields: 'Location,Status,Direction,timeUpdated', returnGeometry: 'true', outSR: '4326', f: 'json',
    geometry: '-111.45,32.25,-111.10,32.50', geometryType: 'esriGeometryEnvelope', inSR: '4326', spatialRel: 'esriSpatialRelIntersects',
  });
  const j = await getJson(`${SOURCES.closures}/query?${q}`);
  if (j.error) throw new Error(j.error.message);
  return j.features.map((f) => ({
    location: f.attributes.Location?.trim(), status: f.attributes.Status ?? '', updated: f.attributes.timeUpdated,
    lat: f.geometry.y, lon: f.geometry.x,
  }));
}

async function loadNws() {
  const j = await getJson(SOURCES.nws, { headers: { Accept: 'application/geo+json' } });
  return (j.features ?? []).map((f) => ({ event: f.properties.event, headline: f.properties.headline, ends: f.properties.ends || f.properties.expires }));
}

async function gather() {
  const now = Date.now();
  const errors = {};
  const settle = async (name, p) => { try { return await p; } catch (e) { errors[name] = e.message; return null; } };
  const sites = Object.keys(USGS_SITES);
  const [flowsArr, closures, alert, nws] = await Promise.all([
    Promise.all(sites.map((s) => settle(`USGS ${s}`, loadUsgs(s)))),
    settle('County closures', loadClosures()),
    settle('ALERT rain', getJson(SOURCES.alert)),
    settle('NWS', loadNws()),
  ]);
  const flows = Object.fromEntries(sites.map((s, i) => [s, summarizeFlow(flowsArr[i], now, STALE_MS)]));
  return { now, flows, closures, alert, nws, errors };
}

// ---------- render ----------
let routeFeatures = [];

function render(d) {
  const fpResults = Object.fromEntries(FAILURE_POINTS.map((fp) => [fp.id, rateFailurePoint(fp, d, cfg)]));
  const rated = rateRoutes(routeFeatures, fpResults, FAILURE_POINTS);
  const { best, clear, order } = recommend(rated);
  const problems = best.points.filter((p) => p.level !== 'ok');
  const short = (r) => r.name.split(' -> ')[0];

  // The brief
  const head = clear ? `Take ${esc(best.name)}`
    : best.level === 'unknown' ? 'The sensors can’t tell right now' : `Lowest risk: ${esc(best.name)}`;
  const sub = clear
    ? `~${Math.round(best.minutes)} min · ${LABEL[best.level]}${problems.length ? ': see below' : ''}`
    : best.level === 'unknown'
      ? 'Check the ALERT rain map and county closures below before you leave'
      : `Every route has ${LABEL[best.level].toLowerCase()} right now. Look before each crossing, or wait. Never drive into water crossing the road.`;
  // Explain every route that is faster than the pick, or that is dangerous today.
  const faster = order.filter((r) => r.id !== best.id && (r.minutes < best.minutes || r.level === 'danger'));
  const whyNot = faster.map((r) => {
    const p = r.points.find((x) => x.level === r.level);
    return `<li><b>${esc(short(r))}: ${LABEL[r.level]}.</b> ${esc(p.name)}: ${esc(p.why)}</li>`;
  }).join('');
  const watch = problems.map((p) => `<li><b>${esc(p.name)}</b>: ${LABEL[p.level]}${evidence(p)}</li>`).join('');
  $('#verdict').className = `verdict ${best.level}`;
  $('#verdict').innerHTML = `<b>${head}</b><span>${sub}</span>`;
  $('#brief').innerHTML = (whyNot ? `<ul>${whyNot}</ul>` : '') + (watch ? `<p class="h">On this route:</p><ul>${watch}</ul>` : '');
  const dest = store.get('dest');
  $('#gmaps').href = googleMapsUrl(NAV[best.id], dest);
  $('#gmaps').textContent = `Open ${short(best)} route in Google Maps`;

  // Route cards
  $('#routes').innerHTML = order.map((r) => `
    <li class="route ${r.level}" data-id="${r.id}">
      <div class="head"><b>${esc(r.name)}</b><span class="meta">${r.km} km · ~${Math.round(r.minutes)} min</span><span class="badge">${LABEL[r.level]}</span></div>
      <ul class="pts">${r.points.map((p) => `<li><span class="dot ${p.level}"></span><b>${esc(p.name)}</b> <span class="kind">${KIND[p.kind]} · ${LABEL[p.level]}</span>${evidence(p)}</li>`).join('')}</ul>
      <a class="nav" href="${googleMapsUrl(NAV[r.id], dest)}" target="_blank" rel="noopener">Google Maps →</a>
    </li>`).join('');
  document.querySelectorAll('#routes > li').forEach((li) => {
    li.addEventListener('click', (e) => { if (!e.target.closest('a')) map.fitBounds(routeLayers[li.dataset.id].getBounds(), { padding: [20, 20] }); });
  });

  // Map
  for (const r of rated) routeLayers[r.id]?.setStyle({ color: COLORS[r.level] });
  routeLayers[best.id]?.bringToFront();
  dynamic.clearLayers();
  for (const fp of FAILURE_POINTS) {
    const r = fpResults[fp.id];
    L.circleMarker([fp.lat, fp.lon], { radius: fp.kind === 'dip' ? 9 : 7, color: '#000', weight: 1.5, fillColor: COLORS[r.level], fillOpacity: 1 })
      .bindPopup(`<b>${esc(fp.name)}</b><br>${esc(fp.where)}<br><b>${LABEL[r.level]}</b>${evidence(r)}`)
      .addTo(dynamic);
  }
  for (const g of d.alert?.rain ?? []) {
    if (!cfg.RAIN_GAUGES[g.site]) continue;
    const h6 = g.in?.h6;
    L.marker([g.lat, g.lon], { icon: L.divIcon({ className: 'rain-label', html: `☂ ${h6 == null ? '–' : h6.toFixed(2)}"`, iconSize: null }) })
      .bindTooltip(`${esc(g.name)}<br>last 1 h ${g.in.h1 ?? '–'}" · 3 h ${g.in.h3 ?? '–'}" · 6 h ${g.in.h6 ?? '–'}" · 24 h ${g.in.d1 ?? '–'}"`)
      .addTo(dynamic);
  }
  for (const c of d.closures ?? []) {
    if (/open/i.test(c.status)) continue;
    L.marker([c.lat, c.lon], { icon: L.divIcon({ className: `closure ${/clos/i.test(c.status) ? 'closed' : 'careful'}`, html: '⛔', iconSize: null }) })
      .bindTooltip(`${esc(c.location)}: ${esc(c.status)} (updated ${esc(c.updated)})`).addTo(dynamic);
  }

  // Where the data came from
  const t = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const bits = [`Checked ${t(d.now)}`];
  if (d.alert?.fetched_at) bits.push(`rain data from ${t(Date.parse(d.alert.fetched_at))}`);
  if (d.nws?.length) bits.push(`NWS: ${d.nws.map((a) => a.event).join(', ')}`);
  const errs = Object.keys(d.errors);
  if (errs.length) bits.push(`couldn't reach: ${errs.join(', ')}`);
  $('#status').textContent = bits.join(' · ');
}

async function check() {
  $('#status').textContent = 'Checking river gauges, rain gauges, county closures, NWS…';
  render(await gather());
}

async function init() {
  const routes = await getJson('data/routes.geojson');
  routeFeatures = routes.features;
  for (const f of routeFeatures) {
    routeLayers[f.properties.id] = L.geoJSON(f, { style: { color: COLORS.unknown, weight: 5, opacity: 0.8 } }).bindTooltip(f.properties.name).addTo(map);
  }
  map.fitBounds(L.featureGroup(Object.values(routeLayers)).getBounds(), { padding: [10, 10], animate: false });
  $('#links').innerHTML = LINKS.map(([t, u]) => `<a href="${u}" target="_blank" rel="noopener">${t}</a>`).join('');
  for (const [id, key] of [['#apikey', 'apiKey'], ['#dest', 'dest']]) {
    $(id).value = store.get(key) ?? '';
    $(id).addEventListener('change', (e) => { store.set(key, e.target.value.trim() || null); check(); });
  }
  $('#refresh').addEventListener('click', check);
  await check();
  setInterval(check, REFRESH_MS);
}

init().catch((e) => { $('#status').textContent = `Failed to load: ${e.message}`; });
