import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { roadForecastText, routeModelText, roadForecastPoint, levelFor, roadForecast } from '../public/road-forecast.js';
import { routeRowsHtml } from '../public/map-routes.js';

test('all positive depths are visible without changing warning thresholds', () => {
  for (const maxOver of [.001, .01, .03, .05, .051, .3]) {
    const r = { maxOver, level: levelFor(maxOver), cells: 1 };
    assert.match(roadForecastText(r), /ft of modeled water over the road/);
    assert.doesNotMatch(roadForecastText(r), /no water|: 0\.0 ft/);
    assert.equal(roadForecastPoint('a', r).level, maxOver >= .3 ? 'danger' : maxOver > .05 ? 'caution' : 'ok');
  }
});
test('checked dry roads, missing data, stale data and partial coverage stay distinct', () => {
  assert.match(roadForecastText({maxOver:0,cells:1}), /no water predicted over the checked road locations/);
  assert.match(roadForecastText({maxOver:-Infinity,cells:1}), /no water predicted/);
  for (const r of [null, {}, {maxOver:null}, {maxOver:-Infinity,cells:0}, {maxOver:0,status:'stale',reason:'Old run.'}]) {
    assert.match(roadForecastText(r), /unavailable/);
    assert.doesNotMatch(roadForecastText(r), /no water/);
  }
  assert.match(roadForecastText({maxOver:0,cells:1,coverage:'partial'}), /coverage is incomplete/);
  assert.equal(routeModelText({sfincs:{status:'loading'}}), 'Model prediction loading.');
});
test('map route score rows show wet, dry and unavailable predictions', () => {
  const routes = [{id:'wet',sfincs:{maxOver:.01,status:'current'}},{id:'dry',sfincs:{maxOver:0,status:'current'}},{id:'missing',sfincs:{status:'unavailable',reason:'No coverage.'}}].map(r=>({...r,level:'ok',score:1}));
  const html=routeRowsHtml({areas:[],routes,info:{},features:[],crossings:[],issue:()=>''});
  assert.equal((html.match(/model-prediction/g)||[]).length,3);
  assert.match(html,/0\.03 ft of modeled water/);
  assert.match(html,/no water predicted/);
  assert.match(html,/Model prediction unavailable: No coverage/);
});
test('home, saved routes, other routes and detail hero expose model output alongside scores', () => {
  const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  assert.match(app,/routeModelText\(best\)/);
  // Saved routes and other routes share one row, which carries the model line.
  assert.match(app,/const routeRow = [\s\S]*?routeModelText\(r\)/);
  assert.match(app,/favorites\.filter\([^\n]*\)\.map\(routeRow\)/);
  assert.match(app,/others\.map\(routeRow\)/);
  assert.equal((app.match(/routeModelText\(r\)/g)||[]).length,2);
  assert.match(app,/roadForecast:\(\)=>data\?\.sfincs/);
});
test('coarse peak retains true elevations separately from capped road depth', () => {
  const time='2026-11-07T01:00:00Z';
  const r=roadForecast({routes:{a:[[0,98,100,-111,32,false]]}},{issuedAt:time},{frames:[{time,surfaceM:[100.1]}]},Date.parse(time)).routes.a;
  assert.equal(r.roadM,98);assert.equal(r.waterM,100.1);assert.equal(r.groundM,100);
  assert.ok(Math.abs(r.maxOver-.1)<1e-9);
});

test('HAND evidence links to the existing map rather than a separate estimates page', () => {
  const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  assert.match(app,/href="#\/map">See predicted water on the map/);
  assert.doesNotMatch(app,/href="inundation\//);
});
