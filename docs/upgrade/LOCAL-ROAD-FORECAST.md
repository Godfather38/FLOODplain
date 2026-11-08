# Neighborhood road comparisons (brawley-avra-west)

The `brawley-avra-west` SFINCS case (model version `all-routes-brawley-avra-west-v1`) compares the
model's water-surface height with the road height on west Avra Valley local roads and along
Brawley Wash. The owner's default decision is **map only**: these comparisons are shown on the Map
tab and are **not** part of route ratings, texts or pushes.

## Where the app reads it

`https://raw.githubusercontent.com/Godfather38/FLOODplain/live-model/all-route/brawley-avra-west/local-road-forecast.json`

This is the same live-model location as the route summaries (`ALL_ROUTE_LIVE` in
`public/road-forecast.js`). The loader in `public/simulation/local-road-forecast.js` uses the same
rules as the route summaries in `public/simulation/live-road-forecast.js`:

- `cache: 'no-store'`, a 15 s timeout, and a `?t=` cache-buster that changes every 2 minutes;
- freshness: `issuedAt` no more than 3 hours old (`LIVE_MAX_AGE_MS`) and no more than 5 minutes in
  the future, and the current time inside `forecastStart`..`forecastEnd`. The check runs again every
  time the map reads the data, so a comparison drops off the map when it goes stale.

## File contract (shared with the exporter; field names fixed)

```
{ "schemaVersion":1, "kind":"floodplain-local-road-forecast", "case":"brawley-avra-west",
  "modelVersion":"all-routes-brawley-avra-west-v1", "runId":str, "issuedAt":ISO-Z,
  "forecastStart":ISO-Z, "forecastEnd":ISO-Z, "datum":"NAVD88 metres",
  "roadHeights":"floodplain-road-heights-v1",
  "stations":[{"id":str, "road":str, "lon":num, "lat":num, "roadZ":num|null, "cellSizeM":num|null,
               "maxWse":num|null, "maxOver":num|null, "firstOverTime":ISO-Z|null,
               "state":"over"|"below"|"dry"|"no-road-height"|"no-cell", "flags":int}],
  "summary":{"stations":int,"over":int,"below":int,"dry":int,"noRoadHeight":int,"noCell":int} }
```

- `maxWse`: the highest cell water-surface elevation `zs` over the forecast frames where the cell is
  wet. `maxOver = maxWse - roadZ` (positive means water above the road).
- `over`: wet and `maxOver > 0` (with `firstOverTime`). `below`: wet but `maxWse <= roadZ`.
  `dry`: the cell is never wet in the window. `no-road-height`: no lidar height (flag `noTerrain`).
  `no-cell`: the station is not in an active model cell.
- `flags` come from the area tiles of `floodplain-road-heights-v1`: `deckLidar 1`,
  `deckApproach 2`, `noTerrain 4`, `structureUntagged 8`.
- Only stations outside the three live route domains (northern, picture-rocks, gates) and inside the
  new case are listed. The existing cases keep every station inside their domains.

## How the app checks it

`parseLocalRoadForecast(file, now)` returns `ok`, `stale` or `unavailable`:

- the header must match exactly (schema, kind, case, model version, datum, road-height package,
  run id, ISO times ending in `Z`, `forecastEnd` after `forecastStart`);
- `summary` must match the stations' own state counts, or the file is treated as malformed;
- each station is checked against its own state (for example `over` needs a road height, a water
  height, a positive `maxOver` equal to `maxWse - roadZ` and a `firstOverTime`; `dry` needs a road
  height and a cell but no water height). A station that contradicts its state, or repeats an id, is
  dropped and counted as unreadable. Nothing is filled in.

A file that is missing, stale or malformed draws nothing and the map's model line says
"Neighborhood roads (west Avra Valley): not shown." with the reason. Missing is never shown as dry.

## What the map shows

On the Map tab, with the live run and the SFINCS water layer on:

- `over` and `below` stations are drawn as small points (`.local-road-pin`); other states are not
  drawn, to keep the map clear, but a tap within 25 m of any station shows its line;
- the popup gives the road name and one plain line, for example
  "Model: water about 1.0 ft (0.31 m) above this road at its highest. Water first reaches above the
  road around Sun, Nov 1, 2 PM MST." or "Model: water stays below this road.", "Model: no water here
  in this run.", or that there is no road height or no model cell. It then gives the road and highest
  water heights (feet, NAVD88), the cell size, the run time, and that the comparison uses bare-earth
  lidar, not a surveyed road or bridge deck, and is not part of the route scores;
- the model line under Map layers adds one sentence with the count of points with water above the
  road and the run time.

The contract has no peak time, so the popup gives the first time water is above the road, not the
time of the peak.

## App and alert service consistency

The alert service (`apps-script/Code.gs`, bundled as `apps-script/WashWatch.gs`) does **not**
consume local roads. Nothing here changes `public/road-forecast.js` (`ALL_ROUTE_CASES`,
`mergeRoadForecasts`, `levelFor`), `public/engine.js`, route ratings, alerts or the service
bundle, so the app and the service still give the same route ratings. `npm run build:gas` produces
no diff. If the owner later wants local roads in alerts, both the app and the service have to read
the same file in the same way first.

## Tests

- `test/local-road-forecast.test.js` with `test/fixtures/local-road-forecast-sample.json`
  (20 synthetic stations covering every state; not model output).
- `e2e/smoke.mjs`: the fixture, shifted to the current time, draws 10 points and the popup wording;
  a missing file draws nothing and the model line says so.
