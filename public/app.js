import { API, STALE_MS, DRY_CFS, GAUGES, ROUTES, LINKS } from './config.js';
import { parseContinuous, summarizeGauge, rateRoute, recommend } from './logic.js';

const COLORS = { ok: '#2e7d32', watch: '#1565c0', caution: '#ef8f00', danger: '#c62828', unknown: '#757575' };
const LABEL = { ok: 'Clear', watch: 'Water under bridge', caution: 'Caution', danger: 'Avoid', unknown: 'No data (not safe, just unknown)' };
const CACHE_MS = 5 * 60 * 1000;
const $ = (s) => document.querySelector(s);

const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};

// ---- map ----
const map = L.map('map', { zoomSnap: 0.25 }).setView([32.42, -111.22], 12);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 18,
  attribution: '&copy; OpenStreetMap contributors',
}).addTo(map);
const routeLayers = {};
const gaugeLayer = L.layerGroup().addTo(map);

async function loadJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}

// ---- USGS ----
async function fetchGauge(site) {
  const key = `usgs:${site}`;
  const hit = store.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.json;
  const url = `${API}/collections/continuous/items?f=json&monitoring_location_id=USGS-${site}`
    + '&time=PT6H&limit=2000&properties=time,value,parameter_code';
  // Query parameter rather than X-Api-Key header: a custom header would force
  // a CORS preflight on every request.
  const apiKey = store.get('apiKey');
  const r = await fetch(apiKey ? `${url}&api_key=${encodeURIComponent(apiKey)}` : url);
  if (!r.ok) throw new Error(`USGS ${site}: HTTP ${r.status}${r.status === 429 ? ' (rate limited: paste your free USGS key in the box above)' : ''}`);
  const json = await r.json();
  store.set(key, { at: Date.now(), json });
  return json;
}

async function check() {
  $('#status').textContent = 'Checking gauges…';
  const now = Date.now();
  const summaries = {};
  const errors = [];
  const coords = {};
  await Promise.all(Object.keys(GAUGES).map(async (site) => {
    try {
      const json = await fetchGauge(site);
      summaries[site] = summarizeGauge(parseContinuous(json), now, { staleMs: STALE_MS, dryCfs: DRY_CFS });
      const geom = json.features?.find((f) => f.geometry)?.geometry;
      if (geom) coords[site] = [geom.coordinates[1], geom.coordinates[0]];
    } catch (e) {
      errors.push(e.message);
      summaries[site] = { state: 'nodata' };
    }
  }));
  render(summaries, coords, errors, now);
}

// ---- render ----
let routeFeatures = [];

function render(summaries, coords, errors, now) {
  const rated = routeFeatures.map((f) => ({
    id: f.properties.id,
    name: f.properties.name,
    minutes: f.properties.minutes,
    km: f.properties.km,
    ...rateRoute(ROUTES[f.properties.id], summaries, GAUGES),
  }));
  const { best, clear, order } = recommend(rated);

  $('#verdict').className = `verdict ${best.level}`;
  $('#verdict').innerHTML = clear
    ? `<b>Take ${best.name}</b><span>~${Math.round(best.minutes)} min · ${LABEL[best.level]}</span>`
    : best.level === 'unknown'
      ? `<b>Can't tell from the gauges right now</b><span>Check the ALERT map and closures below before leaving</span>`
      : `<b>No route is clear</b><span>Least bad: ${best.name} (${LABEL[best.level]}). Consider waiting. Turn Around, Don't Drown.</span>`;

  $('#routes').innerHTML = order.map((r) => `
    <li class="route ${r.level}" data-id="${r.id}">
      <div class="head"><span class="dot"></span><b>${r.name}</b><span class="meta">${r.km} km · ~${Math.round(r.minutes)} min</span>
        <span class="badge">${LABEL[r.level]}</span></div>
      <ul class="links">${r.links.map((l) => `<li><span class="dot ${l.level}"></span>${l.role}: <i>${l.why}</i></li>`).join('')}</ul>
      <ul class="blind">${ROUTES[r.id].blindSpots.map((b) => `<li>Not watched: ${b}</li>`).join('')}</ul>
    </li>`).join('');
  document.querySelectorAll('#routes > li').forEach((li) => {
    li.addEventListener('mouseenter', () => routeLayers[li.dataset.id]?.bringToFront().setStyle({ weight: 8 }));
    li.addEventListener('mouseleave', () => routeLayers[li.dataset.id]?.setStyle({ weight: 5 }));
    li.addEventListener('click', () => map.fitBounds(routeLayers[li.dataset.id].getBounds(), { padding: [20, 20] }));
  });

  for (const r of rated) routeLayers[r.id]?.setStyle({ color: COLORS[r.level] });
  routeLayers[best.id]?.bringToFront();

  gaugeLayer.clearLayers();
  for (const [site, g] of Object.entries(GAUGES)) {
    if (!coords[site]) continue;
    const s = summaries[site];
    const txt = s.state === 'nodata' ? 'no recent data'
      : [s.cfs != null && `${s.cfs} cfs`, s.ft != null && `${s.ft} ft`].filter(Boolean).join(' · ') || s.state;
    L.circleMarker(coords[site], { radius: 8, color: '#000', weight: 1, fillColor: s.state === 'flowing' ? '#1e88e5' : s.state === 'nodata' ? '#9e9e9e' : '#fff', fillOpacity: 1 })
      .bindPopup(`<b>${g.name}</b><br>USGS ${site}<br>${txt}<br><a href="https://waterdata.usgs.gov/monitoring-location/USGS-${site}/" target="_blank" rel="noopener">USGS page</a>`)
      .addTo(gaugeLayer);
  }

  $('#status').textContent = `Checked ${new Date(now).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
    + (errors.length ? ` · ${errors.length} gauge(s) unreachable: ${errors.join('; ')}` : '');
}

async function init() {
  const [routes, crossings] = await Promise.all([loadJson('data/routes.geojson'), loadJson('data/crossings.geojson')]);
  routeFeatures = routes.features;
  for (const f of routeFeatures) {
    routeLayers[f.properties.id] = L.geoJSON(f, { style: { color: COLORS.unknown, weight: 5, opacity: 0.85 } })
      .bindTooltip(f.properties.name).addTo(map);
  }
  const seen = new Set();
  for (const f of crossings.features) {
    const [x, y] = f.geometry.coordinates;
    const k = `${x.toFixed(3)},${y.toFixed(3)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const p = f.properties;
    L.circleMarker([y, x], { radius: p.bridge_tagged ? 4 : 6, color: '#000', weight: 1, fillColor: p.bridge_tagged ? '#fff' : '#c62828', fillOpacity: 1 })
      .bindTooltip(`${p.water ?? 'Unnamed wash'} on ${p.road}: ${p.bridge_tagged ? 'bridge' : 'no bridge in map data (likely dip)'}`)
      .addTo(map);
  }
  map.fitBounds(L.featureGroup(Object.values(routeLayers)).getBounds(), { padding: [10, 10] });

  $('#links').innerHTML = LINKS.map(([t, u]) => `<a href="${u}" target="_blank" rel="noopener">${t}</a>`).join('');
  $('#apikey').value = store.get('apiKey') ?? '';
  $('#apikey').addEventListener('change', (e) => store.set('apiKey', e.target.value.trim() || null));
  $('#refresh').addEventListener('click', () => {
    Object.keys(GAUGES).forEach((s) => store.set(`usgs:${s}`, null));
    check();
  });
  await check();
  setInterval(check, CACHE_MS);
}

init().catch((e) => { $('#status').textContent = `Failed to load: ${e.message}`; });
