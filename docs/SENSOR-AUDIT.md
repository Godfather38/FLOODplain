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

The checked-in October 31 county responses identify all nine configured rain sites: 6110 Avra Valley Air Park; 6130 Continental Reserve; 6420 Brawley at Three Points; 6440 Brawley at Milewide; 6460 Picture Rocks Community Center; 6480 Trico north of Manville; 6490 Old Tucson; 6500 Desert Museum; 6520 El Camino del Cerro. Stream site 6443 is **Brawley at Milewide Road**, at approximately 32.248611, -111.244446. It is not a sensor mounted at the Brawley dip or Los Robles bridge. The follow-up below establishes the regional Brawley-to-Los Robles connection; transfer time and crossing hydraulics remain unverified.

Evidence: `test/fixtures/alert-currain-2026-10-31.json` and `alert-currentstream-2026-10-31.json`, including station names, coordinates, source IDs and `meta.created`. County feed URLs are [rain](https://alertmap.rfcd.pima.gov/gmap/gmap_files/php/currain.php) and [stream](https://alertmap.rfcd.pima.gov/gmap/gmap_files/php/currentstream.php). Those URLs were inaccessible through the web reading tool in this audit; current live values were not independently fetched or claimed verified.

The adapter interprets county rain arrays as inches in m10/m30/h1/h3/h6/d1/d3/d7/d30 order, flow as cfs and stage as feet. The follow-up county documentation below confirms inches and cfs. A versioned JSON schema for array order and quality fields was not obtained. Preserve this distinction before adding new sensor types. Recorded maintenance flags are JSON booleans. The current scoring excludes maintenance rain/stream readings and missing/invalid amounts; a valid heavy-rain measurement remains evidence even when other windows are missing. County timezone-less timestamps are interpreted as Arizona MST (UTC−7).

## Freshness and cache behavior

- USGS and wash flow: three-hour observation-age cutoff. Rain: existing policy admits readings up to 24 hours old; snapshot time older than 45 minutes is labeled in the explanation. Neither interval is a verified sensor transmission guarantee.
- `SNAPSHOT_STALE_MS` is not a hard rejection gate; its old config comment overstates behavior. Stored readings can be historical evidence, not a newly observed dry condition.
- Five-minute browser refresh; twelve-second read timeout per attempt. Shared service first; direct USGS only for individually missing/invalid gauges without a recent local cache. Valid direct/shared readings are reused for ten minutes. Observation timestamps are preserved and still pass through freshness scoring.
- A partial shared response previously discarded missing peers, and shared readings were not cached. This batch fixes both. HTTP 429 falls back to prior observations without renewing their cache timestamps. There is no automatic retry loop or new scheduler.
- Numeric ratings when sources are unavailable are an existing owner requirement. They must not be interpreted as confirmed clear crossings.

## Next evidence needed

Use the follow-up sources below for the confirmed regional connection and units; obtain current crossing hydraulics and a versioned county quality-field schema before changing mappings or arrival-time claims. Retain USGS source unit and qualifier fields in a future coordinated feed-schema change, then test both browser and service adapters. This audit intentionally changes neither sensor coverage nor risk thresholds.

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

## Follow-up: authoritative drainage and county reporting evidence

Verified November 1, 2026. The county-hosted [FEMA Flood Insurance Study, Volume 1, September 28, 2012](https://oldcms.pima.gov/UserFiles/Servers/Server_6/File/Government/Flood%20Control/Services/Flood%20Hazard%20Map%20and%20Information/FEMA%20Flood%20Insurance%20Study/fisvolume1of5.pdf#page=24), printed page 18, describes Brawley flowing north through Avra Valley into Los Robles and then the Santa Cruz; Blanco joins Los Robles from the west. It describes the washes as braided and poorly defined. This supports a **regional upstream connection**, not a proximity-only association. It does not establish today's flow split, loss, travel time, depth, or passability at either configured road crossing. Preserve those as unknown rather than inferring them from remote discharge. The study is historical, not verification of current channel geometry.

[Pima County's sensor documentation](https://www.pima.gov/about-alert-system-sensor-data) confirms reported rainfall in inches (1 mm tipping increments) and stream discharge in cubic feet per second, inferred from stage using local surveyed/modelled relationships. Sensors report at least every 12 hours without a change; stream sensors are interrogated every five minutes and report changes of 0.2 feet. Channel deposition/scour can alter the stage-discharge relationship. The site's three-hour freshness cutoff is an application policy, not proof of sensor failure. The exact JSON array order, maintenance/null sentinel contract and per-sensor timing still lack a versioned schema in this audit.

The [county map help](https://alertmap.rfcd.pima.gov/gmap/gmap.html) says its display updates every five minutes and identifies cfs as flow rate at the gauge. Display refresh, sensor transmission, and an observation's timestamp are different clocks. The county describes these data as provisional.

No risk thresholds or gauge assignments were changed. Next location-specific evidence: a current surveyed reach/structure model or paired event hydrographs supporting flow transfer from Milewide/Three Points to the particular Trico crossing. Do not substitute regulatory flood-frequency values for instantaneous crossing thresholds.
