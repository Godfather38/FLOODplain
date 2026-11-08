# NWPS outage response fixtures

The two `nwps-*-20261106.json` files are unmodified public JSON responses fetched
on 2026-11-06 at approximately 08:03 UTC from:

- https://api.water.noaa.gov/nwps/v1/reaches/15902351/streamflow?series=analysis_assimilation
- https://api.water.noaa.gov/nwps/v1/reaches/15902351/streamflow?series=short_range

The short-range response has `shortRange: {}` despite HTTP 200. The analysis
response's reference time is 2026-11-05 20Z and its last point is 23Z. Those are
missing/stalled model inputs, not dry-flow evidence and not a schema rename.
Tests use these files offline and never start a model or publish results.

# USGS gauge fixtures (observed inflow)

- `usgs-nwis-09487000-20261101.json`: the USGS NWIS IV response for 09487000 (Brawley Wash near
  Three Points, 00060) saved in
  `tools/sfincs/data/brawley-avra-west-v1/observed/raw/iv_09487000_2026-11-01.json`, trimmed to the
  25 readings 2026-11-01 11:00 to 17:00 MST (18:00Z to 00:00Z, the rise to the 1,740 cfs peak).
  The `queryURL` was rewritten to the trimmed window; readings and qualifiers are unchanged
  (all `P`, provisional).
- `usgs-ogc-09487000-20261106.json`: the USGS Water Data OGC API `continuous` response for the same
  site, 2026-11-06 00:00Z to 03:00Z, fetched 2026-11-08; `geometry`, `links` and `timeStamp` removed.
  All values are 0.00 ft^3/s, Provisional: a reported zero flow, which is a reading, not missing data.

Tests edit copies of these in memory for gaps, outages, malformed bodies, stale windows and units.
