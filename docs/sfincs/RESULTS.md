# Latest result: documented levee restores much of the channel pulse

The source-supported levee case gives **301.306 m3/s**, versus reported Trico **339.802 m3/s**: **11.33% low and 66 minutes early**. RMSE is **26.165 m3/s**. Runtime was **73.50 seconds**, reusing the saved executable and prepared inputs. No crest inflation, channel carving or numerical parameter fitting was used. See [complete source evidence, numerical limitations and comparison](LEVEE-CASE.md).

App artifact: `tools/sfincs/data/reach-levee-result/inundation.json.gz`. The existing short station-comparison section remains the reference; the full-valley diagnostic is not substituted. This is an iterative development benchmark, not independent validation. The earlier cases below remain preserved.

---

# Native geometry result: faster arrival, peak still too small

Actual solver execution [41291800062](https://github.com/Godfather38/FLOODplain/actions/runs/41291800062) reused the saved executable on a fresh runner, without compilation. Runtime: **104.01 seconds**. [Input methods and source provenance](NATIVE-GEOMETRY.md) describe the official HydroMT subgrid/outflow setup, 10 m USGS terrain, and connected NOAA river geometry. No channel burning or target fitting occurred.

The modeled Trico-section peak is **96.725 m3/s at September 9 07:24 UTC**, versus observed **339.802 m3/s at 06:45 UTC**: **39 minutes late**. RMSE is **62.990 m3/s** across 289 comparison times. The complete-rainfall coarse reference was 93.061 m3/s at 13:41 UTC, RMSE 88.197. The generalized river-line relocation was worse: 76.867 m3/s at 15:36 UTC. Both references remain preserved. Better arrival timing does not cure the large peak underestimate.

Native inputs: river 13,277,279 m3 and rain 11,502,125 m3; net outward interior-control-section flux 11,977,106 m3; final interior storage 12,812,791 m3. Residual: **-10,493 m3 (-0.0423%)**. Changing outlet sampling from 60 to 120 seconds changes its integral by 4,489 m3; this is approximate accounting.

Native maximum water level above the subgrid cell minimum is 29.617 m. The maximum full-cell mean depth is 25.268 m (3.007 m within the displayed Trico crop). These depth definitions differ from the uniform-bed reference. Significant pooling remains unresolved; neither value is a roadway measurement.

The first export incorrectly compared cubic-metre volumes with a metre-scale tolerance. The largest negative native cell volume was -0.04347 m3, equivalent to -0.00000435 m over a 100 m cell. The corrected check uses a 0.00001 m equivalent tolerance, records the observed roundoff, clamps only displayed negative depths, and retains raw volumes in the budget. Maximum total negative volume in any frame was 0.0512 m3. The solver was **not rerun** for this export correction. The GitHub job retains its original export-failure status; the completed native output and corrected local export are both preserved honestly.

App artifact: `tools/sfincs/data/reach-geometry-result/inundation.json.gz`. It contains 97 hourly frames, explicit cell-average depth semantics, source provenance, native flow comparison, and unquantified uncertainty. Companion native maps/history, checks and run provenance are retained. The engine-retention blocker described in older entries below is resolved.

---

# Latest complete-rainfall reach result

Run [41289685306](https://github.com/Godfather38/FLOODplain/actions/runs/41289685306), input commit `d68c194`, completed the 72-hour September 8-11 event with Stage IV rainfall and observed Cortaro inflow. Native solver time was **61.22 seconds**; total job time was **4 minutes 36 seconds**, including a redundant source rebuild. No subsequent rebuild was launched. Original baseline outputs are unchanged.

Trico-section peak: **93.033 m3/s at September 9 13:42 UTC**, versus observed **339.802 m3/s at 06:45 UTC** (6 h 57 min late). RMSE is **88.205 m3/s** over 289 observation times. Rainfall improves the prior 81.425 m3/s peak only modestly; this remains a poor event reconstruction, not a usable forecast accuracy claim.

Initial storage 271,436 m3; final storage 17,511,898 m3; native river input 13,006,005 m3; native rainfall 11,328,912 m3; net outward flux 7,211,599 m3. Residual is -117,143 m3 (-0.481%). Outlet integration changes by 203,942 m3 when sampled at 120 instead of 60 seconds, so this is an approximate budget rather than an exact numerical conservation proof. Native rainfall differs from prescribed rainfall by only 55 m3.

Maximum depth remains 26.884 m in the unresolved upstream depression; displayed Trico-window maximum is 2.991 m. No terrain correction or roughness calibration was made. See [geometry evidence](GEOMETRY-EVIDENCE.md) for exactly which study information was used and which is unavailable.

App artifact: `tools/sfincs/data/reach-stage4-result/inundation.json.gz`; companion checks, case metadata, native maps/history and run provenance are retained alongside it. The 72-hour run uses modeled antecedent water levels and reset velocities, not observed initialization. Complete 96-hour rainfall and optional official-flowline inflow placement are prepared but **not executed**. Their input generation succeeded; do not present them as model results.

The completed runner did not retain its executable in the artifact. No local executable was found in existing run folders. A further run therefore needs a retained compatible executable or explicit resolution of the no-rebuild constraint. This is a workflow limitation, not a solver limitation.

---

# Rainfall correction

The recorded Trico rainfall run below used a now-obsolete historical palette interpretation. Retain it only as execution/audit evidence, not a valid historical rainfall scenario. Corrected hourly zeros are unknown; active runs now use independent Cortaro inflow while complete rainfall is sourced.

# Verified SFINCS milestones

The official GPL-3.0 source at `f3647fc0289bb15cb2512d60686cef74cb853c78`
compiled with gfortran on a standard Linux runner. Serial compilation is required
by the upstream Fortran module ordering. No solver source or physics was changed.
The Windows Docker engine remains unavailable; these executions occurred in CI.

## Analytical checks

[Successful run 41285880943](https://github.com/Godfather38/FLOODplain/actions/runs/41285880943),
application commit `3061607e5a24389fbefcc15aef95e6db57f2b5af`:

- Dry closed basin: final stored volume 0 m³; all 13 frames dry.
- Rainfall closed basin: prescribed 10,000 m³, final stored 10,000 m³.
  Maximum error against depth at every analytical output time: 7.64e-10 m.
- Both real solver outputs passed `acceptInundationRun` from the app branch.
  The numerical error above is not a forecast confidence interval.

## Real terrain and recorded rainfall integration

[Successful run 41286213548](https://github.com/Godfather38/FLOODplain/actions/runs/41286213548),
application commit `2e858344e088df730ff490118820b78a72ac754a`:

- USGS raw 3DEP crop, 67×101 cells at 100 m, EPSG:32612. Projected extent
  `[468000, 3584800, 474700, 3594900]`; all 15 intersecting catalog records
  identify NAVD88. Terrain is contemporary and does not resolve culverts.
- Rainfall loader/data pinned to `15299aafd9620b0b4f2f42381acd8cae8e3fde9a`
  on `experiment/avra-radar-runoff`. Seventy-two contiguous hourly intervals,
  no missing cell-hours in the padded crop. Its `requires_quality_review` flag
  and hourly-versus-daily product discrepancy are preserved in the output.
- Actual SFINCS runtime about 1.19 seconds, 10-second average internal timestep.
  Export: 6,767 geographic cell centers and 73 UTC hourly depth frames.
- Maximum depth 0.007263 m, below the configured 0.01 m wetting threshold.
  This is a working forcing/terrain/output integration, **not evidence that the
  September 2014 flood was reproduced or that meaningful routing was exercised**.
- Input rainfall volume 335,045 m³; final storage 318,595.59 m³. The 16,449.41 m³
  difference combines artificial edge losses and numerical effects. Outlet flux
  was not independently integrated, so the report explicitly says the local
  mass balance is not closed. It is not presented as a conservation error bound.
- Initial state dry; zero assumed infiltration; uniform Manning 0.04; no upstream
  Santa Cruz inflow. These assumptions exclude a full river-flood reconstruction.

## Durable handoff

`tools/sfincs/data/reference-run/` contains the original projected NetCDF,
compressed app JSON (`gzip`), case metadata, checks, solver log and SHA-256
manifest. It is approximately 400 KB and remains on the experimental branch.
The JSON passes the app's exact `inundation-contract.js` contract, but consumers
must retain its support limits and forcing-quality notice. Never convert
`status: complete` (execution completed) into a claim of validation or road depth.

`tools/sfincs/data/terrain/` preserves the raw TIFF and source catalog evidence.
The CI artifact additionally contains the full generated forcing and input files.
`uncertainty.plusMinus` is null; there is no calibrated confidence interval.

The next useful scientific steps are resolving the rainfall discrepancy, adding
observed upstream inflow and appropriate downstream boundary conditions, testing
grid/roughness/infiltration sensitivity, and independently checking the local
water budget against gauges and mapped flood evidence. These are still outstanding.

## Wet-to-dry regression

[Run 41286691365](https://github.com/Godfather38/FLOODplain/actions/runs/41286691365) passed all eight exporter tests, the dry/rain analytical cases, a synthetic inclined-bed outlet case, and the real-terrain scenario. Outlet-case storage decreased monotonically from 475,000 to 53,892.125 m3; dry cells increased from 20 to 40 at the 0.01 m threshold. Depths remained finite and nonnegative. This checks wet-to-dry stability; it does not independently close the outlet mass balance. The Trico output reproduced the figures above.
