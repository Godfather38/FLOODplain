> Current 2D draft requirements and completion status: [2D-DRAFT-CHECKLIST.md](2D-DRAFT-CHECKLIST.md). Earlier scope/completion language below does not override that checklist. Full SFINCS + HAND + Combined and current coarse model refresh are required; 3D/refinement are separate.

# Current-data map test

Branch: experiment/current-map. Production is unchanged.

Open public/index.html#/map. Current readings use the existing live USGS, Pima ALERT and county-closure feeds. The original route engine remains authoritative and unchanged. Five-minute refresh and source-age checks distinguish request time from observation time.

Select Forecast extent / HAND, a supported crossing, then a future valid hour. The existing HAND engine consumes the current NOAA NWPS gauge or NWM reach forecast, not a saved replay. Forecast issuance and valid time are separate. Missing, stale, unsupported and failed requests clear the previous extent. HAND depicts estimated extent, not measured inundation or road depth. This build uses the restored app's Leaflet map; it does not yet bring the experimental vector renderer into the current-data path.

Remote verification on November 1 2026: six current USGS readings; Trico NOAA forecast issued 10:16 AM MST, 2 PM valid flow 292 cfs, 3 PM 351 cfs. Both hours rendered. Selecting an unsupported crossing cleared its forecast and time choices. Phone and desktop inspected; no JavaScript errors recorded. Phone controls sit below the map and require scrolling. Screenshot: public/live-preview/current-hand-phone.png. These values describe verification, not hardcoded inputs.

## Manual SFINCS refresh

No current SFINCS result exists in this branch. The unavailable manifest deliberately prevents a frozen replay from masquerading as current. The current UI reads publication status; rendering a newly produced SFINCS run still needs integration. No recurring model job is enabled.

Use tools/live/refresh-sfincs.py with the retained input and solver checkouts. Each phase takes --inputs-repo, --solver-repo, --package, --registry, --case and --bounds WEST SOUTH EAST NORTH. Paths resolve against the invocation directory.

1. acquire: invokes existing build_current_inputs.py for actual forecast inputs.
2. Supply documented observed initialization history/rainfall and a compatible prepared model. Acquisition does not invent or zero-fill this prerequisite.
3. assemble --model MODEL: invokes existing assemble_current_case.py; missing inputs fail.
4. run --binary RETAINED_SFINCS: refuses an already expired prepared forecast and executes the retained solver.
5. publish --config ACTUAL_EXPORT_CONFIG --destination public/simulation/data: invokes existing case-driven exporter, which validates actual completed output/provenance and switches the current manifest last. No simulated-live flag, upload or deployment occurs.

This orchestrates existing tools; it is not a turnkey unattended full-domain service. Model preparation, initialization inputs, an actual completed run and final current-output renderer connection remain prerequisites. Do not use a historical export configuration or infer missing geometry. Existing refined/quadtree outputs require their matching exporter rather than the regular-grid path.

Checks: 95 existing and focused tests pass, including shared requests, cache timestamp preservation, expiry, rate-limit handling and missing current publication. No SMS, credentials, production schedules or notification settings changed.
