# Map product requirements — authoritative experimental UX brief

This file records Marshall's clarified intent. It overrides older experimental viewer, atlas, heatmap and terrain-demo plans. Keep original app functionality. A successful render is not acceptance. Latest clarification: SAFETY AND ROUTES ARE THE HOME PRODUCT. The full-screen geographic map is an advanced view, not a replacement home.

## Product and non-negotiable meaning
- The home prioritizes existing closures, warnings, live readings, risk explanations, freshness, saved routes and navigation. Its basic map offers a compact aggregate cell-depth outlook; the frozen run is explicitly frozen, never current weather. Advanced controls belong to `#/map` in the same app.
- Preserve the existing geographic map: Leaflet/OSM, routes, crossings, saved routes, live observations, closures and navigation remain.
- 2D flood data shades exact native model-cell footprints over that map, quantitatively by available cell-average depth. No circles, radial heatmaps, pooled blobs, smoothed contours standing in for cells, fabricated resolution or decorative waves.
- A visible quantitative depth key is essential. Tap a cell for model, selected hour, depth in metres AND feet, and missing/zero distinction. Mean depth means water volume divided by full cell area; it is not surveyed road depth or native water-surface elevation.
- 3D is an alternative GEOGRAPHIC MAP LAYER/VIEW, sharing viewport, time/range, selection and route context. A detached modal, analytics viewer, isolated terrain scene or chart is rejected, even if technically accurate. The prior separate Three.js viewer is disabled pending integration.
- Use native zs for water-surface elevation if 3D is implemented. Never derive it by adding mean depth to mean terrain. Preserve datum and actual grid geometry. A100m cell does not resolve its within-cell wet footprint.

## Interaction
- Advanced map phone default is sparse and map-first: labelled Routes, Time, Map options; substantial48px main controls. One contextual nonmodal sheet at a time; desktop adapts to one side pane. No universal floating Navigate button; navigation belongs to a selected route/place.
- Start/End hour selectors,6h/12h/full available span presets, Apply/Cancel. Selected range is the browsing window; Showing time is one actual frame.15timestamps span14elapsed hours. No fake minute precision or silent maximum-depth aggregation.
- Preserve viewport while scrubbing, changing layers or routine data refresh. Keep models/layers, sources and optional3D behind Map options. Retain explicit frozen/stale/error status.
- Missing HAND/rain frames clear their layer, never hold an old frame beneath a new timestamp. Missing model depth is visibly distinct from0. Related NOAA forcing is not independent confirmation.
- Recent observations Today/last24hours are secondary and API-backed. Older archive browsing deferred. Do not refresh frozen model inputs or start production automation as a UI task.

## Prefab first
Use existing Leaflet Canvas polygon renderer for native footprint shading. Reuse installed libraries and official examples before writing new effects. Three.js0.170.0+OrbitControls is already vendored under MIT; native terrain/zs exports are reusable, but a map-aligned3D implementation is still missing.
References: https://leafletjs.com/reference.html#canvas ; https://developer.android.com/design/ui/mobile/guides/layout-and-content/adapt-layout ; https://developer.apple.com/design/human-interface-guidelines/maps ; https://www.nngroup.com/articles/progressive-disclosure/ ; https://threejs.org/manual/pages/voxel-geometry.html ; https://threejs.org/manual/pages/transparency.html . Examples must be checked against installed version and product requirements, not copied blindly.

## Acceptance ledger
| Requirement | State and evidence |
|---|---|
| Original geographic app preserved | Implemented; remote routes, live feeds and navigation inspected in b79e0d9 |
| Sparse phone / one sheet / desktop side pane | Verified390x844,360x800 default no page scroll;320px reflow; public/simulation/preview/redesign-*.png |
| Start/End and Apply/Cancel | Verified6h window restricts endpoint;12h draft Cancel preserves6h; hour stays synchronized |
| Exact per-cell2D depth | Implemented854877c using29,685 EPSG32612 footprints,100m corners; remote854877c inspected native square cells on the street map at8PM MST |
| Depth in metres/feet and no-data | Implemented cell popup and quantitative map key; gray missing, transparent below.01m/outside; verified cell9344 at8PM:3.368m /11.05ft with model/time/semantics in popup |
| Map-aligned3D | MISSING. Detached scene rejected and disabled. Existing native zs export matches all15x29,685 values exactly, but that is data evidence, not completed map integration |
| Recent API observations | Verified93Cortaro provisional flow readings;15min cache; null/empty/429retention checks pass |
| Automatic model updates | NOT ENABLED. Preview is frozen. Existing live refresh remains; no production schedule/trigger changes |

Before claiming done, inspect actual phone and desktop: visible geographic location, selected time, quantitative depth, functioning cell tap and range controls. Publish non-sensitive screenshot evidence. Report missing requirements plainly. Do not replace this checklist with 'renders', test counts, architecture notes or promises of accuracy.

## Latest visual evidence and 3D constraint
The exact-cell layer was inspected remotely at commit 854877c on desktop and at 390x844. The phone tap returned SFINCS cell 10446, Nov 1 8 PM MST, 0.034 m / 0.11 ft mean depth. Screenshots: `public/simulation/preview/native-cell-depth-desktop.png` and `native-cell-depth-phone.png`. These captures precede b05fdbd's open-popup refresh and range-label spacing fixes; those fixes are not claimed visually verified here.

The official MapLibre Leaflet adapter explicitly lacks bearing/pitch/rotation support: https://github.com/maplibre/maplibre-gl-leaflet . It cannot supply the requested tilted map. The smallest viable path to assess is an optional MapLibre surface in the existing map container, with a geographic custom layer and shared center/zoom/time/range/selection/routes. Retain Leaflet for 2D. Existing native zs, cell footprints and Three.js instances can supply geometry, but OrbitControls on a detached scene cannot supply the shared geographic camera. This is a pending integration decision, not completed 3D.

## Safety-first correction (latest instruction)
The earlier map-first HOME interpretation is rejected. Preserve the original published safety engine and visible route experience; do not hide it behind a sheet. The advanced map may remain full-screen with one contextual sheet. A two-hour shortcut browses two actual hourly intervals in the frozen case, not a live two-hour forecast. Unknown model coverage cannot clear official closures or observed hazards.

Current implementation restores original screen content on home and routes, with the basic map alongside on desktop and below on phone. `#/map` is the advanced map route. Geographic 3D uses MapLibre 6.16.0 and Three.js 0.170.0 custom layer on the same map surface, with shared time and geographic camera. It is under visual verification, not yet marked accepted. Terrain is lightly drawn native 100 m block wireframes to retain street context; native water levels are elevated relative to a constant 550 m display origin, preserving physical differences (no relief exaggeration). Colors and tap values remain cell-average depth, not water-surface elevation or exact wet area.
