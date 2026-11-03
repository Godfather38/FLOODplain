# Stress-test storm on the original 29,685-cell model

A what-if case for the 3D map: what the saved model shows when a big storm does reach the
roads. It is not a forecast or an observed event.

- Starts from the Nov 1 19Z case (run 41350254061) unchanged through 2026-11-01 21Z: same
  geometry, subgrid, roughness, infiltration, mask, solver settings, Stage IV analysis rain and
  HRRR transition.
- Rain from Nov 2 00Z to 06Z is the NOAA Atlas 14 100-year 6-hour storm at 32.40N 111.15W
  (2.83 in; peak hour 2.20 in), the same on every cell, with no areal reduction.
- The Santa Cruz inflow (source 1, NWM reach 15902351) rises to the river's record peak at
  Cortaro, Oct 2 1983 (65,000 cfs, 1,840.6 m3/s, USGS 09486500), at Nov 2 05Z.

`current-case.json` lists every input hash and the scenario. Run with the existing workflow:
case_archive `tools/sfincs/data/stress-storm-v1/case.tar.gz`, cap 1200.
