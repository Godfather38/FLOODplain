# landn: land (non-channel) Manning n lower bound on the v3l-obsrain-cnb-btf candidate (pre-registration)

**SENSITIVITY only.** Not calibrated, not tuned to the gauge, not a live configuration, not for live registration.

This file was written and committed **before** the run was dispatched and before any result was looked at. The source,
the value and the prediction below are fixed here; the result README will score against them and will not edit them.

## Question

`docs/upgrade/BRAWLEY-TIMING-20261109.md` found that the model peak at ALERT 6443 (Mile Wide) is 13.7 h late in the
candidate case and that water accumulates on the land within 10 km of the gauge instead of draining. It left three
causes unseparated: (i) slow hillslope / small-tributary routing, (ii) CN initial-abstraction onset, (iii) too much
volume. This test changes only (i): how fast water moves over land.

## How land n is set now

- `tools/sfincs/prepare_route_case_parameters.py` maps the ESA WorldCover 2021 10 m raster
  (`.sfincs-runs/brawley-avra-west-context-v2/lulc.tif`) to Manning n with the pinned table
  `esa_worldcover_mapping.csv` (same bytes as `tools/sfincs/data/current-2021-intake/esa_worldcover_mapping.csv`), and the
  Deltares quadtree subgrid builder averages that n onto each velocity point (`uv_navg`, `uv_ffit`, ...). `manning_land`
  in `sfincs.inp` is not used when a subgrid table is given.
- The candidate case (and B, cnb, chl) uses `.sfincs-runs/brawley-avra-west-parameters-v2/sfincs_subgrid.nc`
  (sha256 47481d56...), i.e. the pinned mapping everywhere, no channel-n burn (the v2n channel burn was a separate test).
- Classes in the active domain (12.4M pixels of 10 m): shrubland (20) 77.5% at n 0.05, bare/sparse (60) 14.5% at
  0.023, grassland (30) 4.1% at 0.034, built-up 2.0% at 0.10, cropland 1.5% at 0.037, other < 0.5%.
- Velocity points: mean `uv_navg` 0.0467, median 0.05 (`.sfincs-runs/brawley-avra-west-parameters-v2n/compare-vs-v2.json`).

## Published source and chosen value (chosen before the run)

USACE (1998), as printed in the HEC-HMS Technical Reference Manual CPD-74B (March 2000), Table 6-1 "Overland-flow
roughness coefficients for sheet-flow modeling":

| Surface | N |
|---|---|
| Smooth surfaces (concrete, asphalt, gravel, or bare soil) | 0.011 |
| Fallow (no residue) | 0.05 |
| Range | 0.13 |
| Short grass prairie | 0.15 |
| Dense grasses | 0.24 |

The table above was read from the CPD-74B PDF (page 60-61). The same values are, as recalled and not re-checked here,
in NRCS TR-55 (1986) Table 3-1, whose footnote credits Engman (1986); only the CPD-74B numbers are cited.

**Choice: n = 0.011 for WorldCover 20 (shrubland), 30 (grassland) and 60 (bare/sparse), outside the channel zone.**
This is the smallest overland value in the published table. No natural vegetated or bare surface is smoother than bare
soil, so 0.011 is the physically defensible **lower bound** of land n: the fastest hillslope flow the literature allows.
It is not a best estimate: the same table's best estimates for range (0.13) and short-grass prairie (0.15) are slower
than the pinned mapping (0.05, 0.034), and only bare soil (0.011 vs 0.023) is faster. A lower bound is the right test
for (i): if even the fastest defensible land flow does not move the Mile Wide peak toward 18:20Z, slow hillslope
roughness cannot be the cause.

All other classes keep the pinned values (tree 0.12, cropland 0.037, built-up 0.10, water 0.02, wetland 0.035).

## Isolating land from channel

- Channel zone = the v2n lidar-centred sand-bed channel mask (`.sfincs-runs/brawley-avra-west-parameters-v2n/channel-mask.geojson`,
  NHD order >= 3, lidar half-depth width) buffered by 10 m (one WorldCover pixel) and rasterized all-touched: 5.29 km2.
  Every 10 m pixel in it keeps its pinned n (asserted in the script). The buffer stops the builder's linear interpolation
  of the 10 m n raster from pulling changed land values into subgrid pixels inside the mask.
- Velocity points whose two cells reach outside the mask still average some land pixels, so their `uv_navg` can change;
  `compare-vs-v2.json` reports how many.
- Terrain sources, priority, mesh, builder settings (10 levels, 6 subgrid pixels) are unchanged; the elevation/volume
  tables (`z_*`, `uv_zmin`, `uv_zmax`, `uv_pwet`) must come out identical (checked by `compare_subgrid_n.py` and by
  `make_variant.py --subgrid-file`).
- Every other case file (sfincs.inp, sfincs.nc, infiltration.nc, precip_2d.nc, sfincs.dis/src, GCN10 files) stays
  byte-identical to the candidate case; `make_variant.py` refuses otherwise.

## Prediction (written before scoring)

Base for comparison: candidate v3l-obsrain-cnb-btf run 42622454115 (Black Wash band peak 64.74 m3/s at 08Z Nov 2, lag
13.67 h; 0.28 / 0.48 m3/s at 18Z / 19Z Nov 1; first reaches 21.97 m3/s at 22:38Z; 18Z-18Z volume 3,497,639 m3 = 1.96x
observed; hourly NSE -7.37; 5,278 stations over the road; min depth -0.43 mm).

Reasoning: kinematic overland travel time scales as about n^0.6, so 0.05 -> 0.011 on shrubland cuts land travel time to
about 40%. But onset is held by the cnb initial abstraction (unchanged), the order >= 3 channels keep their n, and part
of the land water sits in depressions that roughness does not drain.

1. **Peak time:** earlier by 2-5 h (about 03-06Z Nov 2), still at least 8 h after the observed 18:20Z Nov 1. Timing stays the main error.
2. **Onset:** flow at 18Z / 19Z Nov 1 stays below 5 m3/s; first reach of 21.97 m3/s earlier by 1-3 h (about 20:00-21:30Z);
   flow 10 km above the gauge first passes 23.1 m3/s 1-2 h earlier than in cnb-btf.
3. **Peak size:** higher, 75-100 m3/s (less attenuation on land).
4. **Volume 18Z-18Z:** about the same or up to +15% (more of the stored land water reaches the gauge inside the window);
   ratio to observed 18Z start 1.96 -> 2.0-2.3.
5. **NSE:** slightly better or similar, still below -3.
6. **Roads:** crossings' max water over the road up by 0-0.2 m; stations over the road on land fewer (shallower sheet
   flow), about 4,000-5,200.
7. **Stability:** passes the -1 mm rule; solver time somewhat longer than 5,648 s but under the 10,800 s cap.

If the peak moves by less than 2 h, slow land roughness is ruled out as the main cause and the remaining candidates are
Ia onset and depression storage / volume.

## Files

- Builder: `tools/sfincs/brawley/variants/prepare_parameters_land_n.py` (copy of `prepare_route_case_parameters.py`,
  subgrid only, land classes overridden outside the channel zone).
- Variant: `tools/sfincs/brawley/variants/make_variant.py --subgrid-file` (new third kind of one change; refuses any
  table whose elevation/volume variables differ from the base).
- `land-n-report.json`, `compare-vs-v2.json`, `make-variant.log`: build outputs copied here after the build.
