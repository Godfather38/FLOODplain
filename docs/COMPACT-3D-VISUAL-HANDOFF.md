# Compact refined 3D: terrain coverage and water presentation

Experimental 3D work only. No 2D UI/release files, source model output, publication pointer or production deployment changed. The pan-stability work is retained in the shared renderer implementation. This checkpoint continues the full visual checklist; it does not declare user visual acceptance.

## Exact compact binding

`prepare-compact-terrain.mjs` checks the original manifest SHA against the compact package's declared source, both compressed geometry hashes/sizes, run/datum/CRS, then every ordered native ID, centre, area, resolution, edge length and ring vertex. All 398,613 faces matched exactly. The canonical geometry digest is `e6b1ae81341a8bb0834fee8251915a066a3c2903dd1bdccf276e00332595b053`.

The compact terrain descriptor records that equivalence. Original terrain index/tile payloads retain their original geometry hash; the loader verifies this explicit source-to-target binding and preserves source provenance on its assembled target mesh. It does not accept a hash mismatch based on equal lengths or a nearby run name. Negative binding tests cover wrong method, source, target, run, count and digest format.

The helper writes terrain files and `terrain-display.json` only. It never changes the model manifest or publication pointer. Integration owner attaches the descriptor as `terrainDisplay` and updates the existing manifest checksum using its own verified package workflow. Existing reader/update/state interfaces remain unchanged.

## Complete phone coverage at coarser display LOD

New coarse tiles retain every native face and every boundary/hanging-edge vertex at the exact existing elevation. Removing interior display vertices reduces the full export from 1,605,049 to 807,823 triangles; 2,255 coarse tiles occupy 14,007,758 compressed bytes. This is display simplification, not a new hydraulic solution.

The previously incomplete 12-tile phone region needs 46,097 coarse triangles versus 91,547 at L0. The loader reserves coarse coverage before spending the remaining 60,000-triangle phone budget on finer terrain. Desktop remains capped at 160,000 triangles. It exposes complete coverage, fallback count and the exact limiting budget. It retains three concurrent requests and bounded tile/byte/triangle caches.

Interior depressions and curvature can be absent at this coarse fallback; boundary elevations remain exact. Native selected-cell quantities remain exact at every LOD. Very broad extents can still exceed the 12-tile/triangle budget and must disclose omissions; this does not complete the whole-domain 3D overview requirement.

## Water and lifecycle

Water now uses continuous standing-ripple normal shading in geographic metres, restrained view-angle sheen and a broad sun highlight. Animation changes material appearance only: native water height, clipped triangle positions, depth tint, cell IDs and picking remain unchanged. No advective direction, measured velocity, shoreline precision or new simulated physics is implied.

The 3D depth tint now interpolates continuously between the existing quantitative palette stops; each face still uses only its own native value. Terrain lighting is reduced to retain more geographic contrast. This removes artificial color-class jumps but does not erase genuine neighboring-cell differences. Cell-scale tint steps remain visible in the actual wet strip, so the contiguous visual goal is improved, not declared fully accepted.

Converted picking/validation rings now belong to the current bounded terrain model rather than accumulating for every previously visited face in a dataset-wide cache.

Flat-first startup remains lazy; explicit 3D entry loads terrain/runtime. Phone DPR is capped at 1, desktop at 1.5. Flat/hide stops animation, cancels terrain work and disables inactive terrain-atlas generation. Shared camera/time/range/selection semantics are unchanged.

## Dataset and acceptance limits

This verified path uses the existing compact **21-frame partial frozen output, 10 AM–3 PM MST November 1, 2026**. The completed 57-frame case was not substituted without a verified source binding. No future frames are invented. Further integration with that completed package belongs with its package/model owners.

Actual browser evidence is recorded separately in `public/simulation/preview/compact-refined-3d-verification.json` and matching screenshots. Browser emulation does not establish physical-phone performance. Continue integrated visual review against `3D-VISUAL-ACCEPTANCE.md`; the separate 2D release does not depend on this work.

## Final measured result

Local Chrome SwiftShader, desktop and phone-size viewport at emulated DPR 3, actual compact geometry and endpoint frames:

- First explicit 3D entry 1,751 ms; native endpoint update 361 ms.
- Desktop 12/12 visible tiles, zero omissions, 159,140 terrain triangles. Phone 6/6 visible tiles, zero omissions, 53,671 triangles and effective DPR 1. The phone viewport differs from the earlier 12-tile extent; the separate exact 12-tile coarse audit is 46,097 triangles, not a claim that this phone screenshot contains twelve tiles.
- Face 387171 changes from 0.052069427490234375 m / zs 627.9871826171875 m to 2.2035794921875 m / zs 630.1849975585938 m, with pointer selection and matching popup time verified.
- Flat startup fetched no 3D runtime/index/tiles. Animation changed the material clock without changing water geometry; reduced motion stopped the clock. Zero JavaScript/shader errors. Fifteen focused tests pass.
- Four settled pans took 1.17–4.42 seconds on the software GPU. This is functional, not smooth-performance acceptance. Terrain caches stayed within 16 tiles, 8 MB compressed and 320,000 triangles; selected geometry stayed within its budget.
- Raw JS heap after pans 359.59 MB; collected heap 208.71 MB versus 121.46 MB initially. Disposal collected heap 157.07 MB while the QA page still retains its dataset/view references. Moving converted rings to model-local ownership reduced after-pan retained heap about 7 MB and disposed heap about 14 MB versus the preceding identical workload. These are diagnostic GC samples, not total GPU/process memory or a long-running leak guarantee.

Screenshots were inspected. Native cell tint steps remain visible despite the continuous palette, and coarse interior terrain loses small depressions. Broad-view omissions, integrated product visual acceptance, physical-device performance and completed-run binding remain open. No fake hydraulic detail was added to conceal these limitations.
