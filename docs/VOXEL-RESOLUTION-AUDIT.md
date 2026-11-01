# Resolution audit for the geographic voxel renderer

Read-only source audit, 1 November 2026. No solver execution, new terrain acquisition, or model changes were performed for this audit. This document separates the existing datasets from prospective display improvements.

## Answer to “aren't the flood results sharper in places?”

Yes: the application has more detail than the coarse cell-average SFINCS color layer alone shows. Its two NOAA HAND windows use approximately 10 m display cells. The current SFINCS case also incorporates 10 m terrain through native subgrid storage/conveyance tables. However, the retained current SFINCS water-level solution itself is a regular 100 m grid; it has no locally refined/adaptive cells. A high-resolution terrain display or a downscaled flood map must not be described as a newly computed 10 m or 1 m hydraulic solution.

| Product | Actual spatial support | What the renderer may claim |
|---|---|---|
| Frozen current SFINCS water level `zs` | 100 m regular cells; 29,685 active; native array 346 by 320 | Native hourly water-surface elevation, metres in the case's NAVD88 reference |
| App SFINCS `depthM` | One full-cell mean per 100 m cell | Reconstructed storage divided by 10,000 m²; not `zs - mean terrain` or point/road depth |
| Retained model terrain `dep_subgrid.tif` | Actual 10 m elevation raster; 3,460 by 3,200 samples | Real detailed terrain used in model preparation; suitable for solid terrain voxels and explicitly derived downscaling |
| NOAA HAND at Trico-Marana and Sanders | Each window 300 by 300 over approximately 3 km; 10 m display spacing | Separate reach-stage/relative-terrain inundation estimate; not higher-resolution SFINCS |
| Original USGS Pima County 2021 lidar-derived DEM tiles | Catalog identifies 1 m standard bare-earth GeoTIFF products | A prospective sharper terrain source; not implemented in this renderer audit and not a 1 m flood simulation |

## Primary evidence

1. Solver checkout `H:/AI/Projects/FloodPLAIN-sfincs/.sfincs-runs/aligned-current-case-20261101-13z/sfincs.inp`, lines 1–9: `mmax=320`, `nmax=346`, `dx=100`, `dy=100`, origin `(467700,3572300)`, rotation 0, EPSG:32612. `dtout=3600` specifies hourly map output. The matching retained `current-output-41327417204/runs/current/sfincs_map.nc` was opened read-only: dimensions `n=346, m=320, time=64`; `zs(time,n,m)`, units `m`, standard name `sea_surface_height_above_reference_level`. It is a structured regular grid, not a quadtree output. Variables include `zs`, `zsmax`, `zvolmax`, `zb`, rainfall/infiltration; this map file does not contain time-varying velocity fields.
2. Solver `docs/sfincs/CURRENT-FORECAST-DESIGN.md:123`: 29,685 centre-selected 100 m cells, every 10 m subgrid pixel covered, 2021 terrain with a verified 2023 northern edge only where the 2021 mosaic is absent. Line 108 records 10 m bilinear reprojection of the original 2021 terrain and its acquisition dates (September 27–November 17, 2021). Earlier design-status paragraphs precede completed-intake updates and must not override them.
3. Read-only raster metadata from `.sfincs-runs/aligned-current-case-20261101-13z/subgrid/dep_subgrid.tif`: EPSG:32612, dimensions 3200 by 3460, affine pixel spacing 10 m eastward and 10 m northward. The raster has positive-y row order; do not assume conventional north-up negative-y storage. Extent is easting 467700–499700 and northing 3572300–3606900. It is the fine prepared terrain, not the 100 m mean-terrain display export.
4. [CURRENT-SFINCS-PUBLICATION.md](CURRENT-SFINCS-PUBLICATION.md), lines 78–80: native execution retained 64 hourly frames over 63 elapsed hours; app exports only the 15 forecast-window frames from 17Z November 1 to 07Z November 2. Missing native water levels remain missing. Line 103 explicitly says no downscaling was added to that publication and gives the storage/full-cell-area quantity. A finer existing SFINCS flood-depth export is therefore not established by the current app artifact.
5. `public/simulation/vendor/claude-hand/data/hand/trico-marana-santa-cruz.json` and `sanders-santa-cruz.json`, JSON paths `grid.cols=300`, `grid.rows=300`, `grid.radiusM=1500`. Their geographic spacings are approximately 0.00010635° longitude and 0.00009018° latitude. `hand-inundation.js:28` computes cell area from `(2*radiusM/cols)^2`, giving 100 m²; lines 26–34 compare centimetre HAND elevations with the rating-curve stage for the relevant reach. These are wet masks, not native SFINCS depths or absolute `zs`. Both source records have `calibration.calibrated=false`; the NOAA/CIROH source upload date is 2024-08-17.
6. Solver `docs/sfincs/NATIVE-GEOMETRY.md:17` documents the historical setup's 100 m computation with 10 terrain pixels per side and 10 storage/conveyance levels. `docs/sfincs/FACE-DIAGNOSIS.md` explains that tiny diagnostic section lines still sample whole 100 m native faces; a 2 m diagnostic segment does not imply 2 m hydraulics.
7. Historical 1 m levee crest samples are recorded in `docs/sfincs/LEVEE-CASE.md`. They are structure-height inputs, not a locally refined flood grid. The 2015 historical geometry is not a replacement for the current case's 2021/2023 terrain.

## Existing official downscaling method

Installed HydroMT-SFINCS 1.2.2 already provides `hydromt_sfincs.utils.downscale_floodmap` in `H:/AI/Projects/FloodPLAIN-sfincs/.venv/Lib/site-packages/hydromt_sfincs/utils.py:862`. This is reusable postprocessing, not a new solver or a bespoke physical model. Its implementation maps water levels onto the higher-resolution DEM and subtracts terrain, retaining only depths over an explicit minimum. Optional native-cell indices preserve the mapping to parent computational cells.

The same installed version's `sfincs.py:782–785` expressly says the retained `dep_subgrid.tif` is written for visualization and downscaling. That makes this exact prepared raster the first-choice compatible terrain surface.

For the selected-hour map:

- Select exactly one native `zs` time first, dropping the time dimension. The helper takes a maximum over any remaining time dimension (`utils.py:915–924`); passing all 15 frames would silently turn a selected-hour view into a maximum-over-time map.
- Use exact parent-cell mapping or the helper's default nearest water-level reprojection. Do not smooth between hours or silently create spatial water-level interpolation.
- Require matching vertical units/datum, correct raster row order and native active-cell indices. Preserve native nulls and terrain nodata.
- Label the derived result as terrain-downscaled depth/extent. Retain the original cell-average depth readout separately and retain native `zs` as water-surface elevation.
- State the chosen wet threshold. The helper defaults to `hmin=0.05 m`, whereas the existing cell-color cutoff is `0.01 m`; these are different controls and must not be silently equated.
- Solid terrain occlusion under horizontal native-cell water planes can visualize that same level-versus-terrain relationship. It does not establish exact shoreline position, hydraulic connectivity within the cell, road depth or bridge clearance. A one-cell water surface can produce disconnected low patches; rendering is not a separate connectivity solution.
- Cosmetic glints may animate; water elevation, selected time, values and native footprints must not oscillate. No velocity arrows or transport direction can be derived from this retained map file.

## One-metre county/USGS terrain candidate

Retained `.sfincs-runs/aligned-2021-rasters/tnm-catalog.json` already lists `USGS 1 Meter ... AZ_PimaCounty_2021_B21` tiles. Example source recorded in that catalog: https://prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/1m/Projects/AZ_PimaCounty_2021_B21/TIFF/USGS_1M_12_x46y358_AZ_PimaCounty_2021_B21.tif . Its metadata describes lidar-derived bare-earth elevation, NAD83 UTM horizontal coordinates, NAVD88 vertical metres and public-domain reuse. This example tile alone is not full-domain coverage.

The current prepared raster is 10 m, imported using overview/window reads and reprojection. The existence of original 1 m URLs does not mean full-resolution originals or a 1 m renderer have been delivered. A bounded 1 m terrain upgrade needs verified coverage, actual reads of the desired-resolution pixels, preserved source metadata and CRS transformation, and a tiled level-of-detail representation. It would sharpen the landscape and derived visualization, without changing the retained hydraulic simulation. No 1 m acquisition or implementation was performed by this audit.

## Documentation reviewed

All Markdown documents under the app checkout's `docs/` present at the audit were read, including historical sections whose status was superseded later. Inventory: CONNECTED-ENGINE; CURRENT-INPUT-PACKAGE; CURRENT-SFINCS-PUBLICATION; EXPERIMENTAL-LAUNCH; FAILURE-POINTS; FORECAST-ENGINE; MAP-PRODUCT-REQUIREMENTS; MORNING-HANDOFF; PERMISSION; PLAN; PREFAB-FORECAST-STACK; RADAR-FIXTURES; RAINFALL-LAB; RAINFALL-SOURCE-AUDIT; ROUTE-FUSION; ROUTING-PROTOCOL; SCOPE; SENSOR-AUDIT; STAGE4-2013-AUDIT; STAGE4-FORCING; STORM-FORCING; VOXEL-3D-PLAN; and sfincs/LEVEE-CASE. AGENTS.md was also reviewed. `routes.png` is an illustration, not a resolution-data source.

The solver checkout's five top-level Markdown docs were checked (FAILURE-POINTS, PERMISSION, PLAN, SCOPE and SENSOR-AUDIT; duplicates were checked against the app copies), together with every `docs/sfincs/` Markdown document: ANTECEDENT-2013, BOUNDARY-AND-REACH, CURRENT-FORECAST-DESIGN, EVALUATION-2013, FACE-DIAGNOSIS, GEOMETRY-EVIDENCE, LEVEE-CASE, NATIVE-GEOMETRY, OFFICIAL-SETUP-REVIEW, PREPARED-DATA-ACQUISITION, PUBLISHED-CHANNEL-RESULTS, PUBLISHED-CHANNEL-SETUP, README, RESULTS, SOURCE-PLACEMENT-2013 and TECHNICAL-HANDOFF. Native current-case configuration/output metadata and installed postprocessor source were checked as described above. Older documents mentioning unreceived outputs, incomplete source coverage or unavailable visual QA are historical status, not the present implementation ledger.
