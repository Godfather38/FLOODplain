# The flood map: what it is, what it can do, and what it can't

Written Nov 3, 2026. This is a hobby project that runs on free services (GitHub Pages, free GitHub
Actions runners and public data). This page sets realistic expectations and records what exists.
Keep it current when the map changes.

## What the map shows today (Map tab, branch `experiment/2d-street-map`)

| Layer | What it is | Covers | Source |
|---|---|---|---|
| SFINCS water | A 2D flood model: rain and river flow moving over the ground | Only a strip along the Santa Cruz River (27% of its rectangle). **Not** Avra Valley, Brawley Wash or the Sandario dips. | Our own hourly run (`experiment/live-sfincs`) and four saved runs |
| HAND | NOAA's "height above nearest drainage": a quick estimate of where a river at a given flow reaches | 25 windows, 3 km each, around crossings. Washes get water only when the National Water Model has a flow for them. | NOAA OWP HAND grids, NOAA National Water Model flows |
| Rain | The run's own rain input | Whole area | NOAA HRRR forecast, or NOAA Atlas 14 for the what-if storms |
| Live readings, closures, route ratings | Gauges, county closures and the app's route rules | Whole served area | USGS, Pima County ALERT, county closures, TransView, NWS |

## What already exists but is not on the map yet

The `experiment/sfincs-engine` branch has SFINCS run on **all eight routes** at 6.25 m detail, in
three separate model areas (`tools/sfincs/data/`):

| Model area | Routes | State |
|---|---|---|
| Northern (`northern-result-41382880257`) | Trico, Avra, Silverbell north and south, including the Brawley Wash dip | Complete: 57 quarter-hour frames |
| Picture Rocks (`picture-rocks-result-41382872468`) | Picture Rocks/Ina, Twin Peaks, Picture Rocks/Avra, including the Sandario dips | Stopped at its 60-minute limit: the last frame (07:00 UTC) is missing |
| Gates (`gates-supported-result-41382857288`) | Gates | Partial: 59 of 155 route points fall outside it, 21 of them with no model information of any kind (Sandario south of Golden Gate, Kinney Rd, Gates Pass) |

All three are **one saved run**: the NOAA forecasts issued Nov 1, 2026 (National Water Model 13Z,
HRRR 14Z), covering Nov 1 10 AM to Nov 2 midnight Arizona time. They have only been shown as
point readouts, never as maps.

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

**How heavy for a phone.** Each all-route area is about 60 MB of shapes plus about 3 MB per
quarter-hour frame. A phone needs a lighter web version: fewer, larger cells away from the roads,
and frames loaded one at a time.

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
- Model runs: `public/preview/geo3d/src/runs.js`; HAND flows: `public/inundation/data/run-flows/` (built by `tools/hand/run_flows.py`).
- Live run: `.github/workflows/live-sfincs.yml` and `tools/live/run_live_sfincs.py` on `experiment/live-sfincs`, publishing to the `live-model` branch.
- All-route model runs and the route-point ledger: `tools/sfincs/data/` on `experiment/sfincs-engine` (start at `all-route-results-v1/README.md`).
- Error and freeze reports: ntfy topic `washwatch-diag-q7m3x9` (`public/diagnostics.js`).
