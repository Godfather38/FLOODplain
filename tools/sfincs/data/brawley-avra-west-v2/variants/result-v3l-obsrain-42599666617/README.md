# SENSITIVITY result 42599666617: base case B v3l-obsrain (not for live registration)

**SENSITIVITY run. It is not tuned to observations, not a live configuration and not for live registration.**

Case `../../../all-route-ready-v3/brawley-avra-west-native-case-v3l-obsrain` (`sensitivityVariant: true`, commit e635d315).
It is the v2r case (run 42555458619, all observed Stage IV rain) with one change: the 5 lobe-tip cells of the v3 boundaries
(faces 54443, 54444, 54598, 54599, 54756; reversed NHDPlus 15876709, see `../../boundaries-v3/placement-report.json`) are
outflow cells (msk 1 -> 3). 52 outflow cells instead of 47. The two NW OSM outfalls of v3x are not opened, so no road station
sits in an outflow cell. Everything else is byte-identical to v2r (`score_v3l.py` asserts the mask differs on exactly those 5 faces).

## Solver

- First dispatch, run 42583445548 (commit e635d315, cap 7200 s): **killed by the cap** at 95-99% (exit 124). Restarts up to
  16Z Nov 2 were written; the map file was not closed. Not scored here.
- Rerun, **run 42599666617** (commit a25636e1, same packaged case, engine run 42528021117, cap 10800 s): "Simulation finished",
  total time 8,136.1 s. Average time step 0.947 s, the same as v2r (5,759.0 s wall). The extra wall time is runner speed,
  not a smaller time step. Variants of base B should use cap 10800.
- Artifact `sfincs-verification`, 917,624,979 bytes on disk, retention 7 days. `sfincs_map.nc` sha256 16ebd88d30f34d66…. Not committed.

## Results

Hourly restart flux (instantaneous snapshots, m³/s); volumes are trapezoids from the first restart, 18Z Nov 1.

| Series | v3l peak / time | v3l volume | v2r |
|---|---|---|---|
| Lobe tip 15876709 (5 cells, own series) | **92.67 / 10Z**; 62.2 at 18Z | **4,759,652 m³** | closed |
| Outlet 720060498 (26 cells) | 69.70 / 04Z | 3,742,887 m³ | 69.86 / 04Z; 3,728,288 m³ |
| v2 outflow cells (47) | 106.32 / 03Z | 5,509,712 m³ | 106.32 / 03Z; 5,525,880 m³ |
| All outflow cells (52) | 193.01 / 04Z | 10,269,364 m³ | 106.32 / 03Z; 5,525,880 m³ |

- **Lobe tip.** Outflow starts at 23Z Nov 1 (7.9) and stays at 70-93 m³/s from 02Z to 14Z Nov 2. The hour-to-hour swings
  (41.9 at 15Z, 72.3 at 16Z) are probably sampling noise of the instantaneous restart flux (inference: the restarts hold one
  time step per hour and nothing here tests it; a time-integrated outflow, e.g. a his file, would).
- **Pond (face 54135).** Peak water surface 620.52 m at 10:45Z Nov 2, falling at the end (620.43 at 18Z). v2r: 626.19 and still
  rising. Peak height above the cell's lowest sub-pixel is 3.45 m (v2r 9.11 m); that sub-pixel is the stock tank, not a mean depth.
  Lobe storage peaks at 345,905 m³ at 10:15Z and ends at 250,905 m³ (v2r 5,136,049 m³ at the end). Stored within 1.5 km of the
  pond at 18Z: 120,968 m³ (v2r 4,999,333 m³). The lobe outflow (4.76M m³) matches the storage no longer there (4.89M m³).
- **Everything upstream of the lobe is unchanged.** Against v2r, `reproduceV2ObservedTo07Z` in `validation-full.json` (here the
  v3l-vs-v2r difference over the whole run) finds 291 cells that differ by more than 0.01 m, p99 |Δzs| 0.00006 m, max 8.45 m (the lobe).
  Sections differ by at most 0.062 m³/s in any hour (Mile Wide), 0.042 (Manville), 0.003 (Tucker), 0.004 (Donaldson Ranch).
  The Outlet 720060498 links differ by up to 1.87 m³/s (they share the lobe's backwater).

### ALERT 6443 against the primary county series

Observed: `../../observed-gauges-20261101/gauges.json` (ALERT 6443, provisional, UTC). Peak 64.73 m³/s at 18:20Z Nov 1;
21.97 m³/s at 03Z Nov 2. Both model bands are scored because which band the gauge sees is not settled. **v3l equals v2r**: peaks and 03Z
values within 0.002 m³/s, every hour within 0.062 m³/s, volumes within 213 m³. The boundary change does not touch Mile Wide (13 km upstream).

| | Black Wash band | Both bands |
|---|---|---|
| Peak / time | 122.90 / 06Z Nov 2 (1.90× observed peak, 11.7 h late) | 139.24 / 07Z (2.15×, 12.7 h late) |
| 03Z Nov 2 | 105.75 (4.81×) | 111.61 (5.08×) |
| 18Z / 19Z Nov 1 (observed 52.39 / 52.58) | 1.29 / 13.16 | 1.30 / 14.30 |
| First reaches 21.97 / 64.73 | 20:03Z / 21:26Z Nov 1 | 20:01Z / 21:22Z Nov 1 |
| Volume 18Z-18Z, with plateau (obs 1,782,749 m³) | 7,564,853 m³, **4.24×** | 8,272,156 m³, **4.64×** |
| Volume 18Z-18Z, without plateau (obs 1,454,356 m³) | **5.20×** | **5.69×** |
| Volume 16Z-18Z, with plateau (obs 1,884,452 m³) | ≥ 4.01× | ≥ 4.39× |
| Volume 16Z-18Z, without plateau (obs 1,556,059 m³) | ≥ 4.86× | ≥ 5.32× |
| Hourly fit, 24 on-the-hour reports 18Z-18Z: NSE / RMSE | −37.1 / 78.1 m³/s | −46.3 / 87.0 m³/s |
| Hourly fit without the 8 plateau hours (16 reports) | −34.7 / 79.3 m³/s | −42.0 / 86.9 m³/s |

- The plateau is the 08:45-16:20Z Nov 2 reports (328,393 m³), on the steep low-stage step of the county rating. Leaving it out
  is a bracket, not a measurement: if it is an artifact, the true flow then is unknown, not zero.
- **16Z start:** the model has no flux before the first restart at 18Z Nov 1 (no his file). The model volume is still 18Z-18Z
  and is not filled, so the 16Z-start ratios are lower bounds (marked ≥).
- Observed volumes use the gauges.json method (trapezoid between reports, linear across the 16:20-18:00Z gap); the script
  asserts they equal `gauges.json` `mileWideComparison.volumeM3`.
- For reference, v3x (HRRR rain, v3 boundaries) scores 0.88× / 1.04× volume (18Z start, with plateau), NSE −3.2 / −3.8.
  Every number for all three runs is in `summary.json` `alert6443.runs`.

### Checks

- **Mass balance: not closed.** The residual lies in **[−33.1M, +128k] m³** (`summary.json` `massBalanceResidualRangeV3lM3`,
  from `validation-full.json` `outflowBeforeFirstRestart.trueResidualRangeM3` = [−33,121,659, +128,213]). The +128,213 m³
  end (+0.22% of inputs; v2r −13,374, −0.02%) counts outflow only from the first restart (18Z Nov 1). Outflow before then is
  not measured (no his file); its upper bound, inflow + rain before 18Z minus storage then with infiltration taken as zero
  (33.25M m³), gives the −33.1M m³ end. Both ends are estimates: the later outflow term is a trapezoid over hourly snapshots,
  and the lobe flux swings by about 35 m³/s between snapshots. Rain 57.66M m³, infiltration 39.55M m³ (both equal v2r),
  storage at 18Z 8.67M m³ (v2r 13.56M), outflow 10.27M m³ from 18Z Nov 1. The lobe tip itself carries 0.0 m³/s at the
  18Z-22Z restarts, but the other outflow cells already pass 3.0-5.6 m³/s at 19Z-20Z, so pre-restart outflow is not zero.
- **Negative depth.** Same as v2r: minimum vol/area −1.46 mm (face 478144, 39 m² cell, 02:30Z), 1 cell below −1 mm in 4 frames.
  That is outside the live verifier's −1 mm limit; it is not caused by the lobe change.
- **Stability.** 0 wet NaN values, 0 spikes, maximum 15-min rise 2.12 m (as v2r). Domain maximum depth 5.66 m (v2r 9.11).
  Velocity proxy (validate_extended rule, depth > 0.1 m) 8.21 m/s at the v2 outlet at 04Z, as in v2r (8.22). At the lobe-tip links
  it reaches 4.76 m/s at 14Z, where the link depth is just over 0.1 m; the largest unit discharge there is 0.54 m²/s. Depth here is
  zs minus the cells' lowest bed, not the flow depth at the u/v point, so this is a proxy, not a speed.
- **Roads.** All 5 Brawley crossings and all 12 dips are unchanged from v2r (for example Tucker +1.068, Manville +0.811, Mile Wide
  −0.107 m, never over). Stations over the road at some point: 7,677 of 57,465 (v2r 7,678); the one station that drops was not traced.
  57,465 is the scored set, not the 58,036 stations inside the mesh: 571 stations in the mesh have no road height (`roadZ` null,
  unknown, not dry) and are not scored; 104 of the file's 58,140 stations are outside the mesh (`summary.json` `stationCount`).
  No road station sits in an outflow cell (v3x had 10).

## Reading (inference)

- Opening the lobe tip does what v3x showed: the closed-edge pond is gone (4.9M m³ that v2r stored now leaves), and nothing upstream changes.
- With observed rain, the Mile Wide misfit is the v2r misfit: 4.2-5.7× the observed volume, peak 12 h late, NSE below −34.
  The boundary is not the cause; runoff generation and routing are (see `docs/upgrade/BRAWLEY-RUNOFF-ROUTING-20261109.md`).
- Base case B is a clean base for the runoff and boundary variants: variant-vs-B differences are the variant's change only.

## Files

- `validation-full.json`: `tools/sfincs/brawley/extend/validate_extended.py` on run 42599666617, `--compare` v2r 42555458619,
  `--baseline` v2 NWM 42543054067. `reproduceV2ObservedTo07Z` measures v3l against v2r. `waveAttributionTo07Z` and
  `frontVsBaseline0p3` mix rain and inflow (the baseline has HRRR rain) and are not meaningful here.
- `summary.json`: `score_v3l.py` output: outflow by source, pond and lobe storage, ALERT 6443 primary score for v3l, v2r and v3x
  (both bands, with and without the plateau, 16Z and 18Z starts, hourly fit), sections, mass balance, negative depth, stability, roads.
- `score_v3l.py`: the scoring script. It asserts that the pond zs and the lobe/near-pond volumes have no NaN (a NaN would be a
  missing value, never the bed or zero); neither run has one, so the round-8 change from fill/nansum to assert left every
  committed number unchanged and only added `massBalanceResidualRangeV3lM3` and `stationCount` to `summary.json`.

Reproduce (cwd = repo root):

    gh run download 42599666617 -n sfincs-verification -D .sfincs-runs/brawley-avra-west-result-v3l-obsrain-42599666617/artifact
    R=tools/sfincs/data/brawley-avra-west-v2/variants/result-v3l-obsrain-42599666617
    python -I tools/sfincs/brawley/extend/validate_extended.py --wt . --run .sfincs-runs/brawley-avra-west-result-v3l-obsrain-42599666617/artifact/runs/current \
      --compare .sfincs-runs/brawley-avra-west-result-v2r-42555458619/artifact/runs/current \
      --baseline .sfincs-runs/brawley-avra-west-baseline-v2x-nwm42543054067/artifact/runs/current --output $R/validation-full.json
    python -I $R/score_v3l.py --wt . --run .sfincs-runs/brawley-avra-west-result-v3l-obsrain-42599666617/artifact/runs/current \
      --v2r .sfincs-runs/brawley-avra-west-result-v2r-42555458619/artifact/runs/current --validation $R/validation-full.json \
      --v2r-validation tools/sfincs/data/brawley-avra-west-v2/rain-sensitivity/result-42555458619/validation-full.json \
      --v3x-validation tools/sfincs/data/brawley-avra-west-v2/boundaries-v3/result-42567934972/validation-full.json --output $R/summary.json
