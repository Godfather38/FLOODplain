# Renderer integration boundary (current corrected build)

The UI shared-state implementation at 8ce7b09 is the contract of record. Do not replace it with the earlier proposed second store. This renderer accepts the existing constructor arguments plus `sharedState`, optional `onStatus`, optional `onPick`, and `initialView: 'flat'` (the default).

Renderer-owned files: `tools/simulation/geographic-view-source.js`, `geographic-vector-source.js`, `voxel-water-source.js`, `build-geographic-view.mjs`; generated `public/simulation/geographic-view.js`; `public/simulation/geographic-view.css`; renderer data/provenance/tests/docs. UI owns `app.js`, `map-layers.js`, `map-shell.js`, `map-state.js`, `map-layers.css` and authoritative UX checklist. No UI files edited here.

The retained export is `createGeographicView({leaflet, loaded, get, footprints, routeLayer, sharedState, initialView = 'flat', onError, onSelectCell, onStatus, onPick})`. It returns:

- `ready`: initialization promise, rejected on failure.
- `update(frame, modelMode, contextGroup)`: promise; validates current shared request and completes after the requested flat footprint is fetched/validated/installed, or after 3D geometry submission. Superseded frame completions are rejected. UI remains the sole acknowledgment owner.
- `await setViewMode('flat'|'3d')`, `viewMode`: both views share decoded geographic features, camera, selection and frame. Flat draws merged, terrain-intersected water footprints. Explicit 3D dynamically imports the Three runtime and loads native zs plus terrain, then draws joined terrain and clipped water meshes. Flat does not instantiate a ThreeLayer or model.
- `show()`, `hide()`, `active`: visibility lifecycle for entering/leaving advanced map, NOT flat/3D mode selection.
- `zoom(delta)`, `select(cellIndex)`, `dispose()`; `inspect()` is diagnostic only.

Required UI adapter adjustment: instantiate/show this geographic renderer for advanced map in BOTH flat and 3D, not only after clicking 3D. For the flat/3D button call `setViewMode(...)`, not `hide()`. Determine requested/displayed view from `viewMode`, not `active`. Call `hide()` only when leaving advanced map or on explicit fallback. Off means no flood geometry, not removal of the vector basemap. Renderer constructor can still be lazy-loaded when advanced map is first entered. This is an integration change for the UI owner/parent; it has NOT been applied by the renderer worker.

`onStatus` emits geography loading/ready/error, decoded feature count and source layers. `onPick` emits source-layer/feature identity for geographic features. Existing `onSelectCell` remains the cell-selection owner and writes sharedState through UI. Camera changes update `sharedState.setViewport` in the same 256px zoom convention and mirror the Leaflet geographic center for legacy controls. Shared selected cell is consumed without creating a second acknowledgment loop.

Vector source is the verified `https://tiles.openfreemap.org/planet` TileJSON, decoded locally using pinned vector-tile/PBF readers. No OSM raster requests or `ne2_shaded` source exist in this corrected renderer source. Actual decoded geographic features are drawn into the geographic vector layer and into a terrain-top material atlas by the renderer itself. The atlas is an internal render target generated from those features, not downloaded raster basemap imagery; feature identities/attributes remain available for picking. This design choice needs visual acceptance against the user's reference. The old `voxel-map-texture.js` is quarantined, not imported.

The corrected build remains under verification. Do not call it complete from a successful bundle or initialized map. Follow VOXEL-3D-PLAN.md's replacement acceptance checklist and attach known-cell two-hour, flat/3D, route, phone and lifecycle evidence before acceptance.


## Lazy flat and continuous-water contract

The UI lifecycle at `6cf7ed2` is compatible: pass `initialView: 'flat'`, await mode switches, and guard acknowledgment after leaving the map. `show`/`hide` still control advanced-map visibility. UI remains the sole shared-state acknowledgment owner. Selection uses original native cell IDs and cell-average depths in both views; flat picking does not need native-zs data.

Flat requests only `data/water-footprints-{frameIndex}.json.gz` for the selected `loaded.run.frames` index. These are GeoJSON FeatureCollections with top-level `sourceSha256`, `time`, `displayResolutionM: 10`, `hydraulicResolutionM: 100`, and per-feature `properties.depthClass` from 0 through 5. Polygon and MultiPolygon holes are retained. They are generated from existing native hourly zs intersected with the retained 10 m DEM, merged within depth classes; they are a downscaled display, not a 10 m hydraulic solution or surveyed shoreline. The cache holds at most three frames. Obsolete requests are cancelled and cannot replace the requested frame; missing frames clear previous water.

The generated entry `public/simulation/geographic-view.js` now imports files under `public/simulation/renderer-chunks/`. Integrate those chunks with the entry, CSS and all fifteen water-footprint assets. Do not copy only the entry bundle. The shared Maptalks chunk loads in flat; the Three runtime chunk and `frozen-terrain-display.json.gz`, `frozen-voxel-terrain.f32.gz`, and its metadata load only after explicit 3D selection. The 1 m patch remains conditional on close zoom.

Pass `get(path, {signal})` through to the underlying fetch options so cancellation stops network transfer. If a legacy `get` ignores options, the renderer still cancels awaiting/installation and checks lifecycle tokens before allocating 3D, but cannot force that fetch implementation to abort its underlying request. Hidden maps cancel vector requests and timers; returning to flat stops 3D animation and hides its geometry. The initialized 3D resources remain cached for fast repeat entry until `dispose()`, which releases the map and model resources.

Mobile pixel ratio is capped at 1 (desktop 1.5); geometry budgets are 30,000 versus 80,000 sample quads. Cosmetic water animation is bounded at 15 Hz only while 3D is active and visible, and is disabled for reduced motion. Ordinary flat rendering is event driven.
