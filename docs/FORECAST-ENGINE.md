# FLOODplain prediction engine

The single app-facing engine uses the existing **NOAA NWPS official forecast**, not a newly fitted local solver. Supported target: Santa Cruz River at Trico Road, SCTA3 / USGS 09486520 / NWM reach 15890430. It does not predict the Los Robles crossing or bridge collapse. No main deployment, routing integration or SMS is enabled.

```js
import {createForecastEngine} from './simulation/forecast-engine.js';
const engine = createForecastEngine({enabled: config.experimentalForecasts === true});
const forecast = await engine.predict();
// Check status === 'ok' before presenting as a current usable forecast.
```

`predict()` returns UTC flow/stage points, future flow peak and stage peak with times, issue and retrieval times, coverage, original units/provenance, NOAA categories and impact statements, and explicit uncertainty metadata. kcfs is converted by 1000 to cfs then 0.028316846592 to m³/s. Gauge height remains feet. Context thresholds retain their provider units. No thresholds are translated into road clearance or passability.

States: `disabled`, `unsupported`, `insufficient_data`, `expired`, `stale`, `unavailable`, `ok`. Default issue freshness policy is 24 hours (an app policy, not a NOAA guarantee), memory cache five minutes, timeout ten seconds. Failed refresh can include cached points for inspection but remains `unavailable`. Expired forecasts contain no current curve. Unknown units, null values, invalid dates, mismatched station IDs and unsorted samples fail closed. Transport and clock are injectable for a server integration or tests. Browser CORS/network failures are surfaced; no proxy bypass is implemented.

Accuracy ± is `null`, status `not_provided`: this deterministic endpoint supplies no interval and we have not validated archived issued NOAA forecasts against subsequent observations. The frozen 2006/2013 routing hindcasts are internal evidence for a different model and must not be assigned as the NOAA engine's accuracy. Next accuracy work requires paired archived forecasts/observations, lead-time-stratified held-out residuals and interval coverage evaluation. Current supported flow regime is the official provider's issued station forecast; no independently certified local error range is claimed.

Run `node tools/simulation/serve.mjs` from the repository; open `http://127.0.0.1:8081/forecast.html`. Explicitly enable experimental requests then Refresh, or choose the clearly labeled recorded provider response. The UI displays the actual engine output and exports JSON. Recorded response hashes and recording time are in `data/nwps-record.json`. Browser visual/network QA remains unperformed because earlier computer-use access was stopped; pure adapter and transport tests use the real recorded response.

Provider endpoints: https://api.water.noaa.gov/nwps/v1/gauges/SCTA3 and https://api.water.noaa.gov/nwps/v1/gauges/SCTA3/stageflow . Data are attributed to NOAA; forecasts remain provider estimates. The radar/GIS extension is accessible separately and does not silently replace the official forecast when missing.

## Experimental ensemble context

`await engine.ensemble()` retrieves NOAA experimental HEFS QINE/GEFSENS quantiles for SCTA3 separately from the deterministic forecast. The UI provides explicit live and recorded spread controls, its own issuance and coverage, and an independent chart. Source: https://api.water.noaa.gov/hefs/v1/hydrograph-quantiles/?location_id=SCTA3&parameter_id=QINE . Original bytes, recording time and hash are retained in `hefs-scta3-quantiles.json` / `hefs-record.json`.

The source uses **exceedance probabilities**: 90% is the low flow, 50% the median, 10% the high flow. The adapter checks nonincreasing flow with increasing exceedance probability; CFS converts to m³/s. Sentinel -999, null and incomplete quantile rows remain missing; missing rows are counted and not interpolated. Invalid ordering fails. The source's 10–90% exceedance range is ensemble spread, **not calibrated local ± accuracy**, and is never centered around the unrelated deterministic NWPS curve. It does not establish flood probability at individual roads. This uses public existing forecasts and requires no user-owned sensors.

## SFINCS integration boundary

The separately owned SFINCS + HydroMT pipeline can export to `acceptInundationRun()` in `inundation-contract.js`. Required v1 fields: `model: "SFINCS"`, `kind: "inundation_scenario"`, `status: "complete"`, `crs: "EPSG:4326"`, `cells: [{lon,lat}]`, `frames: [{time,depthM:[number|null]}]`, `provenance: {solverVersion,runId,inputArtifacts}`, `support: {domainDescription,limitations:[]}`, and `uncertainty: {status,plusMinus:null}` until independently quantified. Depth arrays align with cells, use metres, and preserve missing as null. Optional frame `flowM3s` requires `flowLocation` naming the section; never infer flow from depth alone. UTC times increase strictly. Export finite depth cells from the solver's projected grid with explicit geographic conversion upstream. The original grid, terrain datum, forcing, boundary conditions, artifact hashes, model configuration and quality checks belong in provenance/input artifacts.

No SFINCS run has been received or executed by this thread. The adapter validates a contract; it does not certify solver results. Keep scenarios distinct from the official gauge forecast. Pending solver integration must not manufacture depth or confidence bounds. Existing public gauges, county studies, flood marks and documented events can support validation without user-owned sensors; identify whether each observation measures this domain directly or is transferred regional evidence.
