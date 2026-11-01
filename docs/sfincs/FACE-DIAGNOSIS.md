# Native face-discharge diagnosis

Output-only run [41298883444](https://github.com/Godfather38/FLOODplain/actions/runs/41298883444), commit `2199165`, changed only observation sections. The saved solver completed in 598.752 seconds. All exported physical checks exactly equal reference run 41297523344, including original-window peak, timing, RMSE, storage and water balance.

Official pinned `sfincs_crosssections.f90` sums signed native q times face width; `sfincs_quadtree.F90:1008` identifies cell-centre connections crossed by an observation line. Two-metre diagnostic segments cross exactly one connection each; they report the entire 100 m native face, not a two-metre strip of water. The 1,813 selected faces cover a one-cell-wide mapped-river corridor and a complete 1.5 x 2.5 km source/pocket box. No physical river width or boundary changed. All discharges are instantaneous native samples at 60-second intervals; volumes below are trapezoidal integrals.

## Measured routing and storage

Original July19 07Z through July23 07Z upstream input: **966,860.17 m3**. Source-cell net outflow is north **918,760.06 m3** and east **48,220.02 m3** (roughly 95%/5%); other faces are negligible net inward flows. Selected faces trace northward transport through x490950 at y3579400,3579500,3579600 and3579700, then westward circulation/storage around the source-adjacent pits.

The source/pocket box (EPSG32612 bounds 490000,3579000,491500,3581500) begins the original event with **2,900,413.16 m3** and ends with **3,807,645.43 m3**, gaining **907,232.27 m3**. Net boundary export is only **68,209.63 m3**. This directly locates the principal upstream-water retention near Cortaro; missing lateral inflows cannot explain why this measured upstream input remains there. It is not a tracer proof of the origin of every stored cubic metre.

Across the full 18 days, source-cell budget residual is **21.39 m3**, and enclosing-box residual is **20.39 m3**, including native rainfall and storage. These checks verify face orientation and sampling accounting. They do not certify the underlying real-world channel geometry.

## Specific source-placement discrepancy

The current source cell (row23,column239; bounds490900,3579300,491000,3579400) does **not** intersect the NOAA DEM-derived river centerline; the cell boundary is 14.21 m from that line. The gauge point is 95.08 m away. NOAA's nearest river point (491034.165,3579392.977) and the already obtained independent USGS NLDI nearest point (491030.431,3579398.680) agree on adjacent cell **[23,240]**. Thus a gauge-location point and a mapped river inflow location are not equivalent here.

This is a concrete placement discrepancy, not proof that moving the source alone repairs the model. The previously rejected nearest-line trial used older 100 m terrain/all-edge outlet setup, before the later subgrid and levee configuration; preserve that result rather than silently rewriting its meaning. Any next placement comparison should use the independently agreed mapped cell, unchanged current hydraulics, and report both events, not choose a cell by downstream score. Historical channel location and submerged bed remain uncertain. No relocation or new run was performed after this diagnostic.

## Artifacts

`tools/sfincs/data/reach-face-diagnostic-result/` contains case/checks, face definitions, measured flow summaries, source/box budgets, provenance, solver log and `event-face-history.npz` (native discharge m3/s, UTC times, original names for the original 96-hour window). Full native output remains in the GitHub run artifact and local run folder. The app can continue using the identical antecedent inundation artifact; diagnostic measurements do not improve its failed accuracy.
