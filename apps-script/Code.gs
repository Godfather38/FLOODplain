/**
 * Wash Watch alerts, run as a Google Apps Script web app.
 *
 * - Text sign-ups (phone, times, days, mode) live in a private Google Sheet owned
 *   by the account that deploys this script. Nothing personal goes to GitHub.
 * - Every minute it reads the latest check published by the Wash Watch repo and:
 *     texts everyone whose time (Arizona, any minute) has come, and
 *     posts to the free ntfy topics washwatch-HHMM-{wd|all}-{all|off}.
 *   Missed minutes (the trigger can skip) are caught up, up to 10 minutes back.
 * - Texts go through Twilio when these Script properties are set:
 *     TWILIO_SID, TWILIO_TOKEN, TWILIO_FROM  (any carrier; STOP replies handled by Twilio)
 *   Otherwise they go through Verizon's email-to-text (Verizon numbers only), which
 *   Verizon ends on March 31, 2027. Subscribers and the owner are told on
 *   March 1, 2027 and April 1, 2027.
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
  CATCH_UP_MIN: 10,
  NTFY: 'https://ntfy.sh/washwatch',
  MAX_NEW_SIGNUPS_PER_DAY: 40,
};
const HEADER = ['phone', 'times', 'days', 'mode', 'verified', 'code', 'code_sent', 'last_sent', 'created'];

// ---------- web endpoints ----------
function doGet() {
  ensureTrigger_();
  return json_({ ok: true, service: 'wash-watch-alerts', sender: twilio_() ? 'any' : 'verizon' });
}

function doPost(e) {
  ensureTrigger_();
  let body = {};
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'bad request' }); }
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
  const times = [...new Set((b.times || []).map(String))].filter(validTime_).slice(0, CONFIG.MAX_TIMES);
  if (!times.length) return { ok: false, error: 'Pick at least one time.' };
  const days = b.days === 'all' ? 'all' : 'wd';
  const mode = b.mode === 'off' ? 'off' : 'all';
  const sh = sheet_();
  const row = findRow_(sh, phone);
  const now = Date.now();
  if (row) {
    const last = Number(sh.getRange(row, 7).getValue()) || 0;
    if (now - last < 2 * 60 * 1000) return { ok: false, error: 'A code was just sent. Wait 2 minutes.' };
  } else if (newToday_() >= CONFIG.MAX_NEW_SIGNUPS_PER_DAY) {
    return { ok: false, error: 'Too many sign-ups today. Try tomorrow.' };
  }
  const code = String(Math.floor(1000 + Math.random() * 9000));
  const values = [phone, times.join(','), days, mode, false, code, now, '', row ? sh.getRange(row, 9).getValue() : new Date()];
  if (row) sh.getRange(row, 1, 1, HEADER.length).setValues([values]);
  else sh.appendRow(values);
  text_(phone, `Wash Watch code: ${code}. Enter it in the app to start your texts. If you didn't ask for this, ignore it.`);
  return { ok: true, step: 'confirm' };
}

function confirm_(phone, code) {
  const sh = sheet_();
  const row = findRow_(sh, phone);
  if (!row || String(sh.getRange(row, 6).getValue()) !== code) return { ok: false, error: 'That code doesn\'t match.' };
  sh.getRange(row, 5).setValue(true);
  const times = String(sh.getRange(row, 2).getValue()).split(',').map(label_).join(' & ');
  const days = sh.getRange(row, 3).getValue() === 'all' ? 'every day' : 'weekdays';
  text_(phone, `Wash Watch texts are on: ${times}, ${days}. To stop, use Stop texts in the app's Alerts screen.`);
  return { ok: true, step: 'done' };
}

function stop_(phone) {
  const sh = sheet_();
  const row = findRow_(sh, phone);
  if (row) {
    sh.deleteRow(row);
    text_(phone, 'Wash Watch texts stopped.');
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
    });
  }

  const v = verdict_();
  const fresh = v && Date.now() - Date.parse(v.at) < 45 * 60 * 1000;
  const msg = fresh ? v.sms : 'Wash Watch couldn\'t get fresh data just now. Check the app before you go.';

  // Free phone notifications (ntfy): one post per topic variant for each minute.
  for (const m of minutes) {
    const topic = `${CONFIG.NTFY}-${m.hhmm.replace(':', '')}`;
    const variants = m.weekday ? ['all', 'wd'] : ['all'];
    for (const days of variants) {
      ntfy_(`${topic}-${days}-all`, v, msg);
      if (!fresh || v.off) ntfy_(`${topic}-${days}-off`, v, msg);
    }
  }

  // Texts.
  const sh = sheet_();
  const rows = sh.getDataRange().getValues().slice(1);
  rows.forEach((r, i) => {
    const [phone, times, days, mode, verified, , , lastSent] = r;
    if (verified !== true) return;
    for (const m of minutes) {
      const key = `${m.day} ${m.hhmm}`;
      if (lastSent === key || !String(times).split(',').includes(m.hhmm)) continue;
      if (days === 'wd' && !m.weekday) continue;
      if (!(mode === 'off' && fresh && !v.off)) text_(String(phone), msg);
      sh.getRange(i + 2, 8).setValue(key);
    }
  });
}

function verdict_() {
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
    headers: { Title: v && v.title ? v.title : 'Wash Watch', Click: CONFIG.APP_URL, Tags: 'droplet' },
  });
}

// Verizon shutdown notices: heads-up on HEADS_UP, final on ENDED (subscribers + owner).
function sunset_(today, props) {
  const stages = [
    [CONFIG.HEADS_UP, 'sunset_headsup', 'Heads-up from Wash Watch: Verizon ends email-to-text on March 31, 2027, so these texts stop then. Free phone alerts keep working: ' + CONFIG.APP_URL + '#/alerts'],
    [CONFIG.ENDED, 'sunset_ended', 'Wash Watch: Verizon has ended email-to-text, so these texts have stopped. Free phone alerts: ' + CONFIG.APP_URL + '#/alerts'],
  ];
  for (const [date, flag, msg] of stages) {
    if (today < date || props.getProperty(flag)) continue;
    props.setProperty(flag, today);
    const rows = sheet_().getDataRange().getValues().slice(1).filter((r) => r[4] === true);
    rows.forEach((r) => text_(String(r[0]), msg));
    MailApp.sendEmail(Session.getEffectiveUser().getEmail(), 'Wash Watch: Verizon email-to-text ' + (flag === 'sunset_ended' ? 'has ended' : 'ends March 31, 2027'),
      msg + '\n\nSubscribers notified: ' + rows.length + '.');
  }
}

// ---------- helpers ----------
function twilio_() {
  const p = PropertiesService.getScriptProperties();
  const sid = p.getProperty('TWILIO_SID'); const token = p.getProperty('TWILIO_TOKEN'); const from = p.getProperty('TWILIO_FROM');
  return sid && token && from ? { sid, token, from } : null;
}
function text_(phone, body) {
  const t = twilio_();
  if (t) {
    UrlFetchApp.fetch(`https://api.twilio.com/2010-04-01/Accounts/${t.sid}/Messages.json`, {
      method: 'post', muteHttpExceptions: true,
      headers: { Authorization: 'Basic ' + Utilities.base64Encode(`${t.sid}:${t.token}`) },
      payload: { To: `+1${phone}`, From: t.from, Body: body.slice(0, 320) },
    });
    return;
  }
  if (MailApp.getRemainingDailyQuota() < 1) return;
  MailApp.sendEmail({ to: `${phone}@${CONFIG.GATEWAY}`, subject: '', body: body.slice(0, 300), name: 'Wash Watch' });
}
function sheet_() {
  const props = PropertiesService.getScriptProperties();
  let id = props.getProperty('sheet_id');
  let ss = null;
  if (id) { try { ss = SpreadsheetApp.openById(id); } catch (err) { ss = null; } }
  if (!ss) {
    ss = SpreadsheetApp.create('Wash Watch text subscribers (private)');
    props.setProperty('sheet_id', ss.getId());
    ss.getSheets()[0].appendRow(HEADER);
  }
  return ss.getSheets()[0];
}
function findRow_(sh, phone) {
  const col = sh.getRange(1, 1, Math.max(sh.getLastRow(), 1), 1).getValues();
  for (let i = 1; i < col.length; i++) if (String(col[i][0]) === phone) return i + 1;
  return 0;
}
function newToday_() {
  const today = Utilities.formatDate(new Date(), CONFIG.TZ, 'yyyy-MM-dd');
  return sheet_().getDataRange().getValues().slice(1)
    .filter((r) => r[8] instanceof Date && Utilities.formatDate(r[8], CONFIG.TZ, 'yyyy-MM-dd') === today).length;
}
function ensureTrigger_() {
  if (!ScriptApp.getProjectTriggers().some((t) => t.getHandlerFunction() === 'tick')) {
    ScriptApp.newTrigger('tick').timeBased().everyMinutes(1).create();
  }
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
