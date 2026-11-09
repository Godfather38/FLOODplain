# SENSITIVITY result 42555458619: v2r, all observed rain (not for live registration)

**SENSITIVITY run. It is not tuned to observations, not a live configuration and not for live registration.**

Case `../../../all-route-ready-v3/brawley-avra-west-native-case-v2r-observed-inflow` (`sensitivityVariant: true`, commit 8b1d2f0). It is the v2x case (run 42544624673) with one change: the rain.

## What changed and what did not

- **Changed: 17 hourly rain frames**, interval starts 2026-11-01T14Z to 2026-11-02T06Z. These were the frozen HRRR 2026-11-01T14Z forecast in v2x. They are now observed NCEP Stage IV 01h from the IEM archive.
  - The rain uses the same decoder and header checks (tp, kg m**-2, accum, 1 h), the same HRAP grid hash and the same frozen nearest-cell mapping as the frozen analysis hours (`tools/sfincs/brawley/extend/fetch_stage4_extension.py`).
  - 0 missing cells in all 28 Stage IV hours. No MRMS replacement was needed and nothing was zero-filled.
  - The 28 raw files were refetched over the network. Their sha256 hashes equal the v2x fetch.
  - Metadata: `../rain-v2r-stage4-metadata.json`.
- **Unchanged, byte for byte:**
  - Rain frames 2026-10-30T16Z to 2026-11-01T13Z (46 frames, the frozen Stage IV/MRMS resolved analysis).
  - Rain frames 2026-11-02T07Z to 17Z (11 frames, the same Stage IV as v2x).
  - sfincs.nc, sfincs_subgrid.nc, infiltration.nc, sfincs.inp, sfincs.dis (the same observed USGS 09487000 inflow, 75 values) and sfincs.src. Only `precip_2d.nc` differs.
- Built with `stage_route_case_native_window.py`, then `finish_route_case_window_observed_rain.py` (a copy of `finish_route_case_window.py` that leaves out the two frozen HRRR files), then `package_route_case.py`.

**Rain the model receives** (mesh-area-weighted, mm; `rain-frames-v2x-vs-v2r.json`):

| Interval | v2x (HRRR) | v2r (Stage IV) |
|---|---|---|
| 14Z–18Z Nov 1 | 0.69 | 19.44 |
| 18Z Nov 1–07Z Nov 2 | 14.13 | 8.25 |
| 14Z–07Z total | 14.81 | 27.69 |
| Whole run | 33.72 | 46.60 |

So v2r moves the burst 2–3 h earlier, to 14–18Z, and it adds 12.9 mm of rain (+38% over the run).

## Solver

- GitHub Actions run 42555458619 (sfincs.yml, ref experimental/brawley-avra-west-20261108, commit 8b1d2f0).
- Dispatched with the same inputs as v2x: engine run 42528021117, cap 7200 s.
- It finished ("Simulation finished") in 5,759.0 s.

## Results (hourly restart flux, m³/s; v2x in brackets)

| Section | Peak / time | Q 03Z | Q 07Z | Q 18Z |
|---|---|---|---|---|
| Donaldson Ranch | 33.85 / 04Z (21.29 / 03Z) | 32.55 (21.29) | 23.31 (13.98) | 4.93 (3.14) |
| Mile Wide, both bands | 139.24 / 07Z (47.54 / 09Z) | 111.61 (11.76) | 139.24 (34.63) | 64.03 (31.27) |
| ·· Black Wash band (ALERT 6443) | 122.90 / 06Z (40.66 / 09Z) | 105.75 (8.83) | 122.22 (29.53) | 58.87 (27.81) |
| ·· Brawley 15877627 band | 18.06 / 08Z (7.00 / 10Z) | 5.85 (2.92) | 17.02 (5.10) | 5.16 (3.46) |
| Manville | 157.97 / 01Z (62.79 / 11Z) | 140.09 (30.34) | 149.16 (29.36) | 84.41 (36.60) |
| Tucker | 159.14 / 10Z (64.34 / 13Z) | 157.52 (18.20) | 138.12 (32.42) | 97.27 (43.15) |
| Outlet 720060498 | 69.86 / 04Z (26.32 / 14Z) | 67.38 (0.95) | 59.23 (17.31) | 47.11 (19.12) |

Manville has a second, near-equal peak of 157.03 at 09Z. Tucker is 157.52 at 03Z and 159.14 at 10Z.

### ALERT 6443 at Mile Wide, against primary data (§13 of the validation doc)

| Hour (UTC) | Observed | v2x Black Wash / both | v2r Black Wash / both |
|---|---|---|---|
| 18Z Nov 1 | 52.39 | 0.003 / 0.003 | 1.29 / 1.30 |
| 19Z | 52.58 | 0.04 / 0.04 | 13.16 / 14.30 |
| 21Z | 29.87 | 0.36 / 0.36 | 51.21 / 52.22 |
| 22Z | 41.97 | 0.55 / 1.82 | 82.06 / 87.09 |
| 00Z Nov 2 | 21.69 | 5.15 / 5.95 | 119.07 / 125.48 |
| 02Z | 24.13 | 5.66 / 8.65 | 106.90 / 112.59 |
| 03Z | 21.97 | 8.83 / 11.76 | 105.75 / 111.61 |
| 06Z | 15.83 | 18.19 / 20.25 | 122.90 / 136.05 |
| 09Z | 12.18 | 40.66 / 47.54 | 110.19 / 127.47 |
| 18Z | 10.96 | 27.81 / 31.27 | 58.87 / 64.03 |
| Volume 18Z–18Z (m³) | 1,782,749 | 1,575,913 / 1,856,320 | 7,564,653 / 8,271,943 |

Every hour is in `alert6443-observed-compare.json`.

- **At 03Z Nov 2, against the primary ALERT 6443 report** (776 cfs = 21.97 m³/s): v2r is 105.75 m³/s on the Black Wash band and 111.61 across both bands, **4.81× / 5.08×** (v2x: 8.83 / 11.76, 0.40× / 0.535×).
  - The owner's ~817 cfs (23.1 m³/s) is confirmed in the primary data, but which report the owner saw is uncertain: 817 cfs at 02:45Z Nov 2, 776 cfs at 03:00Z, and 817 cfs also at 23:55Z Nov 1. So no single reading time is used; the comparison is with the primary series.
- **First time the model reaches 21.97 m³/s** (linear between hourly restarts): Black Wash band about 20:03Z Nov 1, both bands about 20:01Z (v2x: 06:20Z / 06:07Z Nov 2). For 23.1 m³/s: Black Wash about 20:05Z, both bands about 20:03Z (v2x: 06:26Z / 06:12Z). These are in `validation-full.json` `alert6443`.
- **v2r still does not produce the observed 18:20Z peak.** The modelled Black Wash band is 1.3 m³/s at 18Z and 13.2 at 19Z against an observed 52 at both hours.
- **v2r peaks at 06–07Z Nov 2**, about 12–13 h after the observed peak (Black Wash band 122.9 at 06Z, 1.90× the observed 64.7; both bands 139.2 at 07Z, 2.15×).
- **Volume.** v2r carries 4.24× (Black Wash band) / 4.64× (both bands) the observed 18Z–18Z volume; v2x was 0.88× / 1.04×.
  - The observed volume has a rating caveat (`../../observed-gauges-20261101/README.md`): the 08:45–16:20Z Nov 2 plateau of 11–12 m³/s at 2.64–2.72 ft may be a rating or stage-shift artifact. The plateau carries 0.33M m³; leaving it out gives 1.45M m³ for 18Z–18Z. That is a bracket, not a measurement: if the plateau is an artifact, the true flow then is unknown, not zero. Against 1.45M m³, v2r would be 5.20× / 5.69× and v2x 1.08× / 1.28×.
- The gauge cell zs peaks at 674.147 at 06:15Z, 2.49 m above the cell bed (v2x: 673.631 at 09:15Z).

### Road over-topping

Over-topping is cell zs minus station roadZ, counted only in wet frames (vol/area ≥ 0.0091 m). Frames that are not wet are never treated as dry evidence.

| Crossing | v2r max over / time | v2x max over / time | v2r first over (v2x) |
|---|---|---|---|
| W Mile Wide Rd | −0.107 / 08:00Z (never over) | −0.128 / 08:45Z | never (never) |
| W Manville Rd | +0.811 / 08:30Z | +0.612 / 11:15Z | 20:00Z (22:30Z) |
| W Tucker Rd | +1.068 / 02:30Z | +0.921 / 12:45Z | 23:15Z (21:45Z) |
| W Little Williams Dr | +0.569 / 02:30Z | +0.429 / 12:45Z | 23:30Z (19:30Z) |
| W Donaldson Ranch Rd | +0.083 / 04:30Z | +0.057 / 03:45Z | 17:00Z, the first map frame (19:00Z) |

- **Why Tucker and Little Williams go over later in v2r.** In v2x they went over early, but only by 0.04–0.22 m. That came from the HRRR local rain at 18–21Z (3.6/5.1/3.0 mm/h), which is heavier there than Stage IV (2.2/1.6/2.5). In v2r the routed flood then arrives at 00Z, about 10 h before v2x's main rise. All crossings except Mile Wide are still over at 18Z.
- **Dips.** Manville 1.12 m dip reaches +1.515 (v2x +1.322). Snyder Hill reaches +1.230 (v2x +0.642). Per-hour values for crossings and dips are in `hourly-compare-v2x.json`.
- **All stations.** 7,678 of 57,465 stations go over at some point (v2x: 4,859). 7,625 of them are over by 07Z.

## Checks

- **Mass balance.** Residual −13,374 m³ (−0.02% of inputs). This is an estimate, not a bound: the outflow term is a trapezoid over hourly snapshots of the instantaneous flux.
  - Rain 57.66M m³ (46.49 mm), infiltration 39.55M m³, storage at 18Z 13.56M m³, outflow 5.53M m³ from 18Z.
  - Outflow before the first restart (18Z Nov 1) is not measured. 35 mm of rain falls before then. The flux at all outflow links is 0.0 at 18Z and 2.98 at 19Z, so the gap is probably small (inference).
- **Negative depth.** The minimum vol/area is −1.46 mm (face 478144, 39 m² cell, 02:30Z). 1 cell is below −1 mm, in 4 frames. That is outside the live verifier's −1 mm limit (v2x: −0.67 mm, 0 cells).
- **Stability.**
  - 0 wet NaN values and 0 spikes. Maximum 15-min rise 2.12 m.
  - The velocity proxy reaches 8.22 m/s at 04Z at the outlet outflow cells (−111.293, 32.364); v2x reached 1.47 m/s. This is an outflow-boundary cell and has not been checked further.
- **Outlet pond** (see the outlet pond check, commit 3fad170). zs reaches 626.19, 9.11 m deep, and is still rising at 18Z. 5.00M m³ is stored within 1.5 km (v2x: 622.70, 1.24M m³).
- **Difference from v2x.** `reproduceV2ObservedTo07Z` in `validation-full.json` here measures v2r against v2x, so it shows the effect of the rain change, not a reproduction. Max |Δzs| 4.81 m, p99 0.41 m, 443,887 cells > 0.01 m.
- **Not meaningful here.** `waveAttributionTo07Z` and `frontVsBaseline0p3`: the baseline (v2 NWM run 42543054067) has the HRRR rain, so these differences mix inflow and rain.

## Reading (inference, not tested further)

- **The hypothesis is only partly supported.** Observed rain removes the 03Z shortfall and the late arrival of 23 m³/s, but it overshoots: 4.8–5.1× at 03Z and 4.2–4.6× the volume.
- **The observed 18:20Z peak is still missed.** The model's response at Mile Wide comes 5–12 h after the observed main burst (rain gauges 14:45–17:05Z; lighter rain followed until 21:27Z).
- So in this model, the HRRR rain timing alone does not explain the Mile Wide misfit. Runoff generation (the published CN antecedent assumption, no transmission loss) and the slow overland/channel routing look like the larger factors.
- Nothing here was adjusted to fit, and this run does not separate those factors.

## Files

- `summary.json`: the key numbers, v2r against v2x.
- `validation-full.json`: the output of `tools/sfincs/brawley/extend/validate_extended.py` (sha256 f671e230…, the committed version; re-run 2026-11-09 for the primary-series `alert6443` block and the residual wording, every other block unchanged). Run with `--baseline` v2 NWM 42543054067 and `--compare` v2x 42544624673.
- `hourly-compare-v2x.json`: hourly section flux and crossing/dip over-topping, v2x against v2r (`tools/sfincs/brawley/extend/compare_v2r_hourly.py`).
- `rain-frames-v2x-vs-v2r.json`: hourly mesh-weighted rain (`tools/sfincs/brawley/extend/compare_v2r_rain_frames.py`).
- `alert6443-observed-compare.json`: the observed ALERT 6443 hourly series (from `../../observed-gauges-20261101/gauges.json`) against both runs.

**Stale field in the packaged case (not edited).** `current-case.json` and `manifest.json` of `brawley-avra-west-native-case-v2r-observed-inflow` carry `forecastIssue: 2026-11-01T13:00:00Z`, copied from the frozen case (the NWM short_range cycle). v2r uses no forecast: the inflow is observed USGS 09487000 and the rain is observed Stage IV after 13Z Nov 1. The field is left as packaged because those files are hashed; read it as stale.

**Rain metadata label.** `../rain-v2r-stage4-metadata.json` was written by the v2x fetch tool and its `purpose` named v2x. It was relabelled by hand on 2026-11-09 as SENSITIVITY v2r. That committed copy is not hashed by the case.
- *Corrected 2026-11-09:* the packaged case still carries the old text. Its `current-case.json` (inside the archive and next to it) lists, under `rainfall.sourceArtifacts`, the original `.sfincs-runs/brawley-avra-west-rainfall-v2r/observed-extension-metadata.json` (sha256 5556168c…). That file's `purpose` still reads "Validation-only extended-window rain (brawley-avra-west v2x). Not live forcing."
- The packaged `rainSensitivity.hypothesis` also keeps its first wording: "11.8 m3/s at 03Z in v2x vs about 23.1 m3/s observed". The 11.8 is the both-bands value (the Black Wash band was 8.83), and the observed value at 03Z in the primary series is 21.97 m³/s (776 cfs).
- Both are left as packaged because the case files are hashed. Read them as stale labels; this README and `summary.json` carry the corrected wording.

**Not committed.** The native output: artifact `sfincs-verification`, 648,044,550 bytes, retention 7 days. `sfincs_map.nc` is 381,279,696 bytes, sha256 72c6433020ad….

Reproduce:

    gh run download 42555458619 -n sfincs-verification -D .sfincs-runs/brawley-avra-west-result-v2r-42555458619/artifact
    python -I tools/sfincs/brawley/extend/validate_extended.py --wt . --run .sfincs-runs/brawley-avra-west-result-v2r-42555458619/artifact/runs/current \
      --baseline .sfincs-runs/brawley-avra-west-result-42543054067/artifact/runs/current \
      --compare .sfincs-runs/brawley-avra-west-result-v2x-42544624673/artifact/runs/current --output validation-full.json
