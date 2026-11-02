# The Brawley junction water layer

What this is, in plain words: at the Avra Valley Road crossing of Brawley Wash,
the 3D map now shows the saved model's water as a few thousand soft, drifting
blobs sitting on the real baked ground, instead of only a flat coloured sheet.
It is part of the existing map — same camera, same time slider, same selection,
same flat-first behaviour — not a separate demo page or viewer.

This document is the implementation record for the work described in
[CLAUDE-3D-HANDOFF.md](CLAUDE-3D-HANDOFF.md). That handoff keeps the owner's
original request verbatim; nothing here replaces or trims it.

## What is honest about it, and what is not

- **The water's depth, level and extent are the model's own numbers.** Particles
  are seeded only where the saved run has a finite cell-average depth of at
  least 0.01 m, a finite native water-surface elevation, and source terrain
  below that elevation. Nothing is seeded to fill a gap or make a nicer picture.
- **The drifting is a local simulation, not a forecast current.** The published
  run contains volume, mean depth and water-surface elevation and **no velocity
  vector**. Motion comes from the adapted PIC/FLIP pressure/gravity/collision
  solve in `public/simulation/fluid-prototype/junction-fluid.js`. No gauge, NWM
  discharge or terrain slope is ever substituted for a native velocity. The
  legend says this in ordinary language, and the map note repeats it.
- **The source clock never moves.** Local simulated seconds are kept separate
  from the frame's `validTime`. Changing the hour reseeds from that frame.
- **Nothing here measures water on the road.** Road widths in the bake are
  cartographic class defaults. No bridge clearance is inferred, from imagery or
  anything else.
- **An empty blob layer is never a dry result.** A time outside the prepared
  package, a device without the required WebGL float textures, or a junction the
  model leaves dry each say so specifically.

## How it is put together

| File | Job |
|---|---|
| `tools/simulation/baked-glb-reader.js` | Dependency-free strict reader for this repo's own baked GLB. Accepts only the bake's shape and fails loudly otherwise. |
| `tools/simulation/junction-placement.js` | Puts the junction in the host renderer's exact frame, using the same `project`/`altitude`/`origin`/`baseM` the refined water model uses. |
| `tools/simulation/junction-fluid-layer.js` | The artwork: baked ground with the orthophoto, road and markings, instanced soft blobs, travel trails. |
| `tools/simulation/junction-fluid-legend.js` | Renderer-owned readout: quantitative depth scale in feet, source time, drift wording, provenance details. |
| `tools/simulation/junction-fluid-controller.js` | Lifecycle: lazy checksum-checked loading, run binding, frame reseed, adaptive stepping, teardown. |
| `tools/simulation/geographic-view-source.js` | Host wiring: eligibility gate, attachment to the refined model group, stepping on the existing timer, release on hide/flat/dispose. |

Rebuild the served bundle after changing any of these:

```
node tools/simulation/build-geographic-view.mjs
```

The compiled `public/simulation/geographic-view.js` is generated. Do not edit it
by hand.

## Why the first build showed nothing, and what changed

The first integrated build instantiated all 2,048 particles, measured their
motion and reported healthy numbers — and showed no water at all. Three separate
reasons, all now fixed:

- **Blobs were drawn at their physical radius.** At 0.43 m and roughly 1 m per
  screen pixel, a blob was about half a pixel. Size is now a **display size**:
  at least 5 screen pixels, re-applied whenever the camera zooms or the window
  resizes, and capped at 5.5 m so the cloud never claims a wet extent the 12.5 m
  source cells cannot support. Both numbers are in the legend.
- **The orthophoto was pasted on raw.** It read as an aerial photograph floating
  over the vector map in a hard rectangle, and the real pond it contains read as
  model water. The photo is now a reference: its luminance is contrast-stretched
  and quantised into a few warm desert bands, only a trace of its chroma
  survives, and the patch edge dissolves into the surrounding map tone. Nothing
  in it can read as blue water.
- **Motion was shown proportional to speed.** The simulated drift here is around
  a millimetre a second — real, and invisible at any map scale. Streaks now show
  **direction only**, at a fixed screen length, on every eighth blob so the
  cloud reads as flow rather than fur. A cosmetic highlight travels along that
  direction inside each blob. The measured speed stays a number in the legend,
  in feet per minute when feet per second would round to `0.00`.

## Placement, and the two render-order traps

The junction group is added as a **child of the refined water model's group**, so
it inherits that group's origin and its vertical anchoring exactly. Local
coordinates follow the same convention the refined terrain already uses:
`project([lon,lat]).sub(origin)` horizontally and `altitude(navd88 - baseM)`
vertically. When the host replaces the model (terrain budget change), the layer
re-attaches rather than drifting with a stale parent.

Static baked geometry is projected vertex by vertex, so it carries no
linearization error. Per-step particle positions use one bounded local tangent
plane at the junction centre, because projecting thousands of particles per
frame through the map is not affordable. `verifyLinearization()` measures that
approximation against the real projection across the 160 m particle extent and
refuses to run above a 0.1 m tolerance; the measured value is shown in the
legend's details.

Two ways this could have hidden the water, and what was done instead:

1. **Two grounds fighting for the same pixels.** The host draws its own terrain
   under the patch — usually its 400 m whole-domain overview. Two samplings of
   the same ground interpenetrate, and no depth bias fixes a metre-scale
   difference. So the host's ground is **cut away** under the patch:
   `model.setGroundExclusion(box)` discards those fragments in the land shader,
   in the model's own local XY so no world transform can get the box wrong. The
   hole is inset 10 m inside the patch, so the host ground still runs under the
   patch's feathered rim and no gap can open at the edge. Polygon offset remains
   on the patch for that thin overlap band only. Native water, its clipped
   shoreline, exact heights and picking are untouched, and passing null restores
   the full ground.
2. **The native water sheet over the blobs.** Blobs live between the bed and the
   native water surface, so that surface's depth writes would cover them. The
   blobs keep a plain depth test (terrain still hides water behind a ridge);
   instead the host calls `model.setParticleOverlay(true)` while blobs are
   actually drawn, which stops the native sheet writing depth and nothing else.
   Native heights, the clipped shoreline, tints and picking are untouched, and
   the default is restored on teardown.

## Cost, and what is loaded when

Flat-map entry loads **nothing** from this layer. Entering 3D fetches only the
small `bake-report.json` to ask "is the camera near this junction?". Only when
the camera is inside the gate at zoom 15 or closer does it load the scene
package, terrain tiles, the 1.02 MB GLB and the 259 KB orthophoto.

- Geometry: 10,660 baked triangles (10,574 terrain, 10 road, 76 markings),
  budget-capped at 14,000 before any allocation.
- Blobs: 2,048 on desktop, 768 under 600 px, two triangles each as camera-facing
  sphere impostors — about 4,096 triangles at full budget, not 2,048 spheres.
- Trails: one line segment per blob.
- Textures: one shared 1024 px orthophoto, clamped to its recorded extent.
- Stepping runs on the renderer's existing 15 Hz timer with adaptive substeps
  (two when a step costs under 8 ms, one above 22 ms, skipped above 70 ms so the
  map stays responsive). Skipped steps are counted and shown, never hidden.
- Leaving the junction stops the solver and releases the GPU resources; leaving
  3D or hiding the map additionally drops the fetched package and the orthophoto.
- The existing phone pixel-ratio cap, cancellation and cache limits are untouched.

Reduced motion stops the stepping, the jiggle and the trails, and keeps the
seeded blobs and the depth scale on screen, with the reason stated.

## Colour, and the risk colours

Blob colour is the native cell-average depth under each particle, run through
the **existing quantitative palette** (`DEPTH_COLORS`/`DEPTH_CUTS`), so the
artwork and the legend cannot disagree. A null depth, or a particle outside
native support, takes the palette's missing grey — never a shallow blue. The
orthophoto is desaturated and lifted so the blue depth range stays the loudest
thing on screen. Route and crossing risk colours continue to come from the
existing assessment through the renderer's route layer; this layer adds no
colour of its own to them and does not draw over them.

## Tests and evidence

Unit tests (`npm test`):

- `test/baked-glb-reader.test.js` — the committed GLB against its recorded
  checksum and size; exact mesh names and triangle counts; absolute NAVD88 after
  the axis swap; malformed containers rejected.
- `test/junction-placement.test.js` — host frame, datum, axis swap, measured
  linearization error, rejection of a non-linear altitude callback.
- `test/junction-fluid-layer.test.js` — triangle budget, no vertical lift,
  palette-bound blob colour, trail length from the module's own illustrative
  speed, clamping, reduced motion, disposal.
- `test/junction-fluid-legend.test.js` — the depth scale, plain-language drift,
  and the wording that must never promise a measured current or a safe road.
- `test/junction-fluid-controller.test.js` — run/geometry/datum binding, exact
  frame matching, checksum enforcement, graceful orthophoto failure, and that a
  mismatched run attaches nothing.
- `test/refined-water.test.js` — the particle overlay flips only `depthWrite`
  and restores, leaving native heights, tints and picking identical.

Integrated browser evidence (`node test/verify-junction-fluid.mjs`, after the
bundle build) records before/after screenshots at the same geographic view,
measured blob travel in the live map, two source frames with their exact times
and volumes, repeated pan-away/pan-back cleanup, phone width, mode-change
teardown and a reduced-motion pass into
`public/simulation/preview/junction-fluid-verification.json`.

**Software-GPU timings are not device performance.** The existing SwiftShader
measurement of roughly 31–36 ms per solver step is a software figure. No 60 fps
claim is made for any phone or laptop.

## State of verification in the session that wrote this

- **The bundle is built.** `node tools/simulation/build-geographic-view.mjs`
  succeeds and `public/simulation/geographic-view.js` plus
  `renderer-chunks/junction-fluid-controller-*.js` are current with this source.
  The compiled bundle was never hand-edited. The build's stale-chunk cleanup was
  widened so obsolete junction chunks are removed too. esbuild compiling every
  module is the only static check this source has had.
- **The scene loader and the PIC/FLIP module stay unbundled**, confirmed in the
  built chunk: both are referenced as runtime URL strings, so their own
  package-manifest and GLSL paths keep resolving relative to their real
  locations.
- **`npm test`: 271 pass, 1 fail.** The single failure is **pre-existing** —
  `existing app exposes advanced map navigation and retains official forecast
  access` in `test/forecast-regional.test.js` asserts wording
  (`'Official river forecasts'`, `href='simulation/forecast.html'`) that the
  committed `public/simulation/map-shell.js` does not contain at HEAD. None of
  the three files that test reads were touched by this work, and it was left
  alone deliberately.
- **`node tools/simulation/build-geographic-view.mjs`: succeeds.** The bundle
  and `renderer-chunks/junction-fluid-controller-*.js` are current with this
  source. The compiled bundle was never hand-edited.
- **`node test/verify-junction-fluid.mjs`: passes** and writes
  `public/simulation/preview/junction-fluid-verification.json`. It records no
  junction asset on flat-map entry, the layer off at overview zoom, 2,048
  particles and 10,660 baked triangles at the junction, placement within
  0.0005 m of the live projection, measured blob movement in the live map,
  native frames 0 and 20 at volumes 351.91 and 445.04 m³ with their exact source
  times, repeated pan-away/pan-back with no scene-child accumulation, 5-pixel
  blobs at both widths, 768 particles at phone width, no overlap between the
  junction readout and the shared time dock, mode-change teardown, and a
  reduced-motion pass with blobs visible and streaks off.
- **Screenshots in `junction-evidence/` were inspected, not just captured.**
  Three rounds of visual correction came out of looking at them: an invisible
  water layer, then a flat beige pad with a bright halo, then a muddy olive
  ground. The current desktop and 390 px shots are the ones this work stands on.

Earlier failures worth keeping, because each found a real bug: the first browser
run timed out at zoom 17 because the eligibility gate required detail-tile
terrain, which the shared loader abandons above `maxTiles: 12` — the normal case
on a desktop viewport. The second reached the mode toggle but force-clicked
`[data-3d]` while it sat inside a closed options sheet after a resize; the script
now opens Map options through the UI the way a person does.

## The shallow-water correction

The first integrated build instantiated particles that barely moved, never
pooled and showed no terrain interaction. The cause was not the renderer:

| | Before | Now |
|---|---|---|
| Vertical grid cell | 3.33 m | **0.098 m** |
| Grid | 48 × **3** × 48 | 53 × **32** × 53 |
| Water depth in cells | 0.06 | **2.01** |
| Particles per cell (`u_maxDensity`) | 215.6 nominal, ~13 actual | **4.84, matched** |
| Max step displacement | 0.013–0.029 m | **0.19–0.29 m** |
| Mean simulated drift | 0.001 m/s | **0.012–0.015 m/s** |
| Solver steps per readback | 1 | **8** |
| Simulated seconds per readback | 0.033 | **0.267** |

One `spacing = max(w,d)/48` drove all three axes, so a 160 m box forced 3.33 m
cubes and the bed was quantised into three steps — the wash was invisible to the
pressure solve. The vertical extent is now fitted to the wet bed-to-surface band
only, and the cell size comes from the water depth. `u_maxDensity` assumed the
water filled whole cells, so it was ~16× too high and the incompressibility term
never fired once; it is now the expected splat weight for a real cell.

The free surface is no longer pinned flat to the native water surface. The G
channel of the terrain field is a **per-cell** ceiling of `zs + 0.06 m`, a
declared and bounded illustrative excursion — not a global `maxZs` lift, which
would have drawn hazardous water where the model has none. The native surface
and extent remain the authoritative risk reference and are unchanged.

## Particle rendering restored from upstream

Only the solver was vendored from `jizhouxu/3d-fluid-simulation`; the upstream
particle renderer was dropped along with the tank UI it sat next to. Its
**instanced spheres** are restored here in the shared map camera: 2,048 particles
× a 20-triangle icosahedron = 40,960 triangles, writing depth so overlapping
particles fuse into one lumpy body and terrain occludes them correctly. A shared
travelling ripple normal makes a cluster light as one surface rather than as a
heap of separate balls, and particles in deeper native cells are drawn larger.

Upstream's shadow, ambient-occlusion, composite and FXAA passes are **not**
restored: they are canvas-level post effects owned by the map's own renderer,
and taking over that render loop is out of scope here.

## What still is not good enough

Measured and still open after the shallow-water correction:

- **Horizontal cells are still 3.0 m.** Fitting the box to the wet area did not
  shrink it, because the wash runs diagonally across the whole 160 m field, so
  its bounding box *is* the field. With 2,048 particles, holding ~4 particles
  per cell forces ~3 m horizontally. Finer horizontal cells need more particles,
  which costs readback.
- **Cross-cell pooling barely registers.** The share of particles in the deepest
  quarter of the wet cells moved +0.0005 over a 1.07 s simulated window. The
  pooling visible in the screenshots is seeding plus sub-cell settling onto the
  real bed, not measured migration between native cells.
- **Collision at the dry edge still sticks rather than slides.** The vendored
  `advect.frag` snaps a particle's XZ back when it would leave the model's wet
  support. That keeps the "never create unsupported wet cells" guarantee, but
  water piles without sliding along the boundary. Fixing it needs that shader.
- **Wall-clock travel is still software-limited.** Readback is ~650 ms under
  SwiftShader against ~4 ms of solve for eight steps. Measured travel is
  **0.70 m per simulated second** (0.70 px at this zoom) and 0.75 m over 2.5 s of
  wall clock. The per-simulated-second figure is the device-independent one.
- **No structure collision, and none invented.** The only verified geometry is
  the baked source terrain and a road *centreline ribbon* at a cartographic
  +0.04 m offset with class-default width. That is a drawing convention, not a
  surveyed embankment, so the road stays out of the collision field. Damming at
  the crossing needs real structure geometry from the solver/backend owner.

Judged against "soft cartoon, bloopy, coherent water", from the current
screenshots:

- The blobs read as a **scattering of distinct blue blobs** tracing the wash,
  not yet as one merged body of water. They merge better the further you zoom
  in. Making them merge at wide zoom means growing them past the 5.5 m cap,
  which would start claiming wet extent the source cells do not support — so the
  cap stayed and the look is the thing that gives.
- **Direction streaks are present but faint** at wide zoom; they read at close
  zoom. The travelling highlight inside each blob carries more of the motion cue
  than the streaks do.
- The ground patch still reads as **a defined rectangle of close-up ground**
  inside a flat vector map. The edge is feathered and the halo is gone, but the
  boundary is visible. That is arguably correct for "a few well defined places
  with good textures", and it is what the single-junction scope gives.

## Known limitation: the surrounding ground is coarse

At the zooms this layer runs at, the shared terrain loader is usually in its
whole-domain overview mode (400 m ground sampling), because a desktop viewport
shows more than its `maxTiles: 12` budget. So the junction patch is close-up
source terrain sitting inside a coarse surrounding surface. The legend says this
in its details, and the renderer reports `hostTerrainOverview` in its status.

The integrated desktop and 390 px browser checks passed. The host-ground exclusion prevents the coarse surface from hiding the baked junction; the feathered rectangular boundary remains visible and needs further visual refinement. The surrounding terrain budget was preserved.

## Not done here, and who owns it

- Owner/parent visual acceptance of the result. Module and integration tests are
  not approval of how it looks.
- The wider request beyond this one junction — I-10, the other dips and bridges,
  structures along the routes — is the next step of the same method, not
  attempted here.
- Gauge icons, route dip tracking and hydraulic coverage stay with the
  backend/solver owner. Safety screens, accessible colour across the whole app,
  hit targets and opt-in onboarding stay with the UX owner. No file of theirs
  was edited.

## Reproducing the coordinator verification

The root manifest omits four libraries already imported by the existing renderer. The versions below come from the committed renderer license manifest; the base development versions come from package-lock.json. This restores the tested environment without changing either manifest or enabling lifecycle scripts:

```powershell
npm ci --ignore-scripts --no-audit --no-fund --registry=https://registry.npmjs.org
npm install --no-save --package-lock=false --ignore-scripts --no-audit --no-fund --registry=https://registry.npmjs.org acorn@8.14.0 esbuild@0.24.0 three@0.170.0 maptalks@1.13.0 maptalks.three@0.42.2 @mapbox/vector-tile@2.0.4 pbf@4.0.1 playwright@1.56.1
node tools/simulation/build-geographic-view.mjs
node test/verify-junction-fluid.mjs
```

The browser check uses the existing installed Chrome and SwiftShader. It is not physical Android performance evidence. The full suite finished with 271 passing tests and one existing forecast-link expectation failure in test/forecast-regional.test.js against unchanged public/simulation/map-shell.js. The final feet-per-minute readout additionally passed all 13 legend tests. Oversized display glyphs and direction streaks are illustrative; they are not measured current or a new inundation boundary. The native source geometry, depths, times, and picking remain the quantitative reference.

## November 2 experimental integration result

This section supersedes the earlier verification totals and closed-boundary limitations. Native hourly signed edge discharge now drives per-edge open-boundary particle inflow/outflow, with exact source timestamps and volume ledgers. The solver grid increases northward; four erroneous velocity sign flips were corrected and production GPU checks verify northward travel at face267134. Native q, depth and units were not increased for appearance.

The particle-derived surface uses offscreen depth smoothing, finite fullscreen draw ranges, linear-filtered smoothing targets and softened coverage edges. Sparse native-direction cues draw after the water surface so they remain visible. Source depth colors, geographic placement, feet, risk overlays, flat2D default and the phone particle budget remain. Actual particle drift is separate from native reconstructed direction.

Desktop and390px captures are in junction-evidence/visual-*.png. visual-capture.json records actual source, solver and wall timestamps. The supplied motion video is assembled from four real sampled frames at explicitly labeled2x simulated-time playback, without interpolation; this does not claim the live device achieved2x. SwiftShader is software-GPU verification, not physical Android performance.

Remaining visual limitations: angular outline sections, separate sparse northern blobs, and subtle native movement. The surrounding terrain is coarse. This one-junction preview does not complete the wider dips/bridges/I-10 request or validate a2014 historical reconstruction. No production deployment is included.

The forecast-navigation assertion is carried from UX commit d30386e after checking the existing link and target page. No navigation behavior was changed. Run node --test test/*.test.js, node tools/simulation/build-geographic-view.mjs, and node test/verify-junction-fluid.mjs. The focused visual capture is node test/verify-junction-visual.mjs.

## November 2 normal-entry and fallback corrections

The reproducible saved preview is `index.html?case=refined&preview=2026-11-01T22:00Z#/map`. It opens the retained refined run at November 1, 2026, 3:00 PM Arizona (22:00 UTC), enters 3D, and centers the Brawley crossing through the ordinary app lifecycle. Map options also contains a dated preview link. An unsupported preview date is rejected. The ordinary URL still opens the flat map. This is a saved modeled forecast, not live conditions, an observed flood, or a validated historical reconstruction. Manual time changes update the preview label.

The original screenshot mismatch had several causes. The default entry used a different case and frame; there was no direct crossing control. Detailed-water budget overflow explicitly cleared every water triangle. Regional terrain used the wrong height origin and failed to exclude the native domain. Failed particle loading left the baked crossing terrain hiding native water. A mobile terrain replacement during asynchronous particle activation could mark an unattached controller active.

The map now offers Close-up crossing and Regional view controls, a labeled native-cell water fallback within the existing display budget, correctly aligned regional terrain, and native terrain/water when close-up assets cannot load. Particle callbacks and activation completion belong to the exact host model that started them; a replacement causes reattachment. Unsupported 3D settles into a usable flat-map state rather than an endless loading control. Phone navigation controls are separated from the water card.

Regional context uses the public Mapzen/Tilezen Terrain Tiles package documented in `public/simulation/data/regional-context/manifest.json`: approximately 400 m sampling, 257 by 257 elevations, reduced geometry on phone, real geographic placement and 1x elevations. Regional view now frames the local valley and neighboring relief instead of Phoenix and Show Low. The package is contextual scenery, with coarse relief and visible boundaries; it is not detailed mountain imagery. Its vertical datum is not asserted equivalent to the hydraulic model. It never changes flood depth, extent, risk, or velocity. Source attribution and hashes travel with the package. The native domain is excluded so context cannot cover its water.

Focused browser checks verify normal no-query entry, the dated preview on desktop and 390-pixel phone, unsupported-date rejection, and native water retained when regional, detailed terrain, baked ground, or particle assets fail. The phone check also covers delayed regional loading. Captures were inspected for water at the crossing, not merely nonzero mesh counts. The five phone failure captures and their result are under `junction-evidence/phone-fallback/`.

The motion sampler now binds a window to one fluid object, one host model, and one source timestamp. A rebuild invalidates the sample rather than counting its changed coordinate origin as travel. The focused phone preview test verifies actual boundary exchanges, per-edge volume accounting, and close/reopen using separate instances. The earlier 48.8 m median movement result crossed an invalid measurement window and must not be cited as physical travel. Native discharge, units, and source timestamps were not increased to improve appearance.

Run `node --test test/*.test.js`, `node tools/simulation/build-geographic-view.mjs`, `node test/verify-junction-preview.mjs`, `node test/verify-junction-fallback.mjs`, and `node test/verify-junction-fluid.mjs`. The unit suite has 306 passing tests. Browser results use installed Chrome with SwiftShader; they do not establish physical Android performance. Native movement remains subtle, and angular surface edges and sparse separated blobs remain visual limitations. No main merge or production deployment is part of this experimental delivery.
