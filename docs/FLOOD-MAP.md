# The flood map: what it is, what it can do, and what it can't

Written Nov 3, 2026. This is a hobby project that runs on free services (GitHub Pages, free GitHub
Actions runners and public data). This page sets realistic expectations and records what exists.
Keep it current when the map changes.

## What the map shows today (Map tab, branch `experiment/2d-street-map`)

| Layer | What it is | Covers | Source |
|---|---|---|---|
| SFINCS water | A 2D flood model: rain and river flow moving over the ground | Only a strip along the Santa Cruz River (27% of its rectangle). **Not** Avra Valley, Brawley Wash or the Sandario dips. | Our own hourly run (`experiment/live-sfincs`) and four saved runs |
| SFINCS water, all routes | The same model on all eight routes, cells from 6.25 m on the roads up to 100 m, in three separate model areas | Avra Valley, Brawley Wash, Picture Rocks, the Sandario dips, Kinney Rd and Gates Pass (Gates on mixed-vintage terrain) | The saved all-route run "Nov 1 · 13Z all routes" (see below) |
| HAND | NOAA's "height above nearest drainage": a quick estimate of where a river at a given flow reaches | 25 windows, 3 km each, around crossings. Washes get water only when the National Water Model has a flow for them. | NOAA OWP HAND grids, NOAA National Water Model flows |
| Rain | The run's own rain input | Whole area | NOAA HRRR forecast, or NOAA Atlas 14 for the what-if storms |
| Live readings, closures, route ratings | Gauges, county closures and the app's route rules | Whole served area | USGS, Pima County ALERT, county closures, TransView, NWS |

## The all-route run on the map ("Nov 1 · 13Z all routes")

The `experiment/sfincs-engine` branch has SFINCS run on **all eight routes** at 6.25 m detail, in
three separate model areas (`tools/sfincs/data/`). Since Nov 3, 2026 it is a scenario on the Map
tab, as real water in 2D and 3D (it used to be point readouts only):

| Model area | Routes | State |
|---|---|---|
| Northern (`northern-result-41382880257`) | Trico, Avra, Silverbell north and south, including the Brawley Wash dip | Complete: 57 quarter-hour frames |
| Picture Rocks (`picture-rocks-result-41745843031`) | Picture Rocks/Ina, Twin Peaks, Picture Rocks/Avra, including the Sandario dips | Complete: 57 frames, all 189 route points. Rerun to completion; frames 0–55 are byte-identical to the earlier run that stopped at its time limit |
| Gates (`gates-full-result-41750298470`) | Sandario south, Kinney Rd, Gates Pass, Speedway | Complete: 57 frames, all 155 route points. **Mixed-vintage terrain** (see below) |

**Gates terrain is mixed-vintage.** Most of it is the 2021 Pima County lidar, like the other areas.
The 2021 lidar has no data in about 7.4 km² around Kinney Rd and Gates Pass (95,919 10 m cells), so
there Gates uses the USGS 3DEP 2015 Eastern Pima County 1 m lidar. At the seam the 2015 ground sits
about 0.12 m (0.4 ft) higher than 2021, and it is not adjusted. Owner decision, Nov 3, 2026: keep
it. The scenario card, its note and the Model tab say so.

All three are **one saved run**: the NOAA forecasts issued Nov 1, 2026 (National Water Model 13Z,
HRRR 14Z), covering Nov 1 10 AM to Nov 2 midnight Arizona time, in 15-minute frames.

How it is shown:
- **Display package** `public/simulation/data/all-route-13z/`, built by
  `tools/all-route/build_web_package.py` straight from the published compact results listed in
  `tools/sfincs/data/all-route-results-v2/delivery.json` (pinned commit `2b8c528` on
  `claude/all-route-expansion-78d5d4`). The builder checks each case's manifest hash against the
  delivery. No model was rerun. Two variants per area:
  - *web* (2D map, and 3D on Low and Medium): native cells within 150 m of a route; farther away, cells smaller than 50 m are joined into 50 m blocks whose depth is their total stored water over the block's area (the model's own volume / area rule). 361k + 367k + 262k cells.
  - *full* (3D on High and Ultra): every native cell, 528k + 537k + 385k.
  - Cells are stored as three small integers each (they are UTM squares on a 6.25 m lattice), about 40 KB per area. Frames list only cells with at least 5 mm of water, depth to the millimetre, and are loaded one at a time with two ahead. A frame averages about 72 KB (web) or 98 KB (full) per area; all frames of all three areas are 12.4 MB (web) and 16.8 MB (full).
  - **Route points are never changed**: in every frame both variants carry the exact native float32 depth and water surface of each route-point cell, and the builder stops if any of the 27,474 values differs from the area's `route-point-series.csv`. `route-points.json` holds the same exact series for the crossings.
- **Overlap.** The areas are separate models and are never averaged. Where they overlap, one is drawn at each place. By default it is the area built for the nearest route (Northern for Trico, Avra and the Silverbells; Picture Rocks for Ina, Twin Peaks and Picture Rocks/Avra; Gates for Gates). Map layers can instead put one area first. A tap on the 2D map lists every area's value at that spot. A crossing in two areas (Santa Cruz at Avra Valley Rd) shows both in the scoreboard and in the 3D crossing card.
- **Whole window, every route point.** All three areas have all 57 frames and every route point, so the map no longer marks a missing frame or a terrain gap. The Gates crossings (Sandario south of Golden Gate, Kinney Rd at Javelina, the Kinney Rd washes) now have results: 46 of the 155 Gates route points reach 0.03 ft of water during the run; Kinney/Javelina peaks at 0.27 ft (1:45 PM MST), Sandario south at 0.06 ft (2:15 PM), and the Kinney washes stay under 0.03 ft (dry by the map's rule).
- **Dry cells with no stored water surface.** Early in the Gates run, some dry route cells have depth 0 and a blank water surface (SFINCS writes none before water arrives). They read as no water, not as a missing result.
- **Crossings scoreboard.** Each crossing's own route point gives the exact water surface, minus the lidar road surface at that point (or the bridge deck). A cell with under 0.03 ft of water counts as no water, because its "water surface" is only the cell's ground. The 100 m runs keep their old rule (the lowest road within 100 m), which would compare a 6.25 m cell with road 100 m away.
- **3D.** Water is painted from a depth picture of the drawn cells: about 7.8 m pixels on High and Ultra, 15.6 m on Low and Medium. Each pixel's depth is the stored water over its area. It starts at 0.03 ft, like the 2D key. Only the part inside the 3D view’s 32 × 35 km terrain is drawn: all three areas reach past its edges (Gates mostly lies south of it). The 2D map shows all of it.
- **Not drawn.** The run's own rain (HRRR 14Z) and river inflows are inside 120 MB NetCDF input archives, not in the display package. Rain and river readouts are off for this scenario, and HAND uses the NWM 13Z flows already in `run-flows/13z.json`.

Measured Nov 3, 2026 (installed Chrome, this PC, `python -m http.server`):
- Phone (emulated Pixel 7, throttled to 9 Mbit/s and 150 ms): the scenario opens in 2.1 s (package.json, route-points.json and three cell files, about 1 MB uncompressed; GitHub Pages compresses the JSON to about 0.25 MB). The next frame arrives in 0.36 s.
- 2D heap: about 60 MB after opening, about 90 MB after playing.
- 3D: ready in 8.5 s on Ultra (full cells) and 3.9 s on Low (web cells). The JavaScript heap is 64 MB more than the 13Z river-strip run on Ultra, and 27 MB more on Low. Frames run at the display's 60 per second while playing, on this PC's GPU, not a phone's.
- No page errors on desktop or the emulated Pixel 7. Water shows at the Brawley Wash dip and around the Sandario dips, where this run's water is mostly a few millimetres to 10 cm.

## Realistic expectations

**What the models are.** "If this forecast comes true, here is where water would collect and
flow." They are not observed water, not road status, and not a promise that a road is open.
Route ratings keep coming from gauges, closures and the app's rules.

**How accurate.** Not measured. Nothing here has been calibrated against real floods, because:
- there is no flood history to check against: the ALERT gauge feed is overwritten every 10 minutes and no history is kept;
- no gauges exist on the Picture Rocks washes, at the Brawley Wash dip or at the Los Robles bridge;
- culverts and bridge openings are not in any model;
- NOAA's National Water Model showed no skill at Brawley Wash in our back-test, and that model feeds both HAND and the live run's river inflow;
- where the Northern and Picture Rocks areas overlap, they disagree by up to 1.46 m of water level at the same place and time.

So read the water as a picture of a scenario, not as depth you can trust at one spot.

**How fresh it can be on free runners.** The free GitHub runners have 2 CPU cores, and a single
job may run for up to 6 hours. Measured run times:

| Model | Time per run |
|---|---|
| Coarse Santa Cruz strip (today's live run) | about 15 minutes, so hourly works |
| Full Gates | about 33 minutes |
| Northern | about 56 minutes |
| Picture Rocks | about 60 minutes (needs a cap above an hour) |

Running all three areas every hour is not possible for free. What is realistic: run all three side
by side **when the forecast shows rain over the area**, a few times a day at most, and keep the
coarse hourly run the rest of the time.

**How heavy for a phone.** The published compact results are about 60 MB of shapes plus about 3 MB
per quarter-hour frame per area. The map's display package (above) is about 40 KB of cells and
about 90 KB per frame per area, with frames loaded one at a time.

## Decisions the owner needs to make

1. **Saved model water in production bridge evidence.** The Codex branch
   `experimental/live-only-bridge-evidence-20261103` removes it; `main` and
   `docs/SIMULATED-CONTENT.md` say to show it. These conflict.
2. **Storm-triggered all-route runs.** Turn them on when the HRRR forecast shows rain over the area?
   They are free, but each takes about an hour.
3. ~~**Gates.**~~ Decided Nov 3, 2026: keep the full Gates run, with the 7.4 km² gap filled from the
   2015 lidar and labelled as mixed-vintage terrain.

## Cheap things that help accuracy later

- **Keep ALERT history.** Archive each 10-minute snapshot instead of overwriting it (`data` branch).
  This costs nothing, and it is the only way to ever check the models against real storms.
- **Use the ALERT sensors already in the feed.** For example, 6023 Santa Cruz at Ina Rd, and the
  rain gauges in the Brawley basin and west Avra Valley.

## Where things are

- Map tab code: `public/map-app.js`, `public/sim-panels.js`, `public/simulation/sim-2d.js`, `public/simulation/hand-runs.js`, `public/simulation/world-layer.js`, `public/preview/geo3d/`.
- All-route run: `public/simulation/all-route-run.js` (loader, 2D painter, 3D picture), `public/simulation/data/all-route-13z/`, `tools/all-route/build_web_package.py`; checks in `test/all-route-run.test.js`, browser checks in `e2e/all-route-check.mjs` and `e2e/all-route-3d-check.mjs`.
- Model runs: `public/preview/geo3d/src/runs.js`; HAND flows: `public/inundation/data/run-flows/` (built by `tools/hand/run_flows.py`).
- Live run: `.github/workflows/live-sfincs.yml` and `tools/live/run_live_sfincs.py` on `experiment/live-sfincs`, publishing to the `live-model` branch.
- All-route model runs and the route-point ledger: `tools/sfincs/data/` on `experiment/sfincs-engine` (start at `all-route-results-v2/README.md` on `claude/all-route-expansion-78d5d4`).
- Error and freeze reports: ntfy topic `washwatch-diag-q7m3x9` (`public/diagnostics.js`).

## Simulator additions (Nov 12, 2026)

- **Storyline** (`public/sim-story.js`, Crossings tab): for the loaded run, when modeled water first goes over each whole road (every road station, `route-prediction.js`) and each listed crossing, the deepest value and when it clears. Same threshold as the scoreboard (more than about 2 in over the road). Tapping a row moves the clock to that frame and the map to that place. A line under the readouts says what is under water at the frame shown. It is off for the live run.
- **Speed**: the player has a 1×, 2×, 4×, ½× button for the 2D map.
- **Soft water**: the 100 m runs are drawn from a one-pixel-per-cell picture with smoothing while a cell is under 14 screen pixels. Closer in, the model's own squares are drawn as before. Colors are the same depth bands as the key, and a tap still reads the cell's own value. The all-route run (6.25 m cells) is drawn as before.

## Live is the all-route model (Nov 12, 2026)

Owner direction: the all-route model becomes the only model on the map. This is step 1 of 3.

1. **Done: Live reads the live all-route runs.** `.github/workflows/live-all-route-web.yml` runs after every live all-route SFINCS run (and by hand). It runs `tools/all-route/build_live_web_package.py`, which reads each area's newest compact result from the `live-model` branch and writes the same display format as the saved run. The live runs use the saved run's meshes, so the builder reuses the saved package's cell files and writes only new water frames. It publishes to the `live-all-route-web` branch, which always holds one commit. The live run starts it: the last job (`map-package`) of `live-all-route.yml` on `experiment/all-route-models` runs this workflow. GitHub's own "run after another workflow" trigger did not fire for runs started by a workflow.
   - The app (2D map and 3D view) loads an area only when its run is at most 3 hours old and still covers now, the same limit as the route ratings. A stale area is left out by name in the run note. Where areas overlap and one is missing, the first area present in the package order draws the place.
   - With no fresh area, or no package, Live shows the 100 m river-strip run as before, and its note starts by saying so.
   - A live package has no rain or river readout and no measured overlap difference; those belong to the 100 m runs and the saved run.
2. **Not done: what-if storms on the all-route model.** The 100-year and 1,000-year storms exist only on the 100 m river strip. They need new forcing for the three areas and a run on GitHub's runners.
3. **Not done: retire the 100 m runs.** Only after 1 and 2 are in place, so no scenario disappears in between. The alert service's coarse fallback (`public/data/road-cells.json`) is part of this step and is unchanged.

