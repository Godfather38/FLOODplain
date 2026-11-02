# Supported Gates result

> I don't want to interrupt existing work- just add on to it. Lets make sure all dips in our routes have tracking. And use those gauges along the river.
> I explicitly said earlier to start all fucking junctions dickhead

Run 41382857288 completed the full 63-hour interval using the saved executable in 870.3 seconds of native simulation runtime. It recorded all 57 quarter-hour forecast frames from November 1, 2026 at 17:00 UTC through November 2 at 07:00 UTC. This is frozen replay: NWM 13Z and HRRR 14Z, not a new current forecast.

Use `compact/manifest.json` for the existing variable-footprint renderer. `handoff.json` records exact native-array equality and payload hashes. `route-point-summary.json` and `route-point-series.csv` retain the 155 Gates evidence memberships: 96 actually located in 6.25 m native cells, 59 outside this case. A pin or inventory membership is not simulated coverage.

This does not complete the full Gates route. The exact remaining 7.4221 square kilometre context-terrain gap is in `../all-route-ready-v3/gates-terrain-recovery/gates-remaining-gap.geojson`. All route-profile samples now have terrain, but the excluded connected catchment still needs compatible surrounding terrain before its physical case can run.

Raw native signed volume and NAVD88 water-surface elevation are retained. Volume divided by full cell area is not validated road depth, actual wet extent, bridge clearance or passability. Negative native volume reaches -7.3014 cubic metres (minimum volume/area about -0.0007302 m); the compact columns preserve it. The legacy JSON display-only clamp is disclosed in the configuration and is not evidence of numerical accuracy. Missing water surfaces remain missing.

Concatenate the native archive parts listed in `native-manifest.json`, verify its SHA256, and extract to recover actual native maps, geometry, logs and restart states. Unchanged forcing/subgrid inputs remain in `../all-route-ready-v3/gates-supported-native-case-v2/manifest.json`. Type 1 restart does not preserve cumulative CN infiltration state, so it is not an identical continuation. No new river-section flow or bridge geometry was invented.

The original prepared `current-case.json` is retained unchanged as input provenance; actual execution status is in `result-summary.json` and `native-manifest.json`. Join canonical point IDs to `../all-route-ready-v3/recovered-road-ledger/coverage-ledger.json` for source evidence, route memberships and qualified gauge associations. No main merge or production deployment occurred.
