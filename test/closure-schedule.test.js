import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { roadEventTiming, roadEventActive, roadEventLabel, normalizeRoadEvents, roadEventsOnRoute } from '../public/logic.js';
const time = (s) => Date.parse(s + '-07:00');
const now = time('2026-11-04T17:00:00');
// Schedules verified in the public AZ511 Traffic Events UI on Nov 4, 2026.
const cortaro = { closed:true, start:time('2026-11-15T18:00:00'), stop:time('2026-11-17T06:00:00') };
const frontage = { closed:true, start:time('2026-11-17T18:00:00'), stop:time('2026-11-19T06:00:00') };
test('Cortaro and frontage future windows are scheduled, not closed now', () => {
  for (const e of [cortaro, frontage]) {
    assert.equal(roadEventTiming(e, now), 'scheduled');
    assert.equal(roadEventActive(e, now), false);
    assert.match(roadEventLabel(e, now), /^Scheduled closure/);
    assert.match(roadEventLabel(e, now), /AZ/);
  }
});
test('start is inclusive and anticipated end is exclusive, without declaring open', () => {
  assert.equal(roadEventTiming(cortaro, cortaro.start-1), 'scheduled');
  assert.equal(roadEventTiming(cortaro, cortaro.start), 'active');
  assert.equal(roadEventTiming(cortaro, cortaro.stop-1), 'active');
  assert.equal(roadEventTiming(cortaro, cortaro.stop), 'ended');
  assert.match(roadEventLabel(cortaro, cortaro.stop), /reopening unconfirmed/);
});
test('overnight daily windows include both sides of midnight', () => {
  const e = {...cortaro, start:time('2026-11-01T00:00:00'), dailyStart:21*60, dailyEnd:5*60};
  for (const hour of ['21:00:00','23:59:00','00:00:00','04:59:00']) assert.equal(roadEventTiming(e,time('2026-11-04T'+hour)), 'active');
  for (const hour of ['05:00:00','12:00:00','20:59:00']) assert.equal(roadEventTiming(e,time('2026-11-04T'+hour)), 'scheduled');
});
test('missing, malformed and inverted times remain unknown and conservatively block', () => {
  for (const e of [{}, {start:null,stop:null}, {start:'tomorrow'}, {start:NaN}, {start:now+1,stop:now}, {stop:now+1000}, {start:now-1,dailyStart:500}, {start:now-1,dailyStart:0,dailyEnd:1440}, {start:now-1,dailyStart:300,dailyEnd:300}, {start:now-1,timingUnknown:true}]) {
    assert.equal(roadEventTiming(e,now),'unknown');
    assert.equal(roadEventActive(e,now),true);
    assert.match(roadEventLabel(e,now), /^Closure listed; timing unverified/);
  }
});
test('untimed legacy TransView closures do not become verified active', () => {
  const [e] = normalizeRoadEvents([{KeyID:1020711, headline:'W Cortaro Farms Rd', trafficImpacts:'Road Closed', Geo:'POINT (-111.1 32.4)'}],null);
  assert.equal(roadEventTiming(e,now),'unknown');
  assert.equal(roadEventActive(e,now),true, 'retain conservative route exclusion');
});
test('malformed source dates remain unknown after JSON transport', () => {
  for (const overrides of [{StartDate:'11/31/2026 6:00:00 PM'}, {StartDate:'not a date'}, {DailyStartTime:'25:00:00'}, {DailyStartTime:'06:75:00'}]) {
    const [e] = normalizeRoadEvents(null, {1:{KeyID:1, Headline:'Construction', EventSubTypes:['ROAD_CLOSED'], StartDate:'11/1/2026 6:00:00 PM', StopDate:'11/19/2026 6:00:00 AM', Geography:'POINT (-111.1 32.4)', ...overrides}});
    assert.equal(roadEventTiming(JSON.parse(JSON.stringify(e)),now),'unknown');
  }
});
test('a known closure still blocks the matching route while future one does not', () => {
  const f = {geometry:{type:'LineString',coordinates:[[-111.1,32.4],[-111.1,32.401]]},properties:{legs:[{road:'Cortaro Farms Rd'}]}};
  const e = {...cortaro, type:'POINT', parts:[[[-111.1,32.4]]], headline:'W Cortaro Farms Rd'};
  assert.equal(roadEventsOnRoute(f,[e],now).length,0);
  assert.equal(roadEventsOnRoute(f,[e],e.start).length,1);
  assert.equal(roadEventsOnRoute(f,[{...e,start:null,stop:null}],now)[0].timing,'unknown');
});
test('map only paints verified active windows; listing uses timing label', () => {
  const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  assert.match(app,/closedEvents = .*roadEventTiming\(e, d.now\) === 'active'/);
  assert.match(app,/status: roadEventLabel\(e, now\)/);
  assert.doesNotMatch(app,/Every route has a road closure/);
});
