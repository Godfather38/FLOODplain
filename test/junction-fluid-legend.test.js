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
  // The top line stays short so the readout does not compete with the scene;
  // the full caveat must still be there, under the disclosure, never dropped.
  assert.ok(caption.textContent.length<120,'the always-visible caption stays one short sentence');
  assert.match(caption.textContent,/not a measurement of water on the road/);
  // With no coupling the readout must say the drifting is the simulation on its
  // own, rather than claiming the saved run's direction.
  assert.match(detailBody.children.map(n=>n.textContent).join(' '),
    /no edge flow loaded, so the drifting is the simulation on its own/);
  const lines=detailBody.children.map(node=>node.textContent).join(' | ');
  assert.match(lines,/refined-full-41344983607/);
  assert.match(lines,/2,048 water blobs/);
  assert.match(lines,/15716\.3 cu ft/);
  assert.match(lines,/10,660 baked triangles/);
  assert.match(lines,/NAIP orthophoto, acquisition date unknown/);
  assert.match(lines,/within 0\.001 ft/);
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
  assert.match(travelText.textContent,/Blobs move/);
  assert.match(travelText.textContent,/ft per minute/,'a millimetre-per-second drift keeps a readable unit');
});

// How fast the blobs move and which way the water goes overall are different
// quantities. Reporting the cancelling vector mean as the speed told the reader
// "barely moving" about water that is visibly travelling.
test('the readout separates how fast blobs move from where the water goes overall',()=>{
  const {legend,travelText,detailBody}=build();
  legend.update({status:'ready',sourceTime:'2026-11-01T22:00:00Z',frameIndex:20,frameCount:57,
    particleCount:2048,radiusMetres:3.4,simulationSteps:40,
    meanVelocityMps:[0.0009,0.0004],meanSpeedMps:0.21});
  assert.match(travelText.textContent,/Blobs move about 0\.69 ft per second/,
    'the stated speed is how fast the blobs actually move');
  assert.doesNotMatch(travelText.textContent,/drifting/,
    'a net drift too small to have a direction does not get given one');
  // The net drift of the blobs is the simulation settling. It must never be
  // worded as where the saved run says the water goes: at this junction the
  // crossing cell's native transport is northward regardless of which way the
  // particle cloud happens to be sloshing.
  assert.doesNotMatch(travelText.textContent,/the water overall heading/,
    'the blobs’ net drift must not be presented as the water’s direction');
  assert.match(detailBody.children.map(n=>n.textContent).join(' '),/cancel each other out/,
    'the difference between the two numbers is explained, not hidden');
  // A net drift large enough to point somewhere is named alongside the speed.
  legend.update({status:'ready',sourceTime:'2026-11-01T22:00:00Z',frameIndex:20,frameCount:57,
    particleCount:2048,radiusMetres:3.4,simulationSteps:40,
    meanVelocityMps:[0,0.04],meanSpeedMps:0.21});
  assert.match(travelText.textContent,/Blobs move about 0\.69 ft per second/);
  assert.match(travelText.textContent,/the blobs themselves are drifting toward the north/i,
    'the net drift is given, named as the blobs’ own drift rather than the water’s direction');
  assert.doesNotMatch(travelText.textContent,/the water overall/,
    'the simulation’s drift is never promoted to the water’s direction');
});

// Running more simulated seconds per wall second is the only honest way to make
// a 0.17 m/s native flow readable. It must be named, and it must not be allowed
// to read as a faster current or a different time.
test('accelerated playback is labelled as a display speed, not a faster current',()=>{
  const {legend,detailBody,headline}=build();
  const text=()=>detailBody.children.map(n=>n.textContent).join(' | ');
  const base={status:'ready',sourceTime:'2026-11-01T22:00:00Z',frameIndex:20,frameCount:57,
    particleCount:2048,radiusMetres:3.4,simulationSteps:40,meanSpeedMps:0.07,meanVelocityMps:[0,0.02],
    coupling:'coupled',flowTime:'2026-11-01T22:00:00Z'};
  legend.update({...base,playback:{simulatedSecondsPerDisplaySecond:8.1,simulatedSeconds:81,displaySeconds:10}});
  assert.match(text(),/Played back about 8\.1× faster than real time/);
  assert.match(text(),/water's own speed and the model's flow numbers are unchanged/);
  assert.match(text(),/time in the heading is still the model's own saved time/);
  // The saved source time stays exactly what it was, in the heading.
  assert.match(headline.textContent,/Nov 1, 3:00 PM MST/);
  // At real time there is nothing to label.
  legend.update({...base,playback:{simulatedSecondsPerDisplaySecond:1,simulatedSeconds:10,displaySeconds:10}});
  assert.doesNotMatch(text(),/faster than real time/,
    'unaccelerated playback must not claim a speed-up');
});

// The saved run DOES record which way water crosses each cell edge. Saying it
// has no direction was true before the flow contract landed and is not now;
// what it still lacks is a stored speed, and that distinction has to survive.
test('the readout tells the truth about what the saved run supplies, per state',()=>{
  const {legend,detailBody}=build();
  const text=()=>detailBody.children.map(n=>n.textContent).join(' | ');
  const base={status:'ready',sourceTime:'2026-11-01T22:00:00Z',frameIndex:20,frameCount:57,
    particleCount:2048,radiusMetres:3.4,simulationSteps:40,meanSpeedMps:0.07,meanVelocityMps:[0,0.02]};

  legend.update({...base,coupling:'coupled',flowTime:'2026-11-01T22:00:00Z'});
  assert.match(text(),/records how much water crosses each cell edge and which way/,
    'coupled: the direction is the saved run’s own');
  assert.match(text(),/the run does not store a speed/,
    'coupled: the speed is still declared as derived, not measured');
  assert.match(text(),/streaks show which way the water is going/);
  assert.doesNotMatch(text(),/does not include a water speed or direction/,
    'the old blanket claim must not come back');

  legend.update({...base,coupling:'no-exact-snapshot',flowTime:null});
  assert.match(text(),/not on the hour, so no flow is applied here/);
  assert.match(text(),/Nothing is interpolated/);
  assert.doesNotMatch(text(),/crosses each cell edge and which way/,
    'an uncoupled time must not borrow the coupled wording');

  legend.update({...base,coupling:'binding',flowTime:null});
  assert.match(text(),/Loading this time’s edge flow/,'loading is a state the reader is told about');

  // A status of "coupled" with no time behind it must not produce a sentence
  // that names a time. That combination is exactly what the phone was showing.
  legend.update({...base,coupling:'coupled',flowTime:null});
  assert.match(text(),/no edge flow loaded/);
  assert.doesNotMatch(text(),/at undefined|Invalid Date|at null/);
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
