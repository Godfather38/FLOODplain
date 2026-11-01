# Usable refined whole-area overview

This focused change supersedes the 40,000-face rejection in `d51f842`. A large native mesh now remains visible through bounded screen-space aggregation. It does not change the current frozen forecast, publish refined results, or claim expanded model coverage.

## Rendering and semantics

The opt-in refined source switches automatically between native polygons (up to 4,096 visible faces by default) and one geographic `Maptalks.CanvasLayer` above that threshold. `maxVisibleFaces` remains an optional positive integer, but now means the native-to-overview transition threshold, not a hard visibility cutoff. Existing UI wiring requires no further change beyond the refined-source contract.

The overview grid uses approximately four CSS pixels per bin, capped at 256 × 256. Each native polygon is projected into the screen-aligned Mercator extent and clipped against the bins it intersects. This is actual polygon support, including hanging-edge vertices, not centroid splatting or rectangular padding. Bins retain:

- Native coverage fraction, including dry support.
- Wet fraction and the maximum native full-cell mean depth among wet contributors.
- Missing-data fraction, displayed with gray hatching, including mixed known/missing bins.

Alpha reflects the covered wet/missing fraction. Dry and uncovered pixels remain transparent; their masks and native picks remain distinct. Shared boundaries have no computational-cell outlines. Subpixel features cannot be visually resolved, and the overview explicitly says it is a maximum-depth display aggregation, **not hydraulic refinement** or a new shoreline solution. Native values, per-face area, exact face IDs and raw quantities remain unchanged.

Picking continues to intersect the original native polygons at every zoom. Close zoom automatically restores native polygon rendering. The computed canvas is geographically anchored while moving/rotating, and settled camera changes rebuild the bounded overview. The work yields every 4,096 faces, observes cancellation, and cannot replace a newer frame after delayed completion. Current buffers are cleared during pending frame changes and released on disposal. Flat rendering does not load Three or 3D terrain.

## Measured verification

The fixture is **synthetic**, generated only by test code: 402,453 variable-size faces, including hanging-edge polygons, a missing-data strip, a dry strip and an uncovered interior hole. It is not a completed solver output or a forecast. Chrome headless with SwiftShader, local server and reduced motion; phone-size viewport is not a physical-phone benchmark.

| Check | Measured result |
| --- | ---: |
| First whole-area frame | 343 ms |
| Three subsequent frame updates | 160 / 172 / 152 ms |
| Phone-size whole-area update | 129 ms |
| Desktop overview | 256 × 200 bins, all 402,453 faces |
| Phone-size overview | 98 × 211 bins, all 402,453 faces |
| Flood polygon objects in overview | 0 |
| Three allocation / legacy terrain requests | 0 |
| Approximate JS heap, including full synthetic native geometry | 279 MB |

The prior path rejected this face count; this version renders it. No unmeasured speedup against drawing 400k individual polygons is claimed. Source initialization took 263 ms and fixture construction 162 ms, separately from rendering. Memory still includes all native geometry to preserve exact picking; actual exported mesh size and physical-device memory/performance require verification.

Actual CanvasLayer pixel readback at native geographic sample locations verifies alignment: wet alpha 199, missing alpha 102, dry and uncovered-hole alpha 0. Pointer clicks verify exact native IDs and values for wet, zero-depth and missing faces after zoom. Controlled delayed completion verifies that an obsolete overview cannot replace the selected frame. Whole-area phone-size rendering, no legacy asset loading, no Three allocation, cleanup and zero JavaScript errors also pass.

Evidence: `public/simulation/preview/refined-overview-SYNTHETIC-verification.json` and the explicitly labeled desktop/phone screenshots. Reproduce with `tools/simulation/verify-refined-overview.mjs`. `test/refined-overview.test.js` independently checks polygon fractions, maximum-versus-mean semantics, dry/missing/uncovered distinctions, bounded allocation and mid-build cancellation. Nine renderer/source tests pass including the retained frozen path.

No new solver run, terrain download, real refined publication, UI-owned file edit, paid service or deployment is included.
