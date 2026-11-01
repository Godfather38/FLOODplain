# Reused engine and native river geometry

## Executable reuse

The one explicitly authorized persistent build is [run 41290378239](https://github.com/Godfather38/FLOODplain/actions/runs/41290378239), source commit `f3647fc0289bb15cb2512d60686cef74cb853c78`. Its `sfincs-engine` artifact retains the executable, complete corresponding source archive, GPL license, build script, library listing and Ubuntu package versions for 90 days. A verified local copy is `.sfincs-runs/engine-41290378239/sfincs-engine.tar.gz`.

Executable SHA-256: `c4917bc54158b0943d6d128b45c4346a33d059fb5d93808d05520c975e38f090`.

The workflow now has **no compilation path**. It requires an earlier engine artifact, verifies the expected source commit and independent executable hash, checks runtime library availability, and fails rather than rebuilding. Runtime libraries are installed through Ubuntu packages; they are recorded in the artifact, not bundled into the executable. Fresh-runner reuse is exercised by the actual geometry case in [run 41291800062](https://github.com/Godfather38/FLOODplain/actions/runs/41291800062).

## Existing modeling methods actually applied

`prepare_geometry.py` uses the installed HydroMT-SFINCS 1.2.2 `setup_subgrid` and `setup_river_outflow` methods. These are the established [HydroMT methods](https://deltares.github.io/hydromt_sfincs/stable/_modules/hydromt_sfincs/sfincs.html), not a separate hydraulic implementation. The [SFINCS manual](https://sfincs.readthedocs.io/en/latest/input.html) describes fine-terrain subgrid volume/conveyance tables and mask-3 cells, whose depth is held at zero.

The new case retains the 100 m computational grid but uses 10 m USGS raw elevations to construct native subgrid tables (10 pixels per cell side, 10 water levels). The bounded 20.65 MB terrain crop includes a 100 m halo. All elevations are finite; no missing cells are filled and no channel is burned. Raw TIFF, exact export request, source hash and limitations are retained in `data/reach-terrain-10m`.

The NOAA OWP FIM river lines reused from the CIROH public bucket come from HUC 15050301 / branch 1589000003 and HUC 15050303 / branch 1588000002. The connected path is traced through `NextDownID`, including intermediate HydroID 27370116 and the verified cross-HUC link 27370120 -> 27390001. It contains Cortaro HydroID 27370113 and Trico 27390012. Original GPKGs, hashes, source URLs and the connected GeoJSON are in `data/hand-river`. Original coordinates are EPSG:5070; the GeoJSON is EPSG:4326 and HydroMT projects it to EPSG:32612.

Segments are oriented through their published downstream relationships. HydroMT then selects five downstream outflow cells using its explicitly assumed default 500 m opening width. Previously all 906 outer-edge cells were open. Other outer edges are now closed. This is not the UA study's normal-depth boundary, a surveyed channel width, or a surveyed bridge opening. Omitted lateral inflows and possible closed-edge effects remain limitations.

Cortaro's original gauge-coordinate source, observed hydrograph, Stage IV rainfall, uniform Manning 0.04, zero infiltration and 24-hour evaluation spinup remain unchanged. HAND relative heights, synthetic rating curves and gauge altitude fields are **not** substituted for absolute bathymetry. The 2015 UA survey workbook and HEC-RAS geometry are still unavailable; its relative-elevation plots have not been digitized into invented absolute elevations.

## Output meaning

For subgrid results, app `depthM` is native subgrid water volume divided by full computational-cell area. It is a cell-average scenario depth, not a roadway measurement. Native depth above the subgrid minimum is retained separately in checks. Water-budget storage uses native subgrid volumes, not depth times area. The model comparison remains against withheld Trico discharge; no target-based parameter fitting is performed.
