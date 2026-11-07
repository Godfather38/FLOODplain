import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {roadComparison,forecastComparison,comparisonLines,nearestRoadSample} from '../public/simulation/road-comparison.js';
import {routeBoardHtml,crossingWord} from '../public/sim-panels.js';
const point={lat:32.4,lon:-111.2,roadM:600,deck:false};
test('map compares actual road and predicted surface in the same datum, retaining coarse score cap',()=>{
 const r=roadComparison({...point,surface:[600.5],depth:[.1],over:[.1]},0);
 assert.equal(r.differenceM,.5);assert.equal(r.scoredDepthM,.1);
 const lines=comparisonLines(r).join(' ');
 assert.match(lines,/Road:.*NAVD88.*Predicted water:.*NAVD88.*above/);
 assert.match(lines,/Coarse model road depth used for scoring/);
});
test('dry, missing water, and missing road height remain different',()=>{
 assert.equal(roadComparison({...point,surface:[600.5],depth:[0]},0).status,'dry');
 assert.equal(roadComparison({...point,surface:[NaN],depth:[NaN]},0).status,'unavailable');
 assert.equal(roadComparison({roadM:NaN,surface:[600.5],depth:[.5]},0).status,'unavailable');
 assert.equal(roadComparison({...point,surface:[600.5],depth:[.5]},1).status,'unavailable');
});
test('native current forecast elevations only derive from the exact matched station and positive depth',()=>{
 const r={...point,roadM:undefined,maxOver:.04,source:'high_resolution'};
 assert.equal(forecastComparison(r,[point]).waterM,600.04);
 assert.equal(forecastComparison({...r,maxOver:0},[point]).waterM,null);
 assert.equal(forecastComparison(r,[{...point,lon:-111.21}]).status,'unavailable');
 assert.equal(forecastComparison({...r,source:'coarse_fallback'},[point]).status,'unavailable');
});
test('road lookup is bounded, and incomplete/all missing maps never say dry',()=>{
 const pred={routes:{avra:{routeId:'avra',samples:[{...point,over:[NaN]}]}}};
 assert.equal(nearestRoadSample(pred,point).routeId,'avra');
 assert.equal(nearestRoadSample(pred,{lat:33,lon:-111.2}),null);
 assert.match(routeBoardHtml(pred,0,id=>id),/No model result/);
 assert.doesNotMatch(routeBoardHtml(pred,0,id=>id),/No water at the road/);
 assert.match(crossingWord(.01).text,/0\.03 ft over the road/);
});
test('main map defaults to scores and exposes both current and selected-run road comparisons',()=>{
 const code=readFileSync(new URL('../public/map-app.js',import.meta.url),'utf8');
 assert.match(code,/\|\|'routes'/);assert.match(code,/forecastComparison\(r,roadStations/);
 assert.match(code,/roadComparison\(station,Math.round\(sim.clock\)\)/);
 assert.doesNotMatch(readFileSync(new URL('../public/index.html',import.meta.url),'utf8'),/inundation\/index.html/);
});

test('a known surface at road height is shown, and a missing first sample cannot hide a later wet one',()=>{
 const r=forecastComparison({...point,waterM:600,maxOver:0,source:'coarse_fallback'},[]);
 assert.equal(r.status,'water');assert.equal(r.differenceM,0);
 const missing={...point,over:[NaN],surface:[NaN],depth:[NaN]};
 const wet={...point,over:[.1],surface:[600.1],depth:[.1]};
 const html=routeBoardHtml({routes:{avra:{routeId:'avra',samples:[missing,wet]}}},0,id=>id);
 assert.match(html,/Predicted water:/);assert.doesNotMatch(html,/No predicted water height/);
});
