import {mountFloodLayers} from './simulation/map-layers.js';
import { savedRoutes, toggleSavedRoute, checkAge } from './preferences.js?v=dev';
import * as cfg from './config.js?v=dev';
import { getJson } from './network.js?v=dev';
import { loadGaugeReadings } from './gauge-feed.js?v=dev';
import { resolveScreen } from './routing.js?v=dev';
import {
  parseContinuous, summarizeFlow, rateFailurePoint, rateRoutes, recommend, googleMapsUrl,
  riskScore, routeScore, goodSigns, againstIt,
} from './logic.js?v=dev';

const { SOURCES, USGS_SITES, FAILURE_POINTS, NAV, LINKS, STALE_MS, ROUTE_INFO, RIVER_EARLY, PLACES, AREAS } = cfg;
const WORD = { 1: 'Low', 2: 'Minor', 3: 'Moderate', 4: 'High', 5: 'Severe' };
const COLOR = { 1: '#2e7d32', 2: '#4f7fc4', 3: '#d99a1e', 4: '#e0662a', 5: '#c62828' };
const LEVEL_SENTENCE = { ok: 'Nothing in the data points to water here.', watch: 'Some water around. Usually passable; look as you go.', caution: 'Water likely at or near the road.', danger: 'Closed, or a flood is running.', unknown: 'Missing data. That is not the same as fine.' };
const SRC = {
  none: ['…', 'Live readings'], county: ['🚧', 'County barricade'], nws: ['📢', 'Weather service'], river: ['🌊', 'River'], 'river-early': ['⤴️', 'Creeks upstream'],
  wash: ['〰️', 'Wash flow'], 'rain-local': ['🌧️', 'Rain here'], 'rain-basin': ['🌧️', 'Rain upstream'], 'rain-road': ['🌧️', 'Rain'],
};
const KIND_ICON = { dip: '〰️', flat: '〰️', bridge: '🌉', river: '🌉', road: '🛣️' };
const REFRESH_MS = 5 * 60 * 1000;
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
const badge = (n, lg) => `<span class="badge ${lg ? 'lg' : ''} ${n ? `s${n}` : 'sq'}" role="img" aria-label="Risk factor ${n ?? 'unknown'} of 5">${n ?? '?'}</span>`;
const badgeWithWord = (n) => `<span class="badge-wrap">${badge(n, true)}<span class="badge-word">${n ? WORD[n] : 'No data'}</span></span>`;

// ---------------- data ----------------
// River gauges. USGS limits how often one phone may ask without a key, so:
//  1. ask our alert service first (it already pulls every gauge each minute: one request),
//  2. otherwise ask USGS directly, but reuse each gauge's reading for 10 minutes,
//  3. if USGS refuses, fall back to the last saved reading (its age is judged like any other).
let usgsBusy = false;
async function loadUsgsAll(sites) {
  const key = store.get('apiKey');
  const result = await loadGaugeReadings(sites, {
    fetchJson: getJson, store, parse: parseContinuous,
    proxyUrl: cfg.TEXT_API ? `${cfg.TEXT_API}?feed=usgs` : null,
    directUrl: (site) => `${SOURCES.usgs}/collections/continuous/items?f=json&monitoring_location_id=USGS-${site}`
      + '&parameter_code=00060&time=PT6H&limit=500&skipGeometry=true&properties=time,value,parameter_code'
      + (key ? `&api_key=${encodeURIComponent(key)}` : ''),
  });
  usgsBusy = result.busy;
  return result.series;
}
async function loadClosures() {
  const q = new URLSearchParams({
    where: '1=1', outFields: 'Location,Status,timeUpdated', returnGeometry: 'true', outSR: '4326', f: 'json',
    geometry: cfg.CLOSURE_BOUNDS, geometryType: 'esriGeometryEnvelope', inSR: '4326', spatialRel: 'esriSpatialRelIntersects',
  });
  const j = await getJson(`${SOURCES.closures}/query?${q}`);
  if (j.error) throw new Error(j.error.message);
  return j.features.map((f) => ({ location: f.attributes.Location?.trim(), status: f.attributes.Status ?? '', updated: f.attributes.timeUpdated, lat: f.geometry.y, lon: f.geometry.x }));
}
// County rain/stream feed: live through the alert service when it's connected, else GitHub's copy.
async function loadAlert() {
  if (cfg.TEXT_API) {
    try { const a = await getJson(`${cfg.TEXT_API}?feed=alert`); if (a && a.rain) return a; } catch { /* fall back */ }
  }
  return getJson(SOURCES.alert);
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
  const [flowsArr, closures, alert, nws] = await Promise.all([
    loadUsgsAll(sites),
    settle('county barricades', loadClosures()),
    settle('rain gauges', loadAlert()),
    settle('weather service', loadNws()),
  ]);
  const flows = Object.fromEntries(sites.map((s, i) => [s, summarizeFlow(flowsArr[i], now, STALE_MS)]));
  if (!Object.values(flows).some((f) => f.fresh)) errors.push(usgsBusy ? 'river gauges busy, retrying' : 'river gauges not responding');
  return { now, flows, closures, alert, nws, errors: [...new Set(errors)] };
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
  const intoValley = await headingIntoValley();
  const url = googleMapsUrl(NAV[rid], intoValley ? null : store.get('dest'), intoValley ? 'valley' : 'toI10');
  location.href = url;
}

function compute(d) {
  const fpResults = Object.fromEntries(FAILURE_POINTS.map((fp) => [fp.id, rateFailurePoint(fp, d, cfg)]));
  const rated = rateRoutes(routeFeatures, fpResults, FAILURE_POINTS).map((r) => ({ ...r, score: routeScore(r) }));
  try { sessionStorage.setItem('floodplain-route-evidence', JSON.stringify({now:d.now,area,rated,errors:d.errors})); } catch { /* optional experimental evidence handoff */ }
  const nwsQuiet = Array.isArray(d.nws) && !d.nws.some((a) => /flood/i.test(a.event));
  return { fpResults, rated, rec: recommend(rated), nwsQuiet, byId: Object.fromEntries(rated.map((r) => [r.id, r])) };
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
  return a ? `${a.short}: ${a.why}` : 'Nothing working against it';
};
const minutes = (r) => `${Math.round(r.minutes)} min`;
const navBtn = (r, cls = 'btn btn-primary') => `<button type="button" class="${cls}" data-nav="${r.id}">${NAV_ICON}Navigate</button>`;

// ---------------- screens ----------------
function homeScreen() {
  const { rec } = view;
  const best = rec.best;
  const info = ROUTE_INFO[best.id];
  const against = againstIt(best).slice(0, 2);
  const others = rec.order.filter((r) => r.id !== best.id);
  const overline = best.score <= 2 ? 'Best route right now' : 'Least going against it';
  const areaSwitch = `<div class="seg" role="tablist" aria-label="Area">${AREAS.map((x) => `<button type="button" role="tab" data-area="${x.id}" aria-selected="${x.id === area}">${esc(x.name)}</button>`).join('')}</div>`;
  return `
    ${areaSwitch}
    <article class="hero">
      <p class="overline">${overline}</p>
      <div class="hero-top"><h2>${esc(info.name)}</h2>${badgeWithWord(best.score)}</div>
      <p class="meta">${minutes(best)} · ${esc(viaText(best.id))}</p>
      <div class="angel"><span class="face" aria-hidden="true">😇</span><p>${esc(angelText(best))}</p></div>
      ${against.length ? `<ul class="against">${against.map((a) => `<li><span class="dot ${a.level}"></span><span>${esc(a.short)}: ${esc(a.why)}</span></li>`).join('')}</ul>` : ''}
      <div class="actions">${navBtn(best)}<a class="btn btn-text" href="#/r/${best.id}">Details</a></div>
    </article>
    <section class="saved-routes" aria-labelledby="saved-title"><h3 id="saved-title" class="section">Your saved routes</h3>
    ${favorites.some((id) => view.byId[id]) ? `<div class="list">${favorites.filter((id) => view.byId[id]).map((id) => `<a class="row" href="#/r/${id}">${badge(view.byId[id].score)}<span class="text"><span class="t">${esc(ROUTE_INFO[id].name)}</span><span class="st">${esc(topIssue(view.byId[id]))}</span></span><span class="chev" aria-hidden="true">›</span></a>`).join('')}</div>` : '<p class="meta">Open a route and choose Save route to keep it here for this area.</p>'}
    <p class="meta">Saved on this browser. Ratings still use the current check.</p></section>
    <h3 class="section">Other routes</h3>
    <div class="list">
      ${others.map((r) => `
        <a class="row" href="#/r/${r.id}">
          ${badge(r.score)}
          <span class="text"><div class="t">${esc(ROUTE_INFO[r.id].name)}</div><div class="st">${minutes(r)} · ${esc(topIssue(r))}</div></span>
          <span class="chev">›</span>
        </a>`).join('')}
    </div>
    <h3 class="section">More</h3>
    <div class="list">
      <a class="row small" href="#/alerts"><span class="lead-icon">🔔</span><span class="text"><div class="t">Alerts</div><div class="st">Get this sent to your phone at a time you pick</div></span><span class="chev">›</span></a>
      <a class="row small" href="#/report"><span class="lead-icon">✍️</span><span class="text"><div class="t">Help fill the gaps</div><div class="st">Tell us what a crossing is really like in the rain</div></span><span class="chev">›</span></a>
      <a class="row small" href="#/how"><span class="lead-icon">❓</span><span class="text"><div class="t">How to read this</div></span><span class="chev">›</span></a>
      <a class="row small" href="#/settings"><span class="lead-icon">⚙️</span><span class="text"><div class="t">Settings</div></span><span class="chev">›</span></a>
      <a class="row small" href="#/sources"><span class="lead-icon">ℹ️</span><span class="text"><div class="t">Sources</div></span><span class="chev">›</span></a>
      <a class="row small" href="#/privacy"><span class="lead-icon">🔒</span><span class="text"><div class="t">Privacy &amp; terms</div></span><span class="chev">›</span></a>
    </div>
    <p class="fine">A guide built from public data, not a safety guarantee. Water over the road: turn around.</p>`;
}

function routeScreen(rid) {
  const r = view.byId[rid];
  const info = ROUTE_INFO[rid];
  const flagged = r.points.filter((p) => riskScore(p) !== 1);
  const normal = r.points.filter((p) => riskScore(p) === 1);
  const row = (p) => `
    <a class="row" href="#/r/${rid}/${p.id}">
      ${badge(riskScore(p))}
      <span class="text"><div class="t">${esc(p.short)}</div><div class="st">${esc(p.why)}</div></span>
      <span class="chev">›</span>
    </a>`;
  return `
    <article class="hero">
      <div class="hero-top"><div style="flex:1"><p class="meta" style="margin:0">${minutes(r)} · ${esc(viaText(rid))}</p></div>${badgeWithWord(r.score)}</div>
      <div class="angel"><span class="face" aria-hidden="true">😇</span><p>${esc(angelText(r))}</p></div>
    </article>
    ${saveButton(rid)}<p id="save-notice" class="meta" role="status">${esc(saveNotice)}</p>
    ${flagged.length ? `<h3 class="section">Working against it</h3><div class="list">${flagged.map(row).join('')}</div>` : ''}
    ${normal.length ? `<h3 class="section">${flagged.length ? 'Looks normal' : 'Every stretch looks normal'}</h3><div class="list">${normal.map(row).join('')}</div>` : ''}
    <div class="bottom-bar">${navBtn(r)}</div>`;
}

function stretchScreen(rid, fpId) {
  const p = view.fpResults[fpId];
  const fp = FAILURE_POINTS.find((f) => f.id === fpId);
  const s = riskScore(p);
  return `
    <div class="summary">${badgeWithWord(s)}<div><p>${esc(LEVEL_SENTENCE[p.level])}</p><p class="where">${esc(fp.name)}, ${esc(fp.where)}.</p></div></div>
    <h3 class="section">What each source says</h3>
    <div class="list">
      ${p.checks.map((c, i) => {
        const [icon, label] = SRC[c.src] ?? ['•', c.src];
        return `
        <details class="src" data-i="${i}" ${openSource === i ? 'open' : ''}>
          <summary class="row"><span class="lead-icon">${icon}</span>
            <span class="text"><div class="t">${label}</div><div class="st"><span class="dot ${c.level}" style="display:inline-block;margin-right:6px"></span>${esc(c.why)}</div></span>
            <span class="chev">›</span></summary>
          <div class="more"><p>${esc(c.why)}</p>${c.detail ? `<p>${esc(c.detail)}</p>` : ''}</div>
        </details>`;
      }).join('')}
    </div>
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
    <h4>The number</h4>
    <ul class="legend">
      ${[1, 2, 3, 4, 5].map((n) => `<li>${badge(n)}<span><b>${WORD[n]}.</b> ${['Nothing in the data points to water.', 'Some water around; usually passable. Look as you go.', 'Water likely at or near the road.', 'Several signs agree water is at the road.', 'The county closed it, or a flood is running.'][n - 1]}</span></li>`).join('')}
      <li>${badge(null)}<span><b>No data.</b> Not the same as fine.</span></li>
    </ul>
    <h4>Using it</h4>
    <p>The top card is the route with the least going against it. The numbers are the same whichever way you're driving. Tap <b>Navigate</b> to drive it in Google Maps; it heads for I-10 when you're in Avra Valley, and back to Trico &amp; El Tiro when you're not. Tap <b>Details</b> or any route to see its stretches, then any stretch to see what each source says. The map follows along.</p>
    <p>A route's number is its worst stretch. The map only marks stretches that aren't normal.</p>
    <h4>Limits</h4>
    <p>Built from public, provisional data that can be late or wrong. What you see at the crossing comes first.</p>
  </div>`;
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
    body: JSON.stringify({ action: 'push', topic: pushTopic(), area, times: a.times, days: a.days, mode: a.mode }) }).catch(() => {});
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
    const body = `Test alert. Right now: take ${nm(best)} (${best.score}/5 ${word[best.score]}, ${Math.round(best.minutes)} min). `
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

function privacyScreen() {
  return `<div class="page">
    <h4>What you get</h4>
    <p>FLOODplain is a free, non-commercial road-flooding guide for Avra Valley, AZ. If you sign up for texts, you get a short message with the current flood risk for the routes between Avra Valley and I-10, one text at each time you choose, at most 4 texts a day, plus a one-time sign-up code. No marketing.</p>
    <h4>Signing up and stopping</h4>
    <p>You sign up on the Alerts page and confirm with a 4-digit code we text you. To stop, reply <b>STOP</b> to any message or use <b>Stop texts</b> on the Alerts page. Reply <b>HELP</b> for help. Message and data rates may apply. Carriers aren't liable for delayed or undelivered messages.</p>
    <h4>Your information</h4>
    <p>We keep only your phone number, the times and days you chose, and when we last texted you. It's stored privately by the person who runs FLOODplain and used only to send these texts. It's never sold, shared or used for marketing. Stopping texts deletes your number.</p>
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
  const w = where();
  const sub = w.screen !== 'home' || location.hash==='#/map';
  $('.appbar').classList.toggle('sub', sub);
  $('#back').hidden = !sub;
  $('#logo').hidden = sub;
  $('#refresh').hidden = sub && !['route', 'stretch'].includes(w.screen);
  const titles = {
    home: ["FLOODplain", subtitle()],
    route: [ROUTE_INFO[w.route]?.name, 'Route'],
    stretch: [view.fpResults[w.fp]?.short, ROUTE_INFO[w.route]?.name],
    how: ['How to read this', ''], settings: ['Settings', ''], sources: ['Sources', ''], alerts: ['Alerts', 'Text or phone notification'], report: ['Help fill the gaps', 'Tell us about a crossing'], privacy: ['Privacy & terms', "FLOODplain texts"],
  }[w.screen];
  $('#title').textContent = location.hash==='#/map'?'Explore map':titles[0] ?? '';
  $('#subtitle').textContent = titles[1] ?? '';
  $('#map').hidden = ['how', 'settings', 'sources', 'alerts', 'privacy', 'report'].includes(w.screen);
  window.dispatchEvent(new Event('flood-before-screen-render'));
  $('#screen').innerHTML = {
    home: homeScreen, route: () => routeScreen(w.route), stretch: () => stretchScreen(w.route, w.fp),
    how: howScreen, settings: settingsScreen, sources: sourcesScreen, alerts: alertsScreen, privacy: privacyScreen, report: () => reportScreen(w.fp),
  }[w.screen]();
  if (['home', 'route', 'stretch'].includes(w.screen)) {
    const status = document.createElement('aside');
    status.className = 'check-status';
    status.innerHTML = '<strong id="check-age"></strong><p>Check time is not the age of every reading. Open a crossing for source details.</p>' + (data.errors.length ? `<p>${esc(data.errors.join('; '))}.</p>` : '');
    const warnings=(data.nws??[]).filter(a=>/flood/i.test(a.event));
    if(warnings.length){const warning=document.createElement('aside');warning.className='area-warning';warning.setAttribute('role','status');warning.innerHTML='<strong>Weather alerts in the source area</strong>'+warnings.map(a=>'<p>'+esc(a.headline||a.event)+'</p>').join('')+'<small>Area alerts do not establish conditions at every crossing. Review route details and barricades.</small>';$('#screen').prepend(warning)}
    $('#screen').prepend(status);
    updateCheckAge();
  }
  wire(w);
  const retainedCenter=map.getCenter(),retainedZoom=map.getZoom();
  drawMap(w);
  if(render.lastHash===location.hash || location.hash==='#/map' || render.lastHash==='#/map')map.setView(retainedCenter,retainedZoom,{animate:false});
  render.lastHash=location.hash;
  window.dispatchEvent(new Event('flood-screen-rendered'));
}
function subtitle() {
  const t = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return `${areaInfo().name} ↔ I-10 · ${t(data.now)}${data.errors.length ? ` · public ${data.errors.join(', ')}` : ''}`;
}
function updateCheckAge() {
  const el = $('#check-age');
  if (el && data) el.textContent = checkAge(data.now, Date.now(), navigator.onLine);
}
function wire(w) {
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
  document.querySelectorAll('[data-nav]').forEach((b) => b.addEventListener('click', () => navigate(b.dataset.nav)));
  if (w.screen === 'alerts') wireAlerts();
  if (w.screen === 'report') wireReport();
  for (const [id, key] of [['#apikey', 'apiKey'], ['#dest', 'dest']]) {
    const el = $(id);
    if (el) el.addEventListener('change', (e) => { store.set(key, e.target.value.trim() || null); if (key === 'apiKey') check(); });
  }
  void w;
}

// ---------------- map ----------------
const map = L.map('map', { zoomSnap: 0.25, zoomControl: false, attributionControl: true });
const streetTiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© OpenStreetMap' }).addTo(map);
map.attributionControl.setPrefix(false);
const layer = L.layerGroup().addTo(map);
mountFloodLayers(map,{routeLayer:layer,streetTiles});
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
function drawMap(w) {
  if ($('#map').hidden) return;
  map.invalidateSize();
  layer.clearLayers();
  const focus = w.route ?? view.rec.best.id;
  for (const f of routeFeatures) {
    const on = f.properties.id === focus;
    L.geoJSON(f, { style: { color: on ? '#3c3b38' : '#9b9a94', weight: on ? 6 : 3, opacity: on ? 0.9 : 0.5 }, interactive: false }).addTo(layer);
  }
  // The fixed places: valley hub and the two I-10 exits.
  for (const pl of PLACES.filter((x) => (x.area ?? 'avra') === area)) {
    L.circleMarker([pl.lat, pl.lon], { radius: 6, color: '#fff', weight: 2, fillColor: '#3c3b38', fillOpacity: 1, interactive: false }).addTo(layer);
    L.marker([pl.lat, pl.lon], { icon: L.divIcon({ className: 'place-pin', html: `<span class="place ${pl.side ?? 'right'}">${esc(pl.name)}</span>`, iconSize: [0, 0] }), interactive: false }).addTo(layer);
  }
  // Pins only where something is off, plus the stretch being viewed.
  const inArea = new Set(routeFeatures.map((f) => f.properties.id));
  const visible = FAILURE_POINTS.filter((fp) => {
    if (!fp.routes.some((rid) => inArea.has(rid))) return false; // other area
    const s = riskScore(view.fpResults[fp.id]);
    const onRoute = w.screen === 'home' || fp.routes.includes(focus);
    return (onRoute && s !== 1) || fp.id === w.fp;
  });
  for (const fp of visible) {
    const s = riskScore(view.fpResults[fp.id]);
    for (const rid of fp.routes.filter((x) => inArea.has(x))) {
      for (const line of lineCoords(routeFeatures.find((f) => f.properties.id === rid).geometry)) {
        for (const run of stretchAround(line, fp.lat, fp.lon, fp.kind === 'road' ? 2500 : 450)) {
          L.polyline(run, { color: COLOR[s] ?? '#8e8d88', weight: rid === focus ? 9 : 5, opacity: 0.95, lineCap: 'round', interactive: false }).addTo(layer);
        }
      }
    }
    const rid = fp.routes.includes(focus) ? focus : fp.routes.find((x) => inArea.has(x));
    L.marker([fp.lat, fp.lon], { icon: L.divIcon({ className: '', html: `<div class="pin ${s ? `s${s}` : 'sq'}">${s ?? '?'}</div>`, iconSize: [28, 28], iconAnchor: [14, 14] }) })
      .on('click', () => { location.hash = `#/r/${rid}/${fp.id}`; })
      .addTo(layer);
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
  } else {
    map.fitBounds(allBounds, opts);
  }
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
    const nextView = compute(next);
    data = next;
    view = nextView;
    $('#load-status').hidden = true;
    window.dispatchEvent(new CustomEvent('flood-check-status',{detail:next.nws?.some(a=>/flood warning/i.test(a.event))?'Area flood warning · open Routes for details':next.errors.length?'Live check incomplete · '+next.errors.join('; '):'Live check completed · readings have their own timestamps'}));
    render();
  } catch (e) {
    window.dispatchEvent(new CustomEvent('flood-check-status',{detail:'Refresh failed · retained readings, not a fresh check'}));
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
async function init() {
  allRoutes = (await getJson('data/routes.geojson')).features;
  useArea(store.get('area') ?? 'avra');
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
