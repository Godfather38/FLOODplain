# Infiltration SENSITIVITY 1 (GCN10 drained CN): stopped, it would change nothing

SENSITIVITY check, not for live registration. No case was built, packaged or dispatched.

## Question
The cases use GCN10 fair cover, ARC II, **undrained** curve numbers (tiles `cn_rasters_undrained/cn_f_ii_2281.tif`, then 2280).
GCN10 (Azzam and Cho 2026, SoftwareX 34, 102725; https://hydro.nmsu.edu/datasets/gcn10/) also publishes a **drained**
version. The two differ only for dual hydrologic soil groups (A/D, B/D, C/D). NRCS NEH 630 ch. 7 uses the drained
(first) group where the seasonal high water table is deeper than 60 cm. (The task cited Jaafar et al. 2019, Sci Data 6:145.
That paper is GCN250, a different product. The cases use GCN10.)

## 1. Water table: deep, so "drained" applies physically
`water-table-usgs.json`, made by `tools/sfincs/brawley/variants/fetch_water_table.py`. Source: USGS Water Data OGC API,
field measurements, parameter 72019 (depth to water, ft below land surface), 2015-01-01 to 2026-11-09, context box
lon -111.51 to -111.0, lat 31.92 to 32.48. Public, no login.
- 399 readings from 44 wells.
- Median of each well's shallowest reading: 186.8 ft (56.9 m).
- Shallowest reading at any well: 7.99 ft (2.44 m), at USGS-321836111064801 (-111.114, 32.310), near the Santa Cruz River
  on the east edge of the box, not Avra Valley proper. Only 3 wells were ever shallower than 50 ft.
- No well has a reading shallower than 2 ft (0.6 m).

## 2. The drained raster is identical to the undrained one here
`cn-drained-report.json`, made by `tools/sfincs/brawley/variants/prepare_cn_drained.py`:
- `cn_rasters_drained/cn_f_ii_2281.tif` and `cn_rasters_undrained/cn_f_ii_2281.tif` are **byte-identical**:
  both are 50,744,013 bytes with sha256 c9de24e5...bdc8. The whole 3 x 3 degree tile (-114 to -111 W, 30 to 33 N)
  has no cells where the two versions differ.
- The model domain needs no cells from tile 2280.
- Warped the same way (WarpedVRT nearest onto the 4800 x 6200 grid of the 10 m cn.tif), drained and undrained differ on
  0 of 29,760,000 cells. Mean CN is 82.32 either way.
- In the NMSU directory listings, only 12 of 2649 tiles differ in size between the drained and undrained versions.
  So the dataset changes only where dual soil groups exist, and this region has none.

## Consequence
- The drained cn.tif equals the current cn.tif, so HydroMT `cn_to_s` would give a byte-identical infiltration.nc.
  A "v3l-obsrain-drained" case would equal base case B (v3l-obsrain, run 42583445548), and a run would repeat B exactly.
  I did not dispatch it. That saves about 2 h of runner time and adds no information.
- The offline loss bracket at ALERT 6443 for drained is the same as the as-run value by construction
  (committed `tools/sfincs/brawley/diagnose/out-v2r-20261109/loss-brackets.json`): 17.13 mm of runoff from 36.56 mm of rain,
  C = 0.469, against 0.07 to 0.09 observed.
- The drained/undrained choice cannot explain the runoff excess.

## Side finding (not fixed here)
A direct nearest warp of the undrained tile onto this grid matches the current cn.tif on 29,710,488 cells. It differs on
49,512 cells (0.17%). The current cn.tif's 13.0 M-cell block was copied from `.sfincs-runs/all-route-context-v2/cn.tif`,
an older warp chain. This does not affect the conclusion: the drained-minus-undrained difference is zero on both grids
because the source tiles are identical.
