# Upgraded experimental integration

This isolated branch combines the existing safety app through caeb18e with the completed frozen refined run and lazy 3D visualization. It does not change the dedicated 2D release branch or production. The 2D owner's subsequent proximity/tolerance work is not included here.

## Data and rendering

- Completed run `refined-full-41344983607`: 398,613 native faces, 57 fifteen-minute frames, November 1 10 AM through November 2 midnight Arizona. Frozen NWM/HRRR inputs; not current weather or an automatically refreshed model.
- `bind-upgraded-completed.mjs` verifies the solver package and an exact geometry equivalence certificate before binding retained terrain. IDs, rings, coordinates, areas, resolutions and CRS match; equal face counts alone are never sufficient. Payloads remain under the earlier terrain directory to avoid duplicating assets.
- Default flat mode does not request 3D runtime, terrain or water-support assets. Explicit 3D entry loads them. Existing camera, range, time and selection contracts remain intact.
- Source-supported 100/200/400 m display terrain meshes preserve the exact native domain boundary and holes. These are display sampling levels, not new hydraulic resolutions. Close views use bounded native terrain tiles; broad views use complete ground plus native-face water support rather than dropping visible tiles.
- Water uses native water surface elevation and source terrain, with exact depth picking. Only display tints blend across wet shared edges. Dry barriers, missing faces and domain gaps remain. Cosmetic animation changes highlights, not heights or measured velocity.
- Water geometry budgets are 120,000 triangles on phone layouts and 240,000 on desktop. An audit of all 57 actual frames finds a maximum of 111,469 clipped water triangles and no wet faces missing native water elevation.

## Verified evidence

114 focused source, adapter and safety tests pass. The final terrain-material change also passed the eight water-module tests and a repeated complete app verification. The pinned published preview at `ee7a65b` passed `test/smoke-upgraded-remote.mjs`: actual completed geometry, native frame and lazy 3D assets loaded from the public host with no JavaScript errors. GitHack presents an initial **Open the page** interstitial; the smoke test follows that normal link. See `upgraded-remote-verification.json` and `upgraded-remote.png` beside the local evidence.

`public/simulation/preview/upgraded-integration-verification.json` records the actual integrated app test, with companion screenshots. Chrome used SwiftShader and emulated DPR 3; these are not physical phone measurements.

- Cold flat: 2.18 s; first 3D entry: 2.93 s; endpoint switches: 998/726 ms.
- Full-domain fit: all 398,613 faces, 26,568 ground triangles, 77,909 water triangles at the tested frame, no omitted wet faces.
- Phone close view: all 6 visible tiles, 53,671 ground triangles, DPR capped at 1.
- Known face 387171: frame 0 depth 0.052069427490234375 m, water elevation 627.9871826171875 m; frame 56 depth 2.1348109375 m, water elevation 630.1162109375 m. Independently decoded values match picking.
- Frame/range/selection persistence, animation and reduced motion, bridge evidence and underpass navigation passed. No JavaScript, console or shader errors.
- Collected JS heap: 134.38 MB cold; 207.95 MB broad; 197.09 MB full domain; 230.25 MB after pans; 201.85 MB phone; 202.66 MB returned flat. This is a bounded observed test sequence, not proof against every device-specific crash or a complete GPU memory measurement.

## Remaining visual acceptance

The close-view water is visibly rendered and changes with native frames. Restrained cartographic relief now preserves vector map colors instead of darkening the domain into a gray silhouette. Water remains subtle at whole-area scale; coarse display terrain cannot resolve every interior depression. Native terrain faceting remains visible. Phone selection and time controls consume substantial space. These limitations remain open; a functional integration pass is not the user's acceptance of an attractive finished visualization. Physical-device performance and parent/user visual review remain required before any launch decision.

The three owners remain separate: 3D appearance/integration, full 2D release/shading/UX, and geometry/SFINCS. No new solver run was performed for this work.
