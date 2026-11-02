import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {RISK_COLORS,UNKNOWN_COLOR} from '../public/semantic-colors.js';
import {routeEntries,liveCoverage,coverageText,liveGaugeReading} from '../public/simulation/route-tracking.js';

const read=p=>readFileSync(new URL('../public/'+p,import.meta.url),'utf8');
const tracking=JSON.parse(read('simulation/data/route-tracking.json'));
const coverage=JSON.parse(read('inundation/data/coverage.json'));
const roads=JSON.parse(read('inundation/road-heights.json'));
const brawley=tracking.entries.find(e=>e.id==='brawley-dip');

test('route tracking data holds no frozen model records or old readings',()=>{
 const text=JSON.stringify(tracking);
 assert.doesNotMatch(text,/modelOutputs|coverageStatus|runId|frozen|validFrom|"points"/);
 assert.equal(new Set(tracking.entries.map(e=>e.id)).size,tracking.entries.length);
 for(const r of ['trico','avra','silverbell-north','silverbell-south','pr-ina','pr-twinpeaks','pr-avra','pr-gates'])assert.ok(routeEntries(tracking,r).length>0,r);
});
test('a stretch selects its own record, and an unknown route selects none',()=>{
 assert.deepEqual(routeEntries(tracking,'avra','brawley-dip').map(e=>e.id),['brawley-dip']);
 assert.equal(routeEntries(tracking,'trico','brawley-dip').length,0);
 assert.equal(routeEntries(tracking,'missing').length,0);
});
test('live coverage reports real sources and never claims dry',()=>{
 const c=liveCoverage(brawley,{handPoints:coverage.points,roadHeights:roads.points,closures:[{lat:32.3932,lon:-111.2951,location:'x',status:'Proceed with Caution'}]});
 assert.equal(c.forecast,true);assert.equal(c.roadHeight,true);assert.equal(c.county.length,1);assert.ok(c.gauges>0);
 assert.match(coverageText(c),/Live forecast compared with road height/);
 const none=liveCoverage({coordinates:[-100,30],gaugeAssociations:[]},{handPoints:coverage.points,roadHeights:roads.points});
 assert.match(coverageText(none),/No live forecast here.*no linked gauge/);
 assert.doesNotMatch(coverageText(none),/dry|clear|safe/i);
});
test('gauge readings come only from live feeds and keep their own clock',()=>{
 assert.deepEqual(liveGaugeReading('USGS-09487000',{flows:{'09487000':{fresh:true,cfs:10,time:5,risingFast:false}}}),{cfs:10,time:5,risingFast:false});
 assert.equal(liveGaugeReading('USGS-09487000',{flows:{'09487000':{fresh:false}}}),null);
 const alert={stream:[{site:'6443',flow_cfs:332,last_rpt:'2026-11-02T19:00:00Z'}]};
 assert.equal(liveGaugeReading('ALERT-6443',{alert}).cfs,332);
 assert.equal(liveGaugeReading('ALERT-6443',{alert:{stream:[{...alert.stream[0],maintenance:true}]}}),null);
});
test('production map cannot start a dated model',()=>{
 const layers=read('simulation/map-layers.js'),shell=read('simulation/map-shell.js'),app=read('app.js'),live=read('live-map.js');
 assert.doesNotMatch(layers+shell+app,/road-replay|mountRoadReplay|silverbell-|all-route|scene-contract|home-outlook/);
 assert.match(layers,/async function enterMap\(\)\{notifyRender\(\{status:'off'/);
 assert.doesNotMatch(layers.match(/async function enterMap[^\n]*/)[0],/ensureRenderer/);
 assert.match(layers,/let caseChoice='frozen'/);
 assert.doesNotMatch(layers,/selectedMapCase\(location/);
 assert.doesNotMatch(shell,/data-panel="time"/);
 assert.doesNotMatch(live,/current-sfincs-manifest/);
 for(const f of ['simulation/road-replay.js','simulation/all-route-data.js','simulation/silverbell-data.js'])assert.ok(!existsSync(new URL('../public/'+f,import.meta.url)),f);
 assert.doesNotMatch(read('show-me-how.js'),/frozen|replay|model cell/i);
 assert.doesNotMatch(read('accessible-ui.css'),/saved-replay|road-replay|recorded-point/);
});
test('retained model water never reaches bridge evidence',()=>{
 assert.doesNotMatch(read('simulation/bridge-evidence.js'),/current-sfincs-manifest/);
});
test('shared colors reach the map pins, including half-point scores',()=>{
 const app=read('app.js');
 assert.match(app,/installRiskColors\(\)/);assert.match(app,/const COLOR = RISK_COLORS/);
 assert.match(app,/pin \$\{s \? `s\$\{Math\.floor\(s\)\}` : 'sq'\}/);
 assert.equal(Object.keys(RISK_COLORS).length,5);assert.match(UNKNOWN_COLOR,/^#/);
});
test('newer closure and road-height behavior is preserved',()=>{
 const app=read('app.js');
 for(const s of ['closureBanner','closed-note','closure-pin','view.closedPoints','roadEvents: d.roadEvents','feed=roadevents','p.routeBarricade'])assert.ok(app.includes(s),s);
 assert.ok(read('hand-model.js').includes('./inundation/road-heights.json'));
});
