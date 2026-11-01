# Ready-to-consume September 2014 rainfall

Use `public/simulation/data/sfincs-trico-stage4-2014.json` as the `--forcing` input to the solver branch's `tools/sfincs/prepare_local.py`. It already matches that loader's spatial hourly contract and surrounds the entire 67×101 terrain domain. No loader rewrite is required. The app's storm page links to `stage4.html` for hourly display and download.

The file covers **2014-09-08 07:00 UTC through September 11 07:00 UTC**, 72 adjacent one-hour intervals, with **zero missing cells across 12,096 exported cell-hours**. Original bitmap zeros are retained as missing, not rainfall zeros. All local cells have valid bitmap entries. Values are historical precipitation analyses, not a forecast accuracy claim.

Source: NCEP Stage IV GRIB1 files independently archived by IEM, for example [the hour ending September 8 18 UTC](https://mesonet.agron.iastate.edu/archive/data/2014/09/08/stage4/ST4.2014090818.01h.grib). The [NCAR dataset record](https://gdex.ucar.edu/datasets/d507005/) independently documents Stage IV availability since January 2002 and GRIB1 coverage encompassing 2014. We decode the actual archived GRIB metadata, not a modern PNG palette or world file. No claim of byte-for-byte identity with a second archive has been made.

Every source file verifies total precipitation (`tp`, parameter 61, table 2), `kg m**-2`, accumulation, and a one-hour interval ending at the filename's UTC timestamp. One kg/m² liquid water equals one millimetre; the hourly mean rate is numerically the same in mm/h. Original GRIB center `kwbc`, subcenter 4, generating process 182, bitmap, grid identity, projection and scan mode are recorded in `stage4-forcing-2014-provenance.json` along with each URL, size and SHA-256.

The native polar-stereographic grid has 4,763 m projected spacing and orientation −105°. ecCodes supplies native cell locations; no IEM half-cell correction is applied. Sixteen distinct native cells cover the padded output grid (longitude −111.36 to −111.25, latitude 32.38 to 32.51). Nearest-native sampling onto the 0.01° export grid is explicit and adds no spatial detail. The solver then maps that grid to its terrain cells; small nearest-neighbor boundary differences remain possible.

Event totals across the exported crop range from **21.14 to 32.52 mm**. The Trico-location exported cell totals **30.27 mm**, all in the first day, reproducing the separately decoded earlier Stage IV comparison. This is not agreement with a Trico rain gauge. The earlier Tucson comparison remains 41.90 mm versus a 46.736 mm airport gauge total; it is one site/event, not a transferable ± interval.

Original 72 GRIB files (88,163,146 bytes total) remain in the workspace `../rainfall-cache`, outside Git. Reproduce with `tools/simulation/build_stage4_forcing.py` using ecCodes; it reuses cached originals and otherwise retrieves only these bounded hourly files. Derived arrays and all original-file hashes are committed. No fitted scaling or blending with historical PNG rainfall occurs.

This replaces the incomplete PNG forcing for a labeled rainfall scenario. It supplies neither upstream river discharge nor downstream water levels. The solver owner must specify those boundaries; the previous recorded rain-only SFINCS output has not been rerun or relabeled as a flood reconstruction.


## Expanded Cortaro-Trico reach crop

`public/simulation/data/sfincs-reach-stage4-2014.json` extends the same 72-hour source sequence to padded bounds [-111.37, 32.31, -111.05, 32.52], a 22-by-33 regular geographic grid. Its independent provenance is `stage4-reach-2014-provenance.json`; the earlier crop and its provenance are unchanged. Generate using `build_stage4_forcing.py --reach`. Native coordinates are decoded once and great-circle nearest cells are selected; ecCodes independently checks corners and center. This accelerates the same nearest-native-cell sampling. All original GRIB files are reused from cache.

The reach solver starts September 7 for spinup; this rainfall sequence begins September 8 07Z. Do not silently pad the earlier 24 hours with observed-dry rainfall: choose a documented spinup policy or obtain those hours separately.


## Full run including September 7 spinup

Use `public/simulation/data/sfincs-reach-stage4-2014-96h.json` for the complete September 7 07Z to September 11 07Z reach run. It retains the same expanded bounds and SFINCS-compatible hourly contract. The first 24 hours are actual archived Stage IV analyses, not zero-filled spinup. Original 72-hour artifacts remain unchanged. Source metadata and hashes for all 96 files are in `stage4-reach-2014-96h-provenance.json`. Reproduce using `build_stage4_forcing.py --reach --spinup`. This only supplies rainfall; it does not change hydraulic parameters or imply the reach output has been rerun.

The 96-hour export has zero missing values across 69,696 cell-hours. All 72 overlapping frames are identical to the preserved earlier artifact; all 96 raw-file hashes were checked. September 7 spinup totals range from 0.0 to 9.629999999999999 mm across the crop.


## July 2013 event input for the frozen model

`public/simulation/data/sfincs-reach-stage4-2013-july-96h.json` is the separately versioned July 19 07Z through July 23 07Z 2013 rainfall input for the same expanded reach. Generate with `build_stage4_forcing.py --event 2013-july`. Original archived GRIB metadata, bitmap masks and native mapping follow the same decoder as 2014; no rainfall rescaling or model fitting is applied. Its provenance file is `stage4-reach-2013-july-96h-provenance.json`.

The intended solver configuration is frozen at `86466e74425f3ab467939602edc31c89b83368dc`. This artifact supplies rainfall only and records no predicted score. Applying contemporary terrain and 2015 levee crest evidence to 2013 retains historical-geometry uncertainty. Existing 2013 upstream-routing fits elsewhere in the repository are a different model; they must not be represented as independent evidence for the SFINCS run.

July 2013 extraction completed with all 96 intervals present, zero missing values across 69,696 cell-hours, and all raw source hashes checked. Native cell mapping matches the 2014 reach exactly (62 distinct cells). Crop event totals range from 0.0 to 18.26 mm; largest hourly cell accumulation is 16.25 mm. These are rainfall inputs, not flood prediction metrics.


## July 5-23 antecedent extension: one unresolved hour

`public/simulation/data/sfincs-reach-stage4-2013-july05-23-432h.json` contains July 5 07Z through July 23 07Z, 432 contiguous intervals, same expanded reach. The final 96 event frames are exactly identical to the preserved event input. All 432 original-file hashes were verified. Reproduce with `build_stage4_forcing.py --event 2013-antecedent`.

**Status is insufficient_data:** July 16 02:00-03:00 UTC has 726 missing exported cells. The original `ST4.2013071603.01h.grib` bitmap marks the reach missing; the file contains valid data elsewhere. This is not a decoding gap or observed zero. No interpolation, substitution or rainfall rescaling was performed. The strict solver loader should reject this until a documented source or explicit uncertainty scenario resolves the hour.

Provenance: `stage4-reach-2013-july05-23-432h-provenance.json`. Compact handoff and exact source byte counts: `stage4-2013-antecedent-handoff.json`. Approximately 410 MB of new original antecedent files were cached outside Git; only cropped arrays and provenance are committed. The initial-state hypothesis cannot be declared tested merely from producing this incomplete forcing. No geometry, parameters or frozen results were changed.
