# General-site source audit — November 1, 2026

This inventory records configured evidence, not verified sensor coverage at road level. No crossing sensor was installed or inferred. Thresholds are application heuristics, not official closure thresholds. No new mapping was enabled in this audit.

## USGS identity and units

Official station metadata was checked against the six configured names and approximate WGS84 coordinates. They match at the precision used by the app:

| Station | Official location | Configured role |
|---|---|---|
| [09486500](https://waterdata.usgs.gov/monitoring-location/USGS-09486500/) | Santa Cruz at Cortaro | Regional river-flow indicator |
| [09486520](https://waterdata.usgs.gov/monitoring-location/USGS-09486520/) | Santa Cruz at Trico Road | Regional river-flow indicator; not the configured Trico-Marana crossing itself |
| [09486055](https://waterdata.usgs.gov/monitoring-location/USGS-09486055/) | Rillito at La Cholla | Upstream regional indication |
| [09486350](https://waterdata.usgs.gov/monitoring-location/USGS-09486350/) | Canada del Oro below Ina Road | Tributary indication; not Santa Cruz crossing depth |
| [09487000](https://waterdata.usgs.gov/monitoring-location/USGS-09487000/) | Brawley near Three Points | Remote wash-flow indication |
| [09482500](https://waterdata.usgs.gov/monitoring-location/USGS-09482500/) | Santa Cruz at Tucson | Regional river-flow indication |

The general API query explicitly requests discharge parameter 00060, treated as cubic feet per second. Gage height 00065 is not a discharge substitute. The slim response currently retains time/value/parameter, not approval/qualifier/unit metadata; the public app describes observations as provisional. Unlike historical simulation scoring, the general site cannot claim it excluded every estimated/qualified reading. Metadata pages can be cached and are not evidence of current feed freshness.

## Pima ALERT inventory

The checked-in October 31 county responses identify all nine configured rain sites: 6110 Avra Valley Air Park; 6130 Continental Reserve; 6420 Brawley at Three Points; 6440 Brawley at Milewide; 6460 Picture Rocks Community Center; 6480 Trico north of Manville; 6490 Old Tucson; 6500 Desert Museum; 6520 El Camino del Cerro. Stream site 6443 is **Brawley at Milewide Road**, at approximately 32.248611, -111.244446. It is not a sensor mounted at the Brawley dip or Los Robles bridge. Their downstream hydraulic relationship/travel time has not been verified by this audit.

Evidence: `test/fixtures/alert-currain-2026-10-31.json` and `alert-currentstream-2026-10-31.json`, including station names, coordinates, source IDs and `meta.created`. County feed URLs are [rain](https://alertmap.rfcd.pima.gov/gmap/gmap_files/php/currain.php) and [stream](https://alertmap.rfcd.pima.gov/gmap/gmap_files/php/currentstream.php). Those URLs were inaccessible through the web reading tool in this audit; current live values were not independently fetched or claimed verified.

The adapter interprets county rain arrays as inches in m10/m30/h1/h3/h6/d1/d3/d7/d30 order, flow as cfs and stage as feet. This is the existing feed interpretation; an independently versioned county schema/units specification was not obtained. Preserve this distinction before adding new sensor types. Recorded maintenance flags are JSON booleans. The current scoring excludes maintenance rain/stream readings and missing/invalid amounts; a valid heavy-rain measurement remains evidence even when other windows are missing. County timezone-less timestamps are interpreted as Arizona MST (UTC−7).

## Freshness and cache behavior

- USGS and wash flow: three-hour observation-age cutoff. Rain: existing policy admits readings up to 24 hours old; snapshot time older than 45 minutes is labeled in the explanation. Neither interval is a verified sensor transmission guarantee.
- `SNAPSHOT_STALE_MS` is not a hard rejection gate; its old config comment overstates behavior. Stored readings can be historical evidence, not a newly observed dry condition.
- Five-minute browser refresh; twelve-second read timeout per attempt. Shared service first; direct USGS only for individually missing/invalid gauges without a recent local cache. Valid direct/shared readings are reused for ten minutes. Observation timestamps are preserved and still pass through freshness scoring.
- A partial shared response previously discarded missing peers, and shared readings were not cached. This batch fixes both. HTTP 429 falls back to prior observations without renewing their cache timestamps. There is no automatic retry loop or new scheduler.
- Numeric ratings when sources are unavailable are an existing owner requirement. They must not be interpreted as confirmed clear crossings.

## Next evidence needed

Obtain documented county field units/quality semantics and trace the Los Robles/Brawley connections against a published drainage study before changing their mappings or arrival-time wording. Retain USGS source unit and qualifier fields in a future coordinated feed-schema change, then test both browser and service adapters. This audit intentionally changes neither sensor coverage nor risk thresholds.

## Configured crossing-to-source relationships

The following table is generated from `FAILURE_POINTS`; it documents implementation, not independent hydrologic validation. Rain IDs indicate nearby/regional evidence, not delineated catchment coverage.

| Crossing ID | River USGS | Wash ALERT/USGS | Rain ALERT |
|---|---|---|---|
| brawley-dip | — | 6443, 09487000 | 6110, 6460, 6480, 6440, 6420 |
| elpaso-dip | — | — | 6110, 6460, 6480 |
| clayton-dip | — | — | 6110, 6460, 6480 |
| losrobles-bridge | — | 6443, 09487000 | 6440, 6420, 6460, 6480 |
| sc-trico-marana | 09486520, 09486500 | — | — |
| sc-sanders | 09486500, 09486520 | — | — |
| sc-avra | 09486500 | — | — |
| silverbell-drainage | — | — | 6110, 6480 |
| pr-sandario-pr | — | — | 6460, 6110, 6440 |
| pr-sandario-ina | — | — | 6460, 6110, 6440 |
| pr-sandario-magee | — | — | 6460, 6110, 6440 |
| pr-sandario-emigh | — | — | 6460, 6110, 6440 |
| pr-picture-rocks-wash | — | — | 6130, 6520, 6460 |
| pr-ina-flat | — | — | 6130, 6520, 6460 |
| pr-yuma-mine | — | — | 6130, 6520, 6460 |
| sc-ina | 09486500, 09486350 | — | — |
| pr-twinpeaks-washes | — | — | 6130, 6110, 6460 |
| sc-twinpeaks | 09486500, 09486520 | — | — |
| pr-sandario-south | — | — | 6460, 6500, 6440 |
| pr-kinney-javelina | — | — | 6500, 6490, 6520 |
| pr-kinney-washes | — | — | 6500, 6490, 6520 |
| pr-speedway-washes | — | — | 6500, 6490, 6520 |
| sc-speedway | 09482500 | — | — |
