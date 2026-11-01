# Rendering reset: preserve work, change the architecture target

Implementation stopped on parent instruction. Latest code checkpoint06e28a6; no more code changes in this reset. Return this plan for coordination before resuming.

| Existing component | Decision | Remaining work |
|---|---|---|
| Original risk/closure/route engine and source freshness | Keep | Confirm home priority and separation from frozen model context |
| Restored home and advanced #/map route | Keep | Apply revised journeys; no new dashboard |
| Routes, crossing IDs, saved routes/navigation | Keep | Supply semantic geometry and status to the geographic renderer |
| Native100m cell footprints, cell-average depths, nativezs and mean terrain | Keep | Same source/cell IDs in flat and3D; preserve units/datum |
| Frozen source snapshots and hourly range controls | Keep | Explicit requested/displayed states and source clocks |
| HAND adapter, source-aware fusion | Keep | Render supported extents only; no invented depth or independent-confidence stacking |
| Leaflet raster map + cell polygons | Diagnostic fallback only | Does not meet requested geographic-data renderer |
| Initial MapLibre + raster OSM customlayer | Reuse camera/GL/data plumbing if useful | Replace raster map source with verified vector/GeoJSON geometry and coherent style; not accepted as complete |
| Detached Three.js dialog/OrbitControls | Retire from product | Do not revive; native export math may be reused |
| Rendering-state/Find modeled water fixes06e28a6 | Keep | Useful visibility/error handling; not evidence that vector architecture is delivered |
| Existing screenshots | Keep as historical evidence | Do not claim they demonstrate new vector scene or user attachment |

## Shared-state contract for coordination

UI owns route/cell selection, model mode, requested/displayed hour, browsing range, units, live/replay clock and geographic viewport. Renderer consumes immutable frame/geometry/source descriptors and emits selection/camera/ready/error events. Model choice and flat/3D choice are independent. Switching rendering mode must not re-fetch unchanged weather, reset selected time or recompute risk from pixels.

Current callable interface is documented in GEOGRAPHIC-MAP-HANDOFF.md; treat it as existing plumbing, not a frozen architecture demand. Agree the minimum adapter changes with the renderer worker before editing shared UI files. Renderer implementation must expose dispose and failure recovery; UI must not label a requested frame displayed until rendering succeeds.

## Sequence after coordination

1. Renderer worker verifies one affordable supported vector source or bounded local geographic extract: real geometry, necessary road/land/water layers, coverage, license, attribution, serving/CORS and resource size. No credentials or paid signup without separate authorization.
2. Agree one shared-state interface and source-to-layer map. Preserve the safety home during this work.
3. Render the same real location/cell at two real model times in flat and3D; verify depth picking and route context. This is the first functional acceptance, not visual decoration.
4. Integrate the home/advanced journeys and explicit unavailable/stale/replay states. Complete phone/desktop review using the authoritative checklist.
5. Record lowspot support or limitation from actual model data. Do not expand the model or fabricate resolution to make the scene impressive.
6. Deliver a remote preview only after its actual scene/data are inspected. State remaining gaps exactly.

Coverage dependency: solver owner reports19of60crossings in-domain, with key LosRobles/NorthTrico and Brawley/AvraValley locations outside. Existing app current manifest has no crossings array; obtain the versioned registry from the solver owner before displaying hydraulic support per crossing. Retain live observations/closures outside. No street-detail claim from100m hydraulics/10m subgrid.

Coordination is the next working step, not an indefinite pause. No duration promise is attached to an unverified vector source or untested renderer. Give a revised ETA once the source and interface are settled.
