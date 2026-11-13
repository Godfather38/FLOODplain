import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {handViewBounds} from '../public/live-map.js';
import {RISK_COLORS,UNKNOWN_COLOR} from '../public/semantic-colors.js';
import {decodeJunction,computeExtent,depthGrid,depthBand,HAND_DEPTH_BANDS} from '../public/inundation/hand-inundation.js';
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
 assert.equal(coverageText(none),'');
 assert.doesNotMatch(coverageText(none),/dry|clear|safe/i);
});
test('gauge readings come only from live feeds and keep their own clock',()=>{
 assert.deepEqual(liveGaugeReading('USGS-09487000',{flows:{'09487000':{fresh:true,cfs:10,time:5,risingFast:false}}}),{cfs:10,time:5,risingFast:false});
 assert.equal(liveGaugeReading('USGS-09487000',{flows:{'09487000':{fresh:false}}}),null);
 const alert={stream:[{site:'6443',flow_cfs:332,last_rpt:'2026-11-02T19:00:00Z'}]};
 assert.equal(liveGaugeReading('ALERT-6443',{alert}).cfs,332);
 assert.equal(liveGaugeReading('ALERT-6443',{alert:{stream:[{...alert.stream[0],maintenance:true}]}}),null);
});
test('shared colors reach the map pins, including half-point scores',()=>{
 const app=read('app.js');
 assert.match(app,/installRiskColors\(\)/);assert.match(app,/const COLOR = RISK_COLORS/);
 assert.match(app,/pin \$\{s \? `s\$\{Math\.floor\(s\)\}` : 'sq'\}/);
 assert.equal(Object.keys(RISK_COLORS).length,5);assert.match(UNKNOWN_COLOR,/^#/);
});
test('newer closure and road-height behavior is preserved',()=>{
 const app=read('app.js');
 for(const s of ['closureBanner','closed-note','closure-pin','view.closedPoints','roadEvents: d.roadEvents','feed=all','p.routeBarricade'])assert.ok(app.includes(s),s);
 assert.ok(read('hand-model.js').includes('./inundation/road-heights.json'));
});

const brawleyHand=decodeJunction(JSON.parse(read('inundation/data/west-avra-valley-road-32-39322-111-29459.json')));
test('HAND depth covers exactly the estimated extent, using stage minus HAND',()=>{
 for(const flow of [5,50,500]){
  const e=computeExtent(brawleyHand,flow),d=depthGrid(brawleyHand,e);let wet=0;
  for(let i=0;i<d.length;i++){
   assert.equal(Number.isFinite(d[i]),e.mask[i]===1);
   if(e.mask[i]){wet++;const expected=e.stages[brawleyHand.catchment[i]].stageM-brawleyHand.handCm[i]/100;assert.ok(d[i]>=0);assert.ok(Math.abs(d[i]-Math.max(0,expected))<1e-5);}
  }
  assert.equal(wet,e.wetCells);assert.ok(wet>0);
 }
 const none=computeExtent(brawleyHand,0);assert.equal(none.wetCells,0);
});
test('every depth falls in one blue or teal band, and the legend uses feet',()=>{
 assert.deepEqual([0,.05,.1,.3,1,2,4,50].map(depthBand),[0,0,1,2,3,4,5,5]);
 for(const {rgb:[r,g,b]} of HAND_DEPTH_BANDS)assert.ok(b>r&&g>=r,'water colors have no amber or red');
 assert.deepEqual(HAND_DEPTH_BANDS.map(b=>b.label),['0–0.3','0.3–1','1–3.3','3.3–6.6','6.6–13.1','13.1+']);
});
test('the HAND layer paints depth bands, no amber, and sits under routes and crossings',()=>{
 const live=read('live-map.js');
 assert.doesNotMatch(live,/edb45b|bd720b|Amber/);
 assert.match(live,/HAND_DEPTH_BANDS\[depthBand\(r\.depthM\[i\]\)\]/);
 assert.match(live,/pane:'floodHand'/);assert.match(read('simulation/map-shell.js'),/HAND modeled water depth estimate \(ft\)/);
 assert.equal(RISK_COLORS[4],'#ad4315');assert.equal(RISK_COLORS[5],'#b51f2a');
});
test('the HAND view frames all estimated water and the crossing',()=>{
 const e=computeExtent(brawleyHand,5),[[s,w],[n,east]]=handViewBounds(brawleyHand,e.mask),g=brawleyHand.grid;
 assert.ok(s<=brawleyHand.crossing.lat&&n>=brawleyHand.crossing.lat&&w<=brawleyHand.crossing.lon&&east>=brawleyHand.crossing.lon);
 for(let i=0;i<e.mask.length;i++)if(e.mask[i]){const row=Math.floor(i/g.cols),col=i%g.cols,lat=g.latMax-(row+.5)*g.dLat,lon=g.lonMin+(col+.5)*g.dLon;assert.ok(lat>=s&&lat<=n&&lon>=w&&lon<=east)}
});
test('map icons carry the risk color into the older renderer too',()=>{
 const app=read('app.js');
 assert.match(app,/L\.marker\(\[fp\.lat, fp\.lon\], \{ color: COLOR\[Math\.floor\(s\)\] \?\? UNKNOWN_COLOR,/);
 assert.match(app,/L\.marker\(\[c\.lat, c\.lon\], \{ color: COLOR\[5\],/);
});
test('the Current conditions panel matches Map options and its stylesheet updates with each release',()=>{
 const css=read('live-map.css'),embedded=css.match(/\.embedded-live\{[^}]*\}/)[0];
 assert.match(embedded,/background:var\(--surface-2\)/);assert.match(embedded,/color:var\(--on\)/);assert.match(embedded,/padding:12px/);
 assert.match(read('index.html'),/href="live-map\.css\?v=dev"/);
});
