# v3l-obsrain-cnb-btf-ia005: curve-number initial abstraction Ia/S = 0.05, run 42642472519

**SENSITIVITY only.** This run is not tuned to observations. It is not a live configuration and not for live registration.

## 1. Prediction (written 2026-11-09 ~15:15Z, after dispatch and before any output was downloaded or scored)

### The question

The timing note (`docs/upgrade/BRAWLEY-TIMING-20261109.md`) left three possible causes of the 13.7 h late peak at ALERT 6443 Mile Wide. They have not been separated:

1. slow hillslope and tributary routing;
2. the delay before runoff starts, set by the curve-number (CN) initial abstraction (Ia);
3. too much runoff volume.

This run tests cause 2 alone.

### What the solver exposes (SFINCS f3647fc, read before building)

- `sfincs_input.f90:150` reads `sfacinf`, the SCS initial-abstraction fraction. Its default is 0.2.
- Both CN types use it:
  - `cna`, `compute_infiltration_cna`, `sfincs_infiltration.f90:850-854`;
  - `cnb`, `compute_infiltration_cnb`, lines 927-929.
- In `cnb` it works like this:
  - Runoff starts when the event rain P1 exceeds `sfacinf*S1`.
  - Runoff then follows Q = (P1 - sfacinf·S1)² / (P1 + (1 - sfacinf)·S1).
  - A new event starts after any dry step, with S1 = Seff.

So the change can be made on `cnb`, and the base is the **candidate** cnb-btf (run 42622454115), not base B.

### The change (one physical change, published source chosen before the run)

- **Sources:**
  - Hawkins, Jiang, Woodward, Hjelmfelt & Van Mullem (2002), Proc. 2nd Federal Interagency Hydrologic Modeling Conf.
  - Woodward et al. (2003), World Water & Environmental Resources Congress, doi:10.1061/40685(2003)308.
- **Finding:** Ia/S = 0.05 fits observed rainfall-runoff better than 0.20. The CN/S values built for 0.20 must be re-expressed for 0.05.
- **Conversion used:** **S0.05 = 1.33 · S0.20^1.15, with S in inches** (the power form, Woodward et al. 2003; restated in Lim et al. 2006, JAWRA 42(3)).
  - The task brief quoted S0.05 = 1.42 · S0.20. That is the *linear approximation* in Hawkins et al. (2009, ASCE "Curve Number Hydrology").
  - Over Black Wash the two forms give area-mean S of 83.6 mm (power) and 79.0 mm (linear).
- **Case edits:**
  - `sfincs.inp`: `sfacinf = 0.05`.
  - `infiltration.nc`: `smax` and `seff` converted per face (0 stays 0). `ks` is unchanged, so the recovery rate is unchanged.
- **How it was built:** `tools/sfincs/brawley/variants/build_ia005.py`, then two `make_variant.py` calls.
  - `make_variant.py` cannot change a file and an inp key in one call.
  - The intermediate step-1 folder is never run.
  - `current-case.json → variantChange` records both steps.
- **Files changed against the candidate:** exactly three files differ (`sfincs.inp`, `infiltration.nc`, `current-case.json`). Every other case file has the same sha256.

### Offline replay

`.sfincs-runs/brawley-avra-west-ia005/prediction-offline.json`, copied here as `prediction-offline.json`.

- **Method:** `compute_infiltration_cnb` is replayed per face over the 603 km² Black Wash 15876815 area, with dt 60 s and the case's own `precip_2d.nc` (dtwnd 30 min linear blend).
- **What it gives:** rainfall excess, meaning water put on the land surface. It is not routed flow.
- **Check against the solver:** the replay of the candidate gives 9.37 mm whole-run excess. That equals the solver's own cumprcp - cuminf (9.37 mm, candidate README).

| Black Wash area | Candidate (Ia 0.2·S0.20) | This run (Ia 0.05·S0.05) | sfacinf only, S unchanged (not run) |
|---|---|---|---|
| Mean S / mean Ia (mm) | 55.6 / 11.1 | 83.6 / 4.2 | 55.6 / 2.8 |
| Excess rate first > 1 mm/h | 16:09Z | 15:59Z | 15:48Z |
| Burst excess centroid | 18:09Z | 17:58Z | 17:51Z |
| Cumulative excess at 16Z / 17Z / 18Z (mm) | 0.55 / 2.32 / 5.56 | 1.09 / 3.20 / 6.24 | 1.97 / 5.30 / 9.59 |
| Excess Nov 1 12Z to Nov 2 00Z (mm) | 8.64 | 8.46 | 12.26 |
| Excess, whole run (mm) | 9.37 | 9.50 (+1.4%) | 14.14 (+51%) |

The candidate already makes runoff on the land from 16Z. Ia is about 11 mm, and the 16-17Z burst was about 21 mm. At the basin scale, Ia delays the start of runoff by only about 10 minutes.

### Predicted change at ALERT 6443 (Black Wash band; both bands move the same way)

- **Onset time:**
  - First reach of 10 m³/s and of 21.97 m³/s comes **earlier by 0 to 1 h**. The candidate first reaches 21.97 at 22:38Z, so the prediction is about 21:40-22:40Z.
  - It stays **at least 3 h after the observed 18:20Z peak**.
  - The model at 18Z/19Z stays below about 2 m³/s (candidate 0.28 / 0.48).
- **Peak time:** **unchanged within ±1 h** (candidate 08Z Nov 2). The lag after the observed peak stays at about 12.5 h or more.
- **Peak size:** 0 to +8% (candidate 64.74 m³/s).
- **Volume 18Z-18Z:** **0 to +5%** (candidate 3.50M m³; ratio to obs 18Z start 1.96 becomes about 1.96-2.06).
- **NSE:** about the same as the candidate (-7.4 with plateau). It is not expected to improve by more than about 0.5.
- **What would falsify this:** a peak more than 2 h earlier, or a first reach of 21.97 m³/s before 21Z. Either would mean that Ia, through local wet patches, matters far more than the basin-mean replay shows.
- **Expected conclusion:** cause 2 (CN Ia onset) is **not** the main cause of the late peak. The delay comes from routing (cause 1) or from where the water is generated.

## 2. Result (scored after section 1 was committed in 0e896783)

### Run health

- **Solver:** engine run 42528021117, cap 10800 s. The job log reports "Simulation finished" with total time 4,889.5 s and an average time step of 0.977 s (candidate: 5,647.7 s and 0.980 s).
- **Settings:** the run's own `sfincs.inp` says `inftype = cnb`, `btfilter = -1` and `sfacinf = 0.05`. `sfincs_map.nc` stores the attribute `sfacinf = 0.05`.
- **Artifact:** downloaded to `.sfincs-runs/brawley-avra-west-result-v3l-obsrain-cnb-btf-ia005-42642472519`. It is not committed.
- **Live verifier rule (any depth < -1 mm fails): PASS.** The lowest vol/area is -0.48 mm, on face 477789 at 09:45Z Nov 2. No cell is below -1 mm.
- **Stability:** no NaN zs in wet cells and no spike cells. The largest 15-min |dzs| in a wet cell is 2.41 m. The velocity proxy maximum is 2.38 m/s (candidate 2.35 m/s).
- **Mass balance:** the residual is -24,774 m³ (-0.04% of inputs).

### Runoff (solver cumprcp - cuminf, whole run)

| Area | Candidate | This run | Change |
|---|---|---|---|
| Black Wash 15876815 | 9.37 mm (C 0.180) | 9.50 mm (C 0.183) | +1.4% |
| Both bands | 9.28 mm | 9.41 mm | +1.4% |
| Whole mesh | 6.40 mm | 6.95 mm | +8.6% |

- The Black Wash value equals the offline replay to 0.01 mm (9.50 predicted).
- The larger whole-mesh rise comes from low-S faces outside the gauge area. For S below about 0.15 in, 1.33·S^1.15 is less than S itself, so those faces get both a smaller Ia and a smaller S.

### ALERT 6443 (primary county series, provisional; observed peak 64.73 m³/s at 18:20Z Nov 1)

| | Black Wash, ia005 | Black Wash, candidate | Both bands, ia005 | Both bands, candidate | Black Wash, B |
|---|---|---|---|---|---|
| Peak (m³/s) / time | 68.13 / 08Z Nov 2 | 64.74 / 08Z | 75.03 / 08Z | 71.35 / 08Z | 122.90 / 06Z |
| Peak lag after observed (h) | **13.67** | 13.67 | 13.67 | 13.67 | 11.67 |
| Model at 18Z / 19Z Nov 1 | 0.42 / 0.76 | 0.28 / 0.48 | 0.42 / 0.76 | 0.28 / 0.48 | 1.29 / 13.16 |
| First reaches 10 m³/s | **20:42Z** | 21:08Z | 20:35Z | 21:04Z | 18:44Z |
| First reaches 21.97 m³/s | **22:15Z** | 22:38Z | 22:12Z | 22:36Z | 20:03Z |
| 03Z Nov 2 model (÷ obs 21.97) | 55.73 (2.54x) | 56.21 (2.56x) | 57.90 (2.64x) | 57.89 (2.63x) | 105.75 (4.81x) |
| Volume 18Z-18Z (m³) | 3,599,217 | 3,497,639 | 3,898,535 | 3,781,210 | 7,564,853 |
| ÷ obs 18Z start / no plateau | 2.02 / 2.47 | 1.96 / 2.40 | 2.19 / 2.68 | 2.12 / 2.60 | 4.24 / 5.20 |
| ÷ obs 16Z start / no plateau (lower bounds) | 1.91 / 2.31 | 1.86 / 2.25 | 2.07 / 2.51 | 2.01 / 2.43 | 4.01 / 4.86 |
| Hourly NSE, with plateau / without | -7.49 / -6.70 | -7.37 / -6.74 | -9.19 / -7.62 | -8.93 / -7.51 | -37.09 / -34.74 |
| RMSE with plateau (m³/s) | 36.9 | 36.6 | 40.4 | 39.9 | 78.1 |

- The first-reach times are linear interpolations between hourly restarts. They are not measured crossings.
- The observed 16:20-18Z part is outside the model window, so ratios using the 16Z start are lower bounds.
- The without-plateau totals are a bracket. Flow during the plateau is unknown, not zero.

### Prediction against result

| Item | Predicted | Result | Hit |
|---|---|---|---|
| First 21.97 m³/s | 0 to 1 h earlier (21:40-22:40Z) | 23 min earlier (22:15Z) | yes |
| First 10 m³/s | 0 to 1 h earlier | 26 min earlier (20:42Z) | yes |
| 18Z / 19Z model flow | below ~2 m³/s | 0.42 / 0.76 | yes |
| Peak time | unchanged ±1 h | unchanged (08Z) | yes |
| Peak size | 0 to +8% | +5.2% | yes |
| Volume 18Z-18Z | 0 to +5% | +2.9% | yes |
| NSE | change within ±0.5 | -0.13 (with plateau), +0.05 (without) | yes |
| Falsifier (peak >2 h earlier, or 21.97 before 21Z) | not expected | did not happen | n/a |

### Reading

- **Cause 2 (CN initial abstraction delaying runoff onset) is ruled out as the cause of the late peak.**
  - The published Ia/S = 0.05 re-expression moves runoff onset only about 25 min earlier.
  - It leaves the peak at 08Z Nov 2, still 13.7 h after the observed peak.
  - The model has 0.4-0.8 m³/s at 18-19Z, while 52 m³/s was observed.
  - The offline replay explains this: the candidate already puts water on the land from 16Z. Ia is about 11 mm, and the 16-17Z burst was about 21 mm.
- **What is left:** slow hillslope and tributary routing (cause 1), and where the volume is generated (cause 3). This run cannot separate those two.
- **Sections and roads:** they move by small amounts, in the same direction as the volume.
  - Manville section peak: 80.2 → 83.4 m³/s.
  - Tucker section peak: 79.8 → 83.8 m³/s.
  - Rated crossings: max over the road changes by +0.000 to +0.008 m.
  - Dips: -0.006 to +0.046 m (largest change: W Manville Rd 1.24 m dip).
  - Stations over the road: 5,547, against 5,278 in the candidate and 7,677 in B.
- **Status:** SENSITIVITY only. This is not a candidate change for timing, and it is not for live registration.

## Files

- `prediction-offline.json`: the offline cnb replay (`build_ia005.py`), committed before scoring.
- `validation-full.json`: `tools/sfincs/brawley/extend/validate_extended.py --run <ia005> --baseline <42543054067> --compare <candidate 42622454115>`.
- `score_ia.py`: copy of `../result-v3l-obsrain-cnb-btf-42622454115/score_combo.py`. It adds `firstReach10M3s` and a neutral label.
- `summary-vs-candidate.json`: base = candidate cnb-btf, ref = B.
- `summary-vs-B.json`: base = B, ref = candidate.

## Re-run

```
python -I tools/sfincs/brawley/variants/build_ia005.py .sfincs-runs/brawley-avra-west-case-v3l-obsrain-cnb-btf \
  .sfincs-runs/brawley-avra-west-ia005/infiltration-ia005.nc --prediction .sfincs-runs/brawley-avra-west-ia005/prediction-offline.json
python -I tools/sfincs/brawley/extend/validate_extended.py --wt . --run <ia005>/artifact/runs/current \
  --baseline .sfincs-runs/brawley-avra-west-result-42543054067/artifact/runs/current --compare <cnb-btf 42622454115>/artifact/runs/current --output validation-full.json
python -I score_ia.py --wt . --run <ia005> --base-run <cnb-btf> --validation validation-full.json \
  --base-validation ../result-v3l-obsrain-cnb-btf-42622454115/validation-full.json --base-tag cnb-btf --tag ia005 \
  --ref-validation ../result-v3l-obsrain-42599666617/validation-full.json --ref-tag B --output summary-vs-candidate.json
python -I score_ia.py --wt . --run <ia005> --base-run <B 42599666617> --validation validation-full.json \
  --base-validation ../result-v3l-obsrain-42599666617/validation-full.json --base-tag B --tag ia005 \
  --ref-validation ../result-v3l-obsrain-cnb-btf-42622454115/validation-full.json --ref-tag cnb-btf --output summary-vs-B.json
```
