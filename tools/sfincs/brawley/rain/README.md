# All-route frozen rainfall package

> I don't want to interrupt existing work- just add on to it. Lets make sure all dips in our routes have tracking. And use those gauges along the river.

Ready for the existing native assembler under `package/`:

- `initialization-rainfall/resolved-analysis-precipitation.nc`: 46 analysis hours, October 30 16Z through November 1 14Z.
- `initialization-rainfall/forecast-transition-precipitation.nc`: 3 HRRR transition hours, November 1 14Z–17Z.
- `precipitation.nc`: 14 HRRR forecast hours, November 1 17Z through November 2 07Z.
- `precipitation-metadata.json` and `initialization-rainfall/resolved-analysis-metadata.json`: units, intervals, source hashes and explicit replacement provenance.

Combined shape is 63 × 46 × 51, with zero missing cell-hours. Grid centers cover longitude -111.41 to -110.91 and latitude 32.16 to 32.61; raster edges cover [-111.415, 32.155, -110.905, 32.615]. This covers all three supplied corrected domains, including Gates. Exact domain file hashes and output hashes are in `delivery.json`.

Used the existing source decoder scripts, with only offline cache lookup and domain-version changes. No source was downloaded or refreshed. All 45 available Stage IV hours retain their original values; the original November 1 12Z–13Z Stage IV bitmap gap is retained separately and replaced explicitly by the existing NOAA MRMS Pass2 source. Its expanded-domain values range from 0 to 0.7 mm. No zero filling occurred. HRRR issue remains November 1 14Z, with NWM November 1 13Z only as source context.

This is a rainfall deliverable, not a completed inlet assignment. The copied old boundary files were needed by the original serialization code and must not be used as expanded-domain inlet assignments. The parent owns the corrected domain boundary registries. No solver was run and no H-worktree file changed.

## brawley-avra-west-v1 (2026-11-08)

The text above describes the original all-route union package (task-2). This folder holds copies of those scripts, adapted for the new case.

- `prepare_brawley.py` is the driver. It is an adapted copy of task-2 `prepare.py`. It copies the retained `road-rainfall-v2` package and raw bytes (read-only source) into `--output`, then runs the same four scripts in the same order.
- `recrop_current_inputs.py` has two new options, `--grid-bounds W S E N` (EPSG:4326 grid centres) and `--domain-version`. When they are not given, the script behaves as before.
- The grid centres span lon -111.52..-110.98 and lat 31.92..32.43 at 0.01 deg, so the grid is 52 x 55 and there are 63 frames. The requested south edge was 31.98. It was moved to 31.92 because the local contributing area reaches 31.937 N. That area is the NLDI basin of 15876711 minus the basin of 15876941. About 32 km2 of it lies south of 31.975.
- All raw files are full native grids: HRRR 1799x1059, Stage IV HRAP 1121x881, MRMS 7000x3500. Nothing was downloaded.
- One Stage IV hour has a gap: 2026-11-01 12-13Z is missing over the whole crop (bitmap). It was replaced explicitly with MRMS Pass2, as in the original. No other gaps were found and no cells were zero-filled.

Run it with the working directory set to the worktree root (about 20 s):
`NUMBA_CACHE_DIR=.sfincs-runs/numba-cache H:/AI/Projects/FloodPLAIN-sfincs/.venv/Scripts/python.exe tools/sfincs/brawley/rain/prepare_brawley.py --output .sfincs-runs/brawley-avra-west-rainfall-v1 [--domain <domain.geojson>]`
