# Coarse 3D terrain binding repair

## Root cause

The default entry path loads current coarse run `sfincs-current-coarse-20261101-19z-41350254061` (15 frames). Its map publication redirects the native terrain/water display asset to that run, but static 10 m terrain detail remains bound to original replay artifact `6a06c140…`. The active artifact is `28aa20d8…`; the renderer correctly rejected the unequal source hashes. This predates accessible UX d30386e: that branch changed no renderer/model assets. Explicit `?case=refined` uses an independent source-bound terrain loader and does not have this mismatch.

## Focused correction

`bind-coarse-terrain-detail.mjs` verifies exact equality of every ordered terrain vertex (including elevation and row/column), source terrain hash, cell size and datum between retained and current coarse display exports. It records a binding for this one exact model artifact. The renderer validates that binding plus hashes of the actual ordered vertices, metadata and decoded terrain bytes before reusing detail. Existing native-water validation still requires the active model artifact and matching native frame times. No old water frames are reused, no mean-terrain-plus-depth reconstruction is introduced, and no provenance check is removed. Unknown future publications still fail closed until their terrain compatibility is verified.

The correction is based on 532d85b in isolated branch `experiment/terrain-binding-repair`. It touches renderer source/bundle, a small binding registry, generation/verification tools and evidence only. It can be cherry-picked onto the UX branch without replacing its app, styles, guide or risk palette. No solver, production, dedicated 2D release or UX-owned file was edited.

## Verification

Six focused tests pass, including actual assets and rejection of changed order, source, metadata, detail bytes and unknown model. Actual app checks on default and refined entry paths confirm displayed 3D state, nonempty terrain/water geometry, quantitative cell picking and no page errors. Current coarse native water surface is independently compared with the current export (cell 339, Nov 2 01:00 UTC: 771.8277587890625 m NAVD88; depth 0.10747857391834259 m). Refined retains all 57 frames.

The same checks run with exact d30386e UX files served read-only over the corrected renderer; UX workspace remains untouched. Structured desktop and phone evidence lives in `public/simulation/preview/terrain-binding-*-verification.json` and `terrain-binding-verification.json`. Screenshots are inspected locally. Chrome uses SwiftShader; physical-device performance is not measured. This repair does not claim improved coarse terrain appearance or new hydraulic precision.
