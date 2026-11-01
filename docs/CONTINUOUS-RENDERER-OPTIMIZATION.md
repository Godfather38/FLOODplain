# Continuous rendering and lazy 3D

This checkpoint replaces the prior visible box caps and whole-cell overview water caps. It preserves the UI owner's asynchronous `initialView: 'flat'` contract. No main application UI files are changed.

## Delivered

- Flat startup uses decoded vector geography and one selected-hour, joined water-polygon asset. It does not import Three, create a ThreeLayer, fetch native zs/terrain detail, or run a water animation timer.
- Flat water polygons intersect each native hourly zs with the existing 10 m DEM. Adjacent pixels in the same cell-average depth class are joined; dry/missing/outside pixels and interior holes remain absent. Native cell identity and cell-average depth remain the picking source. The polygons are display downscaling, not new hydraulic predictions.
- Explicit 3D entry loads a separate runtime chunk plus native zs and terrain. Terrain is a continuous triangular surface, not boxes. Water triangles are clipped against that surface; source-supported wet neighbours can share interpolated water vertices. Diagonal interpolation across a dry/missing barrier is excluded. There are no unconditional full-cell caps.
- Terrain vertices use shared geographic samples. One subdivision per visible patch avoids cracks between different LODs. Desktop budget is 80,000 quads; narrow screens use 30,000. LOD uses the visible extent and zoom, and keeps geometry buffers for reuse. The retained 1 m patch is used only where available; high subdivision requires the entire visible patch to be covered, so zoom alone does not promise 1 m geometry.
- Geographic labels, roads, routes, native cell selection, viewport and hour remain in the same map scene/state. A local vertical origin is anchored to visible ground without changing relative terrain/water elevation. Raw grid lines are available through `model.setDiagnosticGrid(true)` and are off by default.
- Flat/inactive/reduced-motion views run no water animation. Active 3D cosmetic highlights are bounded to 15 fps. Mobile pixel ratio is capped at 1; desktop at 1.5. Geometry is rebuilt on settled camera changes, not continuously while dragging.
- Obsolete vector requests and flat-frame work are cancelled. 3D completion cannot allocate/show a stale mode after leaving the map. A three-frame polygon cache bounds retained flat data. Disposal removes listeners, scene objects, texture, map and DOM.

## Measured evidence

Chrome headless, SwiftShader software GPU, 390 × 844 viewport, local static server, reduced motion. These are individual runs, not statistical hardware benchmarks. Cross-origin tile byte counts are unavailable through Resource Timing; the byte totals below concern local renderer assets only. Both cases also load the existing run (~4.40 MB) and cell footprints (~0.71 MB); this pass does not eliminate those shared application inputs.

| Measurement | Prior 5a630f4 | This checkpoint |
| --- | ---: | ---: |
| Cold ready, including selected flat frame | 2,792 ms, eager 3D | 537 ms, flat |
| Renderer JavaScript on cold entry | 1,563,459 bytes | 673,817 bytes |
| Cold native terrain/zs/detail assets | 11,000,595 bytes | 0 bytes |
| Selected-hour flat water asset | — | 285,863 bytes |
| Approximate JS heap | 103.4 MB | 100.9 MB |
| First explicit 3D | already eager | 508 ms |
| Three repeated flat/3D round trips | not measured | 19 / 25 / 16 ms |

The final small request guard and interpolation guard slightly change bundle size; raw measurements retain the exact tested sizes. Frame update plus next animation frame was 27 / 356 / 72 / 11 ms. The 356 ms stall means smooth playback has **not** been established. The change principally removes automatic 3D startup and wasted inactive work; it is not a claim of comprehensive phone performance.

Evidence: `public/simulation/preview/lazy-renderer-verification.json`, `renderer-baseline-verification.json`, `renderer-cancellation-verification.json`, `vector-voxel-verification.json`, and the updated flat/3D desktop/phone screenshots. `verify-lazy-renderer.mjs`, `verify-renderer-baseline.mjs`, `verify-renderer-cancellation.mjs`, and `verify-voxel-browser.mjs` reproduce the checks.

## Validation and limits

`node --test test/voxel-water.test.js` checks all 15 native frame bindings, finite geometry, source cell values, dry/missing clearing, stable geometry during cosmetic animation, optional detail and cleanup. `test/water-footprints.test.py` rasterizes the geographic polygons back to the original DEM grid for two changing hours: all 11,072,000 pixels per hour match the expected wet/dry/domain/depth-class mask, including holes. Browser checks use an actual pointer click on cell 9344 and retain its 3.368 m → 4.672 m source-depth change, flat/3D selection, phone width, missing-frame clearing, context-loss fallback and disposal, with zero JavaScript errors.

The 100 m hydraulic model/domain has not changed. Ten-metre polygon edges and 1 m terrain do not establish fine hydraulic accuracy. Class boundaries may still follow native cells; terrain boundaries still expose missing model coverage. Coarse 3D LOD can miss terrain detail and must not be interpreted as an exact shoreline. No interpolation fills outside the domain or turns missing output into dry/safe road conditions. The physical-phone/hardware-GPU benchmark and full integrated UI acceptance remain parent/UI-owner work. No new solver run, credentials, paid service or main deployment was performed.
