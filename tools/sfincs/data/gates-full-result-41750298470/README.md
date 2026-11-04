# Native route result 41750298470

Full Gates case (`../all-route-ready-v3/gates-full-native-case-v3`, topology version 3): 384,716 cells, nine NWM inlets, frozen NWM November 1, 2026 13Z / HRRR 14Z inputs. The solver finished in 1987 seconds ("Simulation finished"), with all 57 frames through November 2 at 07:00 UTC. It replaces the supported-components run 41382857288, which left 59 Gates route points outside the model; that result is kept unchanged.

All 155 Gates route points are inside the model and have native output: Kinney Road, Gates Pass, Javelina Wash, and Sandario near Golden Gate and Kinney.

Terrain: the 1 m road windows are USGS 3DEP Pima County 2021. In the 10 m surrounding terrain, 95,919 cells come from USGS 3DEP Eastern Pima County 2015 1 m, because the 2021 tile has no data there. That is the 7.4221 km² listed gap plus the empty cells the mesh touches within 200 m of the domain. Where the two surveys meet, 2015 is a median 0.12 m higher than 2021 (5–95 %: 0.02–0.24 m). This offset was not adjusted. See `../all-route-ready-v3/gates-terrain-recovery/context-2015-fill-manifest.json` and `tools/sfincs/fill_gates_context_gap.py`.

Use `compact/manifest.json` for the map. `handoff.json` records the check that every compact value equals native output after face-ID ordering, NaNs included. Native signed volume and NAVD88 water surface are preserved. Volume divided by full cell area is not validated road depth, wet extent or bridge clearance. Native face IDs are local to each case.
