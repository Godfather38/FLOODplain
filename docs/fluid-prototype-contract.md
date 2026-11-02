# Brawley data-driven particle module

This is a compute module for the **existing geographic map at one Brawley junction**. It creates no viewer, visible canvas, camera, controls, terrain artwork or replacement map. The historical `fluid-prototype` directory name is an ownership boundary, not a separate product experience.

## Interface

```js
import {createJunctionFluid} from './fluid-prototype/junction-fluid.js';
const fluid = await createJunctionFluid({
  scene,              // brawley-scene.json from scene-contract c801a17
  terrainTiles,       // decoded, checksum-verified terrain JSONs from scene.terrain
  frameIndex: 0,
  center: scene.center,
  extentMeters: [160, 160],
  maxParticles: 2048,
  fieldResolution: 128
});
fluid.step(1 / 60);    // caller's active-map cadence; dt capped at 1/30 s
fluid.positions;     // Float32Array: east metres, north metres, NAVD88 metres
fluid.velocities;    // computed local illustrative velocities, same axis order
fluid.nativeCellIndices; // indices into scene.cells at current particle locations
fluid.count;
fluid.radiusM;       // equivalent spherical volume radius; not measured droplet size
fluid.sourceTime;    // selected source validTime; never advanced by local simulation
fluid.stats;
fluid.initializeFrame(nextFrameIndex); // deterministic native-frame reseed, zero motion
fluid.dispose();
```

Position X/Y origin is `center`, longitude/latitude. Z is absolute NAVD88, **not height above ground**. `fluid.field.localToGeographic([east,north,z])` converts a point back to `[longitude,latitude,z]` for integration with the existing geographic host. This bounded local tangent approximation uses metres-per-degree at the scene centre; it is not an alternate source CRS.

For the parent's Brawley GLB convention (X east, Y up relative to NAVD88 base 603 m, Z south), convert a returned particle to `[east, navd88Z - 603, -north]`. Convert its illustrative velocity to `[vEast, vUp, -vNorth]`. Do not subtract the module's internal `field.baseM` for GLB placement; that offset is only the solver's pressure-grid origin.

The caller renders the actual returned particles with its existing Three/map camera. Use positions for instancing, or a compact particle-surface reconstruction for a soft cartoon appearance. `stats.renderRadiusRecommendationM` is a visual radius hint, not a hydraulic length. Do not substitute the prior coloured mesh for this particle state and call it fluid physics. The host should use its existing native-cell lookup for depth/time readouts and can use `nativeCellIndices` for particle diagnostics. A particle's Z minus terrain is not a new measured roadway depth.

The caller owns start/stop, visibility and reduced-motion behavior. No internal timer or animation loop exists. Stop calling `step` while hidden, in flat mode or when motion is disabled. Keep the native source timestamp and local `elapsedSeconds` separate. After `dispose`, stepping rejects. Frame reseeding resets positions, illustrative velocities and elapsed time; it does not forecast the next native frame.

## Actual data bindings

The scene is `brawley-avra-existing-output`, centre `[-111.29459, 32.39322]`, completed frozen run `refined-full-41344983607`. The parent imports its 2,628 native faces, 57 source frames, exact terrain triangles, roads and checksums from scene contract `c801a1765b73cc503ee761e74d61c7df4a273c86`.

The module checks NAVD88 and the native geometry binding, including the exact-geometry equivalence certificate for the retained partial-run terrain. The caller must verify compressed terrain hashes before supplying decoded tiles, as the browser verification does. Unknown/outside triangles are not filled. Terrain is rasterized locally at 1.25 m for collisions; this is a display/solver discretization, **not a new hydraulic prediction resolution**.

Each source frame supplies `depthM` and `waterSurfaceM` in scene-cell order. A location is eligible only when native cell-average depth is finite and at least 0.01 m, native zs is finite, and its actual source terrain is below zs. Particles are seeded by the resulting clipped water-column volume. `clippedInitialVolumeM3` is that discretized terrain-intersection volume; it must not be relabelled as the model's full-cell storage volume. Source depth remains native storage divided by full face area.

The published scene has **no local velocity vectors**. Initial particle velocity is zero. Subsequent motion comes from the adapted PIC/FLIP pressure/gravity/collision solve, not NWM discharge, a remote gauge, invented inflow or native velocity. Label it “illustrative local fluid refinement” rather than source-predicted direction or speed. The bounded junction and source wet-support perimeter are closed walls; this module does not infer upstream/downstream flux. It confines particles to source wet support and between source terrain and source zs. It is therefore a constrained local refinement, not an independent inundation forecast or calibrated river simulation.

## Cost and failure behavior

Default: 2,048 particles, 48×3×48 MAC cells for the tested 160 m scene, 24 pressure iterations, 0.88 PIC/FLIP blend, gravity 9.81 m/s². Particle count rounds down to complete 64-particle rows and is capped at 4,096. The sampling field is independent of the pressure-grid resolution.

The module uses an **offscreen compute-only WebGL1 context**, avoiding state collisions with the shared map renderer. It synchronously reads a 32 KB RGBA32F particle texture per 2,048-particle step, then provides 24 KB XYZ positions. This readback synchronizes the GPU and is a material cost. The available Chrome SwiftShader run took approximately 31–36 ms per warmed step, with a roughly 147 ms first-step shader/driver warmup. These are software-GPU timings, not phone or hardware-GPU results. Do not promise 60 fps. Budget 15–30 solver steps/s independently of map rendering, measuring the actual device. A future shared-context/worker or GPU-native instancing bridge can avoid the synchronous transfer, but is not implemented here.

Required WebGL float/half-float render targets and instancing are checked. Shader loading and unsupported readback fail explicitly. Do not silently replace a failed solver with decorative trajectories. The existing source-data map can remain available with fluid motion identified as unavailable.

## Verification and remaining work

Run `node tools/simulation/fluid-prototype-verify.mjs`. It serves the actual scene locally, verifies terrain SHA256 values, advances 60 real solver steps, checks moved/finite particles, checks terrain and unknown-domain collisions, reseeds a different source frame, verifies deterministic reset, and disposes the compute context. Structured results are in `public/simulation/fluid-prototype/verification.json`.

The first successful run moved 2,013 of 2,048 particles over one simulated second, with maximum displacement 0.237 m and zero sampled terrain/unknown-domain violations. Changing native frame 0 to 20 changed clipped initial volume from 351.913 to 445.036 m³. Source time and checksum changed with the frame; illustrative motion never supplied source velocity.

Shared-map particle rendering, the cute/bloopy visual treatment, baked satellite/scan terrain, road artwork and visual acceptance belong to the parent/Claude integration. They are **not claimed complete by this compute verification**. No generic dam-break scene or separate viewer is delivered.

Upstream source and MIT notice: `public/simulation/fluid-prototype/UPSTREAM.md` and `vendor/LICENSE`.
