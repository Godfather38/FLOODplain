# Upgraded experimental integration

This isolated branch combines the existing safety app through f6d65fb (including b0f6e37 and caeb18e) with the completed frozen refined run and lazy 3D visualization. It does not change the dedicated 2D release branch or production. No proposed proximity/tolerance buffer or read-only 2014 analysis is implemented.

## Safety behavior carried forward

The safety app, logic and HAND bridge policy match f6d65fb exactly. Compatible site-matched roadway and water elevations affect bridge ratings and appear on route cards with readable source/time evidence. Actual closures remain decisive. Generic bridge penalties from discharge, rain and HAND stage are removed; at-grade crossing behavior remains. Missing or incompatible evidence is not clearance. The completed frozen refined visualization remains separate from the current coarse model used by those existing bridge comparisons.

## Phone controls

Existing Time and cell-detail disclosures keep source dates, native IDs, resolution, datum and interpretation limits accessible. The compact dock retains selected time, previous/next, quantitative depth legend, frozen/current status and navigation. Cell depth/time remain prominent. The original source nodes keep their update handlers and return to their original positions on desktop and Routes; no evidence is deleted. Overview labels avoid screen-space collisions while retaining every marker and its tap details; the default 45-degree 3D angle keeps more geographic context readable.

## Data and rendering

- Completed run `refined-full-41344983607`: 398,613 native faces, 57 fifteen-minute frames, November 1 10 AM through November 2 midnight Arizona. Frozen NWM/HRRR inputs; not current weather or an automatically refreshed model.
- `bind-upgraded-completed.mjs` verifies the solver package and an exact geometry equivalence certificate before binding retained terrain. IDs, rings, coordinates, areas, resolutions and CRS match; equal face counts alone are never sufficient. Payloads remain under the earlier terrain directory to avoid duplicating assets.
- Default flat mode does not request 3D runtime, terrain or water-support assets. Explicit 3D entry loads them. Existing camera, range, time and selection contracts remain intact.
- Close views use bounded native terrain tiles. Whole-area ground now retains native boundary terrain under every face reaching the existing 0.01 m display threshold in any of the 57 frames, with a 400 m sampled coarse remainder elsewhere. The exact domain boundary and holes remain. These are display sampling levels, not new hydraulic resolutions; subthreshold is not declared dry or safe.
- Water uses native water surface elevation and source terrain, with exact depth picking. Only display tints blend across wet shared edges. Dry barriers, missing faces and domain gaps remain. Cosmetic animation changes highlights, not heights or measured velocity.
- Water geometry budgets are 120,000 triangles on phone layouts and 240,000 on desktop. An audit of all 57 actual frames finds a maximum of 111,469 clipped water triangles and no wet faces missing native water elevation.

## Corrected overview obstruction

The previous 200 m display terrain falsely stood above native water over approximately 45.2% of displayed wet area at 3 PM and 40.5% at midnight. `export-water-aware-ground.py` removes coarse terrain inside the exact union of 71,009 native faces meeting the existing display threshold, replacing it with the same source terrain triangles used to clip water. The dry-display remainder retains its coarse terrain. Exact coverage and overlap checks both return zero difference; no holes are omitted.

The corrected ground has 250,702 triangles and is 3.95 MB compressed. A fixed 260,000 overview cap accommodates its actual boundary complexity; close-up phone terrain remains capped at 60,000. `bind-water-aware-overview.mjs` verifies the run, geometry, datum, terrain checksums and all 57 frame descriptors before updating only the refined publication.

Independent checks of 757,512 barycentric samples at 3 PM and midnight find no corrected ground more than 5 cm above the source-clipped water, versus the obstruction above. This is a numerical display diagnostic, not a claimed 5 cm terrain accuracy or road-safety tolerance. Water geometry, values, depth testing and widths are unchanged. See `test/overview-occlusion-baseline.json` and `test/overview-occlusion-corrected.json` for methods and hashes.

## Verified evidence

117 focused source, adapter and safety tests pass after the f6d65fb safety integration. Corrected overview, compact phone controls and current safety behavior pass the complete app verification. The final pinned preview at `0ed3a53` passed `test/smoke-upgraded-remote.mjs`: actual completed geometry, native frame and lazy 3D assets loaded from the public host with no JavaScript errors. GitHack presents an initial **Open the page** interstitial; the smoke test follows that normal link. See `upgraded-remote-verification.json` and `upgraded-remote.png` beside the local evidence.

`public/simulation/preview/upgraded-integration-verification.json` records the actual integrated app test, with companion screenshots. Chrome used SwiftShader and emulated DPR 3; these are not physical phone measurements.

- Cold flat: 2.25 s; first 3D entry: 4.10 s; endpoint switches: 1010/655 ms.
- Full-domain fit: all 398,613 faces, 250,702 ground triangles, 80,213 water triangles at the tested 3:15 PM frame, no omitted wet faces.
- Phone close view: all 6 visible tiles, 53,671 ground triangles, DPR capped at 1.
- Known face 387171: frame 0 depth 0.052069427490234375 m, water elevation 627.9871826171875 m; frame 56 depth 2.1348109375 m, water elevation 630.1162109375 m. Independently decoded values match picking.
- Frame/range/selection persistence, animation and reduced motion, bridge evidence and underpass navigation passed. No JavaScript, console or shader errors.
- Collected JS heap: 136.32 MB cold; 209.67 MB broad; 217.16 MB full domain; 214.92 MB peak after pans; 192.15 MB phone close; 217.76 MB phone full domain; 197.08 MB returned flat. This is a bounded observed test sequence, not proof against every device-specific crash or a complete GPU memory measurement.

## Remaining visual acceptance

The close-view water is visibly rendered and changes with native frames. Restrained cartographic relief now preserves vector map colors instead of darkening the domain into a gray silhouette. The false coarse-ground obstruction is corrected. Water remains subtle at whole-area scale because much of its actual footprint is subpixel; widths are not enlarged to make flooding look more extensive. Native terrain faceting remains visible. Phone controls now leave 332 px of unobstructed map height at 390×844 and 193 px at 320×700 with a cell selected; primary touch targets are at least 44 px and provenance remains expandable. The compact-control and false-obstruction defects are closed. Source terrain faceting and subpixel features are display/model limitations, and visual acceptance remains the user's decision. Physical-device performance and parent/user visual review remain required before any launch decision.

The three owners remain separate: 3D appearance/integration, full 2D release/shading/UX, and geometry/SFINCS. No new solver run was performed for this work.
