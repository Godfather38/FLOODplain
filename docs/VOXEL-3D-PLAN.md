# Geographic scene renderer: replacement architecture and acceptance checklist

Status: architecture reset after the user's explicit interruption, then implementation resumed on parent coordination with the rewritten UI plan and verified vector source. This replaces this worker's previous raster-host, downloaded-map-texture and semi-transparent-block plans. The preserved prototype is NOT accepted. The corrected module's actual status and remaining limits are recorded in [GEOGRAPHIC-RENDERER-VERIFICATION.md](GEOGRAPHIC-RENDERER-VERIFICATION.md).

## Product definition

Read geographic data, build a geographic scene, and render it. The scene contains real terrain, road geometry, land/water features, selected routes, crossings, observations and computed floodwater. Two-dimensional and three-dimensional modes are views of the SAME scene and state. A pitched raster image with graphics painted on top does not qualify. Nor does an isolated terrain analytics viewer.

The requested appearance is detailed solid voxel terrain with attractive water, not semi-opaque columns. Cosmetic water shading may animate; model water levels, depths, timestamps and locations must remain fixed to the selected simulation frame. No invented physics, velocities, shorelines or claims of finer prediction.

Safety-first home and route/navigation UX remain owned by the UI worker. This plan owns the renderer and its geographic/data adapters. The existing safety engine is not replaced by a renderer, and renderer work does not establish missing hydraulic capability.

The parent referenced a user screenshot, but the screenshot itself was not supplied to this worker. This plan follows the transmitted textual requirements; matching that visual reference is an outstanding review item, not a claimed completed comparison.

## One scene, explicitly separated data products

| Input | Source and transformation | Rendered representation | What it cannot prove |
|---|---|---|---|
| Roads, land use, land cover, buildings, mapped waterways, names | OpenStreetMap vector features through OpenFreeMap/OpenMapTiles vector tiles; decode actual geometry and attributes | Terrain-draped road ribbons, polygon surfaces, labels and supported building footprints | OSM road geometry is not surveyed road-deck elevation; mapped water polygons do not define the flood domain |
| Terrain overview | Existing actual prepared 10 m `dep_subgrid.tif`, derived from 1 m USGS Pima County 2021 lidar terrain plus verified 2023 edge | Tiled solid voxel top faces and exposed side walls, with level of detail; no standalone columns down to arbitrary zero everywhere | Fine terrain does not imply fine hydraulic solution |
| Close terrain detail | Bounded native 1 m reads from the verified USGS Pima County project sources, transformed once to the chosen horizontal CRS and common vertical reference | Progressive close-up tiles, with a visible source/resolution record | Pending acquisition/coverage tests; not delivered merely because catalog URLs exist |
| SFINCS native water | Actual selected-hour `zs`, original native cell IDs, active mask and NAVD88 metres | Native water surface geometry intersected with real terrain; derived terrain-downscaled wet display explicitly identified | Not a 1 m or 10 m hydraulic solve; subcell connectivity and exact shoreline are unresolved |
| SFINCS cell-average depth | Current verified `depthM`, reconstructed storage divided by full 100 m cell area | Quantitative legend and native-cell tap value in metres/feet | Never add this to mean terrain to create water elevation; not roadway depth |
| HAND | Existing independent approximately 10 m Trico-Marana and Sanders windows plus selected compatible reach data | Separately named HAND wet/depth product where actually available | Not a refined SFINCS solution, not independent confirmation of related NOAA inputs |
| Routes, closures, gauges, warnings | Existing app state and authoritative feeds through UI-owned adapters | Vector paths and pickable objects, retaining risk/action semantics | Rendering cannot clear official closures or infer unmodelled safety |

Do not use the OSM `water`/`waterway` layers to decide where floodwater can exist. These are geographic context only. Query/render every active model cell, including covered off-channel depressions. Explicitly distinguish missing result, zero, outside native domain, and independent model layers.

## Geographic feature acquisition and licensing

Primary vector source: OpenFreeMap public vector tiles, using the documented OpenMapTiles schema. Its official service states no API keys, registration or paid account, and documents attribution and bounded offline limits. The provider supplies vector data; using its default rendered raster style is not this architecture. Discover the current TileJSON/vector source from its published style, then retain the exact source/attribution/zoom metadata. Do not guess a perpetual tile URL.

Consume `transportation`, `transportation_name`, `landcover`, `landuse`, `water`, `waterway`, `building`, `place` and relevant POI layers. Respect class, bridge/tunnel and layer-order attributes. Readable roads and names must remain recognizable while flood mode changes. An absent bridge-height attribute must remain unknown, rather than rendering an invented surveyed deck.

Use a bounded offline development fixture of actual vector data for deterministic geometry/selection tests. Preserve stable feature IDs, source layer and tile IDs; tile-generalized features need not have globally stable IDs, so selections must retain their available source identity plus geometry/location. Provider limits: ordinary viewport requests; at most four concurrent requests. The currently documented offline limit is 3,000 tiles or 50 MB per download and an identifying User-Agent; larger jobs need provider contact. No bulk planet download. Use browser HTTP caching and a bounded in-memory cache, not unrestricted scraping.

Retain OSM ODbL attribution and relevant derived-database obligations; OpenMapTiles schema attribution; OpenFreeMap attribution as required/recommended by provider; licenses for renderer/parser/triangulation/font assets. USGS source terrain metadata identifies public-domain elevation products. County-specific imagery/services need separate verified terms before use; none are silently assumed reusable. No paid keys, new accounts or private credentials.

Official references reviewed: https://openfreemap.org/ ; https://openfreemap.org/quick_start/ ; https://openmaptiles.org/docs/schema/ . These are source/provider references, not an instruction to use MapLibre. The user's MapLibre correction remains in force.

## Renderer composition and reuse decision

Use a single geographic scene coordinator. Retain Three.js 0.170.0 for solid terrain/water meshes. Retain a geographic map camera only if it can drive both 2D and 3D and vector geometry in the same scene. Maptalks/ThreeLayer is a candidate camera integration, not accepted because it rendered a tilted raster. No raster TileLayer, map-texture atlas or detached OrbitControls in the completed advanced renderer.

Before committing to the host, build one bounded vertical slice: decode actual vector roads/land/water at the Trico/Los Robles area, render them with solid true terrain and known nonzero native water, switch 2D/3D while preserving selected road/cell/time. Inspect the screenshot reference and real output. If the host cannot support the common depth/occlusion and camera requirements without stacked independent canvases, reject that host. The current prototype uses layered canvases and has NOT passed this test.

Reuse established vector-tile decoders (`@mapbox/vector-tile`/`pbf`) and polygon triangulation/line utilities with verified compatible versions/licenses rather than writing a new PBF parser or polygon tessellator. Prefer a maintained integrated vector/terrain renderer if its pinned-version capability and license checks pass this vertical slice. No blind adoption of latest demo code. The candidate stack decision is a research/verification gate, not a performance claim.

Convert features to a local metric coordinate frame (native EPSG:32612 is appropriate for this domain). Keep double precision for geographic transforms and camera origin; use local Float32 buffers for GPU geometry. Preserve source coordinate/datum metadata. Tiles share exact boundary coordinates; tile seams, winding, bridge/tunnel ordering and terrain draping require tests.

Terrain: create top faces and only exposed neighboring side walls, rather than six full cube faces per sample. Build chunks and level-of-detail indices in workers. Load high resolution only for the visible close-up area. Preserve real elevations; no arbitrary relief exaggeration unless separately labelled and explicitly selected. Land-cover styling comes from geographic categories, never from simulated water depth. Roads/labels are rendered features, not baked pixels.

Water: native selected-hour level determines geometry. Intersect/downscale using the official existing HydroMT-SFINCS convention or equivalent documented nearest-native-cell mapping. Pass exactly one frame; the installed helper otherwise takes a maximum over time. Keep the cell-average depth product distinct from terrain-downscaled local depth. Keep transparent unknowns/no-data markings distinct from dry. Surface highlights/reflections may be cosmetic, but do not animate the height or infer downstream advection. Quantitative depth colors remain legible; beauty cannot replace the depth key.

## State and integration contract

The coordinated implementation retains `createGeographicView(...)` with `sharedState`, adds `setViewMode` for both flat and 3D, and uses `hide` only for leaving advanced map. See [integration contract](GEOGRAPHIC-RENDERER-INTEGRATION.md); this supersedes the proposal below. The earlier proposed contract was:

```js
createGeographicRenderer({ container, sources, initialState, onStateChange, onPick, onStatus })
// sources: vector feature provider, terrain tile provider, native flood provider,
//          HAND provider and UI-owned route/observation/closure adapters
// state: center, zoom, bearing, pitch, viewMode, timeIndex, rangeStart, rangeEnd,
//        modelMode, layerVisibility, selectedFeatureId, selectedCellId, selectedRouteId
// returns ready, setState(patch), setSources(patch), resize(), inspect(), dispose()
```

One authoritative state store belongs to UI/coordinator; renderer changes emit patches. `setState` must not echo callbacks recursively. Mode switches change projection/view and mesh visibility, not source identity or selected time. 2D is a top-down geographic view of the same scene/feature set; 3D adds relief and native water surfaces. Safety home may keep a lightweight basic map, but entering/leaving advanced mode transfers geographic state explicitly.

Frame switching is atomic: attach a request generation to work; discard stale responses; clear missing selected frames; never leave a prior hour under a new label. Range is a browsing window and never an implicit max-depth aggregation. A selected cell/route remains selected across time and projection switches, including transitions to missing/zero data. Rendered picks return original feature/cell identity and quantity semantics.

Reconcile UI changes through 929ff13 and newer navigation fixes without editing the UI worker's workspace. Parent coordinates any shared-file integration. Do not swap the legacy export into the app and call the architecture finished.

## Mobile, resource ownership and fallback

Use frustum/visible-tile culling, LOD, merged or instanced terrain geometry, worker decode/build, bounded GPU/CPU caches and capped pixel ratio. Avoid full-region 1 m allocation: roughly 300 km² of active land would require roughly 300 million 1 m pixels before rendering overhead. Load fine tiles only near the camera and evict them. Cache stationary meshes; update water buffers only for frame changes. Cosmetic animation can run at a capped rate and must stop when hidden/inactive and respect reduced motion.

Performance acceptance is measured on representative phone-sized hardware/emulation and real browser profiles, not inferred from instance counts. Suggested budgets for the vertical slice: interaction stays responsive, no long main-thread terrain builds, no unbounded growth over 20 time/mode cycles, and a documented frame-time/memory report. Select numerical release thresholds with the parent after actual measurement. A software-rendered headless screenshot is visual evidence, not a phone GPU benchmark.

On WebGL loss/failure, retain the same state and switch to a genuine vector 2D fallback or clearly labelled existing safety map. Report unavailable 3D. Do not quietly replace the requested renderer with a static raster and call it 2D/3D parity. Disposal must cancel workers/requests/animation, remove listeners and release GPU resources; late callbacks must not recreate disposed objects.

## Solver/domain questions owned outside this renderer

The current native grid is uniform 100 m, with 10 m subgrid terrain and 15 exported hourly forecast frames. Two HAND windows independently use about 10 m spacing. See [resolution audit](VOXEL-RESOLUTION-AUDIT.md), which records all reviewed app/solver docs and native metadata.

The solver owner's audit relayed by the parent reports 29,685 active cells over 296.85 km²; only 40 cell centres are classified as WorldCover water, and rainfall/infiltration apply across land. Thus this is not intrinsically a river-only computation. However, only 19 of 60 route-crossing records are inside this domain. The named Los Robles/North Trico and Brawley/Avra Valley locations are outside. These are solver-owner findings, not independently recomputed by this renderer worker. They must be shown plainly in the coverage/status interface. The prototype QA location must not substitute for acceptance at an unsupported crossing.

The solver owner must establish whether each required unmarked dip/off-channel depression is inside the active mask, has relevant forcing/conveyance, and retains valid results. Produce a crossing/depression coverage table with native cell IDs and explicit supported/unsupported reasons. Rendering all active cells is necessary, but does not fix omitted domain, insufficient resolution, missing culverts, rainfall/initialization or calibration limitations. Substantive coverage/refinement is a separate solver workstream. No new solver run was authorized for this worker. No renderer shall invent flood results outside coverage or turn missing into dry.

## Replacement acceptance checklist — all unchecked until demonstrated

- [ ] Actual geographic feature data is decoded and rendered; no raster basemap is the primary scene.
- [ ] Roads, land/water polygons and labels are recognizable and can be independently inspected/selected by feature identity.
- [ ] Solid terrain uses the real elevation raster, correct positive-y subgrid order, units and common datum; no mean-cell stand-in at detailed scale.
- [ ] 1 m close-up claim is supported by actual source-resolution reads, coverage/provenance, LOD and visual evidence; otherwise label 10 m honestly.
- [ ] Known nonzero native water is visibly rendered at a named location, selected hour and native ID, with quantitative metre/foot depth readout.
- [ ] Switching between two selected hours visibly changes the expected water result and matches independently checked values; missing hour clears it.
- [ ] Water z comes from native `zs`, never mean terrain + mean depth; cosmetic animation leaves data/geometry unchanged.
- [ ] Downscaled local depth/extent, cell-average depth and independent HAND are explicitly distinct; no invented fine-grid prediction.
- [ ] Off-channel active model cells render without an OSM-water mask; unsupported dips/coverage are explicitly reported from solver evidence.
- [ ] 2D/3D share scene features, viewport, time/range, route/cell selection and route actions; camera transitions do not reset them.
- [ ] Route/closure/live context remains legible and interactive; model absence cannot clear an official hazard.
- [ ] Real phone and desktop visual review matches the user's reference, including attractive voxel water; render completion alone is insufficient.
- [ ] Reduced motion, hidden state, failure/fallback, repeated transitions, cancellation and disposal pass behavior checks.
- [ ] Measured performance/memory and source/license/provider records are attached.

## Preserved work and honest salvage assessment

Reusable now: source-provenance checks; exact native footprints and row/column IDs; independent native `zs` frames; the new retained 10 m terrain exporter and its 2,968,500-sample asset; full resolution audit; numerical tests confirming 15 frames, independent water z, null/zero distinction and cosmetic animation leaving instance geometry unchanged.

Candidate reuse after review: Three instancing/LOD helpers, native-cell picking/readouts, shader highlights, cancellation/disposal patterns. These have not passed complete geographic visual acceptance.

Replace: raster tile host, raster imagery drape/atlas (`voxel-map-texture.js`), separate-map 2D/3D architecture, mean terrain at detailed scale, and old visual checklist. The existing source/bundle/QA page remain a quarantined prototype, not a deliverable renderer.

Observed prototype failure: desktop screenshot `public/simulation/preview/voxel-desktop.png` showed terrain as an incorrect narrow strip and did not demonstrate visible native floodwater. The camera/geometry issue remained unresolved when the user interrupted. The browser could initialize 35,075 terrain instances and 5,849 water instances, but those counts are NOT evidence of correct rendering. The screenshot is retained as rejected evidence. Phone, route actions, shared-state cycles and cleanup were not visually verified. Do not publish it as a successful renderer.

## Next handoff and implementation sequence

1. Parent aligns this plan with the rewritten UI contract and supplies the actual visual reference to the renderer owner. The user's latest direction is to execute the corrected coordinated plan after that rewrite; this is a short coordination gate, not an indefinite approval pause.
2. Solver owner supplies the required dip/domain coverage table independently; renderer does not wait to establish its vector-data pipeline.
3. Build the bounded vector + solid terrain + known native-water vertical slice and inspect actual output before expanding the architecture.
4. Implement common-state 2D/3D, model/source switches, selection and real route actions; then high-resolution terrain streaming and water visual refinement.
5. Execute the replacement checklist, record failures honestly, integrate only reviewed renderer changes into the UI branch, and preserve experimental-only publication policy.

The earlier 20–30 minute estimate is withdrawn because it covered the rejected raster-host architecture. A defensible completion estimate requires the vertical slice and actual source/host checks; this document is the requested planning deliverable, not a renewed implementation promise.
