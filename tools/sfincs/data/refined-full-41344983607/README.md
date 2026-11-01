# Full refined output handoff

Run 41344983607 completed the full 63-hour native interval. This export contains 57 forecast frames, 2026-11-01 17:00 UTC through 2026-11-02 07:00 UTC at 15-minute spacing. NWM 13Z / HRRR 14Z inputs are frozen; this is a replay, not the current fast-model forecast.

The existing 2D export_quadtree_output.py and compact_quadtree.py produce native UGRID geometry and lazy binary frames. No simulation rerun, changed mesh, synthetic face IDs or substituted terrain. 398,613 native faces retain their exact IDs, polygons, areas, raw float32 volume and NAVD88 water surface. NaN remains missing. Cell-average depth is volume/full polygon area, not actual wet extent or road depth. Small signed negative volumes remain in raw data; displayed depth alone is clamped within 4.192 m3 declared numerical tolerance.

## Coverage
Both selected routes (trico 11.155 km and avra 21.104 km), all nine selected crossing records and continuous 100 m road buffers are covered at 6.25 m; 500 m surroundings are no coarser than 12.5 m. 24 screened terrain minima are included, not automatically confirmed flooded dips. coverage.json and terrain-low-point-candidates.geojson provide exact locations/native IDs. 28 of 60 app crossings are inside the model; 32 outside are later scope, not silently covered. The 1 m terrain feeds subgrid sampling, not an independent 1 m flow solution.

## Integration
Load compact/manifest.json with the existing quadtree-output consumer; fetch geometry once and frames lazily. Preserve nativeFaceId rather than joining by array order. Keep frozen issuance visible. Replace only the refined-case pointer; current coarse forecasts remain separate. Full-cell mean-depth shading is supported. Precise wet footprints / 3D terrain require a separately source-bound terrain export; old coarse terrain blocks cannot be reused. No production pointer is changed by this package.

## Reproduce
Reassemble the three native archive parts under ../road-result-41344983607 according to that manifest and extract them. Use export-config.local.json, changing only its native root paths to the extracted directory. Invoke the retained reproduce/export_quadtree_output.py --config CONFIG --destination NEW_JSON_DIRECTORY, then reproduce/compact_quadtree.py NEW_JSON_DIRECTORY NEW_COMPACT_DIRECTORY. Exporter source hashes and final package hashes are recorded in handoff.json. The full original native archive remains the authoritative result.

Bridge deck/culvert openings remain incomplete. No road-depth accuracy or confidence interval is established. No native river-section discharge was recorded. Source notices accompany these derived outputs.
