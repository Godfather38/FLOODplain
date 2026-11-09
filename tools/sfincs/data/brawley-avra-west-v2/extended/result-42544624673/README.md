# Native route result 42544624673 (validation only, extended window)

Case `../../../all-route-ready-v3/brawley-avra-west-native-case-v2x-observed-inflow` (modelVersion `all-routes-brawley-avra-west-v1`, `validationVariant: true`). It uses domain v2 (1,240 km2) and mesh v2 (643,056 cells), the v2 parameters and the v2 boundaries (47 outflow cells). The parameters were reused, not rebuilt.

**Window.** 2026-10-30T16Z to 2026-11-02T18Z, 74 h. Map frames every 15 min from 2026-11-01T17Z, 101 frames. Hourly restarts, 18Z to 18Z.

**Inflow.** Observed USGS 09487000 for every hour (75 values). The value for each hour is the 15-min reading at the top of the hour, × 0.0283168. Peak 48.42 m3/s at 22Z; volume 955,922 m3.
- Hourly-mean variants, for comparison only (not used as forcing). Centred mean: peak 47.79 m3/s, 1,017,550 m3. Interval mean: peak 46.30 m3/s.
- Top-of-hour sampling misses 6.1% of the volume. Almost all of that is the 21:15–21:30Z rise: the 21Z top-of-hour reading is 66 cfs, while the centred mean is 627 cfs.
- A refetch of NWIS IV on 2026-11-09 gave the same 480 readings, all qualified P.

**Rain.**
- Frames up to 07Z are the frozen v2 package frames, unchanged. These are Stage IV/MRMS analysis up to 14Z Nov 1, then the HRRR 14Z forecast.
- Frames 07Z–18Z are observed Stage IV 01h from IEM. They use the same decoder checks, the same HRAP grid hash and the same nearest-cell mapping as the frozen analysis hours.
- No cell was missing, so no MRMS replacement was needed. Nothing was zero-filled and no HRRR is used in the extension.
- See `../rain-extension-stage4-metadata.json`.

**Solver.** GitHub Actions run 42544624673 (workflow sfincs.yml, ref experimental/brawley-avra-west-20261108, commit a2b5084, engine run 42528021117, cap 7200 s). It finished ("Simulation finished") in 5,680.8 s.

**Files here.**
- `summary.json`: the key numbers.
- `validation-full.json`: the full output of `tools/sfincs/brawley/extend/validate_extended.py`. The baseline is the v2 NWM frozen run 42543054067, used to attribute the inflow wave up to 07Z. The reproduce check uses the v2 observed run 42543056194.

**Not committed.** The native output: artifact `sfincs-verification`, 648,123,058 bytes, retention 7 days. `sfincs_map.nc` is 390,892,695 bytes, sha256 61a1f177c291….

Reproduce:

    gh run download 42544624673 -n sfincs-verification -D .sfincs-runs/brawley-avra-west-result-v2x-42544624673/artifact
    python -I tools/sfincs/brawley/extend/validate_extended.py --wt . --run .sfincs-runs/brawley-avra-west-result-v2x-42544624673/artifact/runs/current \
      --baseline <v2 NWM 42543054067>/runs/current --compare <v2 observed 42543056194>/runs/current --output validation-full.json

Road comparisons use the cell water surface zs against the station roadZ (`brawley-avra-west-local-v2.json.gz`), counted only in frames where the cell is wet (vol/area ≥ 0.0091 m). Frames that are not wet are counted separately; they are never treated as dry evidence. Not for live registration.
