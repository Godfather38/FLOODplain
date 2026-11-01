# Actual partial refined run 41339621278

This is an opt-in frozen-input replay, not present weather and not a completed full forecast. The unchanged older frozen case remains the default.

Source: solver branch commit85d6af1, tools/sfincs/data/road-result-41339621278. The1200-second budget stopped execution after the85% logged milestone. Twenty-one complete native map frames cover November1,2026 17:00–22:00UTC (10AM–3PM Arizona MST) at15-minute intervals. The requested endpoint was November2 07:00UTC; nine forecast hours are missing. No end-summary fields are populated or inferred.

The permanent native archive SHA256 is4b8172cfb5a0fa19c873ec5b526008f16fdd2549930747b89b9a89fad0e021ce. Native map SHA256 is1e11c45c57c37ada6fa0be98da62cf616e7d0b9e9a85f7c4cc7795091c3ce633. Input mesh SHA256 is91ce69c66c8fc5c667254f3cf279fc3d12449223c19d4c8b547f7a7e81ef4ffb.

All398,613 faces use the supplied output-to-source face-ID proof. The exporter independently compares exact native polygon bounds in both files and rejects nonunique/mismatched correspondence. It retains native IDs, full rings including hanging nodes, actual per-face areas and6.25–100m equivalent-square resolution. No fixed-origin100m indexing or row/column synthesis.

Native subgrid_volume(m3), separate zs(m NAVD88), and full-cell mean depth are exported per frame. Raw negative numerical volumes are preserved: source minimum -4.191995620727539m3; worst area-equivalent -0.0004191995620727539m. Only display depth clamps negative volume to zero, with the explicitly declared4.192m3 threshold bounding this run's accepted numerical deficit. This is not a correction to native mass balance. Missing values remainnull.

Near the Trico–Santa Cruz bridge, native face283056 at approximately(-111.2798578594,32.4536847409), area39.0625m2, has mean depth0.00161469631195m at10AM and0.00499720954895m at3PM. These values do not establish water on the roadway or bridge clearance. Source geometry/provenance is separate from crossing evidence and bridge elevations remain unverified.

The renderer01d0408 uses bounded overview aggregation above4096 visible faces. Overview colors show the maximum contributing native mean depth, with explicit wet/missing coverage fractions; exact native picking remains available. This is display aggregation, not finer hydraulics. Flat mode loads geometry and the selected frame only. The refined case has no verified terrain-display artifact, so3D stays unavailable rather than reusing old terrain. Original official closure and live risk guidance remain separate.

GCN10 attribution/source metadata accompany the package. The original native archive/input release remain the source of record. Package hashes bind each compressed artifact. No main deployment, solver rerun, or source refresh is part of this publication.

## Published preview verification

Commit aff0d19 was opened through raw.githack.com on the actual app Map route with ?case=refined. The 10 AM frame rendered a picked native face 266577 at 0.653 m; the 3 PM frame rendered face 387171 at 2.204 m. During loading the UI retained the old displayed timestamp and explicitly named the requested timestamp. Observed resource inventory contained geometry.json.gz, frame-0.json.gz and frame-20.json.gz only, confirming lazy frame requests in this interaction. No JavaScript errors were reported.

A 390 x 844 browser viewport was visually inspected. The selected depth/time/model semantics, quantitative legend and partial-run warning were visible; screenshot: public/simulation/preview/refined-partial-phone.png. This is browser viewport evidence, not physical-phone performance measurement. Local native/export comparisons verified face 283056 across both endpoint frames, and exact coverage lookup returned no cell at latitude33/longitude-112. Browser outside-domain tapping was not separately exercised. Refined 3D remains unavailable without matching terrain-display data.
