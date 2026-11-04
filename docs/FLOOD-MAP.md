# The flood map: what it is, what it can do, and what it can't

Written Nov 3, 2026. This is a hobby project that runs on free services (GitHub Pages, free GitHub
Actions runners and public data). This page sets realistic expectations and records what exists.
Keep it current when the map changes.

## What the map shows today (Map tab, branch `experiment/2d-street-map`)

| Layer | What it is | Covers | Source |
|---|---|---|---|
| SFINCS water | A 2D flood model: rain and river flow moving over the ground | Only a strip along the Santa Cruz River (27% of its rectangle). **Not** Avra Valley, Brawley Wash or the Sandario dips. | Our own hourly run (`experiment/live-sfincs`) and four saved runs |
| SFINCS water, all routes | The same model on all eight routes, cells from 6.25 m on the roads up to 100 m, in three separate model areas | Avra Valley, Brawley Wash, Picture Rocks, the Sandario dips, Gates (except a 7.4 km² terrain gap) | The saved all-route run "Nov 1 · 13Z all routes" (see below) |
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
| Picture Rocks (`picture-rocks-result-41382872468`) | Picture Rocks/Ina, Twin Peaks, Picture Rocks/Avra, including the Sandario dips | Stopped at its 60-minute limit: the last frame (07:00 UTC) is missing |
| Gates (`gates-supported-result-41382857288`) | Gates | Partial: 59 of 155 route points fall outside it, 21 of them with no model information of any kind (Sandario south of Golden Gate, Kinney Rd, Gates Pass) |

All three are **one saved run**: the NOAA forecasts issued Nov 1, 2026 (National Water Model 13Z,
HRRR 14Z), covering Nov 1 10 AM to Nov 2 midnight Arizona time, in 15-minute frames.

How it is shown:
- **Display package** `public/simulation/data/all-route-13z/`, built by
  `tools/all-route/build_web_package.py` straight from the published compact results (pinned commit
  `3dce053`). No model was rerun. Two variants per area:
  - *web* (2D map, and 3D on Low and Medium): native cells within 150 m of a route; farther away, cells smaller than 50 m are joined into 50 m blocks whose depth is their total stored water over the block's area (the model's own volume / area rule). 361k + 367k + 145k cells.
  - *full* (3D on High and Ultra): every native cell, 528k + 537k + 212k.
  - Cells are stored as three small integers each (they are UTM squares on a 6.25 m lattice), about 40 KB per area. Frames list only cells with at least 5 mm of water, depth to the millimetre, and are loaded one at a time with two ahead. A frame is about 90 KB (web) or 117 KB (full) per area; all frames of all three areas are 11.7 MB (web) and 15.9 MB (full).
  - **Route points are never changed**: in every frame both variants carry the exact native float32 depth and water surface of each route-point cell, and the builder stops if any of the 23,922 values differs from the area's `route-point-series.csv`. `route-points.json` holds the same exact series for the crossings.
- **Overlap.** The areas are separate models and are never averaged. Where they overlap, one is drawn at each place. By default it is the area built for the nearest route (Northern for Trico, Avra and the Silverbells; Picture Rocks for Ina, Twin Peaks and Picture Rocks/Avra; Gates for Gates). Map layers can instead put one area first. A tap on the 2D map lists every area's value at that spot. A crossing in two areas (Santa Cruz at Avra Valley Rd) shows both in the scoreboard and in the 3D crossing card.
- **Picture Rocks 12:00 AM frame.** It does not exist, because the run stopped at its 60-minute limit. That frame draws nothing for Picture Rocks. Its outline turns red and dashed, a label says why, and its crossings read "No result for this frame".
- **Gates gap.** The 7.4 km² terrain gap is drawn hatched with a label. The three app crossings in it (Sandario south of Golden Gate, both Kinney Rd ones) are listed as in the gap, not modelled.
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
| Gates | about 15 minutes |
| Northern | about 56 minutes |
| Picture Rocks | over 60 minutes (hit its cap) |

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
3. **Gates.** Leave the 59 points labelled as not modelled, or fetch the missing 7.4 km² of terrain
   (USGS 3DEP, the same lidar the other areas use) and rerun Gates?

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
- All-route model runs and the route-point ledger: `tools/sfincs/data/` on `experiment/sfincs-engine` (start at `all-route-results-v1/README.md`).
- Error and freeze reports: ntfy topic `washwatch-diag-q7m3x9` (`public/diagnostics.js`).
