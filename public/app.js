import * as cfg from './config.js';
import {
  parseContinuous, summarizeFlow, rateFailurePoint, rateRoutes, recommend, googleMapsUrl,
  riskScore, routeScore, goodSigns, againstIt,
} from './logic.js';

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
const badge = (n, lg) => `<span class="badge ${lg ? 'lg' : ''} ${n ? `s${n}` : 'sq'}" role="img" aria-label="Risk factor ${n ?? 'unknown'} of 5">${n ?? '?'}</span>`;
const badgeWithWord = (n) => `<span class="badge-wrap">${badge(n, true)}<span class="badge-word">${n ? WORD[n] : 'No data'}</span></span>`;

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
  const settle = async (name, p) => { try { return await p; } catch { errors.push(name); return null; } };
  const sites = Object.keys(USGS_SITES);
  const [flowsArr, closures, alert, nws] = await Promise.all([
    Promise.all(sites.map((s) => settle('river gauges', loadUsgs(s)))),
    settle('county barricades', loadClosures()),
    settle('rain gauges', loadAlert()),
    settle('weather service', loadNws()),
  ]);
  const flows = Object.fromEntries(sites.map((s, i) => [s, summarizeFlow(flowsArr[i], now, STALE_MS)]));
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
  const nwsQuiet = Array.isArray(d.nws) && !d.nws.some((a) => /flood/i.test(a.event));
  return { fpResults, rated, rec: recommend(rated), nwsQuiet, byId: Object.fromEntries(rated.map((r) => [r.id, r])) };
}

// Screens are addressed by the URL hash so the phone's back button works:
//   #/               home
//   #/r/<route>      one route
//   #/r/<route>/<fp> one stretch on that route
//   #/how  #/settings  #/sources
function where() {
  const p = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (p[0] === 'r' && view?.byId[p[1]]) return { screen: p[2] ? 'stretch' : 'route', route: p[1], fp: p[2] };
  if (p[0] === 'report') return { screen: 'report', fp: p[1] };
  if (['how', 'settings', 'sources', 'alerts', 'privacy'].includes(p[0])) return { screen: p[0] };
  return { screen: 'home' };
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
        : `<label class="field">Mobile number<input id="t-phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="520 555 0123" value="${esc(textFlow.phone)}"></label>
           <label class="field">Access key (optional, for more than 2 texts a day)<input id="t-key" type="text" autocomplete="off" value="${esc(textFlow.key ?? '')}"></label>
           <p class="consent">By tapping <b>Text me a code</b>, you agree to get recurring Wash Watch road-flooding texts: one text at each time you pick, at most 4 msgs/day, plus a one-time sign-up code. Msg &amp; data rates may apply. Reply STOP to cancel, HELP for help. No marketing; your number is never shared. <a href="#/privacy">Privacy &amp; terms</a></p>
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
  <h3 class="section">Text message</h3>
  <div class="page">
    ${textFlow.msg ? `<p class="note">${esc(textFlow.msg)}</p>` : ''}
    ${textCard}
    <p class="fine" style="text-align:left">Texts start once the paid text sender is connected.</p>
  </div>
  ${cfg.TEXT_API ? `<h3 class="section">Need more texts?</h3>
  <div class="page">
    ${textFlow.reqMsg ? `<p class="note">${esc(textFlow.reqMsg)}</p>` : ''}
    <p>Without a key, texts are limited to 2 a day. Ask the person who runs Wash Watch for an access key:</p>
    <label class="field">How to reach you<input id="r-contact" type="text" autocomplete="off" placeholder="Name, phone or email"></label>
    <label class="field">Message<textarea id="r-msg" rows="3" placeholder="How many texts a day, and why"></textarea></label>
    <button type="button" class="btn btn-primary" id="r-send">Send request</button>
  </div>` : ''}
  <h3 class="section">Push notification (any phone, free)</h3>
  <div class="page">
    ${textFlow.pushMsg ? `<p class="note">${esc(textFlow.pushMsg)}</p>` : ''}
    <ol class="steps">
      <li>Install the free <b>ntfy</b> app: <a href="https://play.google.com/store/apps/details?id=io.heckel.ntfy" target="_blank" rel="noopener">Android</a> · <a href="https://apps.apple.com/us/app/ntfy/id1625396347" target="_blank" rel="noopener">iPhone</a></li>
      <li>Subscribe to your private channel: <a class="btn btn-primary" href="ntfy://ntfy.sh/${pushTopic()}">Subscribe in ntfy</a><span class="fine">Or add this topic in ntfy: <code>${pushTopic()}</code></span></li>
      <li>Save your times and days: <button type="button" class="btn btn-primary" id="p-save" ${cfg.TEXT_API ? '' : 'disabled'}>Save schedule</button></li>
    </ol>
    ${cfg.TEXT_API ? '<button type="button" class="btn btn-text" id="p-stop">Stop push notifications</button>' : '<p class="fine" style="text-align:left">Push notifications start once the alert service is connected.</p>'}
    <p class="fine" style="text-align:left">No account and no phone number. The channel name is private to this phone; don't share it.</p>
  </div>`;
}

async function textApi(body) {
  const r = await fetch(cfg.TEXT_API, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'text/plain;charset=utf-8' } });
  return r.json();
}
function wireAlerts() {
  // Wakes the alert service (it starts its own every-minute timer on first contact).
  if (cfg.TEXT_API && !wireAlerts.pinged) { wireAlerts.pinged = true; fetch(cfg.TEXT_API).catch(() => {}); }
  const a = { times: ['05:45'], days: 'w:1,2,3,4,5', mode: 'all', ...(store.get('alerts') ?? {}) };
  const save = () => { store.set('alerts', a); render(); };
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
  $('#p-save')?.addEventListener('click', async () => {
    try {
      const r = await textApi({ action: 'push', topic: pushTopic(), area, times: a.times, days: a.days, mode: a.mode });
      textFlow.pushMsg = r.ok ? `Saved: ${a.times.map(clock).join(' & ')}, ${daysSummary(a.days)}.` : (r.error || 'Something went wrong.');
    } catch { textFlow.pushMsg = 'Couldn’t reach the alert service. Try again in a minute.'; }
    render();
  });
  $('#p-stop')?.addEventListener('click', async () => {
    try { await textApi({ action: 'pushstop', topic: pushTopic() }); textFlow.pushMsg = 'Push notifications stopped.'; } catch { textFlow.pushMsg = 'Couldn’t reach the alert service.'; }
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
      reportMsg = 'Thanks! Sent. It goes straight to the person who runs Wash Watch.';
      location.replace('#/report');
    } catch (e) { reportMsg = 'Couldn’t send just now. Try again in a minute.'; }
    render();
  });
}

function privacyScreen() {
  return `<div class="page">
    <h4>What you get</h4>
    <p>Wash Watch is a free, non-commercial road-flooding guide for Avra Valley, AZ. If you sign up for texts, you get a short message with the current flood risk for the routes between Avra Valley and I-10, one text at each time you choose, at most 4 texts a day, plus a one-time sign-up code. No marketing.</p>
    <h4>Signing up and stopping</h4>
    <p>You sign up on the Alerts page and confirm with a 4-digit code we text you. To stop, reply <b>STOP</b> to any message or use <b>Stop texts</b> on the Alerts page. Reply <b>HELP</b> for help. Message and data rates may apply. Carriers aren't liable for delayed or undelivered messages.</p>
    <h4>Your information</h4>
    <p>We keep only your phone number, the times and days you chose, and when we last texted you. It's stored privately by the person who runs Wash Watch and used only to send these texts. It's never sold, shared or used for marketing. Stopping texts deletes your number.</p>
    <h4>No guarantee</h4>
    <p>Ratings come from public, provisional data (USGS, Pima County, National Weather Service) and can be late or wrong. What you see at the crossing comes first. Never drive into water crossing the road.</p>
    <h4>Contact</h4>
    <p>Reply HELP to any Wash Watch text to reach the person who runs it.</p>
  </div>`;
}
function sourcesScreen() {
  return `<div class="list">${LINKS.map(([t, u]) => `<a class="row small" href="${u}" target="_blank" rel="noopener"><span class="text"><div class="t">${esc(t)}</div></span><span class="chev">↗</span></a>`).join('')}</div>
    <p class="fine">River gauges: USGS. Rain and stream sensors: Pima County Regional Flood Control District. Barricades: Pima County DOT. Alerts: National Weather Service. Roads © OpenStreetMap contributors. All provisional.</p>`;
}

// ---------------- render ----------------
function render() {
  if (!view) return;
  const w = where();
  const sub = w.screen !== 'home';
  $('.appbar').classList.toggle('sub', sub);
  $('#back').hidden = !sub;
  $('#logo').hidden = sub;
  $('#refresh').hidden = sub && !['route', 'stretch'].includes(w.screen);
  const titles = {
    home: ['Wash Watch', subtitle()],
    route: [ROUTE_INFO[w.route]?.name, 'Route'],
    stretch: [view.fpResults[w.fp]?.short, ROUTE_INFO[w.route]?.name],
    how: ['How to read this', ''], settings: ['Settings', ''], sources: ['Sources', ''], alerts: ['Alerts', 'Text or phone notification'], report: ['Help fill the gaps', 'Tell us about a crossing'], privacy: ['Privacy & terms', 'Wash Watch texts'],
  }[w.screen];
  $('#title').textContent = titles[0] ?? '';
  $('#subtitle').textContent = titles[1] ?? '';
  $('#map').hidden = ['how', 'settings', 'sources', 'alerts', 'privacy', 'report'].includes(w.screen);
  $('#screen').innerHTML = {
    home: homeScreen, route: () => routeScreen(w.route), stretch: () => stretchScreen(w.route, w.fp),
    how: howScreen, settings: settingsScreen, sources: sourcesScreen, alerts: alertsScreen, privacy: privacyScreen, report: () => reportScreen(w.fp),
  }[w.screen]();
  wire(w);
  drawMap(w);
}
function subtitle() {
  const t = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return `${areaInfo().name} ↔ I-10 · ${t(data.now)}${data.errors.length ? ` · no ${data.errors.join(', ')}` : ''}`;
}
function wire(w) {
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
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© OpenStreetMap' }).addTo(map);
map.attributionControl.setPrefix(false);
const layer = L.layerGroup().addTo(map);
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
async function check() {
  $('#refresh').classList.add('spin');
  data = await gather();
  view = compute(data);
  $('#refresh').classList.remove('spin');
  render();
}
async function init() {
  allRoutes = (await getJson('data/routes.geojson')).features;
  useArea(store.get('area') ?? 'avra');
  map.fitBounds(allBounds, { animate: false });
  window.addEventListener('hashchange', () => { openSource = null; render(); window.scrollTo(0, 0); });
  $('#back').addEventListener('click', () => {
    const w = where();
    // Go back through the app's own history; if the app was opened deep, go to the parent screen.
    if (history.length > 1) history.back();
    else location.replace(w.screen === 'stretch' ? `#/r/${w.route}` : '#/');
  });
  $('#refresh').addEventListener('click', check);
  await check();
  setInterval(check, REFRESH_MS);
}
init().catch((e) => { $('#screen').innerHTML = `<p class="loading">Couldn’t load: ${esc(e.message)}</p>`; });
