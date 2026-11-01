# Actual partial refined 3D: integration and verification

**Technical checkpoint only:** full visual acceptance remains open under [3D-VISUAL-ACCEPTANCE.md](3D-VISUAL-ACCEPTANCE.md). This worker owns attractive 3D terrain/water visualization, not the separate 2D release or solver. In particular, the phone tile omissions below and compatibility with the later compact package remain outstanding integration issues.

This checkpoint enables streamed terrain for the actual `refined-partial-41339621278` output already published by UI commit `2b32e94`. It performs no solver run, input refresh, terrain download or forecast extension. The model remains **partial/frozen**, with exactly 21 native frames from 10 AM through 3 PM MST on November 1, 2026. Nine requested forecast hours remain unavailable.

## Parent integration

Bring in the renderer source/bundle/chunks and the new `terrain-*` files in `public/simulation/data/refined-partial-41339621278/`. The original geometry, native frames and publication files were copied locally only for verification and are **not** part of this commit. They already exist on the UI branch. No main app/UI-owned file was edited.

Run from the integrated repository:

```sh
node tools/simulation/bind-refined-terrain.mjs
node tools/simulation/bind-refined-terrain.mjs --write
```

The first command is a read-only validation/report. The second binds `terrain-display.json` as `manifest.terrainDisplay` and updates only the existing publication's manifest checksum. It verifies the old publication hash, run/geometry/datum binding and compressed terrain index before writing. It preserves status, frame descriptors, valid endpoints, quantities, provenance, uncertainty and partial-completion metadata. The known current manifest SHA changes from `6131b2fc2f84a77b2f8597411ace3c1443785ca03fd2f4c5961998175358de02` to `afcf1e610d28b6ae67d274be65244e762c20c28a89c699469e7bc422054dc322` with this descriptor. The helper deliberately was **not run with --write** in the renderer checkout; the parent owns this final publication integration.

The package reader already supplied by the UI verifies every compressed artifact hash. Existing `?case=refined#/map`, flat default, asynchronous mode selection and frame acknowledgement remain the entry points. There are no new account/key/provider requirements.

## Streaming behavior

- Cold flat entry loads no terrain index, terrain tile, Three runtime or 3D allocation. Existing bounded flat overview stays available.
- Explicit 3D entry loads the 302,369-byte source-bound index, then only selected visible tiles. Each tile binds exact native face IDs, the published geometry SHA and NAVD88 datum. Old 100 m baseline terrain/zs files are never accessed by this path.
- Coverage is reserved at L0 first. Remaining triangles upgrade nearby selected tiles to L1 at close zoom. Desktop uses at most 160,000 terrain triangles; narrow screens use 60,000; at most 12 selected tiles per view. Whole faces are retained. Omitted visible tiles/faces are reported explicitly rather than called dry or outside model coverage.
- The loader makes at most three concurrent tile requests. Its cache is bounded by 16 tiles, 8 MB compressed and 320,000 cached triangles. Decoded geometry is additional memory; it is bounded by these counts but is not claimed to equal compressed bytes.
- Camera-centered selection, viewport change cancellation and stable tile-selection keys avoid stale replacement and unnecessary model rebuilds. Geometry ID validation is cached; face/ring tables are sparse/lazy so tile replacement does not recopy all 398k rings. Inactive/flat mode cancels terrain work and stops cosmetic animation.
- New terrain models retain current native frame, viewport and selected cell. Selected-cell popup values reopen with the new requested frame after loading. Water planes use **native zs**, clipped by source-bound terrain, while the quantitative depth remains native volume / individual face area.

The complete exported tile set is 114.3 MB, intended for streaming, never an eager global download. See [terrain provenance and full export audit](ACTUAL-REFINED-TERRAIN-EXPORT.md) for retained DEM hashes, exact face coverage and mixed-LOD continuity checks. Terrain source sampling and geometric LOD are not new hydraulic resolution or validated road-depth accuracy.

## Actual output verification

`tools/simulation/verify-actual-refined-3d.mjs` uses the real published geometry and endpoint frames with checksum checks, plus the new descriptor. It passes an actual pointer click on native face `387171`, area 39.0625 m², 6.25 m equivalent-square resolution:

| MST time | Native mean depth | Native volume | Native zs, NAVD88 |
| --- | ---: | ---: | ---: |
| 10 AM | 0.052069427490234375 m | 2.0339620113372803 m³ | 627.9871826171875 m |
| 3 PM | 2.2035794921875 m | 86.07732391357422 m³ | 630.1849975585938 m |

These match the independent retained NetCDF audit exactly. The display shows the selected value changing from 0.052 m to 2.204 m, retains selection, and labels the real time. The matched retained bed audit also recreates the solver's 6×6 sampling for known cells and agrees with native subgrid minima/maxima within 0.00005 m.

Measured local Chrome SwiftShader, reduced motion, 1200×850 desktop and 390×844 phone-size viewport:

- First explicit 3D entry: **1,938 ms**; endpoint frame update including its fetch: **256 ms**.
- Desktop: all **12/12** visible tiles, **159,140** terrain triangles; no omitted tiles in that view.
- Phone-size: **9/12** visible tiles, **58,442** triangles; the three omitted tiles are disclosed in the map note. The known cell remains rendered/pickable.
- The scripted initial entry, distant pan and phone-size return downloaded approximately **5.98 MB** of index/tile responses in total, not the 114.3 MB global tile set.
- Cache limits, lazy cold startup, current partial endpoint, distant-pan streaming, native selection, phone width, flat return, inactive animation and disposal pass. Zero JavaScript errors.

Evidence: `public/simulation/preview/actual-refined-3d-verification.json`, `actual-refined-3d-10am.png`, `actual-refined-3d-3pm.png`, and `actual-refined-3d-phone.png`. Screenshots were visually inspected. Fourteen source/core/LOD tests also pass, alongside the full exported-artifact audit. These browser measurements do not establish physical-phone performance or application-wide visual acceptance; the parent still integrates and verifies the actual app route.
