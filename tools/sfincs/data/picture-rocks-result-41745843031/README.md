# Native route result 41745843031

Complete rerun of the unchanged Picture Rocks/Ina/Twin Peaks case (`../all-route-ready-v3/picture-rocks-native-case-v2`) with a 7200-second cap. The solver finished in 3613 seconds ("Simulation finished"), so all 57 frames through November 2, 2026 at 07:00 UTC are present. The earlier run 41382872468 stopped 13 seconds short of its 3600-second cap; it is kept unchanged.

Frames 0–55 of this run are byte-identical to the 56 frames of 41382872468 (volume and water surface, every cell), and the geometry is identical. Only the 07:00 frame is new. Same saved engine, 2 OpenMP threads, same frozen NWM November 1 13Z / HRRR 14Z inputs.

All 189 route points of this case are inside the model and have native output. Use `compact/manifest.json` for the map. `handoff.json` records the check that every compact volume and water-surface value equals native output after face-ID ordering, NaNs included.

Native signed volume and NAVD88 water surface are preserved. Volume divided by full cell area is not validated road depth, wet extent or bridge clearance. Native face IDs are local to each case: use run ID plus face ID. Concatenate the archive parts in `native-manifest.json`, verify its SHA256 and extract. Packaged with `tools/sfincs/package_route_result.py` and `finalize_route_result.py`, which use the same exporters as the earlier results.
