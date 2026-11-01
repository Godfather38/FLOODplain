# Cortaro-to-Trico observed-inflow result

The real reach ran in **17.534 seconds** using the existing SFINCS solver.
No solver physics was changed. This is an uncalibrated observed-inflow scenario,
not a completed historical flood reconstruction or operational forecast.

## Independent upstream input

Source: [USGS Santa Cruz River at Cortaro, 09486500](https://waterdata.usgs.gov/monitoring-location/USGS-09486500/).
The retained original USGS API response identifies parameter **00060**, discharge
in ft³/s, with WGS84 coordinates **32.3507222222, −111.095875**. All upstream
samples are approved and unqualified, spaced no more than 15 minutes apart,
September 7 07:00 UTC through September 11 07:00 UTC, 2014. Conversion is exactly
`ft³/s × 0.028316846592 = m³/s`. Model times remain UTC (Arizona is UTC−7).

The approved original and normalized records are in
`tools/sfincs/data/gauges/cortaro-benchmark-2014-09.json`, retained from app commit
`bc44310`. Source URL, retrieval time, raw values and quality flags remain present.
The usable native boundary is `data/reach-result/sfincs.dis` (seconds since
`tref`, m³/s) and `sfincs.src` (EPSG:32612 metres). Interpolation is linear between
observations. No time shift, peak scaling, extrapolation, or travel-time fit was used.

The domain was extended to contain the **actual upstream station**, rather than
moving its hydrograph to the old small Trico window. Projected terrain bounds are
`[467000,3577000,493500,3596000]`, EPSG:32612, 265×190 cells at 100 m.
Requested geographic extent: `[-111.35,32.33,-111.07,32.50]`.
Cortaro is at `(490978.733,3579315.722)` metres, in cell row 23, column 239
(zero-based, south to north); cell-center offset is 44.73 m. Discharge is inserted
in that containing cell without an imposed velocity distribution. Both stations
are on the named Santa Cruz River; the modeled terrain includes their connecting
reach. Hydraulic travel from Cortaro to Trico is computed by SFINCS, not prescribed.

DEM vertical datum is NAVD88 according to the intersecting USGS source catalog.
No gauge stage is supplied, so modern gauge-height datum offsets are not assumed
valid for 2014 and no stage-to-elevation conversion is involved.

**Trico 09486520 is never a forcing input.** Its location defines an illustrative
2 km transverse section; its discharge values are read only after the solver run
for comparison. No parameter was fitted to those values. The target record retains
16 qualified samples and its original quality metadata.

## Actual result and its limitations

[Execution 41288063890](https://github.com/Godfather38/FLOODplain/actions/runs/41288063890),
input/code commit `f1f2f5c4f04d702955ae0bacc0cc02d8f97d01e5`:

| Quantity | Result |
|---|---:|
| Native integrated upstream input | 13,277,470 m³ |
| Native integrated net outer-boundary outflow | 2,318,310 m³ |
| Final interior storage | 11,016,799 m³ |
| Budget residual / input | −0.434% |
| Trico model-section peak | 81.425 m³/s, Sep 9 14:40 UTC |
| Withheld observed peak | 339.802 m³/s, Sep 9 06:45 UTC |
| Comparison RMSE after 24-hour spinup | 88.841 m³/s |
| Maximum displayed Trico-window depth | 2.466 m |

Outflow is measured with the solver's native section fluxes around the interior
cell boundary, not inferred as a residual. Fluxes are integrated at 60-second
output; using 120-second samples changes the outlet integral by about 50,389 m³.
Thus this is approximate accounting, not an exact mass-conservation claim.

Changing the wetting threshold from 0.01 to 0.005 m gives a Trico peak of
82.643 m³/s at 14:32 UTC, RMSE 88.780 m³/s and budget residual +0.0478%.
This small numerical-setting difference is not a calibrated uncertainty interval.

The full domain develops 26.884 m of pooling in a deep DEM depression near
**32.361851, −111.103632** (bed elevation 622.247 m). Its channel/bank connectivity
must be reviewed; the model's low, late Trico peak must not be presented as a
validated prediction. The 100 m contemporary terrain does not resolve channel
bathymetry, levees, bridge openings or historical geometry. Roughness 0.04 and
zero infiltration remain explicit assumptions. No terrain was carved or adjusted
to match the observed target.

## Rainfall alignment and next usable input

This run omits local rainfall and lateral tributary sources; omitted rain is not
claimed to be observed dry. The old IEM palette input is obsolete and is no longer
run. The complete Stage IV export at app commit `e8617ac` covers only
`[-111.36,32.38,-111.25,32.51]`, which excludes Cortaro and most of the new reach.
Do not extrapolate that crop across the missing area.

Use the same decoded Stage IV grids to export **padded bounds
`[-111.37,32.31,-111.05,32.52]`** for September 8 07:00 UTC–September 11 07:00 UTC.
The 72-hour event can use the existing September 8 07:00 modeled water-level
snapshot as its declared initial state (24-hour observed-inflow hydraulic spinup),
without claiming rainfall observations for the preceding day. Antecedent-state
and omitted lateral-flow limitations still need to remain visible.

## App handoff

`tools/sfincs/data/reach-result/inundation.json.gz` passes the existing app contract:
6,578 displayed cells, 97 hourly frames, native `flowM3s` with an explicit section
location, source hashes and `hydraulicReadiness: requires_channel_geometry_and_rainfall_review`.
The original NetCDF map/history, native input files, solver log and check report
are alongside it. The 0.005 m sensitivity export and report are in the subfolder.
Execution completion does not mean hydraulic validation. No passability, bridge
failure, scour, or calibrated ± accuracy claim is supplied.
