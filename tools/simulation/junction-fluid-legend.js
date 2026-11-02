// Renderer-owned readout for the junction fluid layer. It lives inside the
// renderer's own surface element, beside the existing map note and cell popup,
// and never edits the UI owner's controls, safety screens or onboarding.
//
// Two jobs: keep the quantitative depth scale on screen in feet, and say in
// plain words that the drifting blobs are a local simulation rather than a
// modelled current. Exact cell values stay in the existing cell popup.
import {DEPTH_COLORS,DEPTH_CUTS} from './voxel-water-source.js';

const FEET=3.280839895;
const finite=Number.isFinite;
const BEARINGS=['north','north-east','east','south-east','south','south-west','west','north-west'];

export function depthScaleStops(){
  return DEPTH_CUTS.map((metres,i)=>{const feet=metres*FEET;
    return {metres,feet,color:DEPTH_COLORS[i],
      label:feet<1?feet.toFixed(2):feet<10?feet.toFixed(1):String(Math.round(feet))};});
}

export function compassWords(eastMps,northMps){
  if(!finite(eastMps)||!finite(northMps))return {words:'unknown',degrees:null,speedMps:0};
  const speedMps=Math.hypot(eastMps,northMps);
  if(speedMps<0.005)return {words:'barely moving',degrees:null,speedMps};
  const degrees=(Math.atan2(eastMps,northMps)*180/Math.PI+360)%360;
  return {words:'toward the '+BEARINGS[Math.round(degrees/45)%8],degrees,speedMps};
}

// The simulated drift is around a millimetre a second. Printing that as
// "0.00 ft per second" reads as a broken layer, so very slow speeds switch to a
// unit a person can picture. The number is the same measurement either way.
export function speedWords(metresPerSecond){
  if(!finite(metresPerSecond)||metresPerSecond<1e-5)return 'almost perfectly still';
  const feetPerSecond=metresPerSecond*FEET;
  if(feetPerSecond>=0.01)return `about ${feetPerSecond.toFixed(2)} ft per second`;
  const feetPerMinute=feetPerSecond*60;
  if(feetPerMinute>=0.01)return `about ${feetPerMinute.toFixed(2)} ft per minute`;
  return 'less than 0.01 ft per minute';
}

export function phoenixClock(iso){
  const time=Date.parse(iso);
  if(!finite(time))return 'time unavailable';
  return new Date(time).toLocaleString('en-US',{timeZone:'America/Phoenix',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})+' MST';
}

export function createJunctionLegend({document:doc,container}={}){
  if(!doc||typeof doc.createElement!=='function')throw Error('A document is required for the junction legend');
  const make=(tag,className)=>{const node=doc.createElement(tag);if(className)node.className=className;return node;};
  const root=make('div','junction-fluid-legend');
  root.dataset.junctionLegend='';
  root.setAttribute('role','status');
  root.hidden=true;

  const headline=make('strong','junction-headline');
  const scale=make('div','junction-depth-scale');
  const scaleCaption=make('small','junction-scale-caption');
  scaleCaption.textContent='Average water depth in the model’s cells, in feet. Grey means the model has no result there — not dry, not safe.';
  for(const stop of depthScaleStops()){
    const swatch=make('span','junction-swatch');
    swatch.style&&(swatch.style.background=stop.color);
    swatch.dataset.depthFeet=stop.feet.toFixed(2);
    swatch.textContent=stop.label;
    scale.append(swatch);
  }
  const missing=make('span','junction-swatch junction-swatch-missing');
  missing.style&&(missing.style.background='#8d969d');
  missing.textContent='none';
  scale.append(missing);

  const travel=make('div','junction-travel');
  const arrow=make('span','junction-arrow');
  arrow.setAttribute('aria-hidden','true');
  arrow.textContent='↑';
  const travelText=make('span','junction-travel-text');
  travel.append(arrow,travelText);

  // Phone-sized restatement of the same caveat. The shared time dock already
  // carries the depth scale on a phone, so the long version and this layer's
  // own scale are hidden there rather than stacked on top of the dock.
  const shortCaption=make('p','junction-caption-short');
  shortCaption.textContent='A simulation of the saved model’s water — never a measurement of water on the road.';
  const caption=make('p','junction-caption');
  const details=make('details','junction-details');
  const summary=make('summary');
  summary.textContent='Where these numbers come from';
  const detailBody=make('div','junction-detail-body');
  details.append(summary,detailBody);

  root.append(headline,scale,scaleCaption,travel,shortCaption,caption,details);
  container?.append?.(root);

  let disposed=false;
  function update(view={}){
    if(disposed)return;
    shortCaption.textContent=view.status==='unavailable'
      ?'Native model water remains visible. Missing close-up detail does not mean the road is dry.'
      :"A simulation of the saved model's water — never a measurement of water on the road.";
    const {status,sourceTime,frameIndex,frameCount,particleCount,meanVelocityMps=[0,0],
      maxStepDisplacementM,radiusMetres,reducedMotion,runId,triangles,placementDeviationM,
      stepMilliseconds,substeps,skippedSteps,reason,imagery,wetVolumeM3,hostTerrainOverview,physicalRadiusMetres,
      simulationSteps,meanSpeedMps,coupling,flowTime,playback,developerReason,groundFallback}=view;
    root.hidden=status==='off';
    if(status==='off')return;
    if(status==='loading'){
      headline.textContent='Loading the junction water…';
      travelText.textContent='Reading the saved model output for this crossing.';
      caption.textContent='';
      detailBody.replaceChildren();
      return;
    }
    if(status==='unavailable'){
      headline.textContent='Close-up water unavailable here';
      // Plain English only. The raw module URL and exception text are useful
      // to a developer and meaningless to someone checking a road, so they go
      // under the disclosure rather than into the card everyone reads.
      travelText.textContent=reason||'This view cannot show the close-up water.';
      caption.textContent='The map still shows the model’s own water and depths here. An empty close-up does not mean the road is dry.';
      detailBody.replaceChildren(...[
        groundFallback?.meaning,
        developerReason?'Technical detail: '+developerReason:null,
      ].filter(Boolean).map(text=>{const p=make('p');p.textContent=text;return p;}));
      return;
    }
    const frameLabel=finite(frameIndex)&&finite(frameCount)?` · step ${frameIndex+1} of ${frameCount}`:'';
    headline.textContent=`Water at Avra Valley Rd & Brawley Wash — ${phoenixClock(sourceTime)}${frameLabel}`;
    const drift=compassWords(meanVelocityMps[0],meanVelocityMps[1]);
    if(finite(drift.degrees)&&arrow.style)arrow.style.transform=`rotate(${drift.degrees.toFixed(0)}deg)`;
    arrow.hidden=!finite(drift.degrees);
    travelText.textContent=!particleCount
      ? (reason||'The model holds no water inside this junction at this time. That is the model’s result, not a road check.')
      : reducedMotion
      ? 'Movement is switched off because your device asks for reduced motion. The depth and extent shown are the model’s values for this time.'
      // Straight after a frame change the blobs sit exactly where the model put
      // them and have not moved yet. Saying "0.00 ft per second" there reads as
      // a broken layer rather than as a starting position.
      : !simulationSteps
      ? 'Set out where the model puts the water at this time. The drift starts in a moment.'
      // How fast the blobs move and which way the water goes overall are two
      // different numbers. The net drift is a vector mean, so blobs circling
      // inside the junction cancel out in it — reporting that as the speed
      // would say "barely moving" about water the owner can see travelling.
      // The net drift of the blobs is the SIMULATION settling and sloshing — it
      // is not where the saved run says the water goes. The crossing at this
      // junction runs northward in the saved data while the blobs' net drift
      // can point anywhere, so the two must never be merged into one sentence.
      : `Blobs move ${speedWords(finite(meanSpeedMps)?meanSpeedMps:drift.speedMps)}${
          finite(drift.degrees)?`; the blobs themselves are drifting ${drift.words}`:''}.`;
    // One sentence on top. Everything technical lives under the existing
    // disclosure, so the readout stops competing with the scene it explains.
    caption.textContent='A simulation of this model’s saved water, not a measurement of water on the road.';
    const lines=[
      'The blobs are a small water simulation run here in your browser, started from the depth and water level this model saved.',
      // What the saved run does and does not contain, stated as it actually
      // stands. It records how much water crosses each cell edge and which way,
      // so direction here is the model's own. It records no speed: the speeds
      // below are that crossing rate divided by the model's own water depth.
      coupling==='coupled'&&flowTime
        ? `Direction comes from the saved run itself: it records how much water crosses each cell edge and which way, at ${phoenixClock(flowTime)}. Speed is worked out from that crossing rate and the model's own water depth — the run does not store a speed, so treat the numbers as derived rather than measured.`
        : coupling==='no-exact-snapshot'
        ? 'The saved run records edge flow once an hour and water every quarter hour. This time is not on the hour, so no flow is applied here and the drifting is the simulation on its own. Nothing is interpolated.'
        : coupling==='binding'
        ? 'Loading this time’s edge flow from the saved run.'
        : 'This time has no edge flow loaded, so the drifting is the simulation on its own rather than the saved run’s direction.',
      runId?`Saved model run ${runId}; frozen replay, not current weather.`:null,
      finite(particleCount)?`${particleCount.toLocaleString()} water blobs, drawn about ${(radiusMetres*2*FEET).toFixed(1)} ft across so they can be seen${finite(physicalRadiusMetres)?` (the water each one stands for is about ${(physicalRadiusMetres*2*FEET).toFixed(2)} ft)`:''}. That is a drawing size, not a droplet and not a shoreline.`:null,
      coupling==='coupled'
        ? 'The streaks show which way the water is going. They are drawn at a fixed length — the speed is the number above, not the streak.'
        : 'The streaks show which way the simulation is pushing the water. They are drawn at a fixed length — the speed is the number above, not the streak.',
      finite(wetVolumeM3)?`Seeded from ${(wetVolumeM3*FEET**3).toFixed(1)} cu ft of model water that its own terrain supports inside this junction.`:null,
      finite(maxStepDisplacementM)?`Largest blob move in the last step: ${(maxStepDisplacementM*FEET).toFixed(3)} ft.`:null,
      finite(meanSpeedMps)?`Two separate numbers: the blobs move ${speedWords(meanSpeedMps)}, while their net drift is only ${speedWords(drift.speedMps)} — blobs going opposite ways inside the junction cancel each other out in that second figure. Net drift is the simulation settling, not the saved run's direction; that one comes from the edge crossings and is what the streaks show.`:null,
      // Playback speed, named plainly and kept apart from the source time in
      // the heading. The water's own speed is not being changed.
      playback&&playback.simulatedSecondsPerDisplaySecond>1.2
        ? `Played back about ${playback.simulatedSecondsPerDisplaySecond.toFixed(1)}× faster than real time, because this much water moving this slowly shows nothing at real speed. The water's own speed and the model's flow numbers are unchanged — only how much simulated time passes per second of yours. The time in the heading is still the model's own saved time.`
        : null,
      finite(triangles)?`${triangles.toLocaleString()} baked triangles of source terrain and road here.`:null,
      imagery===false?'Aerial reference photo unavailable; ground shown in flat colour.':imagery?'Ground photo: USGS/USDA NAIP orthophoto, acquisition date unknown.':null,
      finite(placementDeviationM)?`Placement checked against the live map projection: within ${(placementDeviationM*FEET).toFixed(3)} ft.`:null,
      hostTerrainOverview===true?'The ground away from this crossing is the coarse whole-area surface; only the crossing itself is close-up terrain.':null,
      finite(stepMilliseconds)?`Simulation step ${stepMilliseconds.toFixed(1)} ms on this device${finite(substeps)?`, ${substeps} per frame`:''}${skippedSteps?`, ${skippedSteps} skipped to protect the map`:''}.`:null,
      'Road width here is a map class default, not a survey. No bridge clearance is assumed.'
    ].filter(Boolean);
    const children=lines.map(text=>{const p=make('p');p.textContent=text;return p;});
    detailBody.replaceChildren(...children);
  }
  return {root,update,
    dispose(){if(disposed)return;disposed=true;root.remove?.();}};
}
