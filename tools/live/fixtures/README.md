# NWPS outage response fixtures

The two `nwps-*-20261106.json` files are unmodified public JSON responses fetched
on 2026-11-06 at approximately 08:03 UTC from:

- https://api.water.noaa.gov/nwps/v1/reaches/15902351/streamflow?series=analysis_assimilation
- https://api.water.noaa.gov/nwps/v1/reaches/15902351/streamflow?series=short_range

The short-range response has `shortRange: {}` despite HTTP 200. The analysis
response's reference time is 2026-11-05 20Z and its last point is 23Z. Those are
missing/stalled model inputs, not dry-flow evidence and not a schema rename.
Tests use these files offline and never start a model or publish results.
