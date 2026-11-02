// DOM contract for the junction readout. Not a browser or visual-acceptance
// test: it checks that the quantitative scale is present and that the wording
// never promises a modelled current or a safe road.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createJunctionLegend,depthScaleStops,compassWords,phoenixClock,speedWords} from '../tools/simulation/junction-fluid-legend.js';
import {DEPTH_COLORS,DEPTH_CUTS} from '../tools/simulation/voxel-water-source.js';

const element=()=>{const node={tag:'',children:[],dataset:{},style:{},hidden:false,className:'',textContent:'',
  setAttribute(){},append(...xs){node.children.push(...xs);},replaceChildren(...xs){node.children=xs.slice();},remove(){node.removed=true;}};return node;};
const doc={createElement:tag=>{const node=element();node.tag=tag;return node;}};
const build=()=>{const container=element();const legend=createJunctionLegend({document:doc,container});
  const [headline,scale,scaleCaption,travel,shortCaption,caption,details]=legend.root.children;
  return {legend,container,headline,scale,scaleCaption,travel,shortCaption,caption,details,
    travelText:travel.children[1],detailBody:details.children[1]};};

test('the depth scale keeps the existing quantitative palette, in feet',()=>{
  const stops=depthScaleStops();
  assert.equal(stops.length,DEPTH_CUTS.length);
  stops.forEach((stop,i)=>{
    assert.equal(stop.color,DEPTH_COLORS[i]);
    assert.equal(stop.metres,DEPTH_CUTS[i]);
    assert.ok(Math.abs(stop.feet-DEPTH_CUTS[i]*3.280839895)<1e-9);
  });
  assert.deepEqual(stops.map(s=>s.label),['0.03','0.33','0.98','3.3','6.6','13']);
});

test('drift is described in plain compass words or not at all',()=>{
  assert.equal(compassWords(0,1).words,'toward the north');
  assert.equal(compassWords(1,0).words,'toward the east');
  assert.equal(compassWords(-1,-1).words,'toward the south-west');
  assert.equal(compassWords(0.0001,0).words,'barely moving');
  assert.equal(compassWords(NaN,0).words,'unknown');
  assert.ok(Math.abs(compassWords(3,4).speedMps-5)<1e-9);
  assert.equal(compassWords(0,1).degrees,0);
  assert.equal(compassWords(1,0).degrees,90);
});

test('a millimetre-per-second drift is reported in a unit a person can picture',()=>{
  // The measured simulated drift at this junction. "0.00 ft per second" would
  // be arithmetically right and would read as a broken layer.
  assert.equal(speedWords(0.001),'about 0.20 ft per minute');
  assert.doesNotMatch(speedWords(0.001),/0\.00/);
  assert.equal(speedWords(0.2),'about 0.66 ft per second');
  assert.equal(speedWords(0),'almost perfectly still');
  assert.equal(speedWords(NaN),'almost perfectly still');
  assert.match(speedWords(2e-5),/less than 0\.01 ft per minute/);
});

test('source times are shown on the Phoenix clock the rest of the app uses',()=>{
  // Phoenix never changes clocks, so 22:00 UTC is always 3 PM here.
  const shown=phoenixClock('2026-11-01T22:00:00Z');
  assert.match(shown,/Nov 1/);
  assert.match(shown,/3:00/);
  assert.match(shown,/PM/);
  assert.match(shown,/MST$/);
  assert.equal(phoenixClock('not a time'),'time unavailable');
});

test('the phone-sized caveat is always present alongside the long one',()=>{
  const {shortCaption,caption}=build();
  assert.match(shortCaption.textContent,/never a measurement of water on the road/);
  assert.equal(caption.textContent,'','the long caption only appears once the layer reports');
});

test('the legend builds the scale once and hides itself when the layer is off',()=>{
  const {legend,container,scale}=build();
  assert.equal(container.children[0],legend.root);
  assert.equal(scale.children.length,DEPTH_CUTS.length+1,'every depth class plus an explicit missing swatch');
  assert.equal(scale.children.at(-1).textContent,'none');
  assert.equal(legend.root.hidden,true);
  legend.update({status:'off'});
  assert.equal(legend.root.hidden,true);
  legend.dispose();
  assert.equal(legend.root.removed,true);
  legend.update({status:'ready'});
  assert.equal(legend.root.hidden,true,'a disposed legend stops updating');
});

test('missing depth is called missing, never dry or safe',()=>{
  const {legend,scaleCaption}=build();
  legend.update({status:'unavailable',reason:'The water simulation cannot run on this device: no float textures'});
  assert.match(scaleCaption.textContent,/no result there — not dry, not safe/);
  assert.equal(legend.root.hidden,false);
});

test('an unavailable simulation keeps the model’s own numbers in view',()=>{
  const {legend,headline,travelText,caption}=build();
  legend.update({status:'unavailable',reason:'This time is not in the prepared junction package'});
  assert.match(headline.textContent,/unavailable/);
  assert.match(travelText.textContent,/not in the prepared junction package/);
  assert.match(caption.textContent,/does not mean the road is dry/);
  assert.equal(legend.root.hidden,false);
});

test('a ready layer reports the source time, the drift and the simulation caveat',()=>{
  const {legend,headline,travelText,caption,detailBody}=build();
  legend.update({status:'ready',sourceTime:'2026-11-01T22:00:00Z',frameIndex:20,frameCount:57,simulationSteps:40,
    particleCount:2048,radiusMetres:0.31,meanVelocityMps:[0.2,0.1],maxStepDisplacementM:0.237,
    wetVolumeM3:445.036,runId:'refined-full-41344983607',triangles:10660,placementDeviationM:0.0004,
    stepMilliseconds:33.4,substeps:1,skippedSteps:0,imagery:true});
  assert.match(headline.textContent,/Avra Valley Rd & Brawley Wash/);
  assert.match(headline.textContent,/3:00 PM MST/);
  assert.match(headline.textContent,/step 21 of 57/);
  assert.match(travelText.textContent,/toward the north-east/);
  assert.match(travelText.textContent,/ft per second/);
  assert.match(caption.textContent,/does not include a water speed or direction/);
  assert.match(caption.textContent,/never a measurement of water on the road/);
  const lines=detailBody.children.map(node=>node.textContent).join(' | ');
  assert.match(lines,/refined-full-41344983607/);
  assert.match(lines,/2,048 water blobs/);
  assert.match(lines,/445\.0 m³/);
  assert.match(lines,/10,660 baked triangles/);
  assert.match(lines,/NAIP orthophoto, acquisition date unknown/);
  assert.match(lines,/within 0\.000 m/);
  assert.match(lines,/33\.4 ms/);
  assert.match(lines,/not a survey/);
  assert.match(lines,/No bridge clearance is assumed/);
});

test('a freshly reseeded frame says so instead of reporting zero speed',()=>{
  const {legend,travelText}=build();
  legend.update({status:'ready',sourceTime:'2026-11-01T22:00:00Z',frameIndex:20,frameCount:57,
    particleCount:2048,radiusMetres:3.4,meanVelocityMps:[0,0],simulationSteps:0});
  assert.match(travelText.textContent,/where the model puts the water/);
  assert.doesNotMatch(travelText.textContent,/0\.00 ft per second/);
  legend.update({status:'ready',sourceTime:'2026-11-01T22:00:00Z',frameIndex:20,frameCount:57,
    particleCount:2048,radiusMetres:3.4,meanVelocityMps:[0.002,0.001],simulationSteps:14});
  assert.match(travelText.textContent,/Blobs drift/);
  assert.match(travelText.textContent,/ft per minute/,'a millimetre-per-second drift keeps a readable unit');
});

test('reduced motion is explained instead of silently freezing',()=>{
  const {legend,travelText}=build();
  legend.update({status:'ready',sourceTime:'2026-11-01T22:00:00Z',frameIndex:0,frameCount:57,
    particleCount:768,radiusMetres:0.3,meanVelocityMps:[0,0],reducedMotion:true});
  assert.match(travelText.textContent,/reduced motion/);
  assert.match(travelText.textContent,/depth and extent shown are the model’s values/);
});

test('a dry junction says the model holds no water, not that the layer broke',()=>{
  const {legend,headline,travelText}=build();
  legend.update({status:'dry',sourceTime:'2026-11-01T17:00:00Z',frameIndex:0,frameCount:57,particleCount:0,
    radiusMetres:0,meanVelocityMps:[0,0],reason:'The model holds no supported water inside this junction at this time.'});
  assert.match(headline.textContent,/Avra Valley Rd & Brawley Wash/);
  assert.match(travelText.textContent,/no supported water inside this junction/);
  assert.doesNotMatch(travelText.textContent,/drift/,'an empty junction never reports a drift speed');
  assert.equal(legend.root.hidden,false);
});

test('a loading layer never shows stale numbers',()=>{
  const {legend,headline,detailBody,caption}=build();
  legend.update({status:'ready',sourceTime:'2026-11-01T22:00:00Z',frameIndex:1,frameCount:57,particleCount:2048,radiusMetres:0.3,meanVelocityMps:[0.2,0]});
  legend.update({status:'loading'});
  assert.match(headline.textContent,/Loading the junction water/);
  assert.equal(detailBody.children.length,0);
  assert.equal(caption.textContent,'');
});
