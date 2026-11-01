# Refined flat-map stability checkpoint

Based on the reported compact preview 4aeb310, isolated on experiment/refined-pan-stability. No terrain assets, UI files, model data, solver changes, main merge or deployment are included.

## Changes

One active flood overview plus one latest pending viewport replaces recursive cancellation retries. Camera refreshes coalesce, installed displays are deduplicated, and updates await the matching live viewport. Immutable reader frames validate once. Typed bounds and a spatial index replace per-face bounds objects and repeated full scans; exact picking reuses this index. Polygon clipping reuses typed scratch buffers without altering output quantities.

Vector geography now bounds cached tiles (24), coordinates (250,000), features (20,000), drawn coordinates (100,000), and drawn features (5,000). It culls before constructing map objects, reuses buffered viewports, limits concurrent fetches, and prevents obsolete installs. Flat/hide disables dormant 3D texture creation. Map canvas DPR is capped at 1.5 desktop and 1 phone, including resize.

## Evidence and limits

- Actual app and compact 398,613-face partial package: 24 pointer pans, four frame changes, four zoom changes, then phone resize at emulated deviceScaleFactor 3. No crash or JavaScript errors; maximum concurrent overview builds 1; no terrain/runtime downloads. Desktop canvas 1920x1020 for 1280x680 CSS; phone canvas 390x724 for 390x724 CSS.
- Collected JS heap at initial and six-pan intervals: 152.5, 155.4, 154.6, 155.6, 156.6 MB. After additional frame/zoom changes: 189.8 MB; phone: 188.7 MB. These diagnostic samples explicitly force GC and are not total browser/GPU memory or a physical-device guarantee.
- Actual-data projection/clipping comparison: four nearby whole-domain overviews, approximately 502,000 intersections each; mean 150.33 ms before / 80.06 ms after. Coverage, wet, missing, maximum and RGBA arrays byte-identical. This isolates clipping, so it is not comparable to the UI owner's 1.5-second full-source Node baseline.
- Basemap-only live-PBF stress: 48 pan/zoom views and 24 superseding requests; budgets held, no errors/crashes. Collected heap 23.24 MB initial / 11.49 MB after / 4.65 MB disposed; observed transient peak 288.14 MB.
- Ten focused tests pass, including missing/dry/outside semantics and scratch-buffer growth. Synthetic scheduler stress: 100 superseding requests, maximum one active build, first cancelled and latest installed.

Browser environment: headless Chrome with SwiftShader, local actual app, reduced motion, emulated DPR/phone size. The user's hard crash was not reproduced; this fixes demonstrated unbounded/redundant work without claiming a proven crash cause. Main-based release integration and its browser acceptance remain the UI owner's responsibility. The separately reported popup after dragging is not addressed here.

## Integration

Cherry-pick this focused checkpoint, or import only these renderer-owned files:

- tools/simulation/geographic-view-source.js
- tools/simulation/geographic-vector-source.js
- tools/simulation/refined-renderer-source.js
- tools/simulation/refined-overview-source.js
- public/simulation/geographic-view.js and the matching generated public/simulation/renderer-chunks files (remove obsolete hash-named chunks listed by the commit).

The constructor/update/shared-state contract is unchanged; optional source.findNativeCell avoids a duplicate index. Keep the release's flat-first policy and independent 3D gate. Loader edge-array sharing is separate UI-owned work and was not included in this browser measurement. Supporting harnesses and JSON/screenshots are under test/ and public/simulation/preview/refined-*pan* / refined-overview-allocation-evidence.json.

