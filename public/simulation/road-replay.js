import {loadRoadReplay, ROAD_REPLAY, roadRibbons, selectRoadTiles, intersectsRoadBox} from './road-replay-source.js?v=dev';
import {ROAD_TILE_BOUNDS, ROAD_TILE_SOURCE} from './road-tile-bounds.js?v=dev';
import {createMapState} from './map-state.js?v=dev';
import {mountMapShell} from './map-shell.js?v=dev';

export function roadReplayURL(href, enabled = true) {
  const url = new URL(href); url.hash = '/map';
  for (const name of ['case','replay','time','view']) url.searchParams.delete(name);
  if (enabled) { url.searchParams.set('case','roads'); url.searchParams.delete('live'); }
  else url.searchParams.set('live','1');
  return url.href;
}
const when = t => new Date(t).toLocaleString('en-US', {timeZone:'America/Phoenix',year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}) + ' MST';
const wetColor = '#8c1678';
function readingText(value) {
  return value.status === 'above_road' ? `${(value.maximumAboveRoadM ?? value.aboveRoadM).toFixed(2)} m / ${((value.maximumAboveRoadM ?? value.aboveRoadM) / .3048).toFixed(2)} ft modeled water above estimated road` :
    value.status === 'outside_model' ? 'Outside this model: road-water height unknown' :
    value.status === 'unknown_height' ? 'Road height missing: road-water height unknown' :
    value.status === 'unknown_frame' || value.status === 'unknown_boundary' ? 'Incomplete comparison at this frame: unknown, not dry' :
    'No above-threshold comparison recorded here at this frame. Not evidence of dry pavement or safe passage';
}
export function mountRoadReplay(map, {routeLayer}) {
  document.body.classList.add('road-replay-active');
  const sharedState = createMapState();
  sharedState.subscribe(state => window.dispatchEvent(new CustomEvent('flood-map-state', {detail:state})));
  const host = document.createElement('details'); host.className = 'flood-map-tools';
  host.innerHTML = `<summary>Frozen road replay</summary><div class="flood-tool-body">
    <p class="flood-tag">FROZEN ROAD REPLAY · NOV 1–2, 2026 · NOT LIVE</p>
    <p>Modeled water above estimated road height. This is not a pavement survey or a passability decision. Current route warnings and county closures remain separate.</p>
    <label class="flood-row">Road overlay <select data-model><option value="2d">Shown</option><option value="off">Hidden</option></select></label>
    <label class="flood-row"><input type="checkbox" data-area checked> Nearby roads at street zoom</label>
    <label class="flood-row"><input type="checkbox" data-current-routes> Show current route symbols (different clock)</label>
    <button data-3d disabled aria-describedby="road-view-limit">3D not included in this replay</button>
    <p id="road-view-limit">Flat road replay only. Other model-water layers are suppressed because their run differs. A shared flat/3D geographic scene is a later release.</p>
    <button data-retry type="button">Reload checked road data</button>
    <p data-road-status role="status">Loading the checked road package…</p>
    <details><summary>Source and coverage</summary><p>Run ${ROAD_REPLAY.runId}. Frozen NWM Nov 1 13:00 UTC / HRRR 14:00 UTC inputs. Roads: Overture / OpenStreetMap and USGS 3DEP. Estimated elevations in NAVD88; bridge decks use lidar or flagged approach interpolation, never bare-earth draping.</p><p>Highlights require at least 0.03 m (0.10 ft) above the estimated road and a wet native face of at least 0.01 m. Model-cell support is unresolved in this compact replay and may be coarse; this is not a road-resolved flood measurement. Gray or absent roads are not a dry-road result. Only consecutive highlighted samples form a highlighted line.</p></details>
    <section class="flood-time"><span class="flood-eyebrow">Viewing frozen road model · Arizona</span><output data-clock>Loading…</output><div class="flood-time-controls"><button data-prev disabled aria-label="Previous 15-minute frame">←</button><input data-time type="range" min="0" max="56" value="20" disabled aria-label="Frozen road replay frame"><button data-next disabled aria-label="Next 15-minute frame">→</button></div><div class="flood-time-ends">Nov 1, 10 AM to Nov 2, midnight MST · 57 frames</div></section>
    <div class="flood-viewport"><button data-fit>Find above-road sample</button><button data-home>Fit routes</button><button data-in aria-label="Zoom in">+</button><button data-out aria-label="Zoom out">−</button></div>
  </div>`;
  document.getElementById('map').before(host);
  // Keep original controls: the shell moves the slider, and the live panel has its own data-time.
  const controls = new Map([...host.querySelectorAll('*')].flatMap(el => [...el.attributes].filter(a => a.name.startsWith('data-')).map(a => ['[' + a.name + ']', el])));
  const q = selector => controls.get(selector);
  if (!map.getPane('roadReplay')) map.createPane('roadReplay').style.zIndex = 450;
  const renderer = L.canvas({pane:'roadReplay',padding:.25}), layer = L.layerGroup().addTo(map);
  let source, loading, index = 20, start = 0, end = 56, active = location.hash === '#/map', generation = 0, visibleWet = [], disposed = false;
  const controller = new AbortController();
  const initialBounds = map.getBounds();
  function clear() { layer.clearLayers(); visibleWet = []; map.closePopup(); }
  function setClock(frame) {
    q('[data-clock]').textContent = when(frame.time);
    q('[data-time]').value = index; q('[data-time]').disabled = false;
    q('[data-time]').setAttribute('aria-valuetext', when(frame.time));
    q('[data-prev]').disabled = index <= start; q('[data-next]').disabled = index >= end;
  }
  async function load() {
    if (source) return source;
    loading ??= loadRoadReplay({signal:controller.signal}).then(value => {
      if (ROAD_TILE_SOURCE !== ROAD_REPLAY.roadManifestSha256) throw Error('Road tile extent source mismatch');
      source = value; end = value.times.length - 1;
      sharedState.setDataset({runId:ROAD_REPLAY.runId,artifactSha256:ROAD_REPLAY.modelManifestSha256,frameTimes:source.times});
      return value;
    }).catch(error => { loading = null; throw error; });
    return loading;
  }
  function popup(value, frame) {
    const node = document.createElement('div');
    const heading = document.createElement('strong'); heading.textContent = value.name; node.append(heading);
    for (const text of [when(frame.time) + ' · frozen model, not live', readingText(value),
      value.flags >= 0 && value.flags & 1 ? 'Lidar bridge-deck estimate; no bare-earth draping.' : value.flags >= 0 && value.flags & 2 ? 'Bridge deck estimated from approaches; not surveyed.' : 'Estimated road elevation, not a pavement survey.',
      'Model-cell support is unresolved here and may be coarse. Not a road-resolved flood measurement.', 'No safe-passage claim. County closures and current warnings still apply.']) { const p = document.createElement('p'); p.textContent = text; node.append(p); }
    return node;
  }
  function drawLines(lines, frame, bounds) {
    let wet = 0, segments = 0;
    for (const line of lines) {
      // A per-line bounding box avoids rendering whole centroid tiles outside the view.
      const box = [Infinity,Infinity,-Infinity,-Infinity];
      for (const s of line.stations) { box[0]=Math.min(box[0],s.lon); box[1]=Math.min(box[1],s.lat); box[2]=Math.max(box[2],s.lon); box[3]=Math.max(box[3],s.lat); }
      if (!intersectsRoadBox(box, bounds)) continue;
      const ribbons = roadRibbons(line, frame);
      for (const segment of ribbons.segments) {
        const isWet = segment.status === 'above_road', unknown = segment.status.startsWith('unknown') || segment.status === 'outside_model';
        // Coordinate conversion is explicit: road source lon/lat → Leaflet lat/lon.
        const latlngs = segment.coordinates.map(([lon,lat]) => [lat,lon]);
        L.polyline(latlngs, {renderer,pane:'roadReplay',color:isWet?wetColor:'#65717b',weight:isWet?6:line.kind==='route'?3:2,opacity:isWet?1:.55,dashArray:unknown?'3 5':null,lineCap:'round',smoothFactor:0})
          .bindTooltip(isWet?'Modeled water above estimated road':'Road comparison: '+readingText(segment)).bindPopup(() => popup(segment,frame)).addTo(layer);
        segments++; if (isWet) { wet++; visibleWet.push(latlngs[0]); }
      }
      for (const point of ribbons.points) {
        const latlng = [point.coordinate[1],point.coordinate[0]];
        L.circleMarker(latlng, {renderer,pane:'roadReplay',radius:4,color:'#fff',weight:1,fillColor:wetColor,fillOpacity:1})
          .bindTooltip('Isolated above-road model sample').bindPopup(() => popup(point,frame)).addTo(layer);
        wet++; visibleWet.push(latlng);
      }
    }
    return {wet,segments};
  }
  async function render() {
    const token = ++generation; clear();
    if (!active || disposed) return;
    let requestId = sharedState.request({model:q('[data-model]').value,index,view:'flat'});
    if (q('[data-model]').value === 'off') { q('[data-road-status]').textContent = 'Road overlay hidden. No model-water layer is substituted.'; return; }
    try {
      await load(); if (token !== generation || disposed || !active) return;
      // The source catalogue sets the exact selected timestamp before this request.
      requestId = sharedState.request({model:'2d',index,view:'flat'});
      const frame = source.frame(index), b = map.getBounds(), bounds = [b.getWest(),b.getSouth(),b.getEast(),b.getNorth()];
      const files = selectRoadTiles(source.manifest, ROAD_TILE_BOUNDS, bounds, q('[data-area]').checked && map.getZoom() >= 13);
      source.retain(files.map(f => f.path));
      const priority = await source.loadTile('routes.bin.gz');
      if (token !== generation || !sharedState.isCurrent(requestId)) return;
      let total = drawLines(priority,frame,bounds); setClock(frame);
      q('[data-road-status]').textContent = 'Priority routes loaded; checking nearby roads…';
      // Bound concurrent decompression/memory. Old requests never publish over a new frame.
      for (let i = 0; i < files.length; i++) {
        const file = files[i]; if (file.tier === 'routes') continue;
        if (token !== generation || disposed) return;
        const lines = await source.loadTile(file.path);
        if (token !== generation || !sharedState.isCurrent(requestId)) return;
        const result = drawLines(lines,frame,bounds); total.wet += result.wet; total.segments += result.segments;
        await new Promise(resolve => requestAnimationFrame(resolve));
      }
      if (token !== generation || disposed) return;
      sharedState.acknowledge({requestId,time:frame.time,model:'2d',view:'flat'});
      q('[data-road-status]').textContent = `${total.wet} highlighted segments/samples in loaded roads; ${files.length} checked tiles. ${map.getZoom()<13?'Zoom closer for other nearby roads. ':''}Gray or absent is not dry.`;
      window.dispatchEvent(new CustomEvent('road-replay-state', {detail:{...frame,readStation:undefined,loadedTiles:files.length,segments:total.segments,wet:total.wet,view:'flat'}}));
    } catch (error) {
      if (token !== generation || disposed) return;
      clear(); sharedState.fail(requestId,error.message); q('[data-road-status]').textContent = 'Road replay unavailable: ' + error.message + '. No replacement run shown.';
      q('[data-clock]').textContent = 'No road frame displayed';
    }
  }
  function findWater() { if (visibleWet.length) map.setView(visibleWet[0],Math.max(16,map.getZoom())); else { map.setView([32.39322,-111.29459],16); q('[data-road-status]').textContent='Centered Brawley. A frame may contain no above-road sample here; this does not establish dry pavement.'; } }
  mountMapShell(host,map,{load,sharedState,findWater,state:()=>({frames:(source?.times??[]).map(time=>({time})),start,end}),applyWindow:(a,b)=>{sharedState.setRange(a,b);start=a;end=b;index=Math.max(a,Math.min(b,index));q('[data-time]').min=a;q('[data-time]').max=b;render();},
    replay:{source:'Frozen Nov 1–2, 2026 road model · not current weather',legend:'Purple line / dot: modeled water above estimated road. Gray: no complete above-threshold evidence; not dry.',status:'Road-only replay. Other model water and 3D disabled; current warnings remain separate.'}});
  const banner = document.createElement('section'); banner.className = 'road-replay-banner';
  banner.innerHTML = '<strong>Frozen road replay · not live</strong><a data-return-live>Return to live</a>';
  banner.querySelector('a').href = roadReplayURL(location.href,false); document.querySelector('.map-dock').prepend(banner);
  q('[data-prev]').onclick=()=>{index=Math.max(start,index-1);render();}; q('[data-next]').onclick=()=>{index=Math.min(end,index+1);render();};
  q('[data-time]').oninput=e=>{index=Number(e.target.value);render();}; q('[data-model]').onchange=render; q('[data-area]').onchange=render;
  q('[data-current-routes]').onchange=e=>{e.target.checked?map.addLayer(routeLayer):map.removeLayer(routeLayer);};
  q('[data-fit]').onclick=findWater; q('[data-home]').onclick=()=>map.fitBounds(initialBounds); q('[data-in]').onclick=()=>map.zoomIn(); q('[data-out]').onclick=()=>map.zoomOut();
  q('[data-retry]').onclick=()=>{source=null;loading=null;render();};
  map.on('moveend',render);
  function layout() { active=location.hash==='#/map'; if(active){if(!q('[data-current-routes]').checked)map.removeLayer(routeLayer);render();}else{++generation;clear();map.addLayer(routeLayer);} }
  window.addEventListener('hashchange',layout);
  // App route drawing can add current symbols again; keep the clock separation explicit.
  window.addEventListener('flood-screen-rendered',()=>{if(active&&!q('[data-current-routes]').checked)map.removeLayer(routeLayer);});
  window.addEventListener('pagehide',event=>{++generation;clear();if(event.persisted)return;disposed=true;controller.abort();map.off('moveend',render);});
  window.addEventListener('pageshow',event=>{if(event.persisted&&!disposed){active=location.hash==='#/map';render();}});
  if(active){map.setView([32.39322,-111.29459],16,{animate:false});layout();}
  return {sharedState,load,render};
}
