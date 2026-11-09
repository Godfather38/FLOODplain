# Native route result 42543056194

Brawley-Avra-West case `../all-route-ready-v3/brawley-avra-west-native-case-v2-observed-inflow` (modelVersion `all-routes-brawley-avra-west-v1`, domain v2, 1,240 km2, mesh v2): 643,056 cells, one inlet, 47 outflow cells. Inflow: observed USGS 09487000 (Brawley Wash near Three Points) discharge for inlet reach 15876941, injected on 15876923; current-case.json `inflow` names the series (the 15-minute reading at the top of each hour, cfs x 0.0283168). compact/manifest.json sourceIssues still says NWM 13Z frozen_replay because finalize_route_result.py writes that literal; the inflow of this run is the gauge. Rain: frozen HRRR 2026-11-01 14Z with the frozen analysis hours. The solver (GitHub Actions run 42543056194, workflow sfincs.yml, ref experimental/brawley-avra-west-20261108, commit e26900568cdf) finished ("Simulation finished") in 2934.0 s native runtime, with all 57 quarter-hour frames from 2026-11-01T17:00:00Z through 2026-11-02T07:00:00Z. The companion run on the other inflow variant is `../brawley-avra-west-result-42543054067`.

This case owns no rated route (`routeIds == []`), so no coverage-ledger point is retained (`route-point-summary.json` counts are all 0). Its local roads are evaluated separately by `tools/live/export_road_forecast.py local` against `tools/live/road-stations/brawley-avra-west-local-v2.json.gz` (58,140 stations); see `../brawley-avra-west-v2/sample-local-road-forecast-observed.json`.

Made with `tools/sfincs/brawley/inspect_route_result.py` (a copy of `tools/sfincs/inspect_route_result.py` that also accepts an explicit empty `routeIds`; every other check is unchanged), then `tools/sfincs/package_route_result.py` and `tools/sfincs/finalize_route_result.py`:

    python tools/sfincs/brawley/inspect_route_result.py WORK/artifact/runs/current --run-id 42543056194 --inventory tools/sfincs/data/all-route-ready-v3/recovered-road-ledger/coverage-ledger.json --output WORK/inspection
    python tools/sfincs/package_route_result.py 42543056194 WORK e26900568cdf872e9e916fb66a75b5fb7c722eaa
    python tools/sfincs/finalize_route_result.py WORK WORK/final-tree

WORK must be an absolute path (package_route_result.py writes the config paths as given). For this run the inspection was first given a relative path, so `result-summary.json` `nativeRunDirectory` is relative; nothing reads it, and every hash is unaffected.

Input/output face correspondence: 643,056 of 643,056 faces matched by exact rectangle bounds (identity order, max difference 0 m); mesh sha256 328042f02927 equals the prepared case. `handoff.json` records that every compact value equals native output after face-ID ordering, NaNs included. Negative native volumes: 5,212 samples, retained signed; minimum area-equivalent depth -0.674 mm (2026-11-01T22:00Z, a 39.06 m2 cell), inside the live verifier's 1 mm residual limit.

Not committed: the native-output.tar.gz parts (295,732,147 bytes; sfincs_map.nc, sfincs.nc, logs, restarts; archive sha256 815e654bcd11, map sha256 2e3e8b58da07). They are in the run artifact `sfincs-verification` (retention-limited). `native-manifest.json` lists them with `partsCommitted: false`.

Use `compact/manifest.json` for the map. Native signed volume and NAVD88 water surface are preserved. Volume divided by full cell area is not validated road depth, wet extent or bridge clearance; road over-topping must compare cell zs with the station road height. Native face IDs are local to this case.
