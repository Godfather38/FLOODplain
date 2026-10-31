// Runs apps-script/Code.gs against small in-memory stand-ins for Google's services.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { makeGas as make } from './gas-mock.js';
const SRC = readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8');
const makeGas = (clock) => make(clock, SRC, () => []);

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

test('days of the week and days of the month', () => {
  const t = setup();
  t.post({ action: 'signup', phone: '5205550177', times: ['07:00'], days: 'w:2,4' }); // Tue, Thu
  t.post({ action: 'confirm', phone: '5205550177', code: codeFrom(t.sent) });
  assert.match(t.sent.at(-1).body, /Tue, Thu/);
  const before = t.sent.length;
  t.clock.verdict.at = new Date(AZ('2026-11-02T06:59:00')).toISOString();
  t.clock.now = AZ('2026-11-02T07:00:20'); t.api.tick(); // Monday: no
  assert.equal(t.sent.length, before);
  t.clock.verdict.at = new Date(AZ('2026-11-03T06:59:00')).toISOString();
  t.clock.now = AZ('2026-11-03T07:00:20'); t.api.tick(); // Tuesday: yes
  assert.equal(t.sent.length, before + 1);
  const m = setup();
  m.post({ action: 'signup', phone: '5205550188', times: ['07:00'], days: 'm:3,15' });
  m.post({ action: 'confirm', phone: '5205550188', code: codeFrom(m.sent) });
  assert.match(m.sent.at(-1).body, /3rd, 15th of each month/);
});

test('private push topic gets its own schedule', () => {
  const t = setup();
  assert.equal(t.post({ action: 'push', topic: 'washwatch-abc12345xy', times: ['06:30'], days: 'w:1' }).ok, true);
  assert.equal(t.post({ action: 'push', topic: 'not-ours', times: ['06:30'] }).ok, false);
  t.clock.verdict.at = new Date(AZ('2026-11-02T06:29:00')).toISOString();
  t.clock.now = AZ('2026-11-02T06:30:10'); t.api.tick(); // Monday 6:30
  t.api.tick();
  const pushes = t.fetches.filter((f) => f.url.includes('ntfy.sh/washwatch-abc12345xy'));
  assert.equal(pushes.length, 1, 'exactly one push, no duplicates');
  t.post({ action: 'pushstop', topic: 'washwatch-abc12345xy' });
  t.clock.now = AZ('2026-11-09T06:30:10'); t.api.tick();
  assert.equal(t.fetches.filter((f) => f.url.includes('washwatch-abc12345xy')).length, 1, 'stopped');
});
