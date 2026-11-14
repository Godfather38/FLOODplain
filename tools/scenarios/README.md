# Wider saved design-storm preview

This branch runs the existing 100-year (`stress`) and 1,000-year (`extreme`) design storms on the three already prepared wider native domains. It never publishes to the live-model, live-all-route-web, main, or default application branch. The workflow has read-only repository permissions and returns Actions artifacts for an isolated test deployment.

## Exact forcing transfer

The original narrow and wider cases both span 63 hours. Their reference clocks differ by five hours. Preserve each wider case's original 49-hour antecedent and all non-Santa-Cruz inlet flows. Copy the original storm's actual spatially uniform rainfall values at matching elapsed time from hour 49 onward, without recreating a hyetograph or extrapolating any missing interval. The imposed six-hour totals remain 71.882 mm and 101.6 mm. The absolute test clock shifts five hours earlier; this is explicitly a relative-time scenario transplant, not the same historical forcing or current conditions.

For Northern, the record-river curve replaces actual Santa Cruz reach 15902363 (column 8), not the colocated unnamed headwater 15902351 (column 7) incorrectly named in the original coarse metadata. The curves enter the same physical location, but replacing the actual river avoids adding its baseline flow on top of the designed record curve. Other columns remain unchanged. Picture Rocks and Gates retain their own inlet series because they do not contain this Santa Cruz inlet; no river flow is invented.

The full archived scenario window is retained: 57 quarter-hour water frames from elapsed 49 to 63 hours. That is not a claim of complete drainage or recession; the final original river flows are still 380/760 m3/s. Rainfall return period is not a calibrated joint flood return period.

## Validation and bounds

- Original storm archives, all wider archive parts, and their meshes are hash verified.
- Geometry, subgrid, infiltration, roughness and other physical inputs remain byte-identical.
- Exact antecedent rainfall and every untouched inlet are verified. No timestamp extrapolation or silent zero filling is permitted.
- Native engine commit and binary SHA256 are pinned. Numerical settings are unchanged; only output interval/restart-file controls are configured.
- Each of six runs has a 5,400-second native cap, no automatic retries, maximum three simultaneous jobs.
- Complete native status, all 57 frames, frame identities, hashes, and the existing 1 mm negative-volume materiality gate are checked before a preview output is accepted. Raw signed volumes are retained.
- No negative-as-dry patch or production exporter activation is included.

Run artifacts are named `scenario-{stress|extreme}-{northern|picture-rocks|gates}`. Each contains compact output plus input provenance and the native run log. Failed/incomplete artifacts are diagnostic only and must not be wired into a completed scenario.
