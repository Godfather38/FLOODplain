# All-route native result ledger, version 2

All 458 evidence identities now have native output for the full requested window, from three complete runs:

| Case | Run | Solver | Frames | Route points located |
|---|---|---|---|---|
| Northern/Sanders v3 | 41382880257 (unchanged) | 3355 s | 57 | 138 of 138 |
| Picture Rocks/Ina/Twin Peaks v2 | 41745843031 (rerun, 7200 s cap) | 3613 s | 57 | 189 of 189 |
| Full Gates v3 | 41750298470 (new case) | 1987 s | 57 | 155 of 155 |

Version 1 had 399 identities with output: 165 of them only through 06:45, and 59 Gates identities outside the model. Version 1 is kept unchanged. `delivery.json` is the entry point, with hashes and links per case. Twenty-four identities appear in two cases; they are not counted twice or averaged.

All runs use the frozen NWM November 1 13Z / HRRR 14Z package. The full Gates case uses USGS 3DEP 2015 terrain for 95,919 surrounding 10 m cells where the 2021 survey has no data; see `../gates-full-result-41750298470/README.md`. The 458 identities are evidence identities (flood-related entries, county road junctions, terrain minima), not 458 confirmed dips. Native volume divided by cell area is not validated road depth or passability.

Built with `tools/sfincs/merge_route_coverage.py` from the same inventory as version 1 (`../all-route-ready-v3/recovered-road-ledger/coverage-ledger.json`).
