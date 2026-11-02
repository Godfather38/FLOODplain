# All-route native result ledger

> I don't want to interrupt existing work- just add on to it. Lets make sure all dips in our routes have tracking. And use those gauges along the river.
> I explicitly said earlier to start all fucking junctions dickhead

All three approved executions have ended. Northern/Sanders completed in 3354.94 seconds and supported Gates in 870.30 seconds, each with all 57 forecast frames through November 2, 2026 at 07:00 UTC. Picture Rocks/Ina/Twin Peaks reached its approved 3600-second wall-time cap (exit 124), preserving 56 complete native map frames through 06:45 UTC. The 07:00 frame is missing. No additional run was started.

The ledger preserves all 458 evidence identities: 88 existing flood-related entries, 203 county road junctions and 167 terrain-minimum identities. They are not 458 independently confirmed physical dips. There are 399 identities with actual native output: 234 have a full requested-window result, 165 have only the shorter Picture Rocks window. The 59 uncovered Gates identities remain explicitly present. Twenty-four identities have overlapping case outputs; these are not counted twice or averaged together.

All eight routes remain in scope: Trico, Avra, both Silverbell routes, Picture Rocks/Ina, Twin Peaks, Picture Rocks/Avra and Gates. Original source evidence and gauge associations remain in `coverage-ledger.json`. Each new native result retains its case, exact face ID, actual time coverage and raw quantities. Do not use the older inventory `model` field instead of the new `allRouteNativeCoverage` fields.

Native point series, logs and exact source hashes are published in the sibling `northern-result-41382880257`, `picture-rocks-result-41382872468`, and `gates-supported-result-41382857288` directories. All three compact maps and native archives are now published. `delivery.json` is the combined entry point, with per-case status, exact valid intervals, hashes and archive links. Picture Rocks remains explicitly partial; packaging does not restore its missing final frame.

All results use the frozen NWM November 1 13Z / HRRR 14Z package, not a current refresh. Native volume/full cell area is not validated road depth, wet extent, bridge clearance or passability. Partial Picture Rocks final native status/runtime counters are null because the time cap interrupted finalization; null is not zero or success.

Full Gates remains open: the exact 7.4221 square kilometre surrounding-terrain gap is in `../all-route-ready-v3/gates-terrain-recovery/`. All eight route profiles now have terrain samples, but that does not supply the missing connected-catchment terrain. Older data has not been silently substituted. No main merge or production deployment occurred.

The read-only Northern/Picture Rocks overlap comparison found up to 1.458374 m difference in native water surface at matching tracked-point IDs and UTC times. At the Avra Valley bridge ID, the maximum common-time difference was 1.094543 m. See `overlap-readout.json` for exact coordinates, timestamps and source hashes. These are distinct model-case outputs, not an uncertainty calibration or evidence of seamless agreement; no averaging or rating change was applied.
