# Ready-to-consume September 2014 rainfall

Use `public/simulation/data/sfincs-trico-stage4-2014.json` as the `--forcing` input to the solver branch's `tools/sfincs/prepare_local.py`. It already matches that loader's spatial hourly contract and surrounds the entire 67×101 terrain domain. No loader rewrite is required. The app's storm page links to `stage4.html` for hourly display and download.

The file covers **2014-09-08 07:00 UTC through September 11 07:00 UTC**, 72 adjacent one-hour intervals, with **zero missing cells across 12,096 exported cell-hours**. Original bitmap zeros are retained as missing, not rainfall zeros. All local cells have valid bitmap entries. Values are historical precipitation analyses, not a forecast accuracy claim.

Source: NCEP Stage IV GRIB1 files independently archived by IEM, for example [the hour ending September 8 18 UTC](https://mesonet.agron.iastate.edu/archive/data/2014/09/08/stage4/ST4.2014090818.01h.grib). The [NCAR dataset record](https://gdex.ucar.edu/datasets/d507005/) independently documents Stage IV availability since January 2002 and GRIB1 coverage encompassing 2014. We decode the actual archived GRIB metadata, not a modern PNG palette or world file. No claim of byte-for-byte identity with a second archive has been made.

Every source file verifies total precipitation (`tp`, parameter 61, table 2), `kg m**-2`, accumulation, and a one-hour interval ending at the filename's UTC timestamp. One kg/m² liquid water equals one millimetre; the hourly mean rate is numerically the same in mm/h. Original GRIB center `kwbc`, subcenter 4, generating process 182, bitmap, grid identity, projection and scan mode are recorded in `stage4-forcing-2014-provenance.json` along with each URL, size and SHA-256.

The native polar-stereographic grid has 4,763 m projected spacing and orientation −105°. ecCodes supplies native cell locations; no IEM half-cell correction is applied. Sixteen distinct native cells cover the padded output grid (longitude −111.36 to −111.25, latitude 32.38 to 32.51). Nearest-native sampling onto the 0.01° export grid is explicit and adds no spatial detail. The solver then maps that grid to its terrain cells; small nearest-neighbor boundary differences remain possible.

Event totals across the exported crop range from **21.14 to 32.52 mm**. The Trico-location exported cell totals **30.27 mm**, all in the first day, reproducing the separately decoded earlier Stage IV comparison. This is not agreement with a Trico rain gauge. The earlier Tucson comparison remains 41.90 mm versus a 46.736 mm airport gauge total; it is one site/event, not a transferable ± interval.

Original 72 GRIB files (88,163,146 bytes total) remain in the workspace `../rainfall-cache`, outside Git. Reproduce with `tools/simulation/build_stage4_forcing.py` using ecCodes; it reuses cached originals and otherwise retrieves only these bounded hourly files. Derived arrays and all original-file hashes are committed. No fitted scaling or blending with historical PNG rainfall occurs.

This replaces the incomplete PNG forcing for a labeled rainfall scenario. It supplies neither upstream river discharge nor downstream water levels. The solver owner must specify those boundaries; the previous recorded rain-only SFINCS output has not been rerun or relabeled as a flood reconstruction.
