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
