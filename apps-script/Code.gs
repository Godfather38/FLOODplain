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
// text subscribers | crossing reports. Counts only; nothing about who visited.
function countVisit_(isNew) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const ss = sheet_().getParent();
    let st = ss.getSheetByName('stats');
    if (!st) { st = ss.insertSheet('stats'); st.appendRow(['date', 'app_opens', 'new_visitors', 'push_channels', 'text_subscribers', 'crossing_reports']); }
    const today = today_();
    const rows = st.getDataRange().getValues();
    let i = rows.findIndex((r, k) => k > 0 && (r[0] instanceof Date ? Utilities.formatDate(r[0], CONFIG.TZ, 'yyyy-MM-dd') : String(r[0])) === today);
    if (i < 0) { st.appendRow([today, 0, 0, 0, 0, 0]); i = st.getLastRow() - 1; }
    const row = i + 1;
    const opens = Number(st.getRange(row, 2).getValue()) || 0;
    const fresh = Number(st.getRange(row, 3).getValue()) || 0;
    const count = (name) => { const sh = ss.getSheetByName(name); return sh ? Math.max(sh.getLastRow() - 1, 0) : 0; };
    st.getRange(row, 2, 1, 5).setValues([[opens + 1, fresh + (isNew ? 1 : 0), count('push'), Math.max(sheet_().getLastRow() - 1, 0), count('reports')]]);
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
  const sh = sheet_();
  const row = findRow_(sh, phone);
  if (row) {
    sh.deleteRow(row);
    text_(phone, 'FLOODplain texts stopped.');
  }
  return { ok: true, step: 'stopped' };
}

// ---------- every minute ----------
function tick() {
  const now = new Date();
  const today = Utilities.formatDate(now, CONFIG.TZ, 'yyyy-MM-dd');
  const props = PropertiesService.getScriptProperties();
  if (!twilio_()) sunset_(today, props);

  // Minutes to handle: everything since the last run, at most CATCH_UP_MIN back.
  const nowMin = Math.floor(now.getTime() / 60000);
  const last = Number(props.getProperty('last_min')) || nowMin - 1;
  const from = Math.max(last + 1, nowMin - CONFIG.CATCH_UP_MIN + 1);
  props.setProperty('last_min', String(nowMin));
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
function computeVerdicts_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('verdicts');
  if (hit) return JSON.parse(hit);
  if (typeof evaluate !== 'function') return null; // Code.gs on its own, without the bundled engine
  const urls = sourceUrls(PropertiesService.getScriptProperties().getProperty('USGS_API_KEY'));
  const sites = Object.keys(urls.usgs);
  const ua = { 'User-Agent': 'FLOODplain/1.0 (github.com/godfather38/floodplain)' };
  const reqs = [
    ...sites.map((s) => ({ url: urls.usgs[s], muteHttpExceptions: true, headers: ua })),
    { url: urls.closures, muteHttpExceptions: true, headers: ua },
    { url: urls.rain, muteHttpExceptions: true, headers: ua },
    { url: urls.stream, muteHttpExceptions: true, headers: ua },
    { url: urls.nws, muteHttpExceptions: true, headers: { ...ua, Accept: 'application/geo+json' } },
  ];
  const res = UrlFetchApp.fetchAll(reqs).map((r) => {
    if (r.getResponseCode() !== 200) return null;
    try { return JSON.parse(r.getContentText()); } catch (err) { return null; }
  });
  const now = Date.now();
  const usgs = Object.fromEntries(sites.map((s, i) => [s, res[i]]));
  // Keep a trimmed copy for the app (?feed=usgs): just time, value, parameter per reading.
  const trimmed = Object.fromEntries(sites.map((s) => [s, usgs[s] ? { features: (usgs[s].features || []).map((f) => ({ properties: f.properties })) } : null]));
  cache.put('usgs', JSON.stringify({ fetched_at: new Date(Date.now()).toISOString(), series: trimmed }), 300);
  const [closures, rain, stream, nws] = res.slice(sites.length);
  const alert = rain && stream ? alertSnapshot(rain.data, stream.data, now) : null;
  const out = {};
  for (const id of AREA_IDS) {
    const v = evaluate({ now, usgs, closures, alert, nws, routes: ROUTE_FEATURES }, id);
    out[id] = { at: v.at, text: v.text, sms: v.sms, spoken: v.spoken, off: v.off, title: v.title };
  }
  cache.put('verdicts', JSON.stringify(out), 240);
  if (alert) cache.put('alert', JSON.stringify(alert), 300);
  return out;
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
function twilio_() {
  const p = PropertiesService.getScriptProperties();
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
  if (!p) { p = ss.insertSheet('push'); p.appendRow(['topic', 'times', 'days', 'mode', 'last_sent', 'created', 'area']); }
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
  if (i > 0) { ps.getRange(i + 1, 1, 1, 4).setValues([values]); ps.getRange(i + 1, 7).setValue(validArea_(b.area)); } else {
    const today = today_();
    const added = rows.slice(1).filter((r) => r[5] instanceof Date && Utilities.formatDate(r[5], CONFIG.TZ, 'yyyy-MM-dd') === today).length;
    if (added >= 300) return { ok: false, error: 'Too many new sign-ups today. Try tomorrow.' };
    ps.appendRow([...values, '', new Date(), validArea_(b.area)]);
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
