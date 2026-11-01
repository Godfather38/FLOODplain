# Historical rainfall source correction

The large hourly/daily discrepancy came primarily from applying today's palette to an older writer's output. This is a source-version correction, **not a fitted rainfall multiplier**. Original PNGs/world files, old derived arrays and comparisons remain preserved. Default replay now uses `storm-2014-legacy`; the old `storm-2014` manifest is marked obsolete and the solver adapter rejects it.

## Evidence chain

The [September 2014 hourly writer](https://github.com/akrherz/iem/blob/d592553cfd01baac8cb8ebc10f9217e21d7c5def/scripts/mrms/mrms_raster_p1h.py) calculated nonlinear palette indices but assigned the original integer-cast rainfall values into its uint8 output. Its [reader](https://github.com/akrherz/iem/blob/d592553cfd01baac8cb8ebc10f9217e21d7c5def/scripts/mrms/util.py) had already divided data by the header scale. The [scheduled hourly job](https://github.com/akrherz/iem/blob/d592553cfd01baac8cb8ebc10f9217e21d7c5def/scripts/RUN_10_AFTER.sh) called that exact script using UTC year/month/day/hour. The [daily writer](https://github.com/akrherz/iem/blob/d592553cfd01baac8cb8ebc10f9217e21d7c5def/scripts/mrms/mrms_raster_pXXh.py) used its encoded image instead. Both selected NSSL radar-accumulation tiles through the historical utility, not today's NCEP MultiSensor product.

Crucially, the [contemporaneous public rainfall page](https://github.com/akrherz/iem/blob/d592553cfd01baac8cb8ebc10f9217e21d7c5def/htdocs/rainfall/index.phtml) warned that one-hour zeros and missing data could not be distinguished. Therefore **0 maps to null**, not observed dry. Nonzero bytes are interpreted as truncated integer mm; 255 remains unknown. Without raw NSSL headers, other historical cast/wrap artifacts cannot be excluded. The later writer replacement is dated November 26, 2014; this profile is restricted to the audited September event, not applied globally. No a2m decoder is provided: its historical encoding also differs from today's scale.

The [public grid fix](https://github.com/akrherz/pyIEM/commit/fbaa69a08233574c5727e87bdd22fd73df088041) distinguishes pixel centers from outer edges. Native centers start at −129.995°,54.995°, while legacy world files contain −130°,55°. We preserve the original transform and record the explicit +0.005° longitude/−0.005° latitude correction. This shifts nearest-cell selection separately from the encoding correction. Raw tile headers were not retrieved; this limitation stays in the provenance.

All 72 hourly PNG hashes differ: no repeated whole-file frames were found. The inspected PNG has no embedded timestamps. Filename intervals, historical scheduler UTC use, and matching world-file grids support timing; they do not substitute for unavailable raw headers. The first comparison window is exactly September 8 07Z–September 9 07Z, matching the Arizona calendar day and daily product endpoint. No timezone shift was fitted. A historical JSON sidecar returned 404 and was not retried.

## What changed numerically

| Sampling | Obsolete palette sum | Known positive integer-mm sum | Daily estimate |
|---|---:|---:|---:|
| Trico, original world-file pixel (row2253,col1870) | 3.75 | 15 | 17.5 |
| Trico, corrected native pixel (row2252,col1869) | 4.5 | 18 | 20.75 |
| Tucson airport, original world-file pixel | 14.75 | 59 | 61.25 |
| Tucson airport, corrected native pixel | 18.25 | 73 | 75 |

These are **positive-sample sums**, not complete hourly accumulations. At the corrected Trico pixel, 20 of the first 24 hours are unknown-zero-or-missing. Integer truncation can explain some residual differences, but missing coverage and algorithm differences remain unresolved. No bias correction or automatic filling was applied.

Across the regional grid, all 72 files are present but only **56,378 nonzero cell-hours** are provisionally decoded; **910,654 are unknown**. The earlier claim of 967,032 valid cell-hours is retracted. For the actual SFINCS geographic bounds `[-111.34,32.40,-111.27,32.49]`, the source-center crop is 9×7 cells across 72 hours: **4,239 of 4,536 cell-hours unknown**. The exported `sfincs-trico-rainfall-2014.json` is explicitly `insufficient_data`, not complete forcing for a faithful hindcast.

## Independent public comparison

The archived Tucson airport daily summary reports **1.84 inches = 46.736 mm**, `precip_est:false`, for September 8 in America/Phoenix. NOAA's [event narrative](https://www.ncei.noaa.gov/stormevents/eventdetails.jsp?id=543215) independently corroborates the published total. Original response, current station metadata, exact endpoint, hash and sampling locations are retained in `rainfall-source-audit.json`. Ryan Field's precipitation value is null; Marana's record is absent and its listed archive begins November 17, 2014. Neither is replaced with zero.

An independently encoded **NCEP Stage IV** comparison contains 24 original hourly GRIB references and extracted values. ecCodes verifies total precipitation, kg/m², one-hour accumulation bounds, native polar-stereographic grid and bitmap. One kg/m² of liquid water equals one mm. The first day totals **41.90 mm** at the native Stage IV cell nearest Tucson and **30.27 mm** near Trico. Distances, native indices and grid spacing are retained. Tucson's Stage IV difference is −4.836 mm for this one event/site; it is not a transferable accuracy interval. The source is a separate radar/gauge analysis and may share observations with other products. Point gauges and raster-cell means have different spatial support.

This supports using a fully decoded Stage IV sequence as the next comparable forcing candidate, not blending it into MRMS or declaring either product ground truth. The current Stage IV artifact covers only the first 24 hours and two sampled locations, not the full SFINCS mesh or 72-hour replacement. Source reference: [IEM Stage IV documentation](https://mesonet.agron.iastate.edu/iemre/).

## App and reproduction

`/simulation/storm.html` displays source-corrected nonzero rainfall, unknown cells, observed discharge and the independent comparison. The official forecast engine remains unchanged. `redecode_2014.py` regenerates the versioned arrays from cached original bytes; `audit_rainfall_sources.py` regenerates the source/gauge audit; `compare_stage4.py` caches and checks the bounded first-day alternative. `storm_forcing.py` rejects the obsolete palette dataset and rejects incomplete forcing by default. `--allow-missing` exports nulls with insufficient-data status for inspection only.

The raw source files/headers and gauge products are not a new physics model. No SFINCS/HAND depths, roadway passability, calibrated ± accuracy or successful 2014 bridge-failure prediction are asserted.


## Recorded SFINCS handoff

Original reference artifacts from solver branch commit `6a014da5d7d6f808847153ddf3a411c665aeed06` are retained in `tools/sfincs/data/reference-run`. The experimental storm page links to `solver-replay.html`, which validates the real output contract and labels its historical forcing invalid. The original artifact is unchanged, including now-superseded coverage claims. It used the obsolete rainfall decoder, no upstream river inflow, and reached only 0.007263 m maximum depth, below the 0.01 m wetting threshold. This proves execution and interchange, not event prediction. Corrected forcing remains insufficient; a scientifically specified river boundary and replacement rainfall are pending with the solver owner.
