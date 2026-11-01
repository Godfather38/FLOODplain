# Reusable forecast stack and historical evidence

Launch `node tools/simulation/serve.mjs --app`, open `/simulation/forecast.html`, then **Compare all historical issued forecasts and observed errors**. Current official forecasts, ensemble spread, historical issuance comparisons, route evidence and recorded inundation share the existing experimental app. Nothing is merged to main or sent to SMS.

## One stack, with explicit provider boundaries

| Stage | Existing reusable source / implementation | App integration and actual boundary |
|---|---|---|
| Observations and closures | USGS continuous discharge; Pima ALERT and county closure feeds | Original app engine and route-fusion snapshot; closure exclusions remain authoritative. No new sensors required. |
| Rainfall estimates | NOAA MRMS GRIB2; NCEP Stage IV GRIB1 through IEM | Actual decoders and archived forcing already supplied to SFINCS. Stage IV is observed/estimated past precipitation, not a rainfall forecast. Legacy 2014 PNG zero/missing ambiguity prevents treating it as complete forcing. |
| Issued river predictions | NOAA RFC forecasts distributed through NWPS | Primary callable `createForecastEngine().predict()` for Trico, Cortaro and Brawley. Includes flow curve, peak, timestamps, freshness, unavailable states and source units. No custom hydrology needed for these supported gauges. |
| Forecast error evidence | IEM archive of issued RFC HML forecasts + USGS observations | `official-history.html`, all issuances across four fixed windows, exact-time scoring and persistence. Archived HML is processed data, not the original bulletin. |
| Forecast spread | NOAA experimental HEFS | Existing `engine.ensemble()` and UI, exceedance quantiles interpreted in correct direction. Spread is not a locally calibrated accuracy guarantee. |
| Network-scale forecast context | NOAA NWM reach forecasts | Reach IDs already mapped in station configuration. Not currently a connected app forecast provider; must remain named separately rather than replacing/averaging RFC silently. Parent's retrospective evidence indicates large 2014 peak underprediction. |
| Terrain and river connectivity | USGS 3DEP terrain, NOAA/NHD reach identifiers, county studies | Existing solver terrain/subgrid and named gauge-to-reach mapping. A reach identifier alone does not supply surveyed channel conveyance or bridge geometry. Reuse preprocessed network/topography where available; do not derive routing from the coarse 81-point demo. |
| Inundation | Existing NOAA HAND implementation owned by Claude; SFINCS/HydroMT owned by solver thread | HAND export contract accepted by route fusion, not merged here. SFINCS output viewer accepts actual saved outputs. Official FIM absence means unsupported, not dry. Neither historical SFINCS scenarios nor dry HAND cells clear current road hazards. |
| Route decision | Original FLOODplain rules + experimental evidence fusion | `routes.html` consumes original snapshot and HAND export; historical SFINCS is context only. Unknown, stale and conflicting evidence remain explicit. No blind average and no claim of safe passage. |

This is the lowest-cost operational path: use issued RFC hydrographs where supported, existing HEFS spread, existing observations/closures, and compatible inundation products. Local SFINCS is currently a diagnostic extent pipeline, not a proven peak-flow predictor: its small-event failure remains displayed. Rainfall forecasts and automated HAND product delivery are still integration gaps; historical Stage IV cannot stand in for future rainfall. No paid subscription or new infrastructure was introduced.

## Reproduce the comparison

1. `python tools/simulation/fetch_official_forecasts.py` downloads/caches bounded public archive records.
2. `node tools/simulation/score-official-forecasts.mjs` regenerates every issuance/lead score.
3. Open `/simulation/official-history.html`; download source-normalized curves or scores from the page.

Protocol was committed at `5ff2088` before scoring. Windows were selected from existing events plus a fixed June background window, not forecast success. No parameters are fitted. This is retrospective and not blinded. Lead bins are [0,6), [6,12), [12,24), [24,48) hours, positive leads only. Issuances and valid times must lie inside the declared window. Hourly slots clipped by the event boundary are marked separately. Missing/partial archive horizons remain incomplete; no missing prediction is converted to dry weather. Only exact-time approved, unqualified USGS observations are paired. Estimated observations remain in the downloaded data but are excluded from primary metrics. Persistence uses only an observation available at issuance (up to 60 minutes old).

Peak metrics refer to matched samples within the selected lead window, not the instantaneous flood crest. Full issued curves remain downloadable and selectable, including failed predictions. Overlapping issue/lead samples are dependent; counts are not independent storm samples. Four windows do not justify a universal ± accuracy interval.

Source service documentation: https://mesonet.agron.iastate.edu/cgi-bin/request/hml.py?help (archive begins 2012; requests are within one UTC year). Raw CSV and background USGS JSON are retained under `tools/simulation/data/official-forecasts/`; normalized output includes URLs, retrieval metadata and SHA256. Existing USGS event fixtures retain original raw records and provenance. The RFC archive explicitly labels discharge **kcfs**, converted by 28.316846592 to m³/s; USGS ft³/s by 0.028316846592.

NOAA HydroTools is a reusable option for broader event/metric and NWM ingestion work: https://github.com/NOAA-OWP/hydrotools . The present browser app uses its existing small JavaScript contract and deterministic exact-match arithmetic; no new Python dependency stack or replacement hydrologic solver was installed merely for scoring.

### Recorded all-issue comparison outcome

The complete, non-event-truncated lead windows yield the following pooled matched-sample RMSE (m³/s). These include overlapping issuances, so sample counts are not independent observations, and they are not ± accuracy ratings:

| Fixed window | Trico RMSE / pairs | Cortaro RMSE / pairs |
|---|---:|---:|
| July 2013 | 9.14 / 47 | 7.15 / 47 |
| June 2014 background | 0.00 / 66 | 0.86 / 66 |
| August 2014 | 10.59 / 305 | 8.03 / 305 |
| September 2014 | 110.47 / 125 | 125.83 / 166 |

All partial windows and every issuance are retained in the downloadable results; this table only summarizes complete full bins. There are respectively 4, 4, 9 and 6 archived issuances per station. July's archive cannot support complete evaluation of every requested lead window. Trico's June observed flow is zero in the paired background samples; that success does not establish flood-peak skill. September's poor aggregate errors preclude presenting the later 9500 cfs forecast as proof that the whole system meets a peak goal.

## Connected integration update

The previously listed automatic HAND delivery and NWM context gaps are now connected through `createIntegratedEngine().evaluate()`, on the existing forecast screen. See [CONNECTED-ENGINE.md](CONNECTED-ENGINE.md). NWS QPF is also connected as a precisely scoped single-grid-cell forecast context. Full-domain future-rainfall forcing remains unsupported; no point forecast is broadcast across a basin. The unchanged pinned HAND module is vendored with hashes, not reimplemented or merged wholesale. Current live source results and offline replay are included.
