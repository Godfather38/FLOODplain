# Experimental rainfall and terrain lab

This is a **local-window demonstrator, not a delineated watershed or validated bridge model**. It lives on `experiment/avra-radar-runoff`. Do not merge/deploy experimental predictions into public routes or alerts. No existing application, SMS, signup, consent, account or service configuration is changed.

## Run without network or dependencies

From the repository root, with Node 22 or newer:

```sh
node tools/simulation/serve.mjs
# Open http://127.0.0.1:8081
node tools/simulation/demo.mjs
node --test test/simulation.test.js
```

First quantitative routing result: open **http://127.0.0.1:8081/routing-result.html**. Reproduce with `node tools/simulation/score-routing.mjs`. The overlay is also `public/simulation/routing-benchmark.svg`; full curves and scores are in `data/routing-benchmark.json`.

This separate gauge-to-gauge milestone uses observed Cortaro input and parameters fitted to earlier floods, frozen in commit `b4c4c1b` before September 2014 scoring. It is not a completed radar-runoff hindcast. The predeclared primary 2006 fit predicts a 15,320 ft³/s peak (+27.7%), 105 minutes early, RMSE 2,514 ft³/s and NSE 0.264. The secondary 2013 fit predicts 15,668 ft³/s (+30.6%), 15 minutes late, RMSE 1,454 ft³/s and NSE 0.754. The unchanged-upstream baseline peaks at 21,200 ft³/s (+76.7%), 540 minutes early, RMSE 5,273 ft³/s and NSE −2.239. All use 273 approved unqualified exact-time samples after a 24-hour warm-up; 16 qualified target samples are excluded. Both frozen models are retained without selecting the better one after scoring. See [the protocol](ROUTING-PROTOCOL.md) for assumptions, event selection and non-blinded retrospective status.

Calibration can be independently rerun with `node tools/simulation/calibrate-routing.mjs 2006` and `node tools/simulation/calibrate-routing.mjs 2013`, but those commands rewrite freeze timestamps. The checked-in frozen files preserve the original pre-scoring decision. The fetch utility supports at most seven days/1,000 samples per request and fails on pagination. Do not extend intervals silently.

The browser opens a synthetic storm over recorded real terrain. Change infiltration, cell travel time or rainfall multiplier, then Run scenario. Inspect elevation, contributing cells or stored volume; move the time slider; download the inputs, parameters and result as JSON. The local preview server binds only to loopback. No external scripts, tiles, application APIs or alert services are requested by the lab.

## What is real, and what is invented

`public/simulation/data/terrain.json` records 81 USGS 3DEP EPQS responses on a 9 × 9 grid, approximately 250 m spacing around 32.43882, -111.30426 (Los Robles Wash / Trico, north of El Tiro). Each cell includes the original response, source URL, acquisition metadata when supplied, and a dataset retrieval timestamp. Coordinates are EPSG:4326; elevations are metres. Do not infer a uniform acquisition date or vertical datum from the endpoint: confirm source DEM metadata before hydrologic use. Horizontal spacing uses a local latitude/cosine approximation, not a projected survey grid. The represented square-cell area is 5.0625 km²; sample centers span approximately 2 km each direction.

**The center crossing cell is an unresolved pit in this coarse sample.** The lab deliberately retains inflow there instead of fabricating a culvert/channel connection. Gold cells show the 29-cell local contributing set (1.8125 km²), not the actual Los Robles basin. The blue hydrograph is runoff arriving in that sample cell, including its local rainfall excess. It is not bridge discharge. Exported crossing outflow is separately reported and is zero for this pit. Boundary outflow is a separate accounting location and must not be added to crossing inflow.

Default rainfall is an invented 30-minute pulse with an east-west intensity gradient; its July 1 UTC timestamp is an arbitrary replay clock. It is **not a historical storm, radar measurement, forecast or live feed**. No real MRMS rainfall fixture has yet been validated. Importer tests use clearly synthetic CSV strings.

## Model and units

1. D8 drainage chooses the steepest positive elevation gradient among eight neighbors; diagonal distance is multiplied by √2. Strict descent gives an acyclic network. Flats/interior pits retain water; boundary minima discharge outside the clipped window. There is no depression filling or external upstream inflow.
2. Each interval supplies rainfall rate `P` in mm/h. Rainfall excess is `max(0, P - f)` for a constant, spatially uniform infiltration capacity `f`. Volume is `rate × dt_hours × cell_area_m2 / 1000`. There is no soil moisture state, channel transmission loss, evaporation, groundwater or baseflow.
3. Each cell is a conceptual linear reservoir. After adding local excess, it releases `S × (1 - exp(-dt / K))`, where `K` is the user-selected cell travel time in minutes. Transfers are synchronous; incoming upstream flow is available to the next step. One-minute steps split at rain interval boundaries. `K` is constant, including diagonal links; it is not derived from channel hydraulics or slope.
4. The model drains for a 180-minute dry tail. Retained and undrained water remains in the balance. It verifies `rain = infiltration + boundary discharge + final storage`, to floating-point tolerance. Crossing inflow is internal transfer and is not subtracted again.

`crossingM3s` in schema 1 means **crossing-cell inflow**, including local excess. `crossingOutflowM3s` means its released outflow; `boundaryM3s` sums releases out of the window. Series timestamps are interval ends (`start + minute`). Storage is cubic metres, never a water depth. The multiplier is a sensitivity scenario, not a statistical confidence bound. A rain multiplier other than 1 modifies observations into a scenario.

The equations are conventional conceptual reservoir accounting, not a newly validated hydrologic solver. They make a small reproducible pipeline available for future replacement by an established calibrated model.

## Import NOAA MRMS rainfall estimates

NOAA documents `PrecipRate` as instantaneous radar precipitation rate in **mm/h**, typically every two minutes. The importer accepts cropped `wgrib2 -csv` output for that named field only. It rejects hourly QPE accumulations, missing/no-coverage flags, invalid units/values, non-analysis times, duplicate pixels, gaps and overlaps. It refuses unrecognized field aliases rather than guessing a unit conversion.

Obtain a small contiguous event sequence from the official [MRMS data access page](https://www.nssl.noaa.gov/projects/mrms/MRMS_data.php). This prototype does not automatically download CONUS GRIB files. When already available locally, use an installed official wgrib2 to crop each input before CSV export, for example:

```sh
wgrib2 local-PrecipRate.grib2 -undefine out-box 248.67:248.72 32.42:32.46 -csv local.csv
node tools/simulation/import-radar.mjs local.csv https://mrms.ncep.noaa.gov/data/CONUS/PrecipRate/ rainfall.json
```

Combine successive two-minute records into one CSV (no header). Record the exact original filenames/event URLs alongside the output; the command's source argument is retained verbatim. Do not relabel another product to make it pass. The importer requires the CSV field `PrecipRate` or `MRMS_PrecipRate`; wgrib2 installations lacking MRMS tables may need official table support before export. **The full GRIB → real CSV → replay path remains unverified.**

Load `rainfall.json` in the lab. Every terrain cell uses the nearest radar pixel within 850 m; the rate is held forward for two minutes. This is a temporal approximation, not a measured two-minute accumulation. Spatial values are copied, not downscaled: a 250 m terrain grid does not create 250 m radar resolution. Limits are 8 MB import, 720 intervals, 24 hours, and 500 mm/h. Data outside these bounds fail explicitly. Missing rain is never substituted with zero. The grid coordinate list must match terrain exactly.

Normalized JSON: `schemaVersion:1`, `kind:"synthetic"|"radar-estimate"`, `units:"mm/h"`, `source`, `grid:[[lon,lat],...]`, and `frames:[{start:UTC_ISO_Z,durationMinutes,rates:[...]}]`. Frames are contiguous and rates follow row-major terrain order. `syntheticRain(terrain)` provides a complete example. The importer and model are pure modules independent of the UI.

## Data provenance, access and reuse

- [USGS EPQS accuracy and resolution](https://www.usgs.gov/faqs/how-accurate-are-elevations-generated-elevation-point-query-service-national-map): point elevations are interpolated from available 3DEP sources; sampling at 250 m cannot resolve bridge decks, culverts or wash channels.
- [USGS copyrights](https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits): USGS-produced data are U.S. public domain. Credit U.S. Geological Survey. No USGS logos used.
- [NOAA MRMS product table](https://www.nssl.noaa.gov/projects/mrms/operational/tables.php): rate units, update cadence and missing flags.
- [Official wgrib2 CSV documentation](https://www.cpc.ncep.noaa.gov/products/wesley/wgrib2/csv.html): seven columns and bounded regional export.
- [NWS reuse policy](https://www.weather.gov/disclaimer): NWS data are generally public domain unless otherwise marked; retain attribution, do not imply endorsement or present modifications as official output. No third-party solver code is incorporated or relicensed.

To refresh terrain intentionally: `node tools/simulation/fetch-terrain.mjs`. It performs only 81 point queries, at most two concurrently, with timeouts and no automatic retry loop. It writes the fixture only after successful completion. Network access is unnecessary for the recorded demo. No paid service, credentials or API keys are used.

## Validation and scaling plan

First use established local studies: [Pima floodplain studies](https://www.pima.gov/floodplain-studies), including Altar/Avra Valley and Brawley/Black Wash studies, and [Pima ALERT history](https://alertmap.rfcd.pima.gov/gmap/gmap.html). Review study-specific model/data terms before reuse. Regional reference candidates include USGS 09487000 (Brawley Wash near Three Points), USGS 09486520 (Santa Cruz at Trico), and Pima ALERT 6423/6443. They are different locations and drainage areas, **not crossing-depth ground truth**. Review metadata, units, time zones, quality flags and historical station changes before comparison. [USGS Water Data APIs](https://api.waterdata.usgs.gov/) supply the recorded observations and bounded fetch adapter. The separate reach-routing fits use prior gauge events; the local rainfall/terrain model remains uncalibrated.

Next: acquire a bounded, conditioned DEM and the full contributing basin; verify drainage structures and outlets against local studies; validate real event radar imports against Pima rainfall gauges; replace or calibrate conceptual loss/routing against appropriate discharge observations; evaluate withheld storms and quantify uncertainty. A NYC reference could mean FloodNet sensors or an urban modeling workflow; neither has been silently selected as a solver or assumed licensed for reuse.

Browser visual QA remains **unperformed**: the browser tool stopped under its URL-verification policy. Do not treat automated numerical checks as visual validation. No browser retry was made. This demonstrator must not be interpreted as validated depth, road passability or safe routing.

### Primary historical benchmark: the 2014 Trico bridge event

The owner's primary benchmark is the reported 2014 event in which the Trico bridge washed out. This is additive to the radar/GIS pipeline, local historical gauges and established-model reuse goals. **A separate gauge-to-gauge routing hindcast is now scored above; a full radar-runoff or bridge-failure hindcast has not been completed.** Confirm the exact bridge, event dates, damage chronology and evidence before choosing inputs; do not substitute the nearby Los Robles sample for the affected river crossing.

Build a versioned event package with original radar/gauge files, UTC timestamps, quality flags, rainfall coverage, basin and structure geometry, documented closures/high-water marks, and source permissions. Define acceptance criteria before fitting: rainfall accumulation agreement, flood arrival and peak timing, peak discharge and volume errors at appropriate gauges, plus inundation/high-water comparisons only where a calibrated hydraulic model and observations support them. Keep calibration parameters separate from benchmark observations and reserve other flood and nonfailure events for independent evaluation. One fitted event is not field readiness.

Hydrologic hindcasting estimates runoff/discharge. Reproducing bridge washout or structural failure additionally requires hydraulic, scour, debris, foundation and structural evidence; this reservoir demonstrator cannot predict those processes. Record uncertainty and missing evidence rather than claiming a failure mechanism from a hydrograph. The 2014 benchmark is the next major validation target, not a completed validation result.

### Recorded 2014 observations and comparison hooks

`data/usgs-trico-2014-candidate.json` now contains the original public USGS response and normalized discharge for USGS-09486520, September 8 00:00 through September 10 00:00 UTC: 193 samples, 15-minute maximum gap, all returned approval statuses Approved and no qualifiers returned in this window. The sampled maximum is 12,000 ft³/s (339.802159104 m³/s), September 9 06:45 UTC / September 8 23:45 MST. This is a sampled window maximum, not a verified annual instantaneous crest. Longer event windows may contain estimated/qualified samples. Raw flags must always be checked.

The UI plots this record separately from the synthetic model scenario. The discharge station is on the Santa Cruz, not the small Los Robles model window. The observation is not road-water depth and does not establish structural failure. The exact request URL and retrieval time are preserved; the CLI can repeat a bounded public query without credentials:

```sh
node tools/simulation/fetch-gauge.mjs USGS-09486520 2014-09-08T00:00:00Z 2014-09-10T00:00:00Z observations.json
node tools/simulation/compare.mjs modeled-at-gauge.json observations.json
```

`modeled-at-gauge.json` must declare `siteId`, `units:"m3/s"`, and `points:[{time:ISO_WITH_TIMEZONE,valueM3s:number}]` for a model actually representing that station. The present local-window export is deliberately not automatically accepted. The comparison requires matching station identifiers, at least three exact-time pairs, approved unqualified observations, and no timestamp shifts, interpolation or basin scaling. It reports coverage, bias, RMSE, Nash–Sutcliffe efficiency (null for constant observations), and paired peak magnitude/timing error. These are sampled-pair diagnostics, not event validation when coverage is sparse. Gauge fetch refuses pagination so incomplete data cannot silently look complete. Tests exercise conversion, retained metadata, invalid records, perfect/biased comparisons and partial coverage.

The [University of Arizona Santa Cruz River Monitoring and Sediment Transport Study, August 19, 2015](https://content.civicplus.com/api/assets/3a2eba4f-5938-4c26-8302-1ed10a06bf61) is an established local modeling lead: its sediment analysis uses HEC-RAS and includes the September 2014 flood and surveyed sections. Acquire original model/geometry files and verify reuse terms; they have not been obtained here. Reusing parameters fitted to that event would be reproduction, not independent validation. [NOAA event 543215](https://www.ncei.noaa.gov/stormevents/eventdetails.jsp?id=543215) is an event-identification lead, not confirmation that the entire bridge collapsed.

The DOM-contract test verifies loading, rerun, rejected-import clearing and restoring the demo using local recorded inputs and a mocked DOM. This does not replace the outstanding browser visual/interaction QA.
