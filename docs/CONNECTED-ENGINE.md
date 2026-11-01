# Connected app engine

Run `node tools/simulation/serve.mjs --app` and open the main FLOODplain app. Refresh original observations, open **NOAA river forecast**, enable requests, and select **Refresh connected forecast stack**. The same view now loads:

- Official RFC hydrograph and peak (primary prediction).
- NWM target reach and its provider-declared direct upstream reaches, each with its own model reference time, peak, units and source URL. No subtraction is used to invent lateral inflow; no upstream/downstream totals are added together.
- HEFS exceedance spread, preserving stale/unavailable states.
- NWS forecast precipitation accumulations and exact interval endpoints for the grid cell at 32.42,-111.25.
- Both existing HAND junction estimates automatically from the matched RFC forecast.

Follow **Combined route decision**: the same-tab HAND results are consumed automatically alongside the original observation snapshot. Closures still exclude routes. Stale, unsupported and out-of-window model evidence remains context. The imported HAND implementation is unchanged, pinned at `6a0c56ac1bfabb925fad1527c65d9908518723d9`, under `public/simulation/vendor/claude-hand/`, with byte hashes in `PROVENANCE.json`. No HAND branch merge or upstream engine edit occurred. Refreshing this snapshot later is an explicit integration task, not a second HAND implementation.

The forecast download includes the connected engine result and all provider provenance. **Replay connected source snapshot (Trico)** works without external provider requests and never passes its historical HAND result to current route decisions.

```js
import {createIntegratedEngine} from './simulation/integrated-engine.js';
const engine = createIntegratedEngine({enabled: true});
const result = await engine.evaluate({siteId: 'SCTA3'});
// result.official, .nwm, .ensemble, .rainfall, .hand
```

Live recording during this integration returned RFC `ok`, target NWM 15890430 and upstream 15902351/15902363 `ok`, NWS QPF `ok`, both HAND estimates `ok`, and HEFS `stale`. Exact provider response bodies and SHA256 are retained in `data/connected-provider-record.json`; normalized output is `data/connected-stack-record.json`. `node tools/simulation/record-connected-stack.mjs` captures a new explicitly dated snapshot, not a historical forecast reconstruction. It performs only public reads. The existing test suite replays the captured responses without network requests.

## Explicit remaining dependencies

NWS QPF is one approximately 2.5 km grid cell with a returned geographic polygon, not a raster covering the SFINCS domain. It is connected as future-rainfall context, but `solverForcingStatus: unsupported_spatial_coverage` prevents calling it full-domain forcing. An operational solver run needs complete georeferenced forecast precipitation over its domain and valid accumulation intervals; no spatial copying, proration or rainfall model was invented here. Original provider totals, nulls and partial-current-interval flags are retained.

NWM's endpoint returns routed reach flow, not separate lateral inflow. Those distinct components cannot be recovered by naively subtracting hydrographs. HAND currently supports only its two supplied junctions. The existing SFINCS worker owns HydroGeom/channel integration and future solver output; this app does not alter it. Current integration does not resolve the demonstrated peak-flow accuracy failures.

Provider documentation: [NOAA NWPS and NWM](https://water.noaa.gov/about/api) distinguishes NWM guidance from official RFC forecasts; [NWS API](https://www.weather.gov/documentation/services-web-api) documents free forecast grid access and resolution. Actual source URLs/units/issue times are preserved in every result. No paid service, deployment or SMS changes.
