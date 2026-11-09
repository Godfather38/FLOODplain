# v3l-obsrain-cnb infiltration SENSITIVITY 2, run 42584493432

SENSITIVITY only. Not for live registration, not tuned to observations.

**Case:** `brawley-avra-west-native-case-v3l-obsrain-cnb` (commit 50918be7). This is base case B (`v3l-obsrain`) with exactly one change. The infiltration type goes from `cna` (SCS Curve Number, no recovery) to `cnb` (Curve Number with recovery). Only `infiltration.nc` and the `inftype` line of `sfincs.inp` differ from B.

**Run:** the solver took 6,202 s, inside the 7,200 s cap. Infiltration took 5.8% of the solver time.

## What `cnb` does in the pinned solver (SFINCS f3647fc)

Source: `source/src/sfincs_infiltration.f90`, subroutines `initialize_infiltration_cnb` and `compute_infiltration_cnb`. The solver reads three variables per mesh face from `inffile`:

| Variable | Units | Meaning |
|---|---|---|
| `smax` | m | Maximum retention S. No unit conversion is applied; `cna`'s `scs` is in inches. |
| `seff` | m | Effective retention S_e at the start. |
| `ks` | mm/hr | Saturated hydraulic conductivity. |

How the solver uses them:
- **Recovery rate.** kr = sqrt(ks/25.4)/75 per hour (SWMM Reference Manual Vol. I, eq. 4-36).
- **Start of an event.** A face starts a new event at the first wet time step after a dry one. Cumulative rain P1 is reset to 0, and S1 is set to S_e.
- **Runoff.** Q = (P1 − 0.2 S1)² / (P1 + 0.8 S1). S_e goes down by the water that infiltrates.
- **Dry spells.** After 0.06/kr hours without rain (SWMM eq. 4-37), S_e recovers by kr·Smax per hour, up to Smax.
- **When a face counts as dry.** Rain frames are interpolated linearly in time (`sfincs_meteo.f90`). A face is dry only between two zero frames.

HydroMT-SFINCS 1.2.2 `setup_cn_infiltration_with_ks` writes the same three maps: smax in m, seff = smax·effective, and ks in mm/hr, with Ksat capped at 100 µm/s (360 mm/hr).

## Inputs and their sources

| Input | Value | Source |
|---|---|---|
| smax | area mean 56.1 mm | The base case's own `scs` field × 0.0254. This is the same GCN10 `cn_f_ii_2281` raster (fair cover, ARC II, undrained) with the same face averaging, so the CN source is unchanged. |
| seff | = smax | Fully dry start at tstart, 2026-10-30 16Z (see below). |
| ks | area mean 52.8 mm/hr; p5/p50/p95 10.8 / 37.0 / 87.9 mm/hr | POLARIS v1.0 `ksat` mean, 0–5 cm (Chaney et al. 2019, *Water Resour. Res.* 55, doi:10.1029/2018WR022797), from http://hydrology.cee.duke.edu/POLARIS/PROPERTIES/v1.0/ksat/mean/0_5/ (tiles `lat3132_lon-112-111` and `lat3233_lon-112-111`). |

Details for ks:
- Converted from log10(cm/hr) to mm/hr.
- Each face gets the arithmetic mean over its footprint, which is the HydroMT "average" rule.
- Every face has POLARIS data, and no face needed the 360 mm/hr cap. No values were filled.

What these ks values mean for recovery:
- Recovery starts after 3.7 h without rain (median; p5–p95 2.4–6.9 h).
- Going from S_e = 0 back to full Smax would take about 62 h (median 1/kr).

Builder: `tools/sfincs/brawley/variants/build_cnb_infiltration.py`, then `make_variant.py --inftype cnb`. Stats: `infiltration-cnb-stats.json`.

**Why seff = smax.** NCEP Stage IV (IEM archive) over the model box shows the week before the start was nearly dry (`stage4-prior-rain.json`, script `prior_rain.py`):

| Window (UTC) | Domain mean | Largest cell |
|---|---|---|
| 24 h totals ending 12Z, Oct 24–29 | 0.00–0.04 mm | 0.6 mm |
| 24 h ending 12Z Oct 30 | 2.53 mm | 15 mm |
| 12Z–16Z Oct 30 | 1.15 mm | — |

About 3.7 mm (domain mean) before tstart is therefore not counted. That makes the start at most about 7% too dry against the mean Smax. The `cna` base ignores the same rain, so the comparison stays like for like.

## Base case B did not finish, so this is scored against v2r

Base run 42583445548 (`cna`) hit the 7,200 s cap at 95% (exit 124). Its last hourly restart is 16Z Nov 2, so a complete B `validation-full.json` does not exist. As the task allows, this run is scored against **v2r 42555458619**: same rain, same `cna` setup, v2 boundaries.

I checked that this is fair at Mile Wide (`base-b-partial-vs-v2r.json`, script `b_vs_v2r.py`):
- Inside the contributing area of both Mile Wide bands, B's water levels equal v2r's at every hourly restart from 18Z Nov 1 to 16Z Nov 2.
- The largest difference is 8 mm, and the 99th percentile is 0.06 mm.
- B differs from v2r only by the 5 lobe-tip outflow cells, far downstream.

So v2r stands in for B at ALERT 6443. It does not stand in for B at the outlet or the outflow clusters.

## Results

Runoff from the solver's own `cumprcp − cuminf`, over the whole run from 30 Oct 16Z to 2 Nov 18Z (`summary.json` → `runoffBudget`):

| Area | Rain mm | Runoff, v2r (`cna`) | Runoff, `cnb` |
|---|---|---|---|
| Black Wash 15876815 (603 km²) | 51.9 | 17.9 mm, C 0.345 (10.8M m³) | 9.4 mm, C 0.180 (5.65M m³) |
| Union, both bands (692 km²) | 52.9 | 18.5 mm, C 0.351 | 9.3 mm, C 0.175 |
| Whole mesh | 46.5 | 14.6 mm, C 0.314 | 6.4 mm, C 0.138 |

The map file stores the cumulative fields only on the `timemax` frames, so the solver gives no split by window. The C values here are for the whole run. They are not the event-window C of 0.47 in `BRAWLEY-RUNOFF-ROUTING-20261109.md`.

ALERT 6443 against the PRIMARY county series. The observed peak is 64.73 m³/s at 18:20Z Nov 1, and the observed flow at 03Z Nov 2 is 21.97 m³/s.

| | Black Wash band, v2r | Black Wash band, cnb | Both bands, v2r | Both bands, cnb |
|---|---|---|---|---|
| Peak, m³/s (time) | 122.9 (06Z) | 64.7 (08Z) | 139.2 (07Z) | 71.4 (08Z) |
| Peak lag after observed | 11.7 h | 13.7 h | 12.7 h | 13.7 h |
| Flow at 03Z / observed | 105.8 / 4.81× | 56.2 / 2.56× | 111.6 / 5.08× | 57.9 / 2.63× |
| Flow at 18Z / 19Z Nov 1 | 1.29 / 13.2 | 0.28 / 0.48 | 1.30 / 14.3 | 0.28 / 0.48 |
| Volume ratio, 18Z start, with plateau | 4.24 | **1.96** | 4.64 | 2.12 |
| Volume ratio, 18Z start, without plateau | 5.20 | 2.40 | 5.69 | 2.60 |
| Volume ratio, 16Z start, with / without plateau (lower bounds) | 4.01 / 4.86 | 1.86 / 2.25 | 4.39 / 5.32 | 2.01 / 2.43 |
| Hourly NSE, with plateau / without plateau hours | −37.1 / −34.7 | −7.4 / −6.7 | −46.3 / −42.0 | −8.9 / −7.5 |

- Model volume, 18Z to 18Z: 3.50M m³ (cnb) against 7.56M m³ (v2r), Black Wash band.
- Observed volume: 1.78M m³ from 18Z, or 1.45M m³ with the suspect 08:45–16:20Z plateau removed.
- The model has hourly flux only from 18Z Nov 1. That makes the 16Z-start ratios lower bounds.

Other sections, peaks (m³/s) against v2r:

| Section | v2r | cnb |
|---|---|---|
| Donaldson Ranch | 33.9 | 25.1 |
| Manville | 158.0 | 80.2 |
| Tucker | 159.1 | 79.8 |

Downstream of Mile Wide, v2r is not base B (B has the lobe tip open).

Roads: the largest water level over the road falls by 0.02–0.34 m at every crossing and dip (`summary.json` → `roads`). Model road stations over the road at any time: 5,277 (cnb) against 7,678 (v2r).

Mass balance and stability:
- Mass-balance residual −0.19% of inputs. This is an estimate: outflow is counted only from the first restart.
- Minimum depth −0.43 mm, with no cell below −1 mm (v2r had 1 cell, in 4 frames).
- Velocity proxy max 1.82 m/s (v2r 8.22 m/s at the outlet).
- No NaN in wet cells.

## What this shows

1. **Recovery between the Oct 30–Nov 1 showers about halves the runoff.** The whole-run C falls from 0.345 to 0.180 over the gauge basin, with the same rain and the same CN.
   - It brings the Mile Wide volume from 4.2× to about 2.0× the observed volume (18Z start, with plateau), or to 2.4× without the plateau.
   - It is still about 2× too much water. `cnb` with a dry start is not enough on its own to match the gauge.
2. **It does not fix the timing.** The modelled peak comes 13.7 h after the observed one, 2 h later than v2r. At 18–19Z Nov 1, when the gauge peaked, the model has under 0.5 m³/s at Mile Wide.
   - The late, plateaued peak is a routing and arrival problem. The infiltration rule does not cause it.
   - The modelled peak equals the observed peak (64.7 m³/s), but 14 h late. That is a coincidence of magnitude, not a fit.
3. **Mixed effect on the hourly fit.** Hourly NSE improves from −37 to −7, but this comes only from the smaller volume. It is still strongly negative.

Open:
- Base B (`cna`, v3l) needs a re-run with a cap above 7,200 s to give a full B score. `cna` ran slower than `cnb` here because there is more water on the land.
- What `cnb` with an ARC I CN would do has not been tested. That would be a separate one-change variant, and is not done here.

## Re-run

```
python -I tools/sfincs/brawley/extend/validate_extended.py --wt . \
  --run .sfincs-runs/brawley-avra-west-result-v3l-obsrain-cnb-42584493432/artifact/runs/current \
  --baseline .sfincs-runs/brawley-avra-west-result-42543054067/artifact/runs/current \
  --compare .sfincs-runs/brawley-avra-west-result-v2r-42555458619/artifact/runs/current --output validation-full.json
python -I score_cnb.py --wt . --run <cnb>/runs/current --base-run <v2r>/runs/current --validation validation-full.json \
  --base-validation tools/sfincs/data/brawley-avra-west-v2/rain-sensitivity/result-42555458619/validation-full.json --base-tag v2r --output summary.json
```

The native output is not committed: it is in the `sfincs-verification` artifact, which is kept for 7 days.
