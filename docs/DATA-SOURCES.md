# Data sources and APIs

Every outside service FLOODplain reads, in one place, compiled from the repo's docs and code on
Nov 3, 2026. Add a row whenever a new source is wired in. "Where" names the file that calls it.

## Live, in the app on `main`

| Source | Endpoint | What we get | Cadence | Where |
|---|---|---|---|---|
| USGS Water Data (OGC API) | `https://api.waterdata.usgs.gov/ogcapi/v1/collections/continuous/items` (parameter 00060) | River discharge at the gauges in `USGS_SITES` | Every check; 15-min data | `public/config.js`, `public/engine.js`, `public/gauge-feed.js` |
| Pima County ALERT (RFCD) | Undocumented `currain.php` / `currentstream.php` behind alertmap.rfcd.pima.gov, copied to `https://raw.githubusercontent.com/godfather38/floodplain/data/alert.json` | Rain and stream sensors across the county | Every 10 min (`.github/workflows/alert-snapshot.yml`); the copy is overwritten, no history kept | `tools/snapshot_alert.py`, `public/config.js` |
| Pima County road closures | `services2.arcgis.com/UTBp78iglGpbqp1B/.../Road_Closures_viewPAG/FeatureServer/0` | Barricades: Open, Proceed with Caution or Closed | Every check | `public/config.js`, `public/app.js` |
| Pima County TransView | Through the Apps Script proxy (`?feed=roadevents`); undocumented page methods | Road events and closures | Every check | `apps-script/Code.gs` |
| National Weather Service | `https://api.weather.gov/alerts/active?point=32.41,-111.27` | Active warnings at one point in Avra Valley | Every check | `public/config.js` |
| NOAA NWPS gauges | `https://api.water.noaa.gov/nwps/v1/gauges/<LID>` and `/stageflow` | Official river forecasts for SCTA3 (Trico), CSCA3 (Cortaro), BWTA3 (Brawley) | Every check | `public/inundation/forecast-provider.js` |
| NOAA NWPS reaches | `https://api.water.noaa.gov/nwps/v1/reaches/<id>/streamflow?series=short_range` | National Water Model forecast for any river reach | Every check; NWM short range runs hourly | `forecast-provider.js`, `public/simulation/hand-runs.js` |
| Our Apps Script service | `TEXT_API` in `public/config.js` | Proxies feeds, computes the verdict every minute, sends texts and ntfy pushes | Every minute | `apps-script/` |
| ntfy.sh | `https://ntfy.sh/<topic>` | Push alerts, crossing reports, error and freeze reports (`washwatch-diag-q7m3x9`) | On event | `public/app.js`, `public/diagnostics.js` |

## Map tab and models (experiment branches)

| Source | Endpoint | What we get | Where |
|---|---|---|---|
| NOAA HRRR (AWS open data) | `noaa-hrrr-pds` GRIB2, byte ranges from the `.idx` | Hourly rain forecast, 18 h ahead | `tools/live/run_live_sfincs.py` (experiment/live-sfincs); `tools/simulation/build_current_inputs.py` (experiment/scene-data-inventory) |
| NOAA National Water Model archive (AWS) | `https://noaa-nwm-pds.s3.amazonaws.com/nwm.YYYYMMDD/short_range/` channel_rt | Past forecast cycles for any reach | `tools/hand/run_flows.py` |
| NOAA OWP HAND (CIROH copy) | `ciroh-owp-hand-fim.s3.amazonaws.com` | HAND grids and rating curves for 25 crossing windows | `public/inundation/data/`, `docs/HAND-INUNDATION.md` |
| NOAA MRMS (AWS) | `noaa-mrms-pds` | Observed radar rain | experiment/scene-data-inventory (`docs/RADAR-FIXTURES.md`) |
| NCEP Stage IV (via Iowa Environmental Mesonet) | `mesonet.agron.iastate.edu/iemre/` | Observed hourly rain, past events | experiment/scene-data-inventory (`docs/STAGE4-FORCING.md`) |
| IEM archive of issued RFC forecasts | `mesonet.agron.iastate.edu/cgi-bin/request/hml.py` | Every past official river forecast, for scoring | experiment/scene-data-inventory (`docs/PREFAB-FORECAST-STACK.md`) |
| NOAA HEFS | through NWPS | Forecast spread (ensemble) | `createForecastEngine().ensemble()`, experiment/scene-data-inventory |
| NOAA Atlas 14 (PFDS) | precipitation frequency at 32.40N, 111.15W | 100- and 1,000-year storm depths for the what-if runs | `tools/sfincs/data/stress-storm-v1/`, `extreme-storm-v1/` |
| USGS 3DEP lidar | `tnmaccess.nationalmap.gov/api`, `prd-tnm.s3.amazonaws.com/StagedProducts` | Terrain (Pima County 2021; the Gates model area also uses AZ_Eastern_PimaCO_2015 1 m where 2021 has no data), road and bridge-deck heights | experiment/sfincs-engine, experiment/road-heights |
| Pima County RFCD professional data | `gisdata.pima.gov/arcgis1/rest/services/GISOpenData/FloodControl2/MapServer` | 100-year discharge points, cross-sections, structures, study areas | `docs/sfincs/PREPARED-DATA-ACQUISITION.md` |
| Pima County open data | `gisopendata.pima.gov` | Road intersections (route ledger junctions) | experiment/sfincs-engine ledger |
| FEMA NFHL | hazards.fema.gov | Mapped floodplains; used only in offline checks | `public/inundation/data/checks.json` |
| Overture Maps (OpenStreetMap data) | 2026-10-21.0 release | Route lines and stream crossings | `tools/build_routes.py` |
| Base maps | OpenFreeMap vector tiles, OpenStreetMap tiles, Esri World Imagery | Street map, OpenStreetMap and Satellite map types | `public/street-map.js`, `public/app.js`, `public/preview/geo3d/` |
| All-route SFINCS results (our own saved run) | `tools/sfincs/data/all-route-results-v2/delivery.json` and its three `*-result-*/compact/` packages (Northern 41382880257, Picture Rocks 41745843031, Gates 41750298470) at `2b8c528` on claude/all-route-expansion-78d5d4 | The Nov 1 13Z all-route run, repackaged for display in `public/simulation/data/all-route-13z/` | `tools/all-route/build_web_package.py`, `public/simulation/all-route-run.js` |
| SFINCS and HydroMT-SFINCS (Deltares) | github.com/Deltares/SFINCS at `f3647fc`, HydroMT-SFINCS 1.2.2 | The flood model and its setup tool | experiment/sfincs-engine |

## Known gaps

- No gauge on the Picture Rocks washes, at the Brawley Wash dip or at the Los Robles bridge.
- USGS gauges 09486509 (Avra Valley Rd) and 09486515 (Sanders Rd) no longer report.
- Sanders Rd is a Town of Marana road: its closures are not in the county feed.
- ALERT history is not kept (see `docs/FLOOD-MAP.md`).
- USGS retires its legacy WaterServices API on Feb 22, 2027. The app already uses the new OGC API.
