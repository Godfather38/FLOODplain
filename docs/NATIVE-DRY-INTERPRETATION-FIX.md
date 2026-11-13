# Source-bound Picture Rocks native-dry interpretation

Implemented locally on experiment/picture-rocks-current-data. No deployment, live package publication or main merge.

The pinned SFINCS continuity code retains signed z_volume and, for low volume, sets zs to finite subgrid bottom. Its wet-only NetCDF writer omits that dry surface; compact export represents the fill as NaN. The road exporter previously recognized finite low positive volume as modeled dry but treated every negative residual as unknown.

The new optional interpretation is enabled ONLY for the exact Picture Rocks physical case and verified pinned engine, after successful native status and completion log. Mesh and subgrid SHA256 must match known files; theta must be 1 (no smoothing); candidate faces must be active mask=1 with finite bottom above -20 m and finite positive capacity. Source commit f3647fc0289bb15cb2512d60686cef74cb853c78 and engine binary SHA256 are verified at export. Missing evidence disables the interpretation.

A candidate must have finite negative volume with BOTH |volume| <= 0.00001 m3 and |volume/area| <= 0.0000001 m, and the dry-suppressed surface representation. These are conservative explicit interpretation limits, not a validated solver error bound, measurement uncertainty or physical accuracy claim. This is recognition of the pinned model's dry branch, not a general negative-volume clamp. Contradictory finite or infinite surface, larger residuals, nonfinite volume, invalid physical inputs, unknown road height or mapping remain unknown. The existing 1 mm package materiality limit is unchanged and is not used as a dry-classification tolerance.

Raw volumes and compact frames remain byte-identical. Road summary provenance records engine/source identity, static hashes, both limits, accepted station/frame count and minimum accepted residual. Each route frame records nativeDryResidualStations. No UI or route-rating code changed; modeled dry does not mean observed road safety.

Real validation: all 43 hash-verified frames from the audited 20Z current-forcing run. Accepted 244 station/frame samples (242 Ina, 2 Twin Peaks). Minimum accepted equivalent depth -5.853041657e-8 m. Ina becomes 3626/3626 valid in every frame; Twin Peaks 3341/3341; Avra remains 3317/3317. All raw frame hashes unchanged. Actual deployed selector accepts all three as complete modeled forecasts when evaluated within that run's validity window. The old audited run was NOT republished as a new current forecast.

Validation: 80 portable Python regressions pass, including six new tests for strict bounds, inactive/nonfinite/static failures, missing engine/source evidence, unknown heights/outside cells, default-negative behavior and unchanged raw values. Earlier 21 app partial-coverage/outlook tests also passed. Full POSIX workflow harness has not been rerun here on Windows. Full native integration of this exporter on a newly completed production run remains pending activation; the default backfill path has no physical evidence and deliberately keeps negatives unknown.

Changed implementation: native_dry_residuals.py, export_road_forecast.py, run_live_all_route.py; verify_all_route_package.py audit wording only. Evidence: native-dry-real-validation.json. Reproduction: validate_native_dry_real.py uses the downloaded pinned frames and exact physical case retained locally. Remaining scope: other model cases are deliberately untouched; no solution claimed for larger negatives or missing terrain.

Primary source:
https://github.com/Deltares/SFINCS/blob/f3647fc0289bb15cb2512d60686cef74cb853c78/source/src/sfincs_continuity.f90#L665
https://github.com/Deltares/SFINCS/blob/f3647fc0289bb15cb2512d60686cef74cb853c78/source/src/sfincs_ncoutput_helpers.F90
