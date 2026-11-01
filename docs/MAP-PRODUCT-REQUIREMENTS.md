# FLOODplain: safety home and geographic flood map

Authoritative product and UX checklist, reset 2026-11-01 after the user's instruction to interrupt both builds. Supersedes every earlier map-first-home, standalone-viewer, raster-overlay and decorative-effects acceptance checklist. Implementation stopped for this checklist reset; resume the corrected plan after parent/renderer interface coordination, not an indefinite hold or a new approval ritual. Preserve existing code and data; do not restart or discard working components.

## What we are building, in human terms

Open FLOODplain to understand your route: what is closed, what the gauges and warnings say, what changed, and how fresh that information is. The existing safety engine stays at the center.

Open the map when you want to see the water: where the model places it, how deep it is, and how it changes over the available hours. Roads, land and permanent water are drawn from geographic data. Model water belongs in that same geographic scene. Switching between a flat map and a tilted view keeps the same place, hour, route and selected cell.

Tap a road or crossing to understand the route implications. Tap modeled water to read the depth and time. The app must make it equally clear when it does not know. It must not turn missing coverage into a clear road.

This is an upgrade to the existing app, not a second dashboard or a replacement safety engine. A frozen run is a replay, even if presented with a simulated clock.

## What the user rejected

- Raster street-map pictures with painted graphics presented as the requested geographic renderer. That is the current implementation, not the final architecture.
- Green land-cover areas being mistaken for modeled flooding; decorative pools, radial circles, particles or smoothed blobs standing in for real model cells.
- A separate terrain/analytics window with its own camera, time controls and lost road context.
- Hiding warnings, route recommendations, saved routes or navigation behind a full-screen map home.
- A play/pause bar without a readable selected time, range or useful control.
- Claiming completion from HTTP200, a loaded library, a screenshot of the basemap, or 'it renders'.
- Using better graphics to imply better model resolution, road-depth accuracy, verified lowspots or calibrated confidence.

## Home journey: decide what to do about a route

1. Open the existing home. See active warnings/closures and source freshness before relying on a recommendation. Keep the existing risk explanation and navigation behavior.
2. Read the suggested route and its reasons. Other routes and saved routes remain directly reachable; closures cannot be cleared by a model.
3. See a compact map/outlook beside the safety content on desktop, after the route summary on phone. Default model treatment is aggregate evidence, with individual sources accessible in the advanced map.
4. Browse a convenient two-hour window only if supported by actual frames. If the only package is frozen, label its real date and 'Frozen replay — not current weather'. Do not call it 'next two hours' of today's weather.
5. Tap a crossing for observed status, model concern, missing coverage and a short Why explanation. Simulation can add concern; an absence of modeled water is not clearance.
6. Choose Explore map for geographic exploration. Returning restores the same route/home context.

Home acceptance: actual warning/closure and stale-source states remain visible; navigation and saved routes work; the model cannot replace or silently downgrade the original engine. Show this with the existing route data and a known exclusion/unknown case, not a made-up safe route.

## Advanced map journey: understand where water goes

1. Enter #/map within the same app. Keep the current geographic center, scale, route and selected hour. A visible Home/Routes control returns to safety content.
2. Render roads, land use/cover, permanent water and labels from a real vector-tile or bounded GeoJSON source. The source/style, license, coverage, CORS and hosting must be verified. A raster tile source under MapLibre is still raster and does not satisfy this requirement.
3. Render native model geometry in that coordinate system. 2D uses actual cell footprints and quantitative depth. 3D uses verified terrain and native water-surface elevation with the same cell identity. Use the geographic camera; no detached OrbitControls scene.
4. Select HAND, 2D model or Aggregate. Explain only the active source and actual availability. Aggregate preserves differences and disagreements; it does not average incompatible depths or count shared NOAA forcing as independent evidence.
5. Select Flat/3D independently from model choice. Preserve place, hour, range, route, selection and units. If 3D is unavailable, retain a functioning flat geographic map and show the reason.
6. Select an hour or edit Start/End. The range limits browsing; it does not silently become maximum depth across the period. Previous/next and labeled non-drag choices must work.
7. Tap a cell: show model, exact displayed hour, cell-average depth in metres/feet, resolution and missing state. Tap a route: show original risk, relevant model evidence, freshness and why the assessment changed or stayed unchanged.
8. Fit route, fit model bounds, locate or reset view deliberately. Time/model changes must not jerk the camera around. A Find modeled water action is optional wayfinding to actual nonzero data, never a manufactured demonstration.

## Rendering contract and states

State has separate fields for geographic viewport, selected route/cell, flat/3D view, requested model/hour, displayed model/hour, range, units and source clock. One owner updates it; renderer and UI consume it.

| State | What the user sees | Required behavior |
|---|---|---|
| Off | Geographic map and existing route markers; model explicitly off | No residual model geometry |
| Loading | Requested source/hour and loading state | Keep old displayed time with old frame, or clear it; never relabel old graphics as the new hour |
| Ready | Displayed source/hour, quantitative depth key, actual geometry | Cell picking and legend use the same frame values |
| Valid but shallow/dry | Below-display-threshold/zero stated distinctly | Do not amplify tiny values into dramatic flooding; do not claim road passability |
| Outside domain | No model coverage here | Do not treat outside bounds as dry; offer explicit fit/return |
| Missing cell or frame | Unknown/no result | Clear stale geometry; missing is not numeric zero |
| HAND-only | Estimated extent; no invented depth | Depth readout unavailable if provider does not supply it |
| Source disagreement | Mixed evidence with source names | Preserve conflict; no blind average |
| Fetch/decode/render failure | Visible failure and retained live safety content | No silent unchanged basemap presented as a successful mode switch |
| Stale/expired live source | Original source time plus stale state | Retrieval/check time does not renew observation age |
| Frozen replay | Original date, issue/valid time and replay label | Never mixed into real-current route recommendations |

Map-data layers are semantic: quiet land background, recognizable roads/labels and permanent water; modeled depth uses a distinct quantitative palette. Missing coverage has its own treatment. Rain and flow are separate overlays with units, not alternative names for flood depth. No velocity arrows without vector output; available NWM discharge is not downstream SFINCS flow.

## Time and observations

- One readable Arizona-local date/time with MST. Source issuance remains distinct from displayed valid time.
- Existing output has15hourly frames spanning14elapsed hours. No invented minute-by-minute precision or interpolated certainty.
- Range editor: Start, End, Apply, Cancel; presets bounded by actual coverage. Cancel preserves the prior range. Layer/view switches preserve it.
- Today/last24h observed gauges are secondary. Show observed/provisional/qualified status and actual units; gauge height is not road-water depth.
- Current observations, issued forecasts and frozen simulations remain separate clocks/evidence. No new old-history browser or automatic model refresh as part of this UX reset.

## Phone and desktop

Phone home is safety-first and may scroll. Advanced map is a focused viewport: readable time, active depth key, substantial controls and one contextual sheet. Default view does not expand model settings, metadata, charts or multiple floating cards. Desktop uses one restrained contextual side panel beside the map. Touch targets aim for48px; text must reflow at320px without horizontal page scroll. Do not turn these design targets into claims of accessibility certification.

Verify360x800 and390x844 phone, landscape and a desktop viewport. Controls must remain usable with larger text and keyboard focus. At a minimum, a person can find their route, identify the selected time, read a depth, move one hour and return home without hunting through expert settings.

## Model limits: graphics cannot manufacture hydrology

Current frozen package:29,685 computational cells at100m, 10m subgrid terrain reported by the solver owner, and15displayed hourly frames. The solver owner reports19of60route-crossing records inside the current domain; Los Robles/North Trico and Brawley/Avra Valley are outside. This is a source-owner coverage audit, not a count independently derived from the current app manifest: its crossings list is absent. The renderer/UI must consume the actual versioned coverage registry, not hardcode this count or infer support from a nearby colored cell. Basemap coverage and hydraulic-model coverage are separate. Depth is reconstructed volume divided by full cell area, not measured street depth, a cell maximum or zs minus minimum/mean terrain. Native zs is a water-surface elevation with its recorded datum. Preserve source hashes and frame/cell order.

Off-channel lowspots are a REQUIRED capability question, not a finished claim. Before advertising them, identify an actual off-channel location inside the modeled active domain, confirm terrain/boundary/rainfall support, then inspect its real time series and spatial output. If absent, dry, unresolved by100m cells or unsupported, report that exact limit. The renderer may reveal existing model output; it cannot invent culverts, roadside depressions, bathymetry or missing drainage. A finer-looking basemap does not make the model finer.

No calibrated ±accuracy can be inferred from these graphics. Preserve existing event-specific diagnostic evidence and geometry-vintage caveats. Official closures remain exclusions; unknowns stay unknown. Models cannot certify a road safe.

## Evidence-backed acceptance checklist

- [ ] REAL VECTOR BASEMAP: inspect loaded vector/GeoJSON road/land/water features and style layers. Demonstrate a geographic feature selection/style change; pre-rendered raster images are insufficient.
- [ ] SAME SCENE: flat/3D show the same location, route, cell and hour; switching back preserves viewport and selection.
- [ ] ACTUAL DEPTH: a known nonzero cell is visible, selectable and agrees with the recorded data in both units. Compare two real hours with differing values and show the geometry/color/readout updates.
- [ ] NO SILENT STATES: exercise unavailable frame, outside domain and loading/error states. Basemap visibility alone is not success.
- [ ] WATER VERSUS LAND: permanent water/landcover cannot be mistaken for model depth; legend names the actual quantity.
- [ ] ROUTE CONTEXT: closures, warnings, source age, route details, saved routes/navigation and original risk logic remain accessible. Frozen model context stays separate.
- [ ] TIME: hour, range endpoints, Apply/Cancel and camera preservation work on phone and desktop.
- [ ] LOWSPOTS: record one actual supported off-channel example OR explicitly mark unresolved/unsupported. Do not fake a success fixture.
- [ ] REMOTE DELIVERABLE: inspect the actual remote page and data, publish non-sensitive screenshots with commit and selected time. Mark unverified requirements missing.

These are acceptance requirements, not claims that current code passes them. No new solver run, source refresh, main merge, production deployment or Twilio changes is authorized by this checklist.

## Current evidence and screenshot limitation

Earlier remote inspections verified original safety home, exact native-cell overlay values and hour controls. They did NOT verify the newly requested vector-rendered scene. Current Leaflet and initial MapLibre implementations both use OSM raster tiles, so the vector requirement is NOT MET.

The supplied screenshot libfile_25c656d7f9f88191ae96a43e28cd9a28 was resolved in Library but could not be materialized: the required helper failed on Windows with AttributeError: os.setxattr unavailable. A subsequent Library read returned metadata, an image asset pointer and OCR, but no image bytes supported by the local image viewer. No user-screenshot pixels were inspected by this worker. Do not infer its contents from the user's description or substitute our earlier screenshots as if they were the attachment.

## Reuse and ownership

Keep the original safety/routing engine, route GeoJSON and crossing identities, live fetch/cache/freshness handling, native model/terrain/zs exports, exact cell geometry, hourly/range state, depth conversion, source provenance and remote preview tooling. Current raster overlays remain a diagnostic fallback, not accepted final renderer.

UI owner: app.js, map-shell.js, map-layers.js, map-layers.css and this checklist. Renderer owner: geographic-view source/bundle, vector source/style and renderer-specific CSS. Coordinate the shared state contract before implementation resumes. No parallel edits to the same files. Coordinate the vector source, coverage-registry payload and frame-ready event next, then continue the corrected implementation; do not resume the obsolete raster-overlay brief.

## Established references

- MapLibre vector/GeoJSON versus raster source definitions: https://maplibre.org/maplibre-style-spec/sources/ . Use actual features; do not relabel raster tiles as vector rendering.
- MapLibre geographic custom layer interface: https://maplibre.org/maplibre-gl-js/docs/API/interfaces/CustomLayerInterface/ . Match the pinned library's API and shared camera/context.
- Android adaptive layout guidance: https://developer.android.com/design/ui/mobile/guides/layout-and-content/adapt-layout . Adapt content and controls to available width; do not shrink a desktop dashboard onto phone.

References guide implementation. They do not prove our app meets the checklist.
