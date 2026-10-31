// Runs apps-script/Code.gs against small in-memory stand-ins for Google's services.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8');

function makeGas(clock) {
  const sent = []; const fetches = []; const mails = [];
  const props = new Map();
  class Sheet {
    constructor(name, ss) { this.name = name; this.rows = []; this.ss = ss; }
    setName(n) { this.name = n; }
    getParent() { return this.ss; }
    appendRow(r) { this.rows.push([...r]); }
    getLastRow() { return this.rows.length; }
    deleteRow(n) { this.rows.splice(n - 1, 1); }
    getDataRange() { return { getValues: () => this.rows.map((r) => [...r]) }; }
    getRange(row, col, nr = 1, nc = 1) {
      const self = this;
      return {
        getValue: () => (self.rows[row - 1] ?? [])[col - 1] ?? '',
        getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => (self.rows[row - 1 + i] ?? [])[col - 1 + j] ?? '')),
        setValue: (v) => { (self.rows[row - 1] ??= [])[col - 1] = v; },
        setValues: (vals) => vals.forEach((r, i) => r.forEach((v, j) => { (self.rows[row - 1 + i] ??= [])[col - 1 + j] = v; })),
      };
    }
  }
  const ss = { sheets: [], getId: () => 'SHEET', getSheets() { return this.sheets; }, getSheetByName(n) { return this.sheets.find((s) => s.name === n) ?? null; }, insertSheet(n) { const s = new Sheet(n, this); this.sheets.push(s); return s; } };
  ss.sheets.push(new Sheet('Sheet1', ss));
  const fmt = (d, tz, pat) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' }).formatToParts(d).map((x) => [x.type, x.value]));
    const dow = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[p.weekday];
    return { 'yyyy-MM-dd': `${p.year}-${p.month}-${p.day}`, 'HH:mm': `${p.hour}:${p.minute}`, H: String(Number(p.hour)), m: String(Number(p.minute)), u: String(dow) }[pat];
  };
  const RealDate = Date;
  class FakeDate extends RealDate { constructor(...a) { super(...(a.length ? a : [clock.now])); } static now() { return clock.now; } }
  const g = {
    Date: FakeDate,
    SpreadsheetApp: { create: () => ss, openById: () => ss },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props.get(k) ?? null, setProperty: (k, v) => props.set(k, String(v)) }) },
    CacheService: { getScriptCache: () => ({ get: () => null, put: () => {} }) },
    UrlFetchApp: { fetch: (url, opt = {}) => {
      fetches.push({ url, opt });
      if (url.includes('api.twilio.com')) sent.push({ to: opt.payload.To, body: opt.payload.Body });
      return { getContentText: () => JSON.stringify(clock.verdict) };
    } },
    MailApp: { sendEmail: (a, b, c) => { const m = typeof a === 'object' ? a : { to: a, subject: b, body: c }; if (m.to.endsWith('@vtext.com')) sent.push({ to: m.to, body: m.body }); else mails.push(m); }, getRemainingDailyQuota: () => 100 },
    Utilities: { formatDate: fmt, base64Encode: (s) => Buffer.from(s).toString('base64') },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ScriptApp: { getProjectTriggers: () => [{ getHandlerFunction: () => 'tick' }], newTrigger() {}, getService: () => ({ getUrl: () => 'u' }) },
    Session: { getEffectiveUser: () => ({ getEmail: () => 'owner@example.com' }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ setMimeType: () => JSON.parse(t) }) },
  };
  const api = new Function(...Object.keys(g), `${SRC}; return { doPost, tick, sheet_, keysSheet_, CONFIG };`)(...Object.values(g));
  const post = (body) => api.doPost({ postData: { contents: JSON.stringify(body) } });
  return { api, post, sent, mails, props, ss };
}

const AZ = (s) => Date.parse(`${s}-07:00`); // Arizona local time -> epoch ms
const verdict = (off = false) => ({ at: new Date(AZ('2026-11-02T05:00:00')).toISOString(), sms: 'take Trico-Marana (1/5 Low, 10 min).', title: 't', off });

function setup(twilio = true) {
  const clock = { now: AZ('2026-11-02T05:00:00'), verdict: verdict() }; // a Monday
  const g = makeGas(clock);
  if (twilio) { g.props.set('TWILIO_SID', 'AC1'); g.props.set('TWILIO_TOKEN', 't'); g.props.set('TWILIO_FROM', '+15205550000'); }
  return { clock, ...g };
}
const codeFrom = (sent) => /code: (\d{4})/.exec(sent.at(-1).body)[1];
const minute = (clock) => { clock.now += 60_000; };

test('free sign-up: 2 times max, code, confirm, texts at the exact minutes', () => {
  const t = setup();
  assert.equal(t.post({ action: 'signup', phone: '520-555-0123', times: ['05:52', '16:07', '18:00'], days: 'wd' }).ok, false, '3 times without a key is refused');
  assert.equal(t.post({ action: 'signup', phone: '(520) 555-0123', times: ['05:52', '16:07'], days: 'wd' }).ok, true);
  assert.equal(t.sent.at(-1).to, '+15205550123');
  assert.equal(t.post({ action: 'confirm', phone: '5205550123', code: '0000' }).ok, false);
  assert.equal(t.post({ action: 'confirm', phone: '5205550123', code: codeFrom(t.sent) }).ok, true);
  const before = t.sent.length;
  t.api.tick();
  t.clock.now = AZ('2026-11-02T05:51:00'); t.api.tick();
  assert.equal(t.sent.length, before, 'nothing before 5:52');
  t.clock.now = AZ('2026-11-02T05:52:10'); t.api.tick();
  assert.equal(t.sent.length, before + 1, 'texted at 5:52');
  minute(t.clock); t.api.tick();
  assert.equal(t.sent.length, before + 1, 'not twice');
  t.clock.now = AZ('2026-11-02T16:11:00'); t.api.tick(); // trigger skipped 16:07-16:10; caught up
  assert.equal(t.sent.length, before + 2);
});

test('access key raises the limit; bad key refused', () => {
  const t = setup();
  t.api.keysSheet_().appendRow(['neighbor-4', 4, 'Bob']);
  assert.equal(t.post({ action: 'signup', phone: '5205550199', times: ['05:00', '06:00', '07:00'], key: 'nope' }).ok, false);
  const r = t.post({ action: 'signup', phone: '5205550199', times: ['05:30', '06:00', '07:00'], key: 'neighbor-4', days: 'all' });
  assert.equal(r.ok, true);
});

test('daily per-person limit holds even if the sheet is edited to more times', () => {
  const t = setup();
  t.post({ action: 'signup', phone: '5205550111', times: ['05:10', '05:20'], days: 'all' });
  t.post({ action: 'confirm', phone: '5205550111', code: codeFrom(t.sent) });
  t.api.sheet_().getRange(2, 2).setValue('05:10,05:20,05:30'); // someone edits the sheet
  const before = t.sent.length;
  for (const hm of ['05:10', '05:20', '05:30']) { t.clock.now = AZ(`2026-11-02T${hm}:05`); t.api.tick(); }
  assert.equal(t.sent.length, before + 2);
});

test('only-when-something-is-off mode stays quiet on a normal day', () => {
  const t = setup();
  t.post({ action: 'signup', phone: '5205550122', times: ['06:00'], mode: 'off' });
  t.post({ action: 'confirm', phone: '5205550122', code: codeFrom(t.sent) });
  const before = t.sent.length;
  t.clock.verdict.at = new Date(AZ('2026-11-02T05:58:00')).toISOString();
  t.clock.now = AZ('2026-11-02T06:00:30'); t.api.tick();
  assert.equal(t.sent.length, before, 'normal day, fresh data: no text');
  t.clock.verdict = verdict(true);
  t.clock.verdict.at = new Date(AZ('2026-11-03T05:59:00')).toISOString();
  t.clock.now = AZ('2026-11-03T06:00:30'); t.api.tick();
  assert.equal(t.sent.length, before + 1);
});

test('overall daily budget stops texts and emails the owner once', () => {
  const t = setup();
  t.props.set('budget', '2026-11-02 150');
  const r = t.post({ action: 'signup', phone: '5205550133', times: ['06:00'] });
  assert.equal(r.ok, true);
  assert.equal(t.sent.length, 0, 'no text sent past budget');
  assert.equal(t.mails.filter((m) => /budget/.test(m.subject)).length, 1);
});

test('request for more texts emails the owner, not shown publicly, and is rate-limited', () => {
  const t = setup();
  assert.equal(t.post({ action: 'request', contact: 'Bob, 520-555-0100', message: 'Can I get 4 a day?' }).ok, true);
  assert.equal(t.mails[0].to ?? t.mails[0], 'owner@example.com');
  for (let i = 0; i < 12; i++) t.post({ action: 'request', contact: 'x', message: 'y' });
  assert.equal(t.post({ action: 'request', contact: 'x', message: 'y' }).ok, false);
});

test('stop removes the number', () => {
  const t = setup();
  t.post({ action: 'signup', phone: '5205550144', times: ['06:00'] });
  t.post({ action: 'stop', phone: '5205550144' });
  assert.equal(t.api.sheet_().getDataRange().getValues().length, 1);
});

test('code spam limited per number per day', () => {
  const t = setup();
  for (let i = 0; i < 3; i++) { assert.equal(t.post({ action: 'signup', phone: '5205550155', times: ['06:00'] }).ok, true); t.clock.now += 3 * 60_000; }
  assert.equal(t.post({ action: 'signup', phone: '5205550155', times: ['06:00'] }).ok, false);
});

test('stale data still sends, saying so, so nobody is left guessing', () => {
  const t = setup();
  t.post({ action: 'signup', phone: '5205550166', times: ['06:00'], mode: 'off' });
  t.post({ action: 'confirm', phone: '5205550166', code: codeFrom(t.sent) });
  t.clock.now = AZ('2026-11-02T06:00:30'); t.api.tick(); // verdict is from 5:00, an hour old
  assert.match(t.sent.at(-1).body, /couldn't get fresh data/);
});
