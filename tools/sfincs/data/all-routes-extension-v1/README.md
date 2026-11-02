# All-route geometry and input preparation

> I don't want to interrupt existing work- just add on to it. Lets make sure all dips in our routes have tracking. And use those gauges along the river.

> I explicitly said earlier to start all fucking junctions dickhead

> Alwyas provide clear checklists of each objective and whats included, update it with every request and change where you jump on shit

This extension preserves completed Trico/Avra and Silverbell runs. No new simulation has been executed. Prepared geometry is not completed model coverage.


**Preparation update:** Do not execute the northern or full Gates version 2 cases. A subsequent audit of both primary and secondary downstream links found leave-and-reenter branches requiring version 3 domain closure. Northern version 3 has eight external inlets and includes the contained zero-local-area branch; no split fraction was invented. Picture Rocks version 2 is unchanged. The nine terrain-supported Gates components are being prepared separately; the two terrain-deficient components remain in the master ledger. No new solver has run.

The physical fields and native assembly are continuing in the permitted task workspace. The previously attempted copy of context rasters into this worktree was not executed because automatic approval review reported model capacity, not an unsafe action. This notice does not retry that copy.
## Cumulative checklist

- [x] Verify all eight current app routes and preserve every shared membership.
- [x] Retain 88 existing flood-related entries and 203 actual county street junctions.
- [x] Screen the complete route geometry using retained professional 1 m terrain:184 raw minima,167 exact-coordinate identities. These are candidates, not a complete field survey of buried drainage.
- [x] Import 155 missing 1 km terrain windows; reuse 91 existing windows.
- [x] Record the genuine Gates gap:463400 missing 1 m pixels, including 338.17 m of road and 169 two-metre profile samples. No filling or 2015 fallback.
- [x] Prepare corrected whole-catchment domains, including intervening reaches to prevent cumulative inflow double counting.
- [x] Build all three official Deltares quadtree meshes and prove every assigned ledger point is active at 6.25 m.
- [x] Prepare 26 frozen NWM inlet series: November 1 13 Z forecasts and October 30 16 ZÃ¢â‚¬â€œNovember 1 14 Z analysis histories.
- [x] Recrop all 63 rainfall hours from cached originals, with the explicit MRMS replacement retained.
- [ ] Finish native subgrid terrain/roughness/infiltration parameters and source/outlet placement.
- [ ] Serialize complete native cases and publish input archive hashes.
- [ ] Obtain bounded execution authorization for each new case, then run and publish actual results.

## Cases

| Case | Roads included | Native cells | Assigned evidence memberships | Prepared point coverage |
|---|---|---:|---:|---|
| Northern | Trico, Avra, both Silverbell routes, Sanders and connecting approaches |528193|138|All active 6.25 m|
| Picture Rocks/Ina/Twin Peaks | Picture Rocks/Ina, Twin Peaks, Picture Rocks/Avra and shared Sandario sections |537476|189|All active 6.25 m|
| Gates | Southern Sandario, Kinney, Gates Pass, Speedway and freeway connection |384338|155|All active 6.25 m; terrain gap remains|

These membership counts overlap. The ledger contains 458 evidence identities across three separate evidence sets, not 458 confirmed independent physical dips. Ten nearby original pairs remain flagged rather than merged by proximity. Case domains overlap and their surfaces must not be stitched indiscriminately; use the owning route/case and preserve model identity.

## Source and output semantics

Terrain: actual professional 2021/2023 road windows, NAVD 88 metres. Existing explicitly documented 2019 peripheral context is preserved separately. Computational 6.25 m cells and approximately 1.04 m finest subgrid sampling do not establish road-depth accuracy. Bare-earth terrain does not supply bridge decks or buried culvert openings.

Parameters: official Deltares subgrid and HydroMT routines; WorldCover 2021 with the pinned official Manning mapping; GCN 10 fair-cover average antecedent/undrained scenario, with ODbL provenance. This is not measured soil moisture or calibrated ephemeral-channel loss.

Forcing remains frozen simulated-live: NWM November 1 13 Z and HRRR 14 Z, full interval October 30 16 ZÃ¢â‚¬â€œNovember 2 07 Z. History uses observed analysis products, an explicitly recorded single MRMS replacement, and the existing forecast transition. No current refresh or zero filling occurred.

Gauge observations are retained as observations. Native boundary flows use directed matching reaches. Stage relative to a gauge zero is not NAVD 88 bridge elevation; proximity does not establish a gauge-to-dip hydraulic relationship.

## Reproduction and execution budget

Use `import_all_routes_terrain.py`, `screen_all_route_dips.py`, `prepare_route_case_mesh.py`, `prepare_route_case_parameters.py`, `prepare_route_case_boundaries.py`, `stage_route_case_native.py` and `finish_route_case.py`. These reuse the established official workflow and retained executable; they do not introduce a new runoff model. Prepared mesh archives and exact hashes are in `prepared-meshes.json`; cell coverage is in `prepared-location-coverage.json`.

Completed reference: Silverbell 480227 cells/full 63 h took 2308.346 seconds. Linear cell-count scaling alone gives about 42.3 min northern,43.1 min Picture Rocks and 30.8 min Gates, but different slopes/wetting can change the native timestep. Planning range is 40Ã¢â‚¬â€œ60 min for northern/Picture Rocks and roughly 30Ã¢â‚¬â€œ60 min Gates, not a measured runtime or guarantee. Propose one maximum 60-minute execution per complete case, with outputs retained on timeout. The prior single-run authorization does not authorize these three runs. No new run has been dispatched.

The Gates newer-terrain gap is a specific missing input, not a generic requirement for a whole native agency model ZIP. Other cases continue independently. Final native archives must retain this distinction rather than claim all cases runnable prematurely.
