# September 2014 rainfall handoff

The committed forcing has **72 consecutive one-hour intervals**, September 8 00:00 through September 11 00:00 Arizona local time: `2014-09-08T07:00Z`–`2014-09-11T07:00Z`. Each file is the preceding hour's IEM archived MRMS p1h accumulation. Hourly snapshots do not overlap. Depth in mm divided by one hour gives constant mean mm/h; subhour timing is unknown.

`public/simulation/data/storm-2014/manifest.json` describes a **111-row × 121-column** EPSG:4326 grid, north to south, west to east. Pixel centers: west −111.7°, east −110.5°, north 32.8°, south 31.7°; spacing +0.01° longitude / −0.01° latitude. All 967,032 cell-hours in this regional crop are present. This is reusable regional coverage, **not a delineated watershed or the final SFINCS mesh**. Exact solver bounds were not yet supplied.

Each hour file contains a row-major `depthMm` array. Index 255 is null, never zero. The manifest retains original URLs, acquisition times, sizes, SHA-256 hashes and world-file evidence, plus derived-frame hashes. Approx. 27 MB of original hourly files are cached outside Git in `../rainfall-cache`; approximately 4 MB of regional arrays are committed. Original daily files and source-attempt records are cached too. HTTP failures are recorded without retries; a local 2 MB size guard on the daily product was increased to 6 MB once, with the earlier attempt retained. No denied endpoint or browser operation was retried.

## Important consistency finding

Complete coverage does **not** mean validated rainfall forcing. We compared each block of 24 nonoverlapping hourly inputs against the p24h product at the identical endpoint and grid, only where both had valid data:

| Ending UTC | Compared cells | Excluded cells | Mean hourly sum minus daily (mm) | Maximum absolute difference (mm) |
|---|---:|---:|---:|---:|
| Sep 9 07:00 | 13,389 | 42 | −15.7603 | 104.75 |
| Sep 10 07:00 | 1,268 | 12,163 | −0.4667 | 2.75 |
| Sep 11 07:00 | 220 | 13,211 | −1.5170 | 5.50 |

At the Trico pixel, the first 24 hourly frames sum to **3.75 mm**, while the daily product is **17.5 mm**. These discrepancies have not been explained; do not attribute the large first-day difference solely to quantization. Source-product comparability/history and public rainfall gauges require investigation. No bias correction, time shifting or scaling was applied. The adapter returns `requires_quality_review`, retaining arrays and the quality finding. Both hourly and daily derived arrays are available to reproduce the comparison. This is an input-quality limitation, not a missing-file blocker or proof either product is ground truth.

## Solver adapter

Pure Python, no network or additional dependencies:

```sh
python tools/simulation/storm_forcing.py --bbox -111.32 32.45 -111.29 32.49 --output trico-forcing.json
```

Or import `load_forcing(manifest_path, bbox=[west,south,east,north])` from `tools/simulation/storm_forcing.py`. Output: `lon`, descending `lat`, and `frames[{start,end,precipMmH[lat][lon]}]`, dimensions `(time,lat,lon)`, CRS, source quality and provenance. The demonstration bbox is a small gauge-centered crop, **not a recommended solver domain**. Supply the actual model domain with enough source-cell padding for the chosen interpolation method. The adapter rejects requests outside regional coverage, hash changes, gaps and missing cell-hours. `--allow-missing` preserves nulls for inspection and marks insufficient data; it does not repair inputs.

SFINCS/HydroMT integration must handle spatial reprojection/remapping, native forcing serialization and interval conventions explicitly. Do not pass geographical degrees as metres or silently convert hourly accumulations into instantaneous peaks. Copy the quality flag into run provenance. No SFINCS run or inundation result is created here.

## Reproduce and view

`python tools/simulation/build_storm_forcing.py --fetch` obtains the fixed bounded event sequentially with a persistent cache and 0.2-second spacing between requests; omit `--fetch` for an offline rebuild from the existing cache. Install `requirements-radar.txt` for decoding. Tests: `npm test` and `python -m unittest discover -s test -p '*_test.py' -v`.

Run `node tools/simulation/serve.mjs --app`, follow Experimental river forecasts, then **Replay September 2014 rainfall and gauge observations** (`/simulation/storm.html`). The slider/map shows real radar-derived hourly input and a marker on the recorded Trico gauge discharge curve. USGS estimated qualifiers are retained. No rainfall-to-flow fit or simulated depth is implied. Browser visual QA remains unavailable; DOM interaction tests cover loading and stepping hours.

Primary decoding references: [IEM p1h raster mapping](https://mesonet.agron.iastate.edu/GIS/rasters.php?rid=5), [IEM rainfall products and interval documentation](https://mesonet.agron.iastate.edu/rainfall/). These describe quantitative indexed PNG values and missing data; they do not establish that this historical hourly/daily pair is interchangeable. Validate against existing public Pima/USGS rainfall or independent archived analyses before claiming a faithful 2014 hydrologic reconstruction; user-owned sensors are not required.
