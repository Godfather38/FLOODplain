# Native route result 42535214906

Brawley-Avra-West case `../all-route-ready-v3/brawley-avra-west-native-case-v1b` (modelVersion `all-routes-brawley-avra-west-v1`, domain v1, 839 km2, mesh v1): 408,207 cells, one inlet. Inflow: NWM (analysis_assim then short_range t13z) for inlet reach 15876941, injected on 15876923. Rain: frozen HRRR 2026-11-01 14Z with the frozen analysis hours. The solver (GitHub Actions run 42535214906, workflow sfincs.yml, ref experimental/brawley-avra-west-20261108, commit a938373d6ced) finished ("Simulation finished") in 1836.5 s native runtime, with all 57 quarter-hour frames from 2026-11-01T17:00:00Z through 2026-11-02T07:00:00Z. The companion run on the other inflow variant is `../brawley-avra-west-result-42535217219`.

This case owns no rated route (`routeIds == []`), so no coverage-ledger point is retained (`route-point-summary.json` counts are all 0). Its local roads are evaluated separately by `tools/live/export_road_forecast.py local` against `tools/live/road-stations/brawley-avra-west-local.json.gz`.

Made with `tools/sfincs/brawley/inspect_route_result.py` (a copy of `tools/sfincs/inspect_route_result.py` that also accepts an explicit empty `routeIds`; every other check is unchanged), then `tools/sfincs/package_route_result.py` and `tools/sfincs/finalize_route_result.py`:

    python tools/sfincs/brawley/inspect_route_result.py WORK/artifact/runs/current --run-id 42535214906 --inventory tools/sfincs/data/all-route-ready-v3/recovered-road-ledger/coverage-ledger.json --output WORK/inspection
    python tools/sfincs/package_route_result.py 42535214906 WORK a938373d6cedd4c2eec8c6885c54de22bc6a7e76
    python tools/sfincs/finalize_route_result.py WORK WORK/final-tree

Input/output face correspondence: 408,207 of 408,207 faces matched by exact rectangle bounds (identity order, max difference 0 m); mesh sha256 82f52929c069 equals the prepared case. `handoff.json` records that every compact value equals native output after face-ID ordering, NaNs included.

Not committed: the native-output.tar.gz parts (188,028,884 bytes; sfincs_map.nc, sfincs.nc, logs, restarts; archive sha256 c1adcfeb4467, map sha256 f700954d519d). They are in the run artifact `sfincs-verification` (retention-limited). `native-manifest.json` lists them with `partsCommitted: false`; its `nativeInputs` was corrected to the v1b folder (current-case.json carries the v1 caseId).

Use `compact/manifest.json` for the map. Native signed volume and NAVD88 water surface are preserved. Volume divided by full cell area is not validated road depth, wet extent or bridge clearance; road over-topping must compare cell zs with the station road height. Native face IDs are local to this case.
