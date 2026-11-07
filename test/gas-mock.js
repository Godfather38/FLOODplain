import { gunzipSync } from 'node:zlib';
// In-memory stand-ins for Google Apps Script services, for tests.
export function makeGas(clock, SRC, fetchAllImpl) {
  const sent = []; const fetches = []; const mails = []; const logs = []; const locks = [];
  let uuid = 0;
  let locked = false;
  const props = new Map();
  const cache = new Map();
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
    return { 'yyyy-MM-dd': `${p.year}-${p.month}-${p.day}`, 'HH:mm': `${p.hour}:${p.minute}`, H: String(Number(p.hour)), m: String(Number(p.minute)), u: String(dow), d: String(Number(p.day)) }[pat];
  };
  const RealDate = Date;
  class FakeDate extends RealDate { constructor(...a) { super(...(a.length ? a : [clock.now])); } static now() { return clock.now; } }
  const g = {
    Date: FakeDate,
    console: { warn: (message) => logs.push(message) },
    SpreadsheetApp: { create: () => ss, openById: () => ss },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props.get(k) ?? null, getProperties: () => Object.fromEntries(props), setProperties: (values) => { for (const [k, v] of Object.entries(values)) { if (clock.onPropertyWrite) clock.onPropertyWrite(k, v); props.set(k, String(v)); } }, setProperty: (k, v) => { if (clock.onPropertyWrite) clock.onPropertyWrite(k, v); return props.set(k, String(v)); }, deleteProperty: (k) => props.delete(k) }) },
    CacheService: { getScriptCache: () => ({ get: (k) => cache.get(k) ?? null, put: (k, v) => { if (clock.onCacheWrite) clock.onCacheWrite(k, v); return cache.set(k, v); } }) },
    UrlFetchApp: { fetchAll: (reqs) => fetchAllImpl(reqs), fetch: (url, opt = {}) => {
      fetches.push({ url, opt });
      if (url.includes('api.twilio.com')) {
        if (clock.twilioThrow) throw new Error('network unavailable');
        sent.push({ to: opt.payload.To, body: opt.payload.Body });
        return { getResponseCode: () => clock.twilioStatus ?? 201, getContentText: () => clock.twilioRaw ?? JSON.stringify(clock.twilioBody ?? {sid:'SM-test',status:'queued'}) };
      }
      return { getContentText: () => JSON.stringify(clock.verdict) };
    } },
    MailApp: { sendEmail: (a, b, c) => { if (clock.onMail) clock.onMail(); if (clock.mailFailure) throw new Error('mail unavailable'); const m = typeof a === 'object' ? a : { to: a, subject: b, body: c }; if (m.to.endsWith('@vtext.com')) sent.push({ to: m.to, body: m.body }); else mails.push(m); }, getRemainingDailyQuota: () => 100 },
    Utilities: { getUuid: () => `delivery-${++uuid}`, formatDate: fmt, base64Encode: (s) => Buffer.from(s).toString('base64'), ungzip: (blob) => ({ getDataAsString: () => gunzipSync(blob.bytes).toString('utf8') }) },
    LockService: { getScriptLock: () => {
      let acquired = false;
      return {
        waitLock(ms) { locks.push({method: 'waitLock', ms}); if (locked || clock.lockBusy) throw new Error('lock held'); acquired = locked = true; },
        tryLock(ms) { locks.push({method: 'tryLock', ms}); if (clock.lockFailure) throw Error('Lock service unavailable'); if (locked || clock.lockBusy) return false; acquired = locked = true; return true; },
        releaseLock() { if (!acquired) throw Error('cannot release unowned lock'); acquired = locked = false; },
      };
    } },
    ScriptApp: { getProjectTriggers: () => [{ getHandlerFunction: () => 'tick' }], newTrigger() {}, getService: () => ({ getUrl: () => 'u' }) },
    Session: { getEffectiveUser: () => ({ getEmail: () => 'owner@example.com' }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ setMimeType: () => JSON.parse(t) }) },
  };
  const api = new Function(...Object.keys(g), `${SRC}; return { ownerErrorDiagnostic_: typeof ownerErrorDiagnostic_ === 'function' ? ownerErrorDiagnostic_ : null, expectedInputHealth_: typeof expectedInputHealth_ === 'function' ? expectedInputHealth_ : null, noteOwnerHealth_: typeof noteOwnerHealth_ === 'function' ? noteOwnerHealth_ : null, ownerHealthWatch_: typeof ownerHealthWatch_ === 'function' ? ownerHealthWatch_ : null, doPost, doGet, tick, sheet_, keysSheet_, CONFIG, computeVerdict_: typeof computeVerdict_ === 'function' ? computeVerdict_ : null };`)(...Object.values(g));
  const post = (body) => api.doPost({ postData: { contents: JSON.stringify(body) } });
  return { api, post, sent, mails, props, ss, fetches, cache, logs, locks };
}

