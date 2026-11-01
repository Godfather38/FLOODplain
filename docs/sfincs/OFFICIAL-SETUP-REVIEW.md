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
