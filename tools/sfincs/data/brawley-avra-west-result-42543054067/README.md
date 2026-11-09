# Native route result 42543054067

Brawley-Avra-West case `../all-route-ready-v3/brawley-avra-west-native-case-v2` (modelVersion `all-routes-brawley-avra-west-v1`, domain v2, 1,240 km2, mesh v2): 643,056 cells, one inlet, 47 outflow cells. Inflow: NWM (analysis_assim then short_range t13z) for inlet reach 15876941, injected on 15876923. Rain: frozen HRRR 2026-11-01 14Z with the frozen analysis hours. The solver (GitHub Actions run 42543054067, workflow sfincs.yml, ref experimental/brawley-avra-west-20261108, commit e26900568cdf) finished ("Simulation finished") in 3349.9 s native runtime, with all 57 quarter-hour frames from 2026-11-01T17:00:00Z through 2026-11-02T07:00:00Z. The companion run on the other inflow variant is `../brawley-avra-west-result-42543056194`.

This case owns no rated route (`routeIds == []`), so no coverage-ledger point is retained (`route-point-summary.json` counts are all 0). Its local roads are evaluated separately by `tools/live/export_road_forecast.py local` against `tools/live/road-stations/brawley-avra-west-local-v2.json.gz` (58,140 stations); see `../brawley-avra-west-v2/sample-local-road-forecast-nwm.json`.

Made with `tools/sfincs/brawley/inspect_route_result.py` (a copy of `tools/sfincs/inspect_route_result.py` that also accepts an explicit empty `routeIds`; every other check is unchanged), then `tools/sfincs/package_route_result.py` and `tools/sfincs/finalize_route_result.py`:

    python tools/sfincs/brawley/inspect_route_result.py WORK/artifact/runs/current --run-id 42543054067 --inventory tools/sfincs/data/all-route-ready-v3/recovered-road-ledger/coverage-ledger.json --output WORK/inspection
    python tools/sfincs/package_route_result.py 42543054067 WORK e26900568cdf872e9e916fb66a75b5fb7c722eaa
    python tools/sfincs/finalize_route_result.py WORK WORK/final-tree

WORK must be an absolute path (package_route_result.py writes the config paths as given).

Input/output face correspondence: 643,056 of 643,056 faces matched by exact rectangle bounds (identity order, max difference 0 m); mesh sha256 328042f02927 equals the prepared case. `handoff.json` records that every compact value equals native output after face-ID ordering, NaNs included. Negative native volumes: 5,261 samples, retained signed; minimum area-equivalent depth -0.643 mm (2026-11-01T21:00Z, a 39.06 m2 cell), inside the live verifier's 1 mm residual limit.

Not committed: the native-output.tar.gz parts (295,334,588 bytes; sfincs_map.nc, sfincs.nc, logs, restarts; archive sha256 86d2f94068d6, map sha256 f88fcbc7bc5c). They are in the run artifact `sfincs-verification` (retention-limited). `native-manifest.json` lists them with `partsCommitted: false`.

Use `compact/manifest.json` for the map. Native signed volume and NAVD88 water surface are preserved. Volume divided by full cell area is not validated road depth, wet extent or bridge clearance; road over-topping must compare cell zs with the station road height. Native face IDs are local to this case.
