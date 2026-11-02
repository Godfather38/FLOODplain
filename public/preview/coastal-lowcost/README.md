# Coastal low-cost trial — WIP

A bounded MIT-licensed derivative of [iamtechartist/coastal-simulation](https://github.com/iamtechartist/coastal-simulation), not a FLOODplain rewrite. No production deployment or main-branch change is included.

## Run locally

No npm install or build dependencies are required. With Python 3 installed:

```sh
python3 -m http.server 4173 --bind 127.0.0.1
```

Open `http://127.0.0.1:4173/?preset=tiny-cheap&webgl=1`. Omit `webgl=1` to try the browser's WebGPU path. Serve over HTTP/HTTPS, not file://. On a phone, use an authorized server reachable by that phone; localhost refers to the phone itself.

The top-left panel selects presets (a full reload), resets the deterministic initial state, and records a foreground 30-second stationary measurement. `&autobench=1` starts that measurement two seconds after readiness. GPU timestamp queries are optional via `&gpu=1`; default measurements are animation-frame intervals and CPU submission, **not GPU-present timestamps**.

## Controlled presets

| URL preset | Physics | Reflection |
|---|---:|---|
| `baseline` | 241 × 401 (96,641 samples) | Original planar + analytic sky |
| `original-cheap` | 241 × 401 | Analytic sky only |
| `tiny-original` | 24 × 40 (960 samples) | Original planar + analytic sky |
| `tiny-cheap` (default) | 24 × 40 | Analytic sky only |
| `small-cheap` | 48 × 80 (3,840 samples) | Analytic sky only |

All cases preserve the **72 × 120 m** physical domain: x −14→58, z −92→28. Physics is 60 Hz and worker publication is capped at 20 Hz with three transferable packet sets. Field dimensions follow the physics grid. The visible terrain/water mesh independently retains 0.3 m core spacing, plus the original graded outer geometry. This is intentionally still a dense render mesh: 179,010 water vertices / 356,300 water triangles in every case.

All cases use an identical drawing-buffer policy: DPR ≤ 0.75, maximum 1280 × 720 landscape or 720 × 1280 portrait, scaled down to the actual viewport. A 1280 × 720 CSS viewport therefore renders at 960 × 540, **not full 720p**. Read the displayed actual buffer dimensions. Sharing the cap avoids confusing a resolution reduction with the reflection/physics comparison.

Cheap effects omit the planar reflector and its color/depth sampling graph. Analytic sky/Fresnel, continuous temporal and linear spatial interpolation, moving fine normals, foam, refraction, wet sand, clouds, shadows and spray remain. Refraction and render-mesh simplification are separate future levers, not silently included here.

## Important limits

- Tiny has approximately **101× fewer physics samples**, not 101× more FPS. It cannot resolve some rocks, drainage channels or short waves. Coarse gradients also produce substantially less physical foam; Small is the planned visual fallback.
- This is an appearance/cost experiment, **not hydraulically validated** and not authoritative FLOODplain/SFINCS output.
- Original Wasm and baked binary artifacts were unavailable through the authorized materialization path. Every local case intentionally uses the same original **JavaScript fallback** and runs exactly 2,160 warm-up steps (36 simulated seconds). This is **not performance parity with the original live site's Wasm baseline**.
- Proposed acceptance gate: steady 30 FPS with the 720p cap on a designated midrange phone, plus credible simulation advancement. That gate has **not** been established. Cloud CPU/browser results cannot stand in for a phone GPU.
- Viewport, buffer, backend/renderer identity, frame p50/p95/p99, >100 ms stalls, worker step/pack time and actual packet rate, simulation progress, interpolation holds and JS heap (when exposed) are visible/exported. Available system memory is not inferred.

## Verification status

`npm test` passes 12 CPU/source-contract tests. `npm run check` checks all 17 JavaScript source modules. CPU-only Three.js scene/material construction passes all five presets and confirms the optional mirror exists only for original effects. These do **not** compile GPU shaders or verify the visual result.

The 2,160-step finite-state check confirmed finite arrays, nonnegative water depths, preserved extent and sponge boundaries, valid packet dimensions, and the three-set backpressure/recycle guards. One cloud CPU run measured approximately 21.4 s original / 0.89 s Small / 0.18 s Tiny for warm-up + checking/packing. Startup timings are machine-dependent; these are not browser FPS or phone measurements.

Browser validation remains pending: the execution server's localhost is isolated from the managed browser; the preinstalled Chromium launch in that sandbox was denied its process socket. No visual/FPS result is claimed. Use the supported experimental preview for the next browser pass.

## Repeatable checks (Node.js 20+; scene loader tested on Node 24)

```sh
npm test
npm run check
for mode in baseline original-cheap tiny-original tiny-cheap small-cheap; do
  node --no-warnings --experimental-loader ./tests/vendor-loader.mjs tests/scene-check.mjs "$mode"
done
```

For actual browser acceptance, keep the same foreground browser, backend, viewport/buffer, default ocean camera and conditions. Reload each preset, wait for readiness, measure twice for 30 seconds, then inspect shoreline/rock interaction and camera movement. Reject rendering errors, non-finite state, frozen water, sustained simulation lag or objectionable loss of foam/obstacle detail. Record actual hardware versus software rendering rather than inferring it from a VM label.

## Attribution and provenance

`LICENSE` preserves the source author's MIT notice. Vendored Three.js r185 files retain their MIT headers. `UPSTREAM.json` lists source URLs, Git blob hashes, included files and excluded binaries. Local changes are grid/preset selection, world-space sponge boundaries, optional reflection graph, fixed publication/buffer policy, diagnostics and regression checks. No external assets, analytics, API keys or paid services are used.
