# Neighborhood road comparisons (brawley-avra-west), contract v2

The `brawley-avra-west` SFINCS case (model version `all-routes-brawley-avra-west-v1`) compares the
model's water-surface height with the road height on west Avra Valley local roads and along
Brawley Wash. The owner's default decision is **map only**: these comparisons are shown on the Map
tab and are **not** part of route ratings, texts or pushes.

Contract v2 replaces v1 (one 7.2 MB file with every station, fetched every 2 minutes). It splits
the data in two:

| File | Where | Changes | Size (v2 list, 58,140 stations) |
|---|---|---|---|
| Static station list | `public/data/local-roads/brawley-avra-west-stations.json` (ships with the app) | only when the station list is rebuilt | 866,014 bytes (132 KB gzip) |
| Live run | `live-model` branch, `all-route/brawley-avra-west/local-road-forecast.json` | every model run | all-dry run 7.6 KB (3.2 KB gzip); wet test case 491 KB (75 KB gzip) |

The live file lists only stations that are **not plain dry**. Sizes were measured with the real
exporter: all-dry and wet cases on a synthetic grid geometry covering every station (the wet case
has 30 % of cells wet, 10,743 points over and 6,242 below). With the v1 list (31,680 stations)
the static file is 484,629 bytes, an all-dry run 7.9 KB and the wet case 274 KB. The round-1
stand-in (the Gates package read with the v1 stations) gives 1,039,689 bytes (78 KB gzip), because
31,587 of its stations fall outside that other model's cells and are listed as `no-cell`. raw.githubusercontent.com sends
JSON gzip-encoded, so the gzip figures are what a phone downloads.

## Static station list (`kind: floodplain-local-road-station-geometry`, schemaVersion 1)

Made by the exporter in the model branch, never by hand:

```
python tools/live/export_road_forecast.py static brawley-avra-west \
  <app>/public/data/local-roads/brawley-avra-west-stations.json \
  tools/live/road-stations/brawley-avra-west-local-v2.json.gz <sha256 of that file>
```

The bytes are deterministic (same source file, same bytes, from any folder), LF only. Its own
sha256 is the `stationsSha256` every live file carries. Current file: version
`brawley-avra-west-local-v2` (58,140 stations, 571 with no road height: every station in the v2
case domain more than 15 m from a rated route line), sha256
`d8224f1c23768d8a8b4e8444e80da5d9494cfb1db3fffb9ce6c94234de495b50`, from source sha256
`f820259a…ce8c` (road-heights commit `39b34af`). The case registry's `localRoads` entry must
pin this same source file, or every live file will carry another `stationsSha256` and the app
will show nothing, with the "different neighborhood road list" note. Rebuilding the source file
means regenerating this file in the same change.

```
{ "schemaVersion":1, "kind":"floodplain-local-road-station-geometry", "case":"brawley-avra-west",
  "version":str, "roadHeights":"floodplain-road-heights-v1", "datum":"NAVD88",
  "source":{"file","sha256","commit","selection"}, "stationCount":int,
  "flagBits":{"deckLidar":1,"deckApproach":2,"noTerrain":4,"structureUntagged":8},
  "roads":[name…], "kinds":[osm kind…],
  "lines":{"id":["<tile>:<line>"…], "road":[index into roads…], "kind":[…], "start":[first station…]},
  "stations":{"dDm":[…], "dLonE6":[…], "dLatE6":[…], "dZCm":[int|null…]},
  "flags":{"index":[station…], "value":[flag…]} }
```

- Station `i` belongs to the line whose `start` range holds it. Its id is `lines.id + ":" + stationDm`.
- `stationDm`, `lonE6` and `latE6` are running sums of `dDm`, `dLonE6` and `dLatE6` from 0 over all
  stations: longitude and latitude rounded to 6 decimal places.
- `roadZCm` is a running sum of `dZCm` over the non-null entries. `null` means no road height
  (`no-road-height`). Heights are bare-earth lidar, not a surveyed road or bridge deck.
- `flags` are 0 except at `flags.index`. The stations of a line in order are also its polyline.
- Station order is the source file's order; the live file indexes into it.

## Live file (`kind: floodplain-local-road-forecast`, schemaVersion 2)

```
{ "schemaVersion":2, "kind":"floodplain-local-road-forecast", "case":"brawley-avra-west",
  "modelVersion":"all-routes-brawley-avra-west-v1", "runId":str, "issuedAt":ISO-Z,
  "forecastStart":ISO-Z, "forecastEnd":ISO-Z, "status":"ok"|"partial",
  "datum":"NAVD88 metres", "roadHeights":"floodplain-road-heights-v1",
  "stationsSha256":hex, "stationsVersion":str, "stationCount":int,
  "inflowSource":{"summary":str, "inlets":[{"reachId","source","nwmProvider","usgsSite"?,"usgsStatus"?,"provisional"?}],
                  "description":str|null, "notes":[str]},
  "executionMode", "hrrrCycle", "frames":int, "dryThresholdM":0.0091,
  "summary":{"stations","over","below","dry","noRoadHeight","noCell","unknown"},
  "stateCodes":["over","below","unknown","no-cell"],
  "listed":{"index":[int], "state":[code], "maxWseCm":[int|null], "maxOverCm":[int|null],
            "firstOverMin":[int|null], "cellSizeM":[num|null], "unknownFrames":[int|null]},
  "definition", "provenance", "limits" }
```

- `listed` holds every station that is not plain dry and has a road height, sorted by `index`
  (into the static list). `state` is an index into `stateCodes`.
- A station **absent** from `listed` that has a road height is `dry`: known dry in every frame of
  the run. A station with no road height comes from the static list (`roadZCm` null) and is never
  listed.
- `maxWse` is the highest cell water-surface elevation `zs` over the frames where the native cell
  is wet. The comparison is `zs` against the road height; average cell depth is never used as
  road depth.
- Centimetres, rounded up so water is never understated: `maxWseCm = ceil(maxWse × 100)` and
  `maxOverCm = maxWseCm − roadZCm` exactly. The state is authoritative. An `over` station always
  has `maxOverCm ≥ 1` (water 0.2 mm above the road is 1 cm, never 0). A `below` station has
  `maxOverCm ≤ 0`.
- `firstOverMin` is minutes after `forecastStart` when water first rises above the road (`over` only).
- `unknown`: the cell was never wet where readings exist, but at least one frame had no valid
  reading (`unknownFrames ≥ 1`). It is never shown as dry. `no-cell`: the point is in no active
  model cell, or on a shared cell edge; all values are null.
- `status`: `ok` when the package and the solver both finished, otherwise `partial`. The
  publishing workflow's verifier only accepts `ok`, so a `partial` file is not published today;
  the app still handles one.
- `inflowSource` summarizes where the inflows came from. It uses the package's per-inlet
  `inflowSource` (NWM, or an observed USGS gauge for past hours plus NWM) when there is one, else
  the NWM providers. A package that records neither says `not recorded in this package`.

The exporter (`tools/live/export_road_forecast.py local CASE COMPACT_DIR OUTPUT [STATIONS SHA]`)
writes it. `tools/live/verify_all_route_package.py` rebuilds the static list from the registry's
pinned station file and rejects a live file whose `stationsSha256`, counts or summary disagree.

## How the app reads it (`public/simulation/local-road-forecast.js`)

- The static list is fetched once with normal caching. It is a same-origin file, so the service
  worker keeps it for offline use. The app hashes the exact bytes it received (SHA-256). A failed
  load is tried again on the next cycle.
- The live file is fetched like the route summaries: `cache: 'no-store'`, a 15 s timeout, and a
  `?t=` cache-buster that changes every 2 minutes. When `runId`, `issuedAt`, `status` and
  `stationsSha256` are unchanged, the loaded comparison is kept as is: no rebuild and no redraw.
  A true conditional download (ETag/`If-None-Match`) is not possible from the browser here.
  raw.githubusercontent.com answers the CORS preflight that a custom `If-None-Match` header needs
  with 403 (checked 2026-11-08). The rotating cache-buster also defeats the browser's own
  revalidation. The live file is now small, so this costs little.
- Freshness rules are unchanged: `issuedAt` at most 3 hours old (`LIVE_MAX_AGE_MS`) and at most
  5 minutes in the future, and the current time inside `forecastStart`..`forecastEnd`. The check
  runs again each time the map reads the data.
- Whole-file rejection (nothing drawn, an honest note in the model line, never dry):
  - wrong header, times or `status`;
  - the station list not loaded;
  - `stationsSha256` or `stationCount` different from the static list. The note says the run was
    computed for a different neighborhood road list than this version of the app has;
  - `listed` not columnar, an index unsorted, repeated or out of range, an unknown state code, or a
    no-height station listed;
  - `summary` different from the counts implied by `listed` and the static list. This also catches
    a station dropped from the list, which would otherwise turn into "dry".
- Per-station rejection: a listed station whose values contradict its state is dropped and
  counted as unreadable. It is not drawn and not offered as dry. For example, `over` with
  `maxOverCm < 1` or not equal to `maxWseCm − roadZCm`, or `unknown` with a water height.

## What the map shows

On the Map tab, with the live run and the SFINCS water layer on:

- `over` (blue), `below` (light blue) and `unknown` (grey dashed ring) stations are drawn as small
  points (`.local-road-pin`, `.local-road-over|below|unknown`). Dry, no-height and no-cell
  stations are not drawn. A tap within 25 m of any station shows its line.
- Popup lines:
  - "Model: water about 1.0 ft (0.31 m) above this road at its highest. Water first reaches above
    the road around Sun, Nov 1, 2 PM MST."
  - "Model: water stays below this road. …"
  - "Model: no water here in this run." In a partial run: "Model: no water here in the hours this
    partial run covers."
  - "Model: unknown here. Some model readings are missing for this point, so it is not shown as dry."
  - Or that there is no road height or no model cell.
- Below the line: the road and highest water heights (feet, NAVD88), the cell size, the number of
  missing model times for an unknown point, a bridge note when the deck flags are set, the run
  time, and that the comparison uses bare-earth lidar and is not part of the route scores.
- A partial run adds "Partial model run: some forecast hours are unavailable." to the popup and
  to the model line under Map layers. This follows the app's other partial-run wording ("partial
  saved run … hours unavailable").
- The model line adds one sentence, for example "Neighborhood roads (west Avra Valley): model
  water above 6 of 20 road points; 2 unknown (missing model readings) in the run issued Nov 1,
  6:50 AM MST. Map only." When nothing can be shown it says "not shown." and gives the reason.

The contract has no peak time, so the popup gives the first time water is above the road.

## App and alert service consistency

The alert service (`apps-script/Code.gs`, bundled as `apps-script/WashWatch.gs`) does **not**
consume local roads. Nothing here changes `public/road-forecast.js` (`ALL_ROUTE_CASES`,
`mergeRoadForecasts`, `levelFor`), `public/engine.js`, route ratings, alerts or the service
bundle, so the app and the service still give the same route ratings. If the owner later wants
local roads in alerts, both the app and the service have to read the same files in the same way
first.

## Known limits

- Points are SVG circle markers. A very wet run (the wet test case has 16,985 over or below points)
  draws thousands of markers and may be slow on a phone. A canvas renderer would fix that, but
  the browser test finds points by their SVG class.
- The app was checked against real exporter output on synthetic geometry, not against a real
  brawley-avra-west run; none exists yet.

## Tests

- `test/local-road-forecast.test.js` uses `test/fixtures/local-road-stations-sample.json` (20
  synthetic stations, made with the exporter's own encoder) and
  `test/fixtures/local-road-forecast-sample.json` (6 over, 4 below, 3 dry, 2 unknown,
  3 no-road-height, 2 no-cell; not model output). It also checks that the shipped static list
  parses: 58,140 stations, 571 with no height, under 1.5 MB, LF.
- `e2e/smoke.mjs` serves both fixtures with the times shifted to now. It expects 12 points
  (6 + 4 + 2 unknown), the popup wording and the model line. A missing live file draws nothing
  and the line says so.
- Model side: `tools/live/test_local_road_forecast.py` covers the static round trip and
  determinism, all-dry runs listing nothing, unknown never dry, rounding (never 0 for `over`), the
  partial status, the inflow summary, and export through verification.
