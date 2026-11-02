# Completed Silverbell extension

Run 41370039087 completed the full 63-hour frozen case in 2308.346seconds (38.47 minutes), below the approved 60-minute native cap. The retained engine was reused without compilation. All 57 quarter-hour forecast frames cover Nov1 17:00 UTC through Nov2 07:00 UTC. NWM 13Z / HRRR 14Z inputs remain a frozen replay, not automatically current weather.

## Actual low-spot results

| Location (latitude, longitude) | Maximum volume/full-cell area | Maximum water surface, NAVD88 | Water-surface peak time UTC |
|---|---:|---:|---|
|32.427773,-111.267809|0.071720m|601.625610m|Nov2 01:30|
|32.437518,-111.287309|0.004687m|595.749573m|Nov2 07:00|

Both are 6.25 m cells (39.0625 m²). These are native cell quantities, not validated pavement depths or passability. The second cell has some stored water while its peak water surface is below the sampled road-profile elevation 595.835266m. Do not equate water somewhere inside a cell with the road point being submerged. Raw signed volumes and all native surface samples are preserved. Source geometry and underground drainage limitations remain.

## Files and integration

native-manifest.json references the permanent native-output archive parts and unchanged prepared-input archive. Concatenate parts in listed order, check the combined hash and extract. Logs, native map/geometry, restart files, source notices and two-point series are included. Unchanged forcing/subgrid inputs remain in the referenced prepared-case archive rather than being duplicated.

compact/manifest.json is the existing quadtree reader entrypoint. Load geometry once and frames lazily, retaining exact native face IDs. The full domain contains 480,227 faces. prepared-coverage.json binds the actual mesh hash to zero gaps in the 100 m fine road buffer and 500 m surroundings. All 3,835 Silverbell road samples and both screened minima are active at 6.25 m. Original Trico/Avra results remain unchanged.

Cell-average depth is native volume divided by full polygon area. Raw volume and NAVD88 surface are retained separately. Display depth alone clamps small negative dry-cell storage within the unchanged 4.192 m³ tolerance; this is not an accuracy claim. No statistical error interval or native river-section discharge is supplied. Source-bound terrain is still required for precise wet-footprint or 3D terrain rendering; do not reuse geometry from the older case by array index.

## Reproduce output conversion

Use the retained reproduce/export_quadtree_output.py with export-config.local.json, relocating only native file roots to the extracted result. Then run reproduce/compact_quadtree.py on its JSON package. reproduce/verify_native_equality.py checks every compact frame against native float32 values and proven face correspondence. It performs no solver execution.

No main merge, production deployment, new source refresh or second simulation was performed. Type 1 restart files omit cumulative infiltration history and are not an identical continuation state.
