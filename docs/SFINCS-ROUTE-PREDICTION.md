# SFINCS route prediction

SFINCS is a flood model. It works out where rain and river water go across the ground, hour by hour. FLOODplain uses it to predict flooding on **whole routes**, not only at the listed crossings. Every road on a route gets a flood prediction from the road height data.

## What it does

- **Road heights.** There's a road station every 5 m along every route. Each one has the USGS 3DEP lidar road surface, or the bridge deck where there is one (`public/simulation/data/road-heights/`).
- **Water.** The SFINCS water surface in the model cell holding each station, for every hour of the run. The hourly live run (`live-model` branch) and the saved runs both work.
- **Prediction.** Water surface minus road height is the predicted water over the road. Neighbouring wet stations join into one stretch. Each route gets its deepest point, when that happens and how many stretches are wet.
- **Ratings.** While the live run covers the current time, each route gets one row: "Flood model along this road (SFINCS)". It counts in the route's 1 to 5 number like any other row:

  | Predicted water over the road, highest still in the forecast | Level |
  |---|---|
  | 0.16 ft (5 cm) or less | ok |
  | more than 0.16 ft | caution (3) |
  | 1 ft (30 cm) or more | danger (5) |

  These cut-offs are product choices, not calibrated ones. The owner can change them in `public/simulation/route-prediction.js`.
- **Raises only.** The row can push a route's number up. A dry prediction never lowers a closure, a gauge reading or any other row.
- **Map tab.** The Crossings panel lists every route with water over the road at the hour shown, for whichever run is loaded. On the saved all-route run, which has 6.25 m cells, it checks every low point along each road.
- **When it can't be used.** If the run is older than 3 hours, doesn't answer, or doesn't cover now, the route screen says so in one line. The rating stands on the other sources. It never shows "?".

Code: `public/simulation/route-prediction.js` (app), `public/road-forecast.js` (shared thresholds, and the alert service's copy), wired in by `addSfincs()` in `public/app.js`, `withRoadForecast()` in `public/engine.js` and `routeBoardHtml()` in `public/sim-panels.js`. Tests: `test/route-prediction.test.js` and `test/bundle.test.js`.

## Do not remove it again

The owner asked for this. Removing it, switching it off or reducing it to a picture with no effect on routes is **not allowed**.

### How it was lost (Nov 1–3, 2026)

1. `ea27bb3` (PR #8, Nov 1) added the 2D flood map. Its map code still called `fuseRoutes()`, which turned SFINCS and HAND water at crossings into per-route guidance. But its notes set the rule that started the problem: *"Refined replay does not write current risk results. No solver automation or current predictive-service claim."*
2. `4f2c1d4` (Nov 1) reverted that whole PR. That removed the only call to `fuseRoutes()`.
3. `caeb18e` (Nov 1) brought the map back without that call. It hard-coded `lastFused=null` and the text *"Current route guidance uses the original live conditions engine. Retained SFINCS is dated context and does not override current closures or observations."* `route-fusion.js` stayed in the repo, imported but never run. **This is the update that removed SFINCS route prediction.**
4. Later commits repeated the same idea: `445e139` ("separate from ratings and alerts"), `3d1c866` ("does not change closures, ratings or alerts"), `d91c550` (all-route model points left out), and the reverted road replay (`a6a457e`, "changes to production route scoring" listed as not included).

### The line of thinking that is prohibited

Don't reason like this, in code, comments, docs or commit messages:

- "Model output is context only, so it must not affect route ratings."
- "SFINCS/HAND is simulated, so keep it on the map and out of the routes."
- "Not calibrated / not county-certified / not road-resolved, so leave it out of the risk computation."
- "Keep the existing scoring unchanged" used as a reason to drop a model input the owner asked for.
- Setting the route prediction to `null`, removing its call, or leaving its module imported but never run.

Being honest about the model's limits goes in the **wording** (it's a model forecast, it compares water with lidar road height, these are the run times). It is not a reason to remove the prediction. `docs/SIMULATED-CONTENT.md` already covers how modeled water is identified: one acknowledgement and the wording on screen.

What is still fine: using a run only for the hours it covers, saying when a run is stale or doesn't answer, and never letting a dry prediction lower another source. Those keep the prediction accurate; they don't remove it.

Any change that would reduce what SFINCS route prediction does needs the owner's explicit OK first, in their own words.

## Texts and push alerts

The Apps Script alert service (`apps-script/WashWatch.gs`) uses the same forecast, so texts and pushes give the same number as the app.

- **Small table.** The service can't decode the 5 m road heights every minute. `tools/build_road_cells.mjs` reduces them to `public/data/road-cells.json` (about 18 KB). For each route, it lists every 100 m model cell the road passes through, with the lowest road height in that cell. `tools/build_gas.mjs` builds the table into the script. Re-run both scripts when the road heights or the model grid change.
- **Each check (every 4 minutes).** The service fetches the live run's `manifest.json` and `water.json.gz` from the `live-model` branch, about 14 KB zipped. `roadForecast()` in `public/road-forecast.js` then rates each route. `withRoadForecast()` in `public/engine.js` adds the row, the same way the app does.
- **Same answer as the app.** The lowest road in a cell is where the app's deepest 5 m station is, so the level matches. `test/route-prediction.test.js` checks that on every route.
- **When it can't be used.** If the live run is missing, older than 3 hours, or doesn't cover now, the text still has a number and ends with "(No live flood model data.)".
- **Checking it.** `?feed=roadforecast` on the service shows what it is using right now. `.github/workflows/service-check.yml` prints it and fails if it isn't in use.
- **Deploying.** `.github/workflows/deploy-service.yml` redeploys the script when `public/road-forecast.js` or `public/data/road-cells.json` change. It also runs on the default branch, since `main` doesn't exist yet.

## Roads below the cell's ground

A 100 m cell has one average ground height. Where a road runs through a dip or cut, the road can sit feet below that average (common along Ina). Comparing the cell's water level with the road there would read a barely wet cell as feet of water over the road. In those cells the estimate is the cell's own water depth instead: `min(water surface − road, water surface − cell ground)`. The app and the alerts use the same rule. The 6.25 m all-route run doesn't need it, because its cells sit on the road.

## Limits

- The live run is a 100 m grid. A road on a raised fill in a wet cell reads as dry, which is correct. A road in a small dip inside a mostly dry cell can be missed.
- Gates Pass is outside the live run's model area. It gets no SFINCS row and is rated on the other sources.
