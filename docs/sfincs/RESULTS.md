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
