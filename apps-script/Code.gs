/**
 * FLOODplain alerts, run as a Google Apps Script web app.
 *
 * - Text sign-ups (phone, times, days, mode) live in a private Google Sheet owned
 *   by the account that deploys this script. Nothing personal goes to GitHub.
 * - Every minute it reads the latest check published by the FLOODplain repo and:
 *     texts everyone whose time (Arizona, any minute) has come, and
 *     posts to the free ntfy topics washwatch-HHMM-{wd|all}-{all|off}.
 *   Missed minutes (the trigger can skip) are caught up, up to 10 minutes back.
 * - Texts go through Twilio when these Script properties are set:
 *     TWILIO_SID, TWILIO_TOKEN, TWILIO_FROM  (any carrier; STOP replies handled by Twilio)
 *   Otherwise they go through Verizon's email-to-text (Verizon numbers only), which
 *   Verizon ends on March 31, 2027. Subscribers and the owner are told on
 *   March 1, 2027 and April 1, 2027.
 *
 * Limits: 2 texts a day per number. An access key (rows the owner adds to the
 * "keys" tab of the private sheet: key | texts_per_day | note) raises that.
 * DAILY_TEXT_BUDGET caps all texts per day so a bill can't run away.
 * People can ask the owner for a key through the app; that arrives as an email
 * to the owner, so the owner's address is never shown publicly.
 *
 * Deploy: Deploy > New deployment > Web app > Execute as: Me, Who has access: Anyone.
 */
const CONFIG = {
  VERDICT_URL: 'https://raw.githubusercontent.com/godfather38/floodplain/data/verdict.json',
  // The hourly live SFINCS run (the same files the app's map reads, preview/geo3d/src/runs.js).
  LIVE_SFINCS: 'https://raw.githubusercontent.com/Godfather38/FLOODplain/live-model/live/',
  APP_URL: 'https://godfather38.github.io/FLOODplain/',
  GATEWAY: 'vtext.com',
  TZ: 'America/Phoenix',
  HEADS_UP: '2027-03-01',
  ENDED: '2027-04-01',
  MAX_TIMES: 4,
  FREE_PER_DAY: 2,
  DAILY_TEXT_BUDGET: 150,     // all texts, all people, per day (about $1.50/day max on Twilio)
  CODES_PER_NUMBER_PER_DAY: 3,
  REQUESTS_PER_DAY: 10,
  CATCH_UP_MIN: 10,
  NTFY: 'https://ntfy.sh/washwatch',
  MAX_NEW_SIGNUPS_PER_DAY: 40,
};
const HEADER = ['phone', 'times', 'days', 'mode', 'verified', 'code', 'code_sent', 'last_sent', 'created', 'key', 'sent_day', 'sent_count', 'codes_day', 'area'];
const KEYS_HEADER = ['key', 'texts_per_day', 'note'];
// Column numbers (1-based) in the subscribers tab.
const C = { phone: 1, times: 2, days: 3, mode: 4, verified: 5, code: 6, codeSent: 7, lastSent: 8, created: 9, key: 10, sentDay: 11, sentCount: 12, codesDay: 13, area: 14 };
const AREA_IDS = ['avra', 'picture-rocks'];
const validArea_ = (a) => (AREA_IDS.includes(a) ? a : 'avra');

// Run once from the editor (pick "setup" in the toolbar, press Run) if texts don't start on their own.
function setup() { ensureTrigger_(); sheet_(); keysSheet_(); return 'ok'; }

// ---------- web endpoints ----------
function doGet(e) {
  ensureTrigger_();
  // The app asks for the county rain/stream feed through here (the county site blocks browsers).
  // Visit counter: the app sends ?hit=1 once per visit (&new=1 the first time on a device).
  if (e && e.parameter && e.parameter.hit === '1') {
    countVisit_(e.parameter.new === '1');
    return json_({ ok: true });
  }
  // River gauges for the app in one request (USGS limits phones that ask often).
  if (e && e.parameter && e.parameter.feed === 'usgs') {
    computeVerdicts_();
    const u = CacheService.getScriptCache().get('usgs');
    return json_(u ? JSON.parse(u) : { error: 'unavailable' });
  }
  if (e && e.parameter && e.parameter.fail) {
    countFailures_(String(e.parameter.fail));
    return json_({ ok: true });
  }
  if (e && e.parameter && e.parameter.feed === 'health') return json_({ ok: true, sources: healthState_() });
  // The SFINCS road forecast the texts and pushes are using, per route.
  if (e && e.parameter && e.parameter.feed === 'roadforecast') {
    computeVerdicts_();
    const f = CacheService.getScriptCache().get('roadforecast');
    return json_(f ? JSON.parse(f) : { status: 'unavailable', reason: 'Not computed yet' });
  }
  if (e && e.parameter && e.parameter.feed === 'forecasts') return json_(sharedForecasts_(String(e.parameter.paths || '')));
  // Everything the app reads on each check, in one request.
  if (e && e.parameter && e.parameter.feed === 'all') {
    computeVerdicts_();
    const cache = CacheService.getScriptCache();
    const part = (k) => { const v = cache.get(k); return v ? JSON.parse(v) : null; };
    return json_({ usgs: part('usgs'), alert: part('alert'), roadEvents: roadEventsFeed_(), drive: driveReports_() });
  }
  if (e && e.parameter && e.parameter.feed === 'roadevents') {
    computeVerdicts_();
    const feed = roadEventsFeed_();
    return json_(feed || { error: 'unavailable' });
  }
  if (e && e.parameter && e.parameter.feed === 'alert') {
    computeVerdicts_();
    const snap = CacheService.getScriptCache().get('alert');
    return json_(snap ? JSON.parse(snap) : { error: 'unavailable' });
  }
  return json_({ ok: true, service: 'wash-watch-alerts', sender: twilio_() ? 'any' : 'verizon', freePerDay: CONFIG.FREE_PER_DAY });
}

function doPost(e) {
  ensureTrigger_();
  let body = {};
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'bad request' }); }
  if (body.action === 'request') return json_(request_(body));
  if (body.action === 'report') return json_(report_(body));
  if (body.action === 'drive') {
    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try { return json_(drive_(body)); } finally { lock.releaseLock(); }
  }
  if (body.action === 'push' || body.action === 'pushstop') {
    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try { return json_(body.action === 'push' ? push_(body) : pushStop_(body)); } finally { lock.releaseLock(); }
  }
  const phone = String(body.phone || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
  if (!/^\d{10}$/.test(phone)) return json_({ ok: false, error: 'Enter a 10-digit US number.' });
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    if (body.action === 'signup') return json_(signup_(phone, body));
    if (body.action === 'confirm') return json_(confirm_(phone, String(body.code || '')));
    if (body.action === 'stop') return json_(stop_(phone));
    if (body.action === 'waitlist') return json_(waitlist_(phone, body));
    return json_({ ok: false, error: 'unknown action' });
  } finally {
    lock.releaseLock();
  }
}

function signup_(phone, b) {
  const key = String(b.key || '').trim();
  const limit = key ? keyLimit_(key) : CONFIG.FREE_PER_DAY;
  if (key && !limit) return { ok: false, error: 'That access key isn\'t valid.' };
  const times = [...new Set((b.times || []).map(String))].filter(validTime_).slice(0, CONFIG.MAX_TIMES);
  if (!times.length) return { ok: false, error: 'Pick at least one time.' };
  if (times.length > limit) {
    return { ok: false, error: `Texts are limited to ${limit} a day${key ? ' for this key' : ' without an access key'}. Pick ${limit} time${limit > 1 ? 's' : ''}, or ask for more below.` };
  }
  const days = validDays_(b.days);
  const mode = b.mode === 'off' ? 'off' : 'all';
  const sh = sheet_();
  const row = findRow_(sh, phone);
  const now = Date.now();
  const today = today_();
  let codesToday = 0;
  if (row) {
    const last = Number(sh.getRange(row, C.codeSent).getValue()) || 0;
    if (now - last < 2 * 60 * 1000) return { ok: false, error: 'A code was just sent. Wait 2 minutes.' };
    const cd = String(sh.getRange(row, C.codesDay).getValue()).split(' ');
    codesToday = cd[0] === today ? Number(cd[1]) || 0 : 0;
    if (codesToday >= CONFIG.CODES_PER_NUMBER_PER_DAY) return { ok: false, error: 'Too many codes for this number today. Try tomorrow.' };
  } else if (newToday_() >= CONFIG.MAX_NEW_SIGNUPS_PER_DAY) {
    return { ok: false, error: 'Too many sign-ups today. Try tomorrow.' };
  }
  const code = String(Math.floor(1000 + Math.random() * 9000));
  const keep = row ? sh.getRange(row, 1, 1, HEADER.length).getValues()[0] : [];
  const values = [phone, times.join(','), days, mode, false, code, now, keep[C.lastSent - 1] || '',
    row ? keep[C.created - 1] : new Date(), key, keep[C.sentDay - 1] || '', keep[C.sentCount - 1] || 0, `${today} ${codesToday + 1}`, validArea_(b.area)];
  if (row) sh.getRange(row, 1, 1, HEADER.length).setValues([values]);
  else sh.appendRow(values);
  text_(phone, `FLOODplain code: ${code}. Enter it in the app to start your texts. If you didn't ask for this, ignore it.`, true);
  return { ok: true, step: 'confirm' };
}

// Someone asking the owner for more texts; goes to the owner's inbox.
function request_(b) {
  const props = PropertiesService.getScriptProperties();
  const today = today_();
  const [day, n] = String(props.getProperty('requests') || '').split(' ');
  const count = day === today ? Number(n) || 0 : 0;
  if (count >= CONFIG.REQUESTS_PER_DAY) return { ok: false, error: 'Too many requests today. Try tomorrow.' };
  const contact = String(b.contact || '').slice(0, 200).trim();
  const message = String(b.message || '').slice(0, 1500).trim();
  if (!contact || !message) return { ok: false, error: 'Add how to reach you and a short message.' };
  props.setProperty('requests', `${today} ${count + 1}`);
  MailApp.sendEmail(Session.getEffectiveUser().getEmail(), 'FLOODplain: request for more texts',
    `From: ${contact}\n\n${message}\n\nTo give them a key, add a row to the "keys" tab of "FLOODplain text subscribers (private)": key | texts_per_day | note.`);
  return { ok: true, step: 'sent' };
}

// A driver's report about a crossing: saved to the "reports" tab and emailed to the owner.
function report_(b) {
  const props = PropertiesService.getScriptProperties();
  const today = today_();
  const [day, n] = String(props.getProperty('reports') || '').split(' ');
  const count = day === today ? Number(n) || 0 : 0;
  if (count >= 60) return { ok: false, error: 'Lots of reports today. Try tomorrow.' };
  props.setProperty('reports', `${today} ${count + 1}`);
  const answers = b.answers && typeof b.answers === 'object' ? b.answers : {};
  const clip = (x, k) => String(x || '').slice(0, k);
  const ss = sheet_().getParent();
  let rs = ss.getSheetByName('reports');
  if (!rs) { rs = ss.insertSheet('reports'); rs.appendRow(['when', 'area', 'crossing_id', 'crossing', 'answers', 'last_seen_water', 'note']); }
  rs.appendRow([new Date(), clip(b.area, 20), clip(b.fp, 40), clip(b.crossing, 120), JSON.stringify(answers).slice(0, 1500), clip(b.lastSeen, 10), clip(b.note, 1500)]);
  MailApp.sendEmail(Session.getEffectiveUser().getEmail(), `FLOODplain: crossing report, ${clip(b.crossing, 80)}`,
    Object.entries(answers).map(([k, v]) => `${k}: ${v}`).join('\n') + (b.lastSeen ? `\nLast saw water: ${b.lastSeen}` : '') + (b.note ? `\nNote: ${clip(b.note, 1500)}` : '')
    + '\n\nAll reports: the "reports" tab of "FLOODplain text subscribers (private)".');
  return { ok: true, step: 'saved' };
}

// Daily stats in the "stats" tab: date | app opens | new visitors | push channels |
// text subscribers | crossing reports | waitlist. Counts only; nothing about who visited.
function countVisit_(isNew) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const ss = sheet_().getParent();
    let st = ss.getSheetByName('stats');
    if (!st) { st = ss.insertSheet('stats'); st.appendRow(['date', 'app_opens', 'new_visitors', 'push_channels', 'text_subscribers', 'crossing_reports', 'waitlist']); }
    const today = today_();
    const rows = st.getDataRange().getValues();
    let i = rows.findIndex((r, k) => k > 0 && (r[0] instanceof Date ? Utilities.formatDate(r[0], CONFIG.TZ, 'yyyy-MM-dd') : String(r[0])) === today);
    if (i < 0) { st.appendRow([today, 0, 0, 0, 0, 0, 0]); i = st.getLastRow() - 1; }
    const row = i + 1;
    const opens = Number(st.getRange(row, 2).getValue()) || 0;
    const fresh = Number(st.getRange(row, 3).getValue()) || 0;
    const count = (name) => { const sh = ss.getSheetByName(name); return sh ? Math.max(sh.getLastRow() - 1, 0) : 0; };
    st.getRange(row, 2, 1, 6).setValues([[opens + 1, fresh + (isNew ? 1 : 0), count('push'), Math.max(sheet_().getLastRow() - 1, 0), count('reports'), count('waitlist')]]);
  } finally {
    lock.releaseLock();
  }
}

function keyLimit_(key) {
  const rows = keysSheet_().getDataRange().getValues().slice(1);
  const r = rows.find((x) => String(x[0]).trim() === key);
  return r ? Math.max(1, Math.min(Number(r[1]) || 0, CONFIG.MAX_TIMES)) : 0;
}

function confirm_(phone, code) {
  const sh = sheet_();
  const row = findRow_(sh, phone);
  if (!row || String(sh.getRange(row, C.code).getValue()) !== code) return { ok: false, error: 'That code doesn\'t match.' };
  sh.getRange(row, C.verified).setValue(true);
  const times = String(sh.getRange(row, C.times).getValue()).split(',').map(label_).join(' & ');
  const days = daysLabel_(String(sh.getRange(row, C.days).getValue()));
  text_(phone, `FLOODplain texts are on: ${times}, ${days}. To stop, use Stop texts in the app's Alerts screen.`);
  return { ok: true, step: 'done' };
}

function stop_(phone) {
  const ws = waitSheet_();
  const wrow = findRow_(ws, phone);
  if (wrow) ws.deleteRow(wrow);
  const sh = sheet_();
  const row = findRow_(sh, phone);
  if (row) {
    sh.deleteRow(row);
    text_(phone, 'FLOODplain texts stopped.');
  }
  return { ok: true, step: 'stopped' };
}

// Waitlist: people (any carrier) who want one text when texts work for every carrier.
// Kept in the "waitlist" tab: phone | area | joined | texted. Nothing is texted now;
// once Twilio is set up, tick() sends each person one text and marks them texted.
function waitSheet_() {
  const ss = sheet_().getParent();
  let w = ss.getSheetByName('waitlist');
  if (!w) { w = ss.insertSheet('waitlist'); w.appendRow(['phone', 'area', 'joined', 'texted']); }
  return w;
}
function waitlist_(phone, b) {
  const ws = waitSheet_();
  if (findRow_(ws, phone)) return { ok: true, step: 'waitlisted' };
  const today = today_();
  const props = PropertiesService.getScriptProperties();
  const [day, n] = String(props.getProperty('waitlist') || '').split(' ');
  const count = day === today ? Number(n) || 0 : 0;
  if (count >= 100) return { ok: false, error: 'Lots of sign-ups today. Try tomorrow.' };
  props.setProperty('waitlist', `${today} ${count + 1}`);
  ws.appendRow([phone, validArea_(b.area), new Date(), '']);
  return { ok: true, step: 'waitlisted' };
}
function notifyWaitlist_() {
  const ws = waitSheet_();
  const rows = ws.getDataRange().getValues().slice(1);
  let sent = 0;
  for (let i = 0; i < rows.length && sent < 30; i++) {
    if (rows[i][3]) continue;
    const phone = String(rows[i][0]);
    if (!text_(phone, `FLOODplain: texts now work on every carrier. You asked to hear when. Sign up here: ${CONFIG.APP_URL}#/alerts . This is the only waitlist text; nothing more unless you sign up.`)) return;
    ws.getRange(i + 2, 4).setValue(new Date());
    sent += 1;
  }
}

// ---------- every minute ----------
function tick() {
  const health = { computeFailed: false };
  try { tickAlerts_(health); } finally {
    // Subscriber delivery gets priority over optional owner email, even when a
    // repeated minute returns early or a separate alert task fails.
    bestEffortHealth_('owner-delivery', () => ownerHealthWatch_(Date.now(), health.computeFailed));
  }
}
function tickAlerts_(health) {
  try {
    let all = computeVerdicts_();
    // A valid cache hit may cross its age limit before this second check. Try a
    // fresh computation once; normal expiry is not a malformed assessment.
    if (!validOwnerVerdicts_(all, Date.now())) {
      all = computeVerdicts_(true);
      if (!validOwnerVerdicts_(all, Date.now())) throw ownerComputeError_('Assessment output is missing or malformed; inspect the evaluator and area configuration');
    }
  } catch (err) {
    health.computeFailed = true;
    const diagnostic = ownerErrorDiagnostic_(err);
    logOwnerDiagnostic_('compute', diagnostic);
    noteOwnerHealth_([{ id: 'compute', reason: err && err.ownerReason || 'Assessment computation failed', diagnostic, expected: 'Successful evaluation for every area', crossings: 'All configured crossings' }], Date.now());
  }

  const now = new Date();
  const today = Utilities.formatDate(now, CONFIG.TZ, 'yyyy-MM-dd');
  const props = PropertiesService.getScriptProperties();
  if (!twilio_()) sunset_(today, props);
  else notifyWaitlist_();

  // Minutes to handle: everything since the last run, at most CATCH_UP_MIN back.
  const nowMin = Math.floor(now.getTime() / 60000);
  const last = Number(props.getProperty('last_min')) || nowMin - 1;
  const from = Math.max(last + 1, nowMin - CONFIG.CATCH_UP_MIN + 1);
  props.setProperty('last_min', String(nowMin));
  // Separate from scheduled alerts, so a problem here can't stop them.
  try { closureWatch_(); } catch (err) { /* scheduled alerts still run */ }
  if (from > nowMin) return;
  const minutes = [];
  for (let m = from; m <= nowMin; m++) {
    const d = new Date(m * 60000);
    minutes.push({
      hhmm: Utilities.formatDate(d, CONFIG.TZ, 'HH:mm'),
      day: Utilities.formatDate(d, CONFIG.TZ, 'yyyy-MM-dd'),
      weekday: Number(Utilities.formatDate(d, CONFIG.TZ, 'u')) <= 5,
      dow: Number(Utilities.formatDate(d, CONFIG.TZ, 'u')),
      dom: Number(Utilities.formatDate(d, CONFIG.TZ, 'd')),
    });
  }

  // One verdict per area, worked out once per run.
  const verdicts = {};
  const forArea = (a) => {
    const id = validArea_(a);
    if (!verdicts[id]) {
      const v = verdict_(id);
      const fresh = !!(v && Date.now() - Date.parse(v.at) < 45 * 60 * 1000);
      verdicts[id] = { v, fresh, msg: fresh ? v.sms : 'FLOODplain couldn\'t get fresh data just now. Check the app before you go.' };
    }
    return verdicts[id];
  };

  // Push notifications (ntfy): each phone has its own private topic and schedule.
  const ps = pushSheet_();
  ps.getDataRange().getValues().slice(1).forEach((r, i) => {
    const [topic, times, days, mode, lastSent, , pArea] = r;
    for (const m of minutes) {
      const key = `${m.day} ${m.hhmm}`;
      if (lastSent === key || !String(times).split(',').includes(m.hhmm) || !dueOn_(String(days), m)) continue;
      ps.getRange(i + 2, 5).setValue(key);
      const { v, fresh, msg } = forArea(pArea);
      if (!(mode === 'off' && fresh && !v.off)) ntfy_(String(topic), v, msg);
    }
  });

  // Texts, within each person's daily limit and the overall daily budget.
  const sh = sheet_();
  const rows = sh.getDataRange().getValues().slice(1);
  rows.forEach((r, i) => {
    const phone = String(r[C.phone - 1]);
    if (r[C.verified - 1] !== true) return;
    const limit = r[C.key - 1] ? keyLimit_(String(r[C.key - 1])) || CONFIG.FREE_PER_DAY : CONFIG.FREE_PER_DAY;
    for (const m of minutes) {
      const key = `${m.day} ${m.hhmm}`;
      if (r[C.lastSent - 1] === key || !String(r[C.times - 1]).split(',').includes(m.hhmm)) continue;
      if (!dueOn_(String(r[C.days - 1]), m)) continue;
      sh.getRange(i + 2, C.lastSent).setValue(key);
      r[C.lastSent - 1] = key;
      const { v, fresh, msg } = forArea(r[C.area - 1]);
      if (r[C.mode - 1] === 'off' && fresh && !v.off) continue;
      let count = r[C.sentDay - 1] === m.day ? Number(r[C.sentCount - 1]) || 0 : 0;
      if (count >= limit) continue;
      if (!text_(phone, msg)) continue;
      count += 1;
      r[C.sentDay - 1] = m.day; r[C.sentCount - 1] = count;
      sh.getRange(i + 2, C.sentDay, 1, 2).setValues([[m.day, count]]);
    }
  });
}

// The verdict, computed here with the app's own rules (bundled in FLOODplain.gs).
// Cached 4 minutes. Falls back to the copy GitHub publishes if computing fails.
function computeVerdict_(area) {
  const all = computeVerdicts_();
  return all ? all[validArea_(area)] : null;
}
const ROAD_EVENTS_KEEP_S = 21600;
function roadEventsFeed_() {
  const cache = CacheService.getScriptCache();
  const fresh = cache.get('roadevents');
  if (fresh) return { ...JSON.parse(fresh), stale: false };
  const good = cache.get('roadevents_good');
  return good ? { ...JSON.parse(good), stale: true } : null;
}

// Feed health. Tells the owner once when a source has been down for 30 minutes, and once when it's back.
const HEALTH_DOWN_MS = 30 * 60 * 1000;
function healthState_() { return JSON.parse(PropertiesService.getScriptProperties().getProperty('health') || '{}'); }
function noteHealth_(results, now) {
  const state = healthState_();
  for (const [name, ok] of Object.entries(results)) {
    const s = state[name] || {};
    if (ok) { s.lastOk = now; delete s.downSince; } else if (!s.downSince) s.downSince = now;
    state[name] = s;
  }
  PropertiesService.getScriptProperties().setProperty('health', JSON.stringify(state));
}
// Instant push: tell people who opted in when a closure appears or clears on their area's routes.
const MAX_CLOSURE_PUSHES_PER_DAY = 12;
function closureWatch_() {
  const all = computeVerdicts_();
  if (!all) return;
  const props = PropertiesService.getScriptProperties();
  const today = today_();
  const rows = pushSheet_().getDataRange().getValues().slice(1);
  for (const id of AREA_IDS) {
    const v = all[id];
    if (!v || !Array.isArray(v.closed)) continue;
    const key = `closed_${id}`, saved = props.getProperty(key);
    // An incomplete county list can still report a real closure. Keep additions,
    // but never remove a previous closure or call it reopened on unknown input.
    if (!v.closuresKnown && saved === null && !v.closed.length) continue;
    const closed = v.closuresKnown ? v.closed : [...new Set([...JSON.parse(saved || '[]'), ...v.closed])].sort();
    props.setProperty(key, JSON.stringify(closed));
    if (saved === null) continue; // First look sets the baseline.
    const change = closureChanges(JSON.parse(saved), closed);
    if (!change.closed.length && !change.reopened.length) continue;
    const [day, n] = String(props.getProperty(`closure_pushes_${id}`) || '').split(' ');
    const count = day === today ? Number(n) || 0 : 0;
    if (count >= MAX_CLOSURE_PUSHES_PER_DAY) continue;
    props.setProperty(`closure_pushes_${id}`, `${today} ${count + 1}`);
    const msg = closureChangeMessage(change, CONFIG.APP_URL);
    rows.filter((r) => r[7] === true && validArea_(r[6]) === id).forEach((r) => ntfy_(String(r[0]), { title: change.closed.length ? 'FLOODplain: road closed' : 'FLOODplain: closure update' }, msg));
  }
}

// One cached copy of NOAA forecasts, so each phone asks once instead of once per crossing.
const FORECAST_PATH = /^(gauges\/[A-Z0-9]{3,8}(\/stageflow)?|reaches\/\d{1,14}\/streamflow)$/;
function sharedForecasts_(list) {
  const paths = [...new Set(list.split(',').filter((p) => FORECAST_PATH.test(p)))].slice(0, 40);
  const cache = CacheService.getScriptCache();
  const responses = {}, missing = [];
  for (const p of paths) {
    const hit = cache.get(`noaa:${p}`);
    if (hit) responses[p] = JSON.parse(hit); else missing.push(p);
  }
  if (missing.length) {
    const url = (p) => `https://api.water.noaa.gov/nwps/v1/${p}${p.startsWith('reaches/') ? '?series=short_range' : ''}`;
    UrlFetchApp.fetchAll(missing.map((p) => ({ url: url(p), muteHttpExceptions: true }))).forEach((r, i) => {
      if (r.getResponseCode() !== 200) return;
      const text = r.getContentText();
      try { responses[missing[i]] = JSON.parse(text); } catch (err) { return; }
      if (text.length < 95000) cache.put(`noaa:${missing[i]}`, text, 900);
    });
  }
  return { responses };
}

// Drivers' one-tap reports. Two fixed answers only, so there's no free text to moderate.
const DRIVE_MAX_PER_DAY = 400;
function driveReports_() {
  const hit = CacheService.getScriptCache().get('drive');
  const list = hit ? JSON.parse(hit) : [];
  return list.filter((r) => Date.now() - r.at < DRIVE_REPORT_MS);
}
function drive_(b) {
  const fp = String(b.fp || '');
  if (!FAILURE_POINTS.some((x) => x.id === fp) || !['water', 'clear'].includes(b.state)) return { ok: false, error: 'bad report' };
  const props = PropertiesService.getScriptProperties();
  const today = today_();
  const [day, n] = String(props.getProperty('drive_day') || '').split(' ');
  const count = day === today ? Number(n) || 0 : 0;
  if (count >= DRIVE_MAX_PER_DAY) return { ok: false, error: 'Lots of reports today. Try tomorrow.' };
  props.setProperty('drive_day', `${today} ${count + 1}`);
  const list = driveReports_().slice(-199);
  list.push({ fp, state: b.state, at: Date.now() });
  CacheService.getScriptCache().put('drive', JSON.stringify(list), ROAD_EVENTS_KEEP_S);
  const ss = sheet_().getParent();
  let tab = ss.getSheetByName('drive_reports');
  if (!tab) { tab = ss.insertSheet('drive_reports'); tab.appendRow(['when', 'crossing_id', 'state']); }
  tab.appendRow([new Date(), fp, b.state]);
  return { ok: true, reports: list };
}

// Counts of failed feeds seen by phones, by day. Counts only; nothing about who.
function countFailures_(names) {
  const feeds = names.split(',').filter((n) => /^[a-z]{2,12}$/.test(n)).slice(0, 8);
  if (!feeds.length) return;
  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    const ss = sheet_().getParent();
    let tab = ss.getSheetByName('feed_failures');
    if (!tab) { tab = ss.insertSheet('feed_failures'); tab.appendRow(['date', 'feed', 'count']); }
    const today = today_();
    const rows = tab.getDataRange().getValues();
    for (const feed of feeds) {
      const i = rows.findIndex((r, k) => k > 0 && (r[0] instanceof Date ? Utilities.formatDate(r[0], CONFIG.TZ, 'yyyy-MM-dd') : String(r[0])) === today && r[1] === feed);
      if (i > 0) tab.getRange(i + 1, 3).setValue((Number(rows[i][2]) || 0) + 1);
      else { tab.appendRow([today, feed, 1]); rows.push([today, feed, 1]); }
    }
  } finally { lock.releaseLock(); }
}

function transview_(method, body, ua) {
  return { url: `https://transview.org/Map.aspx/${method}`, method: 'post', contentType: 'application/json; charset=utf-8', payload: JSON.stringify(body), muteHttpExceptions: true, headers: { ...ua, Referer: 'https://transview.org/Map.aspx' } };
}
function computeVerdicts_(forceRefresh = false) {
  const cache = CacheService.getScriptCache();
  if (typeof evaluate !== 'function') throw ownerComputeError_('Assessment engine unavailable; rebuild and install the complete Apps Script bundle');
  const hit = forceRefresh ? null : cache.get('verdicts');
  if (hit) {
    let cached;
    try { cached = JSON.parse(hit); } catch (err) { /* Rebuild an unusable cache below. */ }
    // A cache from before the SFINCS road forecast existed (just after a deploy) is rebuilt too.
    if (currentRoadForecastCache_(cache.get('roadforecast')) && validOwnerVerdicts_(cached, Date.now())) return cached; // Cache hits never mark compute health recovered.
    // Assessment age starts before evaluation, but the cache TTL starts on put.
    // Refresh stale or invalid entries now instead of reporting a compute outage
    // until CacheService expires them. Only a validated new result can recover.
  }
  const urls = sourceUrls(PropertiesService.getScriptProperties().getProperty('USGS_API_KEY'));
  const sites = Object.keys(urls.usgs);
  const ua = { 'User-Agent': 'FLOODplain/1.0 (github.com/godfather38/floodplain)' };
  const reqs = [
    ...sites.map((s) => ({ url: urls.usgs[s], muteHttpExceptions: true, headers: ua })),
    { url: urls.closures, muteHttpExceptions: true, headers: ua },
    { url: urls.rain, muteHttpExceptions: true, headers: ua },
    { url: urls.stream, muteHttpExceptions: true, headers: ua },
    { url: urls.nws, muteHttpExceptions: true, headers: { ...ua, Accept: 'application/geo+json' } },
    transview_('GetData', { theDataType: 'RoadClosure' }, ua),
    transview_('GetConstructionEvents', { type: '' }, ua),
    { url: CONFIG.LIVE_SFINCS + 'manifest.json?t=' + Math.floor(Date.now() / 120000), muteHttpExceptions: true, headers: ua },
    { url: CONFIG.LIVE_SFINCS + 'water.json.gz?t=' + Math.floor(Date.now() / 120000), muteHttpExceptions: true, headers: ua },
    ...Object.keys(ALL_ROUTE_CASES).map((name) => ({ url: ALL_ROUTE_LIVE + name + '/compact/road-forecast.json?t=' + Math.floor(Date.now() / 120000), muteHttpExceptions: true, headers: ua })),
  ];
  const answers = UrlFetchApp.fetchAll(reqs);
  const parse = (r) => {
    if (!r || r.getResponseCode() !== 200) return null;
    try { return JSON.parse(r.getContentText()); } catch (err) { return null; }
  };
  // Keep all three high-resolution cases independent, with the original coarse run as fallback.
  const modelAt = reqs.length - 2 - Object.keys(ALL_ROUTE_CASES).length;
  const res = answers.slice(0, modelAt).map(parse);
  const coarse = sfincsForecast_(parse(answers[modelAt]), answers[modelAt + 1], Date.now());
  const caseSummaries = Object.fromEntries(Object.keys(ALL_ROUTE_CASES).map((name, i) => [name, parse(answers[modelAt + 2 + i])]));
  const sfincs = mergeRoadForecasts(coarse, caseSummaries, Date.now());
  const now = Date.now();
  const usgs = Object.fromEntries(sites.map((s, i) => [s, res[i]]));
  const [hc, hr, hs, hn, htc, htw] = res.slice(sites.length);
  bestEffortHealth_('input-validation', () => noteOwnerHealth_(expectedInputHealth_({ usgs, closures: hc, rain: hr, stream: hs, nws: hn, tvClosures: htc, tvWork: htw }, now), now));
  // Keep a trimmed copy for the app (?feed=usgs): just time, value, parameter per reading.
  const trimmed = Object.fromEntries(sites.map((s) => [s, usgs[s] ? { features: (usgs[s].features || []).map((f) => ({ properties: f.properties })) } : null]));
  cache.put('usgs', JSON.stringify({ fetched_at: new Date(Date.now()).toISOString(), series: trimmed }), 300);
  const [closures, rain, stream, nws, tvClosures, tvWork] = res.slice(sites.length);
  // Either TransView list can fail alone; an unanswered feed is no events, never "no closures".
  const roadEvents = tvClosures || tvWork ? normalizeRoadEvents(tvClosures && tvClosures.d, tvWork && tvWork.d, [-111.45, 32.1, -110.9, 32.6]) : null;
  if (roadEvents) {
    const text = JSON.stringify({ events: roadEvents, fetchedAt: now });
    if (text.length < 95000) { cache.put('roadevents', text, 300); cache.put('roadevents_good', text, ROAD_EVENTS_KEEP_S); }
  }
  // If TransView is down, keep using its last answer for up to six hours and say how old it is.
  const lastGood = roadEvents ? null : JSON.parse(cache.get('roadevents_good') || 'null');
  const eventsForRating = roadEvents || (lastGood && lastGood.events) || null;
  bestEffortHealth_('legacy-health', () => noteHealth_({ usgs: sites.some((s) => usgs[s]), county: parseCountyClosures(closures).complete, rain: !!rain, stream: !!stream, weather: !!nws, transview: !!roadEvents }, now));
  const alert = rain && stream ? alertSnapshot(rain.data, stream.data, now) : null;
  const out = {};
  for (const id of AREA_IDS) {
    const v = evaluate({ now, usgs, closures, alert, nws, roadEvents: eventsForRating, routes: ROUTE_FEATURES, sfincs }, id);
    if (!v) throw ownerComputeError_('Assessment output is missing; inspect the evaluator and area configuration');
    out[id] = { at: v.at, text: v.text, sms: v.sms, spoken: v.spoken, off: v.off, title: v.title, closed: v.closed, closuresKnown: v.closuresKnown };
  }
  if (!validOwnerVerdicts_(out, now)) throw ownerComputeError_('Assessment output is incomplete or malformed; inspect the evaluator and area configuration');
  cache.put('verdicts', JSON.stringify(out), 240);
  cache.put('roadforecast', JSON.stringify(sfincs), 300);
  if (alert) cache.put('alert', JSON.stringify(alert), 300);
  // Report recovery only after the complete new assessment has been cached.
  noteOwnerHealth_([{ id: 'compute', reason: '', diagnostic: '', expected: 'Successful evaluation for every area', crossings: 'All configured crossings' }], now);
  return out;
}

function currentRoadForecastCache_(text) {
  try { return JSON.parse(text || 'null')?.forecastVersion === 2; } catch (err) { return false; }
}

// The SFINCS road forecast for the ratings (public/road-forecast.js, ROAD_CELLS from
// public/data/road-cells.json). Water over a road raises that route's number in texts and pushes,
// the same as in the app. Any failure here leaves the other sources rating the routes.
function sfincsForecast_(manifest, waterAnswer, now) {
  try {
    if (!manifest || !waterAnswer || waterAnswer.getResponseCode() !== 200) return { status: 'unavailable', reason: 'The live SFINCS run did not answer.' };
    const blob = waterAnswer.getBlob().setContentType('application/x-gzip');
    const water = JSON.parse(Utilities.ungzip(blob).getDataAsString());
    return roadForecast(ROAD_CELLS, manifest, water, now);
  } catch (err) {
    return { status: 'unavailable', reason: 'The live SFINCS run could not be read: ' + err.message };
  }
}

function verdict_(area) {
  try { const v = computeVerdict_(area); if (v) return v; } catch (err) { /* fall back below */ }
  if (validArea_(area) !== 'avra') return null; // GitHub's backup copy covers Avra Valley only
  const cache = CacheService.getScriptCache();
  const hit = cache.get('verdict');
  if (hit) return JSON.parse(hit);
  try {
    const t = UrlFetchApp.fetch(CONFIG.VERDICT_URL, { muteHttpExceptions: true }).getContentText();
    const v = JSON.parse(t);
    cache.put('verdict', t, 60);
    return v;
  } catch (err) {
    return null;
  }
}

function ntfy_(topic, v, msg) {
  UrlFetchApp.fetch(topic.startsWith('http') ? topic : `https://ntfy.sh/${topic}`, {
    method: 'post', payload: msg, muteHttpExceptions: true,
    headers: { Title: v && v.title ? v.title : 'FLOODplain', Click: CONFIG.APP_URL, Tags: 'droplet' },
  });
}

// Verizon shutdown notices: heads-up on HEADS_UP, final on ENDED (subscribers + owner).
function sunset_(today, props) {
  const stages = [
    [CONFIG.HEADS_UP, 'sunset_headsup', 'Heads-up from FLOODplain: Verizon ends email-to-text on March 31, 2027, so these texts stop then. Free phone alerts keep working: ' + CONFIG.APP_URL + '#/alerts'],
    [CONFIG.ENDED, 'sunset_ended', 'FLOODplain: Verizon has ended email-to-text, so these texts have stopped. Free phone alerts: ' + CONFIG.APP_URL + '#/alerts'],
  ];
  for (const [date, flag, msg] of stages) {
    if (today < date || props.getProperty(flag)) continue;
    props.setProperty(flag, today);
    const rows = sheet_().getDataRange().getValues().slice(1).filter((r) => r[4] === true);
    rows.forEach((r) => text_(String(r[0]), msg));
    MailApp.sendEmail(Session.getEffectiveUser().getEmail(), 'FLOODplain: Verizon email-to-text ' + (flag === 'sunset_ended' ? 'has ended' : 'ends March 31, 2027'),
      msg + '\n\nSubscribers notified: ' + rows.length + '.');
  }
}

// ---------- helpers ----------
// Twilio credentials come from Script properties (TWILIO_SID, TWILIO_TOKEN, optional
// TWILIO_FROM) or from a private Secrets.gs file in the same Apps Script project that
// defines `const TWILIO = { SID, TOKEN, FROM }`. Neither is ever committed to GitHub.
// Without a FROM number, the account's first Twilio number is looked up and remembered.
// Beta: texts stay on Verizon's email-to-text until the Script property TWILIO_APPROVED
// is "yes". Carriers block an unapproved sender, and Twilio's refusal never reaches us.
function twilio_() {
  const p = PropertiesService.getScriptProperties();
  if (p.getProperty('TWILIO_APPROVED') !== 'yes') return null;
  const file = typeof TWILIO === 'object' && TWILIO ? TWILIO : {};
  const sid = p.getProperty('TWILIO_SID') || file.SID;
  const token = p.getProperty('TWILIO_TOKEN') || file.TOKEN;
  if (!sid || !token) return null;
  let from = p.getProperty('TWILIO_FROM') || file.FROM;
  if (!from) {
    try {
      const r = UrlFetchApp.fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/IncomingPhoneNumbers.json?PageSize=1`, {
        muteHttpExceptions: true, headers: { Authorization: 'Basic ' + Utilities.base64Encode(`${sid}:${token}`) },
      });
      const n = JSON.parse(r.getContentText()).incoming_phone_numbers?.[0]?.phone_number;
      if (n) { from = n; p.setProperty('TWILIO_FROM', n); }
    } catch (err) { from = null; }
  }
  return from ? { sid, token, from } : null;
}
// Sends one text. Returns false when the overall daily budget is used up.
// Codes (isCode) still count toward the budget but are always attempted while any is left.
function text_(phone, body, isCode) {
  const props = PropertiesService.getScriptProperties();
  const today = today_();
  const [day, n] = String(props.getProperty('budget') || '').split(' ');
  const used = day === today ? Number(n) || 0 : 0;
  if (used >= CONFIG.DAILY_TEXT_BUDGET) {
    if (!props.getProperty('budget_warned_' + today)) {
      props.setProperty('budget_warned_' + today, '1');
      MailApp.sendEmail(Session.getEffectiveUser().getEmail(), 'FLOODplain: daily text budget reached',
        `All ${CONFIG.DAILY_TEXT_BUDGET} texts for ${today} are used. More texts wait until tomorrow. Change DAILY_TEXT_BUDGET in the script to raise it.`);
    }
    return false;
  }
  props.setProperty('budget', `${today} ${used + 1}`);
  void isCode;
  const t = twilio_();
  if (t) {
    UrlFetchApp.fetch(`https://api.twilio.com/2010-04-01/Accounts/${t.sid}/Messages.json`, {
      method: 'post', muteHttpExceptions: true,
      headers: { Authorization: 'Basic ' + Utilities.base64Encode(`${t.sid}:${t.token}`) },
      payload: { To: `+1${phone}`, From: t.from, Body: body.slice(0, 320) },
    });
    return true;
  }
  if (MailApp.getRemainingDailyQuota() < 1) return false;
  MailApp.sendEmail({ to: `${phone}@${CONFIG.GATEWAY}`, subject: '', body: body.slice(0, 300), name: "FLOODplain" });
  return true;
}
function sheet_() {
  const props = PropertiesService.getScriptProperties();
  let id = props.getProperty('sheet_id');
  let ss = null;
  if (id) { try { ss = SpreadsheetApp.openById(id); } catch (err) { ss = null; } }
  if (!ss) {
    ss = SpreadsheetApp.create('FLOODplain text subscribers (private)');
    props.setProperty('sheet_id', ss.getId());
    ss.getSheets()[0].setName('subscribers');
    ss.getSheets()[0].appendRow(HEADER);
  }
  return ss.getSheets()[0];
}
function keysSheet_() {
  const ss = sheet_().getParent();
  let k = ss.getSheetByName('keys');
  if (!k) {
    k = ss.insertSheet('keys');
    k.appendRow(KEYS_HEADER);
    k.appendRow(['example-key-change-me', 4, 'delete this row; add one per person you give more texts']);
  }
  return k;
}
function today_() { return Utilities.formatDate(new Date(), CONFIG.TZ, 'yyyy-MM-dd'); }
function findRow_(sh, phone) {
  const col = sh.getRange(1, 1, Math.max(sh.getLastRow(), 1), 1).getValues();
  for (let i = 1; i < col.length; i++) if (String(col[i][0]) === phone) return i + 1;
  return 0;
}
function newToday_() {
  const today = Utilities.formatDate(new Date(), CONFIG.TZ, 'yyyy-MM-dd');
  return sheet_().getDataRange().getValues().slice(1)
    .filter((r) => r[C.created - 1] instanceof Date && Utilities.formatDate(r[8], CONFIG.TZ, 'yyyy-MM-dd') === today).length;
}
function ensureTrigger_() {
  if (!ScriptApp.getProjectTriggers().some((t) => t.getHandlerFunction() === 'tick')) {
    ScriptApp.newTrigger('tick').timeBased().everyMinutes(1).create();
  }
}
// Days are "w:1,2,3,4,5" (ISO weekdays, 1 = Monday) or "m:1,15" (days of the month).
// Older values "wd" and "all" still work.
function validDays_(d) {
  const m = /^([wm]):([\d,]+)$/.exec(String(d || ''));
  if (!m) return d === 'all' ? 'w:1,2,3,4,5,6,7' : 'w:1,2,3,4,5';
  const max = m[1] === 'w' ? 7 : 31;
  const list = [...new Set(m[2].split(',').map(Number))].filter((n) => n >= 1 && n <= max).sort((a, b) => a - b);
  return list.length ? `${m[1]}:${list.join(',')}` : 'w:1,2,3,4,5';
}
function dueOn_(days, m) {
  if (days === 'all') return true;
  if (days === 'wd' || !days) return m.weekday;
  const [kind, list] = days.split(':');
  const nums = String(list || '').split(',').map(Number);
  return kind === 'm' ? nums.includes(m.dom) : nums.includes(m.dow);
}
function daysLabel_(days) {
  const d = validDays_(days);
  const [kind, list] = d.split(':');
  const nums = list.split(',').map(Number);
  const ord = (n) => n + (n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th');
  if (kind === 'm') return 'on the ' + nums.map(ord).join(', ') + ' of each month';
  const names = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  if (nums.join() === '1,2,3,4,5') return 'weekdays';
  if (nums.length === 7) return 'every day';
  return nums.map((n) => names[n]).join(', ');
}

// ---------- push notifications (ntfy) ----------
function pushSheet_() {
  const ss = sheet_().getParent();
  let p = ss.getSheetByName('push');
  if (!p) { p = ss.insertSheet('push'); p.appendRow(['topic', 'times', 'days', 'mode', 'last_sent', 'created', 'area', 'instant']); }
  return p;
}
function push_(b) {
  const topic = String(b.topic || '');
  if (!/^washwatch-[a-z0-9]{8,32}$/.test(topic)) return { ok: false, error: 'bad topic' };
  const times = [...new Set((b.times || []).map(String))].filter(validTime_).slice(0, CONFIG.MAX_TIMES);
  if (!times.length) return { ok: false, error: 'Pick at least one time.' };
  const values = [topic, times.join(','), validDays_(b.days), b.mode === 'off' ? 'off' : 'all'];
  const ps = pushSheet_();
  const rows = ps.getDataRange().getValues();
  const i = rows.findIndex((r, k) => k > 0 && r[0] === topic);
  if (i > 0) { ps.getRange(i + 1, 1, 1, 4).setValues([values]); ps.getRange(i + 1, 7, 1, 2).setValues([[validArea_(b.area), b.instant === true]]); } else {
    const today = today_();
    const added = rows.slice(1).filter((r) => r[5] instanceof Date && Utilities.formatDate(r[5], CONFIG.TZ, 'yyyy-MM-dd') === today).length;
    if (added >= 300) return { ok: false, error: 'Too many new sign-ups today. Try tomorrow.' };
    ps.appendRow([...values, '', new Date(), validArea_(b.area), b.instant === true]);
  }
  return { ok: true, step: 'saved', days: daysLabel_(values[2]) };
}
function pushStop_(b) {
  const ps = pushSheet_();
  const rows = ps.getDataRange().getValues();
  const i = rows.findIndex((r, k) => k > 0 && r[0] === String(b.topic || ''));
  if (i > 0) ps.deleteRow(i + 1);
  return { ok: true, step: 'stopped' };
}

function validTime_(t) {
  const m = /^(\d{2}):(\d{2})$/.exec(t);
  return !!m && Number(m[1]) < 24 && Number(m[2]) < 60;
}
function label_(t) {
  const [h, m] = t.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${pad_(m)} ${h < 12 ? 'AM' : 'PM'}`;
}
function pad_(n) { return String(n).padStart(2, '0'); }
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

// Expected-input diagnostics are separate from ratings and structural inference uncertainty.
function ownerComputeError_(reason) { const err = new Error(reason); err.ownerReason = reason; return err; }
function validOwnerVerdicts_(all, now) {
  return all && typeof all === 'object' && AREA_IDS.every(id => {
    const v = all[id], t = Date.parse(v?.at);
    return v && Number.isFinite(t) && t <= now && now-t <= 4*60000
      && ['text','sms','spoken','title'].every(k => typeof v[k] === 'string' && v[k].trim())
      && typeof v.off === 'boolean' && typeof v.closuresKnown === 'boolean'
      && Array.isArray(v.closed) && v.closed.every(x => typeof x === 'string');
  });
}
function expectedInputHealth_(raw, now) {
  const out = [];
  const affected = test => FAILURE_POINTS.filter(test).map(p => p.short);
  const add = (id, expected, crossings, reason, observedAt = null) => {
    const t = Date.parse(observedAt);
    out.push({id, expected, crossings: crossings.join(', ') || 'Regional context', reason, observedAt: Number.isFinite(t) ? new Date(t).toISOString() : null, ageMinutes: Number.isFinite(t) ? Math.floor((now-t)/60000) : null});
  };
  const numeric = v => v != null && String(v).trim() !== '' && Number.isFinite(Number(v)) && Number(v) >= 0;
  const reading = (valid, time, age) => {
    if (!valid) return 'Missing or malformed reading';
    const t = Date.parse(time);
    if (!Number.isFinite(t) || t > now) return 'Missing or invalid observation time';
    return now-t > age ? 'Stale reading' : '';
  };
  for (const [id, site] of Object.entries(USGS_SITES)) {
    const body = raw.usgs[id];
    const rows = Array.isArray(body?.features) ? body.features.filter(f => f?.properties?.parameter_code === '00060').map(f => f.properties).sort((a,b) => Date.parse(b.time)-Date.parse(a.time)) : [];
    const p = rows[0];
    add('usgs:'+id, site.name+' discharge within 3 hours', affected(p => (p.river || []).includes(id) || (p.wash?.usgs || []).includes(id)), !body ? 'Source unavailable' : reading(numeric(p?.value), p?.time, STALE_MS), p?.time);
  }
  for (const kind of ['rain','stream']) {
    const body = raw[kind];
    const ids = kind === 'rain' ? [...new Set(FAILURE_POINTS.flatMap(p => Object.values(p.rain || {}).flat()))] : [...new Set(FAILURE_POINTS.flatMap(p => p.wash?.alert || []))];
    for (const id of ids) {
      const row = Array.isArray(body?.data) ? body.data.find(d => String(d.site) === id) : null;
      const points = affected(p => kind === 'rain' ? Object.values(p.rain || {}).flat().includes(id) : (p.wash?.alert || []).includes(id));
      const windows = kind === 'rain' ? [...new Set(FAILURE_POINTS.flatMap(p => Object.entries(p.rain || {}).filter(([,ids]) => ids.includes(id)).flatMap(([rule]) => ['h6', ...Object.values(RAIN[rule]).flatMap(r => Object.keys(r))])))]: [];
      const values = kind === 'rain' ? windows.map(w => row?.rain?.[['m10','m30','h1','h3','h6','d1','d3','d7','d30'].indexOf(w)]) : [row?.flow];
      const reason = !body ? 'Source unavailable' : !row ? 'Expected station absent' : row.UnderMaintenance ? 'Station under maintenance' : reading(values.every(numeric), row.last_rpt ? row.last_rpt+'-07:00' : null, kind === 'rain' ? 24*3600000 : STALE_MS);
      add(kind+':'+id, (RAIN_GAUGES[id] || id)+(kind === 'rain' ? ' rain windows '+windows.join('/')+' within 24 hours' : ' stream discharge within 3 hours'), points, reason, row?.last_rpt ? row.last_rpt+'-07:00' : null);
    }
  }
  const county = parseCountyClosures(raw.closures);
  add('county', 'Readable county event list with reported statuses (empty is valid)', county.issues.map(i => i.location), county.reason);
  for (const [id, body, field] of [['weather',raw.nws,'features'],['transview-closures',raw.tvClosures,'d'],['transview-work',raw.tvWork,'d']]) {
    const list = body?.[field];
    const valid = Array.isArray(list) || (id === 'transview-work' && list && typeof list === 'object');
    const malformed = valid && Object.values(list).some(r => !r || typeof r !== 'object' || (id === 'weather' && typeof r.properties?.event !== 'string') || (id === 'transview-closures' && (typeof r.Geo !== 'string' || r.KeyID == null)) || (id === 'transview-work' && (typeof r.Geography !== 'string' || r.KeyID == null)));
    add(id, 'Readable '+id+' event list (empty is valid)', [], !body ? 'Source unavailable' : !valid || malformed ? 'Malformed event list' : '');
  }
  return out;
}
function noteOwnerHealth_(results, now) {
  return bestEffortHealth_('owner-observation', () => {
    const lock = LockService.getScriptLock();
    // Diagnostics never wait behind a signup or stop the assessment or its texts.
    if (!lock.tryLock(100)) { logOwnerDiagnostic_('owner-observation', 'Script lock busy; observation deferred until the next fresh check'); return false; }
    try { saveOwnerHealth_(results, now); return true; } finally { lock.releaseLock(); }
  });
}

// Only bounded, scrubbed exception details go to private owner diagnostics/logs.
// Remove response-body suffixes, URLs, contact data, raw stacks and configured secrets.
function ownerErrorDiagnostic_(err) {
  try {
    let message = String(err && err.message || err || 'Unknown error');
    const props = PropertiesService.getScriptProperties();
    const file = typeof TWILIO === 'object' && TWILIO ? TWILIO : {};
    for (const secret of [props.getProperty('TWILIO_SID'), props.getProperty('TWILIO_TOKEN'), props.getProperty('TWILIO_FROM'), props.getProperty('USGS_API_KEY'), file.SID, file.TOKEN, file.FROM]) {
      if (secret) message = message.split(String(secret)).join('[redacted]');
    }
    message = message
      .replace(/https?:\/\/[^\s<>"']+/gi, '[url]')
      .replace(/\b(?:Bearer|Basic)\s+[^\s,;]+/gi, '[authorization]')
      .replace(/(["']?(?:api[_-]?key|token|secret|password|authorization|cookie|sid)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gi, '$1[redacted]')
      .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email]')
      .replace(/\+?\d[\d ().-]{8,}\d/g, '[number]')
      .replace(/\b[A-Za-z0-9_+/=-]{32,}\b/g, '[opaque value]')
      .split(/(?:\b(?:response|payload|body)\s*[:=]|\n\s*at\s|<html\b|<!doctype)/i)[0]
      .replace(/[\r\n\t]+/g, ' ').slice(0, 320);
    const name = /^(?:Error|TypeError|RangeError|ReferenceError|SyntaxError|Exception)$/.test(err && err.name) ? err.name : 'Error';
    // Keep the code location without a URL, local path, arguments or stack body.
    const frame = /\bat ([A-Za-z_$][\w$]*)\s*\([^\n]*?:(\d+)(?::\d+)?\)/.exec(String(err && err.stack || ''));
    return name + ': ' + message + (frame ? ' [' + frame[1] + ':' + frame[2] + ']' : '');
  } catch (ignored) { return 'Error: diagnostic details unavailable'; }
}
function logOwnerDiagnostic_(stage, diagnostic) {
  try { console.warn('FLOODplain ' + stage + ': ' + diagnostic); } catch (ignored) { /* Logging must never affect alerts. */ }
}
function bestEffortHealth_(stage, work) {
  try { return work(); } catch (err) { logOwnerDiagnostic_(stage, ownerErrorDiagnostic_(err)); return false; }
}
function saveOwnerHealth_(results, now) {
  const props = PropertiesService.getScriptProperties();
  const stored = props.getProperties(), updates = {};
  const ids = JSON.parse(stored.ownerHealthIds || '[]');
  for (const result of results) {
    if (!ids.includes(result.id)) ids.push(result.id);
    const key = 'ownerHealth:'+result.id;
    const s = JSON.parse(updates[key] || stored[key] || '{}');
    if (s.checked > now) continue; // Do not overwrite a newer observation from another execution.
    const fingerprint = result.reason || '';
    if (s.reason !== fingerprint) { s.since = now; s.attempts = 0; s.nextTry = 0; }
    Object.assign(s, result, {reason: fingerprint, checked: now});
    updates[key] = JSON.stringify(s);
  }
  updates.ownerHealthIds = JSON.stringify(ids);
  props.setProperties(updates); // One batched write keeps the critical section short.
}
// A lease serializes email attempts without holding the shared script lock while
// MailApp waits on the network. Ten minutes outlives an Apps Script execution;
// an interrupted execution can be retried later, still within the five-attempt cap.
const OWNER_HEALTH_LEASE_MS = 10 * 60000;
function ownerHealthWatch_(now, computationFailed = false) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(100)) { logOwnerDiagnostic_('owner-delivery', 'Script lock busy; email deferred until the next tick'); return false; }
  let claim;
  try { claim = claimOwnerHealth_(now, computationFailed); } finally { lock.releaseLock(); }
  if (!claim) return false;
  let sent = false;
  try {
    const body = ['FLOODplain expected-input check', 'Checked: '+new Date(now).toISOString(), ...claim.pending.map(({s}) => [s.reason ? 'PROBLEM: '+s.id : 'RECOVERED: '+s.id, 'Expected: '+s.expected, 'Crossings: '+s.crossings, 'Result: '+(s.reason || 'Expected input is valid again'), ...(s.diagnostic ? ['Diagnostic: '+s.diagnostic] : []), 'Since: '+new Date(s.since).toISOString(), ...(s.observedAt ? ['Last observation: '+s.observedAt, 'Observation age at check: '+s.ageMinutes+' minutes'] : [])].join('\n')), 'Action: inspect the named source or station and its timestamps; restore the feed or correct its configuration. Recovery confirms input availability, not road conditions.'].join('\n\n');
    MailApp.sendEmail(Session.getEffectiveUser().getEmail(), 'FLOODplain: expected input '+(claim.pending.some(p => p.s.reason) ? 'needs attention' : 'recovered'), body);
    sent = true;
    return true;
  } finally {
    bestEffortHealth_('owner-delivery-save', () => finishOwnerHealth_(claim, sent));
  }
}
function claimOwnerHealth_(now, computationFailed) {
  const props = PropertiesService.getScriptProperties();
  const stored = props.getProperties(), updates = {};
  const lease = JSON.parse(stored.ownerHealthDelivery || '{}');
  if (lease.until > now) return null;
  const pending = [];
  const computeFailed = JSON.parse(stored['ownerHealth:compute'] || '{}').reason;
  for (const id of JSON.parse(stored.ownerHealthIds || '[]')) {
    const key = 'ownerHealth:'+id, s = JSON.parse(stored[key] || '{}');
    if ((s.reason || '') === (s.delivered || '') || (s.attempts || 0) >= 5 || now < (s.nextTry || 0)) continue;
    if (!s.reason && (computationFailed || now-s.checked > 5*60000 || (id !== 'compute' && computeFailed))) continue;
    pending.push({key,s});
  }
  if (!pending.length) return null;
  const token = Utilities.getUuid();
  updates.ownerHealthDelivery = JSON.stringify({token, until: now+OWNER_HEALTH_LEASE_MS});
  for (const {key,s} of pending) {
    s.attempts = (s.attempts || 0)+1;
    s.nextTry = now+Math.min(60, 2**s.attempts)*60000;
    updates[key] = JSON.stringify(s);
  }
  props.setProperties(updates);
  return {token, pending};
}
function finishOwnerHealth_(claim, sent) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(100)) { logOwnerDiagnostic_('owner-delivery-save', 'Script lock busy; delivery outcome not persisted, retry possible after lease expires'); return false; }
  try {
    const props = PropertiesService.getScriptProperties();
    const stored = props.getProperties(), updates = {};
    const lease = JSON.parse(stored.ownerHealthDelivery || '{}');
    if (lease.token !== claim.token) return false;
    if (sent) for (const {key,s} of claim.pending) {
      // A fresh observation may have arrived while MailApp was sending. Update
      // only the delivered fingerprint, never overwrite that newer observation.
      const current = JSON.parse(stored[key] || '{}');
      current.delivered = s.reason;
      updates[key] = JSON.stringify(current);
    }
    if (sent) props.setProperties(updates);
    props.deleteProperty('ownerHealthDelivery');
    return true;
  } finally { lock.releaseLock(); }
}
