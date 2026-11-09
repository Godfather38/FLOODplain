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
