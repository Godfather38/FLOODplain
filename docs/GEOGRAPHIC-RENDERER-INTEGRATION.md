# Renderer integration boundary (current corrected build)

The UI shared-state implementation at 8ce7b09 is the contract of record. Do not replace it with the earlier proposed second store. This renderer accepts the existing constructor arguments plus `sharedState`, optional `onStatus` and optional `onPick`.

Renderer-owned files: `tools/simulation/geographic-view-source.js`, `geographic-vector-source.js`, `voxel-water-source.js`, `build-geographic-view.mjs`; generated `public/simulation/geographic-view.js`; `public/simulation/geographic-view.css`; renderer data/provenance/tests/docs. UI owns `app.js`, `map-layers.js`, `map-shell.js`, `map-state.js`, `map-layers.css` and authoritative UX checklist. No UI files edited here.

The retained export is `createGeographicView({leaflet, loaded, get, footprints, routeLayer, sharedState, onError, onSelectCell, onStatus, onPick})`. It returns:

- `ready`: initialization promise, rejected on failure.
- `update(frame, modelMode, contextGroup)`: promise; validates current shared request and completes after synchronous GPU geometry submission. UI remains the sole acknowledgment owner.
- `setViewMode('flat'|'3d')`, `viewMode`: both views use the same decoded geographic features, map camera, model object, selection and frame. Flat puts water footprints on the geographic plane; 3D uses native zs and actual terrain.
- `show()`, `hide()`, `active`: visibility lifecycle for entering/leaving advanced map, NOT flat/3D mode selection.
- `zoom(delta)`, `select(cellIndex)`, `dispose()`; `inspect()` is diagnostic only.

Required UI adapter adjustment: instantiate/show this geographic renderer for advanced map in BOTH flat and 3D, not only after clicking 3D. For the flat/3D button call `setViewMode(...)`, not `hide()`. Determine requested/displayed view from `viewMode`, not `active`. Call `hide()` only when leaving advanced map or on explicit fallback. Off means no flood geometry, not removal of the vector basemap. Renderer constructor can still be lazy-loaded when advanced map is first entered. This is an integration change for the UI owner/parent; it has NOT been applied by the renderer worker.

`onStatus` emits geography loading/ready/error, decoded feature count and source layers. `onPick` emits source-layer/feature identity for geographic features. Existing `onSelectCell` remains the cell-selection owner and writes sharedState through UI. Camera changes update `sharedState.setViewport` in the same 256px zoom convention and mirror the Leaflet geographic center for legacy controls. Shared selected cell is consumed without creating a second acknowledgment loop.

Vector source is the verified `https://tiles.openfreemap.org/planet` TileJSON, decoded locally using pinned vector-tile/PBF readers. No OSM raster requests or `ne2_shaded` source exist in this corrected renderer source. Actual decoded geographic features are drawn into the geographic vector layer and into a terrain-top material atlas by the renderer itself. The atlas is an internal render target generated from those features, not downloaded raster basemap imagery; feature identities/attributes remain available for picking. This design choice needs visual acceptance against the user's reference. The old `voxel-map-texture.js` is quarantined, not imported.

The corrected build remains under verification. Do not call it complete from a successful bundle or initialized map. Follow VOXEL-3D-PLAN.md's replacement acceptance checklist and attach known-cell two-hour, flat/3D, route, phone and lifecycle evidence before acceptance.

## Integrated app checkpoint
UI branch ccf1888 imports renderer 5a630f4 and mounts it in advanced flat and 3D modes. Safety home keeps its existing Leaflet map. The geographic renderer uses its supplied maptalks/Three/vector-tile implementation, not the earlier MapLibre raster prototype. No renderer internals were modified by the UI owner.

Remote GitHack app inspection verified initial vector flat mode, routes drawn, cell 9508 at 8 PM (3.504 m) and 9 PM (4.168 m), matching depth popup, 3D switch retaining cell/hour, an 8–10 PM browsing window retaining the 9 PM selection, and returning to safety home with warnings, saved routes and navigation intact. Phone inspection was 390 x 844; desktop 1280 x 720. Follow-up app CSS separates desktop depth card from time controls and hides the depth card while a contextual sheet is open. This is integration evidence, not mobile hardware performance or hydraulic validation. Actual coverage remains 19 of 60 crossing records.

## Flat-first resource contract (active optimization pass)
The UI supplies `initialView: 'flat'` at construction. Constructor readiness must not download native terrain or initialize the Three/voxel renderer. `setViewMode('3d')` is called only from the user's view control, may return a Promise, and is awaited before acknowledging the frame. `setViewMode('flat')` must be a lightweight transition and stop 3D work. Entering Map from Routes resets to flat; time, range and cell selection remain shared. Leaving Map during asynchronous creation or a 3D load must keep the completed surface hidden. The UI invalidates pending view transitions and ignores late completion.

This UI wiring alone does not prove resource savings: the renderer owner must publish its lazy flat/3D implementation, and remote cold-start resources must then be measured. Existing 5a630f4 initializes terrain/Three before flattening and therefore does not meet this requirement.

## Lazy renderer integration d53ec47
Imported both generated renderer chunks, all 15 water-footprint assets and the renderer-owned source/evidence. The flat-first UI lifecycle remains from 6cf7ed2. The prior eager-loading limitation above describes the superseded module; current flat startup uses a selected-hour footprint and no terrain/Three initialization. See CONTINUOUS-RENDERER-OPTIMIZATION.md for measured module-only results and exact limitations. Flat polygons are joined terrain-intersected display geometry; native cell-average depth remains the quantitative readout. No physical model or coverage change.

### Integrated remote evidence (b5d6733)
GitHack safety home requested no renderer/terrain assets. Advanced flat requested geographic-view.js, shared chunk-SHC5IIAK.js, stylesheet and water-footprints-0 only; native terrain and geographic-3d-runtime were absent. The two flat JS files total 674,267 bytes and the initial 10 AM footprint 33,399 bytes, excluding shared run/cell data, CSS and external vector tiles. Explicit 3D then requested its runtime and three terrain assets. Resource inventories are in preview/optimized-app-resources.json. These are committed file sizes, not compressed network transfer bytes.

Actual app verification: cell9508 depth changed 3.504 m at8PM to4.168 m at9PM; explicit 3D then flat then3D worked;8–10PM range retained9PM; leaving for safety home retained warnings/route ratings/saved-route/navigation controls, and reentering Map resetflat. Phone390x844 anddesktop1280x720 screenshots are optimized-app-{flat-phone,3d-phone,3d-desktop}. No browser JavaScript errors observed. The remote timing wait timed out before readiness, so no integrated startup milliseconds are claimed. Module timing/animation/cancellation measurements remain separately identified in CONTINUOUS-RENDERER-OPTIMIZATION.md. Source review confirms completed flat/inactive transition clears the animation interval; physical device performance remains unmeasured.

Minor renderer follow-up: flat popup currently shows replacement glyphs for unavailable row/column, and native surface unavailable because flat deliberately does not load zs. Cell ID, time and depth are correct. Keep that presentation cleanup with the renderer owner; it does not justify eagerly loading terrain again.
