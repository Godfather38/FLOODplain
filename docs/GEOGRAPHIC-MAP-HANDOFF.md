# Geographic renderer handoff — separate worker ownership

App branch checkpoint: 05807c2. A first geographic renderer was committed before the ownership split; it is not visually accepted. Reuse or replace it; do not duplicate a detached viewer.

## Ownership
UI owner: public/app.js, public/simulation/map-shell.js, map-layers.js, map-layers.css, docs/MAP-PRODUCT-REQUIREMENTS.md. Renderer worker: tools/simulation/geographic-view-source.js and bundled public/simulation/geographic-view.js, renderer-specific CSS in a NEW geographic-view.css, vendor/maplibre if necessary. Coordinate any shared file edits through the parent.

## Current callable interface
`createGeographicView({leaflet, loaded, get, footprints, routeLayer, onError, onSelectCell})` exported from geographic-view.js. `loaded` is the verified run + manifest; `get` resolves simulation assets; footprints.rings are exact ordered latitude/longitude native cell corners. `routeLayer` is the original Leaflet layer containing the actual displayed route paths/risk pins. Do not invent route risk values.

Returns `{ready, update(frame, modelMode, contextGroup), show(), hide(), active, zoom(delta), select(cellIndex)}`. Add `dispose()` as needed. frame includes time and depthM indexed like run.cells; use original native surface export for zs. contextGroup contains current compatible HAND/rain/flow layers; mode is off/hand/2d/aggregate.

UI owns selected hour/range/model, calls update on changes, and calls hide on leaving #/map. Map container remains the original map surface. show transfers Leaflet center/zoom into the geographic camera; hide transfers back. Account for 256px Leaflet vs 512px MapLibre zoom conventions. Fit/location changes on Leaflet should synchronize while active. Preserve route clicks and selected cell through transitions. No OrbitControls camera detached from geographic map.

## Existing assets
public/simulation/data/frozen-terrain-display.json.gz: native mean terrain + 15 native zs frames, ordered 29,685 cells. public/simulation/data/frozen-cell-footprints.json.gz: exact100m EPSG32612 cell corners. Current run manifest supplies checksum. Mean depth is volume/fullcellarea, NOT zs minus mean/min terrain; use it for color/readout only. Native zs datum is NAVD88.

Pinned MapLibre6.16.0 was installed after npm audit flagged the older4.7.1 reference;6.16.0 audit returned zero vulnerabilities. Current custom render signature uses args.defaultProjectionData.mainMatrix. Three.js0.170.0 remains. OSM raster basemap has no key. Existing implementation uses a constant550m visual z-origin, no vertical exaggeration, wireframe land so basemap stays visible; assess rather than assume accepted.

## Required completion evidence
Same geographic location/routes and selected hour in2D/3D, depth legend and cell tap, nativezs water not mean+mean shortcut, tilt/pan/zoom/fit, mobile fallback/disposal, no stale frame. Do not mark the first renderer accepted just because it was committed.
