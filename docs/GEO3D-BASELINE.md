# Geographic 3D prototype: baseline

The owner accepted commit `9cf0bd2` on `experiment/geographic-3d-toon` as the starting build on 2026-11-02. It is a visual prototype, not validated flood physics, and it is not in production.

Compare later changes against this build, with the same 30-second measurement, a still view and the tab in front.

## Scene
- Gates Pass, about 3 x 5 km, heights shown at 2x
- 24 x 40 solver, opaque Tiny Toon water, WebGL 2
- 107,269 triangles per frame, 5 draw calls

## Measurements
| Device | Buffer | FPS | Frame p50 / p95 / p99 | Simulation speed | Owner's view |
|---|---|---|---:|---:|---|
| Work mini PC, Chrome 156 | 1188 x 677 | 12.9 | 83.2 / 83.4 / 116.6 ms | 1.00x | Acceptable |
| Development PC, RTX 5070 Ti | 960 x 540 | 56.9 | 17.5 / 18.0 / 18.1 ms | 1.00x | Not a guide to low-end devices |
| Pixel 8 | | not measured | | | |

On the mini PC, script time per frame is about 1 ms (p95 1.8 ms) and a solver step about 0.3 ms, while frames take about 83 ms. Most of that frame time is therefore probably the graphics chip, so triangles, shadows and pixels are the first things to check if a later build runs slower. GPU time was not measured directly.

The mini PC is the lowest device tested. Treat 12.9 FPS as the floor for later builds, and check any change that costs more there before keeping it.

## Later change
The build after the baseline tightens the channel banks so the water's edge follows the terrain instead of the solver's coarse cells. Triangle count is unchanged. It has not been re-measured on the mini PC.
