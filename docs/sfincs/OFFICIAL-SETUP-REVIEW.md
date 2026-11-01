# Official river-setup comparison (before further runs)

Reviewed installed HydroMT-SFINCS 1.2.2 and its [version-matched official example](https://github.com/Deltares/hydromt_sfincs/blob/v1.2.2/examples/build_from_script.ipynb), rather than transplanting a newer API. Notebook cells 22, 23 and 30 place river sources, supply river width/depth attributes and pass `datasets_riv` to `setup_subgrid`. The example explicitly calls its numeric widths/depth arbitrary: those example numbers must not become local geometry.

## Concrete mismatch: river paths are not river bathymetry

`tools/sfincs/prepare_geometry.py` calls `setup_river_outflow` with the NOAA HAND paths, but its `setup_subgrid` call supplies only the 10 m terrain. It does **not** supply `datasets_riv`. Therefore our verified river paths select the outlet, but do not establish a low-flow channel bed, width or bank geometry in the subgrid. The model currently relies entirely on unconditioned topographic elevation for that geometry. The phrase "river data integrated" must not imply channel bathymetry was integrated.

Installed `hydromt_sfincs/sfincs.py:727-742` documents the established input: centerline plus `rivwth` (or mask), and `rivdph` or absolute `rivbed`; optional point bed levels and Manning values. The NOAA paths are two-dimensional. Their existence alone cannot supply these missing quantities. Synthetic HAND stage/width curves are not surveyed bed elevations. This omission is a concrete difference from the working example, but river burning is not universally required if the DEM already resolves the true bed. Our present data have not established that condition, especially for low-flow connectivity near the pits.

Minimum defensible next geometry step: obtain or derive explicitly sourced river width and bed/depth consistent with this API, verify the bank/bed datum, then use the existing official subgrid river input. Do not copy the example's 1.5 m depth, arbitrarily fill the observed pits, or tune depths against Trico.

## Initialization is also explicit, not automatic

Pinned SFINCS `docs/input.rst:730-790` and [official input documentation](https://sfincs.readthedocs.io/en/latest/input.html#initial-water-level) distinguish a uniform initial water-surface elevation, spatial `inifile`, and native restart. Current `prepare_reach.py` sets `zsini=0` and supplies neither initial-state nor restart file. With terrain hundreds of metres above datum, this means dry initialization. Both 2013 gauges initially flow; upstream observations therefore contradict interpreting that dry start as an observed condition.

`docs/parameters.rst:251-258` defines `tspinup` as boundary-level ramping (optionally meteo), not automatic hydrologic equilibration. Changing that scalar would not solve missing antecedent storage. Official native restart preserves water levels and flow state; copying only water levels is not equivalent. A continuous antecedent-plus-event run would preserve state naturally, but the selected 14-day window is an explicitly bounded experiment, not a documented universal minimum or proof of equilibrium. It is prepared and **not launched** pending the completed setup review and a supported initialization decision.

## Checks that did not reveal a simple error

Installed `setup_river_inflow` (`sfincs.py:863-1010`) itself uses discharge source points; point sources are not inherently an invalid SFINCS method. It normally locates them where a river enters the domain, whereas our independently measured Cortaro source is an interior gauge cell. A former nearest-flowline relocation worsened 2014 and remains rejected; do not repeat relocation by guesswork.

Installed `setup_river_outflow` (`sfincs.py:1012-1145`) explicitly creates mask=3 at directed river exits. Our five downstream cells use that method and the documented default 500 m width. This does not provide surveyed normal-depth boundary conditions, but no reversed-mask or missing-outlet error was found. The source is not on an open boundary. Units, dates and raw-to-native forcing have separately been checked.

## Why 2014 improved without establishing readiness

Adding the documented levee constrained floodplain flow and changed the 2014 development peak from 96.72 to 301.31 m3/s against 339.80 observed. Larger flood flow could also occupy depressions and activate paths that the smaller 2013 event did not. The latter mechanism is a hypothesis supported by stored-water patterns, not a calibrated explanation. The successful computation and improved development fit do not demonstrate that low-flow channel geometry and antecedent state are correct. Preserve the failed independent event and resolve these setup inputs before further accuracy claims.

## Verified HAND field availability

Checked both complete connected-corridor hydraulic tables: upstream HUC15050301/branch1589000003 (8 path reaches) and downstream HUC15050303/branch1588000002 (38 path reaches). All 46 path reaches are represented, but every `Bathymetry_source_x` and `Bathymetry_source_y` field is empty, and no row is marked calibrated. The tables contain stage-dependent reach-average top widths, areas and volumes; they contain no absolute river-bed elevation. Their zero-stage widths range from 8.53 to 172.39 m upstream and 9.55 to 148.31 m downstream. These are synthetic HAND-derived quantities, not a documented low-flow channel mask or bank-to-bank survey. They cannot safely be relabeled `rivwth` plus `rivdph` without an explicit derivation and hydraulic meaning.

Exact downloaded sources and hashes are recorded in `tools/sfincs/data/hand-river/bathymetry-availability.json`; original CSVs are retained. The immediate missing official API inputs remain (1) a defensible channel mask/width and (2) absolute bed elevations or bank-referenced depths. The known county/UA survey workbook `Fig.3-8.cross section summary.xls` has been referenced but is not in hand. Existing USGS bare-earth terrain is an available elevation source, but a centerline sample is not automatically submerged bed; a new conditioned channel cannot be asserted merely from the presence of a DEM.

No synthetic table stage was converted into bed depth, no arbitrary rectangular channel was burned, and no run was launched during this source check. Once sourced geometry is available, the implementation route is the installed official `setup_subgrid(datasets_riv=[...])` with `centerlines`, `mask` or `rivwth`, and `point_zb`/`rivbed` or `rivdph`. This is a data-definition dependency, not a missing solver/compiler feature.

## Clarification: optional river burning is not a required repair

The absence of datasets_riv is not a demonstrated configuration error. The subgrid already represents the observed DEM, including exposed river beds where captured. The official river burn only lowers terrain using supplied depth or bed elevations; it does not discover these quantities. The concrete remaining question is local channel and pit connectivity, not whether every model must burn a river. The earlier description of this difference as an omission must not imply that burning is mandatory. Gauge observations during February 20-26 2015 show flow at Cortaro and zero daily flow at Trico, supporting spatially different acquisition conditions, not an entirely dry or entirely submerged corridor. No burn or run is authorized by that fact alone.

## Completed local lidar connectivity check

A bounded official 2015 one-metre lidar crop now checks the actual near-Cortaro storage pocket instead of assuming a missing channel everywhere. Source tiles are USGS_one_meter_x49y358_AZ_Eastern_PimaCO_2015.tif and x49y359 under the published USGS 1 m project; elevations are NAVD88 metres, horizontal CRS EPSG26912. Compared with the existing 10 m EPSG32612 terrain using each raster's geographic-to-projected river transform. Horizontal reference/epoch differences limit centimetre-level interpretation.

A four-neighbor minimum-saddle path from the fixed pocket point (490850,3579850) to the published HAND line, buffered 5 m only as a search target, gives 647.061 m for 2015 1 m terrain and 647.009 m for current 10 m terrain. Neither path touches the expanded crop edge. This is a topographic connectivity screen, not a hydraulic simulation or inferred channel width. It does not show an artificial 10 m terrain barrier that justifies carving. A smaller initial crop truncated the search and was discarded; only the expanded result is retained.

At 0.01 m below the 1 m saddle, the connected terrain depression holds approximately 1,233,612 m3 over 99,259 m2; it does not touch the crop edge. This is geometric capacity, not measured initial water. The 2013 modeled source pocket reached only about 643.56 m and stored about 0.967 million m3. Its modeled storage and failure to spill are consistent with this real modern-terrain depression, though its historical condition and inflow connectivity remain unverified.

Therefore no channel burn is presently justified by this check. The next established setup operation is an explicitly labeled observed-antecedent initialization experiment with unchanged geometry. Retrieved preceding Cortaro flow supplies 2.670 million m3 across 14 days, enough to investigate the identified 1.234 million m3 storage scale; that does not prove equilibrium or correct historical geometry. Any alternate six-hour precipitation allocation must remain labeled a source-qualified scenario and cannot upgrade this to independent validation.
