# Current HRRR and river input package

Delivered immutable package: `tools/simulation/data/current-inputs-20261101/manifest.json`.

- Issue cutoff/acquisition start: **2026-11-01 15:32:59.867556 UTC**. Completed package snapshot: **15:41:03.385602 UTC**, after all retained source retrievals.
- Actual HRRR cycle: **14:00 UTC**, all 18 forecast hours obtained from NOAA Open Data. The 15:00 cycle was inspected but lacked the complete requested inventory at acquisition. No hardcoded example cycle was substituted.
- Native product: GRIB2 APCP surface, **one-hour accumulation**, kg/m². Each hourly field is selected separately from the index; cumulative 0–N-hour fields are not summed. ecCodes verifies reference time, validity, start/end steps, grid and units.
- Full domain: supplied registry rectangle EPSG:32612 `[467000,3577000,493500,3596000]`. Rainfall outer footprint EPSG:4326 `[-111.375,32.305,-111.045,32.525]` covers it. Output 22×33 geographic grid samples **99 distinct native 3-km cells**; finer output spacing does not add weather resolution.
- Raw GRIB download: **9,529,776 bytes**, indexed HTTP206 messages only. Original messages, indices, inventory lists, provider response bodies, source URLs/ranges and SHA256 are retained.
- No missing rainfall cell-hours. Complete 18-hour spatial totals range **10.314–50.493 mm** across this crop; these are model forecasts, not observations.
- Verified domain inlet from solver registry `b15eb25`: **15902419**. Its own NWM **13:00 UTC** series was acquired. **Cortaro15903137 is inside the domain and is not substituted as the inlet.** Internal RFC/NWM/gauge records remain available separately as context.
- Exact common interval: **2026-11-01 16:00 through 2026-11-02 07:00 UTC**. Boundary has 16 inclusive hourly native samples; precipitation has 15 interval-start frames. No discharge extrapolation/interpolation or missing-value zero fill.

## Consume through the existing solver adapter

```python
from pathlib import Path
import json
import xarray as xr
import hydromt  # registers the existing raster accessor

root = Path('tools/simulation/data/current-inputs-20261101')
registry = json.loads((root / 'boundary-registry.json').read_text())
snapshot = json.loads((root / 'boundary-snapshot.json').read_text())
metadata = json.loads((root / 'precipitation-metadata.json').read_text())
precip = xr.open_dataset(root / 'precipitation.nc', decode_coords='all')['precip']
# Existing solver-owner prepare_current.py functions consume these objects.
# apply_current_forcing additionally requires the real physical_manifest/model.
```

`precip` is `(time,y,x)`, regular EPSG:4326 with CF/WKT CRS, UTC-naive serialization, **mm/hour** interval rates and interval-start time labels. Sidecar provides final interval end, intervalSeconds3600, issuance, cutoff, hashes and source metadata. The parallel rainfall JSON retains the existing hourly forcing schema and explicit **m/s** arrays (`precipMS = precipMmH / 3,600,000`). Discharge is **m³/s**. Observation arrays remain distinct from forecast boundary series.

`boundary-snapshot.json` has exactly the solver's `asOf/start/end/series` contract, with native reach ID, status, issue/retrieval timestamps and `points[{time,flowM3s}]`. Different provider issue times are retained honestly: HRRR14Z and NWM13Z are not represented as one meteorological issue. All issues precede the fixed cutoff. RFC issues and HEFS spread remain separately identified in `providers.json`. Raw observation feed may omit approval/qualifiers; that absence is explicit, not an invented approved flag.

## Refresh with one command

Use an ordinary Python environment with `pip install -r tools/simulation/requirements-current-inputs.txt`, plus existing Node. Then:

```text
python tools/simulation/build_current_inputs.py --registry tools/sfincs/data/current-boundary-registry.json --out tools/simulation/data/current-inputs-NEWSTAMP
```

On this app branch the supplied registry is also retained inside the delivered package; that file can be passed until the solver branch is integrated. Output directory must be new: no silent overwrite of an issued package. The CLI discovers the latest complete bounded cycle, gets indexed HRRR hourly fields, captures existing provider adapters, acquires exact registry inlet series and exports the NetCDF/sidecars. No solver, credentials, paid service or new infrastructure is involved.

For local inspection: `python tools/simulation/current_inputs.py tools/simulation/data/current-inputs-20261101`. `finalize_current_inputs.py` only serializes acquired data; it does not acquire terrain or run hydraulics. NetCDF round-trip values, all input hashes, native-cell sampling checks and full registry-domain coverage were verified. The exact HydroMT application remains with the solver owner; it was not falsely claimed to have run here.

## Remaining physical dependency

This closes current precipitation acquisition and the discovered inlet's data transport, not the whole hydraulic forecast. Registry owner must finish full inlet/network coverage, provider network-version crosswalk and disjoint contributing-area/rainfall accounting. Current professional geometry/structures, specified losses and compatible initial state remain required by that model. No default zero inflow, guessed structures, old2015 current terrain or invented runoff model was supplied. Recheck issue age at future use; this is an immutable acquired snapshot, not permanently live data. No accuracy margin follows from successful acquisition.

Sources: [NOAA HRRR](https://rapidrefresh.noaa.gov/hrrr/), [NCEP system documentation](https://www.emc.ncep.noaa.gov/emc/pages/numerical_forecast_systems/hrrr.php), [NOAA Open Data distribution and public reuse terms](https://registry.opendata.aws/noaa-hrrr-pds/), [NWPS API](https://water.noaa.gov/about/api). ecCodes performs standard GRIB decoding; no custom weather model or hand-written GRIB decoder was introduced.

## Full 29-inlet package (latest handoff)

Use **`tools/simulation/data/current-inputs-full-20261101/manifest.json`** for solver registry **`91fd540`**. The original single-inlet package remains unchanged.

All **29/29** registry reaches returned actual NWM short-range series, all from the same **2026-11-01 13:00 UTC** issue. Snapshot completed **15:56:29.507 UTC**. Each has the same 16 native timestamps, **November1 16:00 through November2 07:00 UTC**, in m³/s. None is missing; no unavailable series became zero. Requests used three concurrent workers. The previously acquired inlet15902419 raw response was reused because its cycle matched. Raw response bodies, retrieval times and hashes are retained.

**No HRRR redownload:** rainfall JSON, provenance and all 18 original precipitation messages are byte-identical to the original package. The final NetCDF still contains the common15 hourly intervals and covers the full registry domain. `boundary-snapshot.json` and the supplied full registry now contain all29 inlets.

### Initialization inputs actually available

`analysis-history.json` retains the real `analysis_assimilation` endpoint response for every inlet, with units converted to m³/s and no missing-value fill:

- 29/29 series available,47–48 hourly readings each, maximum gap1hour.
- Common overlap: **2026-10-30 16:00 through2026-11-01 14:00 UTC** (46hours between endpoints).
- API top-level `referenceTime` is **2026-11-01 11:00 UTC**. The endpoint returns rolling history with later valid timestamps; it does not provide a separate model issue for each historical point. Both fields are retained rather than treating every point as one11Z issuance.
- This is assimilated **model analysis**, not direct gauge observations or an initialized hydraulic state.

There are two hours between the common analysis endpoint and the requested forecast start. `initialization-context.json` separately supplies actual native13Z forecast values at **14Z,15Z,16Z for all29 reaches**. They were recovered from the already downloaded raw forecast responses, not interpolated or downloaded again. Analysis and forecast lead-in remain separate; the solver owner must document the transition and warmup rather than silently stitching inconsistent source roles. No claim of hydraulic equilibrium is made.

### Repeat the boundary extension without fetching rain again

Copy an issued package to a new output directory and place the solver owner's exact full registry at `boundary-registry.json`, then:

```text
node tools/simulation/extend-current-boundaries.mjs <new-output-directory>
python tools/simulation/finalize_current_inputs.py <new-output-directory>
```

The extension checks a common forecast cycle and exact native timestamp coverage, writes explicit unavailable records if a source fails, and keeps initialization history separate. The finalizer refuses incomplete boundary snapshots and verifies registry/series identity before exporting the existing solver contract. It does not change topology, build a model or execute SFINCS. Verified: all29 series, exact time grids, source/package hashes, unchanged HRRR bytes and full-domain precipitation coverage.

## Catchment-coupled package (supersedes rectangle-boundary inputs)

Latest solver handoff: **`tools/simulation/data/current-inputs-catchments-20261101/manifest.json`**, domain/registry version **`catchment-coupling-8c38b09`**. This is a distinct package; earlier rectangle-domain packages remain unchanged.

The solver owner's GEB external-to-active-catchment registry contains active reaches15890430,15902363,15903137 and four external inlet reaches **15902351,15902361,15902409,15902411**. Its reported local/external polygon overlap is0m². That topology/accounting evidence is carried from the supplied registry, not independently reconstructed by this worker.

All four inlet forecasts use the actual **13Z November1 NWM issue**, with15 common native timestamps **17Z November1 through07Z November2**. Snapshot completed **16:08:30.582 UTC**. The two additional forecasts already existed in the retained Cortaro upstream-provider responses and were reused with their original hashes/retrieval times. Only their two missing analysis histories required network requests; no new forecast/model was created.

The retained18 HRRR14Z one-hour GRIB messages were **recropped, not redownloaded**. New regular output is35×38, sampled from176 native3-km cells with no missing cells. Raster outer bounds `[-111.365,32.265,-110.985,32.615]` cover the full new EPSG32612 domain `[467700,3572300,499700,3606900]`. Final `precipitation.nc` is **14×35×38**, covering the exact17Z–07Z interval. Original raw rainfall hashes are unchanged; crop mapping, provenance, registry and NetCDF are independently versioned for this domain.

Initialization context is explicit:

- All four analysis-assimilation histories are available; common overlap **Oct30 16Z–Nov1 14Z**, hourly, top-level referenceTime11Z as supplied by the API.
- `initialization-context.json` separately retains actual13Z forecast samples at **14Z,15Z,16Z,17Z** for each inlet.
- Analysis and forecast values are not automatically blended or stitched. Solver owner chooses/documents its transition and warmup; these data do not assert an initialized/equilibrated hydraulic state.

Consumer files retain the same interface: `boundary-registry.json`, `boundary-snapshot.json`, `precipitation.nc`, `precipitation-metadata.json`, `analysis-history.json`, `initialization-context.json`. Native source cells/outlets, terrain, initialization and localized structure handling remain solver-owned. No hydraulic run occurred here.

For another supplied domain, copy an issued package to a new directory, replace only its registry with the solver owner's version, run `recrop_current_inputs.py <directory>` using the existing decoder environment, then `extend-current-boundaries.mjs <directory> <registry-commit>` and `finalize_current_inputs.py <directory>`. Recropping reads only retained messages and verifies native mapping/coverage. Old and new domains are never silently mixed.


## Initialization rainfall history

`current-inputs-catchments-20261101/initialization-rainfall-manifest.json` indexes retained raw bytes and outputs for the same catchment domain. NOAA/NCEP Stage IV hourly radar/gauge precipitation analysis is delivered through the [IEM archive](https://mesonet.agron.iastate.edu/iemre/); [product documentation](https://gdex.ucar.edu/datasets/d507005/) describes the radar/gauge analysis and hourly accumulations. Actual GRIB headers, timestamps, bitmap and hashes are retained for every downloaded file.

The requested window is October 30 16:00 through November 1 14:00 UTC, 46 hours. All 46 files were available, but **November 1 12:00-13:00 UTC is entirely masked over this domain** (1,330 output cells). The other 45 intervals have complete mapped coverage. Thus package status is `insufficient_data`, not complete; the continuous complete prefix ends at 12:00 UTC. No missing value was filled with zero. This is a source-data gap, not a denied operation.

`initialization-rainfall/analysis-precipitation.nc` contains 46x35x38 hourly mean rates in mm/hour on exactly the retained HRRR output coordinates; interval timestamps mark starts. Native Stage IV resolution is about 4.7 km, sampled to this grid without claiming added spatial resolution. Units were checked as one-hour accumulated GRIB `tp`, kg/m2, numerically equal to mm/hour. Source reference times and retrieval/HTTP metadata are retained. Actual product publication/issue timestamps are unknown and remain null; one previously cached source also lacks its original retrieval timestamp.

`initialization-rainfall/forecast-transition-precipitation.nc` separately contains the three existing HRRR14Z intervals from 14:00 through 17:00 UTC, byte-value identical to retained forecast arrays. These are **forecasts, not observations**. They do not repair the earlier masked analysis hour. No unchanged HRRR or NWM inputs were downloaded again. The solver owner must choose and document an initialization window/method or obtain replacement evidence for the gap; these files do not claim hydraulic equilibrium.

Inline verification checked all46 raw hashes, native masks, exact hourly intervals, NetCDF coordinates and unchanged transition values. No solver run occurred. To acquire another package's available analysis window with the existing decoder environment: `python tools/simulation/build_initialization_rainfall.py <package-directory>` (creates a new initialization-rainfall subdirectory and refuses overwriting).


### Resolved initialization analysis: MRMS source substitution

The missing November 1 12:00-13:00 UTC interval is now covered by actual NOAA MRMS `MultiSensor_QPE_01H_Pass2`, valid13Z, retrieved from the public NOAA MRMS S3 distribution. Both Pass1 and Pass2 objects were listed; Pass2 was decoded and provides complete domain coverage, **0-0.8 mm** accumulation. No forecast fallback was needed.

Use **`initialization-rainfall/resolved-analysis-precipitation.nc`** with **`resolved-analysis-metadata.json`**:46x35x38 hourly mean mm/hour, Oct30 16Z-Nov1 14Z, zero missing cells. This is explicitly mixed-source observation-based analysis:45 Stage IV hours and one MRMS Pass2 hour. The original Stage IV arrays and missing mask remain unchanged. The separate14Z-17Z HRRR transition remains forecast data.

NOAA's retained [MRMS parameter table](https://github.com/NOAA-National-Severe-Storms-Laboratory/mrms-support/blob/main/GRIB2_TABLES/UserTable_MRMS_v12.2.csv) identifies GRIB discipline209/category6/parameter37 as one-hour multi-sensor accumulation in mm, with -1 missing and -3 no coverage. The raw GRIB uses template0 with generic instantaneous metadata; product-defined accumulation semantics, not that generic stepType, establish the preceding hourly interval. ecCodes does not recognize these local parameter units automatically, so the official table is retained and hashed. Native0.01-degree grid coordinates are decoded directly and sampled to the existing target grid; no Stage IV index mapping is reused.

All45 untouched hourly arrays were compared exactly. The replacement contains real decoded nonzero rainfall as well as valid zeros; no zero fill/interpolation was used. Exact publication and HTTP retrieval timestamps were not recorded for the MRMS object and remain null; valid time, local creation time, source URL/raw bytes/hash and parameter definition are provided. This completes precipitation input coverage without asserting hydraulic initialization or model accuracy.


## Refreshed execution package

`tools/simulation/data/current-inputs-catchments-20261101-refresh/manifest.json`: newest complete checked HRRR15Z (16Z incomplete), all four NWM14Z issues. Exact common forecast window17Z November1-08Z November2;15 hourly rainfall intervals,35x38 cells, no missing. Retained analysis history and resolved Stage IV/MRMS rainfall unchanged. Use top-level `initialization-forecast-transition.nc` and its metadata:14-15Z retained HRRR14Z,15-17Z new HRRR15Z. This replaces the older nested transition for this refresh. Flow analysis ends14Z; new native NWM forecast begins15Z, with no generated intermediate samples. Original package remains immutable. Provider responses initially varied between13Z and14Z; retained common14Z responses were obtained for all four, not relabeled. No solver run or broad test suite.
