# v3l-obsrain-cnb-btf candidate combination, run 42622454115

**SENSITIVITY only.** This is not tuned to observations, not a live configuration and not for live registration.

**Case:** `../../../all-route-ready-v3/brawley-avra-west-native-case-v3l-obsrain-cnb-btf` (commit 24bf992a; labels
`tools/sfincs/brawley/variants/labels-v3l-obsrain-cnb-btf.json`). It was built from the v3l-obsrain-cnb case folder with one
more change, `make_variant.py --inp-set btfilter=-1`. The `--source` cites SFINCS f3647fc `sfincs_boundaries.f90`
`update_boundary_fluxes` (uvmean, lines 1115-1119 and 1178-1190) and the btf result 42584636960.

Against base case B (`v3l-obsrain`, run 42599666617) it has **two** differences:

1. `infiltration.nc` (scs becomes smax/seff/ks) and `inftype cna -> cnb`. This is the same as v3l-obsrain-cnb, run 42584493432.
2. `btfilter 60.0 -> -1`. This is the same as v3l-obsrain-btf, run 42584636960.

Every other case file has the same sha256 as in B: sfincs.nc, sfincs_subgrid.nc, precip_2d.nc, sfincs.dis, sfincs.src,
the GCN10 files, hydromt.log and native-component.json. `sfincs.inp` differs from B only on the `btfilter` and `inftype` lines.
The run's own `sfincs.inp` says `btfilter = -1` and `inftype = cnb`.

## Run health

- **Solver:** engine run 42528021117 with cap 10800 s. The job log reports "Simulation finished" with total time 5,647.7 s
  and an average time step of 0.980 s (B: 8,136 s and 0.947 s; cnb: 6,202 s). There are 101 map frames and 25 hourly restarts
  from 18Z Nov 1 to 18Z Nov 2.
- **Artifact:** `sfincs-verification` was downloaded to `.sfincs-runs/brawley-avra-west-result-v3l-obsrain-cnb-btf-42622454115`
  (1,119,875,162 bytes on disk; `sfincs_map.nc` sha256 5529b2b62dd3d273…). It is not committed.
- **Live verifier rule (any depth < -1 mm fails): PASS.** The lowest vol/area is -0.43 mm, on face 627171 at 20Z Nov 1. No
  cell and no frame is below -1 mm. This is the same minimum as cnb.
  - Base B **fails** the same rule: -1.46 mm on face 478144, in 1 cell and 4 frames around 02:30Z Nov 2. v2r has the same value.
- **Other checks:** no NaN zs in wet cells and no spike cells. The largest 15-min |dzs| in a wet cell is 2.56 m, the same as cnb
  (B: 2.12 m).
- **Velocity proxy:** the maximum is 2.35 m/s. It was 8.21 m/s in B and 1.82 m/s in cnb.
- **Boundary-link speed:** the highest |q|/huv at a boundary link is 35.7 m/s, at a 1.4 mm flux depth. It was 352 m/s in cnb.
- **Mass balance:** the residual is +3,423 m³ (0.006% of inputs). It was 128,213 m³ in B and -114,264 m³ in cnb.

## ALERT 6443 against the primary county series

The observations come from `gauges.json`, primary series, provisional. The observed peak is 64.73 m³/s at 18:20Z Nov 1, and the
observed flow at 03Z Nov 2 is 21.97 m³/s. Model flux comes from hourly restarts starting 18Z Nov 1, so a ratio that uses the
16Z start is a lower bound. The plateau (08:45-16:20Z Nov 2, 328,393 m³) is a suspect rating step. The "no plateau" totals are
a bracket: the true flow during the plateau is unknown, not zero.

| | Black Wash band, cnb-btf | Both bands, cnb-btf | Black Wash band, B | Both bands, B |
|---|---|---|---|---|
| Peak (m³/s) / time | 64.74 / 08Z Nov 2 | 71.35 / 08Z Nov 2 | 122.90 / 06Z | 139.24 / 07Z |
| Peak lag after 18:20Z observed | **13.67 h** | 13.67 h | 11.67 h | 12.67 h |
| Model at 18Z / 19Z Nov 1 | 0.28 / 0.48 | 0.28 / 0.48 | 1.29 / 13.16 | 1.30 / 14.30 |
| First reaches 21.97 (obs 03Z) | 22:38Z Nov 1 | 22:36Z | 20:03Z | 20:01Z |
| 03Z Nov 2 model / observed | 56.21 (2.56x) | 57.89 (2.63x) | 105.75 (4.81x) | 111.61 (5.08x) |
| Volume 18Z-18Z, model m³ | 3,497,639 | 3,781,210 | 7,564,853 | 8,272,156 |
| ÷ obs 18Z start (1,782,749) | 1.96 | 2.12 | 4.24 | 4.64 |
| ÷ obs 18Z start, no plateau (1,454,356) | 2.41 | 2.60 | 5.20 | 5.69 |
| ÷ obs 16Z start (1,884,452), lower bound | 1.86 | 2.01 | 4.01 | 4.39 |
| ÷ obs 16Z start, no plateau (1,556,059), lower bound | 2.25 | 2.43 | 4.86 | 5.32 |
| Hourly NSE, 24 h with plateau | -7.37 | -8.93 | -37.09 | -46.26 |
| Hourly NSE, 16 h without plateau hours | -6.74 | -7.51 | -34.74 | -42.02 |
| RMSE, with plateau (m³/s) | 36.6 | 39.9 | 78.1 | 87.0 |

At Mile Wide, every value from cnb-btf equals cnb to within 14 m³ of volume. The Black Wash peak equals the observed peak in
size (64.74 vs 64.73 m³/s), but it comes 13.7 h late. That match is a coincidence of volume and routing; it is not a fit.
The observed hydrograph peaks at 18:20Z Nov 1, while this model is still below 0.5 m³/s at 19Z. Timing is still the main error.

## What each change does

**Runoff (solver `cumprcp - cuminf`, whole run 30 Oct 16Z to 2 Nov 18Z).** This comes entirely from cnb; btfilter does not
change infiltration (qinf is identical in the last state).

| Area | Rain | B runoff | cnb-btf runoff |
|---|---|---|---|
| Black Wash 15876815 | 51.9 mm | 17.92 mm, C 0.345 (10.81M m³) | 9.37 mm, C 0.180 (5.65M m³) |
| Both bands (union) | 52.9 mm | 18.53 mm, C 0.351 | 9.28 mm, C 0.175 |
| Whole mesh | 46.5 mm | 14.60 mm, C 0.314 | 6.40 mm, C 0.138 |

**Boundary (cnb-btf vs cnb; `compare-btfilter-vs-cnb.json`, from `compare_btf.py`).** Only `btfilter` differs between these two runs.

- The restart `uvmean` record is 0 in every cnb-btf restart. In cnb its largest |uvmean| is 0.69 m²/s.
- Stored outflow now equals the head term. Over all links the stored volume is 3,421,336 m³ and the head-term volume is
  3,373,938 m³. In cnb they were 3,539,403 m³ and 1,161,517 m³.
- At the outlet (26 cells), the stored ÷ head ratio is 0.97-1.02. In cnb it was 4.3-10.7.
- At the lobe tip (5 cells), the ratio is 1.0-1.9. In cnb it was 0.7-3.1.
- Total outflow from 18Z changes by -118,067 m³ (-3.3%). The hourly-snapshot difference balance does not close (sum
  -117,692 m³), so this number cannot tell a real change from sampling error.
- The water level rises inside the boundary links. This is a level difference, not a flow depth. At the outlet the rise is up to
  +0.42 m (depth above z_zmin 0.50 m vs 0.46 m); at the lobe tip it is +0.01 to +0.06 m.
- The rise mostly stays near the outflow cells:

  | Distance from outflow cells | Largest \|dzs\| | Cells changed by more than 1 cm |
  |---|---|---|
  | 0-100 m | 0.47 m | 50 |
  | 100-250 m | 0.11 m | 2 |
  | 250-600 m | 1.2 mm | 0 |

- Farther away there are scattered differences up to 1.35 cm: 9 cells beyond 5 km, the farthest 19.2 km away. Mile Wide sections
  differ by at most 0.004 m³/s. I read this as time-step noise from a different adaptive time step, not as a boundary effect.
- **Roads:** 420 stations lie within 600 m of an outflow cell. Their over-road status does not change, and their largest |dzs|
  is 0.1 mm. Over all 57,465 rated stations, 1 changes status: West Alibi Drive, 2.4 km away, with max over 0.000 m in both
  runs. No station's maximum zs changes by more than 1 mm.

## Roads and sections against B

These are cell zs against station roadZ in wet frames only. A frame that is not wet is not dry evidence. Each change is
cnb-btf minus B. cnb-btf minus cnb is 0.000 m at all 17 points.

- **Crossings:**
  - Donaldson Ranch: -0.018 m
  - Manville: -0.138 m
  - Mile Wide: -0.020 m (stays under the road)
  - Little Williams: -0.107 m
  - Tucker: -0.113 m
- **Dips:**
  - Snyder Hill 1.73 m: -0.34 m
  - Manville 1.24 m: -0.335 m
  - Drillers: -0.172 m
  - Mesquite Oasis: -0.166 m
  - The other dips: -0.02 to -0.13 m
- **Stations over the road** (full window): 5,278, against 7,677 in B and 5,277 in cnb.
- **Section peaks:**
  - Manville: 80.2 m³/s (B 158.0)
  - Tucker: 79.8 m³/s (B 159.1)
  - Outlet 720060498: 33.1 m³/s at 13Z (B 69.7 at 04Z)
  - Lobe tip: 46.9 m³/s at 13Z (B 92.7 at 10Z)
- **Outflow from 18Z:** 3.42M m³ from all cells, against 10.27M in B.
- **Storage at the end:** 5.47M m³, against 8.67M in B.

## Files

- `validation-full.json`: output of `tools/sfincs/brawley/extend/validate_extended.py --run <cnb-btf> --baseline
  <42543054067> --compare <B 42599666617>`.
- `summary.json`: output of `score_combo.py`, which is `score_cnb.py` with the run tag as a parameter and an optional
  reference run. It includes the runoff budget, ALERT 6443 for both bands (with and without the plateau, 16Z and 18Z starts,
  hourly NSE, peak time and lag), sections, outflow clusters, roads, mass balance, negative depth and stability. B is the base
  and cnb is the reference.
- `compare-btfilter-vs-cnb.json`: output of `tools/sfincs/brawley/variants/compare_btf.py --btf <cnb-btf> --base <cnb>`.
  Its canned notes about the 7,200 s cap and cna were rewritten for this pair; no number was changed (see
  `notesCorrectedForThisPair`).
- The cnb run re-scored against the full B (instead of v2r) is
  `../result-v3l-obsrain-cnb-42584493432/summary-vs-B.json`. At ALERT 6443 and on the roads it gives the same numbers as the
  old v2r-based summary, because B equals v2r upstream. The outflow clusters and mass balance now compare like for like: all
  outflow cells carry 3.54M m³ in cnb against 10.27M in B, and the lobe tip carries 2.11M against 4.76M.

## Re-run

```
python -I tools/sfincs/brawley/extend/validate_extended.py --wt . \
  --run .sfincs-runs/brawley-avra-west-result-v3l-obsrain-cnb-btf-42622454115/artifact/runs/current \
  --baseline .sfincs-runs/brawley-avra-west-result-42543054067/artifact/runs/current \
  --compare .sfincs-runs/brawley-avra-west-result-v3l-obsrain-42599666617/artifact/runs/current --output validation-full.json
python -I score_combo.py --wt . --run <cnb-btf>/artifact/runs/current --base-run <B 42599666617>/artifact/runs/current \
  --validation validation-full.json --base-validation ../result-v3l-obsrain-42599666617/validation-full.json --base-tag B \
  --ref-validation ../result-v3l-obsrain-cnb-42584493432/validation-full.json --ref-tag cnb --output summary.json
python -I tools/sfincs/brawley/variants/compare_btf.py --wt . --btf <cnb-btf>/artifact/runs/current \
  --base <cnb 42584493432>/artifact/runs/current --base-label "cnb v3l-obsrain-cnb 42584493432" --output compare-btfilter-vs-cnb.json
```
