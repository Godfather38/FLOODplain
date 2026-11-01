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
