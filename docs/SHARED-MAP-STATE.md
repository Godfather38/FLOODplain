# Shared map state — UI/renderer integration contract

Implemented in public/simulation/map-state.js. UI owner is map-layers.js/map-shell.js; renderer worker must not edit those files in parallel. Existing renderer constructor receives one new optional argument: `sharedState`. Existing renderer data arguments remain unchanged.

## State

`sharedState.snapshot()` returns a detached object:
- clockMode: frozen_replay (current published package).
- requested: {requestId, model: off|hand|2d|aggregate, view: flat|3d, index, time: UTC ISO or null before catalogue load}.
- displayed: same request fields plus runId, or null. This identifies the actual rendered frame, never merely the selected control.
- status: off|loading|ready|error; error: message|null.
- range: {start,end} indices in the actual hourly catalogue.
- viewport: {center:[longitude,latitude],zoom,bounds:[west,south,east,north]}|null. Zoom here follows Leaflet256px convention; MapLibre512px conversion remains renderer-owned.
- selection: null or {kind:cell,cellIndex,lat?,lon?,routeId?} or {kind:location,lat,lon}. Retain cell identity across view switches.

## Lifecycle and ownership

UI calls setDataset({runId,frameTimes,cellCount,artifactSha256}) after verified native output and footprint loading. UI calls request({model,index,view}) and passes the matching frame to the renderer. Each call increments requestId. Range is changed explicitly with setRange(start,end), returning the clamped hour; camera/selection do not change.

The existing `update(frame, modelMode, contextGroup)` may return a Promise. It MUST resolve only when the matching geometry is ready for display, or reject on failure. The UI captures requestId and acknowledges {requestId,time,model,view} only after completion. Stale acknowledgments are ignored; mismatched frame/time/model acknowledgments throw. The worker must not also acknowledge if using this existing UI wrapper. If changing to a callback-based adapter, coordinate to keep exactly one acknowledgment owner.

For same-scene asynchronous renderers: keep the previous frame/time together until the replacement is ready, or clear both. Never swap visible geometry from an obsolete request after a newer request was issued. Use sharedState.isCurrent(requestId) before committing asynchronous work; the UI rejection of a stale label does not by itself prevent stale GPU geometry.

Renderer camera changes should call setViewport with geographic center/bounds and the documented zoom convention. Renderer picking should use select({kind:cell,cellIndex,...}); UI's onSelectCell callback already does that for the existing constructor. `subscribe(fn)` returns an unsubscribe function. UI broadcasts snapshots as flood-map-state events for current DOM consumers. This event is UI state, not a forecast feed.

Renderer owns show/hide/dispose, native vector basemap/style and graphic resources. UI owns controls, source-clock labels, range, safety-home navigation and the requested/displayed distinction. Keep compatible input and selection when changing flat/3D. No weather refresh or solver run on a display switch.

## Coverage contract

Native cell coverage uses exact geographic rings, indexed like run.cells and frame.depthM. createCoverageIndex(rings).find(lat,lon) returns an actual containing cell or null, not nearest-cell/bounding-box support. nativeCellReadout distinguishes outside_domain, no_result, zero and depth. All values remain cell-average depth.

Optional solver crossing registry schema:
`{schemaVersion:1,runId,artifactSha256,records:[{crossingId,status:'inside_native_cell'|'outside_domain',cellIndex?,method?,geometryVersion?}]}`.
Inside records require a nonnegative integer cellIndex and method. Registry run/hash must match the displayed package. Absent/mismatched records are unverified. No hardcoded19/60 count or bridge-clearance claim. The registry is not currently supplied to the app; actual native footprint membership is available for geographic inspection while roadway support stays unverified. Parent/solver owner should supply the real registry and its source path before wiring acquisition.

## Direct checks completed

Focused tests exercise out-of-order completion, wrong-frame rejection, failed-render clearing, range/view preservation of viewport/selection, exact outside-cell distinction, zero versus null and missing registry. These validate state behavior only; the raster fallback remains temporary and is not proof of the requested vector scene.
