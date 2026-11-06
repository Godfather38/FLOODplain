# Live high-resolution road summary

`run_live_all_route.py export` writes `road-forecast.json` beside every case's
compact frames. `manifest.json.roadForecast` binds its SHA-256 and byte count.
The existing publisher copies it with the compact package. No published app or
main branch is changed by this exporter.

## Input and spatial binding

`road-stations/routes.bin.gz` is an 85,021-byte derivative of the published
app's route height tile. Only two missing Gates road heights have been recovered
from measured USGS 2021 pixels. All 66,483 previously valid heights, coordinates,
station distances and original header metadata remain unchanged.
`road-stations/source.json` pins the corrected hash and counts; `baseSource`
retains the original hash, source commit, path and source manifest hash. Its
`repairs` entry binds the evidence and raw source-pixel window. See
`road-stations/repairs/README.md` for the exact source, method and backfill guard.
The tile has centimeter-quantized
NAVD88 lidar-derived road elevations, lidar bridge decks, approach-estimated decks
and explicit missing-height flags. Its original provenance and attribution are
included in each summary. Only route lines are used, not the tile's freeways.

Each station is tested against the actual native quadtree polygon in the pinned
compact geometry. The lookup does not substitute nearest cells or use a polygon's
bounding box as proof of coverage. A point on multiple faces is ambiguous. Output
quantities use the existing checked output-to-source-face mapping, in exactly the
same order as the compact geometry and frames.

- Northern owns `trico`, `avra`, `silverbell-north`, `silverbell-south`.
- Picture Rocks owns `pr-ina`, `pr-twinpeaks`, `pr-avra`.
- Gates owns `pr-gates`.

## JSON contract, version 1

The top level has `schemaVersion: 1`, `kind: "live_all_route_road_forecast"`, `case`,
`runId`, `modelVersion`, `executionMode: "live_current_forcing"`, `status`,
`issuedAt`, `hrrrCycle`, `validFrom`, `validTo`, `times`, `routes`, `dryThresholdM`,
`quantity`, `provenance`, `uncertainty`, and `limits`.

`times` contains increasing UTC ISO timestamps. Each route's `frames` has exactly
one entry per time. Valid endpoints match the first and last exported native
frame. Solver completion is independent of road coverage: `status` is `partial`
when the solver did not finish. The source forecast cycle is retained separately
from export time; a newly exported old run is not a fresh weather forecast.

`routes[routeId]` contains these station counts:

- `totalStations`: every route station, including unknown heights and outside points.
- `mappedStations`: known height and exactly one native face.
- `unknownHeightStations`: unknown road/deck height, regardless of location.
- `outsideStations`: known height but no unique native face, including ambiguity.
- `ambiguousStations`: the ambiguous subset of `outsideStations`.
- `deckLidarStations`, `deckApproachStations`, `untaggedStructureStations`: source
  provenance counts, not mutually exclusive coverage categories.

`mappedStations + unknownHeightStations + outsideStations = totalStations`.

Each frame is `{peakRoadDepthM, validStations, wetStations, lat, lon, deck,
coverage}`. The peak is the maximum of the valid station values, or `null` if
none exist. Coordinates identify the peak station; `deck` is true for either
lidar or approach-estimated bridge decks. Coordinates and `deck` are null when
there is no valid station. `wetStations` counts values at least 0.0091 m.

Depth comes from native volume / full native polygon area. A finite, nonnegative
native depth below 0.0091 m proves that cell is dry even if its water surface is
missing. Otherwise both native depth and water surface must be finite. Road water
is `max(0, waterSurface - roadOrDeckHeight)`, matching the established high-resolution
all-route prediction in `public/simulation/route-prediction.js`. Native cell-average
depth is used for the dry test, not as an upper cap on water above the road. The
average-depth cap documented in `docs/SFINCS-ROUTE-PREDICTION.md` belongs only to
the separate 100 m coarse model. An unknown height,
missing native volume, missing wet-cell water surface, negative volume, outside
station or ambiguous face is unknown, never zero.

Frame coverage is `complete` only when all route stations are valid, `partial`
when some are valid, and `unavailable` when none are valid. A partial frame can
establish a modeled positive water indication but cannot establish a dry route.
Consumers must check source identity, solver completion, forecast age and time
coverage; reject stale or unavailable summaries and retain their fallback.
These are modeled water estimates, not observations or assurances of passage.

## Checks and compact backfill

Run `python -m unittest discover -s tools/live -p 'test_*.py'` with numpy and h5py.
Tests are offline and include missing/dry/wet/partial frames, deck provenance,
exact polygons, shared-boundary ambiguity, checksums, a shuffled native face
mapping and byte-identical live-export/compact-backfill summaries.

For a complete locally materialized live compact package, run
`python tools/live/export_road_forecast.py CASE PACKAGE_DIRECTORY`. It checks
geometry and every frame's hash, run ID, time and geometry binding, and writes
only `road-forecast.json`. It prints its manifest descriptor; it does not change
the existing manifest or publish anything. This path avoids rerunning SFINCS but
requires the package's frames. Future live runs produce the summary directly
without rereading compressed frames or fetching any road inputs.
