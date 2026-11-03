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

## Move to the map-layer branch
Work continues on `experiment/geographic-3d-layer`, restarted from production `445e139` with only the demo files the scene uses. It says the water is simulated in a dismissible acknowledgement and in the page text. The owner rejected a permanent banner or tag as too invasive. The owner decided the simulated water shows at all times, clearly labelled, across Avra, Picture Rocks and the route areas. It has not been re-measured on the mini PC.

## Switch to the saved SFINCS run
The 3D map page (`public/preview/geo3d/map.html`) now draws the saved SFINCS run instead of invented water. Ground inside the model's domain is the 10 m lidar the model used; water is the model's hourly water surface, compared per pixel with that lidar, so the drawn water does not change with zoom. The earlier invented channels, carving, inflow, assumed bridges, plants, poles and sign gantries are removed. Zoomed out, each model cell is shaded by its share of wet 10 m samples. Not yet measured on the mini PC.

## Own 3D engine
`public/preview/geo3d/world.html` replaces the MapLibre page, which flickered because MapLibre owned and kept swapping the terrain under our water and roads. The new page owns the whole scene in Three.js: one height field, the model's 10 m lidar, under everything; ground and model water drawn as one surface by one shader; the OpenFreeMap street map painted into the ground Apple Maps style; bridges and buildings in 3D on the same heights; 1 km chunks with distance-based detail. Blinking pixels during camera motion measured 0-0.03%, against 0.8-1.7% on the MapLibre page. Not yet measured on the mini PC.

## Pinned for later: weather that reads as definite (owner, Nov 3 2026)

Requested, not started. Make the run's rain clearer than streak density alone:

- Show raindrops meeting the flow: drops landing on the surface, with splashes or ripples where
  they hit model water.
- Show where rain is heaviest directly: for example a soft radar-style tint or contour on the
  ground from the run's own rainfall grid, with its mm/h, alongside the streaks.
- Same rules as the rest of the view: only the run's own rainfall input, nothing invented.
