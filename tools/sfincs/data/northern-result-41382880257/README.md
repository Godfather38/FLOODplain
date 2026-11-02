# Native route result 41382880257

Completed all 57 forecast frames through 07:00 UTC in 3354.94 seconds.

Use `compact/manifest.json` for the existing variable-footprint renderer. `handoff.json` verifies every exported volume and water-surface value against native output, including missing values and face-ID ordering. Point series and the exact recorded window are retained; see `../all-route-results-v1/coverage-ledger.json` for all routes, original evidence and gauge relationships.

These are frozen NWM November 1, 2026 at 13Z / HRRR 14Z inputs, not an automatically current forecast. Native signed volume and NAVD88 water surface are preserved. Volume/full-cell-area is not validated road depth, actual wet extent or bridge clearance. Native face IDs are local to each case: use run ID plus face ID.

Concatenate archive parts in `native-manifest.json`, verify its SHA256 and extract. Unchanged native forcing/subgrid inputs are referenced by that manifest. The saved engine was reused; its exact hashes and runtime-library list are included. Type 1 restart does not retain cumulative CN infiltration state, so it is not an identical continuation. Missing final native counters after a timeout are JSON null, never zero or success.

The original prepared `current-case.json` remains unchanged as input provenance. Actual outcome is recorded in `result-summary.json`, `native-manifest.json` and, for the capped case, `partial-proof.json` plus `workflow-failure.log`. No main merge or deployment occurred.
